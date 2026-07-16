"use client";

import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { CERTIFICATE_DEFINITIONS, isoDateMonthsBefore } from "@/lib/certificate-prices";
import type { CertificateCode, CertificatePriceDataset, CertificatePricePoint, CertificatePriceSeries } from "@/lib/certificate-prices";

const WIDTH = 860;
const HEIGHT = 340;
const LEFT = 70;
const RIGHT = 24;
const TOP = 28;
const BOTTOM = 52;

function money(cents: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 }).format(cents / 100);
}

function dateLabel(value: string, includeYear = true) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-AU", includeYear
    ? { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }
    : { day: "numeric", month: "short", timeZone: "UTC" });
}

function dateTimeLabel(value: string) {
  if (!value) return "Not yet checked";
  return new Date(value).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

function timestamp(value: string) {
  return new Date(`${value}T00:00:00Z`).getTime();
}

function prepareChartPoints(series: CertificatePriceSeries, months: number, asOf: string) {
  if (!series.points.length) return [];
  const endDate = asOf.slice(0, 10);
  const startDate = isoDateMonthsBefore(new Date(`${endDate}T00:00:00Z`), months);
  const before = series.points.filter((point) => point.tradedOn < startDate).at(-1);
  const visible = series.points.filter((point) => point.tradedOn >= startDate && point.tradedOn <= endDate);
  const chartPoints: Array<CertificatePricePoint & { plottedOn: string; carried?: boolean }> = [];
  if (before) chartPoints.push({ ...before, plottedOn: startDate, carried: true });
  chartPoints.push(...visible.map((point) => ({ ...point, plottedOn: point.tradedOn })));
  const last = chartPoints.at(-1);
  if (last && last.plottedOn !== endDate) chartPoints.push({ ...last, plottedOn: endDate, carried: true });
  return chartPoints;
}

export function CertificatePriceTracker() {
  const [dataset, setDataset] = useState<CertificatePriceDataset | null>(null);
  const [selectedCode, setSelectedCode] = useState<CertificateCode>("STC");
  const [months, setMonths] = useState(6);
  const [activeIndex, setActiveIndex] = useState(Number.MAX_SAFE_INTEGER);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/certificate-prices", { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as CertificatePriceDataset & { error?: string };
        if (!response.ok) throw new Error(result.error || "Certificate prices could not be loaded.");
        setDataset(result);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Certificate prices could not be loaded.");
      });
    return () => controller.abort();
  }, []);

  const selected = dataset?.certificates.find((item) => item.code === selectedCode) || null;
  const points = useMemo(() => selected && dataset ? prepareChartPoints(selected, months, dataset.asOf) : [], [dataset, months, selected]);

  if (!dataset) {
    return <section className="certificate-tracker-state" aria-live="polite"><strong>{error ? "Prices are temporarily unavailable" : "Loading reported certificate prices"}</strong><p>{error || "Collecting the latest reported trades and six-month history."}</p></section>;
  }

  const displayed = selected || dataset.certificates[0];
  const safeIndex = Math.max(0, Math.min(activeIndex, points.length - 1));
  const active = points[safeIndex] || null;
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const domainStart = points.length ? timestamp(points[0].plottedOn) : 0;
  const domainEnd = points.length ? timestamp(points.at(-1)!.plottedOn) : 1;
  const values = points.map((point) => point.priceCents);
  const rawMinimum = Math.min(...values);
  const rawMaximum = Math.max(...values);
  const padding = Math.max(50, (rawMaximum - rawMinimum) * 0.12);
  const minimum = Math.max(0, rawMinimum - padding);
  const maximum = rawMaximum + padding;
  const xFor = (date: string) => LEFT + ((timestamp(date) - domainStart) / Math.max(1, domainEnd - domainStart)) * plotWidth;
  const yFor = (value: number) => TOP + plotHeight - ((value - minimum) / Math.max(1, maximum - minimum)) * plotHeight;
  const linePath = points.map((point, index) => {
    const x = xFor(point.plottedOn).toFixed(1);
    const y = yFor(point.priceCents).toFixed(1);
    if (index === 0) return `M${x} ${y}`;
    return `H${x} V${y}`;
  }).join(" ");
  const areaPath = points.length ? `${linePath} L${xFor(points.at(-1)!.plottedOn).toFixed(1)} ${TOP + plotHeight} L${xFor(points[0].plottedOn).toFixed(1)} ${TOP + plotHeight} Z` : "";
  const yTicks = [0, .25, .5, .75, 1];
  const xTicks = [0, 1 / 3, 2 / 3, 1].map((ratio) => domainStart + ratio * (domainEnd - domainStart));
  const selectPointerPoint = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const chartX = ((event.clientX - bounds.left) / bounds.width) * WIDTH;
    let closest = 0;
    let distance = Number.POSITIVE_INFINITY;
    points.forEach((point, index) => {
      const nextDistance = Math.abs(xFor(point.plottedOn) - chartX);
      if (nextDistance < distance) { closest = index; distance = nextDistance; }
    });
    setActiveIndex(closest);
  };

  const selectKeyboardPoint = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    if (event.key === "Home") return setActiveIndex(0);
    if (event.key === "End") return setActiveIndex(points.length - 1);
    setActiveIndex((current) => {
      const bounded = Math.max(0, Math.min(points.length - 1, current));
      return Math.max(0, Math.min(points.length - 1, bounded + (event.key === "ArrowRight" ? 1 : -1)));
    });
  };

  return <>
    <section className="certificate-price-summary" aria-labelledby="certificate-latest-title">
      <div className="certificate-section-heading"><span>Latest reported trades</span><h2 id="certificate-latest-title">Choose a certificate to explore</h2><p>Start with the full name and location. The chart will show only that certificate so different price scales remain readable.</p></div>
      <div className="certificate-price-cards">{dataset.certificates.map((item) => <button type="button" key={item.code} aria-pressed={selectedCode === item.code} className={selectedCode === item.code ? "selected" : ""} onClick={() => { setSelectedCode(item.code); setActiveIndex(Number.MAX_SAFE_INTEGER); }} style={{ "--certificate-colour": item.colour } as React.CSSProperties}>
        <span>{item.code}<small>{item.region}</small></span><strong>{item.latest ? money(item.latest.priceCents) : "No trade"}</strong><small>{item.name}{item.latest ? <em>Last reported trade {dateLabel(item.latest.tradedOn)}</em> : null}</small>
      </button>)}</div>
    </section>

    <section className="certificate-chart-card" aria-labelledby="certificate-chart-title">
      <div className="certificate-chart-heading"><div><span>{displayed.code} price history</span><h2 id="certificate-chart-title">{displayed.name}</h2><p>{displayed.plainEnglish}</p></div>{active ? <div className="certificate-chart-readout" aria-live="polite"><strong>{money(active.priceCents)}</strong><small>{active.carried ? "Last reported trade carried forward" : "Reported trade"}</small></div> : null}</div>
      <div className="certificate-chart-toolbar"><div role="group" aria-label="Price history range">{[[1, "1 month"], [3, "3 months"], [6, "6 months"]].map(([value, label]) => <button type="button" key={value} aria-pressed={months === value} onClick={() => { setMonths(Number(value)); setActiveIndex(Number.MAX_SAFE_INTEGER); }}>{label}</button>)}</div><span className={dataset.source.status}>{dataset.source.status === "current" ? "Source checked" : "Source update delayed"} {dateTimeLabel(dataset.source.lastCheckedAt)}</span></div>
      {points.length ? <div className="certificate-chart-shell" style={{ "--certificate-colour": displayed.colour } as React.CSSProperties}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Interactive ${displayed.code} reported price history for the past ${months} months`} aria-describedby="certificate-chart-help" tabIndex={0} onPointerMove={selectPointerPoint} onKeyDown={selectKeyboardPoint}>
          <defs><linearGradient id={`certificate-area-${displayed.code}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={displayed.colour} stopOpacity=".42" /><stop offset="100%" stopColor={displayed.colour} stopOpacity="0" /></linearGradient></defs>
          {yTicks.map((ratio) => { const y = TOP + plotHeight - ratio * plotHeight; const value = minimum + ratio * (maximum - minimum); return <g key={ratio}><line className="certificate-chart-grid" x1={LEFT} y1={y} x2={WIDTH - RIGHT} y2={y} /><text className="certificate-chart-label" x={LEFT - 10} y={y + 4} textAnchor="end">{money(value)}</text></g>; })}
          {xTicks.map((value, index) => { const x = LEFT + (index / (xTicks.length - 1)) * plotWidth; const label = new Date(value).toISOString().slice(0, 10); return <g key={value}><line className="certificate-chart-time-grid" x1={x} y1={TOP} x2={x} y2={TOP + plotHeight} /><text className="certificate-chart-label" x={x} y={HEIGHT - 14} textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"}>{dateLabel(label, false)}</text></g>; })}
          <text className="certificate-chart-unit" x={LEFT} y={TOP - 10}>Australian dollars per certificate</text>
          <path d={areaPath} fill={`url(#certificate-area-${displayed.code})`} />
          <path className="certificate-chart-line" d={linePath} />
          {active ? <><line className="certificate-chart-cursor" x1={xFor(active.plottedOn)} y1={TOP} x2={xFor(active.plottedOn)} y2={TOP + plotHeight} /><circle className="certificate-chart-point" cx={xFor(active.plottedOn)} cy={yFor(active.priceCents)} r="6" /></> : null}
        </svg>
        <p id="certificate-chart-help">Move or touch across the chart to inspect reported prices. Keyboard users can focus the chart and use the arrow, Home and End keys.</p>
      </div> : <div className="certificate-tracker-state"><strong>No reported trades in this period</strong><p>Try a longer range or another certificate.</p></div>}
      <div className="certificate-chart-context"><div><span>What one {displayed.code} represents</span><p>{displayed.represents}</p></div><div><span>Why the price matters</span><p>{displayed.whyPriceMatters}</p></div></div>
      <p className="certificate-source-note">{dataset.source.note} Source: <a href={dataset.source.url} target="_blank" rel="noreferrer">Demand Manager certificate prices</a>.</p>
    </section>

    <section className="certificate-glossary" aria-labelledby="certificate-glossary-title"><div className="certificate-section-heading"><span>Plain-English guide</span><h2 id="certificate-glossary-title">What every certificate means</h2><p>Household certificates can help fund eligible upgrades. The broader market certificates explain renewable generation and carbon markets but are not standard household rebates.</p></div><div>{CERTIFICATE_DEFINITIONS.map((item) => <article key={item.code} id={`certificate-${item.code.toLowerCase()}`}><header><span style={{ backgroundColor: item.colour }}>{item.code}</span><div><h3>{item.name}</h3><small>{item.region} | {item.relevance}</small></div></header><p>{item.plainEnglish}</p><dl><div><dt>One certificate</dt><dd>{item.represents}</dd></div><div><dt>Why watch its price?</dt><dd>{item.whyPriceMatters}</dd></div></dl><a href={item.officialUrl} target="_blank" rel="noreferrer">Read the official scheme explanation</a></article>)}</div></section>
  </>;
}
