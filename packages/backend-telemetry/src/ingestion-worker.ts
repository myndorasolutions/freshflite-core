import { verify } from "node:crypto";
import mqtt, { type MqttClient } from "mqtt";
import {
  IntegrityError,
  PACKET_BYTE_LENGTH,
  decodeBurstStream,
  decodeRecord,
  evaluateThermalSLA,
  type CargoManifest,
  type FreshFliteTelemetryRecord,
} from "@freshflite/shared-schema";
import { manifestForPod } from "./pod-profiles.js";
import { alertForClearance, alertForFrame, alertForRadioShutdown } from "./sla-monitor.js";
import { toStoredRow, type TelemetryStore } from "./telemetry-store.js";
import type { NotificationDispatcher } from "./notification-dispatcher.js";
import type { AuditReason, RadioState, RegisteredPod, SecurityAuditEntry } from "./types.js";

const TOPIC_PATTERN = /^freshflite\/v1\/pods\/([^/]+)\/(ping|radio-status|burst)$/;

export interface IngestionWorker {
  close: () => Promise<void>;
}

export interface IngestionHooks {
  store: TelemetryStore;
  dispatcher: NotificationDispatcher;
  securityAuditLog: SecurityAuditEntry[];
  lookupPod: (podId: string) => RegisteredPod | undefined;
  setRadio: (podId: string, radio: RadioState) => void;
  setSpiffs: (podId: string, frames: number, bytes: number) => void;
  noteHandled: () => void;
  onTelemetry: (podId: string, record: FreshFliteTelemetryRecord) => void;
}

export async function startIngestionWorker(mqttUrl: string, hooks: IngestionHooks): Promise<IngestionWorker> {
  const client = mqtt.connect(mqttUrl, {
    clientId: "freshflite-ingestion",
    protocolVersion: 4,
    reconnectPeriod: 0,
    clean: true,
    connectTimeout: 5000,
  });
  client.on("error", (error) => {
    console.error("Ingestion MQTT client error", error);
  });

  await waitForConnect(client);
  await new Promise<void>((resolve, reject) => {
    client.subscribe(
      ["freshflite/v1/pods/+/ping", "freshflite/v1/pods/+/radio-status", "freshflite/v1/pods/+/burst"],
      { qos: 1 },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );
  });

  let chain: Promise<void> = Promise.resolve();
  client.on("message", (topic, payload) => {
    const bytes = Uint8Array.from(payload);
    chain = chain
      .then(() => handleMessage(topic, bytes, hooks))
      .catch((error: unknown) => {
        console.error("Ingestion failed", error);
      })
      .finally(() => {
        hooks.noteHandled();
      });
  });

  return {
    close(): Promise<void> {
      return new Promise((resolve) => {
        client.end(true, {}, () => {
          resolve();
        });
      });
    },
  };
}

async function handleMessage(topic: string, payload: Uint8Array, hooks: IngestionHooks): Promise<void> {
  const match = TOPIC_PATTERN.exec(topic);
  const podId = match?.[1];
  const kind = match?.[2];
  if (podId === undefined || kind === undefined) {
    return;
  }

  if (kind === "radio-status") {
    const text = Buffer.from(payload).toString("utf8").trim();
    if (text === "AT+CPOWD=1") {
      hooks.setRadio(podId, "ICAO_SILENT_RADIO_OFF");
      const manifest = resolveManifest(podId, hooks);
      if (manifest !== undefined) {
        const alert = alertForRadioShutdown(podId, manifest.flightNumber);
        if (alert !== null) {
          hooks.dispatcher.enqueue(alert);
        }
      }
    }
    return;
  }

  if (kind === "ping") {
    await ingestPing(podId, topic, payload, hooks);
    return;
  }

  await ingestBurst(podId, topic, payload, hooks);
}

async function ingestPing(podId: string, topic: string, payload: Uint8Array, hooks: IngestionHooks): Promise<void> {
  try {
    const record = decodeRecord(payload);
    acceptRecord(podId, record, payload, hooks);
    hooks.setRadio(podId, "ONLINE_4G");
  } catch (error: unknown) {
    if (error instanceof IntegrityError && error.message.includes("CRC32")) {
      audit(hooks, "CRC32_MISMATCH", podId, topic, error.message);
      return;
    }
    throw error;
  }
}

