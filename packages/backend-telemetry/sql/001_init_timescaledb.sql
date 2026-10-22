CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS manifests (
  manifest_id TEXT PRIMARY KEY,
  pod_uuid TEXT NOT NULL,
  cooperative_origin TEXT NOT NULL,
  species TEXT NOT NULL,
  weight_kg DOUBLE PRECISION NOT NULL,
  flight_number TEXT NOT NULL,
  aircraft_type TEXT NOT NULL,
  origin_airport TEXT NOT NULL,
  destination_airport TEXT NOT NULL,
  sla_min_c DOUBLE PRECISION NOT NULL,
  sla_max_c DOUBLE PRECISION NOT NULL,
  public_key_hex TEXT NOT NULL DEFAULT '',
  signature_hex TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pod_telemetry (
  time TIMESTAMPTZ NOT NULL,
  manifest_id TEXT NOT NULL,
  pod_uuid TEXT NOT NULL,
  temperature_c DOUBLE PRECISION NOT NULL,
  humidity_pct DOUBLE PRECISION NOT NULL,
  battery_soc_pct SMALLINT NOT NULL,
  tamper_status SMALLINT NOT NULL,
  flight_state SMALLINT NOT NULL,
  peak_accel_mg INTEGER NOT NULL,
  crc32_checksum BIGINT NOT NULL,
  raw_17b_hex TEXT NOT NULL,
  UNIQUE (time, pod_uuid)
);

SELECT create_hypertable('pod_telemetry', 'time', if_not_exists => TRUE);

CREATE MATERIALIZED VIEW pod_telemetry_5m_rollup
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('5 minutes', time) AS bucket,
  pod_uuid,
  manifest_id,
  AVG(temperature_c) AS avg_temperature_c,
  MIN(temperature_c) AS min_temperature_c,
  MAX(temperature_c) AS max_temperature_c,
  AVG(humidity_pct) AS avg_humidity_pct,
  MIN(battery_soc_pct) AS min_battery_soc_pct,
  MAX(tamper_status) AS max_tamper_status,
  MAX(peak_accel_mg) AS max_peak_accel_mg,
  COUNT(*) AS sample_count
FROM pod_telemetry
GROUP BY bucket, pod_uuid, manifest_id
WITH NO DATA;
