import {
  TamperStatus,
  canonicalSummaryBytes,
  decodeBurstStream,
  publicKeyFromRawBase64,
  verifyManifestSignature,
} from "@freshflite/shared-schema";
import { auditManifest, getFleetRecord, listManifestSummaries } from "./lib/fleet-data";

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

const summaries = listManifestSummaries();
record("Manifest registry", summaries.length === 3, `${String(summaries.length)} manifests loaded`);

const flagship = getFleetRecord("FF-MAN-QI0412-20261014");
const exportGrade = getFleetRecord("FF-MAN-QI0208-20261014");
const breached = getFleetRecord("FF-MAN-QI0419-20261014");

async function assertDecoded(id: string, flight: ReturnType<typeof getFleetRecord>): Promise<boolean> {
  if (flight === undefined) {
    record(id, false, "missing");
    return false;
  }
  try {
    const decoded = decodeBurstStream(flight.burst);
    const key = publicKeyFromRawBase64(flight.publicKeyBase64);
    const signatureOk = await verifyManifestSignature(
      key,
      canonicalSummaryBytes(flight.summary),
      flight.signature,
    );
    const lengthOk = decoded.length === flight.records.length && flight.burst.byteLength === decoded.length * 17;
    record(
      `${flight.manifest.flightNumber} codec + seal`,
      lengthOk && signatureOk,
      `${String(flight.burst.byteLength)} bytes, ${flight.sla.thermalIntegrityScorePct.toFixed(1)}% SLA, signature ${signatureOk ? "valid" : "invalid"}`,
    );
    return lengthOk && signatureOk;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "decode failed";
    record(id, false, message);
    return false;
  }
}

async function main(): Promise<void> {
await assertDecoded("QI-0412", flagship);
await assertDecoded("QI-0208", exportGrade);
await assertDecoded("QI-0419", breached);

if (flagship !== undefined) {
  const takeoff = flagship.records[34];
  record(
    "QI-0412 compliance",
    flagship.burst.byteLength === 1615 &&
      flagship.records.length === 95 &&
      flagship.sla.thermalIntegrityScorePct === 100 &&
      flagship.sla.excursionCount === 0 &&
      flagship.sla.icaoSilentModeEngagedOnHighG &&
      takeoff?.peakAccelMg === 1380 &&
      flagship.podId === "FF-S3-01A" &&
      flagship.manifest.species.startsWith("Jumbo Tiger Prawns"),
    "100.0%, 0 excursions, 1,615 bytes, 1.38g silent takeoff",
  );
}

if (exportGrade !== undefined) {
  record(
    "QI-0208 compliance",
    exportGrade.sla.thermalIntegrityScorePct === 99.4 &&
      exportGrade.sla.excursionCount === 1 &&
      exportGrade.manifest.destinationAirport === "ABV" &&
      exportGrade.manifest.aircraftType === "A220-300" &&
      exportGrade.sla.icaoSilentModeEngagedOnHighG &&
      exportGrade.registration === "5N-CDA",
    `${exportGrade.sla.thermalIntegrityScorePct.toFixed(1)}% on ${String(exportGrade.records.length)} frames`,
  );
}

if (breached !== undefined) {
  const lid = breached.records.some((sample) => sample.tamperStatus === TamperStatus.LID_BREACH);
  const maxCenti = Math.max(...breached.records.map((sample) => sample.temperatureCenti));
  record(
    "QI-0419 breach",
    lid &&
      maxCenti === 640 &&
      breached.sla.thermalIntegrityScorePct === 78.5 &&
      breached.clearance === "REJECTED" &&
      breached.sla.icaoSilentModeEngagedOnHighG &&
      breached.podId === "FF-S3-03C",
    `LID_BREACH, max 6.40°C, ${breached.sla.thermalIntegrityScorePct.toFixed(1)}% compliance`,
  );
}

const flagshipAudit = await auditManifest("FF-MAN-QI0412-20261014");
const breachAudit = await auditManifest("FF-MAN-QI0419-20261014");
record(
  "Live audit copy",
  flagshipAudit?.verified === true &&
    flagshipAudit.message === "Immutable Record Verified — Zero Post-Harvest Tampering" &&
    breachAudit?.verified === true &&
    breachAudit.breached === true,
  flagshipAudit?.message ?? "flagship audit missing",
);

if (flagship !== undefined) {
  const key = publicKeyFromRawBase64(flagship.publicKeyBase64);
  const mutated = await verifyManifestSignature(
    key,
    canonicalSummaryBytes({ ...flagship.summary, recordCount: flagship.summary.recordCount + 1 }),
    flagship.signature,
  );
  record("Mutated summary rejected", mutated === false, "Ed25519 rejects a changed record count");
}

const columns = [
  { key: "check" as const, header: "Check", width: 28 },
  { key: "result" as const, header: "Result", width: 8 },
  { key: "detail" as const, header: "Detail", width: 72 },
];
const line = columns.map((column) => "-".repeat(column.width)).join("-+-");
console.log("");
console.log("FreshFlite Sprint 2 Verification — Dispatch registry");
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
    ? "Sprint 2 verification FAILED."
    : "Sprint 2 verification PASSED. Three sealed manifests, binary bursts, and Ed25519 audits are live.",
);

if (failed) {
  process.exitCode = 1;
}
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
