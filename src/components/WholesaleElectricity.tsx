"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent, PointerEvent } from "react";
import { gasChartPath, gasMarketForRegion, gasPointAt, isGasSnapshot } from "@/lib/gas-wholesale";
import type { GasRegion, GasSnapshot } from "@/lib/gas-wholesale";
import { NEM_CONNECTORS, NEM_DAY_MS, NEM_INTERVAL_MS, NEM_REGIONS, NEM_STALE_MS, isNemSnapshot, latestNemPoint, nemChartPath, nemTimeLabel } from "@/lib/nem-wholesale";
import type { NemRegion, NemRegionId, NemSnapshot } from "@/lib/nem-wholesale";
import { purchasedEnergyReductionPercent, usefulEnergyExample, wholesaleInputCostCents } from "@/lib/useful-energy";
import type { UsefulEnergyExampleId } from "@/lib/useful-energy";
import { wholesaleLocationForStates } from "@/lib/wholesale-location";
import { wholesalePriceSnapshot } from "@/lib/wholesale-price-snapshot";
import styles from "./WholesaleElectricity.module.css";

const WIDTH = 900;
const HEIGHT = 340;
const LEFT = 68;
const RIGHT = 24;
const TOP = 24;
const BOTTOM = 46;
const GAS_COLOUR = "#ffbd75";
const ENERGY_RATING_CLIMATE_SOURCE_URL = "https://calculator.energyrating.gov.au/ClimatePopupForAC.aspx?goPageName=Home";
const ENERGY_RATING_CLIMATE_BANDS = new Set(["hot", "average", "cold"]);
const price = (value: number | null | undefined) => value == null ? "No reading" : value.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const regionLabel = (id: NemRegionId) => NEM_REGIONS.find((region) => region.id === id)!.label;
const theme = (colour: string): CSSProperties => ({ "--region-colour": colour } as CSSProperties);
const readoutsStyle: CSSProperties = { display: "grid", gap: 11 };
const legendStyle: CSSProperties = { alignItems: "center", color: "#c4d9e2", display: "flex", flexWrap: "wrap", fontSize: ".72rem", gap: "9px 22px", marginTop: 17 };
const legendItemStyle: CSSProperties = { alignItems: "center", display: "inline-flex", gap: 8 };
const marketScopeStyle: CSSProperties = { color: "#adc8d3", fontSize: ".76rem", lineHeight: 1.55, margin: "7px 0 0" };
const exampleSectionStyle: CSSProperties = { marginTop: 20 };
const exampleSelectorStyle: CSSProperties = { border: 0, margin: "18px 0 0", padding: 0 };
const exampleSelectorOptionsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 9 };
const exampleBadgeStyle: CSSProperties = { background: "#63e0c0", borderRadius: 999, color: "#06231e", display: "inline-block", fontSize: ".76rem", fontWeight: 850, lineHeight: 1.25, marginBottom: 10, padding: "5px 9px" };
const energyVisualStyle: CSSProperties = { background: "#071c2b", border: "1px solid #315060", borderRadius: 13, marginTop: 16, overflow: "hidden" };
const energyVisualHeadingStyle: CSSProperties = { borderBottom: "1px solid #284552", padding: "15px 17px" };
const energyRowStyle: CSSProperties = { borderBottom: "1px solid #213d4c", padding: "15px 17px" };
const energyRowHeadingStyle: CSSProperties = { alignItems: "center", display: "flex", flexWrap: "wrap", gap: "8px 12px", justifyContent: "space-between" };
const energyRowNameStyle: CSSProperties = { alignItems: "center", color: "#e7f8fc", display: "flex", flexWrap: "wrap", fontSize: ".9rem", gap: 9, lineHeight: 1.35, margin: 0 };
const energyValueStyle: CSSProperties = { color: "#f3fbff", fontSize: "1rem", fontVariantNumeric: "tabular-nums" };
const energyTrackStyle: CSSProperties = { background: "#102c3b", borderRadius: 999, height: 14, marginTop: 10, overflow: "hidden" };
const energyRowMetaStyle: CSSProperties = { alignItems: "baseline", color: "#adc7d2", display: "flex", flexWrap: "wrap", fontSize: ".78rem", gap: "6px 18px", justifyContent: "space-between", lineHeight: 1.5, marginTop: 8 };
const gasContextStyle: CSSProperties = { background: "#0a2232", borderLeft: "3px solid #ffbd75", borderRadius: "0 10px 10px 0", color: "#c6dbe3", fontSize: ".8rem", lineHeight: 1.6, margin: "14px 0 12px", padding: "12px 14px" };
const postcodeFormStyle: CSSProperties = { alignItems: "end", background: "#081f2f", border: "1px solid #284a59", borderRadius: 13, display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16, padding: "13px 15px" };
const postcodeInputStyle: CSSProperties = { background: "#061824", border: "1px solid #3a5d6c", borderRadius: 9, color: "#eefbff", font: "inherit", fontSize: ".88rem", minHeight: 42, padding: "8px 11px", width: 130 };
const postcodeButtonStyle: CSSProperties = { background: "#0f9d7a", border: "1px solid #5de1c0", borderRadius: 9, color: "white", cursor: "pointer", font: "inherit", fontSize: ".82rem", fontWeight: 800, minHeight: 42, padding: "8px 15px" };
const climateResultStyle: CSSProperties = { alignItems: "center", background: "#0a3038", border: "1px solid #4fbca4", borderRadius: 11, display: "flex", flexWrap: "wrap", gap: "8px 18px", marginTop: 16, padding: "12px 14px" };

