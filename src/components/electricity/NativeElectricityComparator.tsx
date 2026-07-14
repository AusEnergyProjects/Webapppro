"use client";

/* Retailer logos come from arbitrary CDR-hosted URLs. */
/* eslint-disable @next/next/no-img-element */
import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Field, StepCard } from "@/components/ComparatorChrome";
import { Nem12UsageChart } from "@/components/electricity/Nem12UsageChart";
import {
  BATTERY_ROUND_TRIP_EFFICIENCY,
  SCENARIO_COST_ASSUMPTIONS,
  defaultBatteryNetCost,
  defaultSolarNetCost,
  genericExportProfile,
  simulateBattery,
  simulateSolar,
  solarYieldForPostcode,
  suggestedBatterySize,
  suggestedSolarSize,
} from "@/lib/electricity/energy-flow";
import { allocateNem12Registers, parseNem12, scaleNem12AnnualAllocation } from "@/lib/electricity/nem12";
import type { HalfHourlyGrid, Nem12Success, RegisterRole } from "@/lib/electricity/nem12-types";
import { createDirectTradeHandoffUrl } from "@/lib/direct-trade-handoff.mjs";
import {
  DISTRIBUTOR_INFO,
  cleanNmi,
  distributorFromNmi,
  maskNmi,
  type ElectricityCustomerType,
} from "@/lib/electricity/location";
import {
  estimateNativePlan,
  NATIVE_ENGINE_VERSION,
  type NativePlanInput,
  type NativePlanResult,
  type NativeAuditRegister,
  type NativeAuditChargeLine,
} from "@/lib/electricity/native-tariff-engine";
import { buildNativeComparisonUrl, parseNativeComparisonQuery } from "@/lib/electricity/native-sharing";
import { annualiseUsage, usageForPeriod, type UsagePeriod } from "@/lib/electricity/usage-input";

type PlanBundle = {
  plans: NativePlanInput[];
  fetchedAt?: string;
  sourceHash?: string;
  tariffSchemaVersion?: string;
  source?: {
    candidatePlans?: number;
    detailPlansSucceeded?: number;
    detailPlansRejected?: number;
    detailPlansUnavailable?: number;
    retailersDiscovered?: number;
    listSourcesSucceeded?: number;
    plansMissingLastUpdated?: number;
    oldestPlanUpdatedAt?: string | null;
    newestPlanUpdatedAt?: string | null;
    partial?: boolean;
    retailerCoverage?: Array<{ retailer: string; listAvailable: boolean; candidatePlans: number; detailsPassed: number; detailsRejected: number; detailsUnavailable: number }>;
  };
};

type SetupMode = "none" | "solar" | "battery";
type PricingContext = {
  candidates: NativePlanInput[];
  profile: HalfHourlyGrid;
  controlledProfile: HalfHourlyGrid;
  annualGeneralKwh: number;
  annualControlledKwh: number;
  annualExportKwh: number;
  exportProfile: HalfHourlyGrid;
  evidenceLabel: string;
  registerEvidence: NativeAuditRegister[];
  customerType: ElectricityCustomerType;
  hasIntervalMeter: boolean;
};

type ScenarioResult = {
  label: string;
  description: string;
  best: NativePlanResult;
  annualSaving: number;
  annualImportKwh: number;
  annualExportKwh: number;
  annualDischargeKwh?: number;
  installedCost: number;
};

type ContactDetails = { name: string; email: string; phone: string; website: string };
type ChoiceOption<T extends string> = { value: T; title: string; description: string };
const LEAD_NOTICE_VERSION = "2026-07-13";

const USAGE_PERIOD_OPTIONS: ChoiceOption<UsagePeriod>[] = [
  { value: "quarterly", title: "Typical quarterly bill", description: "Enter the kWh from one representative 3 month bill." },
  { value: "monthly", title: "Monthly bill", description: "Enter the kWh from one representative month." },
  { value: "annual", title: "Annual total", description: "Enter the kWh used across a full 12 months." },
];

const PROFILE_OPTIONS: ChoiceOption<string>[] = [
  { value: "evening", title: "Mostly evenings", description: "Usually out on weekdays, with most power used after 3 pm." },
  { value: "daytime", title: "Home during the day", description: "Someone is usually home and uses power through the day." },
  { value: "even", title: "Fairly even", description: "Power use is spread fairly evenly across the day and night." },
];

const SETUP_OPTIONS: ChoiceOption<SetupMode>[] = [
  { value: "none", title: "No solar", description: "I do not have solar panels at this property." },
  { value: "solar", title: "Solar only", description: "I have solar panels but no home battery." },
  { value: "battery", title: "Solar + battery", description: "I have solar panels and a home battery." },
];

