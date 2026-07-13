"use client";

import { useEffect, useMemo, useState } from "react";
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

const hotWaterUseOptions = [
  ["low", "Low: short showers and light hot-water use"],
  ["typical", "Typical household use"],
  ["high", "High: long showers, baths or frequent hot-water use"],
];

const cookingUseOptions = [
  ["low", "A few meals each week"],
  ["typical", "About one cooked meal most days"],
  ["high", "Multiple burners or meals most days"],
];

const spaUseOptions = [
  ["occasional", "Occasionally during the year"],
  ["seasonal", "Regularly during one season"],
  ["frequent", "Frequently across the year"],
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

export function GasUpgradeQuestionnaire({ annualMj, onUsageProfileChange }: { annualMj: string; onUsageProfileChange: (profile: "heating" | "steady") => void }) {
  const [people, setPeople] = useState("2");
  const [rooms, setRooms] = useState("6");
  const [heating, setHeating] = useState(["gas-ducted"]);
  const [winterUse, setWinterUse] = useState("medium");
  const [hotWater, setHotWater] = useState("gas-storage");
  const [hotWaterUse, setHotWaterUse] = useState("typical");
  const [gasCooktop, setGasCooktop] = useState(false);
  const [cooktopUse, setCooktopUse] = useState("typical");
  const [gasDryer, setGasDryer] = useState(false);
  const [dryerUse, setDryerUse] = useState("low");
  const [gasSpa, setGasSpa] = useState(false);
  const [spaUse, setSpaUse] = useState("occasional");
  const [gasSpend, setGasSpend] = useState("");
  const [gasRate, setGasRate] = useState("4.5");
  const [electricityRate, setElectricityRate] = useState("30");
  const [heatingInstall, setHeatingInstall] = useState("5000");
  const [hotWaterInstall, setHotWaterInstall] = useState("3000");
  const [enquiryTitle, setEnquiryTitle] = useState("");

  const hasGasHeating = heating.some((value) => value.startsWith("gas-"));
  useEffect(() => onUsageProfileChange(hasGasHeating ? "heating" : "steady"), [hasGasHeating, onUsageProfileChange]);

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

    const hotWaterType = hotWater || "other";
    const hotWaterFactors: Record<string, number> = { low: .75, typical: 1, high: 1.25 };
    const hotWaterFactor = hotWaterFactors[hotWaterUse] ?? 1;
    const hotWaterBenchmark: EnergyProfile = HOT_WATER_GAS_MJ[hotWaterType] ? {
      gasMj: byHousehold(HOT_WATER_GAS_MJ[hotWaterType], householdSize) * hotWaterFactor,
      replacementKwh: byHousehold(HEAT_PUMP_KWH, householdSize) * hotWaterFactor,
    } : { gasMj: 0, replacementKwh: 0 };
    const cookingFactors: Record<string, number> = { low: .7, typical: 1, high: 1.3 };
    const cooktopBenchmarkMj = gasCooktop ? 1583 * (cookingFactors[cooktopUse] ?? 1) : 0;
    const dryerCyclesPerWeek: Record<string, number> = { none: 0, low: 1, medium: 3, high: 6 };
    const dryerBenchmarkMj = gasDryer ? (dryerCyclesPerWeek[dryerUse] ?? 0) * 52 * 15 : 0;
    const spaAnnualMj: Record<string, number> = { occasional: 5000, seasonal: 15000, frequent: 30000 };
    const spaBenchmarkMj = gasSpa ? spaAnnualMj[spaUse] ?? 5000 : 0;
    const benchmarkGasMj = heatingBenchmark.gasMj + hotWaterBenchmark.gasMj + cooktopBenchmarkMj + dryerBenchmarkMj + spaBenchmarkMj;
    const enteredUse = Number(annualMj);
    const use = enteredUse > 0 ? enteredUse : Math.max(12000, benchmarkGasMj);
    const billScale = benchmarkGasMj > 0 ? use / benchmarkGasMj : 0;
    const heatingGasUse = heatingBenchmark.gasMj * billScale;
    const hotWaterGasUse = hotWaterBenchmark.gasMj * billScale;
    const cooktopGasUse = cooktopBenchmarkMj * billScale;
    const dryerGasUse = dryerBenchmarkMj * billScale;
    const spaGasUse = spaBenchmarkMj * billScale;

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
      spaGasUse,
      centralArea,
      roomHeatedArea,
      hotWaterType,
      heatingPayback: Number(heatingInstall) > 0 ? Number(heatingInstall) / heatingSaving : 0,
      hotWaterPayback: Number(hotWaterInstall) > 0 ? Number(hotWaterInstall) / hotWaterSaving : 0,
      fullElectricSaving: heatingSaving + hotWaterSaving + cooktopSaving + dryerSaving + (benchmarkGasMj > 0 && !gasSpa ? supplyCharge : 0),
      hasHeating: heatingGasUse > 0,
      hasHotWater: hotWaterGasUse > 0,
    };
  }, [annualMj, people, rooms, heating, winterUse, hotWater, hotWaterUse, gasCooktop, cooktopUse, gasDryer, dryerUse, gasSpa, spaUse, gasSpend, gasRate, electricityRate, heatingInstall, hotWaterInstall]);

  return (
    <section className="card gas-questionnaire">
      <h2><span className="stepnum">2</span> Your gas appliances and home</h2>
      <p className="sub">Tell us which appliances actually use gas. Your heating answer automatically sets the seasonal pattern used to compare plans, so you only answer this once.</p>

      <div className="gas-household-context"><label className="f">People in your household<span className="field-control"><select value={people} onChange={(event) => setPeople(event.target.value)}>{Array.from({ length: 8 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></span><span className="hint">Used only for the hot-water estimate.</span></label><div><b>Seasonal plan profile</b><span>{hasGasHeating ? "Gas heating: more annual MJ is allocated to cooler months." : "No gas heating: annual MJ is allocated steadily across the year."}</span></div></div>

      <div className="gas-appliance-grid">
        <section className="gas-appliance-card gas-appliance-card-wide" aria-labelledby="gas-heating-title"><div className="gas-appliance-heading"><span>1</span><div><h3 id="gas-heating-title">Home heating</h3><p>Select every heating system used in the home.</p></div></div><div className="gas-appliance-content gas-appliance-split"><fieldset className="question-group"><legend>Heating systems</legend><div className="option-list">{heatingOptions.map((option) => <label className="option-item" key={option.value}><input type="checkbox" checked={heating.includes(option.value)} onChange={() => setHeating((current) => option.value === "none" ? ["none"] : toggleValue(current.filter((value) => value !== "none"), option.value))} />{option.label}</label>)}</div></fieldset><div className="gas-appliance-variables"><label className="f">Rooms in your home<span className="field-control"><select value={rooms} onChange={(event) => setRooms(event.target.value)}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></span><span className="hint">Used to approximate the heated area.</span></label>{hasGasHeating && <label className="f">Gas-heating use in winter<span className="field-control"><select value={winterUse} onChange={(event) => setWinterUse(event.target.value)}>{winterUseOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></span></label>}</div></div></section>

        <section className="gas-appliance-card" aria-labelledby="gas-hot-water-title"><div className="gas-appliance-heading"><span>2</span><div><h3 id="gas-hot-water-title">Hot water</h3><p>System type, household size and behaviour affect this estimate.</p></div></div><div className="gas-appliance-content"><fieldset className="question-group"><legend>Hot-water system</legend><div className="option-list">{hotWaterOptions.map((option) => <label className="option-item" key={option.value}><input type="radio" name="gas-hot-water-system" checked={hotWater === option.value} onChange={() => setHotWater(option.value)} />{option.label}</label>)}</div></fieldset>{HOT_WATER_GAS_MJ[hotWater] && <label className="f compact-field">Typical hot-water behaviour<span className="field-control"><select value={hotWaterUse} onChange={(event) => setHotWaterUse(event.target.value)}>{hotWaterUseOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></span></label>}</div></section>

        <section className="gas-appliance-card" aria-labelledby="gas-cooking-title"><div className="gas-appliance-heading"><span>3</span><div><h3 id="gas-cooking-title">Cooking</h3><p>Include a gas cooktop or gas oven used for meals.</p></div></div><div className="gas-appliance-content"><label className="option-item"><input type="checkbox" checked={gasCooktop} onChange={(event) => setGasCooktop(event.target.checked)} />I use gas for cooking</label>{gasCooktop && <label className="f compact-field">How often do you cook with gas?<span className="field-control"><select value={cooktopUse} onChange={(event) => setCooktopUse(event.target.value)}>{cookingUseOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></span></label>}</div></section>

        <section className="gas-appliance-card" aria-labelledby="gas-dryer-title"><div className="gas-appliance-heading"><span>4</span><div><h3 id="gas-dryer-title">Clothes dryer</h3><p>Gas dryers are uncommon, so only select this if the dryer is connected to gas.</p></div></div><div className="gas-appliance-content"><label className="option-item"><input type="checkbox" checked={gasDryer} onChange={(event) => setGasDryer(event.target.checked)} />I have a gas clothes dryer</label>{gasDryer && <label className="f compact-field">How often is it used?<span className="field-control"><select value={dryerUse} onChange={(event) => setDryerUse(event.target.value)}>{frequencyOptions.filter(([value]) => value !== "none").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></span></label>}</div></section>

        <section className="gas-appliance-card" aria-labelledby="gas-spa-title"><div className="gas-appliance-heading"><span>5</span><div><h3 id="gas-spa-title">Pool or spa heating</h3><p>Include this only where the water heater itself uses gas.</p></div></div><div className="gas-appliance-content"><label className="option-item"><input type="checkbox" checked={gasSpa} onChange={(event) => setGasSpa(event.target.checked)} />I heat a pool or spa with gas</label>{gasSpa && <label className="f compact-field">How often is gas heating used?<span className="field-control"><select value={spaUse} onChange={(event) => setSpaUse(event.target.value)}>{spaUseOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></span><span className="hint">This is a broad allocation proxy. Pool size, cover, temperature and climate can change usage substantially.</span></label>}</div></section>
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
        <p className="savings-note"><b>Modelled electrification saving:</b> about {dollars(estimate.fullElectricSaving)}/yr{gasSpa ? ". Pool or spa replacement energy and the gas supply charge are not included because the remaining gas appliance would keep the connection active." : ", including roughly $310/yr from disconnecting gas and dropping the daily supply charge once every gas appliance is removed."}</p>
        <details className="savings-explain"><summary>How we estimate these savings</summary><div>
          <p>We build separate benchmark profiles for your selected heating and hot-water systems, household size, room count and winter use. We then scale those profiles so the allocated uses add back to your entered {Math.round(estimate.use).toLocaleString()} MJ/year.</p>
          <p><b>Estimated bill allocation:</b> heating {Math.round(estimate.heatingGasUse).toLocaleString()} MJ, hot water {Math.round(estimate.hotWaterGasUse).toLocaleString()} MJ, cooking {Math.round(estimate.cooktopGasUse).toLocaleString()} MJ, dryer {Math.round(estimate.dryerGasUse).toLocaleString()} MJ and pool or spa {Math.round(estimate.spaGasUse).toLocaleString()} MJ.</p>
          <p>Storage, instantaneous and gas-boosted solar hot water use different household-size curves. Central heating uses about {Math.round(estimate.centralArea)} m² and room heating about {Math.round(estimate.roomHeatedArea)} m². Gas slab heating uses the published hydronic C-rating profile as the closest central-heating proxy.</p>
          <p>Cooking starts from the Victorian building-electrification reference-home assumption and is adjusted by the behaviour selected above. Dryer and pool or spa allocations are broad proxies because no equivalent Victorian household benchmark table is published. Pool or spa replacement energy is not included in the savings figure. Real savings depend on appliance ratings, building fabric, climate and behaviour. Costs use your effective gas rate of {estimate.effectiveRate.toFixed(1)}c/MJ and entered electricity rate.</p>
          <p className="method-links"><a href="https://www.sustainability.vic.gov.au/energy-efficiency-and-reducing-emissions/save-energy-in-the-home/heat-your-home-efficiently/calculate-heating-costs" target="_blank" rel="noreferrer">Heating benchmarks</a><a href="https://www.sustainability.vic.gov.au/annual-energy-costs-of-water-heating-in-2025" target="_blank" rel="noreferrer">Hot-water benchmarks</a><a href="https://www.vic.gov.au/sites/default/files/2025-03/building-electrification-regulatory-impact-statement_3785-%281%29.pdf" target="_blank" rel="noreferrer">Cooking reference</a></p>
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
