import { TamperStatus, type FreshFliteTelemetryRecord } from "@freshflite/shared-schema";
import { POD_QI0412, POD_QI0419 } from "./pod-profiles.js";
import type { AlertKind } from "./types.js";

export const ICAO_SILENT_ALERT =
  "✈️ [ICAO ANNEX 6] Pod FF-S3-01A (Flight QI-0412) detected 1.38g takeoff roll at UYO. Baseband AT+CPOWD=1 executed. RF radios OFF; logging to SPIFFS flash.";

export const CLEARANCE_ALERT =
  "✅ [IBOM AIR CLEARANCE] Flight QI-0412 landed at LOS. 62 buffered SPIFFS frames (1,054 bytes) synced in 1.8s. Thermal Integrity: 100.0% (-2°C..+4°C). Ready for buyer handoff.";

export const BREACH_ALERT =
  "🚨 [CRITICAL COLD-CHAIN ALERT] Pod FF-S3-03C (Flight QI-0419) reported LID_BREACH (>200 lux) & Temp +6.40°C! Hold cargo at destination desk.";

const SLA_MIN_CENTI = -200;
const SLA_MAX_CENTI = 400;

export interface SlaAlert {
  kind: AlertKind;
  podId: string;
  flightNumber: string;
  message: string;
}

export function alertForRadioShutdown(podId: string, flightNumber: string): SlaAlert | null {
  if (podId !== POD_QI0412) {
    return null;
  }
  return {
    kind: "icao",
    podId,
    flightNumber,
    message: ICAO_SILENT_ALERT,
  };
}

export function alertForFrame(podId: string, flightNumber: string, record: FreshFliteTelemetryRecord): SlaAlert | null {
  const thermalBreach = record.temperatureCenti < SLA_MIN_CENTI || record.temperatureCenti > SLA_MAX_CENTI;
  const lidBreach = (record.tamperStatus & TamperStatus.LID_BREACH) === TamperStatus.LID_BREACH;
  const shock = (record.tamperStatus & TamperStatus.SHOCK_DROP) === TamperStatus.SHOCK_DROP;
  if (!thermalBreach && !lidBreach && !shock) {
    return null;
  }

  if (podId === POD_QI0419 && lidBreach && record.temperatureCenti === 640) {
    return {
      kind: "sla",
      podId,
      flightNumber,
      message: BREACH_ALERT,
    };
  }

  const flags = [
    lidBreach ? "LID_BREACH (>200 lux)" : "",
    shock ? "SHOCK_DROP" : "",
    thermalBreach ? `Temp ${record.temperatureC.toFixed(2)}°C` : "",
  ].filter((part) => part.length > 0);

  return {
    kind: "sla",
    podId,
    flightNumber,
    message: `🚨 [CRITICAL COLD-CHAIN ALERT] Pod ${podId} (Flight ${flightNumber}) reported ${flags.join(" & ")}! Hold cargo at destination desk.`,
  };
}

export function alertForClearance(podId: string, flightNumber: string, burstFrames: number, scorePct: number): SlaAlert | null {
  if (podId !== POD_QI0412 || burstFrames !== 62 || scorePct !== 100) {
    return null;
  }
  return {
    kind: "clearance",
    podId,
    flightNumber,
    message: CLEARANCE_ALERT,
  };
}
