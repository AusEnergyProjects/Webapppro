"use client";

import { buildNem12ChartModel, formatHalfHourBin } from "@/lib/electricity/nem12-chart";
import type { Nem12Success } from "@/lib/electricity/nem12-types";

interface Nem12UsageChartProps {
  data: Nem12Success;
}

const WIDTH = 700;
const HEIGHT = 240;
const LEFT = 46;
const RIGHT = 14;
const TOP = 16;
const BOTTOM = 30;

function pathFor(values: number[], maximum: number): string {
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  return values.map((value, index) => {
    const x = LEFT + ((index + 0.5) / 48) * plotWidth;
    const y = TOP + plotHeight - (maximum > 0 ? value / maximum : 0) * plotHeight;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

export function Nem12UsageChart({ data }: Nem12UsageChartProps) {
  const model = buildNem12ChartModel(data);
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const ticks = [0, 12, 24, 36, 48];
  const labels = ["12am", "6am", "12pm", "6pm", "12am"];

  return (
    <section aria-labelledby="nem12-chart-title" className="rounded-xl border border-emerald-100 bg-white p-4">
      <h3 id="nem12-chart-title" className="font-serif font-bold text-emerald-950">Your measured electricity pattern</h3>
      <p className="mt-1 text-sm text-slate-600">
        Based on {data.spanDays} observed days. The busiest average interval is {formatHalfHourBin(model.busiestBin)}.
      </p>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Average weekday and weekend electricity usage by half hour" className="mt-3 w-full">
        {ticks.map((tick, index) => {
          const x = LEFT + (tick / 48) * plotWidth;
          return (
            <g key={tick}>
              <line x1={x} y1={TOP} x2={x} y2={TOP + plotHeight} stroke="#e5efe9" />
              <text x={x} y={HEIGHT - 9} fill="#5f7268" fontSize="11" textAnchor="middle">{labels[index]}</text>
            </g>
          );
        })}
        <text x={LEFT} y={TOP - 4} fill="#5f7268" fontSize="10">kWh per 30 minutes</text>
        <path d={pathFor(model.weekday, model.maximum)} fill="none" stroke="#0e7a44" strokeWidth="2.5" />
        {model.weekend ? <path d={pathFor(model.weekend, model.maximum)} fill="none" stroke="#3bbf86" strokeWidth="2" strokeDasharray="5 4" /> : null}
      </svg>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
        <div><dt className="text-slate-500">Average day</dt><dd className="font-bold text-emerald-950">{model.averageDailyKwh.toFixed(1)} kWh</dd></div>
        <div><dt className="text-slate-500">Example peak window</dt><dd className="font-bold text-emerald-950">{model.peakPercent}%</dd></div>
        <div><dt className="text-slate-500">Example shoulder window</dt><dd className="font-bold text-emerald-950">{model.shoulderPercent}%</dd></div>
        <div><dt className="text-slate-500">Overnight and weekends</dt><dd className="font-bold text-emerald-950">{model.offPeakPercent}%</dd></div>
      </dl>
      <p className="mt-2 text-xs text-slate-500">The example windows are for orientation only. Plan pricing must use each retailer&apos;s published time windows.</p>
    </section>
  );
}
