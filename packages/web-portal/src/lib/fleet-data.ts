import {
  FlightState,
  TamperStatus,
  buildSealSummary,
  canonicalSummaryBytes,
  decodeBurstStream,
  encodeBurstStream,
  encodeRecord,
  evaluateThermalSLA,
  generatePodKeyPair,
  publicKeyFromRawBase64,
  signManifestSummary,
  verifyManifestSignature,
  type CargoManifest,
  type FreshFliteTelemetryRecord,
  type FreshFliteWireFields,
  type ManifestSealSummary,
  type ThermalSlaReport,
} from "@freshflite/shared-schema";
import { toHexPreview } from "./frame-view";

export type ClearanceStatus = "COMPLIANT" | "REJECTED";

export interface ChartPoint {
  index: number;
  minute: number;
  temperatureC: number;
  peakAccelMg: number;
  flightState: number;
  tamperStatus: number;
  timestampUtc: string;
  frame: number[];
}

export interface DispatchFlightView {
  manifestId: string;
  flightNumber: string;
  selectorLabel: string;
  routeLabel: string;
  originAirport: "UYO";
  destinationAirport: "LOS" | "ABV";
  aircraftType: CargoManifest["aircraftType"];
  aircraftLabel: string;
  registration: string;
  species: string;
  weightKg: number;
  podId: string;
  podUuid: string;
  cooperativeOrigin: string;
  cooperativeId: string;
  harvestLandedUtc: string;
  clearance: ClearanceStatus;
  scorePct: number;
  excursionCount: number;
  minTemperatureC: number;
  maxTemperatureC: number;
  silent: boolean;
  recordCount: number;
  byteLength: number;
  publicKey: string;
  signature: string;
  sealSummary: ManifestSealSummary;
  preflightEnd: number;
  takeoffMinute: number;
  touchdownMinute: number;
  points: ChartPoint[];
}

export interface ManifestSummary {
  manifestId: string;
  flightNumber: string;
  routeLabel: string;
  scorePct: number;
  clearance: ClearanceStatus;
  excursionCount: number;
  silent: boolean;
  byteLength: number;
}

export interface ManifestDetail {
  summary: ManifestSummary;
  manifest: CargoManifest;
  podId: string;
  registration: string;
  aircraftLabel: string;
  cooperativeId: string;
  harvestLandedUtc: string;
  records: FreshFliteTelemetryRecord[];
  sla: ThermalSlaReport;
  publicKey: string;
  signature: string;
}

export interface BinaryPreview {
  manifestId: string;
  byteLength: number;
  hexPreview: string;
  base64: string;
}

export interface AuditResult {
  manifestId: string;
  verified: boolean;
  breached: boolean;
  message: string;
}

interface FleetRecord {
  manifest: CargoManifest;
  podId: string;
  registration: string;
  aircraftLabel: string;
  cooperativeId: string;
  harvestLandedUnix: number;
  clearance: ClearanceStatus;
  selectorLabel: string;
  records: FreshFliteTelemetryRecord[];
  burst: Uint8Array;
  sla: ThermalSlaReport;
  summary: ManifestSealSummary;
  publicKeyBase64: string;
  signature: string;
}

const SAMPLE_PERIOD_SEC = 60;
const CRUISE_WAVE = [100, 108, 116, 124, 132, 128, 120, 112, 104, 96] as const;

function unixUtc(year: number, monthIndex: number, day: number, hour: number, minute: number): number {
  return Math.floor(Date.UTC(year, monthIndex, day, hour, minute, 0) / 1000);
}

function lerpCenti(index: number, startIndex: number, endIndex: number, startCenti: number, endCenti: number): number {
  const span = endIndex - startIndex;
  if (span === 0) {
    return startCenti;
  }
  return Math.round(startCenti + ((endCenti - startCenti) * (index - startIndex)) / span);
}

function humidityCenti(index: number): number {
  return 8400 + ((index * 13) % 180);
}

