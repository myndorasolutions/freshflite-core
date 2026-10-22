"use client";

import { useEffect, useRef, useState } from "react";
import { generateSimulatedFlightQI0412 } from "@freshflite/shared-schema/flight";
import { cn } from "@/lib/cn";

const TELEMETRY_URL = process.env.NEXT_PUBLIC_TELEMETRY_URL ?? "http://127.0.0.1:4000";

const GROUND_BADGE = "🟢 4G LTE ACTIVE (Ground Ping)";
const SILENT_BADGE = "🔇 ICAO SILENT MODE (AT+CPOWD=1 / RF OFF - Buffering to SPIFFS)";
const BURST_BADGE = "⚡ 4G BURST SYNC (Flushing 1,615B Flash Buffer)";

const ICAO_SILENT_ALERT =
  "✈️ [ICAO ANNEX 6] Pod FF-S3-01A (Flight QI-0412) detected 1.38g takeoff roll at UYO. Baseband AT+CPOWD=1 executed. RF radios OFF; logging to SPIFFS flash.";

const CLEARANCE_ALERT =
  "✅ [IBOM AIR CLEARANCE] Flight QI-0412 landed at LOS. 62 buffered SPIFFS frames (1,054 bytes) synced in 1.8s. Thermal Integrity: 100.0% (-2°C..+4°C). Ready for buyer handoff.";

const BREACH_ALERT =
  "🚨 [CRITICAL COLD-CHAIN ALERT] Pod FF-S3-03C (Flight QI-0419) reported LID_BREACH (>200 lux) & Temp +6.40°C! Hold cargo at destination desk.";

type RadioState = "ONLINE_4G" | "ICAO_SILENT_RADIO_OFF" | "BURST_SYNC_COMPLETE";

interface FeedItem {
  id: string;
  message: string;
  at: string;
}

interface StreamPod {
  radio: RadioState;
  spiffsFrames: number;
  spiffsBytes: number;
}

interface StreamAlert {
  id?: string;
  message: string;
  createdAt?: string;
}

interface StreamState {
  pods?: Record<string, StreamPod>;
  dispatchNotifications?: StreamAlert[];
}

type StreamEvent =
  | { type: "snapshot"; state: StreamState }
  | { type: "radio"; podId: string; radio: RadioState; spiffsFrames: number; spiffsBytes: number }
  | { type: "alert"; alert: StreamAlert }
  | { type: "telemetry"; podId: string; temperatureC: number; peakAccelMg: number };

function badgeFor(radio: RadioState): string {
  if (radio === "ICAO_SILENT_RADIO_OFF") {
    return SILENT_BADGE;
  }
  if (radio === "BURST_SYNC_COMPLETE") {
    return BURST_BADGE;
  }
  return GROUND_BADGE;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForLive(scenario: "QI-0412" | "QI-0419", isCurrent: () => boolean): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 8000 && isCurrent()) {
    const response = await fetch(`${TELEMETRY_URL}/api/telemetry/state`);
    if (response.ok) {
      const body = (await response.json()) as StreamState;
      const alerts = body.dispatchNotifications ?? [];
      if (scenario === "QI-0412") {
        const pod = body.pods?.["FF-S3-01A"];
        const cleared = alerts.some((alert) => alert.message === CLEARANCE_ALERT);
        if (pod?.radio === "BURST_SYNC_COMPLETE" && cleared) {
          return;
        }
      } else if (alerts.some((alert) => alert.message === BREACH_ALERT)) {
        return;
      }
    }
    await delay(150);
  }
}

