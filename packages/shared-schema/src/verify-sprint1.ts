import { PACKET_BYTE_LENGTH, decodeRecord, encodeBurstStream, encodeRecord, evaluateThermalSLA } from "./codec.js";
import {
  canonicalSummaryBytes,
  generatePodKeyPair,
  publicKeyFromRawBase64,
  signManifestSummary,
  verifyManifestSignature,
} from "./crypto.js";
import { buildSealSummary, generateSimulatedFlightQI0412 } from "./demo-flight.js";
import { FlightState, IntegrityError, TamperStatus } from "./types.js";
import type { FreshFliteWireFields } from "./types.js";

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

function printTable(title: string, tableRows: readonly ResultRow[]): void {
  const columns = [
    { key: "check" as const, header: "Check", width: 28 },
    { key: "result" as const, header: "Result", width: 8 },
    { key: "detail" as const, header: "Detail", width: 62 },
  ];
  const line = columns.map((column) => "-".repeat(column.width)).join("-+-");
  const header = columns.map((column) => pad(column.header, column.width)).join(" | ");
  console.log("");
  console.log(title);
  console.log(line);
  console.log(header);
  console.log(line);
  for (const row of tableRows) {
    const cells = columns.map((column) => pad(row[column.key], column.width));
    console.log(cells.join(" | "));
  }
  console.log(line);
  console.log("");
}

const probe: FreshFliteWireFields = {
  unixTimestamp: 1_760_421_600,
  temperatureCenti: -150,
  humidityCenti: 8520,
  batterySocPct: 91,
  tamperStatus: TamperStatus.OK,
  flightState: FlightState.IN_FLIGHT_SILENT,
  peakAccelMg: 1320,
};

const frame = encodeRecord(probe);
let roundTripOk = false;
try {
  const decoded = decodeRecord(frame);
  roundTripOk =
    frame.byteLength === PACKET_BYTE_LENGTH &&
    decoded.temperatureCenti === -150 &&
    decoded.humidityCenti === 8520 &&
    decoded.peakAccelMg === 1320;
} catch {
  roundTripOk = false;
}
record(
  "Single 17-byte frame",
  roundTripOk,
  `byteLength ${String(frame.byteLength)} LE round-trip of -1.50°C / 85.20% RH / 1320 mG`,
);

const corrupted = new Uint8Array(frame);
const flippedSource = corrupted[4] ?? 0;
corrupted[4] = flippedSource ^ 0x01;
let tamperRejected = false;
try {
  decodeRecord(corrupted);
} catch (error: unknown) {
  tamperRejected = error instanceof IntegrityError;
}
record(
  "CRC32 tamper detector",
  tamperRejected,
  tamperRejected ? "1-bit flip in bytes 0..12 rejected (IntegrityError)" : "corrupted frame was accepted",
);

const flight = generateSimulatedFlightQI0412();
const burst = encodeBurstStream(flight.records);
const jsonBytes = new TextEncoder().encode(JSON.stringify(flight.records)).byteLength;
const savingsPct = ((jsonBytes - burst.byteLength) / jsonBytes) * 100;
const burstOk = flight.records.length === 95 && burst.byteLength === 1615;
record(
  "QI-0412 SPIFFS burst",
  burstOk,
  `${String(burst.byteLength)} bytes binary vs ${String(jsonBytes)} bytes JSON (${savingsPct.toFixed(2)}% saved)`,
);

const sla = evaluateThermalSLA(flight.records);
const summary = buildSealSummary(flight, sla, burst);

async function finish(): Promise<void> {
  const podKeys = await generatePodKeyPair();
  const summaryBytes = canonicalSummaryBytes(summary);
  const signature = await signManifestSummary(podKeys.privateKey, summaryBytes);
  const restoredKey = publicKeyFromRawBase64(podKeys.publicKeyBase64);
  const signatureOk = await verifyManifestSignature(restoredKey, summaryBytes, signature);
  record(
    "Ed25519 FreshTrace seal",
    signatureOk,
    signatureOk ? `verified ${signature.slice(0, 22)}…` : "signature verification failed",
  );

  const slaOk =
    sla.thermalIntegrityScorePct === 100 &&
    sla.excursionCount === 0 &&
    sla.icaoSilentModeEngagedOnHighG &&
    sla.highGSampleCount === 1;
  record(
    "Thermal SLA + ICAO silent",
    slaOk,
    `${sla.thermalIntegrityScorePct.toFixed(1)}% integrity, ${String(sla.excursionCount)} excursions, ${sla.minTemperatureC.toFixed(2)}°C..${sla.maxTemperatureC.toFixed(2)}°C, silent=${String(sla.icaoSilentModeEngagedOnHighG)}`,
  );

  printTable("FreshFlite Sprint 1 Verification — Ibom Air QI-0412 (CRJ-900, UYO → LOS)", rows);
  console.log(
    `Manifest ${flight.manifest.manifestId} | ${flight.manifest.cooperativeOrigin} | ${flight.manifest.species} | pod ${flight.manifest.podUuid}`,
  );
  console.log(
    failed
      ? "Sprint 1 verification FAILED."
      : "Sprint 1 verification PASSED. 17-byte contract, CRC32, burst stream, and Ed25519 seal are live.",
  );

  if (failed) {
    process.exitCode = 1;
  }
}

finish().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
