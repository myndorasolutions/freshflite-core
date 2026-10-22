import {
  FlightState,
  TamperStatus,
  canonicalSummaryBytes,
  decodeRecord,
  encodeRecord,
  generatePodKeyPair,
  publicKeyFromRawBase64,
  signManifestSummary,
  verifyManifestSignature,
  type FreshFliteTelemetryRecord,
} from "@freshflite/shared-schema";

export const COMPANION_STORAGE_KEY = "freshflite.companion.manifests";
export const LID_OPEN_LUX = 420;
export const LID_SEALED_LUX = 18;
export const SHIPPER_BARCODE = "EPP-45L-AKW-009";
export const DEFAULT_WEIGHT_KG = 38.5;

export const POD_IDS = ["FF-S3-01A", "FF-S3-02B", "FF-S3-03C"] as const;
export type PodId = (typeof POD_IDS)[number];

export const ORIGIN_JETTIES = [
  "Oron Beach Aggregation Cluster #3",
  "Ibeno Artisanal Landing Jetty #1",
  "Eastern Obolo Cooperative Hub",
] as const;

export const SPECIES_OPTIONS = [
  "Jumbo Tiger Prawns (Penaeus monodon)",
  "Atlantic Croaker Fillet (Export Grade)",
  "Fresh Mud Crabs & Prawns",
] as const;

export const FLIGHT_OPTIONS = [
  {
    flightNumber: "QI-0412",
    label: "QI-0412 (UYO -> LOS | Bombardier CRJ 900)",
    aircraftType: "CRJ-900",
    originAirport: "UYO",
    destinationAirport: "LOS",
  },
  {
    flightNumber: "QI-0208",
    label: "QI-0208 (UYO -> ABV | Airbus A220-300)",
    aircraftType: "A220-300",
    originAirport: "UYO",
    destinationAirport: "ABV",
  },
] as const;

export const FLAGSHIP_MANIFEST_IDS = [
  "FF-MAN-QI0412-20261014",
  "FF-MAN-QI0208-20261014",
  "FF-MAN-QI0419-20261014",
] as const;

export type FlightNumber = (typeof FLIGHT_OPTIONS)[number]["flightNumber"];

export interface CompanionDraft {
  podId: PodId;
  origin: (typeof ORIGIN_JETTIES)[number];
  species: (typeof SPECIES_OPTIONS)[number];
  weightKg: number;
  flightNumber: FlightNumber;
  barcode: string;
}

export interface CompanionSealPayload {
  manifestId: string;
  podId: string;
  cooperativeOrigin: string;
  species: string;
  weightKg: number;
  flightNumber: string;
  aircraftType: "CRJ-900" | "A220-300";
  originAirport: "UYO";
  destinationAirport: "LOS" | "ABV";
  barcode: string;
  temperatureCenti: number;
  humidityCenti: number;
  batterySocPct: number;
  tamperStatus: number;
  peakAccelMg: number;
}

