import mqtt, { type MqttClient } from "mqtt";
import { encodeRecord, generateSimulatedFlightQI0412 } from "@freshflite/shared-schema";
import { createTelemetryEngine } from "./engine.js";
import { BREACH_ALERT, CLEARANCE_ALERT, ICAO_SILENT_ALERT } from "./sla-monitor.js";
import { startHttpServer } from "./server.js";
import { POD_QI0412 } from "./pod-profiles.js";

interface ResultRow {
  check: string;
  result: "PASS" | "FAIL";
  detail: string;
}

const rows: ResultRow[] = [];
let failed = false;

function record(check: string, ok: boolean, detail: string): void {
  rows.push({ check, result: ok ? "PASS" : "FAIL", detail });
  if (!ok) {
    failed = true;
  }
}

function pad(value: string, width: number): string {
  if (value.length >= width) {
    return value.slice(0, width);
  }
  return value + " ".repeat(width - value.length);
}

async function main(): Promise<void> {
  const engine = await createTelemetryEngine({ mqttPort: 0, useTimescale: false });
  const http = await startHttpServer(engine, 0);
  let silentDisconnected = true;
  let sawSilentBuffer = false;

  try {
    const health = await fetch(`http://127.0.0.1:${String(http.port)}/api/health`);
    const healthBody = (await health.json()) as { broker?: string; timescale?: string; activePods?: number };
    record(
      "Health endpoint",
      health.ok && healthBody.broker === "up" && healthBody.timescale === "memory" && healthBody.activePods === 0,
      `broker ${healthBody.broker ?? "-"}, store ${healthBody.timescale ?? "-"}, pods ${String(healthBody.activePods ?? -1)}`,
    );

    await engine.run("QI-0412", "step", (observation) => {
      if (observation.connected) {
        silentDisconnected = false;
      }
      if (observation.frames === 62 && observation.bytes === 1054 && !observation.connected) {
        sawSilentBuffer = true;
      }
    });

    const flight = generateSimulatedFlightQI0412();
    const stored = engine.snapshot().records.filter((row) => row.podId === POD_QI0412);
    const ground = flight.records.slice(0, 33);
    const groundOk = ground.every((sample, index) => {
      const row = stored[index];
      return (
        row !== undefined &&
        row.unixTimestamp === sample.unixTimestamp &&
        row.temperatureCenti === sample.temperatureCenti &&
        row.humidityCenti === sample.humidityCenti &&
        row.peakAccelMg === sample.peakAccelMg &&
        row.flightState === sample.flightState &&
        row.crc32Checksum === sample.checksumCrc32 &&
        row.raw17bHex === Buffer.from(encodeRecord(sample)).toString("hex")
      );
    });
    record("Ground MQTT pings", groundOk && ground.length === 33, `${String(ground.length)} live 17-byte frames`);

    record(
      "ICAO silent disconnect",
      silentDisconnected && sawSilentBuffer,
      silentDisconnected ? "MQTT session down while SPIFFS held 62 frames / 1,054 bytes" : "pod stayed connected in silent mode",
    );

    const voyageOk =
      stored.length === 95 &&
      flight.records.every((sample, index) => {
        const row = stored[index];
        return row !== undefined && row.unixTimestamp === sample.unixTimestamp && row.crc32Checksum === sample.checksumCrc32;
      });
    record("Post-touchdown burst", voyageOk, `${String(stored.length)} unique voyage frames unpacked`);

    const beforeCorrupt = engine.snapshot().records.length;
    const sample = flight.records[0];
    if (sample === undefined) {
      throw new Error("QI-0412 voyage is empty");
    }
    const corrupt = Uint8Array.from(encodeRecord(sample));
    const crcByte = corrupt[16] ?? 0;
    corrupt[16] = crcByte ^ 0xff;
    const mark = engine.getHandled();
    const spoof = await connect(engine.mqttUrl);
    await publish(spoof, `freshflite/v1/pods/${POD_QI0412}/ping`, corrupt);
    await engine.waitForHandled(mark + 1);
    await disconnect(spoof);

    const after = engine.snapshot();
    const audit = after.securityAuditLog.some((entry) => entry.reason === "CRC32_MISMATCH");
    record(
      "CRC32 rejection",
      audit && after.records.length === beforeCorrupt,
      audit ? "corrupted 17-byte frame logged as CRC32_MISMATCH" : "security_audit_log missing CRC32_MISMATCH",
    );

    const icao = after.dispatchNotifications.some((item) => item.message === ICAO_SILENT_ALERT);
    const clearance = after.dispatchNotifications.some((item) => item.message === CLEARANCE_ALERT);
    record(
      "WhatsApp/SMS flight alerts",
      icao && clearance,
      `ICAO ${icao ? "sent" : "missing"}, clearance ${clearance ? "sent" : "missing"}`,
    );

    await engine.run("QI-0419", "step");
    const breach = engine.snapshot().dispatchNotifications.some((item) => item.message === BREACH_ALERT);
    record("SLA breach alert", breach, breach ? "QI-0419 lid breach and +6.40°C queued" : "critical alert missing");

    const stateResponse = await fetch(`http://127.0.0.1:${String(http.port)}/api/telemetry/state`);
    const state = (await stateResponse.json()) as { pods?: Record<string, { radio?: string; spiffsFrames?: number }> };
    const pod = state.pods?.[POD_QI0412];
    record(
      "Telemetry state API",
      stateResponse.ok && pod?.radio === "BURST_SYNC_COMPLETE" && pod.spiffsFrames === 62,
      `radio ${pod?.radio ?? "-"}, SPIFFS ${String(pod?.spiffsFrames ?? 0)}`,
    );
  } finally {
    await http.close();
    await engine.close();
  }

  const columns = [
    { key: "check" as const, header: "Check", width: 28 },
    { key: "result" as const, header: "Result", width: 8 },
    { key: "detail" as const, header: "Detail", width: 78 },
  ];
  const line = columns.map((column) => "-".repeat(column.width)).join("-+-");
  console.log("");
  console.log("FreshFlite Sprint 3 Verification — MQTT ingestion");
  console.log(line);
  console.log(columns.map((column) => pad(column.header, column.width)).join(" | "));
  console.log(line);
  for (const row of rows) {
    console.log(columns.map((column) => pad(row[column.key], column.width)).join(" | "));
  }
  console.log(line);
  console.log("");
  console.log(
    failed
      ? "Sprint 3 verification FAILED."
      : "Sprint 3 verification PASSED. Binary MQTT ingestion, ICAO silence, burst sync, and dispatch alerts are live.",
  );
  if (failed) {
    process.exitCode = 1;
  }
}

function connect(mqttUrl: string): Promise<MqttClient> {
  const client = mqtt.connect(mqttUrl, {
    clientId: "spoof-probe",
    protocolVersion: 4,
    reconnectPeriod: 0,
    clean: true,
  });
  client.on("error", () => undefined);
  return new Promise((resolve, reject) => {
    client.once("connect", () => {
      resolve(client);
    });
    client.once("error", reject);
  });
}

function publish(client: MqttClient, topic: string, payload: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    client.publish(topic, Buffer.from(payload), { qos: 1 }, (error) => {
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
    client.end(true, {}, () => {
      resolve();
    });
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
