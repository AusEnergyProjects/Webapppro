"use client";

import { useEffect, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { NEM_CONNECTORS, NEM_DAY_MS, NEM_REGIONS, NEM_STALE_MS, isNemSnapshot, latestNemPoint, nemChartPath, nemTimeLabel } from "@/lib/nem-wholesale";
import type { NemRegion, NemRegionId, NemSnapshot } from "@/lib/nem-wholesale";
import styles from "./WholesaleElectricity.module.css";

const WIDTH = 900;
const HEIGHT = 340;
const LEFT = 68;
const RIGHT = 24;
const TOP = 24;
const BOTTOM = 46;
const price = (value: number | null | undefined) => value == null ? "No reading" : value.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const regionLabel = (id: NemRegionId) => NEM_REGIONS.find((region) => region.id === id)!.label;
const theme = (colour: string): CSSProperties => ({ "--region-colour": colour } as CSSProperties);

function Sparkline({ region }: { region: NemRegion }) {
  const values = region.points.flatMap((point) => point.centsPerKwh === null ? [] : [point.centsPerKwh]);
  if (!values.length) return null;
  const min = Math.min(...values);
  const span = Math.max(1, Math.max(...values) - min);
  const start = region.points[0].time;
  const end = region.points[287].time;
  const path = nemChartPath(region.points, (time) => (time - start) / (end - start) * 240, (value) => 66 - (value - min) / span * 52);
  return <svg className={styles.sparkline} viewBox="0 0 240 76" preserveAspectRatio="none" aria-hidden="true"><path d={path} /></svg>;
}

function PriceChart({ region, windowEnd, colour }: { region: NemRegion; windowEnd: number; colour: string }) {
  const [activeIndex, setActiveIndex] = useState(287);
  const values = region.points.flatMap((point) => point.centsPerKwh === null ? [] : [point.centsPerKwh]);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const pad = Math.max(.5, (rawMax - rawMin) * .12);
  const minimum = rawMin - pad;
  const maximum = rawMax + pad;
  const start = windowEnd - NEM_DAY_MS;
  const xFor = (time: number) => LEFT + (time - start) / NEM_DAY_MS * (WIDTH - LEFT - RIGHT);
  const yFor = (value: number) => TOP + (maximum - value) / (maximum - minimum) * (HEIGHT - TOP - BOTTOM);
  const selected = region.points[activeIndex];
  const path = nemChartPath(region.points, xFor, yFor);
  const selectPoint = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * WIDTH;
    setActiveIndex(Math.max(0, Math.min(287, Math.round((x - LEFT) / (WIDTH - LEFT - RIGHT) * 288) - 1)));
  };
  return <section className={styles.chart} style={theme(colour)} aria-labelledby="wholesale-chart-title">
    <div className={styles.chartHeading}>
      <div><h2 id="wholesale-chart-title">{regionLabel(region.id)} over 24 hours</h2><p>Five-minute wholesale spot price · c/kWh</p></div>
      <div className={styles.readout} aria-live="polite" aria-atomic="true"><span>{nemTimeLabel(selected.time, true)} AEST</span><strong>{price(selected.centsPerKwh)}{selected.centsPerKwh !== null && <small> c/kWh</small>}</strong></div>
    </div>
    {values.length ? <>
      <div className={styles.plot}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} onPointerMove={selectPoint} onPointerDown={selectPoint} role="img" aria-label={`Five-minute wholesale spot prices for ${regionLabel(region.id)}. Use the time slider below to explore each reading.`}>
          <defs><linearGradient id="wholesale-chart-glow" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={colour} stopOpacity=".14" /><stop offset="100%" stopColor={colour} stopOpacity="0" /></linearGradient></defs>
          <rect x={LEFT} y={TOP} width={WIDTH - LEFT - RIGHT} height={HEIGHT - TOP - BOTTOM} fill="url(#wholesale-chart-glow)" />
          {[0, .25, .5, .75, 1].map((fraction) => {
            const value = minimum + fraction * (maximum - minimum);
            return <g key={fraction}><line x1={LEFT} x2={WIDTH - RIGHT} y1={yFor(value)} y2={yFor(value)} className={styles.gridline} /><text x={LEFT - 10} y={yFor(value) + 5} textAnchor="end">{value.toLocaleString("en-AU", { maximumFractionDigits: 1 })}</text></g>;
          })}
          <line x1={LEFT} x2={WIDTH - RIGHT} y1={yFor(0)} y2={yFor(0)} className={styles.zeroLine} />
          {[0, .25, .5, .75, 1].map((fraction) => {
            const time = start + fraction * NEM_DAY_MS;
            return <text key={fraction} x={xFor(time)} y={HEIGHT - 14} textAnchor={fraction === 0 ? "start" : fraction === 1 ? "end" : "middle"}>{nemTimeLabel(time)}</text>;
          })}
          <path className={styles.priceLine} d={path} />
          <line className={styles.cursor} x1={xFor(selected.time)} x2={xFor(selected.time)} y1={TOP} y2={HEIGHT - BOTTOM} />
          {selected.centsPerKwh !== null && <circle cx={xFor(selected.time)} cy={yFor(selected.centsPerKwh)} r="5" className={styles.point} />}
        </svg>
      </div>
      <label className={styles.timeControl}>Explore time <input type="range" min="0" max="287" step="1" value={activeIndex} onChange={(event) => setActiveIndex(Number(event.target.value))} aria-label="Explore five-minute price readings" aria-valuetext={`${nemTimeLabel(selected.time, true)} AEST, ${price(selected.centsPerKwh)}${selected.centsPerKwh === null ? "" : " cents per kilowatt-hour"}`} /></label>
      <div className={styles.chartFoot}><span>Hover, tap or use the time slider.</span><span>{nemTimeLabel(start, true)} to {nemTimeLabel(windowEnd, true)} AEST</span></div>
      {values.length < 288 && <p className={styles.warning}>{288 - values.length} readings are missing. Gaps are left blank.</p>}
    </> : <p className={styles.warning}>Readings for this region are temporarily unavailable.</p>}
  </section>;
}

