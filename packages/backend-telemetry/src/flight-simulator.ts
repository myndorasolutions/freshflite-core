import { sign } from "node:crypto";
import mqtt, { type MqttClient } from "mqtt";
import {
  FlightState,
  TamperStatus,
  encodeRecord,
  generatePodKeyPair,
  generateSimulatedFlightQI0412,
  type FreshFliteWireFields,
} from "@freshflite/shared-schema";
import { privateKeyFromPkcs8, publicKeyFromRaw } from "./ed25519-keys.js";
import { POD_QI0412, POD_QI0419, QI0419_MANIFEST } from "./pod-profiles.js";
import type { RegisteredPod, Scenario, SimulatorMode } from "./types.js";

export interface SpiffsObservation {
  podId: string;
  frames: number;
  bytes: number;
  connected: boolean;
}

export interface SimulationContext {
  mqttUrl: string;
  mode: SimulatorMode;
  isClientConnected: (clientId: string) => boolean;
  registerPod: (pod: RegisteredPod) => void;
  onSpiffs: (observation: SpiffsObservation) => void;
  getHandled: () => number;
  waitForHandled: (target: number) => Promise<void>;
  waitForStored: (podId: string, count: number) => Promise<void>;
}

const GROUND_PING_COUNT = 33;
const SPIFFS_FRAME_COUNT = 62;

export async function runScenario(scenario: Scenario, ctx: SimulationContext): Promise<void> {
  if (scenario === "QI-0419") {
    await runBreach(ctx);
    return;
  }
  await runQi0412(ctx);
}

async function runQi0412(ctx: SimulationContext): Promise<void> {
  const flight = generateSimulatedFlightQI0412();
  const takeoff = flight.records[34];
  const touchdown = flight.records[94];
  if (flight.records.length !== 95 || takeoff?.peakAccelMg !== 1380 || touchdown?.peakAccelMg !== 1010) {
    throw new Error("QI-0412 voyage no longer matches the 95-frame silent-mode contract");
  }

  const keys = await generatePodKeyPair();
  const privateKey = privateKeyFromPkcs8(keys.privateKey);
  const publicKey = publicKeyFromRaw(keys.publicKey);
  ctx.registerPod({
    podId: POD_QI0412,
    manifest: flight.manifest,
    publicKey,
    publicKeyHex: Buffer.from(keys.publicKey).toString("hex"),
  });

  const groundGap = ctx.mode === "demo" ? 50 : 0;
  const bufferGap = ctx.mode === "demo" ? 50 : 0;
  const client = await connectPod(ctx.mqttUrl, POD_QI0412);

  for (const record of flight.records.slice(0, GROUND_PING_COUNT)) {
    const mark = ctx.getHandled();
    await publish(client, `freshflite/v1/pods/${POD_QI0412}/ping`, encodeRecord(record));
    await ctx.waitForHandled(mark + 1);
    if (groundGap > 0) {
      await delay(groundGap);
    }
  }
  await ctx.waitForStored(POD_QI0412, GROUND_PING_COUNT);

  const radioMark = ctx.getHandled();
  await publish(client, `freshflite/v1/pods/${POD_QI0412}/radio-status`, Buffer.from("AT+CPOWD=1"));
  await ctx.waitForHandled(radioMark + 1);
  await disconnect(client);
  await waitUntil(() => !ctx.isClientConnected(POD_QI0412), "pod MQTT session stayed up after AT+CPOWD=1");

  const spiffsFlashBuffer: Uint8Array[] = [];
  for (const record of flight.records.slice(GROUND_PING_COUNT)) {
    spiffsFlashBuffer.push(encodeRecord(record));
    const connected = ctx.isClientConnected(POD_QI0412);
    ctx.onSpiffs({
      podId: POD_QI0412,
      frames: spiffsFlashBuffer.length,
      bytes: spiffsFlashBuffer.length * 17,
      connected,
    });
    if (bufferGap > 0) {
      await delay(bufferGap);
    }
  }
  if (spiffsFlashBuffer.length !== SPIFFS_FRAME_COUNT) {
    throw new Error(`SPIFFS buffer is ${String(spiffsFlashBuffer.length)} frames, expected 62`);
  }

  if (ctx.mode === "demo") {
    await delay(1000);
  }

  const burst = concat(spiffsFlashBuffer);
  const signature = sign(null, burst, privateKey);
  const payload = concat([burst, new Uint8Array(signature)]);
  const wake = await connectPod(ctx.mqttUrl, POD_QI0412);
  const burstMark = ctx.getHandled();
  await publish(wake, `freshflite/v1/pods/${POD_QI0412}/burst`, payload);
  await ctx.waitForHandled(burstMark + 1);
  await disconnect(wake);
}

async function runBreach(ctx: SimulationContext): Promise<void> {
  ctx.registerPod({
    podId: POD_QI0419,
    manifest: QI0419_MANIFEST,
    publicKey: null,
    publicKeyHex: "",
  });
  const frame: FreshFliteWireFields = {
    unixTimestamp: Math.floor(Date.UTC(2026, 9, 14, 11, 20, 0) / 1000),
    temperatureCenti: 640,
    humidityCenti: 8800,
    batterySocPct: 91,
    tamperStatus: TamperStatus.LID_BREACH,
    flightState: FlightState.GROUND_PREFLIGHT,
    peakAccelMg: 140,
  };
  const client = await connectPod(ctx.mqttUrl, POD_QI0419);
  const mark = ctx.getHandled();
  await publish(client, `freshflite/v1/pods/${POD_QI0419}/ping`, encodeRecord(frame));
  await ctx.waitForHandled(mark + 1);
  await disconnect(client);
}

function connectPod(mqttUrl: string, clientId: string): Promise<MqttClient> {
  const client = mqtt.connect(mqttUrl, {
    clientId,
    protocolVersion: 4,
    reconnectPeriod: 0,
    clean: true,
    connectTimeout: 5000,
  });
  client.on("error", (error) => {
    console.error(`Pod ${clientId} MQTT error`, error);
  });
  return new Promise((resolve, reject) => {
    const fail = (error: Error): void => {
      reject(error);
    };
    client.once("connect", () => {
      client.off("error", fail);
      resolve(client);
    });
    client.once("error", fail);
  });
}

function publish(client: MqttClient, topic: string, payload: Uint8Array | Buffer): Promise<void> {
  const body = Buffer.from(payload);
  return new Promise((resolve, reject) => {
    client.publish(topic, body, { qos: 1 }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function disconnect(client: MqttClient): Promise<void> {
  return new Promise((resolve) => {
    if (!client.connected) {
      client.end(true);
      resolve();
      return;
    }
    client.once("close", () => {
      resolve();
    });
    client.end(true);
  });
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

async function waitUntil(predicate: () => boolean, timeoutMessage: string): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 3000) {
      throw new Error(timeoutMessage);
    }
    await delay(10);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