export function LiveFlightBar() {
  const [source, setSource] = useState<"checking" | "live" | "standalone">("checking");
  const [badge, setBadge] = useState("Awaiting flight");
  const [spiffs, setSpiffs] = useState("SPIFFS buffer idle");
  const [sample, setSample] = useState("No live sample yet");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [running, setRunning] = useState(false);
  const sourceRef = useRef(source);
  const runToken = useRef(0);
  sourceRef.current = source;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, 800);
    void fetch(`${TELEMETRY_URL}/api/health`, { signal: controller.signal })
      .then((response) => {
        setSource(response.ok ? "live" : "standalone");
      })
      .catch(() => {
        setSource("standalone");
      })
      .finally(() => {
        clearTimeout(timer);
      });
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (source !== "live") {
      return;
    }
    const stream = new EventSource(`${TELEMETRY_URL}/api/telemetry/stream`);
    stream.onmessage = (event: MessageEvent<string>) => {
      const parsed: unknown = JSON.parse(event.data);
      if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
        return;
      }
      const message = parsed as StreamEvent;
      if (message.type === "snapshot") {
        const alerts = message.state.dispatchNotifications ?? [];
        setFeed(
          alerts.map((alert, index) => ({
            id: alert.id ?? `snap-${String(index)}`,
            message: alert.message,
            at: alert.createdAt ?? "",
          })),
        );
        const pod = message.state.pods?.["FF-S3-01A"] ?? Object.values(message.state.pods ?? {})[0];
        if (pod !== undefined) {
          setBadge(badgeFor(pod.radio));
          setSpiffs(`SPIFFS buffer ${String(pod.spiffsFrames)} frames · ${pod.spiffsBytes.toLocaleString()} bytes`);
        }
        return;
      }
      if (message.type === "radio") {
        setBadge(badgeFor(message.radio));
        setSpiffs(`SPIFFS buffer ${String(message.spiffsFrames)} frames · ${message.spiffsBytes.toLocaleString()} bytes`);
        return;
      }
      if (message.type === "alert") {
        setFeed((current) => [
          ...current,
          {
            id: message.alert.id ?? `alert-${String(current.length)}`,
            message: message.alert.message,
            at: message.alert.createdAt ?? new Date().toISOString(),
          },
        ]);
        return;
      }
      if (message.type === "telemetry") {
        setSample(`${message.podId} · ${message.temperatureC.toFixed(2)}°C · ${String(message.peakAccelMg)} mG`);
      }
    };
    return () => {
      stream.close();
    };
  }, [source]);

  async function start(scenario: "QI-0412" | "QI-0419"): Promise<void> {
    runToken.current += 1;
    const token = runToken.current;
    setRunning(true);
    setFeed([]);
    try {
      if (sourceRef.current === "live") {
        const response = await fetch(`${TELEMETRY_URL}/api/simulator/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenario }),
        });
        if (!response.ok) {
          const detail = await response.text();
          pushFeed(`Dispatch link rejected the ${scenario} run. ${detail}`);
          return;
        }
        await waitForLive(scenario, () => runToken.current === token);
        return;
      }
      await playStandalone(scenario, token);
    } finally {
      if (runToken.current === token) {
        setRunning(false);
      }
    }
  }

  async function playStandalone(scenario: "QI-0412" | "QI-0419", token: number): Promise<void> {
    if (scenario === "QI-0419") {
      setBadge("🚨 LID BREACH · +6.40°C");
      setSample("FF-S3-03C · 6.40°C · lid open");
      setSpiffs("SPIFFS buffer held for quarantine");
      pushFeed(BREACH_ALERT);
      return;
    }

    const flight = generateSimulatedFlightQI0412();
    const ground = flight.records.slice(0, 33);
    const silent = flight.records.slice(33);
    setBadge(GROUND_BADGE);
    setSpiffs("SPIFFS buffer idle");
    for (const record of ground) {
      if (runToken.current !== token) {
        return;
      }
      setSample(`FF-S3-01A · ${record.temperatureC.toFixed(2)}°C · ${String(record.peakAccelMg)} mG`);
      await delay(48);
    }
    if (runToken.current !== token) {
      return;
    }
    setBadge(SILENT_BADGE);
    pushFeed(ICAO_SILENT_ALERT);
    for (let index = 0; index < silent.length; index += 1) {
      if (runToken.current !== token) {
        return;
      }
      const record = silent[index];
      if (record !== undefined) {
        setSample(`FF-S3-01A · ${record.temperatureC.toFixed(2)}°C · ${String(record.peakAccelMg)} mG`);
      }
      const frames = index + 1;
      setSpiffs(`SPIFFS buffer ${String(frames)} frames · ${(frames * 17).toLocaleString()} bytes`);
      await delay(42);
    }
    if (runToken.current !== token) {
      return;
    }
    await delay(700);
    setBadge(BURST_BADGE);
    setSpiffs("SPIFFS buffer 62 frames · 1,054 bytes");
    pushFeed(CLEARANCE_ALERT);
  }

  function pushFeed(message: string): void {
    setFeed((current) => [
      ...current,
      { id: `${String(Date.now())}-${String(current.length)}`, message, at: new Date().toISOString() },
    ]);
  }

  return (
    <section className="mt-4 rounded-xl border border-white/10 bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Live Flight Telemetry & ICAO Radio Simulator</h2>
          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-400">
            SIM7600E-H · {source === "live" ? "broker on :4000" : source === "standalone" ? "standalone playback" : "checking link"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={running || source === "checking"}
            onClick={() => {
              void start("QI-0412");
            }}
            className="rounded-full border border-aviation/50 px-3 py-1.5 text-sm text-emerald-100 disabled:opacity-40"
          >
            Fly QI-0412
          </button>
          <button
            type="button"
            disabled={running || source === "checking"}
            onClick={() => {
              void start("QI-0419");
            }}
            className="rounded-full border border-red-400/50 px-3 py-1.5 text-sm text-red-100 disabled:opacity-40"
          >
            QI-0419 breach
          </button>
        </div>
      </div>
      <p
        className={cn(
          "mt-4 rounded-lg border border-white/10 bg-ink/60 px-3 py-2 text-sm",
          badge.startsWith("🚨") ? "text-red-200" : "text-slate-100",
        )}
      >
        {badge}
      </p>
      <p className="mt-2 text-xs text-slate-400">
        {spiffs} · {sample}
      </p>
      <div className="mt-4">
        <h3 className="text-xs uppercase tracking-[0.16em] text-slate-400">WhatsApp / SMS Ibom Air dispatch feed</h3>
        <ol className="mt-2 max-h-48 space-y-2 overflow-auto">
          {feed.length === 0 ? (
            <li className="text-sm text-slate-500">No dispatch alerts yet.</li>
          ) : (
            feed.map((item) => (
              <li key={item.id} className="rounded-lg border border-white/10 bg-ink/50 px-3 py-2 text-sm text-slate-100">
                {item.message}
              </li>
            ))
          )}
        </ol>
      </div>
    </section>
  );
}
