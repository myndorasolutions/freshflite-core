import type { KeyObject } from "node:crypto";
import type { CargoManifest, FreshFliteTelemetryRecord } from "@freshflite/shared-schema";

export type RadioState = "ONLINE_4G" | "ICAO_SILENT_RADIO_OFF" | "BURST_SYNC_COMPLETE";

export type TimescaleStatus = "memory" | "connected" | "unavailable";

export type Scenario = "QI-0412" | "QI-0419";

export type SimulatorMode = "demo" | "step";

export type AlertKind = "icao" | "clearance" | "sla";

export type AuditReason = "CRC32_MISMATCH" | "SIGNATURE_INVALID";

export interface DispatchNotification {
  id: string;
  kind: AlertKind;
  channel: "whatsapp+sms";
  podId: string;
  flightNumber: string;
  message: string;
  createdAt: string;
}

export interface SecurityAuditEntry {
  reason: AuditReason;
  podId: string;
  topic: string;
  detail: string;
  at: string;
}

export interface PodLiveState {
  podId: string;
  radio: RadioState;
  spiffsFrames: number;
  spiffsBytes: number;
  mqttConnected: boolean;
}

export interface StoredTelemetry {
  podId: string;
  time: string;
  unixTimestamp: number;
  manifestId: string;
  podUuid: string;
  temperatureC: number;
  temperatureCenti: number;
  humidityPct: number;
  humidityCenti: number;
  batterySocPct: number;
  tamperStatus: number;
  flightState: number;
  peakAccelMg: number;
  crc32Checksum: number;
  raw17bHex: string;
  record: FreshFliteTelemetryRecord;
}

export interface StoredManifest {
  manifestId: string;
  podUuid: string;
  cooperativeOrigin: string;
  species: string;
  weightKg: number;
  flightNumber: string;
  aircraftType: string;
  originAirport: string;
  destinationAirport: string;
  slaMinC: number;
  slaMaxC: number;
  publicKeyHex: string;
  signatureHex: string;
  status: string;
}

export interface RegisteredPod {
  podId: string;
  manifest: CargoManifest;
  publicKey: KeyObject | null;
  publicKeyHex: string;
}

export interface TelemetrySnapshot {
  broker: "up";
  timescale: TimescaleStatus;
  activePods: number;
  records: StoredTelemetry[];
  pods: Record<string, PodLiveState>;
  dispatchNotifications: DispatchNotification[];
  securityAuditLog: SecurityAuditEntry[];
}

export type LiveEvent =
  | { type: "snapshot"; state: TelemetrySnapshot }
  | {
      type: "radio";
      podId: string;
      radio: RadioState;
      spiffsFrames: number;
      spiffsBytes: number;
      mqttConnected: boolean;
    }
  | { type: "alert"; alert: DispatchNotification }
  | { type: "security"; entry: SecurityAuditEntry }
  | {
      type: "telemetry";
      podId: string;
      unixTimestamp: number;
      temperatureC: number;
      peakAccelMg: number;
      flightState: number;
      tamperStatus: number;
    };
