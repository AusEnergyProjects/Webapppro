"use client";

import { useMemo, useState } from "react";
import { UpgradeEnquiryModal } from "./UpgradeEnquiryModal";

type ApplianceOption = { value: string; label: string };

const heatingOptions: ApplianceOption[] = [
  { value: "gas-ducted", label: "Gas ducted central heating" },
  { value: "gas-slab", label: "Gas slab heating" },
  { value: "gas-room", label: "Individual gas room heater" },
  { value: "reverse-cycle", label: "Split system air conditioning used as a heater" },
  { value: "electric-ducted", label: "Electric ducted central heating" },
  { value: "other", label: "Other heating" },
  { value: "none", label: "None" },
];

const hotWaterOptions: ApplianceOption[] = [
  { value: "gas-storage", label: "Gas storage" },
  { value: "gas-instant", label: "Gas instantaneous" },
  { value: "gas-solar", label: "Gas and solar" },
  { value: "electric", label: "Electric" },
  { value: "heat-pump", label: "Heat pump" },
  { value: "other", label: "Other" },
];

const winterUseOptions = [
  ["none", "None"],
  ["low", "Less than a quarter of the time"],
  ["medium", "Between a quarter and half the time"],
  ["high", "More than half the time"],
  ["most", "Most days in winter"],
];

const frequencyOptions = [
  ["none", "None"],
  ["low", "About once a week"],
  ["medium", "Several times a week"],
  ["high", "Most days"],
];

type BenchmarkPoint = { x: number; value: number };
type EnergyProfile = { gasMj: number; replacementKwh: number };

const SOURCE_ELECTRICITY_RATE = 0.292;
const HOT_WATER_GAS_MJ: Record<string, number[]> = {
  "gas-storage": [9719, 12884, 15321, 17703],
  "gas-instant": [5760, 10000, 13146, 16194],
  "gas-solar": [2656, 4545, 6234, 7744],
};
const HEAT_PUMP_KWH = [428, 634, 788, 942];
const CENTRAL_GAS_RATE = [{ x: 100, value: 3.67 }, { x: 160, value: 3.41 }, { x: 220, value: 3.26 }];
const DUCTED_GAS_COST = [{ x: 100, value: 1961 }, { x: 160, value: 2921 }, { x: 220, value: 3853 }];
const SLAB_GAS_COST = [{ x: 100, value: 1411 }, { x: 160, value: 2097 }, { x: 220, value: 2762 }];
const CENTRAL_REVERSE_CYCLE_COST = [{ x: 100, value: 513 }, { x: 160, value: 923 }, { x: 220, value: 1269 }];
const ROOM_GAS_RATE = [{ x: 12, value: 4.66 }, { x: 30, value: 4.40 }, { x: 60, value: 4.01 }];
const ROOM_GAS_COST = [{ x: 12, value: 275 }, { x: 30, value: 650 }, { x: 60, value: 1190 }];
const ROOM_REVERSE_CYCLE_COST = [{ x: 12, value: 69 }, { x: 30, value: 191 }, { x: 60, value: 382 }];

function interpolate(points: BenchmarkPoint[], x: number): number {
  if (x <= points[0].x) return points[0].value * x / points[0].x;
  for (let index = 1; index < points.length; index += 1) {
    if (x <= points[index].x) {
      const lower = points[index - 1];
      const upper = points[index];
      const ratio = (x - lower.x) / (upper.x - lower.x);
      return lower.value + (upper.value - lower.value) * ratio;
    }
  }
  const lower = points[points.length - 2];
  const upper = points[points.length - 1];
  return upper.value + (upper.value - lower.value) * (x - upper.x) / (upper.x - lower.x);
}

function byHousehold(values: number[], people: number): number {
  const count = Math.max(1, people);
  if (count <= values.length) return values[count - 1];
  const increment = values[values.length - 1] - values[values.length - 2];
  return values[values.length - 1] + increment * (count - values.length);
}

