import { runScenario, type SpiffsObservation } from "./flight-simulator.js";
import { startIngestionWorker, type IngestionWorker } from "./ingestion-worker.js";
import { startMqttBroker } from "./mqtt-broker.js";
import { NotificationDispatcher } from "./notification-dispatcher.js";
import { POD_QI0412, POD_QI0419 } from "./pod-profiles.js";
import { TelemetryStore } from "./telemetry-store.js";
import type {
  LiveEvent,
  PodLiveState,
  RadioState,
  RegisteredPod,
  Scenario,
  SecurityAuditEntry,
  SimulatorMode,
  StoredTelemetry,
  TelemetrySnapshot,
  TimescaleStatus,
} from "./types.js";

export interface EngineOptions {
  mqttPort: number;
  wsPort?: number;
  useTimescale: boolean;
}

export interface TelemetryEngine {
  readonly mqttUrl: string;
  readonly securityAuditLog: SecurityAuditEntry[];
  timescale: TimescaleStatus;
  snapshot: () => TelemetrySnapshot;
  subscribe: (listener: (event: LiveEvent) => void) => () => void;
  isRunning: () => boolean;
  run: (scenario: Scenario, mode: SimulatorMode, observer?: (observation: SpiffsObservation) => void) => Promise<void>;
  getHandled: () => number;
  waitForHandled: (target: number) => Promise<void>;
  isClientConnected: (clientId: string) => boolean;
  close: () => Promise<void>;
}