function batterySocPct(index: number, total: number): number {
  const drop = Math.floor((index * 18) / Math.max(total - 1, 1));
  return Math.max(40, 98 - drop);
}

function wire(fields: FreshFliteWireFields): FreshFliteWireFields {
  return fields;
}

function buildQi0412Samples(startUnix: number): FreshFliteWireFields[] {
  const total = 95;
  const samples: FreshFliteWireFields[] = [];
  for (let index = 0; index < total; index += 1) {
    const unixTimestamp = startUnix + index * SAMPLE_PERIOD_SEC;
    const common = {
      unixTimestamp,
      humidityCenti: humidityCenti(index),
      batterySocPct: batterySocPct(index, total),
      tamperStatus: TamperStatus.OK,
    };
    if (index < 34) {
      samples.push(
        wire({
          ...common,
          temperatureCenti: lerpCenti(index, 0, 33, 320, 110),
          flightState: FlightState.GROUND_PREFLIGHT,
          peakAccelMg: 80 + (index % 6) * 15,
        }),
      );
    } else if (index === 34) {
      samples.push(
        wire({
          ...common,
          temperatureCenti: 110,
          flightState: FlightState.IN_FLIGHT_SILENT,
          peakAccelMg: 1380,
        }),
      );
    } else if (index < 94) {
      const minute = index - 35;
      samples.push(
        wire({
          ...common,
          temperatureCenti: CRUISE_WAVE[minute % CRUISE_WAVE.length] ?? 110,
          flightState: FlightState.IN_FLIGHT_SILENT,
          peakAccelMg: 160 + ((index * 11) % 90),
        }),
      );
    } else {
      samples.push(
        wire({
          ...common,
          temperatureCenti: 140,
          flightState: FlightState.POST_TOUCHDOWN_BURST,
          peakAccelMg: 1010,
        }),
      );
    }
  }
  return samples;
}

function buildQi0208Samples(startUnix: number): FreshFliteWireFields[] {
  const total = 170;
  const samples: FreshFliteWireFields[] = [];
  for (let index = 0; index < total; index += 1) {
    const unixTimestamp = startUnix + index * SAMPLE_PERIOD_SEC;
    const common = {
      unixTimestamp,
      humidityCenti: humidityCenti(index),
      batterySocPct: batterySocPct(index, total),
      tamperStatus: TamperStatus.OK,
    };
    if (index < 40) {
      samples.push(
        wire({
          ...common,
          temperatureCenti: lerpCenti(index, 0, 39, 300, 160),
          flightState: FlightState.GROUND_PREFLIGHT,
          peakAccelMg: 90 + (index % 5) * 12,
        }),
      );
    } else if (index === 40) {
      samples.push(
        wire({
          ...common,
          temperatureCenti: 420,
          flightState: FlightState.GROUND_PREFLIGHT,
          peakAccelMg: 140,
        }),
      );
    } else if (index === 41) {
      samples.push(
        wire({
          ...common,
          temperatureCenti: 180,
          flightState: FlightState.IN_FLIGHT_SILENT,
          peakAccelMg: 1380,
        }),
      );
    } else if (index < 169) {
      const minute = index - 42;
      samples.push(
        wire({
          ...common,
          temperatureCenti: CRUISE_WAVE[minute % CRUISE_WAVE.length] ?? 120,
          flightState: FlightState.IN_FLIGHT_SILENT,
          peakAccelMg: 150 + ((index * 7) % 80),
        }),
      );
    } else {
      samples.push(
        wire({
          ...common,
          temperatureCenti: 200,
          flightState: FlightState.POST_TOUCHDOWN_BURST,
          peakAccelMg: 1010,
        }),
      );
    }
  }
  return samples;
}