type AppliedPostcodeClimate = {
  postcode: string;
  band: EnergyRatingClimateBand;
  choices: readonly EnergyRatingClimateBand[];
};

type EnergyRatingClimateBand = "hot" | "average" | "cold";

function energyRatingClimateBandLabel(band: EnergyRatingClimateBand): string {
  return `${band[0].toUpperCase()}${band.slice(1)} climate`;
}

function parseEnergyRatingClimate(value: unknown): Omit<AppliedPostcodeClimate, "postcode"> | null {
  if (!value || typeof value !== "object" || !("band" in value) || !("choices" in value)) return null;
  if (typeof value.band !== "string" || !ENERGY_RATING_CLIMATE_BANDS.has(value.band)) return null;
  if (!Array.isArray(value.choices)) return null;
  const choices = [...new Set(value.choices)].filter((choice): choice is EnergyRatingClimateBand => typeof choice === "string" && ENERGY_RATING_CLIMATE_BANDS.has(choice));
  const band = value.band as EnergyRatingClimateBand;
  if (!choices.includes(band)) return null;
  return { band, choices };
}

function formatWholesaleCost(value: number | null, fuel: "electricity" | "gas", unavailableLabel?: string) {
  if (value === null) return unavailableLabel ?? (fuel === "gas" ? "No comparable gas reading" : "No electricity reading");
  if (Math.abs(value) < 100) return `${value.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}¢`;
  const amount = Math.abs(value) / 100;
  return `${value < 0 ? "-" : ""}$${amount.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

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

function PriceChart({ region, gasRegion, gasDelayed, windowEnd, colour, activeIndex, onActiveIndexChange }: { region: NemRegion; gasRegion: GasRegion | null; gasDelayed: boolean; windowEnd: number; colour: string; activeIndex: number; onActiveIndexChange: (index: number) => void }) {
  const values = region.points.flatMap((point) => point.centsPerKwh === null ? [] : [point.centsPerKwh]);
  const start = windowEnd - NEM_DAY_MS;
  const market = gasMarketForRegion(region.id);
  const gasValues = gasRegion ? region.points.flatMap((point) => {
    const gasPoint = gasPointAt(gasRegion.points, point.time);
    return gasPoint ? [gasPoint.centsPerKwh] : [];
  }) : [];
  const rawMin = Math.min(0, ...values, ...gasValues);
  const rawMax = Math.max(0, ...values, ...gasValues);
  const pad = Math.max(.5, (rawMax - rawMin) * .12);
  const minimum = rawMin - pad;
  const maximum = rawMax + pad;
  const xFor = (time: number) => LEFT + (time - start) / NEM_DAY_MS * (WIDTH - LEFT - RIGHT);
  const yFor = (value: number) => TOP + (maximum - value) / (maximum - minimum) * (HEIGHT - TOP - BOTTOM);
  const selected = region.points[activeIndex];
  const selectedGas = gasRegion ? gasPointAt(gasRegion.points, selected.time) : null;
  const currentGas = gasRegion ? gasPointAt(gasRegion.points, windowEnd) : null;
  const path = nemChartPath(region.points, xFor, yFor);
  const gasPath = gasRegion ? gasChartPath(gasRegion.points, start, windowEnd, xFor, yFor) : "";
  const selectPoint = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * WIDTH;
    onActiveIndexChange(Math.max(0, Math.min(287, Math.round((x - LEFT) / (WIDTH - LEFT - RIGHT) * 288) - 1)));
  };
  return <section className={styles.chart} style={theme(colour)} aria-labelledby="wholesale-chart-title">
    <div className={styles.chartHeading}>
      <div><h2 id="wholesale-chart-title">{regionLabel(region.id)} energy prices over 24 hours</h2><p>Electricity and gas use the same c/kWh scale</p></div>
      <div style={readoutsStyle} aria-live="polite" aria-atomic="true">
        <div className={styles.readout}><span>{nemTimeLabel(selected.time, true)} AEST · Electricity</span><strong>{price(selected.centsPerKwh)}{selected.centsPerKwh !== null && <small> c/kWh</small>}</strong></div>
        {market && <div className={styles.readout}><span>{market.label} · {market.cadence}</span><strong style={{ color: GAS_COLOUR }}>{price(selectedGas?.centsPerKwh)}{selectedGas && <small> c/kWh</small>}</strong></div>}
      </div>
    </div>
    <div style={legendStyle} aria-label="Chart lines">
      <span style={legendItemStyle}><b style={{ color: colour }} aria-hidden="true">━━━━</b>Electricity spot price</span>
      {market ? <span style={legendItemStyle}><b style={{ color: GAS_COLOUR }} aria-hidden="true">┅┅┅┅</b>{market.label}{gasPath ? "" : " temporarily unavailable"}</span> : <span>Gas comparison is not available for Tasmania</span>}
    </div>
    {market && <p style={marketScopeStyle}>{market.description}. Gas is shown at its real {market.source === "sttm" ? "daily" : "scheduled"} cadence.</p>}
    {values.length ? <>
      <div className={styles.plot}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} onPointerMove={selectPoint} onPointerDown={selectPoint} role="img" aria-label={`Wholesale electricity${market ? ` and ${market.label}` : ""} prices for ${regionLabel(region.id)}, in cents per kilowatt-hour. Use the time slider below to explore the readings.`}>
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
          {gasPath && <path className={styles.priceLine} style={{ stroke: GAS_COLOUR, strokeDasharray: "8 6" }} d={gasPath} />}
          <path className={styles.priceLine} d={path} />
          <line className={styles.cursor} x1={xFor(selected.time)} x2={xFor(selected.time)} y1={TOP} y2={HEIGHT - BOTTOM} />
          {selectedGas && <circle cx={xFor(selected.time)} cy={yFor(selectedGas.centsPerKwh)} r="5" className={styles.point} style={{ fill: "#071b2a", stroke: GAS_COLOUR }} />}
          {selected.centsPerKwh !== null && <circle cx={xFor(selected.time)} cy={yFor(selected.centsPerKwh)} r="5" className={styles.point} />}
        </svg>
      </div>
      <label className={styles.timeControl}>Explore time <input type="range" min="0" max="287" step="1" value={activeIndex} onChange={(event) => onActiveIndexChange(Number(event.target.value))} aria-label="Explore wholesale energy price readings" aria-valuetext={`${nemTimeLabel(selected.time, true)} AEST, electricity ${price(selected.centsPerKwh)}${selected.centsPerKwh === null ? "" : " cents per kilowatt-hour"}${market ? `, ${market.label} ${price(selectedGas?.centsPerKwh)}${selectedGas ? " cents per kilowatt-hour" : ""}` : ""}`} /></label>
      <div className={styles.chartFoot}><span>Hover, tap or use the time slider.</span><span>{nemTimeLabel(start, true)} to {nemTimeLabel(windowEnd, true)} AEST</span></div>
      {values.length < 288 && <p className={styles.warning}>{288 - values.length} readings are missing. Gaps are left blank.</p>}
      {market && !gasPath && <p className={styles.warning}>The {market.label} feed is temporarily unavailable. Electricity remains current.</p>}
      {market && gasPath && gasDelayed && <p className={styles.warning}>The gas line is the last available market reading while its feed catches up.</p>}
      {market && gasPath && !currentGas && !gasDelayed && <p className={styles.warning}>The gas line stops when the last published price period ends. No newer gas price is available yet.</p>}
    </> : <p className={styles.warning}>Readings for this region are temporarily unavailable.</p>}
  </section>;
}

function UsefulEnergyExamples({ regionId, postcodeClimate, electricityPrice, gasPrice, electricityIntervalCount, matchedPriceCount, hasReliableElectricityWindow, hasReliableGasWindow }: { regionId: NemRegionId; postcodeClimate: AppliedPostcodeClimate | null; electricityPrice: number | null; gasPrice: number | null; electricityIntervalCount: number; matchedPriceCount: number; hasReliableElectricityWindow: boolean; hasReliableGasWindow: boolean }) {
  const [exampleId, setExampleId] = useState<UsefulEnergyExampleId>("room-heating");
  const example = usefulEnergyExample(exampleId, postcodeClimate?.band ?? null);
  const lowestEnergyOption = example.options.find((option) => option.lowestEnergyUse)!;
  const gasOption = example.options.find((option) => option.fuel === "gas")!;
  const energyReduction = purchasedEnergyReductionPercent(lowestEnergyOption.inputKwh, gasOption.inputKwh);
  const heatPumpCost = wholesaleInputCostCents(lowestEnergyOption.inputKwh, electricityPrice);
  const gasCost = wholesaleInputCostCents(gasOption.inputKwh, gasPrice);
  const gasLooksCheaper = heatPumpCost !== null && gasCost !== null && gasCost < heatPumpCost;
  const maximumInput = Math.max(...example.options.map((option) => option.inputKwh));
  const descriptionId = "useful-energy-example-description";
  const caveatId = "useful-energy-example-caveat";
  const electricityCoverageHours = electricityIntervalCount * NEM_INTERVAL_MS / 3_600_000;
  const coverageHours = matchedPriceCount * NEM_INTERVAL_MS / 3_600_000;
  const marketHasGas = gasMarketForRegion(regionId) !== null;
  const resultLabel = exampleId === "room-heating" ? "room heat" : "hot water";

  return <section className={styles.flows} style={exampleSectionStyle} aria-labelledby="useful-energy-example-title">
    <h2 id="useful-energy-example-title">What could this energy do?</h2>
    <p>{regionLabel(regionId)} latest 24-hour window. The energy bars compare the same heating result. {hasReliableGasWindow ? `Costs use average wholesale prices from ${coverageHours.toLocaleString("en-AU", { maximumFractionDigits: 1 })} hours for which both electricity and gas prices were available.` : !hasReliableElectricityWindow ? `Only ${electricityCoverageHours.toLocaleString("en-AU", { maximumFractionDigits: 1 })} hours of usable electricity readings are available, so no cost snapshot is shown.` : marketHasGas ? `Electricity cost uses ${electricityCoverageHours.toLocaleString("en-AU", { maximumFractionDigits: 1 })} hours of available readings. A reliable gas cost needs at least 23 hours of overlapping price coverage and is unavailable right now.` : `Electricity cost uses ${electricityCoverageHours.toLocaleString("en-AU", { maximumFractionDigits: 1 })} hours of available readings. No matching wholesale gas market is available for Tasmania.`}</p>
    <fieldset style={exampleSelectorStyle} aria-describedby={`${descriptionId} ${caveatId}`}>
      <legend style={{ color: "#dff5fa", fontSize: ".82rem", fontWeight: 750 }}>Choose an example</legend>
      <div style={exampleSelectorOptionsStyle}>
        {(["room-heating", "hot-water"] as const).map((id) => {
          const option = usefulEnergyExample(id);
          const checked = exampleId === id;
          return <label key={id} style={{ alignItems: "center", background: checked ? "#103e48" : "#092333", border: `1px solid ${checked ? "#62d9bd" : "#315060"}`, borderRadius: 10, color: "#eefbff", cursor: "pointer", display: "flex", flex: "1 1 145px", fontSize: ".88rem", fontWeight: 750, gap: 9, minHeight: 46, padding: "8px 13px" }}>
            <input type="radio" name="useful-energy-example" value={id} checked={checked} onChange={() => setExampleId(id)} style={{ accentColor: "#63e0c0" }} />{option.label}
          </label>;
        })}
      </div>
    </fieldset>
    {postcodeClimate && <div style={climateResultStyle}>
      <strong style={{ color: "#73ebcc", flex: "1 1 180px", fontSize: ".88rem" }}>Postcode {postcodeClimate.postcode}: {energyRatingClimateBandLabel(postcodeClimate.band)}</strong>
      <span style={{ color: "#d3e7ec", flex: "2 1 320px", fontSize: ".8rem", lineHeight: 1.55 }}>The {resultLabel} example has updated using a visible planning COP of {example.heatPumpCop.toFixed(1)}. It is an informed estimate, not a rating for an unspecified appliance.</span>
    </div>}
    <p id={descriptionId} style={{ color: "#d3e5eb", fontSize: ".86rem", lineHeight: 1.6, margin: "16px 0 0" }}>{example.description}</p>
    <p id={caveatId} style={{ color: "#adc8d3", fontSize: ".76rem", lineHeight: 1.55, margin: "10px 0 0" }}><strong style={{ color: "#e4f8fc" }}>Wholesale input cost, not a bill estimate.</strong> Appliance cycling, standing or duct losses, fan electricity and rooftop solar are not included. A negative spot price does not mean a household is paid to use energy.</p>
    <div style={energyVisualStyle}>
      <div style={energyVisualHeadingStyle}>
        <strong style={{ color: "#eaf9fc", display: "block", fontSize: ".96rem" }}>Purchased energy for the same result</strong>
        <span style={{ color: "#abc6d1", display: "block", fontSize: ".78rem", lineHeight: 1.5, marginTop: 3 }}>Shorter bar means less energy bought. The heat pump uses about {energyReduction}% less than gas in this example.</span>
      </div>
      {example.options.map((option) => {
        const livePrice = option.fuel === "gas" ? gasPrice : electricityPrice;
        const estimatedCost = wholesaleInputCostCents(option.inputKwh, livePrice);
        const unavailableCostLabel = option.fuel === "gas"
          ? marketHasGas ? "Not enough comparable gas coverage" : "No matching wholesale gas market"
          : "Not enough electricity coverage";
        const barColour = option.lowestEnergyUse ? "#63e0c0" : option.fuel === "gas" ? GAS_COLOUR : "#69bde7";
        const rowStyle = option.lowestEnergyUse ? { ...energyRowStyle, background: "#0a3038" } : energyRowStyle;
        return <div key={option.id} style={rowStyle}>
          <div style={energyRowHeadingStyle}>
            <h3 style={energyRowNameStyle}>{option.label}{option.lowestEnergyUse && <span style={{ ...exampleBadgeStyle, marginBottom: 0 }}>Lowest energy use</span>}</h3>
            <strong style={energyValueStyle}>{option.inputKwh.toLocaleString("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh input</strong>
          </div>
          <div style={energyTrackStyle} aria-hidden="true"><span style={{ background: barColour, borderRadius: 999, display: "block", height: "100%", width: `${option.inputKwh / maximumInput * 100}%` }} /></div>
          <div style={energyRowMetaStyle}>
            <span>{option.lowestEnergyUse ? `About ${energyReduction}% less purchased energy than gas · planning COP ${example.heatPumpCop.toFixed(1)}` : `Purchased energy for the same ${resultLabel} result`}</span>
            <span><strong style={{ color: "#dbeef3" }}>Cost at the snapshot average wholesale price:</strong> {formatWholesaleCost(estimatedCost, option.fuel, unavailableCostLabel)}</span>
          </div>
        </div>;
      })}
    </div>
    {gasLooksCheaper && <p style={gasContextStyle}><strong style={{ color: "#ffe0b2" }}>Why can gas still look cheaper here?</strong> These figures use wholesale energy prices, not household retail tariffs. They leave out network, retailer and daily supply charges, including a separate daily gas supply charge if the home stays connected. This is not a final household running-cost comparison. Gas can look cheaper over this wholesale window even though the heat pump uses much less purchased energy for the same result.</p>}
    <p style={{ color: "#adc8d3", fontSize: ".76rem", lineHeight: 1.55, margin: "12px 0 0" }}>{postcodeClimate ? <>The postcode band comes from the <a href={ENERGY_RATING_CLIMATE_SOURCE_URL} target="_blank" rel="noopener noreferrer" style={{ color: "#8cf2d4", textDecoration: "underline", textUnderlineOffset: 3 }}>Australian Government Energy Rating Calculator</a>. The planning COP sits within the broad efficiency range described by <a href={example.sourceHref} target="_blank" rel="noopener noreferrer" style={{ color: "#8cf2d4", textDecoration: "underline", textUnderlineOffset: 3 }}>{example.sourceLabel}</a>. Exact model performance, sizing, outdoor temperature, installation and the home still matter. {exampleId === "hot-water" && "Hot-water systems use a separate product and certificate framework, so the postcode band is temperature context rather than an official hot-water COP."}</> : <>Based on <a href={example.sourceHref} target="_blank" rel="noopener noreferrer" style={{ color: "#8cf2d4", textDecoration: "underline", textUnderlineOffset: 3 }}>{example.sourceLabel}</a> figures. Enter a postcode above to apply the local Energy Rating climate band and update this planning example.</>}</p>
  </section>;
}

export function WholesaleElectricity() {
  const [snapshot, setSnapshot] = useState<NemSnapshot | null>(null);
  const [gasSnapshot, setGasSnapshot] = useState<GasSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<NemRegionId>("NSW1");
  const [error, setError] = useState("");
  const [gasError, setGasError] = useState(false);
  const [gasLoading, setGasLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(0);
  const [activeIndex, setActiveIndex] = useState(287);
  const [postcode, setPostcode] = useState("");
  const [postcodeMessage, setPostcodeMessage] = useState("");
  const [postcodeError, setPostcodeError] = useState(false);
  const [postcodeLoading, setPostcodeLoading] = useState(false);
  const [appliedPostcodeClimate, setAppliedPostcodeClimate] = useState<AppliedPostcodeClimate | null>(null);
  const postcodeRequestId = useRef(0);

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
        const electricityRequest =
          fetch("/api/wholesale-electricity", { signal: requestController.signal }).then(async (response) => {
            const result: unknown = await response.json();
            if (!response.ok || !isNemSnapshot(result)) throw new Error("Invalid electricity response");
            return result;
          }).then((result) => {
            if (!controller.signal.aborted) { setSnapshot(result); setError(""); }
          }).catch(() => {
            if (!controller.signal.aborted) setError("We could not update the readings. Please try again shortly.");
          }).finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
        const gasRequest =
          fetch("/api/wholesale-gas", { signal: requestController.signal }).then(async (response) => {
            const result: unknown = await response.json();
            if (!response.ok || !isGasSnapshot(result)) throw new Error("Invalid gas response");
            return result;
          }).then((result) => {
            if (!controller.signal.aborted) { setGasSnapshot(result); setGasError(false); }
          }).catch(() => {
            if (!controller.signal.aborted) setGasError(true);
          }).finally(() => {
            if (!controller.signal.aborted) setGasLoading(false);
          });
        await Promise.allSettled([electricityRequest, gasRequest]);
      } catch {
        if (!controller.signal.aborted) { setError("We could not update the readings. Please try again shortly."); setGasError(true); setLoading(false); setGasLoading(false); }
      } finally {
        clearTimeout(deadline);
        controller.signal.removeEventListener("abort", abortRequest);
        running = false;
      }
    }
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 60_000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, [retry]);

  const selected = snapshot?.regions.find(({ id }) => id === selectedId);
  const selectedGas = gasSnapshot?.regions.find(({ id }) => id === selectedId) ?? null;
  const definition = NEM_REGIONS.find(({ id }) => id === selectedId)!;
  const delayed = !!snapshot && (now - snapshot.windowEnd > NEM_STALE_MS || snapshot.refreshFailed || !!error);
  const gasDelayed = !!snapshot && (gasError || !!gasSnapshot?.failedSources?.length);
  const selectedGasSource = gasMarketForRegion(selectedId)?.source;
  const selectedGasDelayed = gasError || !!(selectedGasSource && gasSnapshot?.failedSources?.includes(selectedGasSource));
  const priceSnapshot = wholesalePriceSnapshot(selected?.points ?? [], selectedGas?.points ?? null);
  const applyPostcode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^\d{4}$/.test(postcode)) {
      setPostcodeError(true);
      setPostcodeMessage("Enter a valid four-digit Australian residential postcode.");
      return;
    }
    const submittedPostcode = postcode;
    const requestId = ++postcodeRequestId.current;
    setPostcodeError(false);
    setPostcodeLoading(true);
    try {
      const response = await fetch(`/api/address-localities?postcode=${encodeURIComponent(submittedPostcode)}`);
      const payload: unknown = await response.json();
      if (requestId !== postcodeRequestId.current) return;
      if (!response.ok || typeof payload !== "object" || payload === null || !("ok" in payload) || payload.ok !== true || !("postcode" in payload) || payload.postcode !== submittedPostcode || !("localities" in payload) || !Array.isArray(payload.localities)) throw new Error("Invalid postcode response");
      const location = wholesaleLocationForStates(payload.localities.flatMap((item) => typeof item === "object" && item !== null && "state" in item && typeof item.state === "string" ? [item.state] : []));
      if (!location) throw new Error("Invalid locality response");
      if (location.kind === "outside-nem") {
        setAppliedPostcodeClimate(null);
        setPostcodeMessage(`${new Intl.ListFormat("en-AU").format(location.stateLabels)} is outside the National Electricity Market shown on this page.`);
      } else if (location.kind === "ambiguous" || !location.regionId) {
        setAppliedPostcodeClimate(null);
        setPostcodeMessage(`Postcode ${submittedPostcode} spans ${new Intl.ListFormat("en-AU").format(location.stateLabels)}. Choose the correct market region below.`);
      } else {
        const climate = "energyRatingClimate" in payload ? parseEnergyRatingClimate(payload.energyRatingClimate) : null;
        setSelectedId(location.regionId);
        setActiveIndex(287);
        setAppliedPostcodeClimate(climate ? { postcode: submittedPostcode, band: climate.band, choices: climate.choices } : null);
        setPostcodeMessage(climate
          ? `Showing the ${regionLabel(location.regionId)} market and ${energyRatingClimateBandLabel(climate.band).toLowerCase()} for postcode ${submittedPostcode}. The appliance examples below have updated.${climate.choices.length > 1 ? " This postcode spans more than one product-label band, so check the climate choice." : ""}`
          : `Showing the ${regionLabel(location.regionId)} market for postcode ${submittedPostcode}. A climate band was not available, so the appliance example is unchanged.`);
      }
    } catch {
      if (requestId !== postcodeRequestId.current) return;
      setPostcodeError(true);
      setPostcodeMessage("We could not match that postcode. Check it and try again.");
    } finally {
      if (requestId === postcodeRequestId.current) setPostcodeLoading(false);
    }
  };

  return <div className={styles.dashboard}>
    <div className={styles.statusRow}>
      <p role="status"><span className={`${styles.statusDot}${delayed || gasDelayed || error ? ` ${styles.delayed}` : ""}`} />{!snapshot ? loading ? "Loading prices" : "Readings unavailable" : delayed ? "Update delayed. Showing the last available readings." : gasLoading ? "Electricity is current. Loading gas prices." : gasDelayed ? "Electricity is current. Gas update delayed." : "Updating automatically"}</p>
      <button type="button" onClick={() => { setLoading(true); setGasLoading(true); setRetry((value) => value + 1); }} disabled={loading}>{loading ? "Checking…" : "Refresh"}</button>
    </div>
    {!snapshot ? <div className={styles.loading} aria-live="polite"><h2>{loading ? "Fetching the latest prices" : "The live feed is temporarily unavailable"}</h2><p>{error || "The market changes every five minutes. Your chart will appear here shortly."}</p></div> : <>
      <form onSubmit={applyPostcode} style={postcodeFormStyle} aria-busy={postcodeLoading}>
        <label style={{ color: "#d7eaf0", display: "grid", fontSize: ".78rem", fontWeight: 750, gap: 5 }}>Show prices for my area<input aria-describedby="wholesale-postcode-message" aria-invalid={postcodeError || undefined} autoComplete="postal-code" disabled={postcodeLoading} inputMode="numeric" maxLength={4} pattern="[0-9]{4}" placeholder="Postcode" style={postcodeInputStyle} value={postcode} onChange={(event) => { postcodeRequestId.current += 1; setPostcode(event.target.value.replace(/\D/g, "").slice(0, 4)); setPostcodeError(false); setPostcodeMessage(""); setPostcodeLoading(false); setAppliedPostcodeClimate(null); }} /></label>
        <button type="submit" style={postcodeButtonStyle} disabled={postcodeLoading}>{postcodeLoading ? "Checking..." : "Use postcode"}</button>
        {appliedPostcodeClimate && appliedPostcodeClimate.choices.length > 1 && <label style={{ color: "#d7eaf0", display: "grid", fontSize: ".78rem", fontWeight: 750, gap: 5 }}>Climate band<select aria-describedby="wholesale-postcode-message" style={{ ...postcodeInputStyle, width: 150 }} value={appliedPostcodeClimate.band} onChange={(event) => {
          const band = event.target.value as EnergyRatingClimateBand;
          if (!appliedPostcodeClimate.choices.includes(band)) return;
          setAppliedPostcodeClimate({ ...appliedPostcodeClimate, band });
          setPostcodeMessage(`Using the ${energyRatingClimateBandLabel(band).toLowerCase()} for postcode ${appliedPostcodeClimate.postcode}. The appliance examples below have updated.`);
        }}>{appliedPostcodeClimate.choices.map((band) => <option key={band} value={band}>{energyRatingClimateBandLabel(band)}</option>)}</select></label>}
        <span id="wholesale-postcode-message" role="status" style={{ color: "#b8d1db", flex: "1 1 260px", fontSize: ".78rem", lineHeight: 1.5 }}>{postcodeMessage || "Optional. Cross-border postcodes will ask you to choose the correct market region."}</span>
      </form>
      <div className={styles.regions} role="group" aria-label="Choose a NEM region">
        {NEM_REGIONS.map((region) => {
          const series = snapshot.regions.find(({id}) => id === region.id)!;
          const latest = latestNemPoint(series);
          const isStale = !latest || now - latest.time > NEM_STALE_MS || delayed;
          return <button type="button" className={styles.regionCard} style={theme(region.colour)} key={region.id} onClick={() => { postcodeRequestId.current += 1; setPostcodeLoading(false); setSelectedId(region.id); setActiveIndex(287); setPostcodeError(false); setPostcodeMessage(""); setAppliedPostcodeClimate(null); }} aria-pressed={selectedId === region.id} aria-label={`${region.name}: ${price(latest?.centsPerKwh)}${latest ? " cents per kilowatt-hour" : ""}. View chart.`}>
            <Sparkline region={series} /><span className={styles.regionName}>{region.label}</span><strong>{price(latest?.centsPerKwh)}{latest && <small> c/kWh</small>}</strong><span className={styles.interval}>Electricity · {latest ? `${isStale ? "Last reading · " : ""}${nemTimeLabel(latest.time)} AEST` : "No current reading"}</span>
          </button>;
        })}
      </div>
      <div className={styles.mainGrid}>
        {selected && <PriceChart region={selected} gasRegion={selectedGas} gasDelayed={selectedGasDelayed} windowEnd={snapshot.windowEnd} colour={definition.colour} activeIndex={activeIndex} onActiveIndexChange={setActiveIndex} />}
        <section className={styles.flows} aria-labelledby="wholesale-flows-title">
          <h2 id="wholesale-flows-title">Power between states</h2><p>Arrows show the direction. MW measures how much power is flowing now.</p>
          <div className={styles.flowList}>{NEM_CONNECTORS.map((connector) => {
            const flow = snapshot.flows.find(({ id }) => id === connector.id);
            return <div className={styles.flow} key={connector.id}><span>{connector.label}</span>{flow ? <><div><b>{regionLabel(flow.from)}</b><span className={styles.flowArrow} aria-label={flow.mw ? "to" : "no net flow"}>{flow.mw ? "→" : "↔"}</span><b>{regionLabel(flow.to)}</b><strong>{Math.round(flow.mw).toLocaleString("en-AU")} <small>MW</small></strong></div><small>{nemTimeLabel(flow.time)} AEST{now - flow.time > NEM_STALE_MS || snapshot.refreshFailed || error ? " · Last available reading" : ""}</small></> : <div className={styles.unavailable}>Reading unavailable</div>}</div>;
          })}</div>
        </section>
      </div>
      {selected && <UsefulEnergyExamples regionId={selectedId} postcodeClimate={appliedPostcodeClimate} electricityPrice={priceSnapshot.electricityPrice} gasPrice={priceSnapshot.gasPrice} electricityIntervalCount={priceSnapshot.electricityIntervalCount} matchedPriceCount={priceSnapshot.matchedIntervalCount} hasReliableElectricityWindow={priceSnapshot.hasReliableElectricityWindow} hasReliableGasWindow={priceSnapshot.hasReliableGasWindow} />}
    </>}
  </div>;
}
