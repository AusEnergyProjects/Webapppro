"use client";

import { useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { buildNem12ChartModel, formatHalfHourBin } from "@/lib/electricity/nem12-chart";
import type { Nem12Success } from "@/lib/electricity/nem12-types";

interface Nem12UsageChartProps {
  data: Nem12Success;
}

const WIDTH = 760;
const HEIGHT = 300;
const LEFT = 54;
const RIGHT = 18;
const TOP = 24;
const BOTTOM = 38;
const BINS = 48;

function xFor(index: number): number {
  return LEFT + ((index + 0.5) / BINS) * (WIDTH - LEFT - RIGHT);
}

function yFor(value: number, maximum: number): number {
  const plotHeight = HEIGHT - TOP - BOTTOM;
  return TOP + plotHeight - (maximum > 0 ? value / maximum : 0) * plotHeight;
}

function pathFor(values: number[], maximum: number): string {
  return values.map((value, index) => `${index === 0 ? "M" : "L"}${xFor(index).toFixed(1)} ${yFor(value, maximum).toFixed(1)}`).join(" ");
}

function areaPathFor(values: number[], maximum: number): string {
  const baseline = HEIGHT - BOTTOM;
  return `${pathFor(values, maximum)} L${xFor(values.length - 1).toFixed(1)} ${baseline} L${xFor(0).toFixed(1)} ${baseline} Z`;
}

export function Nem12UsageChart({ data }: Nem12UsageChartProps) {
  const model = buildNem12ChartModel(data);
  const [activeBin, setActiveBin] = useState(model.busiestBin);
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const xTicks = [0, 12, 24, 36, 48];
  const xLabels = ["12am", "6am", "12pm", "6pm", "12am"];
  const yTicks = [0, .25, .5, .75, 1];
  const weekdayValue = model.weekday[activeBin] ?? 0;
  const weekendValue = model.weekend?.[activeBin] ?? null;
  const activeX = xFor(activeBin);

  const selectPointerBin = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const chartX = ((event.clientX - bounds.left) / bounds.width) * WIDTH;
    const nextBin = Math.max(0, Math.min(BINS - 1, Math.floor(((chartX - LEFT) / plotWidth) * BINS)));
    setActiveBin(nextBin);
  };

  const selectKeyboardBin = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setActiveBin((current) => Math.max(0, Math.min(BINS - 1, current + (event.key === "ArrowRight" ? 1 : -1))));
  };

  return (
    <section aria-labelledby="nem12-chart-title" className="nem12-chart-card">
      <div className="nem12-chart-heading">
        <div><span>Measured load profile</span><h3 id="nem12-chart-title">Your electricity use across the day</h3><p>Based on {data.spanDays} observed days. The busiest average interval is {formatHalfHourBin(model.busiestBin)}.</p></div>
        <div className="nem12-chart-readout" aria-live="polite"><span>{formatHalfHourBin(activeBin)}</span><strong>{weekdayValue.toFixed(2)} kWh weekday</strong>{weekendValue !== null ? <small>{weekendValue.toFixed(2)} kWh weekend</small> : <small>No weekend intervals</small>}</div>
      </div>
      <div className="nem12-chart-legend" aria-label="Chart series"><span className="weekday">Weekday average</span>{model.weekend ? <span className="weekend">Weekend average</span> : null}<span className="window">Illustrative peak window</span></div>
      <div className="nem12-chart-shell">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Interactive average weekday and weekend electricity usage by half hour" aria-describedby="nem12-chart-help" tabIndex={0} onPointerMove={selectPointerBin} onKeyDown={selectKeyboardBin}>
          <defs>
            <linearGradient id="weekday-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#25f4d2" stopOpacity=".48" /><stop offset="100%" stopColor="#25f4d2" stopOpacity="0" /></linearGradient>
            <linearGradient id="weekend-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ffd84d" stopOpacity=".3" /><stop offset="100%" stopColor="#ffd84d" stopOpacity="0" /></linearGradient>
          </defs>
          <rect className="nem12-chart-peak-band" x={LEFT + (30 / BINS) * plotWidth} y={TOP} width={(12 / BINS) * plotWidth} height={plotHeight} rx="8" />
          {yTicks.map((ratio) => {
            const y = TOP + plotHeight - ratio * plotHeight;
            return <g key={ratio}><line className="nem12-chart-grid" x1={LEFT} y1={y} x2={WIDTH - RIGHT} y2={y} /><text className="nem12-chart-y-label" x={LEFT - 9} y={y + 4} textAnchor="end">{(model.maximum * ratio).toFixed(1)}</text></g>;
          })}
          {xTicks.map((tick, index) => {
            const x = LEFT + (tick / BINS) * plotWidth;
            return <g key={tick}><line className="nem12-chart-time-grid" x1={x} y1={TOP} x2={x} y2={TOP + plotHeight} /><text className="nem12-chart-x-label" x={x} y={HEIGHT - 10} textAnchor="middle">{xLabels[index]}</text></g>;
          })}
          <text className="nem12-chart-unit" x={LEFT} y={TOP - 8}>kWh per 30 minutes</text>
          <path d={areaPathFor(model.weekday, model.maximum)} fill="url(#weekday-area)" />
          {model.weekend ? <path d={areaPathFor(model.weekend, model.maximum)} fill="url(#weekend-area)" /> : null}
          <path className="nem12-chart-line weekday" d={pathFor(model.weekday, model.maximum)} />
          {model.weekend ? <path className="nem12-chart-line weekend" d={pathFor(model.weekend, model.maximum)} /> : null}
          <line className="nem12-chart-cursor" x1={activeX} y1={TOP} x2={activeX} y2={TOP + plotHeight} />
          <circle className="nem12-chart-point weekday" cx={activeX} cy={yFor(weekdayValue, model.maximum)} r="5" />
          {weekendValue !== null ? <circle className="nem12-chart-point weekend" cx={activeX} cy={yFor(weekendValue, model.maximum)} r="4.5" /> : null}
        </svg>
        <p id="nem12-chart-help">Move or touch across the chart to inspect each interval. Keyboard users can focus the chart and use the left and right arrow keys.</p>
      </div>
      <dl className="nem12-chart-metrics">
        <div className="load"><dt>Average day</dt><dd>{model.averageDailyKwh.toFixed(1)} kWh</dd></div>
        <div className="peak"><dt>Example peak window</dt><dd>{model.peakPercent}%</dd></div>
        <div className="shoulder"><dt>Example shoulder window</dt><dd>{model.shoulderPercent}%</dd></div>
        <div className="offpeak"><dt>Overnight and weekends</dt><dd>{model.offPeakPercent}%</dd></div>
      </dl>
      <p className="nem12-chart-caveat">The coloured example window is for orientation only. Plan pricing uses each retailer&apos;s published time windows.</p>
    </section>
  );
}
