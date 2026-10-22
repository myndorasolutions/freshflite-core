import { describe, expect, it } from "vitest";
import {
  PACKET_BYTE_LENGTH,
  decodeBurstStream,
  decodeRecord,
  encodeBurstStream,
  encodeRecord,
  evaluateThermalSLA,
} from "./codec.js";
import { computeCrc32 } from "./crc32.js";
import { FlightState, IntegrityError, TamperStatus } from "./types.js";
import type { FreshFliteWireFields } from "./types.js";

const sample: FreshFliteWireFields = {
  unixTimestamp: 1_760_421_600,
  temperatureCenti: -150,
  humidityCenti: 8520,
  batterySocPct: 87,
  tamperStatus: TamperStatus.LID_BREACH,
  flightState: FlightState.IN_FLIGHT_SILENT,
  peakAccelMg: 1320,
};

describe("17-byte frame", () => {
  it("encodes and decodes a single packet of exactly 17 bytes", () => {
    const frame = encodeRecord(sample);
    expect(frame.byteLength).toBe(17);
    expect(frame.byteLength).toBe(PACKET_BYTE_LENGTH);

    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    expect(view.getUint32(0, true)).toBe(sample.unixTimestamp);
    expect(view.getInt16(4, true)).toBe(-150);
    expect(view.getUint16(6, true)).toBe(8520);
    expect(view.getUint8(8)).toBe(87);
    expect(view.getUint8(9)).toBe(0x01);
    expect(view.getUint8(10)).toBe(0x01);
    expect(view.getInt16(11, true)).toBe(1320);
    expect(view.getUint32(13, true)).toBe(computeCrc32(frame.subarray(0, 13)));

    const decoded = decodeRecord(frame);
    expect(decoded.unixTimestamp).toBe(sample.unixTimestamp);
    expect(decoded.temperatureCenti).toBe(-150);
    expect(decoded.temperatureC).toBeCloseTo(-1.5, 5);
    expect(decoded.humidityCenti).toBe(8520);
    expect(decoded.humidityPct).toBeCloseTo(85.2, 5);
    expect(decoded.batterySocPct).toBe(87);
    expect(decoded.tamperStatus).toBe(TamperStatus.LID_BREACH);
    expect(decoded.flightState).toBe(FlightState.IN_FLIGHT_SILENT);
    expect(decoded.peakAccelMg).toBe(1320);
    expect(decoded.checksumCrc32).toBe(view.getUint32(13, true));
  });

  it("rejects a one-bit flip in the protected payload", () => {
    const frame = encodeRecord(sample);
    const corrupted = new Uint8Array(frame);
    const payloadByte = corrupted[4] ?? 0;
    corrupted[4] = payloadByte ^ 0x01;
    expect(() => decodeRecord(corrupted)).toThrow(IntegrityError);
    expect(() => decodeRecord(corrupted)).toThrow(/CRC32 mismatch/);
  });

  it("rejects a truncated frame", () => {
    const frame = encodeRecord(sample);
    expect(() => decodeRecord(frame.subarray(0, 16))).toThrow(IntegrityError);
  });
});

describe("burst stream", () => {
  it("rejects a buffer whose length is not a multiple of 17", () => {
    const frame = encodeRecord(sample);
    const truncated = new Uint8Array(frame.byteLength + 3);
    truncated.set(frame);
    expect(() => decodeBurstStream(truncated)).toThrow(/not a multiple of 17/);
  });
});

describe("evaluateThermalSLA", () => {
  it("scores a single out-of-range sample and a compliant one", () => {
    const inside = decodeRecord(encodeRecord({ ...sample, temperatureCenti: 110, peakAccelMg: 200 }));
    const outside = decodeRecord(encodeRecord({ ...sample, temperatureCenti: 450, peakAccelMg: 200 }));
    const report = evaluateThermalSLA([inside, outside]);
    expect(report.sampleCount).toBe(2);
    expect(report.excursionCount).toBe(1);
    expect(report.thermalIntegrityScorePct).toBe(50);
    expect(report.minTemperatureC).toBeCloseTo(1.1, 5);
    expect(report.maxTemperatureC).toBeCloseTo(4.5, 5);
  });

  it("flags high-G takeoff that is still in ground preflight", () => {
    const loudGround = decodeRecord(
      encodeRecord({
        ...sample,
        temperatureCenti: 200,
        flightState: FlightState.GROUND_PREFLIGHT,
        peakAccelMg: 1300,
      }),
    );
    const report = evaluateThermalSLA([loudGround]);
    expect(report.highGSampleCount).toBe(1);
    expect(report.icaoSilentModeEngagedOnHighG).toBe(false);
  });

  it("accepts high-G only when silent mode is already engaged", () => {
    const takeoff = decodeRecord(
      encodeRecord({
        ...sample,
        temperatureCenti: 110,
        flightState: FlightState.IN_FLIGHT_SILENT,
        peakAccelMg: 1380,
      }),
    );
    expect(evaluateThermalSLA([takeoff]).icaoSilentModeEngagedOnHighG).toBe(true);
  });
});

describe("encodeBurstStream", () => {
  it("places frames back to back", () => {
    const second: FreshFliteWireFields = { ...sample, unixTimestamp: sample.unixTimestamp + 60 };
    const burst = encodeBurstStream([sample, second]);
    expect(burst.byteLength).toBe(34);
    const decoded = decodeBurstStream(burst);
    expect(decoded.map((record) => record.unixTimestamp)).toEqual([
      sample.unixTimestamp,
      second.unixTimestamp,
    ]);
  });
});
