import { decodeBurstStream, encodeBurstStream } from "./codec.js";
import { computeCrc32 } from "./crc32.js";
import { FlightState, TamperStatus } from "./types.js";
import type {
  CargoManifest,
  FreshFliteTelemetryRecord,
  FreshFliteWireFields,
  ManifestSealSummary,
  ThermalSlaReport,
} from "./types.js";

/** One sample per minute, starting 2026-10-14 06:00:00 UTC at Oron handoff. */
export const QI0412_START_UNIX = Math.floor(Date.UTC(2026, 9, 14, 6, 0, 0) / 1000);

export const QI0412_RECORD_COUNT = 95;

export const QI0412_MANIFEST: CargoManifest = {
  manifestId: "FF-MAN-QI0412-20261014",
  podUuid: "7c1a9e20-0412-4f17-9b00-0a0b0c0d0412",
  cooperativeOrigin: "Oron Beach Aggregation Cluster #3",
  species: "Atlantic croaker",
  weightKg: 186.4,
  flightNumber: "QI-0412",
  aircraftType: "CRJ-900",
  originAirport: "UYO",
  destinationAirport: "LOS",
  slaMinC: -2,
  slaMaxC: 4,
};

const TAKEOFF_INDEX = 34;
const TOUCHDOWN_INDEX = 94;
const SAMPLE_PERIOD_SEC = 60;

function lerpCenti(
  index: number,
  startIndex: number,
  endIndex: number,
  startCenti: number,
  endCenti: number,
): number {
  const span = endIndex - startIndex;
  return Math.round(startCenti + ((endCenti - startCenti) * (index - startIndex)) / span);
}

function humidityCenti(index: number): number {
  return 8400 + ((index * 13) % 180);
}

function batterySocPct(index: number): number {
  return 98 - Math.floor((index * 12) / (QI0412_RECORD_COUNT - 1));
}

function sampleAt(index: number): FreshFliteWireFields {
  const unixTimestamp = QI0412_START_UNIX + index * SAMPLE_PERIOD_SEC;
  const humidity = humidityCenti(index);
  const battery = batterySocPct(index);

  if (index < TAKEOFF_INDEX) {
    return {
      unixTimestamp,
      temperatureCenti: lerpCenti(index, 0, TAKEOFF_INDEX - 1, 320, 110),
      humidityCenti: humidity,
      batterySocPct: battery,
      tamperStatus: TamperStatus.OK,
      flightState: FlightState.GROUND_PREFLIGHT,
      peakAccelMg: 80 + (index % 6) * 15,
    };
  }

  if (index === TAKEOFF_INDEX) {
    return {
      unixTimestamp,
      temperatureCenti: 110,
      humidityCenti: humidity,
      batterySocPct: battery,
      tamperStatus: TamperStatus.OK,
      flightState: FlightState.IN_FLIGHT_SILENT,
      peakAccelMg: 1380,
    };
  }

  if (index < TOUCHDOWN_INDEX) {
    const cruiseWave = [100, 108, 116, 124, 132, 128, 120, 112, 104, 96] as const;
    const minute = index - (TAKEOFF_INDEX + 1);
    const temperatureCenti = cruiseWave[minute % cruiseWave.length] ?? 110;
    return {
      unixTimestamp,
      temperatureCenti,
      humidityCenti: humidity,
      batterySocPct: battery,
      tamperStatus: TamperStatus.OK,
      flightState: FlightState.IN_FLIGHT_SILENT,
      peakAccelMg: 160 + ((index * 11) % 90),
    };
  }

  return {
    unixTimestamp,
    temperatureCenti: 140,
    humidityCenti: humidity,
    batterySocPct: battery,
    tamperStatus: TamperStatus.OK,
    flightState: FlightState.POST_TOUCHDOWN_BURST,
    peakAccelMg: 1010,
  };
}

export interface SimulatedFlight {
  manifest: CargoManifest;
  records: FreshFliteTelemetryRecord[];
}

/**
 * Deterministic 95-sample voyage:
 * Oron Beach Aggregation Cluster #3 → Victor Attah (UYO) → Murtala Muhammed (LOS)
 * on Ibom Air QI-0412 (CRJ 900).
 */
export function generateSimulatedFlightQI0412(): SimulatedFlight {
  const drafts: FreshFliteWireFields[] = [];
  for (let index = 0; index < QI0412_RECORD_COUNT; index += 1) {
    drafts.push(sampleAt(index));
  }
  return {
    manifest: QI0412_MANIFEST,
    records: decodeBurstStream(encodeBurstStream(drafts)),
  };
}

export function buildSealSummary(
  flight: SimulatedFlight,
  report: ThermalSlaReport,
  burst: Uint8Array,
): ManifestSealSummary {
  return {
    manifestId: flight.manifest.manifestId,
    podUuid: flight.manifest.podUuid,
    flightNumber: flight.manifest.flightNumber,
    aircraftType: flight.manifest.aircraftType,
    originAirport: flight.manifest.originAirport,
    destinationAirport: flight.manifest.destinationAirport,
    cooperativeOrigin: flight.manifest.cooperativeOrigin,
    species: flight.manifest.species,
    recordCount: flight.records.length,
    thermalIntegrityScorePct: report.thermalIntegrityScorePct,
    excursionCount: report.excursionCount,
    minTemperatureC: report.minTemperatureC,
    maxTemperatureC: report.maxTemperatureC,
    icaoSilentModeEngaged: report.icaoSilentModeEngagedOnHighG,
    burstCrc32: computeCrc32(burst),
  };
}