async function ingestBurst(podId: string, topic: string, payload: Uint8Array, hooks: IngestionHooks): Promise<void> {
  const split = splitBurst(payload);
  if (split === null) {
    audit(hooks, "CRC32_MISMATCH", podId, topic, `Burst length ${String(payload.byteLength)} is not a 17-byte stream`);
    return;
  }

  if (split.signature !== null) {
    const registered = hooks.lookupPod(podId);
    const publicKey = registered?.publicKey ?? null;
    const signatureOk =
      publicKey !== null && verify(null, Buffer.from(split.frames), publicKey, Buffer.from(split.signature));
    if (!signatureOk) {
      audit(hooks, "SIGNATURE_INVALID", podId, topic, "Ed25519 burst trailer did not verify");
      return;
    }
    const manifest = registered?.manifest;
    if (manifest !== undefined) {
      hooks.store.sealManifest(manifest.manifestId, Buffer.from(split.signature).toString("hex"), "CLEARED");
    }
  }

  const records = decodeBurstFrames(split.frames, podId, topic, hooks);
  for (const sample of records) {
    acceptRecord(podId, sample.record, sample.frame, hooks);
  }

  hooks.setSpiffs(podId, records.length, records.length * PACKET_BYTE_LENGTH);
  hooks.setRadio(podId, "BURST_SYNC_COMPLETE");

  const manifest = resolveManifest(podId, hooks);
  if (manifest === undefined) {
    return;
  }
  const stored = hooks.store.list(podId).map((row) => row.record);
  if (stored.length === 0) {
    return;
  }
  const report = evaluateThermalSLA(stored, manifest.slaMinC, manifest.slaMaxC);
  const clearance = alertForClearance(podId, manifest.flightNumber, records.length, report.thermalIntegrityScorePct);
  if (clearance !== null) {
    hooks.dispatcher.enqueue(clearance);
  }
}

function decodeBurstFrames(
  frames: Uint8Array,
  podId: string,
  topic: string,
  hooks: IngestionHooks,
): { record: FreshFliteTelemetryRecord; frame: Uint8Array }[] {
  try {
    return decodeBurstStream(frames).map((record, index) => {
      const start = index * PACKET_BYTE_LENGTH;
      return { record, frame: frames.subarray(start, start + PACKET_BYTE_LENGTH) };
    });
  } catch (error: unknown) {
    if (!(error instanceof IntegrityError)) {
      throw error;
    }
  }

  const decoded: { record: FreshFliteTelemetryRecord; frame: Uint8Array }[] = [];
  const frameCount = Math.floor(frames.byteLength / PACKET_BYTE_LENGTH);
  for (let index = 0; index < frameCount; index += 1) {
    const start = index * PACKET_BYTE_LENGTH;
    const frame = frames.subarray(start, start + PACKET_BYTE_LENGTH);
    try {
      decoded.push({ record: decodeRecord(frame), frame });
    } catch (frameError: unknown) {
      if (frameError instanceof IntegrityError && frameError.message.includes("CRC32")) {
        audit(hooks, "CRC32_MISMATCH", podId, topic, frameError.message);
        continue;
      }
      throw frameError;
    }
  }
  return decoded;
}

function acceptRecord(
  podId: string,
  record: FreshFliteTelemetryRecord,
  raw: Uint8Array,
  hooks: IngestionHooks,
): void {
  const manifest = resolveManifest(podId, hooks);
  if (manifest === undefined) {
    throw new Error(`No manifest registered for pod ${podId}`);
  }
  const frame = Uint8Array.from(raw);
  const inserted = hooks.store.insert(toStoredRow(podId, manifest, record, frame));
  if (!inserted) {
    return;
  }
  const alert = alertForFrame(podId, manifest.flightNumber, record);
  if (alert !== null) {
    hooks.dispatcher.enqueue(alert);
  }
  hooks.onTelemetry(podId, record);
}

function resolveManifest(podId: string, hooks: IngestionHooks): CargoManifest | undefined {
  return hooks.lookupPod(podId)?.manifest ?? manifestForPod(podId);
}

function splitBurst(payload: Uint8Array): { frames: Uint8Array; signature: Uint8Array | null } | null {
  if (payload.byteLength > 64 && (payload.byteLength - 64) % PACKET_BYTE_LENGTH === 0) {
    const frameBytes = payload.byteLength - 64;
    return {
      frames: payload.subarray(0, frameBytes),
      signature: payload.subarray(frameBytes),
    };
  }
  if (payload.byteLength > 0 && payload.byteLength % PACKET_BYTE_LENGTH === 0) {
    return { frames: payload, signature: null };
  }
  return null;
}

function audit(
  hooks: IngestionHooks,
  reason: AuditReason,
  podId: string,
  topic: string,
  detail: string,
): void {
  const entry: SecurityAuditEntry = {
    reason,
    podId,
    topic,
    detail,
    at: new Date().toISOString(),
  };
  hooks.securityAuditLog.push(entry);
  hooks.dispatcher.emit({ type: "security", entry });
  console.warn(`[security_audit_log] ${reason} ${topic}: ${detail}`);
}

function waitForConnect(client: MqttClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error): void => {
      reject(error);
    };
    client.once("connect", () => {
      client.off("error", fail);
      resolve();
    });
    client.once("error", fail);
  });
}