function buildQi0419Samples(startUnix: number): FreshFliteWireFields[] {
  const total = 200;
  const samples: FreshFliteWireFields[] = [];
  for (let index = 0; index < total; index += 1) {
    const unixTimestamp = startUnix + index * SAMPLE_PERIOD_SEC;
    const common = {
      unixTimestamp,
      humidityCenti: humidityCenti(index),
      batterySocPct: batterySocPct(index, total),
      tamperStatus: TamperStatus.LID_BREACH,
    };
    if (index < 43) {
      samples.push(
        wire({
          ...common,
          temperatureCenti: 640,
          flightState: FlightState.GROUND_PREFLIGHT,
          peakAccelMg: 180 + (index % 4) * 10,
        }),
      );
    } else if (index < 77) {
      samples.push(
        wire({
          ...common,
          temperatureCenti: lerpCenti(index, 43, 76, 380, 140),
          flightState: FlightState.GROUND_PREFLIGHT,
          peakAccelMg: 100 + (index % 6) * 12,
        }),
      );
    } else if (index === 77) {
      samples.push(
        wire({
          ...common,
          temperatureCenti: 150,
          flightState: FlightState.IN_FLIGHT_SILENT,
          peakAccelMg: 1380,
        }),
      );
    } else if (index < 199) {
      const minute = index - 78;
      samples.push(
        wire({
          ...common,
          temperatureCenti: CRUISE_WAVE[minute % CRUISE_WAVE.length] ?? 120,
          flightState: FlightState.IN_FLIGHT_SILENT,
          peakAccelMg: 160 + ((index * 5) % 70),
        }),
      );
    } else {
      samples.push(
        wire({
          ...common,
          temperatureCenti: 210,
          flightState: FlightState.POST_TOUCHDOWN_BURST,
          peakAccelMg: 1010,
        }),
      );
    }
  }
  return samples;
}