function toggleValue(current: string[], value: string): string[] {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function dollars(value: number): string {
  return "$" + Math.round(value).toLocaleString();
}

function payback(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "No saving estimated";
  const months = Math.max(1, Math.round(value * 12));
  const years = Math.floor(months / 12);
  const remaining = months % 12;
  if (!years) return `${remaining} month${remaining === 1 ? "" : "s"}`;
  return `${years} year${years === 1 ? "" : "s"}${remaining ? ` ${remaining} month${remaining === 1 ? "" : "s"}` : ""}`;
}

export function GasUpgradeQuestionnaire({ annualMj }: { annualMj: string }) {
  const [people, setPeople] = useState("2");
  const [rooms, setRooms] = useState("6");
  const [heating, setHeating] = useState(["gas-ducted"]);
  const [winterUse, setWinterUse] = useState("medium");
  const [hotWater, setHotWater] = useState(["gas-storage"]);
  const [gasCooktop, setGasCooktop] = useState(false);
  const [gasDryer, setGasDryer] = useState(false);
  const [dryerUse, setDryerUse] = useState("none");
  const [gasSpend, setGasSpend] = useState("");
  const [gasRate, setGasRate] = useState("4.5");
  const [electricityRate, setElectricityRate] = useState("30");
  const [heatingInstall, setHeatingInstall] = useState("5000");
  const [hotWaterInstall, setHotWaterInstall] = useState("3000");
  const [enquiryTitle, setEnquiryTitle] = useState("");

  const estimate = useMemo(() => {
    const householdSize = Math.max(1, Number(people) || 1);
    const roomCount = Math.max(1, Number(rooms) || 1);
    const centralArea = Math.min(220, Math.max(60, roomCount * 20));
    const roomHeatedArea = Math.min(60, Math.max(12, roomCount * 8));
    const winterFactors: Record<string, number> = { none: 0, low: .45, medium: .75, high: .95, most: 1 };
    const heatingFactor = winterFactors[winterUse] ?? .75;

    const centralProfile = (gasCosts: BenchmarkPoint[]): EnergyProfile => {
      const sourceGasRate = interpolate(CENTRAL_GAS_RATE, centralArea) / 100;
      return {
        gasMj: interpolate(gasCosts, centralArea) / sourceGasRate,
        replacementKwh: interpolate(CENTRAL_REVERSE_CYCLE_COST, centralArea) / SOURCE_ELECTRICITY_RATE,
      };
    };
    const roomProfile = (): EnergyProfile => ({
      gasMj: interpolate(ROOM_GAS_COST, roomHeatedArea) / (interpolate(ROOM_GAS_RATE, roomHeatedArea) / 100),
      replacementKwh: interpolate(ROOM_REVERSE_CYCLE_COST, roomHeatedArea) / SOURCE_ELECTRICITY_RATE,
    });
    const heatingProfiles = [
      heating.includes("gas-ducted") ? centralProfile(DUCTED_GAS_COST) : null,
      heating.includes("gas-slab") ? centralProfile(SLAB_GAS_COST) : null,
      heating.includes("gas-room") ? roomProfile() : null,
    ].filter(Boolean) as EnergyProfile[];
    const heatingBenchmark = heatingProfiles.reduce((total, profile) => ({
      gasMj: total.gasMj + profile.gasMj * heatingFactor,
      replacementKwh: total.replacementKwh + profile.replacementKwh * heatingFactor,
    }), { gasMj: 0, replacementKwh: 0 });

    const hotWaterType = hotWater[0] || "other";
    const hotWaterBenchmark: EnergyProfile = HOT_WATER_GAS_MJ[hotWaterType] ? {
      gasMj: byHousehold(HOT_WATER_GAS_MJ[hotWaterType], householdSize),
      replacementKwh: byHousehold(HEAT_PUMP_KWH, householdSize),
    } : { gasMj: 0, replacementKwh: 0 };
    const cooktopBenchmarkMj = gasCooktop ? 1100 + householdSize * 350 : 0;
    const dryerCyclesPerWeek: Record<string, number> = { none: 0, low: 1, medium: 3, high: 6 };
    const dryerBenchmarkMj = gasDryer ? (dryerCyclesPerWeek[dryerUse] ?? 0) * 52 * 15 : 0;
    const benchmarkGasMj = heatingBenchmark.gasMj + hotWaterBenchmark.gasMj + cooktopBenchmarkMj + dryerBenchmarkMj;
    const enteredUse = Number(annualMj);
    const use = enteredUse > 0 ? enteredUse : Math.max(12000, benchmarkGasMj);
    const billScale = benchmarkGasMj > 0 ? use / benchmarkGasMj : 0;
    const heatingGasUse = heatingBenchmark.gasMj * billScale;
    const hotWaterGasUse = hotWaterBenchmark.gasMj * billScale;
    const cooktopGasUse = cooktopBenchmarkMj * billScale;
    const dryerGasUse = dryerBenchmarkMj * billScale;

    const supplyCharge = 310;
    const enteredSpend = Number(gasSpend);
    const enteredRate = Number(gasRate) > 0 ? Number(gasRate) : 4.5;
    const totalSpend = enteredSpend > 0 ? enteredSpend : use * enteredRate / 100 + supplyCharge;
    const effectiveRate = enteredSpend > 0 ? Math.max(0, totalSpend - supplyCharge) / use * 100 : enteredRate;
    const powerRate = Number(electricityRate) > 0 ? Number(electricityRate) : 30;
    const heatingCurrent = heatingGasUse * effectiveRate / 100;
    const hotWaterCurrent = hotWaterGasUse * effectiveRate / 100;
    const heatingAfter = heatingBenchmark.replacementKwh * billScale * powerRate / 100;
    const hotWaterAfter = hotWaterBenchmark.replacementKwh * billScale * powerRate / 100;
    const heatingSaving = Math.max(0, heatingCurrent - heatingAfter);
    const hotWaterSaving = Math.max(0, hotWaterCurrent - hotWaterAfter);
    const cooktopCurrent = cooktopGasUse * effectiveRate / 100;
    const dryerCurrent = dryerGasUse * effectiveRate / 100;
    const cooktopAfter = cooktopGasUse * .4 / .85 / 3.6 * powerRate / 100;
    const dryerAfter = dryerGasUse * .75 / 2.5 / 3.6 * powerRate / 100;
    const cooktopSaving = Math.max(0, cooktopCurrent - cooktopAfter);
    const dryerSaving = Math.max(0, dryerCurrent - dryerAfter);
    return {
      use,
      totalSpend,
      effectiveRate,
      heatingCurrent,
      heatingAfter,
      heatingSaving,
      hotWaterCurrent,
      hotWaterAfter,
      hotWaterSaving,
      heatingGasUse,
      hotWaterGasUse,
      cooktopGasUse,
      dryerGasUse,
      centralArea,
      roomHeatedArea,
      hotWaterType,
      heatingPayback: Number(heatingInstall) > 0 ? Number(heatingInstall) / heatingSaving : 0,
      hotWaterPayback: Number(hotWaterInstall) > 0 ? Number(hotWaterInstall) / hotWaterSaving : 0,
      fullElectricSaving: heatingSaving + hotWaterSaving + cooktopSaving + dryerSaving + (benchmarkGasMj > 0 ? supplyCharge : 0),
      hasHeating: heatingGasUse > 0,
      hasHotWater: hotWaterGasUse > 0,
    };
  }, [annualMj, people, rooms, heating, winterUse, hotWater, gasCooktop, gasDryer, dryerUse, gasSpend, gasRate, electricityRate, heatingInstall, hotWaterInstall]);

  return (
    <section className="card gas-questionnaire">
      <h2><span className="stepnum">2</span> Your gas appliances and home</h2>
      <p className="sub">These are the gas-relevant questions used by government comparison tools. They help estimate what switching gas heating or hot water could mean for your home.</p>

      <div className="question-grid">
        <label className="f">How many people live in your house?<span className="field-control"><select value={people} onChange={(event) => setPeople(event.target.value)}>{Array.from({ length: 8 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></span></label>
        <label className="f">How many rooms (total)?<span className="field-control"><select value={rooms} onChange={(event) => setRooms(event.target.value)}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></span></label>
      </div>

      <div className="question-grid question-grid-wide">
        <fieldset className="question-group"><legend>How do you heat your home? Tick all that apply.</legend><div className="option-list">{heatingOptions.map((option) => <label className="option-item" key={option.value}><input type="checkbox" checked={heating.includes(option.value)} onChange={() => setHeating((current) => option.value === "none" ? ["none"] : toggleValue(current.filter((value) => value !== "none"), option.value))} />{option.label}</label>)}</div></fieldset>
        <label className="f">How much of the time do you run your gas heating in winter?<span className="field-control"><select value={winterUse} onChange={(event) => setWinterUse(event.target.value)}>{winterUseOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></span></label>
      </div>

      <div className="question-grid question-grid-wide">
        <fieldset className="question-group"><legend>Which hot water system do you use?</legend><div className="option-list">{hotWaterOptions.map((option) => <label className="option-item" key={option.value}><input type="radio" name="gas-hot-water-system" checked={hotWater[0] === option.value} onChange={() => setHotWater([option.value])} />{option.label}</label>)}</div></fieldset>
        <div className="question-group"><span className="question-label">Other gas appliances</span><label className="option-item"><input type="checkbox" checked={gasCooktop} onChange={(event) => setGasCooktop(event.target.checked)} />Gas cooktop</label><label className="option-item"><input type="checkbox" checked={gasDryer} onChange={(event) => setGasDryer(event.target.checked)} />Gas clothes dryer</label>{gasDryer && <label className="f compact-field">How often?<span className="field-control"><select value={dryerUse} onChange={(event) => setDryerUse(event.target.value)}>{frequencyOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></span></label>}</div>
      </div>

      <div className="question-grid question-grid-wide estimate-inputs">
        <label className="f">Total gas spend ($/year), optional<span className="field-control"><input type="number" min="0" value={gasSpend} onChange={(event) => setGasSpend(event.target.value)} placeholder="e.g. 2,600" /></span><span className="hint">Leave blank to estimate from annual MJ and the rate below.</span></label>
        <label className="f">Gas usage rate (c/MJ)<span className="field-control"><input type="number" min="0" step="0.1" value={gasRate} onChange={(event) => setGasRate(event.target.value)} /></span><span className="hint">Use the first block rate from your bill.</span></label>
        <label className="f">Electricity rate (c/kWh)<span className="field-control"><input type="number" min="0" step="0.1" value={electricityRate} onChange={(event) => setElectricityRate(event.target.value)} /></span><span className="hint">Use your current rate or a heat-pump-friendly estimate.</span></label>
      </div>

      {(estimate.hasHeating || estimate.hasHotWater) && <div className="gas-savings" onClick={(event) => { const target = event.target as HTMLElement; const cta = target.closest(".saving-cta"); if (cta) { event.preventDefault(); setEnquiryTitle(cta.textContent?.trim() || "upgrade"); } }}>
        <h3>What could getting off gas save?</h3>
        <div className="savings-grid">
          {estimate.hasHeating && <SavingCard title="Gas heating to reverse cycle" current={estimate.heatingCurrent} after={estimate.heatingAfter} saving={estimate.heatingSaving} install={heatingInstall} setInstall={setHeatingInstall} payback={estimate.heatingPayback} action="Enquire about reverse cycle heating" />}
          {estimate.hasHotWater && <SavingCard title="Gas hot water to heat pump" current={estimate.hotWaterCurrent} after={estimate.hotWaterAfter} saving={estimate.hotWaterSaving} install={hotWaterInstall} setInstall={setHotWaterInstall} payback={estimate.hotWaterPayback} action="Enquire about heat pump hot water" />}
        </div>
        <p className="savings-note"><b>Go fully electric:</b> about {dollars(estimate.fullElectricSaving)}/yr saved, including roughly $310/yr from disconnecting gas and dropping the daily supply charge.</p>
        <details className="savings-explain"><summary>How we estimate these savings</summary><div>
          <p>We build separate benchmark profiles for your selected heating and hot-water systems, household size, room count and winter use. We then scale those profiles so the allocated uses add back to your entered {Math.round(estimate.use).toLocaleString()} MJ/year.</p>
          <p><b>Estimated bill allocation:</b> heating {Math.round(estimate.heatingGasUse).toLocaleString()} MJ, hot water {Math.round(estimate.hotWaterGasUse).toLocaleString()} MJ, cooktop {Math.round(estimate.cooktopGasUse).toLocaleString()} MJ and dryer {Math.round(estimate.dryerGasUse).toLocaleString()} MJ.</p>
          <p>Storage, instantaneous and gas-boosted solar hot water use different household-size curves. Central heating uses about {Math.round(estimate.centralArea)} m² and room heating about {Math.round(estimate.roomHeatedArea)} m². Gas slab heating uses the published hydronic C-rating profile as the closest central-heating proxy.</p>
          <p>Cooking and dryer allocations are conservative proxies because no equivalent Victorian household benchmark table is published. Real savings depend on appliance ratings, building fabric, climate and behaviour. Costs use your effective gas rate of {estimate.effectiveRate.toFixed(1)}c/MJ and entered electricity rate.</p>
          <p className="method-links"><a href="https://www.sustainability.vic.gov.au/energy-efficiency-and-reducing-emissions/save-energy-in-the-home/heat-your-home-efficiently/calculate-heating-costs" target="_blank" rel="noreferrer">Heating benchmarks</a><a href="https://www.sustainability.vic.gov.au/energy-efficiency-and-reducing-emissions/save-energy-in-the-home/water-heating/calculate-water-heating-running-costs" target="_blank" rel="noreferrer">Hot-water benchmarks</a></p>
        </div></details>
      </div>}
      {enquiryTitle && <UpgradeEnquiryModal title={enquiryTitle} annualMj={annualMj} estimatedSaving={enquiryTitle.includes("hot water") ? estimate.hotWaterSaving : estimate.heatingSaving} onClose={() => setEnquiryTitle("")} />}
    </section>
  );
}

function SavingCard({ title, current, after, saving, install, setInstall, payback: paybackValue, action }: { title: string; current: number; after: number; saving: number; install: string; setInstall: (value: string) => void; payback: number; action: string }) {
  const subject = encodeURIComponent(`${title} enquiry`);
  return <article className="saving-card"><span className="saving-tag">{title}</span><div className="saving-big">{dollars(current)}/yr <span>→</span> {dollars(after)}/yr</div><p>estimated running cost for this use, now vs after switching</p><div className="saving-row"><span>Annual saving</span><b>{dollars(saving)}/yr</b></div><div className="saving-row"><span>Payback</span><b>{payback(paybackValue)}</b></div><label className="saving-install">Install, after rebates ($)<input type="number" min="0" value={install} onChange={(event) => setInstall(event.target.value)} /></label><a className="saving-cta" href={`mailto:info@ausenergyassessments.com?subject=${subject}`}>{action}</a></article>;
}
