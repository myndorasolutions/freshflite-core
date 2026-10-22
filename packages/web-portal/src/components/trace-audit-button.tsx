"use client";

import { useState } from "react";
import type { ManifestSealSummary } from "@freshflite/shared-schema";
import { describeSealAudit } from "@/lib/seal-audit";
import { cn } from "@/lib/cn";

export function TraceAuditButton({
  publicKey,
  signature,
  summary,
  breached,
}: {
  publicKey: string;
  signature: string;
  summary: ManifestSealSummary;
  breached: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  async function runAudit(): Promise<void> {
    setBusy(true);
    try {
      const result = await describeSealAudit({ publicKey, signature, summary, breached });
      setVerified(result.verified);
      setMessage(result.message);
    } catch {
      setVerified(false);
      setMessage("Audit request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void runAudit();
        }}
        disabled={busy}
        className="w-full rounded-md bg-white px-3 py-3 text-sm font-semibold text-ink disabled:opacity-60"
      >
        {busy ? "Auditing…" : "Run Live Cryptographic Audit"}
      </button>
      {message !== null ? (
        <p
          role="status"
          className={cn(
            "mt-3 rounded-md px-3 py-3 text-sm font-medium",
            verified === true ? "bg-emerald-500/20 text-emerald-100" : "bg-red-500/20 text-red-100",
          )}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
