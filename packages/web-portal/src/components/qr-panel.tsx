"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

export function QrPanel({ manifestId, flightNumber }: { manifestId: string; flightNumber: string }) {
  const path = `/trace/${manifestId}`;
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const url = origin === "" ? path : `${origin}${path}`;

  return (
    <section className="rounded-xl border border-white/10 bg-panel p-4">
      <h2 className="text-sm font-semibold tracking-wide">FreshTrace QR</h2>
      <p className="mt-1 text-xs text-slate-400">
        Scannable receipt for {flightNumber}. Encodes {path}.
      </p>
      <div className="mt-4 flex justify-center rounded-lg bg-ink p-3">
        <QRCodeSVG value={url} size={156} bgColor="#0B132B" fgColor="#E8EEF7" level="M" />
      </div>
      <p className="mt-2 break-all text-center font-mono text-[10px] text-slate-500">{url}</p>
      <Link
        href={path}
        className="mt-4 block rounded-md border border-aviation/50 px-3 py-2 text-center text-sm font-semibold text-aviation"
      >
        Open Buyer Receipt View
      </Link>
    </section>
  );
}