function isoUtc(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace(".000Z", "Z");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function sealVoyage(
  manifest: CargoManifest,
  samples: readonly FreshFliteWireFields[],
  extras: Omit<FleetRecord, "manifest" | "records" | "burst" | "sla" | "summary" | "publicKeyBase64" | "signature">,
): Promise<FleetRecord> {
  const burst = encodeBurstStream(samples);
  const records = decodeBurstStream(burst);
  const sla = evaluateThermalSLA(records);
  const summary = buildSealSummary({ manifest, records }, sla, burst);
  const keys = await generatePodKeyPair();
  const signature = await signManifestSummary(keys.privateKey, canonicalSummaryBytes(summary));
  return {
    manifest,
    records,
    burst,
    sla,
    summary,
    publicKeyBase64: keys.publicKeyBase64,
    signature,
    ...extras,
  };
}

async function buildFleet(): Promise<FleetRecord[]> {
  const start412 = unixUtc(2026, 9, 14, 6, 0);
  const start208 = unixUtc(2026, 9, 14, 8, 30);
  const start419 = unixUtc(2026, 9, 14, 11, 15);

  const prawns: CargoManifest = {
    manifestId: "FF-MAN-QI0412-20261014",
    podUuid: "11111111-0412-4f17-9b00-0000000001a1",
    cooperativeOrigin: "Oron Beach Aggregation Cluster #3",
    species: "Jumbo Tiger Prawns (Penaeus monodon)",
    weightKg: 38.5,
    flightNumber: "QI-0412",
    aircraftType: "CRJ-900",
    originAirport: "UYO",
    destinationAirport: "LOS",
    slaMinC: -2,
    slaMaxC: 4,
  };

  const croaker: CargoManifest = {
    manifestId: "FF-MAN-QI0208-20261014",
    podUuid: "22222222-0208-4f17-9b00-0000000002b2",
    cooperativeOrigin: "Ibeno Artisanal Landing Jetty #1",
    species: "Atlantic Croaker Fillet (Export Grade)",
    weightKg: 42,
    flightNumber: "QI-0208",
    aircraftType: "A220-300",
    originAirport: "UYO",
    destinationAirport: "ABV",
    slaMinC: -2,
    slaMaxC: 4,
  };

  const crabs: CargoManifest = {
    manifestId: "FF-MAN-QI0419-20261014",
    podUuid: "33333333-0419-4f17-9b00-0000000003c3",
    cooperativeOrigin: "Eastern Obolo Cooperative Hub",
    species: "Fresh Mud Crabs & Prawns",
    weightKg: 35,
    flightNumber: "QI-0419",
    aircraftType: "CRJ-900",
    originAirport: "UYO",
    destinationAirport: "LOS",
    slaMinC: -2,
    slaMaxC: 4,
  };

  return Promise.all([
    sealVoyage(prawns, buildQi0412Samples(start412), {
      podId: "FF-S3-01A",
      registration: "5N-BWM",
      aircraftLabel: "Bombardier CRJ 900",
      cooperativeId: "COOP-ORON-03",
      harvestLandedUnix: start412 - 90 * 60,
      clearance: "COMPLIANT",
      selectorLabel: "QI-0412 (UYO → LOS)",
    }),
    sealVoyage(croaker, buildQi0208Samples(start208), {
      podId: "FF-S3-02B",
      registration: "5N-CDA",
      aircraftLabel: "Airbus A220-300",
      cooperativeId: "COOP-IBENO-01",
      harvestLandedUnix: start208 - 75 * 60,
      clearance: "COMPLIANT",
      selectorLabel: "QI-0208 (UYO → ABV)",
    }),
    sealVoyage(crabs, buildQi0419Samples(start419), {
      podId: "FF-S3-03C",
      registration: "5N-BWN",
      aircraftLabel: "Bombardier CRJ 900",
      cooperativeId: "COOP-EOBOLO-07",
      harvestLandedUnix: start419 - 110 * 60,
      clearance: "REJECTED",
      selectorLabel: "QI-0419 (SLA Breach Alert)",
    }),
  ]);
}

const FLEET: readonly FleetRecord[] = await buildFleet();

function requireFlight(manifestId: string): FleetRecord | undefined {
  return FLEET.find((flight) => flight.manifest.manifestId === manifestId);
}

export function toDispatchView(flight: FleetRecord): DispatchFlightView {
  const takeoffMinute = flight.records.findIndex((record) => record.peakAccelMg > 1250);
  const touchdownMinute = flight.records.findIndex(
    (record) => record.flightState === FlightState.POST_TOUCHDOWN_BURST,
  );
  return {
    manifestId: flight.manifest.manifestId,
    flightNumber: flight.manifest.flightNumber,
    selectorLabel: flight.selectorLabel,
    routeLabel: `${flight.manifest.cooperativeOrigin} → ${flight.manifest.originAirport} → ${flight.manifest.destinationAirport}`,
    originAirport: flight.manifest.originAirport,
    destinationAirport: flight.manifest.destinationAirport,
    aircraftType: flight.manifest.aircraftType,
    aircraftLabel: flight.aircraftLabel,
    registration: flight.registration,
    species: flight.manifest.species,
    weightKg: flight.manifest.weightKg,
    podId: flight.podId,
    podUuid: flight.manifest.podUuid,
    cooperativeOrigin: flight.manifest.cooperativeOrigin,
    cooperativeId: flight.cooperativeId,
    harvestLandedUtc: isoUtc(flight.harvestLandedUnix),
    clearance: flight.clearance,
    scorePct: flight.sla.thermalIntegrityScorePct,
    excursionCount: flight.sla.excursionCount,
    minTemperatureC: flight.sla.minTemperatureC,
    maxTemperatureC: flight.sla.maxTemperatureC,
    silent: flight.sla.icaoSilentModeEngagedOnHighG,
    recordCount: flight.records.length,
    byteLength: flight.burst.byteLength,
    publicKey: flight.publicKeyBase64,
    signature: flight.signature,
    sealSummary: flight.summary,
    preflightEnd: Math.max(takeoffMinute - 1, 0),
    takeoffMinute,
    touchdownMinute,
    points: flight.records.map((record, index) => ({
      index,
      minute: index,
      temperatureC: record.temperatureC,
      peakAccelMg: record.peakAccelMg,
      flightState: record.flightState,
      tamperStatus: record.tamperStatus,
      timestampUtc: isoUtc(record.unixTimestamp),
      frame: Array.from(encodeRecord(record)),
    })),
  };
}

function toSummary(flight: FleetRecord): ManifestSummary {
  return {
    manifestId: flight.manifest.manifestId,
    flightNumber: flight.manifest.flightNumber,
    routeLabel: `${flight.manifest.cooperativeOrigin} → ${flight.manifest.originAirport} → ${flight.manifest.destinationAirport}`,
    scorePct: flight.sla.thermalIntegrityScorePct,
    clearance: flight.clearance,
    excursionCount: flight.sla.excursionCount,
    silent: flight.sla.icaoSilentModeEngagedOnHighG,
    byteLength: flight.burst.byteLength,
  };
}

export function listManifestSummaries(): ManifestSummary[] {
  return FLEET.map(toSummary);
}

export function listDispatchFlights(): DispatchFlightView[] {
  return FLEET.map(toDispatchView);
}

export function getDispatchFlight(manifestId: string): DispatchFlightView | undefined {
  const flight = requireFlight(manifestId);
  return flight === undefined ? undefined : toDispatchView(flight);
}

export function getManifestDetail(manifestId: string): ManifestDetail | undefined {
  const flight = requireFlight(manifestId);
  if (flight === undefined) {
    return undefined;
  }
  return {
    summary: toSummary(flight),
    manifest: flight.manifest,
    podId: flight.podId,
    registration: flight.registration,
    aircraftLabel: flight.aircraftLabel,
    cooperativeId: flight.cooperativeId,
    harvestLandedUtc: isoUtc(flight.harvestLandedUnix),
    records: flight.records,
    sla: flight.sla,
    publicKey: flight.publicKeyBase64,
    signature: flight.signature,
  };
}

export function getBinaryPreview(manifestId: string): BinaryPreview | undefined {
  const flight = requireFlight(manifestId);
  if (flight === undefined) {
    return undefined;
  }
  return {
    manifestId: flight.manifest.manifestId,
    byteLength: flight.burst.byteLength,
    hexPreview: toHexPreview(flight.burst),
    base64: bytesToBase64(flight.burst),
  };
}

export async function auditManifest(manifestId: string): Promise<AuditResult | undefined> {
  const flight = requireFlight(manifestId);
  if (flight === undefined) {
    return undefined;
  }
  try {
    const decoded = decodeBurstStream(flight.burst);
    if (decoded.length !== flight.records.length) {
      return {
        manifestId,
        verified: false,
        breached: flight.clearance === "REJECTED",
        message: "Burst frame count did not match the sealed manifest.",
      };
    }
    const key = publicKeyFromRawBase64(flight.publicKeyBase64);
    const verified = await verifyManifestSignature(key, canonicalSummaryBytes(flight.summary), flight.signature);
    if (!verified) {
      return {
        manifestId,
        verified: false,
        breached: flight.clearance === "REJECTED",
        message: "Ed25519 signature rejected.",
      };
    }
    if (flight.clearance === "REJECTED") {
      return {
        manifestId,
        verified: true,
        breached: true,
        message: "Signature valid. Sealed record includes the lid breach and thermal excursion.",
      };
    }
    return {
      manifestId,
      verified: true,
      breached: false,
      message: "Immutable Record Verified — Zero Post-Harvest Tampering",
    };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "Integrity check failed";
    return {
      manifestId,
      verified: false,
      breached: flight.clearance === "REJECTED",
      message: detail,
    };
  }
}

/** Raw registry access for the Sprint 2 verifier. */
export function getFleetRecord(manifestId: string): FleetRecord | undefined {
  return requireFlight(manifestId);
}