export interface StoredCompanionManifest {
  manifestId: string;
  podId: string;
  flightNumber: string;
  barcode: string;
  payload: CompanionSealPayload;
  publicKeyBase64: string;
  signature: string;
  createdAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function lidBlocksSeal(lux: number): boolean {
  return lux > 200;
}

export function lidAllowsSeal(lux: number): boolean {
  return lux < 50;
}

export function luxForLid(open: boolean): number {
  return open ? LID_OPEN_LUX : LID_SEALED_LUX;
}

/** Pack and unpack one ground diagnostic so the handheld shows codec fields, not hardcoded text. */
export function decodeDiagnostic(lidOpen: boolean): FreshFliteTelemetryRecord {
  return decodeRecord(
    encodeRecord({
      unixTimestamp: Math.floor(Date.UTC(2026, 9, 14, 6, 0, 0) / 1000),
      temperatureCenti: -145,
      humidityCenti: 8450,
      batterySocPct: 98,
      tamperStatus: lidOpen ? TamperStatus.LID_BREACH : TamperStatus.OK,
      flightState: FlightState.GROUND_PREFLIGHT,
      peakAccelMg: 1000,
    }),
  );
}

export async function sealCompanionManifest(draft: CompanionDraft, lidOpen: boolean): Promise<StoredCompanionManifest> {
  if (!lidAllowsSeal(luxForLid(lidOpen))) {
    throw new Error("Lid interlock blocked the seal");
  }
  const flight = FLIGHT_OPTIONS.find((item) => item.flightNumber === draft.flightNumber);
  if (flight === undefined) {
    throw new Error(`Unknown Ibom Air flight ${draft.flightNumber}`);
  }
  const diagnostic = decodeDiagnostic(lidOpen);
  const payload: CompanionSealPayload = {
    manifestId: `FF-MAN-${flight.flightNumber}-${draft.podId}-20261014`,
    podId: draft.podId,
    cooperativeOrigin: draft.origin,
    species: draft.species,
    weightKg: draft.weightKg,
    flightNumber: flight.flightNumber,
    aircraftType: flight.aircraftType,
    originAirport: flight.originAirport,
    destinationAirport: flight.destinationAirport,
    barcode: draft.barcode,
    temperatureCenti: diagnostic.temperatureCenti,
    humidityCenti: diagnostic.humidityCenti,
    batterySocPct: diagnostic.batterySocPct,
    tamperStatus: diagnostic.tamperStatus,
    peakAccelMg: diagnostic.peakAccelMg,
  };
  const keys = await generatePodKeyPair();
  const signature = await signManifestSummary(keys.privateKey, canonicalSummaryBytes(payload));
  return {
    manifestId: payload.manifestId,
    podId: draft.podId,
    flightNumber: flight.flightNumber,
    barcode: draft.barcode,
    payload,
    publicKeyBase64: keys.publicKeyBase64,
    signature,
    createdAt: new Date().toISOString(),
  };
}

export async function companionSignatureMatches(record: StoredCompanionManifest): Promise<boolean> {
  const key = publicKeyFromRawBase64(record.publicKeyBase64);
  return verifyManifestSignature(key, canonicalSummaryBytes(record.payload), record.signature);
}

export function readCompanionManifests(storage: StorageLike): StoredCompanionManifest[] {
  const raw = storage.getItem(COMPANION_STORAGE_KEY);
  if (raw === null || raw.length === 0) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isStoredManifest);
  } catch {
    return [];
  }
}

export function saveCompanionManifest(record: StoredCompanionManifest, storage: StorageLike): void {
  const next = [record, ...readCompanionManifests(storage).filter((item) => item.manifestId !== record.manifestId)];
  storage.setItem(COMPANION_STORAGE_KEY, JSON.stringify(next));
}

export function findCompanionManifest(manifestId: string, storage: StorageLike): StoredCompanionManifest | undefined {
  return readCompanionManifests(storage).find((item) => item.manifestId === manifestId);
}

function isStoredManifest(value: unknown): value is StoredCompanionManifest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Partial<StoredCompanionManifest>;
  return (
    typeof record.manifestId === "string" &&
    typeof record.podId === "string" &&
    typeof record.flightNumber === "string" &&
    typeof record.barcode === "string" &&
    typeof record.publicKeyBase64 === "string" &&
    typeof record.signature === "string" &&
    typeof record.createdAt === "string" &&
    isPayload(record.payload)
  );
}

function isPayload(value: unknown): value is CompanionSealPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const payload = value as Partial<CompanionSealPayload>;
  return (
    typeof payload.manifestId === "string" &&
    typeof payload.podId === "string" &&
    typeof payload.cooperativeOrigin === "string" &&
    typeof payload.species === "string" &&
    typeof payload.weightKg === "number" &&
    typeof payload.flightNumber === "string" &&
    typeof payload.barcode === "string"
  );
}
