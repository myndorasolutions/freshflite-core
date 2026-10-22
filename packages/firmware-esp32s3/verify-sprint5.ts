import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface ResultRow {
  check: string;
  result: "PASS" | "FAIL" | "SKIP";
  detail: string;
}

const firmwareRoot = dirname(fileURLToPath(import.meta.url));
const rows: ResultRow[] = [];
let failed = false;

function record(check: string, ok: boolean, detail: string): void {
  rows.push({ check, result: ok ? "PASS" : "FAIL", detail });
  if (!ok) {
    failed = true;
  }
}

function skip(check: string, detail: string): void {
  rows.push({ check, result: "SKIP", detail });
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
    { key: "detail" as const, header: "Detail", width: 96 },
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

function readText(relativePath: string): string {
  return readFileSync(join(firmwareRoot, relativePath), "utf8");
}

function hasAssignment(source: string, name: string, value: string): boolean {
  const pattern = new RegExp(`${name}\\s*=\\s*${value}\\b`);
  return pattern.test(source);
}

function findTool(name: string): string | null {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(finder, [name], { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  const line = result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line ?? null;
}

function tail(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= 160) {
    return compact;
  }
  return compact.slice(compact.length - 160);
}

const pins = readText("include/freshflite_pins.h");
const pinOk =
  hasAssignment(pins, "PIN_I2C_SDA", "8") &&
  hasAssignment(pins, "PIN_I2C_SCL", "9") &&
  hasAssignment(pins, "SHT31_I2C_ADDR", "0x44") &&
  hasAssignment(pins, "LIS3DH_I2C_ADDR", "0x18") &&
  hasAssignment(pins, "PIN_LIS3DH_INT1", "10") &&
  hasAssignment(pins, "PIN_SIM7600_RXD", "17") &&
  hasAssignment(pins, "PIN_SIM7600_TXD", "18") &&
  hasAssignment(pins, "PIN_SIM7600_PWRKEY", "21") &&
  hasAssignment(pins, "PIN_TEMT6000_ADC", "4") &&
  hasAssignment(pins, "LUX_SEALED_BELOW", "50") &&
  hasAssignment(pins, "LUX_BREACH_ABOVE", "200");
record(
  "Section 3.1 pins",
  pinOk,
  "SDA 8, SCL 9, SHT31 0x44, LIS3DH 0x18, INT1 10, UART 17/18, PWRKEY 21, ADC 4, lux 50/200",
);

const packet = readText("include/freshflite_packet.h");
const packetOk =
  /static_assert\s*\(\s*sizeof\s*\(\s*FreshFliteRecord\s*\)\s*==\s*17\s*,/.test(packet) &&
  packet.includes("0xEDB88320") &&
  !/Arduino\.h/.test(packet);
record("17-byte packet header", packetOk, "host-clean static_assert(sizeof == 17), reflected poly 0xEDB88320");

const ini = readText("platformio.ini");
const iniOk =
  ini.includes("board = esp32-s3-devkitc-1") &&
  ini.includes("monitor_speed = 115200") &&
  ini.includes("board_build.flash_size = 16MB") &&
  ini.includes("board_build.partitions = default_16MB.csv") &&
  ini.includes("Adafruit SHT31 Library") &&
  ini.includes("Adafruit LIS3DH") &&
  ini.includes("knolleary/PubSubClient");
record("PlatformIO scaffold", iniOk, "esp32-s3-devkitc-1, 16MB SPIFFS partition, SHT31, LIS3DH, PubSubClient");

const guide = readText("BENCH_TESTING_GUIDE.md");
const guideOk = ["GPIO 8", "GPIO 9", "GPIO 17", "GPIO 18", "GPIO 21", "GPIO 4", "`P`", "`T`", "`B`", "`L`", "`S`", "115200", "3.3 V"].every(
  (needle) => guide.includes(needle),
);
record("Bench testing guide", guideOk, "breadboard table, 3.3 V crossover UART, and P/T/B/L/S at 115200");

async function verifyCodec(): Promise<void> {
  const { FlightState, PACKET_BYTE_LENGTH, TamperStatus, computeCrc32, decodeRecord, encodeRecord } = await import(
    "@freshflite/shared-schema"
  );

const probe = {
  unixTimestamp: 1_760_421_600,
  temperatureCenti: -150,
  humidityCenti: 8520,
  batterySocPct: 91,
  tamperStatus: TamperStatus.OK,
  flightState: FlightState.IN_FLIGHT_SILENT,
  peakAccelMg: 1320,
};
const typescriptFrame = encodeRecord(probe);
const typescriptHex = Buffer.from(typescriptFrame).toString("hex");
let roundTripOk = false;
try {
  const decoded = decodeRecord(typescriptFrame);
  roundTripOk =
    typescriptFrame.byteLength === PACKET_BYTE_LENGTH &&
    decoded.unixTimestamp === probe.unixTimestamp &&
    decoded.temperatureCenti === -150 &&
    decoded.humidityCenti === 8520 &&
    decoded.batterySocPct === 91 &&
    decoded.flightState === FlightState.IN_FLIGHT_SILENT &&
    decoded.peakAccelMg === 1320 &&
    decoded.checksumCrc32 === computeCrc32(typescriptFrame.subarray(0, 13));
} catch {
  roundTripOk = false;
}
record("Sprint 1 sample frame", roundTripOk, `${typescriptHex} decodes to -1.50 C / 85.20% RH / 1320 mG`);

const ascii = new TextEncoder().encode("123456789");
const asciiCrc = computeCrc32(ascii);
record("IEEE CRC32 check value", asciiCrc === 0xcbf43926, `ASCII 123456789 -> 0x${asciiCrc.toString(16).padStart(8, "0")}`);

function runHarness(compiler: string, label: string): void {
  const work = mkdtempSync(join(tmpdir(), "freshflite-sprint5-"));
  const executable = join(work, process.platform === "win32" ? "packet_harness.exe" : "packet_harness");
  try {
    const compiled = spawnSync(
      compiler,
      ["-std=c++17", "-I", join(firmwareRoot, "include"), join(firmwareRoot, "src/host/packet_harness.cpp"), "-o", executable],
      { encoding: "utf8" },
    );
    if (compiled.status !== 0) {
      record("Native frame parity", false, `${label} failed to compile: ${tail(compiled.stderr || compiled.stdout || "no compiler output")}`);
      return;
    }
    const ran = spawnSync(executable, [], { encoding: "utf8" });
    if (ran.status !== 0) {
      record("Native frame parity", false, `${label} harness exited ${String(ran.status)}: ${tail(ran.stderr || ran.stdout || "")}`);
      return;
    }
    const lines = (ran.stdout ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const hex = lines[0] ?? "";
    const crcLine = lines.find((line) => line.startsWith("crc32=")) ?? "";
    const nativeCrc = crcLine.slice("crc32=".length).toLowerCase();
    let nativeDecoded = false;
    if (/^[0-9a-f]{34}$/.test(hex)) {
      try {
        const decoded = decodeRecord(Uint8Array.from(Buffer.from(hex, "hex")));
        nativeDecoded =
          decoded.unixTimestamp === probe.unixTimestamp &&
          decoded.temperatureCenti === -150 &&
          decoded.humidityCenti === 8520 &&
          decoded.batterySocPct === 91 &&
          decoded.tamperStatus === TamperStatus.OK &&
          decoded.flightState === FlightState.IN_FLIGHT_SILENT &&
          decoded.peakAccelMg === 1320 &&
          decoded.checksumCrc32 === computeCrc32(typescriptFrame.subarray(0, 13));
      } catch {
        nativeDecoded = false;
      }
    }
    const ok = hex === typescriptHex && nativeCrc === "cbf43926" && nativeDecoded;
    record(
      "Native frame parity",
      ok,
      ok ? `${label} hex matches encodeRecord and CRC 0xCBF43926` : `${label} hex ${hex || "(none)"} crc ${nativeCrc || "(none)"}`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function runPioHarness(pio: string): void {
  const command = pio.toLowerCase().endsWith(".cmd") ? "cmd.exe" : pio;
  const args = pio.toLowerCase().endsWith(".cmd")
    ? ["/d", "/s", "/c", pio, "run", "-e", "host-packet"]
    : ["run", "-e", "host-packet"];
  const compiled = spawnSync(command, args, { cwd: firmwareRoot, encoding: "utf8" });
  if (compiled.status !== 0) {
    record("Native frame parity", false, `pio host-packet failed: ${tail(compiled.stderr || compiled.stdout || "no output")}`);
    return;
  }
  const executable = join(firmwareRoot, ".pio", "build", "host-packet", process.platform === "win32" ? "program.exe" : "program");
  const ran = spawnSync(executable, [], { encoding: "utf8" });
  const lines = (ran.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const hex = lines[0] ?? "";
  const crcLine = lines.find((line) => line.startsWith("crc32=")) ?? "";
  const ok = ran.status === 0 && hex === typescriptHex && crcLine.toLowerCase() === "crc32=cbf43926";
  record(
    "Native frame parity",
    ok,
    ok ? "pio host-packet hex matches encodeRecord and CRC 0xCBF43926" : `pio output ${hex || "(none)"} ${crcLine || tail(ran.stderr || "")}`,
  );
}

const gxx = findTool("g++");
const clangxx = findTool("clang++");
const pio = findTool("pio");
if (gxx !== null) {
  runHarness(gxx, "g++");
} else if (clangxx !== null) {
  runHarness(clangxx, "clang++");
} else if (pio !== null) {
  runPioHarness(pio);
} else {
  skip("Native frame parity", "no g++, clang++, or pio on PATH; header checks still stand");
}

  printTable("Sprint 5 — ESP32-S3 firmware", rows);
  if (failed) {
    process.exitCode = 1;
  }
}

void verifyCodec();
