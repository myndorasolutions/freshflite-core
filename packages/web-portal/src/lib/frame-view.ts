/** Browser-safe readers for a 17-byte little-endian FreshFliteRecord. */

export interface FrameFields {
  unixTimestamp: number;
  temperatureCenti: number;
  humidityCenti: number;
  batterySocPct: number;
  tamperStatus: number;
  flightState: number;
  peakAccelMg: number;
  checksumCrc32: number;
}

export function readFrameFields(frame: readonly number[]): FrameFields {
  const bytes = Uint8Array.from(frame);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    unixTimestamp: view.getUint32(0, true),
    temperatureCenti: view.getInt16(4, true),
    humidityCenti: view.getUint16(6, true),
    batterySocPct: view.getUint8(8),
    tamperStatus: view.getUint8(9),
    flightState: view.getUint8(10),
    peakAccelMg: view.getInt16(11, true),
    checksumCrc32: view.getUint32(13, true),
  };
}

export function toHexPreview(bytes: Uint8Array): string {
  const rows: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 17) {
    const slice = bytes.subarray(offset, offset + 17);
    const hex = Array.from(slice, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
    rows.push(`${offset.toString(16).padStart(4, "0")}: ${hex}`);
  }
  return rows.join("\n");
}

export function bytesToHex(frame: readonly number[]): string {
  return frame.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

const FLIGHT_STATE_LABELS: Record<number, string> = {
  0: "GROUND_PREFLIGHT",
  1: "IN_FLIGHT_SILENT",
  2: "POST_TOUCHDOWN_BURST",
};

const TAMPER_LABELS: Record<number, string> = {
  0: "OK",
  1: "LID_BREACH",
  2: "SHOCK_DROP",
  3: "LID_AND_SHOCK",
};

export function flightStateLabel(value: number): string {
  return FLIGHT_STATE_LABELS[value] ?? `UNKNOWN_${value.toString(16)}`;
}

export function tamperLabel(value: number): string {
  return TAMPER_LABELS[value] ?? `UNKNOWN_${value.toString(16)}`;
}

export function stageLabel(flightState: number, peakAccelMg: number): string {
  if (peakAccelMg > 1250 && flightState === 1) {
    return "Stage 3 Takeoff >1.25g ICAO Radio Blackout (SPIFFS Ring Buffer Active)";
  }
  if (flightState === 2) {
    return "Stage 4 Touchdown Burst Sync";
  }
  if (flightState === 0) {
    return "Stage 1/2 Ground Pre-Flight Pings";
  }
  return "Stage 3 In-Flight Silent (SPIFFS Ring Buffer Active)";
}
