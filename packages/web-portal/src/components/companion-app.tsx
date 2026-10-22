"use client";

import { useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { TamperStatus } from "@freshflite/shared-schema";
import { cn } from "@/lib/cn";
import {
  DEFAULT_WEIGHT_KG,
  FLIGHT_OPTIONS,
  ORIGIN_JETTIES,
  POD_IDS,
  SHIPPER_BARCODE,
  SPECIES_OPTIONS,
  decodeDiagnostic,
  lidBlocksSeal,
  luxForLid,
  saveCompanionManifest,
  sealCompanionManifest,
  type CompanionDraft,
  type FlightNumber,
  type PodId,
  type StoredCompanionManifest,
} from "@/lib/companion-packout";

type Step = 1 | 2 | 3;

export function CompanionApp() {
  const [deviceFrame, setDeviceFrame] = useState(true);
  const [step, setStep] = useState<Step>(1);
  const [podId, setPodId] = useState<PodId>("FF-S3-01A");
  const [awake, setAwake] = useState(false);
  const [lidOpen, setLidOpen] = useState(false);
  const [origin, setOrigin] = useState<(typeof ORIGIN_JETTIES)[number]>("Oron Beach Aggregation Cluster #3");
  const [species, setSpecies] = useState<(typeof SPECIES_OPTIONS)[number]>("Jumbo Tiger Prawns (Penaeus monodon)");
  const [weightKg, setWeightKg] = useState(String(DEFAULT_WEIGHT_KG));
  const [flightNumber, setFlightNumber] = useState<FlightNumber>("QI-0412");
  const [barcode, setBarcode] = useState("");
  const [sealed, setSealed] = useState<StoredCompanionManifest | null>(null);
  const [traceUrl, setTraceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lux = luxForLid(lidOpen);
  const blocked = lidBlocksSeal(lux);
  const diagnostic = awake ? decodeDiagnostic(lidOpen) : null;

  function wakePod(): void {
    setAwake(true);
    setSealed(null);
    setTraceUrl("");
    setError(null);
  }

  function goToManifest(): void {
    if (!awake || diagnostic === null) {
      setError("Wake the pod before pairing a shipper.");
      return;
    }
    setError(null);
    setStep(2);
  }

  function goToSeal(): void {
    if (blocked) {
      setError("Close and seal the lid. TEMT6000 still reads above 200 lux.");
      return;
    }
    if (barcode.length === 0) {
      setError("Scan the thermal shipper barcode before arming the pod.");
      return;
    }
    const weight = Number(weightKg);
    if (!Number.isFinite(weight) || weight <= 0) {
      setError("Enter a net weight in kilograms.");
      return;
    }
    setError(null);
    setStep(3);
  }

  async function sealShipper(): Promise<void> {
    if (blocked) {
      setError("Safety interlock: lid open. Seal the PCM gel bricks before arming.");
      return;
    }
    const weight = Number(weightKg);
    const draft: CompanionDraft = {
      podId,
      origin,
      species,
      weightKg: weight,
      flightNumber,
      barcode,
    };
    setBusy(true);
    setError(null);
    try {
      const record = await sealCompanionManifest(draft, lidOpen);
      saveCompanionManifest(record, window.localStorage);
      setSealed(record);
      setTraceUrl(`${window.location.origin}/trace/?id=${encodeURIComponent(record.manifestId)}`);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Seal failed");
    } finally {
      setBusy(false);
    }
  }

  const screen = (
    <div className="w-full bg-ink px-4 py-5 text-slate-100">
      <p className="text-[11px] uppercase tracking-[0.22em] text-aviation">FreshFlite field companion</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Coastal packout</h1>
      <p className="mt-1 text-sm text-slate-400">Oron / Ibeno / Eastern Obolo → Victor Attah (UYO)</p>
      <ol className="mt-4 grid grid-cols-3 gap-2 text-[11px] uppercase tracking-wide">
        {([1, 2, 3] as const).map((item) => (
          <li
            key={item}
            className={cn(
              "rounded-md border px-2 py-2 text-center",
              step === item ? "border-aviation bg-aviation/15 text-emerald-100" : "border-white/10 text-slate-500",
            )}
          >
            Step {item}
          </li>
        ))}
      </ol>

      {blocked && awake ? (
        <p className="mt-4 rounded-lg border border-red-400/60 bg-red-500/15 px-3 py-3 text-sm text-red-100">
          Lid open at {lux} lux. Seal the container below 50 lux before Step 3. Hold cargo until TEMT6000 reports the lid
          closed.
        </p>
      ) : null}
      {error !== null ? (
        <p className="mt-3 rounded-lg border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">{error}</p>
      ) : null}

      {step === 1 ? (
        <section className="mt-5 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Pod</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {POD_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setPodId(id);
                    setAwake(false);
                    setSealed(null);
                  }}
                  className={cn(
                    "rounded-lg border px-2 py-3 text-sm font-semibold",
                    podId === id ? "border-aviation bg-aviation/15" : "border-white/15",
                  )}
                >
                  {id}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={wakePod}
            className="w-full rounded-xl bg-aviation px-4 py-4 text-base font-semibold text-ink"
          >
            Tap to Wake Pod via NFC / BLE 5.0
          </button>
          {diagnostic !== null ? (
            <dl className="space-y-3 rounded-xl border border-white/10 bg-panel p-4 text-sm">
              <div>
                <dt className="text-slate-400">Sensirion SHT31 temperature</dt>
                <dd className="text-lg font-semibold">{diagnostic.temperatureC.toFixed(2)}°C</dd>
                <dd className="text-xs text-emerald-200">Within −2°C to +4°C SLA</dd>
              </div>
              <div>
                <dt className="text-slate-400">SHT31 relative humidity</dt>
                <dd>{diagnostic.humidityPct.toFixed(2)}% RH</dd>
              </div>
              <div>
                <dt className="text-slate-400">18650 Li-Ion battery</dt>
                <dd>{diagnostic.batterySocPct}% SoC — UN 38.3 compliant</dd>
              </div>
              <div>
                <dt className="text-slate-400">LIS3DH 3-axis accelerometer</dt>
                <dd>
                  {diagnostic.peakAccelMg} mG / {(diagnostic.peakAccelMg / 1000).toFixed(2)}g stationary baseline
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">TEMT6000 optical light sensor</dt>
                <dd className="mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setLidOpen((current) => !current);
                    }}
                    className={cn(
                      "w-full rounded-lg border px-3 py-3 text-left text-sm",
                      lidOpen ? "border-red-400/70 text-red-100" : "border-emerald-400/60 text-emerald-100",
                    )}
                  >
                    Container lid status:{" "}
                    {lidOpen
                      ? `Lid Open (${lux} lux — TamperStatus.LID_BREACH)`
                      : `Lid Sealed with PCM Gel Bricks (${lux} lux — TamperStatus.OK)`}
                  </button>
                </dd>
                <dd className="mt-1 font-mono text-xs text-slate-500">
                  tamper 0x{diagnostic.tamperStatus.toString(16).padStart(2, "0")}
                  {diagnostic.tamperStatus === TamperStatus.LID_BREACH ? " lid breach" : " sealed"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">Radio silent until the handler taps the pod.</p>
          )}
          <button
            type="button"
            onClick={goToManifest}
            disabled={!awake}
            className="w-full rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold disabled:opacity-40"
          >
            Continue to manifest pairing
          </button>
        </section>
      ) : null}

      {step === 2 ? (
        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            goToSeal();
          }}
        >
          <label className="block text-sm">
            <span className="text-slate-400">Origin jetty</span>
            <select
              className="mt-1 w-full rounded-lg border border-white/15 bg-panel px-3 py-3"
              value={origin}
              onChange={(event) => {
                const next = ORIGIN_JETTIES.find((item) => item === event.target.value);
                if (next !== undefined) {
                  setOrigin(next);
                }
              }}
            >
              {ORIGIN_JETTIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Seafood species</span>
            <select
              className="mt-1 w-full rounded-lg border border-white/15 bg-panel px-3 py-3"
              value={species}
              onChange={(event) => {
                const next = SPECIES_OPTIONS.find((item) => item === event.target.value);
                if (next !== undefined) {
                  setSpecies(next);
                }
              }}
            >
              {SPECIES_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Net weight (kg)</span>
            <input
              className="mt-1 w-full rounded-lg border border-white/15 bg-panel px-3 py-3"
              inputMode="decimal"
              value={weightKg}
              onChange={(event) => {
                setWeightKg(event.target.value);
              }}
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Target Ibom Air flight</span>
            <select
              className="mt-1 w-full rounded-lg border border-white/15 bg-panel px-3 py-3"
              value={flightNumber}
              onChange={(event) => {
                const next = FLIGHT_OPTIONS.find((item) => item.flightNumber === event.target.value);
                if (next !== undefined) {
                  setFlightNumber(next.flightNumber);
                }
              }}
            >
              {FLIGHT_OPTIONS.map((item) => (
                <option key={item.flightNumber} value={item.flightNumber}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div>
            <p className="text-sm text-slate-400">Thermal shipper barcode</p>
            <p className="mt-1 min-h-6 font-mono text-sm">{barcode.length === 0 ? "Not scanned" : barcode}</p>
            <button
              type="button"
              onClick={() => {
                setBarcode(SHIPPER_BARCODE);
              }}
              className="mt-2 w-full rounded-lg border border-aviation/50 px-3 py-3 text-sm font-semibold text-emerald-100"
            >
              Scan {SHIPPER_BARCODE}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setStep(1);
              }}
              className="rounded-xl border border-white/20 px-4 py-3 text-sm"
            >
              Back
            </button>
            <button type="submit" className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-ink">
              Review cryptographic seal
            </button>
          </div>
        </form>
      ) : null}

      {step === 3 ? (
        <section className="mt-5 space-y-4">
          <div className="rounded-xl border border-white/10 bg-panel p-4 text-sm">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Ready to arm {podId}</p>
            <p className="mt-2">{species}</p>
            <p>
              {weightKg} kg · {origin}
            </p>
            <p>
              {flightNumber} · {barcode}
            </p>
          </div>
          <button
            type="button"
            disabled={busy || blocked}
            onClick={() => {
              void sealShipper();
            }}
            className="w-full rounded-xl bg-aviation px-4 py-4 text-base font-semibold text-ink disabled:opacity-40"
          >
            {busy ? "Signing…" : "Cryptographically Seal Shipper & Arm Pod"}
          </button>
          {sealed !== null && traceUrl.length > 0 ? (
            <div className="rounded-xl border border-white/10 bg-panel p-4">
              <p className="text-sm font-semibold">FreshTrace QR label</p>
              <p className="mt-1 break-all font-mono text-[10px] text-slate-400">{traceUrl}</p>
              <div className="mt-4 flex justify-center rounded-lg bg-ink p-3">
                <QRCodeSVG value={traceUrl} size={180} bgColor="#0B132B" fgColor="#E8EEF7" level="M" />
              </div>
              <Link
                href={`/?flight=${sealed.flightNumber}`}
                className="mt-4 block rounded-lg border border-aviation/50 px-3 py-3 text-center text-sm font-semibold text-emerald-100"
              >
                Launch Flight in Ibom Air Dispatch -&gt;
              </Link>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setStep(2);
            }}
            className="w-full rounded-xl border border-white/20 px-4 py-3 text-sm"
          >
            Back to manifest
          </button>
        </section>
      ) : null}
    </div>
  );

  return (
    <div className="bg-ink">
      <div className="mx-auto hidden max-w-5xl items-center justify-end px-4 py-3 md:flex">
        <button
          type="button"
          onClick={() => {
            setDeviceFrame((current) => !current);
          }}
          className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-slate-200"
        >
          {deviceFrame ? "Hide handheld frame" : "Show handheld frame"}
        </button>
      </div>
      <div className={cn("w-full", deviceFrame ? "md:mx-auto md:max-w-[420px] md:px-0 md:pb-10" : "md:max-w-3xl md:mx-auto")}>
        <div
          className={cn(
            deviceFrame
              ? "md:rounded-[2rem] md:border md:border-white/20 md:bg-black md:p-3 md:shadow-2xl"
              : "",
          )}
        >
          <div className={cn(deviceFrame ? "md:overflow-hidden md:rounded-[1.4rem]" : "")}>{screen}</div>
        </div>
      </div>
    </div>
  );
}
