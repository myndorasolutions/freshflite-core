import { describe, expect, it } from "vitest";
import { PACKET_BYTE_LENGTH, encodeBurstStream, evaluateThermalSLA } from "./codec.js";
import { FlightState } from "./types.js";
import { QI0412_RECORD_COUNT, generateSimulatedFlightQI0412 } from "./demo-flight.js";

describe("QI-0412 simulated flight", () => {
  const flight = generateSimulatedFlightQI0412();

  it("produces 95 frames and a 1615-byte SPIFFS burst", () => {
    expect(flight.records).toHaveLength(QI0412_RECORD_COUNT);
    expect(flight.records).toHaveLength(95);
    const burst = encodeBurstStream(flight.records);
    expect(burst.byteLength).toBe(95 * PACKET_BYTE_LENGTH);
    expect(burst.byteLength).toBe(1615);
  });

  it("cools on the ground, goes silent at the 1.38g takeoff, and bursts after touchdown", () => {
    const first = flight.records[0];
    const cooled = flight.records[33];
    const takeoff = flight.records[34];
    const cruise = flight.records[35];
    const touchdown = flight.records[94];
    if (
      first === undefined ||
      cooled === undefined ||
      takeoff === undefined ||
      cruise === undefined ||
      touchdown === undefined
    ) {
      throw new Error("QI-0412 record set is short");
    }

    expect(first.flightState).toBe(FlightState.GROUND_PREFLIGHT);
    expect(first.temperatureCenti).toBe(320);
    expect(cooled.flightState).toBe(FlightState.GROUND_PREFLIGHT);
    expect(cooled.temperatureCenti).toBe(110);

    expect(takeoff.flightState).toBe(FlightState.IN_FLIGHT_SILENT);
    expect(takeoff.peakAccelMg).toBe(1380);
    expect(cruise.flightState).toBe(FlightState.IN_FLIGHT_SILENT);
    expect(cruise.peakAccelMg).toBeLessThanOrEqual(1250);

    expect(touchdown.flightState).toBe(FlightState.POST_TOUCHDOWN_BURST);
    expect(touchdown.peakAccelMg).toBe(1010);

    expect(flight.manifest.cooperativeOrigin).toBe("Oron Beach Aggregation Cluster #3");
    expect(flight.manifest.flightNumber).toBe("QI-0412");
    expect(flight.manifest.aircraftType).toBe("CRJ-900");
    expect(flight.manifest.originAirport).toBe("UYO");
    expect(flight.manifest.destinationAirport).toBe("LOS");
  });

  it("stays inside the thermal SLA with silent mode engaged on the high-G sample", () => {
    const report = evaluateThermalSLA(flight.records);
    expect(report.excursionCount).toBe(0);
    expect(report.thermalIntegrityScorePct).toBe(100);
    expect(report.icaoSilentModeEngagedOnHighG).toBe(true);
    expect(report.highGSampleCount).toBe(1);
    expect(report.minTemperatureC).toBeGreaterThanOrEqual(-2);
    expect(report.maxTemperatureC).toBeLessThanOrEqual(4);
  });
});
