import { createRequire } from "node:module";
import type { CargoManifest, FreshFliteTelemetryRecord } from "@freshflite/shared-schema";
import type { StoredManifest, StoredTelemetry, TimescaleStatus } from "./types.js";

interface PgClient {
  connect: () => Promise<void>;
  query: (text: string, values?: unknown[]) => Promise<unknown>;
  end: () => Promise<void>;
}

export class TelemetryStore {
  private readonly rows: StoredTelemetry[] = [];
  private readonly manifests = new Map<string, StoredManifest>();
  private pg: PgClient | null = null;
  timescale: TimescaleStatus = "memory";

  list(podId?: string): StoredTelemetry[] {
    if (podId === undefined) {
      return [...this.rows];
    }
    return this.rows.filter((row) => row.podId === podId);
  }

  upsertManifest(manifest: CargoManifest, status: string, publicKeyHex: string, signatureHex: string): void {
    const row: StoredManifest = {
      manifestId: manifest.manifestId,
      podUuid: manifest.podUuid,
      cooperativeOrigin: manifest.cooperativeOrigin,
      species: manifest.species,
      weightKg: manifest.weightKg,
      flightNumber: manifest.flightNumber,
      aircraftType: manifest.aircraftType,
      originAirport: manifest.originAirport,
      destinationAirport: manifest.destinationAirport,
      slaMinC: manifest.slaMinC,
      slaMaxC: manifest.slaMaxC,
      publicKeyHex,
      signatureHex,
      status,
    };
    this.manifests.set(manifest.manifestId, row);
    if (this.pg !== null) {
      void this.insertManifest(row).catch((error: unknown) => {
        this.timescale = "unavailable";
        console.warn("Timescale manifest write failed", error);
      });
    }
  }

  sealManifest(manifestId: string, signatureHex: string, status: string): void {
    const current = this.manifests.get(manifestId);
    if (current === undefined) {
      return;
    }
    current.signatureHex = signatureHex;
    current.status = status;
    if (this.pg !== null) {
      void this.insertManifest(current).catch((error: unknown) => {
        this.timescale = "unavailable";
        console.warn("Timescale manifest seal failed", error);
      });
    }
  }

  insert(row: StoredTelemetry): boolean {
    const duplicate = this.rows.some(
      (existing) => existing.podId === row.podId && existing.unixTimestamp === row.unixTimestamp,
    );
    if (duplicate) {
      return false;
    }
    this.rows.push(row);
    if (this.pg !== null) {
      void this.insertTelemetry(row).catch((error: unknown) => {
        this.timescale = "unavailable";
        console.warn("Timescale telemetry write failed", error);
      });
    }
    return true;
  }

  async attachTimescale(connectionString: string | undefined): Promise<TimescaleStatus> {
    if (connectionString === undefined || connectionString.length === 0) {
      this.timescale = "memory";
      return this.timescale;
    }
    const require = createRequire(import.meta.url);
    const pgModule = require("pg") as {
      Client: new (config: { connectionString: string; connectionTimeoutMillis: number }) => PgClient;
    };
    const client = new pgModule.Client({
      connectionString,
      connectionTimeoutMillis: 1500,
    });
    try {
      await client.connect();
      this.pg = client;
      this.timescale = "connected";
    } catch (error: unknown) {
      this.timescale = "unavailable";
      console.warn("Timescale unavailable, using the in-memory store", error);
      await client.end().catch(() => undefined);
    }
    return this.timescale;
  }

  async close(): Promise<void> {
    if (this.pg !== null) {
      await this.pg.end();
      this.pg = null;
    }
  }

  private async insertManifest(row: StoredManifest): Promise<void> {
    const pg = this.pg;
    if (pg === null) {
      return;
    }
    await pg.query(
      `INSERT INTO manifests (
        manifest_id, pod_uuid, cooperative_origin, species, weight_kg, flight_number,
        aircraft_type, origin_airport, destination_airport, sla_min_c, sla_max_c,
        public_key_hex, signature_hex, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (manifest_id) DO UPDATE SET
        public_key_hex = EXCLUDED.public_key_hex,
        signature_hex = EXCLUDED.signature_hex,
        status = EXCLUDED.status`,
      [
        row.manifestId,
        row.podUuid,
        row.cooperativeOrigin,
        row.species,
        row.weightKg,
        row.flightNumber,
        row.aircraftType,
        row.originAirport,
        row.destinationAirport,
        row.slaMinC,
        row.slaMaxC,
        row.publicKeyHex,
        row.signatureHex,
        row.status,
      ],
    );
  }

  private async insertTelemetry(row: StoredTelemetry): Promise<void> {
    const pg = this.pg;
    if (pg === null) {
      return;
    }
    await pg.query(
      `INSERT INTO pod_telemetry (
        time, manifest_id, pod_uuid, temperature_c, humidity_pct, battery_soc_pct,
        tamper_status, flight_state, peak_accel_mg, crc32_checksum, raw_17b_hex
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (time, pod_uuid) DO NOTHING`,
      [
        row.time,
        row.manifestId,
        row.podUuid,
        row.temperatureC,
        row.humidityPct,
        row.batterySocPct,
        row.tamperStatus,
        row.flightState,
        row.peakAccelMg,
        row.crc32Checksum,
        row.raw17bHex,
      ],
    );
  }
}

export function toStoredRow(
  podId: string,
  manifest: CargoManifest,
  record: FreshFliteTelemetryRecord,
  raw: Uint8Array,
): StoredTelemetry {
  return {
    podId,
    time: new Date(record.unixTimestamp * 1000).toISOString(),
    unixTimestamp: record.unixTimestamp,
    manifestId: manifest.manifestId,
    podUuid: manifest.podUuid,
    temperatureC: record.temperatureC,
    temperatureCenti: record.temperatureCenti,
    humidityPct: record.humidityPct,
    humidityCenti: record.humidityCenti,
    batterySocPct: record.batterySocPct,
    tamperStatus: record.tamperStatus,
    flightState: record.flightState,
    peakAccelMg: record.peakAccelMg,
    crc32Checksum: record.checksumCrc32,
    raw17bHex: Buffer.from(raw).toString("hex"),
    record,
  };
}
