"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { DispatchFlightView } from "@/lib/fleet-data";
import { cn } from "@/lib/cn";
import { FrameInspector } from "@/components/frame-inspector";
import { LiveFlightBar } from "@/components/live-flight-bar";
import { QrPanel } from "@/components/qr-panel";
import { VoyageCharts } from "@/components/voyage-charts";

const KPIS = [
  { label: "Active Pods in Transit", value: "3" },
  { label: "Fleet Thermal SLA Score", value: "99.7%" },
  { label: "ICAO Annex 6 Silent Mode", value: "100%" },
  { label: "Binary Bandwidth Saved", value: "91.87%" },
] as const;

function scoreTone(score: number, clearance: DispatchFlightView["clearance"]): string {
  if (clearance === "REJECTED") {
    return "text-red-300";
  }
  if (score < 100) {
    return "text-amber-300";
  }
  return "text-aviation";
}

export function DispatchConsole({
  flights,
  initialFlightNumber,
}: {
  flights: DispatchFlightView[];
  initialFlightNumber: string;
}) {
  const initial = flights.find((flight) => flight.flightNumber === initialFlightNumber) ?? flights[0];
  const [manifestId, setManifestId] = useState(initial?.manifestId ?? "");
  const flight = flights.find((item) => item.manifestId === manifestId) ?? flights[0];
  const [minute, setMinute] = useState(flight?.takeoffMinute ?? 0);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("flight");
    if (requested === null) {
      return;
    }
    const match = flights.find((item) => item.flightNumber === requested);
    if (match === undefined) {
      return;
    }
    setManifestId(match.manifestId);
    setMinute(match.takeoffMinute);
  }, [flights]);

  const point = useMemo(() => {
    if (flight === undefined) {
      return undefined;
    }
    return flight.points[minute] ?? flight.points[flight.takeoffMinute] ?? flight.points[0];
  }, [flight, minute]);

  if (flight === undefined || point === undefined) {
    return <p className="p-8">No manifests loaded.</p>;
  }

  function selectFlight(next: DispatchFlightView): void {
    setManifestId(next.manifestId);
    setMinute(next.takeoffMinute);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-aviation">Ibom Air · FreshFlite</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Cargo Dispatch</h1>
          <p className="mt-1 text-sm text-slate-400">Victor Attah hold telemetry for coastal seafood uplifts.</p>
        </div>
        <nav className="flex gap-3 text-sm">
          <Link href="/" className="text-slate-300 underline-offset-4 hover:underline">
            Command
          </Link>
          <Link href="/dispatch" className="text-slate-300 underline-offset-4 hover:underline">
            Dispatch
          </Link>
        </nav>
      </header>

      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS.map((kpi) => (
          <article key={kpi.label} className="rounded-xl border border-white/10 bg-panel px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{kpi.label}</p>
            <p className="mt-2 text-2xl font-semibold text-aviation">{kpi.value}</p>
          </article>
        ))}
      </section>

      <section className="mt-6">
        <h2 className="text-xs uppercase tracking-[0.16em] text-slate-400">Flight selector</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {flights.map((item) => {
            const active = item.manifestId === flight.manifestId;
            return (
              <button
                key={item.manifestId}
                type="button"
                onClick={() => {
                  selectFlight(item);
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm",
                  active ? "border-aviation bg-aviation/15 text-emerald-100" : "border-white/15 text-slate-300",
                  item.clearance === "REJECTED" && !active ? "border-red-400/50 text-red-200" : "",
                )}
              >
                {item.selectorLabel}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-white/10 bg-panel/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold">
              {flight.flightNumber} · {flight.registration}
            </p>
            <p className="text-sm text-slate-300">{flight.routeLabel}</p>
            <p className="mt-1 text-sm text-slate-400">
              {flight.weightKg.toFixed(1)} kg {flight.species} · Pod {flight.podId} · {flight.aircraftLabel}
            </p>
          </div>
          <div className="text-right">
            <p className={cn("text-3xl font-semibold", scoreTone(flight.scorePct, flight.clearance))}>
              {flight.scorePct.toFixed(1)}%
            </p>
            <p className="text-xs uppercase tracking-wide text-slate-400">
              {flight.clearance === "REJECTED" ? "Rejected / alert" : "Cold compliance"} · {flight.excursionCount}{" "}
              excursions
            </p>
            <p className="text-xs text-slate-400">
              {flight.silent ? "ICAO silent mode verified" : "Silent mode missing"} · {flight.recordCount} frames /{" "}
              {flight.byteLength.toLocaleString()} bytes
            </p>
          </div>
        </div>
      </section>

      <LiveFlightBar />

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.9fr)]">
        <section className="rounded-xl border border-white/10 bg-panel p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Voyage thermal and kinetic chart</h2>
            <label className="text-xs text-slate-400">
              Sample
              <input
                className="ml-2 align-middle accent-emerald-500"
                type="range"
                min={0}
                max={flight.points.length - 1}
                value={point.index}
                onChange={(event) => {
                  setMinute(Number(event.target.value));
                }}
              />
            </label>
          </div>
          <VoyageCharts
            points={flight.points}
            preflightEnd={flight.preflightEnd}
            takeoffMinute={flight.takeoffMinute}
            touchdownMinute={flight.touchdownMinute}
            onSelect={setMinute}
          />
        </section>
        <div className="space-y-4">
          <FrameInspector flight={flight} point={point} />
          <QrPanel manifestId={flight.manifestId} flightNumber={flight.flightNumber} />
        </div>
      </div>
    </div>
  );
}
