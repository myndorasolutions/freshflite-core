"use client";

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartPoint } from "@/lib/fleet-data";
import { stageLabel } from "@/lib/frame-view";

interface VoyageChartsProps {
  points: ChartPoint[];
  preflightEnd: number;
  takeoffMinute: number;
  touchdownMinute: number;
  onSelect: (index: number) => void;
}

interface TooltipEntry {
  payload?: ChartPoint;
}

function readIndex(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

function VoyageTooltip({ active, payload }: { active?: boolean; payload?: readonly TooltipEntry[] }) {
  const point = payload?.[0]?.payload;
  if (active !== true || point === undefined) {
    return null;
  }
  return (
    <div className="rounded-md border border-white/10 bg-ink px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-slate-100">{stageLabel(point.flightState, point.peakAccelMg)}</p>
      <p className="mt-1 text-aviation">{point.temperatureC.toFixed(2)}°C</p>
      <p className="text-amber-300">{point.peakAccelMg} mG</p>
      <p className="text-slate-400">{point.timestampUtc}</p>
    </div>
  );
}

export function VoyageCharts({
  points,
  preflightEnd,
  takeoffMinute,
  touchdownMinute,
  onSelect,
}: VoyageChartsProps) {
  const selectFromChart = (state: { activeTooltipIndex?: number | string } | null): void => {
    const index = readIndex(state?.activeTooltipIndex);
    if (index !== undefined && index < points.length) {
      onSelect(index);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs uppercase tracking-[0.16em] text-slate-400">Temperature</p>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} syncId="voyage" onClick={selectFromChart}>
              <CartesianGrid stroke="#1e293b" />
              <XAxis dataKey="minute" stroke="#94a3b8" tick={{ fontSize: 11 }} />
              <YAxis
                domain={[-3, 8]}
                stroke="#94a3b8"
                tick={{ fontSize: 11 }}
                unit="°"
                width={42}
              />
              <Tooltip content={<VoyageTooltip />} />
              <ReferenceArea y1={-2} y2={4} fill="#10B981" fillOpacity={0.16} />
              <ReferenceLine y={-2} stroke="#ef4444" strokeDasharray="4 4" />
              <ReferenceLine y={4} stroke="#ef4444" strokeDasharray="4 4" />
              <ReferenceLine x={takeoffMinute} stroke="#f59e0b" />
              <ReferenceLine x={touchdownMinute} stroke="#38bdf8" />
              <Line
                type="monotone"
                dataKey="temperatureC"
                stroke="#10B981"
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs uppercase tracking-[0.16em] text-slate-400">
          Kinetic G-force and flight state
        </p>
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} syncId="voyage" onClick={selectFromChart}>
              <CartesianGrid stroke="#1e293b" />
              <XAxis dataKey="minute" stroke="#94a3b8" tick={{ fontSize: 11 }} />
              <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} width={48} />
              <Tooltip content={<VoyageTooltip />} />
              <ReferenceArea x1={0} x2={preflightEnd} fill="#334155" fillOpacity={0.25} />
              <ReferenceArea x1={takeoffMinute} x2={touchdownMinute} fill="#10B981" fillOpacity={0.08} />
              <ReferenceLine y={1250} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: "1.25g", fill: "#fbbf24", fontSize: 11 }} />
              <ReferenceLine x={takeoffMinute} stroke="#f59e0b" />
              <ReferenceLine x={touchdownMinute} stroke="#38bdf8" />
              <Line
                type="stepAfter"
                dataKey="peakAccelMg"
                stroke="#f8fafc"
                dot={false}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          Slate band: Stage 1/2 ground pre-flight. Amber line: Stage 3 takeoff above 1.25g, ICAO radio
          blackout, SPIFFS ring buffer active. Sky line: Stage 4 touchdown burst sync.
        </p>
      </div>
    </div>
  );
}
