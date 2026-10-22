"use client";

import { useRef, useState } from "react";
import type { ChartPoint, DispatchFlightView } from "@/lib/fleet-data";
import { describeSealAudit } from "@/lib/seal-audit";
import { bytesToHex, flightStateLabel, readFrameFields, stageLabel, tamperLabel } from "@/lib/frame-view";
import { cn } from "@/lib/cn";

interface FrameInspectorProps {
  flight: DispatchFlightView;
  point: ChartPoint;
}

const GROUPS: { label: string; start: number; end: number; tone: string }[] = [
  { label: "0..3 timestamp", start: 0, end: 3, tone: "border-sky-400/70 text-sky-200" },
  { label: "4..5 temp", start: 4, end: 5, tone: "border-aviation text-emerald-200" },
  { label: "6..7 humidity", start: 6, end: 7, tone: "border-slate-500 text-slate-300" },
  { label: "8 battery", start: 8, end: 8, tone: "border-slate-500 text-slate-300" },
  { label: "9 tamper", start: 9, end: 9, tone: "border-amber-400 text-amber-200" },
  { label: "10 flight state", start: 10, end: 10, tone: "border-amber-300 text-amber-100" },
  { label: "11..12 accel", start: 11, end: 12, tone: "border-slate-500 text-slate-300" },
  { label: "13..16 CRC32", start: 13, end: 16, tone: "border-rose-400 text-rose-200" },
];

export function FrameInspector({ flight, point }: FrameInspectorProps) {
  const fields = readFrameFields(point.frame);
  const [auditMessage, setAuditMessage] = useState<string | null>(null);
  const [auditOk, setAuditOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [clearanceNote, setClearanceNote] = useState<string | null>(null);
  const selectionKey = `${flight.manifestId}:${String(point.index)}`;
  const selectionRef = useRef(selectionKey);
  selectionRef.current = selectionKey;
  const [seenKey, setSeenKey] = useState(selectionKey);
  if (seenKey !== selectionKey) {
    setSeenKey(selectionKey);
    setAuditMessage(null);
    setAuditOk(null);
    setClearanceNote(null);
    setBusy(false);
  }

  async function verifySeal(): Promise<void> {
    const requestKey = selectionKey;
    setBusy(true);
    try {
      const result = await describeSealAudit({
        publicKey: flight.publicKey,
        signature: flight.signature,
        summary: flight.sealSummary,
        breached: flight.clearance === "REJECTED",
      });
      if (selectionRef.current !== requestKey) {
        return;
      }
      setAuditOk(result.verified);
      setAuditMessage(result.message);
    } catch {
      if (selectionRef.current !== requestKey) {
        return;
      }
      setAuditOk(false);
      setAuditMessage("Audit request failed");
    } finally {
      if (selectionRef.current === requestKey) {
        setBusy(false);
      }
    }
  }

  function issueClearance(): void {
    if (flight.clearance === "REJECTED") {
      setClearanceNote(
        `Clearance refused for ${flight.flightNumber}: lid breach and thermal excursion (${flight.scorePct.toFixed(1)}% compliance).`,
      );
      return;
    }
    setClearanceNote(
      `Airside dispatch clearance issued for ${flight.flightNumber} · ${flight.registration}.`,
    );
  }

  return (
    <section className="rounded-xl border border-white/10 bg-panel p-4">
      <h2 className="text-sm font-semibold tracking-wide">Binary frame inspector</h2>
      <p className="mt-1 text-xs text-slate-400">
        Minute {point.minute} · {point.timestampUtc} · {stageLabel(point.flightState, point.peakAccelMg)}
      </p>
      <p className="mt-3 font-mono text-[11px] leading-5 text-slate-200">{bytesToHex(point.frame)}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        {GROUPS.map((group) => (
          <div key={group.label} className={cn("rounded border px-2 py-1", group.tone)}>
            <dt className="uppercase tracking-wide opacity-80">{group.label}</dt>
            <dd className="font-mono">
              {point.frame
                .slice(group.start, group.end + 1)
                .map((byte) => byte.toString(16).padStart(2, "0"))
                .join(" ")}
            </dd>
          </div>
        ))}
      </dl>
      <dl className="mt-3 space-y-1 text-xs text-slate-300">
        <div className="flex justify-between gap-3">
          <dt>Timestamp</dt>
          <dd className="font-mono">{fields.unixTimestamp}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Temperature</dt>
          <dd className="font-mono">{(fields.temperatureCenti / 100).toFixed(2)}°C</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Flight state</dt>
          <dd className="font-mono">{flightStateLabel(fields.flightState)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Tamper</dt>
          <dd className="font-mono">{tamperLabel(fields.tamperStatus)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>CRC32</dt>
          <dd className="font-mono">0x{fields.checksumCrc32.toString(16).padStart(8, "0")}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => {
            void verifySeal();
          }}
          disabled={busy}
          className="rounded-md bg-aviation px-3 py-2 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {busy ? "Verifying…" : "Verify CRC32 & Ed25519 Seal"}
        </button>
        <button
          type="button"
          onClick={issueClearance}
          className="rounded-md border border-white/15 px-3 py-2 text-sm font-semibold text-slate-100"
        >
          Issue Airside Dispatch Clearance
        </button>
      </div>
      {auditMessage !== null ? (
        <p
          role="status"
          className={cn(
            "mt-3 rounded-md px-3 py-2 text-xs",
            auditOk === true ? "bg-emerald-500/15 text-emerald-200" : "bg-red-500/15 text-red-200",
          )}
        >
          {auditMessage}
        </p>
      ) : null}
      {clearanceNote !== null ? (
        <p
          role="status"
          className={cn(
            "mt-2 rounded-md px-3 py-2 text-xs",
            flight.clearance === "REJECTED" ? "bg-red-500/15 text-red-200" : "bg-emerald-500/15 text-emerald-200",
          )}
        >
          {clearanceNote}
        </p>
      ) : null}
    </section>
  );
}
