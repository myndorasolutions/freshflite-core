import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PACKET_BYTE_LENGTH, TamperStatus, encodeRecord } from "@freshflite/shared-schema";
import {
  LID_OPEN_LUX,
  LID_SEALED_LUX,
  SHIPPER_BARCODE,
  companionSignatureMatches,
  decodeDiagnostic,
  findCompanionManifest,
  lidAllowsSeal,
  lidBlocksSeal,
  saveCompanionManifest,
  sealCompanionManifest,
} from "./lib/companion-packout";

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

function memoryStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void } {
  const store = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
  };
}

async function main(): Promise<void> {
  const sealedDiag = decodeDiagnostic(false);
  const openDiag = decodeDiagnostic(true);
  const sealedFrame = encodeRecord(sealedDiag);
  record(
    "17-byte BLE diagnostic",
    sealedFrame.byteLength === PACKET_BYTE_LENGTH &&
      sealedDiag.temperatureC === -1.45 &&
      sealedDiag.humidityPct === 84.5 &&
      sealedDiag.batterySocPct === 98 &&
      sealedDiag.peakAccelMg === 1000 &&
      sealedDiag.tamperStatus === TamperStatus.OK,
    `${sealedDiag.temperatureC.toFixed(2)}°C, ${sealedDiag.humidityPct.toFixed(2)}% RH, ${String(sealedDiag.batterySocPct)}% SoC, ${String(sealedDiag.peakAccelMg)} mG`,
  );
  record(
    "Open lid tamper byte",
    openDiag.tamperStatus === TamperStatus.LID_BREACH,
    `tamper 0x${openDiag.tamperStatus.toString(16).padStart(2, "0")} at ${String(LID_OPEN_LUX)} lux`,
  );
  record(
    "TEMT6000 lid interlock",
    lidBlocksSeal(LID_OPEN_LUX) && !lidAllowsSeal(LID_OPEN_LUX) && lidAllowsSeal(LID_SEALED_LUX) && !lidBlocksSeal(LID_SEALED_LUX),
    `block >200 lux (${String(LID_OPEN_LUX)}), approve <50 lux (${String(LID_SEALED_LUX)})`,
  );

  let openBlocked = false;
  try {
    await sealCompanionManifest(
      {
        podId: "FF-S3-01A",
        origin: "Oron Beach Aggregation Cluster #3",
        species: "Jumbo Tiger Prawns (Penaeus monodon)",
        weightKg: 38.5,
        flightNumber: "QI-0412",
        barcode: SHIPPER_BARCODE,
      },
      true,
    );
  } catch {
    openBlocked = true;
  }
  record("Open lid blocks Step 3", openBlocked, openBlocked ? "seal refused while the lid is open" : "open lid was sealed");

  const manifest = await sealCompanionManifest(
    {
      podId: "FF-S3-01A",
      origin: "Oron Beach Aggregation Cluster #3",
      species: "Jumbo Tiger Prawns (Penaeus monodon)",
      weightKg: 38.5,
      flightNumber: "QI-0412",
      barcode: SHIPPER_BARCODE,
    },
    false,
  );
  const storage = memoryStorage();
  saveCompanionManifest(manifest, storage);
  const loaded = findCompanionManifest(manifest.manifestId, storage);
  const signatureOk = await companionSignatureMatches(manifest);
  const mutatedOk =
    loaded === undefined
      ? true
      : await companionSignatureMatches({
          ...loaded,
          payload: { ...loaded.payload, weightKg: loaded.payload.weightKg + 1 },
        });
  record(
    "Ed25519 companion seal",
    signatureOk && !mutatedOk && loaded?.barcode === SHIPPER_BARCODE && loaded.manifestId.length > 0,
    `${manifest.manifestId} verified, mutated weight rejected`,
  );

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  try {
    execFileSync("npm", ["run", "build:cf"], {
      cwd: root,
      stdio: "inherit",
      shell: true,
      env: process.env,
    });
    record("Cloudflare static build", true, "npm run build:cf completed");
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "build:cf failed";
    record("Cloudflare static build", false, detail);
  }

  const outDir = path.join(root, "packages", "web-portal", "out");
  const expected = [
    "index.html",
    path.join("companion", "index.html"),
    path.join("trace", "FF-MAN-QI0412-20261014", "index.html"),
  ];
  for (const relative of expected) {
    const present = existsSync(path.join(outDir, relative));
    record(`Export ${relative.replaceAll("\\", "/")}`, present, present ? "present in out/" : "missing from static export");
  }

  const columns = [
    { key: "check" as const, header: "Check", width: 32 },
    { key: "result" as const, header: "Result", width: 8 },
    { key: "detail" as const, header: "Detail", width: 72 },
  ];
  const line = columns.map((column) => "-".repeat(column.width)).join("-+-");
  console.log("");
  console.log("FreshFlite Sprint 4 Verification — Companion and Cloudflare Pages");
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
      ? "Sprint 4 verification FAILED."
      : "Sprint 4 verification PASSED. Companion packout, Ed25519 seals, and the Cloudflare static export are live.",
  );
  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