export async function createTelemetryEngine(options: EngineOptions): Promise<TelemetryEngine> {
  let onSession: (clientId: string, connected: boolean) => void = () => undefined;
  const broker = await startMqttBroker({
    mqttPort: options.mqttPort,
    wsPort: options.wsPort,
    onSession: (clientId, connected) => {
      onSession(clientId, connected);
    },
  });
  const store = new TelemetryStore();
  const timescale = options.useTimescale
    ? await store.attachTimescale(process.env.DATABASE_URL)
    : store.timescale;
  const dispatcher = new NotificationDispatcher();
  const securityAuditLog: SecurityAuditEntry[] = [];
  const pods = new Map<string, PodLiveState>();
  const registry = new Map<string, RegisteredPod>();
  let handled = 0;
  let running = false;
  let worker: IngestionWorker | null = null;

  const engine: TelemetryEngine = {
    mqttUrl: `mqtt://127.0.0.1:${String(broker.port)}`,
    securityAuditLog,
    timescale,
    snapshot,
    subscribe: (listener) => dispatcher.subscribe(listener),
    isRunning: () => running,
    run,
    getHandled: () => handled,
    waitForHandled,
    isClientConnected: (clientId) => broker.isClientConnected(clientId),
    close,
  };

  onSession = (clientId, connected) => {
    if (clientId === "freshflite-ingestion" || clientId === "spoof-probe") {
      return;
    }
    const pod = ensurePod(clientId);
    pod.mqttConnected = connected;
    emitPod(pod);
  };

  worker = await startIngestionWorker(engine.mqttUrl, {
    store,
    dispatcher,
    securityAuditLog,
    lookupPod: (podId) => registry.get(podId),
    setRadio,
    setSpiffs,
    noteHandled: () => {
      handled += 1;
    },
    onTelemetry: (podId, record) => {
      dispatcher.emit({
        type: "telemetry",
        podId,
        unixTimestamp: record.unixTimestamp,
        temperatureC: record.temperatureC,
        peakAccelMg: record.peakAccelMg,
        flightState: record.flightState,
        tamperStatus: record.tamperStatus,
      });
    },
  });

  return engine;

  function snapshot(): TelemetrySnapshot {
    const podView: Record<string, PodLiveState> = {};
    for (const [podId, pod] of pods) {
      podView[podId] = { ...pod };
    }
    return {
      broker: "up",
      timescale: store.timescale,
      activePods: activePodCount(),
      records: store.list().map(publicRecord),
      pods: podView,
      dispatchNotifications: [...dispatcher.queue],
      securityAuditLog: [...securityAuditLog],
    };
  }

  async function run(
    scenario: Scenario,
    mode: SimulatorMode,
    observer?: (observation: SpiffsObservation) => void,
  ): Promise<void> {
    if (running) {
      throw new Error("simulator already running");
    }
    running = true;
    try {
      const podId = scenario === "QI-0412" ? POD_QI0412 : POD_QI0419;
      dispatcher.clearPod(podId);
      const existing = pods.get(podId);
      if (existing !== undefined) {
        existing.radio = "ONLINE_4G";
        existing.spiffsFrames = 0;
        existing.spiffsBytes = 0;
        emitPod(existing);
      }
      await runScenario(scenario, {
        mqttUrl: engine.mqttUrl,
        mode,
        isClientConnected: (clientId) => broker.isClientConnected(clientId),
        registerPod: (pod) => {
          registry.set(pod.podId, pod);
          store.upsertManifest(pod.manifest, "IN_TRANSIT", pod.publicKeyHex, "");
        },
        onSpiffs: (observation) => {
          setSpiffs(observation.podId, observation.frames, observation.bytes);
          const pod = pods.get(observation.podId);
          if (pod !== undefined) {
            pod.mqttConnected = observation.connected;
          }
          observer?.(observation);
        },
        getHandled: () => handled,
        waitForHandled,
        waitForStored: async (podId, count) => {
          const start = Date.now();
          while (store.list(podId).length < count) {
            if (Date.now() - start > 5000) {
              throw new Error(`Timed out waiting for ${String(count)} stored frames from ${podId}`);
            }
            await delay(10);
          }
        },
      });
    } finally {
      running = false;
    }
  }

  async function waitForHandled(target: number): Promise<void> {
    const start = Date.now();
    while (handled < target) {
      if (Date.now() - start > 5000) {
        throw new Error(`Ingestion stalled at ${String(handled)} of ${String(target)} MQTT messages`);
      }
      await delay(10);
    }
  }

  function setRadio(podId: string, radio: RadioState): void {
    const existing = pods.get(podId);
    if (existing === undefined) {
      const created = emptyPod(podId, radio);
      pods.set(podId, created);
      emitPod(created);
      return;
    }
    if (radio === "ONLINE_4G" && existing.radio !== "ONLINE_4G") {
      return;
    }
    if (existing.radio === radio) {
      return;
    }
    existing.radio = radio;
    emitPod(existing);
  }

  function setSpiffs(podId: string, frames: number, bytes: number): void {
    const pod = ensurePod(podId);
    if (pod.spiffsFrames === frames && pod.spiffsBytes === bytes) {
      return;
    }
    pod.spiffsFrames = frames;
    pod.spiffsBytes = bytes;
    emitPod(pod);
  }

  function ensurePod(podId: string): PodLiveState {
    const existing = pods.get(podId);
    if (existing !== undefined) {
      return existing;
    }
    const created = emptyPod(podId, "ONLINE_4G");
    pods.set(podId, created);
    return created;
  }

  function emitPod(pod: PodLiveState): void {
    dispatcher.emit({
      type: "radio",
      podId: pod.podId,
      radio: pod.radio,
      spiffsFrames: pod.spiffsFrames,
      spiffsBytes: pod.spiffsBytes,
      mqttConnected: pod.mqttConnected,
    });
  }

  function activePodCount(): number {
    let count = 0;
    for (const pod of pods.values()) {
      if (pod.radio === "ONLINE_4G" || pod.radio === "ICAO_SILENT_RADIO_OFF") {
        count += 1;
      }
    }
    return count;
  }

  async function close(): Promise<void> {
    if (worker !== null) {
      await worker.close();
      worker = null;
    }
    await broker.close();
    await store.close();
  }
}

function emptyPod(podId: string, radio: RadioState): PodLiveState {
  return {
    podId,
    radio,
    spiffsFrames: 0,
    spiffsBytes: 0,
    mqttConnected: false,
  };
}

function publicRecord(row: StoredTelemetry): StoredTelemetry {
  return { ...row };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
