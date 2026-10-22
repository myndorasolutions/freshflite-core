import Link from "next/link";
import { notFound } from "next/navigation";
import { ThermalSvg } from "@/components/thermal-svg";
import { TraceAuditButton } from "@/components/trace-audit-button";
import { getDispatchFlight } from "@/lib/fleet-data";
import { cn } from "@/lib/cn";

export function generateStaticParams(): { id: string }[] {
  return [
    { id: "FF-MAN-QI0412-20261014" },
    { id: "FF-MAN-QI0208-20261014" },
    { id: "FF-MAN-QI0419-20261014" },
  ];
}

export const dynamicParams = false;

export default async function TracePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const flight = getDispatchFlight(id);
  if (flight === undefined) {
    notFound();
  }

  const breached = flight.clearance === "REJECTED";
  const inBand = flight.minTemperatureC >= -2 && flight.maxTemperatureC <= 4;

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-4 py-6">
      <p className="text-center text-[11px] uppercase tracking-[0.22em] text-aviation">FreshTrace · Ibom Air</p>
      <h1 className="mt-2 text-center text-xl font-semibold">Buyer receipt</h1>

      <section
        className={cn(
          "mt-5 rounded-2xl border px-4 py-5 text-center",
          breached ? "border-red-400/60 bg-red-500/10" : "border-aviation/60 bg-emerald-500/10",
        )}
      >
        <p className={cn("text-sm font-bold tracking-wide", breached ? "text-red-200" : "text-emerald-200")}>
          {breached ? "COLD CHAIN BREACH / TAMPER ALERT" : "VERIFIED COLD CHAIN SEAL"}
        </p>
        <p className="mt-2 text-xs text-slate-300">
          {flight.flightNumber} · {flight.registration}
        </p>
      </section>

      <section className="mt-4 rounded-2xl border border-white/10 bg-panel p-4">
        <h2 className="text-xs uppercase tracking-[0.16em] text-slate-400">1. Origin provenance seal</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div>
            <dt className="text-slate-400">Harvest jetty</dt>
            <dd>{flight.cooperativeOrigin}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Landing timestamp</dt>
            <dd className="font-mono text-xs">{flight.harvestLandedUtc}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Cooperative ID</dt>
            <dd className="font-mono">{flight.cooperativeId}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Species</dt>
            <dd>{flight.species}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Net weight</dt>
            <dd>{flight.weightKg.toFixed(1)} kg</dd>
          </div>
        </dl>
      </section>

      <section className="mt-4 rounded-2xl border border-white/10 bg-panel p-4">
        <h2 className="text-xs uppercase tracking-[0.16em] text-slate-400">2. Flight route clearance</h2>
        <p className="mt-3 text-lg font-semibold">{flight.flightNumber}</p>
        <p className="text-sm text-slate-300">
          {flight.aircraftLabel} · {flight.aircraftType} · {flight.registration}
        </p>
        <p className="mt-2 text-sm">
          {flight.originAirport} → {flight.destinationAirport}
        </p>
        <p
          className={cn(
            "mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold",
            flight.silent ? "bg-emerald-500/15 text-emerald-200" : "bg-red-500/15 text-red-200",
          )}
        >
          {flight.silent ? "ICAO Silent Mode Verified" : "ICAO Silent Mode Missing"}
        </p>
      </section>

      <section className="mt-4 rounded-2xl border border-white/10 bg-panel p-4">
        <h2 className="text-xs uppercase tracking-[0.16em] text-slate-400">3. Thermal integrity score</h2>
        <p className={cn("mt-3 text-4xl font-semibold", breached ? "text-red-300" : "text-aviation")}>
          {flight.scorePct.toFixed(1)}%
        </p>
        <p className="text-sm text-slate-300">
          {flight.scorePct === 100
            ? "Perfect Cold Compliance"
            : breached
              ? "Cold Compliance breached"
              : "Cold Compliance"}
        </p>
        <p className="mt-2 text-xs text-slate-400">
          Min {flight.minTemperatureC.toFixed(2)}°C · Max {flight.maxTemperatureC.toFixed(2)}°C ·{" "}
          {flight.excursionCount} excursions
        </p>
        <div className="mt-3">
          <ThermalSvg points={flight.points} />
        </div>
        <p className="text-xs text-slate-400">
          {inBand
            ? "The voyage stayed inside −2°C to +4°C."
            : "The voyage left the −2°C to +4°C SLA band."}
        </p>
      </section>

      <section className="mt-4 rounded-2xl border border-white/10 bg-panel p-4">
        <h2 className="text-xs uppercase tracking-[0.16em] text-slate-400">4. Cryptographic proof</h2>
        <dl className="mt-3 space-y-2 text-xs">
          <div>
            <dt className="text-slate-400">Pod</dt>
            <dd>
              {flight.podId} · <span className="font-mono">{flight.podUuid}</span>
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Binary frames</dt>
            <dd>
              {flight.recordCount} frames / {flight.byteLength.toLocaleString()} bytes
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">IEEE 802.3 CRC32</dt>
            <dd>Valid on every decoded frame</dd>
          </div>
          <div>
            <dt className="text-slate-400">Ed25519 public key</dt>
            <dd className="break-all font-mono">{flight.publicKey}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Digital signature</dt>
            <dd className="break-all font-mono">{flight.signature}</dd>
          </div>
        </dl>
        <div className="mt-4">
          <TraceAuditButton
            publicKey={flight.publicKey}
            signature={flight.signature}
            summary={flight.sealSummary}
            breached={flight.clearance === "REJECTED"}
          />
        </div>
      </section>

      <Link href={`/dispatch?flight=${flight.flightNumber}`} className="mt-6 block text-center text-sm text-aviation">
        Back to dispatch
      </Link>
    </main>
  );
}
