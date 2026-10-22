/** Lid and shock flags packed into the single tamper byte. */
export enum TamperStatus {
  OK = 0x00,
  LID_BREACH = 0x01,
  SHOCK_DROP = 0x02,
  LID_AND_SHOCK = 0x03,
}

/** ICAO Annex 6 radio-silence phases for the cargo pod. */
export enum FlightState {
  GROUND_PREFLIGHT = 0x00,
  IN_FLIGHT_SILENT = 0x01,
  POST_TOUCHDOWN_BURST = 0x02,
}

export type AircraftType = "CRJ-900" | "A220-300";
export type OriginAirport = "UYO";
export type DestinationAirport = "LOS" | "ABV";

/** Integer fields written into the 17-byte frame. Centi units are the source of truth. */
export interface FreshFliteWireFields {
  unixTimestamp: number;
  temperatureCenti: number;
  humidityCenti: number;
  batterySocPct: number;
  tamperStatus: TamperStatus;
  flightState: FlightState;
  peakAccelMg: number;
}

/** Decoded telemetry, including human-readable units derived from the centi integers. */
export interface FreshFliteTelemetryRecord extends FreshFliteWireFields {
  temperatureC: number;
  humidityPct: number;
  checksumCrc32: number;
}

export interface CargoManifest {
  manifestId: string;
  podUuid: string;
  cooperativeOrigin: string;
  species: string;
  weightKg: number;
  flightNumber: string;
  aircraftType: AircraftType;
  originAirport: OriginAirport;
  destinationAirport: DestinationAirport;
  slaMinC: number;
  slaMaxC: number;
}

export interface ThermalSlaReport {
  thermalIntegrityScorePct: number;
  excursionCount: number;
  minTemperatureC: number;
  maxTemperatureC: number;
  sampleCount: number;
  icaoSilentModeEngagedOnHighG: boolean;
  highGSampleCount: number;
}

/** FreshTrace™ certificate sealed with an Ed25519 signature over the flight summary. */
export interface FreshTraceCertificate {
  manifest: CargoManifest;
  thermalIntegrityScorePct: number;
  excursionCount: number;
  minTemperatureC: number;
  maxTemperatureC: number;
  icaoSilentModeEngaged: boolean;
  signature: string;
  publicKey: string;
  recordCount: number;
  issuedAtUnix: number;
}

/** Canonical bytes covered by the pod's Ed25519 seal. */
export interface ManifestSealSummary {
  manifestId: string;
  podUuid: string;
  flightNumber: string;
  aircraftType: AircraftType;
  originAirport: OriginAirport;
  destinationAirport: DestinationAirport;
  cooperativeOrigin: string;
  species: string;
  recordCount: number;
  thermalIntegrityScorePct: number;
  excursionCount: number;
  minTemperatureC: number;
  maxTemperatureC: number;
  icaoSilentModeEngaged: boolean;
  burstCrc32: number;
}

/** Raised when a frame length or IEEE CRC32 does not match the packed contract. */
export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrityError";
  }
}