export function WholesaleElectricity() {
  const [snapshot, setSnapshot] = useState<NemSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<NemRegionId>("NSW1");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    async function refresh() {
      setNow(Date.now());
      if (running || document.hidden) return;
      running = true;
      const requestController = new AbortController();
      const abortRequest = () => requestController.abort();
      controller.signal.addEventListener("abort", abortRequest, { once: true });
      const deadline = setTimeout(abortRequest, 15_000);
      try {
        const response = await fetch("/api/wholesale-electricity", { signal: requestController.signal });
        const result: unknown = await response.json();
        if (!response.ok || !isNemSnapshot(result)) throw new Error("We could not update the readings. Please try again shortly.");
        if (!controller.signal.aborted) { setSnapshot(result); setError(""); }
      } catch {
        if (!controller.signal.aborted) setError("We could not update the readings. Please try again shortly.");
      } finally {
        clearTimeout(deadline);
        controller.signal.removeEventListener("abort", abortRequest);
        running = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 60_000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, [retry]);

  const selected = snapshot?.regions.find(({ id }) => id === selectedId);
  const definition = NEM_REGIONS.find(({ id }) => id === selectedId)!;
  const delayed = !!snapshot && (now - snapshot.windowEnd > NEM_STALE_MS || snapshot.refreshFailed || !!error);

  return <div className={styles.dashboard}>
    <div className={styles.statusRow}>
      <p role="status"><span className={`${styles.statusDot}${delayed || error ? ` ${styles.delayed}` : ""}`} />{!snapshot ? loading ? "Loading prices" : "Readings unavailable" : delayed ? "Update delayed. Showing the last available readings." : "Updating automatically"}</p>
      <button type="button" onClick={() => { setLoading(true); setRetry((value) => value + 1); }} disabled={loading}>{loading ? "Checking…" : "Refresh"}</button>
    </div>
    {!snapshot ? <div className={styles.loading} aria-live="polite"><h2>{loading ? "Fetching the latest prices" : "The live feed is temporarily unavailable"}</h2><p>{error || "The market changes every five minutes. Your chart will appear here shortly."}</p></div> : <>
      <div className={styles.regions} role="group" aria-label="Choose a NEM region">
        {NEM_REGIONS.map((region) => {
          const series = snapshot.regions.find(({id}) => id === region.id)!;
          const latest = latestNemPoint(series);
          const isStale = !latest || now - latest.time > NEM_STALE_MS || delayed;
          return <button type="button" className={styles.regionCard} style={theme(region.colour)} key={region.id} onClick={() => setSelectedId(region.id)} aria-pressed={selectedId === region.id} aria-label={`${region.name}: ${price(latest?.centsPerKwh)}${latest ? " cents per kilowatt-hour" : ""}. View chart.`}>
            <Sparkline region={series} /><span className={styles.regionName}>{region.label}</span><strong>{price(latest?.centsPerKwh)}{latest && <small> c/kWh</small>}</strong><span className={styles.interval}>{latest ? `${isStale ? "Last reading · " : ""}${nemTimeLabel(latest.time)} AEST` : "No current reading"}</span>
          </button>;
        })}
      </div>
      <div className={styles.mainGrid}>
        {selected && <PriceChart key={selectedId} region={selected} windowEnd={snapshot.windowEnd} colour={definition.colour} />}
        <section className={styles.flows} aria-labelledby="wholesale-flows-title">
          <h2 id="wholesale-flows-title">Power between states</h2><p>Arrows show the direction. MW measures how much power is flowing now.</p>
          <div className={styles.flowList}>{NEM_CONNECTORS.map((connector) => {
            const flow = snapshot.flows.find(({ id }) => id === connector.id);
            return <div className={styles.flow} key={connector.id}><span>{connector.label}</span>{flow ? <><div><b>{regionLabel(flow.from)}</b><span className={styles.flowArrow} aria-label={flow.mw ? "to" : "no net flow"}>{flow.mw ? "→" : "↔"}</span><b>{regionLabel(flow.to)}</b><strong>{Math.round(flow.mw).toLocaleString("en-AU")} <small>MW</small></strong></div><small>{nemTimeLabel(flow.time)} AEST{now - flow.time > NEM_STALE_MS || snapshot.refreshFailed || error ? " · Last available reading" : ""}</small></> : <div className={styles.unavailable}>Reading unavailable</div>}</div>;
          })}</div>
        </section>
      </div>
    </>}
  </div>;
}