function ChoiceCards<T extends string>({ name, legend, hint, value, options, disabled = false, onChange }: {
  name: string;
  legend: string;
  hint?: string;
  value: T;
  options: ChoiceOption<T>[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return <fieldset className="native-choice-fieldset" disabled={disabled}>
    <legend>{legend}</legend>
    {hint && <p>{hint}</p>}
    <div className="native-choice-grid">
      {options.map((option) => <label className={`native-choice-card${value === option.value ? " selected" : ""}`} key={option.value}>
        <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
        <span className="native-choice-title">{option.title}</span>
        <span className="native-choice-description">{option.description}</span>
      </label>)}
    </div>
  </fieldset>;
}

function emptyProfile(): HalfHourlyGrid {
  return Array.from({ length: 7 }, () => new Array(48).fill(0));
}

function manualProfile(kind: string): HalfHourlyGrid {
  const profile = emptyProfile();
  for (let day = 0; day < 7; day += 1) for (let bin = 0; bin < 48; bin += 1) {
    const hour = bin / 2 + 0.25;
    let value = 1;
    if (kind === "evening") value = hour < 6 ? 0.35 : hour < 15 ? 0.55 : hour < 22 ? 1.8 : 0.7;
    else if (kind === "daytime") value = hour < 7 ? 0.45 : hour < 17 ? 1.4 : hour < 22 ? 1.1 : 0.55;
    profile[day][bin] = value * (day >= 5 ? 1.08 : 1);
  }
  return profile;
}

function profileAssumptionLabel(kind: string): string {
  return ({ evening: "Out weekdays, home evenings", daytime: "Home most of the day", even: "Fairly even around the clock" } as Record<string, string>)[kind] || "Modelled usage";
}

function fmtMoney(value: number) {
  return "$" + Math.round(value).toLocaleString();
}

function fmtMoneyExact(value: number) {
  return "$" + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSignedMoney(value: number): string {
  if (Math.abs(value) < 0.005) return "$0.00";
  return value < 0 ? `-${fmtMoneyExact(Math.abs(value))}` : fmtMoneyExact(value);
}

function fmtCents(value: number): string {
  return value < 1 ? value.toFixed(2) : value.toFixed(1);
}

function payback(value: number): string {
  if (!(value > 0) || !Number.isFinite(value)) return "n/a";
  const months = Math.max(1, Math.round(value * 12));
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  return `${years ? `${years} ${years === 1 ? "year" : "years"}` : ""}${years && remainder ? " " : ""}${remainder ? `${remainder} ${remainder === 1 ? "month" : "months"}` : ""}`;
}

function cheapestScenarioPlan(candidates: NativePlanInput[], inputs: Parameters<typeof estimateNativePlan>[1]): NativePlanResult | null {
  let best: NativePlanResult | null = null;
  candidates.forEach((plan) => {
    const estimate = estimateNativePlan(plan, inputs);
    if (estimate.ok && estimate.result.tariffKind !== "demand" && (!best || estimate.result.annualCost < best.annualCost)) best = estimate.result;
  });
  return best;
}

export function NativeElectricityComparator({ preview = false }: { preview?: boolean }) {
  const [postcode, setPostcode] = useState("");
  const [nmi, setNmi] = useState("");
  const [customerType, setCustomerType] = useState<ElectricityCustomerType>("RESIDENTIAL");
  const [annualKwh, setAnnualKwh] = useState("5000");
  const [usagePeriod, setUsagePeriod] = useState<UsagePeriod>("quarterly");
  const [profileKind, setProfileKind] = useState("evening");
  const [meter, setMeter] = useState<Nem12Success | null>(null);
  const [registerRoles, setRegisterRoles] = useState<Record<string, RegisterRole | undefined>>({});
  const [meterStatus, setMeterStatus] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [showUsageOverride, setShowUsageOverride] = useState(false);
  const [usageOverride, setUsageOverride] = useState<{ value: number; reason: string } | null>(null);
  const [overrideKwh, setOverrideKwh] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideError, setOverrideError] = useState("");
  const [hasControlledLoad, setHasControlledLoad] = useState(false);
  const [controlledKwh, setControlledKwh] = useState("");
  const [setupMode, setSetupMode] = useState<SetupMode>("none");
  const [solarKw, setSolarKw] = useState("");
  const [batteryKwh, setBatteryKwh] = useState("10");
  const [exportKwh, setExportKwh] = useState("");
  const [hasEv, setHasEv] = useState(false);
  const [assumeConditional, setAssumeConditional] = useState(false);
  const [distributors, setDistributors] = useState<string[]>([]);
  const [distributor, setDistributor] = useState("");
  const [meterGuideDistributor, setMeterGuideDistributor] = useState("");
  const [plans, setPlans] = useState<NativePlanResult[]>([]);
  const [excluded, setExcluded] = useState<Record<string, number>>({});
  const [bundle, setBundle] = useState<PlanBundle | null>(null);
  const [pricingContext, setPricingContext] = useState<PricingContext | null>(null);
  const [scenarioSolarKw, setScenarioSolarKw] = useState("4");
  const [scenarioBatteryKwh, setScenarioBatteryKwh] = useState("10");
  const [scenarioSolarYield, setScenarioSolarYield] = useState("1350");
  const [scenarioBatteryEfficiency, setScenarioBatteryEfficiency] = useState(String(BATTERY_ROUND_TRIP_EFFICIENCY * 100));
  const [scenarioSolarCost, setScenarioSolarCost] = useState(String(defaultSolarNetCost(4)));
  const [scenarioBatteryCost, setScenarioBatteryCost] = useState(String(defaultBatteryNetCost(10)));
  const [scenarioComboCost, setScenarioComboCost] = useState(String(defaultSolarNetCost(4) + defaultBatteryNetCost(10)));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showTou, setShowTou] = useState(true);
  const [showSingle, setShowSingle] = useState(true);
  const [showDemand, setShowDemand] = useState(true);
  const [showStanding, setShowStanding] = useState(true);
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(12);
  const [auditPlan, setAuditPlan] = useState<NativePlanResult | null>(null);
  const [shareStatus, setShareStatus] = useState("");
  const [sharedUrl, setSharedUrl] = useState("");
  const [leadName, setLeadName] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadWebsite, setLeadWebsite] = useState("");
  const [leadConsent, setLeadConsent] = useState(false);
  const [leadUpgrades, setLeadUpgrades] = useState(false);
  const [leadStatus, setLeadStatus] = useState("");
  const [leadSending, setLeadSending] = useState(false);
  const [enquiryScenario, setEnquiryScenario] = useState<ScenarioResult | null>(null);
  const pageStartedAt = useRef(0);
  const auditReturnRef = useRef<HTMLButtonElement | null>(null);
  const nmiDistributor = useMemo(() => distributorFromNmi(nmi), [nmi]);
  const guidanceDistributor = nmiDistributor || meterGuideDistributor || distributor;
  const distributorInfo = guidanceDistributor ? DISTRIBUTOR_INFO[guidanceDistributor] : null;
  const displayedUsage = usageForPeriod(annualKwh, usagePeriod);
  const annualUsageNumber = Number(annualKwh);
  const meterAllocation = useMemo(() => meter ? allocateNem12Registers(meter.registers, registerRoles) : null, [meter, registerRoles]);
  const demandReady = Boolean(meter && meterAllocation?.ok && meter.dateSpanDays >= 360 && meter.coverageRatio >= 0.98 && meter.actualPct >= 0.9);

  useEffect(() => {
    pageStartedAt.current = Date.now();
    const restored = parseNativeComparisonQuery(window.location.search);
    /* URL restoration intentionally initializes the controlled form after hydration. */
    /* eslint-disable react-hooks/set-state-in-effect */
    if (restored.postcode) setPostcode(restored.postcode);
    if (restored.annualKwh) {
      setAnnualKwh(String(restored.annualKwh));
      setUsagePeriod("annual");
    }
    if (restored.profileKind) setProfileKind(restored.profileKind);
    if (restored.customerType) setCustomerType(restored.customerType);
    if (restored.setupMode) setSetupMode(restored.setupMode);
    if (restored.solarKw) setSolarKw(String(restored.solarKw));
    if (restored.batteryKwh) setBatteryKwh(String(restored.batteryKwh));
    if (restored.exportKwh) setExportKwh(String(restored.exportKwh));
    if (restored.controlledKwh) setControlledKwh(String(restored.controlledKwh));
    setHasEv(Boolean(restored.hasEv));
    setHasControlledLoad(Boolean(restored.hasControlledLoad));
    setAssumeConditional(Boolean(restored.assumeConditional));
    if (restored.meterReupload) setMeterStatus("This saved comparison used interval data. Re-upload the NEM12 file locally, then run the comparison; the file and NMI were not stored in the link.");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const upgradeScenarios = useMemo((): ScenarioResult[] => {
    if (!pricingContext || !plans.length || setupMode === "battery") return [];
    const bestNow = plans.filter((plan) => plan.tariffKind !== "demand").sort((a, b) => a.annualCost - b.annualCost)[0];
    if (!bestNow) return [];
    const batterySize = Math.max(0, Number(scenarioBatteryKwh));
    const solarYield = Math.max(0, Number(scenarioSolarYield)) || solarYieldForPostcode(postcode);
    const batteryEfficiency = Math.min(1, Math.max(0.5, Number(scenarioBatteryEfficiency) / 100 || BATTERY_ROUND_TRIP_EFFICIENCY));
    const common = {
      annualControlledKwh: pricingContext.annualControlledKwh,
      controlledProfile: pricingContext.controlledProfile,
      assumeConditional,
      hasEv,
      registerEvidence: pricingContext.registerEvidence,
      customerType: pricingContext.customerType,
      hasIntervalMeter: pricingContext.hasIntervalMeter,
    };
    const results: ScenarioResult[] = [];
    if (setupMode === "none") {
      const size = Math.max(0, Number(scenarioSolarKw));
      if (!(size > 0)) return [];
      const solar = simulateSolar(pricingContext.profile, pricingContext.annualGeneralKwh, size * solarYield);
      const solarBest = cheapestScenarioPlan(pricingContext.candidates, {
        ...common, annualGeneralKwh: solar.annualImport, profile: solar.importProfile, hasSolar: true,
        annualExportKwh: solar.annualExport, exportProfile: solar.exportProfile,
        evidenceLabel: `Scenario based on ${pricingContext.evidenceLabel} ${size} kW solar at ${Math.round(solarYield)} kWh/kW/year was simulated half hourly before tariff pricing.`,
      });
      if (solarBest) results.push({
        label: "Solar only", description: `${size} kW solar`, best: solarBest,
        annualSaving: bestNow.annualCost - solarBest.annualCost, annualImportKwh: solar.annualImport,
        annualExportKwh: solar.annualExport, installedCost: Math.max(0, Number(scenarioSolarCost)),
      });
      if (batterySize > 0) {
        const battery = simulateBattery(solar.importProfile, solar.exportProfile, solar.annualImport, solar.annualExport, batterySize, batteryEfficiency);
        const batteryBest = cheapestScenarioPlan(pricingContext.candidates, {
          ...common, annualGeneralKwh: battery.annualImport, profile: battery.importProfile, hasSolar: true, hasBattery: true,
          annualExportKwh: battery.annualExport, exportProfile: battery.exportProfile,
          evidenceLabel: `Scenario based on ${pricingContext.evidenceLabel} ${size} kW solar at ${Math.round(solarYield)} kWh/kW/year and a ${batterySize} kWh usable battery at ${Math.round(batteryEfficiency * 100)}% round-trip efficiency were simulated half hourly before tariff pricing.`,
        });
        if (batteryBest) results.push({
          label: "Solar + battery", description: `${size} kW solar + ${batterySize} kWh battery`, best: batteryBest,
          annualSaving: bestNow.annualCost - batteryBest.annualCost, annualImportKwh: battery.annualImport,
          annualExportKwh: battery.annualExport, annualDischargeKwh: battery.annualDischarge,
          installedCost: Math.max(0, Number(scenarioComboCost)),
        });
      }
    } else if (setupMode === "solar" && pricingContext.annualExportKwh > 0 && batterySize > 0) {
      const battery = simulateBattery(pricingContext.profile, pricingContext.exportProfile, pricingContext.annualGeneralKwh, pricingContext.annualExportKwh, batterySize, batteryEfficiency);
      const batteryBest = cheapestScenarioPlan(pricingContext.candidates, {
        ...common, annualGeneralKwh: battery.annualImport, profile: battery.importProfile, hasSolar: true, hasBattery: true,
        annualExportKwh: battery.annualExport, exportProfile: battery.exportProfile,
        evidenceLabel: `Scenario based on ${pricingContext.evidenceLabel} A ${batterySize} kWh usable battery at ${Math.round(batteryEfficiency * 100)}% round-trip efficiency was dispatched half hourly before tariff pricing.`,
      });
      if (batteryBest) results.push({
        label: "Add a battery", description: `${batterySize} kWh battery`, best: batteryBest,
        annualSaving: bestNow.annualCost - batteryBest.annualCost, annualImportKwh: battery.annualImport,
        annualExportKwh: battery.annualExport, annualDischargeKwh: battery.annualDischarge,
        installedCost: Math.max(0, Number(scenarioBatteryCost)),
      });
    }
    return results;
  }, [assumeConditional, hasEv, plans, postcode, pricingContext, scenarioBatteryCost, scenarioBatteryEfficiency, scenarioBatteryKwh, scenarioComboCost, scenarioSolarCost, scenarioSolarKw, scenarioSolarYield, setupMode]);

  function updateScenarioSolarSize(value: string) {
    setScenarioSolarKw(value);
    const solarCost = defaultSolarNetCost(Number(value));
    setScenarioSolarCost(String(solarCost));
    setScenarioComboCost(String(solarCost + defaultBatteryNetCost(Number(scenarioBatteryKwh))));
  }

  function updateScenarioBatterySize(value: string) {
    setScenarioBatteryKwh(value);
    const batteryCost = defaultBatteryNetCost(Number(value));
    setScenarioBatteryCost(String(batteryCost));
    setScenarioComboCost(String(defaultSolarNetCost(Number(scenarioSolarKw)) + batteryCost));
  }

  async function readMeterFile(file: File | undefined) {
    if (!file) return;
    setMeterStatus("Reading meter data locally...");
    const parsed = parseNem12(await file.text());
    if (!parsed.ok) { setMeter(null); setRegisterRoles({}); setMeterStatus(parsed.err); return; }
    const initialRoles: Record<string, RegisterRole | undefined> = {};
    if (parsed.registers.length === 1) initialRoles[parsed.registers[0].id] = "general";
    setMeter(parsed);
    setRegisterRoles(initialRoles);
    setUsageOverride(null);
    setShowUsageOverride(false);
    setAnnualKwh(String(Math.round(parsed.annualImport)));
    setUsagePeriod("annual");
    if (parsed.nmi && !nmi) {
      setNmi(cleanNmi(parsed.nmi).slice(0, 11));
      setDistributor("");
    }
    if (parsed.annualExport > 100) {
      setSetupMode((current) => current === "none" ? "solar" : current);
      setExportKwh(String(Math.round(parsed.annualExport)));
    }
    setMeterStatus(parsed.registers.length > 1
      ? `Loaded ${parsed.registers.length} consumption registers across ${parsed.spanDays} observed days. Confirm each register before comparing.`
      : `Loaded ${parsed.spanDays} observed days. The annual total and measured time pattern are active.`);
  }

  function removeMeterData() {
    setMeter(null);
    setRegisterRoles({});
    setUsageOverride(null);
    setShowUsageOverride(false);
    setOverrideError("");
    setMeterStatus("Meter data removed. Manual assumptions are active.");
  }

  function openAnnualOverride() {
    if (!meter) return;
    setOverrideKwh(String(Math.round(usageOverride?.value || meter.annualImport)));
    setOverrideReason(usageOverride?.reason || "");
    setOverrideError("");
    setShowUsageOverride(true);
  }

  function applyAnnualOverride() {
    const value = Number(overrideKwh);
    const reason = overrideReason.trim();
    if (!(value > 0) || reason.length < 5) {
      setOverrideError("Enter a positive annual kWh figure and a short reason of at least 5 characters.");
      return;
    }
    setUsageOverride({ value, reason });
    setAnnualKwh(String(Math.round(value)));
    setUsagePeriod("annual");
    setShowUsageOverride(false);
    setOverrideError("");
    setMeterStatus("Annual total adjusted. The original measured interval pattern remains active.");
  }

  function removeAnnualOverride() {
    if (!meter) return;
    setUsageOverride(null);
    setAnnualKwh(String(Math.round(meter.annualImport)));
    setUsagePeriod("annual");
    setShowUsageOverride(false);
    setOverrideError("");
    setMeterStatus("Annual adjustment removed. The NEM12 annual figure and measured pattern are active.");
  }

  function handleMeterDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    void readMeterFile(event.dataTransfer.files?.[0]);
  }

  async function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setPlans([]); setPricingContext(null); setShown(12);
    if (!/^\d{4}$/.test(postcode)) { setError("Enter a valid 4 digit postcode."); return; }
    const cleanedNmi = cleanNmi(nmi);
    if (cleanedNmi && (cleanedNmi.length < 10 || cleanedNmi.length > 11)) { setError("An NMI must contain 10 characters, plus an optional checksum character."); return; }
    const totalKwh = Number(annualKwh);
    if (meter && !meterAllocation?.ok) { setError("Confirm whether every meter register is general usage or controlled load before comparing."); return; }
    const scaledAllocation = meterAllocation?.ok ? scaleNem12AnnualAllocation(meterAllocation, totalKwh) : null;
    const allocationScale = scaledAllocation?.scale || 1;
    const controlled = scaledAllocation ? scaledAllocation.annualControlledKwh : hasControlledLoad ? Number(controlledKwh) : 0;
    const general = scaledAllocation ? scaledAllocation.annualGeneralKwh : totalKwh - controlled;
    if (!(totalKwh > 0)) { setError("Enter annual electricity usage in kWh."); return; }
    if (hasControlledLoad && (!(controlled > 0) || controlled >= totalKwh)) { setError("Controlled-load usage must be positive and less than total annual usage."); return; }
    const hasSolar = setupMode !== "none";
    const hasBattery = setupMode === "battery";
    const systemSize = Math.max(0, Number(solarKw));
    if (hasSolar && !(systemSize > 0) && !(meter && meter.annualExport > 0)) { setError("Enter the existing solar system size, or upload meter data containing solar exports."); return; }
    if (hasBattery && !(Number(batteryKwh) > 0)) { setError("Enter the usable battery size in kWh."); return; }
    let annualExport = hasSolar ? Math.max(0, Number(exportKwh)) : 0;
    if (hasSolar && !(annualExport > 0) && systemSize > 0) annualExport = Math.round(systemSize * solarYieldForPostcode(postcode) * (hasBattery ? 0.3 : 0.55));
    setLoading(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(`/api/electricity-plans?postcode=${encodeURIComponent(postcode)}&customerType=${encodeURIComponent(customerType)}`, { signal: controller.signal });
      const data = await response.json() as PlanBundle & { error?: string };
      if (!response.ok || !Array.isArray(data.plans)) throw new Error(data.error || "Could not load electricity plans.");
      setBundle(data);
      const availableDistributors = [...new Set(data.plans.flatMap((plan) => plan.distributors || []))].sort();
      setDistributors(availableDistributors);
      if (nmiDistributor && !availableDistributors.includes(nmiDistributor)) {
        setError(`The NMI resolves to ${nmiDistributor}, which does not match plans published for postcode ${postcode}. Check both values before comparing.`);
        return;
      }
      const selectedDistributor = nmiDistributor || distributor || (availableDistributors.length === 1 ? availableDistributors[0] : "");
      if (!selectedDistributor && availableDistributors.length > 1) {
        setError("This postcode crosses electricity networks. Choose your distributor, then compare again.");
        return;
      }
      if (selectedDistributor && distributor !== selectedDistributor) setDistributor(selectedDistributor);
      const candidates = selectedDistributor ? data.plans.filter((plan) => plan.distributors?.includes(selectedDistributor)) : data.plans;
      const profile = meterAllocation?.ok ? meterAllocation.generalProfile : manualProfile(profileKind);
      const controlledProfile = meterAllocation?.ok ? meterAllocation.controlledProfile : profile;
      const exportProfile = hasSolar
        ? meter && meter.annualExport > 0 ? meter.exportProfile : genericExportProfile(annualExport)
        : emptyProfile();
      const customerEvidence = customerType === "BUSINESS" ? " Small-business offers were requested." : " Residential offers were requested.";
      const overrideEvidence = usageOverride ? ` The annual total was adjusted from ${Math.round(meter?.annualImport || 0).toLocaleString()} to ${Math.round(usageOverride.value).toLocaleString()} kWh because: ${usageOverride.reason}. The measured interval proportions were retained and scaled.` : "";
      const evidenceLabel = meter
        ? `Measured NEM12 intervals: ${meter.spanDays} observed days, ${Math.round(meter.coverageRatio * 100)}% day coverage and ${Math.round(meter.actualPct * 100)}% actual intervals.${overrideEvidence}${customerEvidence}`
        : `Manual assumption: ${profileAssumptionLabel(profileKind)}. This selection determines the TOU allocation.${customerEvidence}`;
      const registerEvidence: NativeAuditRegister[] = meterAllocation?.ok && meter ? meter.registers.map((register) => ({
        id: register.id,
        role: registerRoles[register.id] as "general" | "controlled",
        annualKwh: register.annualKwh * allocationScale,
        intervalMinutes: register.intervalMinutes,
      })) : [];
      const reasons: Record<string, number> = {};
      const priced: NativePlanResult[] = [];
      candidates.forEach((plan) => {
        const estimate = estimateNativePlan(plan, {
          annualGeneralKwh: general,
          annualControlledKwh: controlled,
          profile,
          controlledProfile,
          assumeConditional,
          demandReady,
          demandSeries: meterAllocation?.ok ? meterAllocation.series : undefined,
          intervalSeries: meterAllocation?.ok ? meterAllocation.series : undefined,
          hasSolar,
          hasBattery,
          hasEv,
          hasIntervalMeter: Boolean(meter),
          customerType,
          annualExportKwh: annualExport,
          exportProfile,
          evidenceLabel,
          registerEvidence,
        });
        if (estimate.ok) priced.push(estimate.result);
        else reasons[estimate.reason] = (reasons[estimate.reason] || 0) + 1;
      });
      setExcluded(reasons);
      setPlans(priced.sort((a, b) => a.annualCost - b.annualCost));
      const suggestedSolar = suggestedSolarSize(totalKwh, postcode);
      const previewSolar = simulateSolar(profile, general, suggestedSolar * solarYieldForPostcode(postcode));
      const suggestedBattery = suggestedBatterySize(previewSolar.importProfile, previewSolar.annualImport, previewSolar.annualExport);
      setScenarioSolarKw(String(suggestedSolar));
      setScenarioBatteryKwh(String(suggestedBattery));
      setScenarioSolarYield(String(solarYieldForPostcode(postcode)));
      setScenarioBatteryEfficiency(String(BATTERY_ROUND_TRIP_EFFICIENCY * 100));
      setScenarioSolarCost(String(defaultSolarNetCost(suggestedSolar)));
      setScenarioBatteryCost(String(defaultBatteryNetCost(suggestedBattery)));
      setScenarioComboCost(String(defaultSolarNetCost(suggestedSolar) + defaultBatteryNetCost(suggestedBattery)));
      setPricingContext({ candidates, profile, controlledProfile, annualGeneralKwh: general, annualControlledKwh: controlled, annualExportKwh: annualExport, exportProfile, evidenceLabel, registerEvidence, customerType, hasIntervalMeter: Boolean(meter) });
      if (!priced.length) setError("Plans were published, but none met the comparison engine's strict priceability rules for these inputs.");
    } catch (caught) {
      setError(controller.signal.aborted ? "The electricity comparison took too long. Please try again shortly." : caught instanceof Error ? caught.message : "Could not load electricity plans.");
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  const visible = useMemo(() => plans
    .filter((plan) => showTou || plan.tariffKind !== "tou")
    .filter((plan) => showSingle || plan.tariffKind !== "single")
    .filter((plan) => showDemand || plan.tariffKind !== "demand")
    .filter((plan) => showStanding || plan.type !== "STANDING")
    .filter((plan) => { const query = search.trim().toLowerCase(); return !query || plan.name.toLowerCase().includes(query) || plan.brand.toLowerCase().includes(query); })
    .sort((a, b) => a.annualCost - b.annualCost), [plans, search, showDemand, showSingle, showStanding, showTou]);
  const best = visible[0];
  const median = visible[Math.floor(visible.length / 2)];

  function privateSafeUrl(): string {
    return buildNativeComparisonUrl(window.location.origin, {
      postcode, annualKwh: Number(annualKwh), profileKind: profileKind as "evening" | "daytime" | "even",
      customerType, setupMode, solarKw: Number(solarKw) || undefined, batteryKwh: Number(batteryKwh) || undefined,
      exportKwh: Number(exportKwh) || undefined, hasEv, hasControlledLoad: meter ? Boolean(meterAllocation?.ok && meterAllocation.annualControlledKwh > 0) : hasControlledLoad,
      controlledKwh: !meter ? Number(controlledKwh) || undefined : undefined, assumeConditional, usedMeter: Boolean(meter),
    });
  }

  function topPlans() {
    return visible.slice(0, 3).map((plan, index) => ({
      rank: index + 1, brand: plan.brand, plan: plan.name, offerId: plan.planId.split("@")[0],
      annual: Math.round(plan.annualCost), monthly: Math.round(plan.annualCost / 12),
      tariffHash: plan.tariffHash || "", link: plan.link || plan.retailerUrl || "",
    }));
  }

  function provenance() {
    return {
      engineVersion: NATIVE_ENGINE_VERSION, tariffSchemaVersion: bundle?.tariffSchemaVersion || "",
      sourceHash: bundle?.sourceHash || "", sourceFetchedAt: bundle?.fetchedAt || "",
      annualSource: meter ? usageOverride ? "meter-adjusted" : "meter-measured" : "manual",
      meterConfidence: meter?.confidence || "modelled", conditionalDiscountsAssumed: assumeConditional,
    };
  }

  async function postLead(payload: Record<string, unknown>) {
    const response = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; reference?: string };
    if (!response.ok || !result.ok) throw new Error(result.error || "Your request could not be delivered. Please try again.");
    return result.reference || "";
  }

  async function copyPrivateLink() {
    const url = privateSafeUrl();
    setSharedUrl(url);
    setShareStatus("Private-safe link ready below.");
    try {
      await Promise.race([
        navigator.clipboard.writeText(url),
        new Promise((_, reject) => window.setTimeout(() => reject(new Error("Clipboard timed out")), 1200)),
      ]);
      setShareStatus(meter ? "Private-safe link copied. It asks for the meter file to be re-uploaded locally." : "Private-safe comparison link copied.");
    } catch {
      setShareStatus("The private-safe link is ready below. Select it and copy it manually.");
    }
  }

  async function sendTopPlans(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!leadConsent) { setLeadStatus("Please confirm that we may email these results and six-monthly reminders."); return; }
    setLeadSending(true); setLeadStatus("Sending...");
    try {
      const reference = await postLead({
        submissionType: "comparison", clientStartedAt: pageStartedAt.current, website: leadWebsite,
        name: leadName, email: leadEmail, phone: leadPhone, upgrades: leadUpgrades,
        postcode, annualKwh: Math.round(Number(annualKwh)), solar: setupMode, hasEv,
        hasControlledLoad: meter ? Boolean(meterAllocation?.ok && meterAllocation.annualControlledKwh > 0) : hasControlledLoad,
        top3: topPlans(), magicLink: privateSafeUrl(), provenance: provenance(), recheckMonths: 6,
        consent: { accepted: true, purpose: "Email comparison results and six monthly comparison reminders", noticeVersion: LEAD_NOTICE_VERSION, grantedAt: new Date().toISOString() },
      });
      setLeadStatus(`Done. The top three plans and a six-monthly reminder will be sent to ${leadEmail}.${reference ? ` Reference ${reference}.` : ""}`);
    } catch (caught) { setLeadStatus(caught instanceof Error ? caught.message : "Could not send right now."); }
    finally { setLeadSending(false); }
  }

  async function sendUpgradeEnquiry(contact: ContactDetails) {
    if (!enquiryScenario) return;
    const scenario = enquiryScenario;
    const enquiry = scenario.label === "Solar only" ? "electricity-solar" : scenario.label === "Solar + battery" ? "electricity-solar-battery" : "electricity-battery";
    await postLead({
      submissionType: "upgrade", clientStartedAt: pageStartedAt.current,
      enquiry, type: `Electricity upgrade enquiry: ${scenario.label}`,
      upgrades: true, ...contact, postcode, annualKwh: Math.round(Number(annualKwh)), solar: setupMode, hasEv,
      hasControlledLoad: meter ? Boolean(meterAllocation?.ok && meterAllocation.annualControlledKwh > 0) : hasControlledLoad,
      solarKw: scenario.label === "Add a battery" ? Number(solarKw) || undefined : Number(scenarioSolarKw),
      batteryKwh: scenario.annualDischargeKwh != null ? Number(scenarioBatteryKwh) : undefined,
      solarCost: scenario.label === "Solar only" ? scenario.installedCost : undefined,
      comboCost: scenario.label !== "Solar only" ? scenario.installedCost : undefined,
      installedCost: scenario.installedCost,
      annualSaving: scenario.annualSaving, top3: topPlans(), magicLink: privateSafeUrl(), provenance: provenance(),
      consent: { accepted: true, purpose: "Respond to this upgrade enquiry", noticeVersion: LEAD_NOTICE_VERSION, grantedAt: new Date().toISOString() },
    });
  }
  function closeAudit() {
    setAuditPlan(null);
    queueMicrotask(() => auditReturnRef.current?.focus());
  }

  return <>
    {preview && <div className="native-preview"><b>Internal regression route</b><span>The live electricity comparer is available at <a href="/compare">/compare</a>.</span></div>}
    <form onSubmit={compare}>
      <StepCard number="1" title="Usage and location">
        <p className="sub">Start with the details on a recent electricity bill. Your NMI is optional and always stays in this browser.</p>
        <div className="grid c3 native-location-grid">
          <Field label="Postcode"><input type="text" value={postcode} inputMode="numeric" maxLength={4} onChange={(event) => { setPostcode(event.target.value); setDistributor(""); setDistributors([]); }} placeholder="e.g. 3000" /></Field>
          <Field label="NMI" optional="(optional)" hint="A 10 or 11 character number, usually near the top of your bill. It identifies your electricity connection."><input type="text" value={nmi} maxLength={11} autoComplete="off" onChange={(event) => { setNmi(cleanNmi(event.target.value).slice(0, 11)); setDistributor(""); }} placeholder="e.g. 6407123456" /></Field>
          <Field label="Customer type"><select value={customerType} onChange={(event) => setCustomerType(event.target.value as ElectricityCustomerType)}><option value="RESIDENTIAL">Residential</option><option value="BUSINESS">Small business</option></select></Field>
          {distributors.length > 1 && <Field label="Network distributor" hint={nmiDistributor ? "Confirmed from your NMI." : "Required because this postcode crosses network boundaries."}><select value={nmiDistributor || distributor} disabled={Boolean(nmiDistributor)} onChange={(event) => setDistributor(event.target.value)}><option value="">Choose distributor</option>{distributors.map((name) => <option key={name}>{name}</option>)}</select></Field>}
        </div>
        <p className="native-nmi-help">Not sure where to find your NMI? <a href="#meter-data-help">Follow the bill and meter-data guide below</a>.</p>
        {nmi && <div className={nmiDistributor ? "native-location-evidence ok" : "native-location-evidence"} aria-live="polite">{nmiDistributor ? <><b>{nmiDistributor}</b> was identified from NMI {maskNmi(nmi)}. The full NMI stays in this browser and is not included in the plan request.</> : cleanNmi(nmi).length >= 10 ? <>This NMI prefix is not in the supported National Electricity Market allocation table. We will use postcode and ask you to confirm the distributor if needed.</> : <>Enter the complete NMI to confirm the exact distributor.</>}</div>}
        <div className="native-usage-panel">
          <div className="native-section-intro"><h3>Electricity usage from your bill</h3><p>You do not need to know your annual usage. Choose the period shown on your bill and enter its total kWh.</p></div>
          <ChoiceCards name="usage-period" legend="What period does your usage cover?" value={usagePeriod} options={USAGE_PERIOD_OPTIONS} disabled={Boolean(meter)} onChange={setUsagePeriod} />
          <div className="native-usage-entry">
            <Field label="Grid usage" hint={meter ? "Read-only while your uploaded meter data is active." : "Enter the kWh figure, not the dollar amount. Look for kWh, total usage or consumption on your bill."}>
              <input type="number" min="1" step="any" value={displayedUsage} readOnly={Boolean(meter)} onChange={(event) => { const value = event.target.value; setAnnualKwh(value === "" ? "" : String(annualiseUsage(value, usagePeriod))); }} placeholder={usagePeriod === "quarterly" ? "e.g. 1250" : usagePeriod === "monthly" ? "e.g. 420" : "e.g. 5000"} />
            </Field>
            {!meter && annualUsageNumber > 0 && <div className="native-annual-equivalent" aria-live="polite"><b>{Math.round(annualUsageNumber).toLocaleString()} kWh per year</b><span>will be used to compare plans.</span></div>}
          </div>
          <ChoiceCards name="usage-pattern" legend="When do you usually use the most power?" hint="This helps estimate time-of-use plans when no smart-meter file is provided." value={profileKind} options={PROFILE_OPTIONS} disabled={Boolean(meter)} onChange={setProfileKind} />
        </div>
      </StepCard>
      <StepCard number="2" title="Optional: use your smart-meter data">
        <p className="sub">For the most accurate comparison, upload a NEM12 CSV with up to 12 months of interval usage. The file is read only in this browser and is never uploaded.</p>
        <div className={`native-dropzone${dragActive ? " drag" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }} onDrop={handleMeterDrop}>
          <b>Drag your NEM12 meter-data CSV here</b>
          <span>or choose a file from this device</span>
          <label className="btn ghost" htmlFor="native-nem12-file">Choose meter-data file</label>
          <input id="native-nem12-file" type="file" accept=".csv,.txt,text/csv,text/plain" aria-label="Choose NEM12 file" onChange={(event) => void readMeterFile(event.target.files?.[0])} />
        </div>
        <details className="native-meter-help" id="meter-data-help">
          <summary>Step-by-step: find your NMI and download meter data</summary>
          <div>
            <div className="native-meter-clarifier"><b>Your NMI and meter data are different.</b><span>The NMI is the connection number printed on your bill. The NEM12 CSV is the detailed usage file you download from your electricity distributor, sometimes called your network.</span></div>
            <ol className="native-meter-steps">
              <li><b>Open a recent electricity bill.</b><span>Find the 10 or 11 character NMI, usually on the first or second page near your supply address.</span></li>
              <li><b>Identify your distributor.</b><span>Enter the NMI above, check the network name on your bill, or choose it below.</span></li>
              <li><b>Request interval data.</b><span>Use the matching official link and ask for up to 12 months in NEM12 CSV format.</span></li>
              <li><b>Upload the downloaded CSV here.</b><span>You do not need to open or edit it first.</span></li>
            </ol>
            <div className="native-guide-selector"><Field label="Choose your electricity distributor" hint={nmiDistributor ? "Identified from the NMI entered above." : "If you are unsure, check the network or faults number printed on your bill."}><select value={guidanceDistributor} disabled={Boolean(nmiDistributor)} onChange={(event) => setMeterGuideDistributor(event.target.value)}><option value="">Choose distributor</option>{Object.keys(DISTRIBUTOR_INFO).map((name) => <option key={name}>{name}</option>)}</select></Field></div>
            {distributorInfo && <div className="native-distributor-card"><b>{guidanceDistributor}</b><span>{distributorInfo.state} | AEMO region {distributorInfo.region}</span><p>{distributorInfo.meterDataInstructions}</p><div className="native-guidance-links">{distributorInfo.meterDataUrl && <a href={distributorInfo.meterDataUrl} target="_blank" rel="noreferrer">Open official meter-data page</a>}<a href={distributorInfo.website} target="_blank" rel="noreferrer">Open distributor website</a></div></div>}
            <h3 className="native-network-links-title">Official links for every supported distributor</h3>
            <div className="native-network-links">{Object.entries(DISTRIBUTOR_INFO).map(([name, info]) => <a href={info.meterDataUrl || info.website} target="_blank" rel="noreferrer" key={name}><b>{name}</b><span>{info.state} | {info.meterDataUrl ? "Meter-data help" : "Distributor help"}</span></a>)}</div>
            <p className="native-privacy-note">The downloaded file is read locally. Its NMI and intervals are never uploaded by this comparer.</p>
          </div>
        </details>
        {meterStatus && <p className={meter && meterAllocation?.ok ? "native-meter-status ok" : "native-meter-status"}>{meterStatus}</p>}
        {meter && <>
          <div className="native-meter-actions"><button type="button" className="btn ghost" onClick={openAnnualOverride}>Adjust annual total</button><button type="button" className="btn ghost" onClick={removeMeterData}>Remove meter data</button></div>
          {usageOverride && <p className="native-override-flag">Annual usage adjusted from {Math.round(meter.annualImport).toLocaleString()} to {Math.round(usageOverride.value).toLocaleString()} kWh. Reason: {usageOverride.reason}. The measured time pattern is unchanged.</p>}
          {showUsageOverride && <div className="native-override-panel">
            <div className="grid c3"><Field label="Adjusted annual grid usage"><input type="number" min="1" step="1" value={overrideKwh} onChange={(event) => setOverrideKwh(event.target.value)} /></Field><div className="native-override-reason"><Field label="Reason for adjustment" hint="Required so the change remains visible in every calculation audit."><input type="text" maxLength={160} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="e.g. recent heating upgrade" /></Field></div></div>
            <div className="native-meter-actions"><button type="button" className="btn" onClick={applyAnnualOverride}>Apply adjustment</button><button type="button" className="btn ghost" onClick={() => { setShowUsageOverride(false); setOverrideError(""); }}>Cancel</button>{usageOverride && <button type="button" className="btn ghost" onClick={removeAnnualOverride}>Use NEM12 annual figure</button>}</div>
            {overrideError && <p className="error">{overrideError}</p>}
          </div>}
          {meter.registers.length > 1 && <div className="grid c3">
            {meter.registers.map((register) => <Field key={register.id} label={`${register.id} (${Math.round(register.annualKwh).toLocaleString()} kWh/yr)`} hint={register.suggestedRole ? `File evidence suggests ${register.suggestedRole === "general" ? "general usage" : "controlled load"}. Confirm this assignment.` : "No reliable role was found in the file. Confirm this assignment."}>
              <select aria-label={`Role for register ${register.id}`} value={registerRoles[register.id] || ""} onChange={(event) => setRegisterRoles((current) => ({ ...current, [register.id]: event.target.value ? event.target.value as RegisterRole : undefined }))}>
                <option value="">Choose register role</option><option value="general">General usage</option><option value="controlled">Controlled load</option>
              </select>
            </Field>)}
          </div>}
          {meterAllocation?.ok && <p className="native-meter-status ok">Confirmed allocation: {Math.round(meterAllocation.annualGeneralKwh).toLocaleString()} kWh general usage{meterAllocation.annualControlledKwh > 0 ? ` and ${Math.round(meterAllocation.annualControlledKwh).toLocaleString()} kWh controlled load` : ""}{usageOverride ? ", proportionally scaled to the adjusted annual total for pricing" : ""}. {demandReady ? "Measured demand pricing is available." : "Demand pricing needs at least 360 days, 98% day coverage and 90% actual intervals."}</p>}
          <Nem12UsageChart data={meter} />
        </>}
      </StepCard>
      <StepCard number="3" title="Pricing assumptions">
        <p className="sub">Tell us what is already installed and which plan conditions apply to your home.</p>
        <ChoiceCards name="current-energy-setup" legend="Current solar and battery setup" value={setupMode} options={SETUP_OPTIONS} onChange={setSetupMode} />
        {setupMode !== "none" && <div className="grid c3 native-existing-system-fields">
          <Field label="Existing solar system size" hint="kW. If exports are not supplied, this and the postcode estimate them."><input type="number" min="0.1" step="0.1" value={solarKw} onChange={(event) => setSolarKw(event.target.value)} placeholder="e.g. 6.6" /></Field>
          {setupMode === "battery" && <Field label="Existing usable battery size" hint="kWh. Uploaded imports are not shifted again."><input type="number" min="0.1" step="0.1" value={batteryKwh} onChange={(event) => setBatteryKwh(event.target.value)} /></Field>}
          <Field label="Annual solar export" hint={meter?.annualExport ? "Read from the active meter file." : "kWh exported to the grid. Leave blank to estimate."}><input type="number" min="0" value={exportKwh} readOnly={Boolean(meter?.annualExport)} onChange={(event) => setExportKwh(event.target.value)} placeholder="Estimate from system size" /></Field>
        </div>}
        <div className="native-assumption-grid">
          {!meter && <label className={`native-assumption-card${hasControlledLoad ? " selected" : ""}`}><input type="checkbox" checked={hasControlledLoad} onChange={(event) => setHasControlledLoad(event.target.checked)} /><span><b>I have a controlled load</b><small>Usually electric hot water, slab heating or pool equipment shown separately on your bill as controlled load, dedicated circuit or off-peak usage.</small></span></label>}
          <label className={`native-assumption-card${hasEv ? " selected" : ""}`}><input type="checkbox" checked={hasEv} onChange={(event) => setHasEv(event.target.checked)} /><span><b>I charge an electric vehicle at home</b><small>Select this so EV-specific plans can be included when you meet their equipment requirements.</small></span></label>
          <label className={`native-assumption-card${assumeConditional ? " selected" : ""}`}><input type="checkbox" checked={assumeConditional} onChange={(event) => setAssumeConditional(event.target.checked)} /><span><b>Include conditional discounts</b><small>Only select this if you expect to meet conditions such as paying on time or using direct debit. Otherwise we leave these discounts out.</small></span></label>
        </div>
        {!meter && hasControlledLoad && <div className="native-controlled-usage"><Field label="Controlled-load usage per year" hint="Enter only the separately listed controlled-load kWh from your bill. It must be less than your total grid usage."><input type="number" min="1" value={controlledKwh} onChange={(event) => setControlledKwh(event.target.value)} placeholder="e.g. 1200" /></Field></div>}
      </StepCard>
      <div className="gas-compare-action"><button className="btn" disabled={loading}>{loading ? "Pricing published plans..." : "Run native comparison"}</button></div>
      {error && <p className="error">{error}</p>}
    </form>

    <details className="native-definitions">
      <summary>Definitions used in this comparison</summary>
      <dl><div><dt>NMI</dt><dd>The identifier for an electricity connection point. It is used locally to identify the network and is never shared.</dd></div><div><dt>NEM12</dt><dd>A standard interval-meter file. This comparer reads its dated usage registers in the browser.</dd></div><div><dt>General and controlled load</dt><dd>General usage powers normal circuits. Controlled load is a separately metered circuit, commonly hot water, with its own tariff.</dd></div><div><dt>Time of use (TOU)</dt><dd>Rates that change by time and day. Meter intervals are allocated to each plan&apos;s published windows.</dd></div><div><dt>Demand tariff</dt><dd>A tariff with a charge based on measured peak power during published periods, in addition to energy charges.</dd></div><div><dt>Supply charge</dt><dd>The daily fixed charge for keeping the property connected.</dd></div><div><dt>Feed-in tariff</dt><dd>The credit paid for solar electricity exported to the grid.</dd></div><div><dt>Conditional discount</dt><dd>A discount that only applies if its conditions are met; it is excluded unless explicitly assumed.</dd></div><div><dt>Calculation audit</dt><dd>The quantities, tariff rates, evidence versions and reconciliation behind an individual result.</dd></div></dl>
    </details>

    {plans.length > 0 && <section className="results" aria-live="polite">
      <div className="rsummary"><div className="stat"><div className="v">{visible.length}</div><div className="l">strictly priceable native results</div></div><div className="stat"><div className="v">{best ? fmtMoney(best.annualCost) : "n/a"}</div><div className="l">best estimated annual cost</div></div><div className="stat"><div className="v">{median ? fmtMoney(median.annualCost) : "n/a"}</div><div className="l">median visible offer</div></div></div>
      {pricingContext && setupMode !== "battery" && <div className="native-scenarios">
        <h2>{setupMode === "none" ? "Native solar and battery scenarios" : "Native battery scenario"}</h2>
        <p>{setupMode === "none" ? "Solar is generated half hourly against this household's load pattern. The battery then charges only from remaining solar exports and discharges against later grid imports." : "The battery charges from this household's solar export pattern and discharges against its grid-import pattern. Existing meter imports are not double-shifted."}</p>
        <p className="native-scenario-instruction"><b>Replace the prefilled cost with a written installed quote.</b> Enter the final amount after every certificate discount and rebate shown by the installer.</p>
        <div className="grid c3">
          {setupMode === "none" && <Field label="Scenario solar size" hint="Panel capacity in kW."><input type="number" min="0.1" step="0.1" value={scenarioSolarKw} onChange={(event) => updateScenarioSolarSize(event.target.value)} /></Field>}
          <Field label="Scenario usable battery size" hint="Usable storage in kWh, not the larger nominal capacity."><input type="number" min="0.1" step="0.5" value={scenarioBatteryKwh} onChange={(event) => updateScenarioBatterySize(event.target.value)} /></Field>
          {setupMode === "none" ? <Field label="Solar installed quote after discounts" hint="Include panels, inverter, labour, connection work, GST and solar STCs."><input type="number" min="0" step="100" value={scenarioSolarCost} onChange={(event) => setScenarioSolarCost(event.target.value)} /></Field> : <Field label="Battery installed quote after discounts" hint="Include battery, inverter or integration work, labour, GST and the confirmed federal discount."><input type="number" min="0" step="100" value={scenarioBatteryCost} onChange={(event) => setScenarioBatteryCost(event.target.value)} /></Field>}
          {setupMode === "none" && <Field label="Solar + battery installed quote after discounts" hint="Use the combined written quote, which may differ from adding two standalone prices."><input type="number" min="0" step="100" value={scenarioComboCost} onChange={(event) => setScenarioComboCost(event.target.value)} /></Field>}
        </div>
        <details className="native-scenario-assumptions">
          <summary>Review energy and default cost assumptions</summary>
          <div className="grid c3">
            {setupMode === "none" && <Field label="Annual solar yield" hint="kWh generated per kW of panels each year. The default is a broad state estimate."><input type="number" min="500" max="2500" step="10" value={scenarioSolarYield} onChange={(event) => setScenarioSolarYield(event.target.value)} /></Field>}
            <Field label="Battery round-trip efficiency" hint="Percent of charging energy available after storage losses."><input type="number" min="50" max="100" step="1" value={scenarioBatteryEfficiency} onChange={(event) => setScenarioBatteryEfficiency(event.target.value)} /></Field>
          </div>
          <p>Cost model {SCENARIO_COST_ASSUMPTIONS.version} prefills solar at {fmtMoney(SCENARIO_COST_ASSUMPTIONS.solarNetInstalledPerKw)} per kW after solar STCs. Battery cost starts at {fmtMoney(SCENARIO_COST_ASSUMPTIONS.batteryGrossInstalledPerUsableKwh)} per usable kWh before an estimated federal discount. The discount uses the current {SCENARIO_COST_ASSUMPTIONS.batteryStcFactor} STCs per eligible kWh factor, the capacity taper on the first {SCENARIO_COST_ASSUMPTIONS.batterySupportedUsableKwh} usable kWh and the government&apos;s {fmtMoneyExact(SCENARIO_COST_ASSUMPTIONS.assumedStcValue)} clearing-house value. The program also requires an eligible 5 to 100 kWh nominal system. Installer charges and site eligibility vary, so these defaults are not quotes.</p>
        </details>
        <div className="native-scenario-grid">{upgradeScenarios.map((scenario) => <article className="native-scenario" key={scenario.label}>
          <span className="badge info">{scenario.label}</span><h3>{fmtMoney(scenario.best.annualCost)}/yr</h3>
          <p>Cheapest current bill {fmtMoney(scenario.best.annualCost + scenario.annualSaving)} to {fmtMoney(scenario.best.annualCost)} after {scenario.description}.</p>
          <div><b>{fmtMoney(scenario.annualSaving)}/yr</b><span> estimated bill saving</span></div>
          <div><b>{scenario.annualSaving > 0 ? payback(scenario.installedCost / scenario.annualSaving) : "No simple payback"}</b><span> using first-year bill saving</span></div>
          <div><b>{fmtMoney(scenario.installedCost)}</b><span> installed cost input after discounts</span></div>
          <div><b>{Math.round(scenario.annualImportKwh).toLocaleString()} kWh</b><span> annual grid import</span></div>
          <div><b>{Math.round(scenario.annualExportKwh).toLocaleString()} kWh</b><span> annual solar export</span></div>
          {scenario.annualDischargeKwh != null && <div><b>{Math.round(scenario.annualDischargeKwh).toLocaleString()} kWh</b><span> annual battery discharge</span></div>}
          <div><b>{scenario.best.name}</b><span> best scenario plan, {scenario.best.brand}</span></div>
          <button type="button" className="audit-button" onClick={(event) => { auditReturnRef.current = event.currentTarget; setAuditPlan(scenario.best); }}>Open scenario calculation audit</button>
          <button type="button" className="btn native-enquiry-button" onClick={() => setEnquiryScenario(scenario)}>Enquire about this option</button>
          <a className="native-direct-trade-link" href={createDirectTradeHandoffUrl({ source: scenario.label === "Solar only" ? "electricity-solar" : "electricity-battery", services: scenario.label === "Solar only" ? ["assessment", "solar"] : scenario.label === "Solar + battery" ? ["assessment", "solar", "battery"] : ["assessment", "battery"], priorities: ["lower-running-costs", "solar-storage"], postcode })}>Build a Direct Trade project brief</a>
        </article>)}</div>
        <div className="native-scenario-caveat"><b>Indicative scenario, not an installation recommendation.</b> The simple payback holds first-year usage, tariffs and savings constant. It excludes finance costs, maintenance, insurance, component replacement, degradation, warranty limits, VPP income or control, backup reserve and future tariff changes. The energy model does not inspect roof area, orientation, tilt, shading, inverter limits, network export limits, curtailment, switchboard work, battery location or product compatibility. Confirm annual generation, usable and nominal battery capacity, federal and state incentive eligibility, connection approval and the complete installed price through a site assessment and written quotes. For an independent roof-specific cross-check, use the <a href="https://www.sunspot.org.au/" target="_blank" rel="noreferrer">government-supported SunSPOT calculator</a> and the <a href="https://www.energy.gov.au/solar/solar-retailers-and-installation/choose-your-solar-retailer-and-installer" target="_blank" rel="noreferrer">Australian Government quote checklist</a>.</div>
      </div>}
      <div className="filters"><label className="toggle"><input type="checkbox" checked={showTou} onChange={(event) => setShowTou(event.target.checked)} /> Time of use</label><label className="toggle"><input type="checkbox" checked={showSingle} onChange={(event) => setShowSingle(event.target.checked)} /> Single rate</label><label className="toggle"><input type="checkbox" checked={showDemand} onChange={(event) => setShowDemand(event.target.checked)} /> Demand</label><label className="toggle"><input type="checkbox" checked={showStanding} onChange={(event) => setShowStanding(event.target.checked)} /> Standing offers</label><input aria-label="Filter native electricity plans" placeholder="Filter retailer or plan" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      {visible.some((plan) => plan.eligibilityConfirmations.length > 0) && <div className="note"><b>Check eligibility before switching.</b> {visible.filter((plan) => plan.eligibilityConfirmations.length > 0).length} displayed offers have published retailer conditions that this calculator cannot confirm from your inputs. They remain priced, but each is labelled and the condition is shown in its calculation audit.</div>}
      {visible.slice(0, shown).map((plan, index) => <NativePlanCard key={`${plan.planId}-${Math.round(plan.annualCost)}`} plan={plan} rank={index + 1} onAudit={(button) => { auditReturnRef.current = button; setAuditPlan(plan); }} />)}
      {!visible.length && <p className="note">No plans match the selected filters.</p>}
      {visible.length > shown && <button className="btn ghost showmore" type="button" onClick={() => setShown((value) => value + 12)}>Show more plans</button>}
      <p className="offer-count">Showing {Math.min(shown, visible.length)} of {visible.length} priceable offers</p>
      <div className="note"><b>Native calculation scope.</b> Engine {NATIVE_ENGINE_VERSION}. General and controlled-load usage, supply charges, single rates, time-of-use windows, feed-in credits, published blocks, GST and supported discounts are calculated. Solar, battery, EV and controlled-load eligibility is applied to both current and upgrade scenarios. {demandReady ? "Supported demand plans use peaks measured in the uploaded general-usage register." : "Demand plans are excluded until the uploaded data passes the full-year quality threshold."} {Object.values(excluded).reduce((sum, count) => sum + count, 0)} candidate plans were excluded by these rules.</div>
      {bundle && <div className="note"><b>Tariff evidence.</b> Retrieved current CDR records {bundle.fetchedAt ? new Date(bundle.fetchedAt).toLocaleString() : "this session"}. {bundle.source?.detailPlansSucceeded || bundle.plans.length} of {bundle.source?.candidatePlans || bundle.plans.length} locally relevant plan details passed strict validation from {bundle.source?.listSourcesSucceeded ?? "the available"} of {bundle.source?.retailersDiscovered ?? "the discovered"} sources. {bundle.source?.oldestPlanUpdatedAt && bundle.source?.newestPlanUpdatedAt ? `The included retailer records were last updated between ${new Date(bundle.source.oldestPlanUpdatedAt).toLocaleDateString()} and ${new Date(bundle.source.newestPlanUpdatedAt).toLocaleDateString()}. ` : ""}{bundle.source?.plansMissingLastUpdated ? `${bundle.source.plansMissingLastUpdated} included records did not publish a usable update time. ` : ""}{bundle.source?.partial ? "Some sources or plan details were unavailable or rejected, so this is not a complete-market result. " : ""}Source evidence {bundle.sourceHash || "unavailable"}. Schema {bundle.tariffSchemaVersion || "unavailable"}.</div>}
      {bundle?.source?.retailerCoverage && <details className="note"><summary>Retailer source coverage</summary><ul>{bundle.source.retailerCoverage.filter((coverage) => !coverage.listAvailable || coverage.candidatePlans > 0).map((coverage) => <li key={coverage.retailer}><b>{coverage.retailer}:</b> {coverage.listAvailable ? `${coverage.detailsPassed} of ${coverage.candidatePlans} local plan details passed` : "plan list unavailable"}{coverage.detailsRejected ? `; ${coverage.detailsRejected} rejected by tariff validation` : ""}{coverage.detailsUnavailable ? `; ${coverage.detailsUnavailable} unavailable` : ""}</li>)}</ul></details>}
      <div className="native-followup-grid">
        <section className="native-followup-card"><h2>Save this comparison privately</h2><p>The link contains only comparison assumptions. It never contains an NMI, meter intervals, filename, annual-adjustment reason or contact details.</p><button type="button" className="btn ghost" onClick={() => void copyPrivateLink()}>Copy private-safe link</button>{shareStatus && <p className="native-action-status" role="status">{shareStatus}</p>}{sharedUrl && <Field label="Private-safe link"><input readOnly value={sharedUrl} onFocus={(event) => event.currentTarget.select()} /></Field>}</section>
        <form className="native-followup-card" onSubmit={sendTopPlans}><h2>Email my top three</h2><p>Receive the three cheapest currently visible plans and a reminder to compare again every six months.</p><div className="grid c3"><Field label="Name"><input required autoComplete="name" value={leadName} onChange={(event) => setLeadName(event.target.value)} /></Field><Field label="Email"><input required type="email" autoComplete="email" value={leadEmail} onChange={(event) => setLeadEmail(event.target.value)} /></Field><Field label="Phone (optional)"><input autoComplete="tel" value={leadPhone} onChange={(event) => setLeadPhone(event.target.value)} /></Field></div><label className="native-honeypot" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={leadWebsite} onChange={(event) => setLeadWebsite(event.target.value)} /></label><label className="toggle native-consent"><input type="checkbox" checked={leadConsent} onChange={(event) => setLeadConsent(event.target.checked)} /> I agree that Australian Energy Assessments may email these results and a comparison reminder every 6 months. I can unsubscribe at any time.</label><label className="toggle"><input type="checkbox" checked={leadUpgrades} onChange={(event) => setLeadUpgrades(event.target.checked)} /> I would also like information about independent solar or battery assessments.</label><button className="btn" disabled={leadSending}>{leadSending ? "Sending..." : "Send my top three"}</button>{leadStatus && <p className="native-action-status" role="status">{leadStatus}</p>}<details className="native-privacy-details"><summary>How my details are used</summary><p>Your details are sent only when you submit this form. Meter files, NMI values and interval data stay in your browser and are not included. Upgrade follow-up occurs only if you select it.</p></details></form>
      </div>
    </section>}
    {auditPlan && <NativeAuditDialog plan={auditPlan} bundle={bundle} onClose={closeAudit} />}
    {enquiryScenario && <NativeUpgradeDialog scenario={enquiryScenario} onSubmit={sendUpgradeEnquiry} onClose={() => setEnquiryScenario(null)} />}
  </>;
}

function NativeUpgradeDialog({ scenario, onSubmit, onClose }: { scenario: ScenarioResult; onSubmit: (contact: ContactDetails) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    nameRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute("disabled"));
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() && !phone.trim()) { setStatus("Enter an email address or phone number so we can respond."); return; }
    if (!consent) { setStatus("Please confirm that we may use your details to respond to this enquiry."); return; }
    setSending(true); setStatus("Sending...");
    try {
      await onSubmit({ name, email, phone, website });
      setStatus("Thanks. Your independent upgrade assessment enquiry has been received.");
    } catch (caught) { setStatus(caught instanceof Error ? caught.message : "Could not send right now."); }
    finally { setSending(false); }
  }

  return <div className="audit-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={handleKeyDown}>
    <div className="audit-dialog native-enquiry-dialog" role="dialog" aria-modal="true" aria-labelledby="native-enquiry-title" ref={dialogRef}>
      <div className="audit-heading"><div><h2 id="native-enquiry-title">Enquire about {scenario.label.toLowerCase()}</h2><p>{scenario.description} | estimated {fmtMoney(scenario.annualSaving)}/year bill saving | {fmtMoney(scenario.installedCost)} scenario cost</p></div></div>
      <p>This sends only the scenario summary, your non-sensitive comparison assumptions and the contact details below. Your NMI, meter file and interval data remain in this browser.</p>
      <form onSubmit={submit}><div className="grid c3"><Field label="Name"><input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} ref={nameRef} /></Field><Field label="Email"><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field><Field label="Phone"><input autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></Field></div><label className="native-honeypot" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label><label className="toggle native-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> I agree that Australian Energy Assessments may use my details to respond to this upgrade enquiry.</label><div className="native-dialog-actions"><button className="btn" disabled={sending}>{sending ? "Sending..." : "Send enquiry"}</button><button type="button" className="btn ghost" onClick={onClose}>Cancel</button></div>{status && <p className="native-action-status" role="status">{status}</p>}</form>
    </div>
  </div>;
}

function NativePlanCard({ plan, rank, onAudit }: { plan: NativePlanResult; rank: number; onAudit: (button: HTMLButtonElement) => void }) {
  const retailerLink = plan.link || plan.retailerUrl;
  return <article className="plan">
    <div><div className="top"><span className={`rank${rank === 1 ? " r1" : ""}`}>#{rank}</span>{plan.logo && <span className="logo-box"><img className="logo" src={plan.logo} alt={`${plan.brand} logo`} loading="lazy" decoding="async" /></span>}<div><h3>{plan.name}</h3><div className="retailer">{plan.brand}</div></div></div>
      <div className="rateline"><span className="r"><b>{fmtCents(plan.supplyCentsPerDay)}c</b>/day <span>supply</span></span>{[...plan.rates, ...plan.controlledRates].slice(0, 6).map((rate, index) => <span className="r" key={`${rate.label}-${index}`}><b>{fmtCents(rate.centsPerKwh)}c</b>/kWh <span>{rate.label}</span></span>)}<span className="r"><span>prices inc GST</span></span></div>
      <div className="badges"><span className="badge">{plan.tariffKind === "tou" ? "Time of use" : plan.tariffKind === "demand" ? "Demand tariff" : "Single rate"}</span>{plan.demand > 0 && <span className="badge info">Measured peak {plan.demandPeakKw.toFixed(1)} kW</span>}{plan.feedIn > 0 && <span className="badge info">Feed-in credit {fmtCents(plan.feedInCentsPerKwh)}c/kWh effective</span>}{plan.controlled > 0 && <span className="badge info">Controlled load costed separately</span>}{plan.fees ? <span className="badge warn">Published fees not included</span> : null}{plan.validation?.limitations?.some((item) => item !== "fees_not_costed") && <span className="badge warn">Some published benefits not included</span>}{plan.eligibilityConfirmations.length > 0 && <span className="badge warn">Retailer eligibility must be confirmed</span>}</div>
    </div>
    <div className="price"><div className="annual">{fmtMoney(plan.annualCost)}<span style={{ fontSize: ".8rem", fontWeight: 400 }}>/yr</span></div><div className="permo">about {fmtMoney(plan.annualCost / 12)} per month</div><div className="plan-actions">{retailerLink ? <a href={retailerLink} target="_blank" rel="noreferrer">{plan.link ? "View retailer plan" : "Go to retailer"}</a> : <span className="source-missing">Retailer link not published</span>}<button type="button" className="audit-button" onClick={(event) => onAudit(event.currentTarget)}>Open calculation audit</button></div><div className="offerid">Offer ID: {plan.planId.split("@")[0]} | Evidence: {plan.tariffHash?.replace("sha256:", "").slice(0, 12) || "unavailable"}{plan.lastUpdated ? ` | Retailer record updated ${new Date(plan.lastUpdated).toLocaleDateString()}` : " | Update time not published"}</div></div>
    <div className="native-breakdown">Supply {fmtMoneyExact(plan.supply)} + general usage {fmtMoneyExact(plan.usage)}{plan.controlled > 0 ? ` + controlled load ${fmtMoneyExact(plan.controlled)}` : ""}{plan.demand > 0 ? ` + measured demand ${fmtMoneyExact(plan.demand)}` : ""}{plan.feedIn > 0 ? ` - feed-in credits ${fmtMoneyExact(plan.feedIn)}` : ""}{plan.discounts > 0 ? ` - discounts ${fmtMoneyExact(plan.discounts)}` : ""} = {fmtMoneyExact(plan.annualCost)} inc GST{plan.touMix ? ` | Usage mix: ${Object.entries(plan.touMix).map(([label, share]) => `${label} ${Math.round(share * 100)}%`).join(", ")}` : ""}</div>
  </article>;
}

function NativeAuditTable({ lines, credit = false }: { lines: NativeAuditChargeLine[]; credit?: boolean }) {
  return <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>Charge line</th><th>Quantity</th><th>Allocation</th><th>Published rate</th><th>Annual amount</th></tr></thead><tbody>{lines.map((line, index) => <tr key={`${line.label}-${index}`}><td>{line.label}</td><td>{line.quantity}</td><td>{line.allocation || "n/a"}</td><td>{line.rate}</td><td>{credit ? "-" : ""}{fmtMoneyExact(line.amount)}</td></tr>)}</tbody></table></div>;
}

function NativeAuditSection({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return <section className="audit-section"><h3>{title}</h3>{note && <p>{note}</p>}{children}</section>;
}

function NativeAuditDialog({ plan, bundle, onClose }: { plan: NativePlanResult; bundle: PlanBundle | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const audit = plan.audit;
  const reconciliation = audit.reconciliation;
  const reconciled = Math.abs(reconciliation.difference) < 0.005;
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute("disabled"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  const componentRows = [
    ["Daily supply charges", reconciliation.supply], ["General usage charges", reconciliation.usage],
    ["Controlled-load charges", reconciliation.controlled], ["Demand charges", reconciliation.demand],
    ["Feed-in credits", reconciliation.feedIn], ["Discounts", reconciliation.discounts],
    ["Recalculated annual total", reconciliation.componentTotal],
  ] as const;

  return <div className="audit-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={handleKeyDown}>
    <div className="audit-dialog" role="dialog" aria-modal="true" aria-labelledby="native-audit-title" ref={dialogRef}>
      <div className="audit-heading"><div><h2 id="native-audit-title">Calculation audit: {plan.name}</h2><p>{plan.brand} | Offer {plan.planId.split("@")[0]}</p></div><strong>{fmtMoneyExact(plan.annualCost)}/year</strong></div>
      <div className="audit-summary-grid">
        <div><b>Usage priced</b>{Math.round(audit.inputs.annualGeneralKwh).toLocaleString()} kWh general{audit.inputs.annualControlledKwh > 0 ? ` + ${Math.round(audit.inputs.annualControlledKwh).toLocaleString()} kWh controlled load` : ""}{audit.inputs.annualExportKwh > 0 ? `; ${Math.round(audit.inputs.annualExportKwh).toLocaleString()} kWh export` : ""}</div>
        <div><b>Usage evidence</b>{audit.evidenceLabel}</div>
      </div>
      {audit.registers.length > 0 && <NativeAuditSection title="Meter register allocation" note="Registers remain separate for general usage and controlled-load pricing."><div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>Register</th><th>Assigned role</th><th>Annual kWh</th><th>Interval</th></tr></thead><tbody>{audit.registers.map((register) => <tr key={register.id}><td>{register.id}</td><td>{register.role === "general" ? "General usage" : "Controlled load"}</td><td>{Math.round(register.annualKwh).toLocaleString()} kWh</td><td>{register.intervalMinutes} minutes</td></tr>)}</tbody></table></div></NativeAuditSection>}
      <NativeAuditSection title="Supply charges" note="Published prices are shown including GST."><NativeAuditTable lines={audit.supply} /></NativeAuditSection>
      <NativeAuditSection title="General usage charges" note="TOU allocations come from the evidence named above and are priced against each published window."><NativeAuditTable lines={audit.usage} /></NativeAuditSection>
      {audit.controlled.length > 0 && <NativeAuditSection title="Controlled-load charges" note="Controlled load is priced separately and is not offset by solar or battery scenarios."><NativeAuditTable lines={audit.controlled} /></NativeAuditSection>}
      {audit.demand.length > 0 && <NativeAuditSection title="Demand charges" note="Measured half-hour general-register energy is converted to kW and the published measurement and charge periods are applied."><NativeAuditTable lines={audit.demand} /></NativeAuditSection>}
      {audit.feedIn.length > 0 && <NativeAuditSection title="Solar feed-in credit" note="Time-varying feed-in rates are weighted against the export timing profile."><NativeAuditTable lines={audit.feedIn} credit /></NativeAuditSection>}
      {audit.discounts.length > 0 && <NativeAuditSection title="Published discounts" note="Conditional discounts apply only when the comparison toggle says they are assumed to be met."><div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>Discount</th><th>Method</th><th>Condition</th><th>Treatment</th><th>Annual value</th></tr></thead><tbody>{audit.discounts.map((discount, index) => <tr key={`${discount.label}-${index}`}><td>{discount.label}</td><td>{discount.method}</td><td>{discount.conditional ? "Conditional" : "Unconditional"}</td><td>{discount.applied ? "Included" : "Not assumed"}</td><td>{discount.applied ? `-${fmtMoneyExact(discount.amount)}` : "$0.00"}</td></tr>)}</tbody></table></div></NativeAuditSection>}
      <NativeAuditSection title="Annual total reconciliation" note="Credits and discounts appear as negative amounts."><div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>Component</th><th>Amount</th></tr></thead><tbody>{componentRows.map(([label, amount]) => <tr key={label}><td>{label}</td><td>{fmtSignedMoney(amount)}</td></tr>)}</tbody></table></div><p className={reconciled ? "audit-reconciled" : "audit-failed"}>{reconciled ? "Reconciled exactly to the ranked plan total." : `Reconciliation difference: ${fmtSignedMoney(reconciliation.difference)}. This result must not be relied on until corrected.`}</p></NativeAuditSection>
      <NativeAuditSection title="Plan dates and eligibility" note="Confirm the plan is still available and that you meet its published conditions before switching."><div className="audit-summary-grid"><div><b>Record retrieved</b>{bundle?.fetchedAt ? new Date(bundle.fetchedAt).toLocaleString() : "This session"}</div><div><b>Retailer record updated</b>{plan.lastUpdated ? new Date(plan.lastUpdated).toLocaleString() : "Not published"}</div><div><b>Effective period</b>{plan.effectiveFrom ? new Date(plan.effectiveFrom).toLocaleDateString() : "Start not published"} to {plan.effectiveTo ? new Date(plan.effectiveTo).toLocaleDateString() : "No end published"}</div><div><b>Published eligibility</b>{audit.eligibility.length ? audit.eligibility.join("; ") : "No published eligibility text"}</div><div><b>Must confirm with retailer</b>{plan.eligibilityConfirmations.length ? plan.eligibilityConfirmations.join("; ") : "No unresolved published conditions"}</div>{audit.contractTerms.length > 0 && <div className="audit-contract-terms"><b>Published contract terms</b>{audit.contractTerms.join(" ")}</div>}</div></NativeAuditSection>
      <button type="button" className="btn audit-close" onClick={onClose} ref={closeRef}>Close audit</button>
    </div>
  </div>;
}
