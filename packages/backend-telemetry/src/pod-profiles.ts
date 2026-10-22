import type { CargoManifest } from "@freshflite/shared-schema";
import { QI0412_MANIFEST } from "@freshflite/shared-schema";

export const POD_QI0412 = "FF-S3-01A";
export const POD_QI0419 = "FF-S3-03C";

export const QI0419_MANIFEST: CargoManifest = {
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

export function manifestForPod(podId: string): CargoManifest | undefined {
  if (podId === POD_QI0412) {
    return QI0412_MANIFEST;
  }
  if (podId === POD_QI0419) {
    return QI0419_MANIFEST;
  }
  return undefined;
}
