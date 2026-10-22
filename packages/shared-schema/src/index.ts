export {
  FlightState,
  IntegrityError,
  TamperStatus,
} from "./types.js";
export type {
  AircraftType,
  CargoManifest,
  DestinationAirport,
  FreshFliteTelemetryRecord,
  FreshFliteWireFields,
  FreshTraceCertificate,
  ManifestSealSummary,
  OriginAirport,
  ThermalSlaReport,
} from "./types.js";

export { computeCrc32 } from "./crc32.js";

export {
  HIGH_G_SILENT_THRESHOLD_MG,
  PACKET_BYTE_LENGTH,
  decodeBurstStream,
  decodeRecord,
  encodeBurstStream,
  encodeRecord,
  evaluateThermalSLA,
} from "./codec.js";

export {
  canonicalSummaryBytes,
  generatePodKeyPair,
  publicKeyFromRawBase64,
  signManifestSummary,
  verifyManifestSignature,
} from "./crypto.js";
export type { PodKeyPair } from "./crypto.js";

export {
  QI0412_MANIFEST,
  QI0412_RECORD_COUNT,
  QI0412_START_UNIX,
  buildSealSummary,
  generateSimulatedFlightQI0412,
} from "./demo-flight.js";
export type { SimulatedFlight } from "./demo-flight.js";
