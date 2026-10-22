"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  FLAGSHIP_MANIFEST_IDS,
  companionSignatureMatches,
  findCompanionManifest,
  type StoredCompanionManifest,
} from "@/lib/companion-packout";

type LookupState =
  | { kind: "pending" }
  | { kind: "missing" }
  | { kind: "redirect" }
  | { kind: "found"; record: StoredCompanionManifest; verified: boolean };

export function TraceLookup() {
  const [state, setState] = useState<LookupState>({ kind: "pending" });

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id")?.trim() ?? "";
    if (id.length === 0) {
      setState({ kind: "missing" });
      return;
    }
    if ((FLAGSHIP_MANIFEST_IDS as readonly string[]).includes(id)) {
      setState({ kind: "redirect" });
      window.location.replace(`/trace/${id}/`);
      return;
    }
    const record = findCompanionManifest(id, window.localStorage);
    if (record === undefined) {
      setState({ kind: "missing" });
      return;
    }
    void companionSignatureMatches(record).then((verified) => {
      setState({ kind: "found", record, verified });
    });
  }, []);

  if (state.kind === "pending" || state.kind === "redirect") {
    return <p className="px-4 py-10 text-center text-sm text-slate-400">Opening FreshTrace receipt…</p>;
  }

  if (state.kind === "missing") {
    return (
      <main className="mx-auto max-w-md px-4 py-10 text-center">
        <h1 className="text-xl font-semibold">FreshTrace receipt</h1>
        <p className="mt-3 text-sm text-slate-400">
          No sealed manifest was found for this scan. Pair the shipper in the coastal companion, then scan the label again
          on this device.
        </p>
        <Link href="/companion" className="mt-6 inline-block text-sm text-aviation">
          Open coastal companion
        </Link>
      </main>
    );
  }

  const { record, verified } = state;
  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-4 py-6">
      <p className="text-center text-[11px] uppercase tracking-[0.22em] text-aviation">FreshTrace · field seal</p>
      <h1 className="mt-2 text-center text-xl font-semibold">{record.manifestId}</h1>
      <section
        className={
          verified
            ? "mt-5 rounded-2xl border border-aviation/60 bg-emerald-500/10 px-4 py-5 text-center"
            : "mt-5 rounded-2xl border border-red-400/60 bg-red-500/10 px-4 py-5 text-center"
        }
      >
        <p className="text-sm font-bold tracking-wide">{verified ? "ED25519 SEAL VERIFIED" : "SEAL REJECTED"}</p>
        <p className="mt-2 text-xs text-slate-300">
          {record.flightNumber} · {record.podId}
        </p>
      </section>
      <dl className="mt-4 space-y-2 rounded-2xl border border-white/10 bg-panel p-4 text-sm">
        <div>
          <dt className="text-slate-400">Origin</dt>
          <dd>{record.payload.cooperativeOrigin}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Species</dt>
          <dd>{record.payload.species}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Net weight</dt>
          <dd>{record.payload.weightKg.toFixed(1)} kg</dd>
        </div>
        <div>
          <dt className="text-slate-400">Shipper</dt>
          <dd className="font-mono">{record.barcode}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Route</dt>
          <dd>
            {record.payload.originAirport} → {record.payload.destinationAirport} · {record.payload.aircraftType}
          </dd>
        </div>
      </dl>
      <Link
        href={`/?flight=${record.flightNumber}`}
        className="mt-6 block text-center text-sm text-aviation"
      >
        Launch Flight in Ibom Air Dispatch -&gt;
      </Link>
    </main>
  );
}
