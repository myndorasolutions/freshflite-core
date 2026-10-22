import { computeCrc32 } from "./crc32.js";
import {
  FlightState,
  IntegrityError,
  TamperStatus,
  type FreshFliteTelemetryRecord,
  type FreshFliteWireFields,
  type ThermalSlaReport,
} from "./types.js";

/** Packed FreshFliteRecord length, including the CRC32 trailer. */
export const PACKET_BYTE_LENGTH = 17;

const PAYLOAD_LENGTH = 13;
const CRC_OFFSET = 13;

/** Takeoff / high-G samples above this must already be in ICAO silent mode. */
export const HIGH_G_SILENT_THRESHOLD_MG = 1250;

const SLA_DEFAULT_MIN_C = -2;
const SLA_DEFAULT_MAX_C = 4;

function assertInteger(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}], received ${String(value)}`);
  }
}

function viewOf(buffer: Uint8Array): DataView {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function readTamperStatus(value: number): TamperStatus {
  switch (value) {
    case TamperStatus.OK:
      return TamperStatus.OK;
    case TamperStatus.LID_BREACH:
      return TamperStatus.LID_BREACH;
    case TamperStatus.SHOCK_DROP:
      return TamperStatus.SHOCK_DROP;
    case TamperStatus.LID_AND_SHOCK:
      return TamperStatus.LID_AND_SHOCK;
    default:
      throw new IntegrityError(`Unrecognized tamper_status 0x${value.toString(16).padStart(2, "0")}`);
  }
}

function readFlightState(value: number): FlightState {
  switch (value) {
    case FlightState.GROUND_PREFLIGHT:
      return FlightState.GROUND_PREFLIGHT;
    case FlightState.IN_FLIGHT_SILENT:
      return FlightState.IN_FLIGHT_SILENT;
    case FlightState.POST_TOUCHDOWN_BURST:
      return FlightState.POST_TOUCHDOWN_BURST;
    default:
      throw new IntegrityError(`Unrecognized flight_state 0x${value.toString(16).padStart(2, "0")}`);
  }
}

function hex32(value: number): string {
  return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

/** Pack one Little-Endian 17-byte frame and append CRC32 of bytes 0..12. */
export function encodeRecord(record: FreshFliteWireFields): Uint8Array {
  assertInteger("unixTimestamp", record.unixTimestamp, 0, 0xffffffff);
  assertInteger("temperatureCenti", record.temperatureCenti, -32768, 32767);
  assertInteger("humidityCenti", record.humidityCenti, 0, 65535);
  assertInteger("batterySocPct", record.batterySocPct, 0, 100);
  assertInteger("tamperStatus", record.tamperStatus, 0x00, 0x03);
  assertInteger("flightState", record.flightState, 0x00, 0x02);
  assertInteger("peakAccelMg", record.peakAccelMg, -32768, 32767);

  const buffer = new Uint8Array(PACKET_BYTE_LENGTH);
  const view = viewOf(buffer);
  view.setUint32(0, record.unixTimestamp, true);
  view.setInt16(4, record.temperatureCenti, true);
  view.setUint16(6, record.humidityCenti, true);
  view.setUint8(8, record.batterySocPct);
  view.setUint8(9, record.tamperStatus);
  view.setUint8(10, record.flightState);
  view.setInt16(11, record.peakAccelMg, true);

  const checksum = computeCrc32(buffer.subarray(0, PAYLOAD_LENGTH));
  view.setUint32(CRC_OFFSET, checksum, true);
  return buffer;
}

/** Unpack one frame. Rejects the wrong length and any CRC32 mismatch. */
export function decodeRecord(buffer: Uint8Array): FreshFliteTelemetryRecord {
  if (buffer.byteLength !== PACKET_BYTE_LENGTH) {
    throw new IntegrityError(
      `FreshFliteRecord must be ${String(PACKET_BYTE_LENGTH)} bytes, received ${String(buffer.byteLength)}`,
    );
  }

  const view = viewOf(buffer);
  const expected = computeCrc32(buffer.subarray(0, PAYLOAD_LENGTH));
  const stored = view.getUint32(CRC_OFFSET, true);
  if (stored !== expected) {
    throw new IntegrityError(
      `CRC32 mismatch: stored ${hex32(stored)} does not match computed ${hex32(expected)} over bytes 0..12`,
    );
  }

  const temperatureCenti = view.getInt16(4, true);
  const humidityCenti = view.getUint16(6, true);
  return {
    unixTimestamp: view.getUint32(0, true),
    temperatureCenti,
    temperatureC: temperatureCenti / 100,
    humidityCenti,
    humidityPct: humidityCenti / 100,
    batterySocPct: view.getUint8(8),
    tamperStatus: readTamperStatus(view.getUint8(9)),
    flightState: readFlightState(view.getUint8(10)),
    peakAccelMg: view.getInt16(11, true),
    checksumCrc32: stored,
  };
}

/** Concatenate records the way the ESP32-S3 dumps SPIFFS after touchdown. */
export function encodeBurstStream(records: readonly FreshFliteWireFields[]): Uint8Array {
  const stream = new Uint8Array(records.length * PACKET_BYTE_LENGTH);
  records.forEach((record, index) => {
    stream.set(encodeRecord(record), index * PACKET_BYTE_LENGTH);
  });
  return stream;
}

/** Split a SPIFFS dump into frames. Length must be an exact multiple of 17. */
export function decodeBurstStream(buffer: Uint8Array): FreshFliteTelemetryRecord[] {
  if (buffer.byteLength % PACKET_BYTE_LENGTH !== 0) {
    throw new IntegrityError(
      `Burst length ${String(buffer.byteLength)} is not a multiple of ${String(PACKET_BYTE_LENGTH)}`,
    );
  }

  const frameCount = buffer.byteLength / PACKET_BYTE_LENGTH;
  const records: FreshFliteTelemetryRecord[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const start = index * PACKET_BYTE_LENGTH;
    records.push(decodeRecord(buffer.subarray(start, start + PACKET_BYTE_LENGTH)));
  }
  return records;
}

/**
 * Thermal Integrity Score is the share of samples inside the SLA, in percent
 * rounded to one decimal. High-G samples (>1250 mG) must be IN_FLIGHT_SILENT.
 * Comparisons use centi-degrees so the threshold is exact.
 */
export function evaluateThermalSLA(
  records: readonly FreshFliteTelemetryRecord[],
  minC: number = SLA_DEFAULT_MIN_C,
  maxC: number = SLA_DEFAULT_MAX_C,
): ThermalSlaReport {
  const first = records[0];
  if (first === undefined) {
    throw new RangeError("evaluateThermalSLA requires at least one record");
  }

  const minCenti = Math.round(minC * 100);
  const maxCenti = Math.round(maxC * 100);
  let excursionCount = 0;
  let minTemperatureCenti = first.temperatureCenti;
  let maxTemperatureCenti = first.temperatureCenti;
  let highGSampleCount = 0;
  let silentEngaged = true;

  for (const record of records) {
    if (record.temperatureCenti < minCenti || record.temperatureCenti > maxCenti) {
      excursionCount += 1;
    }
    if (record.temperatureCenti < minTemperatureCenti) {
      minTemperatureCenti = record.temperatureCenti;
    }
    if (record.temperatureCenti > maxTemperatureCenti) {
      maxTemperatureCenti = record.temperatureCenti;
    }
    if (record.peakAccelMg > HIGH_G_SILENT_THRESHOLD_MG) {
      highGSampleCount += 1;
      if (record.flightState !== FlightState.IN_FLIGHT_SILENT) {
        silentEngaged = false;
      }
    }
  }

  const inRange = records.length - excursionCount;
  const thermalIntegrityScorePct = Math.round((inRange / records.length) * 1000) / 10;

  return {
    thermalIntegrityScorePct,
    excursionCount,
    minTemperatureC: minTemperatureCenti / 100,
    maxTemperatureC: maxTemperatureCenti / 100,
    sampleCount: records.length,
    icaoSilentModeEngagedOnHighG: silentEngaged,
    highGSampleCount,
  };
}
