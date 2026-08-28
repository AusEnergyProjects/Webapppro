import {
  ENERGY_ASSISTANT_KNOWLEDGE,
  type EnergyAssistantKnowledgeSource,
} from "./energy-assistant-knowledge.ts";
import { ENERGY_ASSISTANT_OFFICIAL_SOURCE_APPROVALS } from "./energy-assistant-official-source-approvals.ts";
import type { CreditexOfficialProductKind } from "../lib/creditex-official-product-registry.ts";
import { sourceMayAnswerCurrentFact } from "../lib/energy-assistant-source-review.ts";

export const REVIEWED_PRODUCT_GUIDANCE_CATEGORY_IDS = [
  "hot_water",
  "heating_cooling",
  "solar_storage",
  "insulation_glazing_draughts",
  "ev_charging",
  "cooking_appliances",
] as const;

export type ReviewedProductGuidanceCategoryId =
  (typeof REVIEWED_PRODUCT_GUIDANCE_CATEGORY_IDS)[number];

export type ReviewedProductComparisonDimension = {
  id: string;
  consumerLabel: string;
  attributeKeys: readonly string[];
  unit: string | null;
};

export type ReviewedPracticalTip = {
  id: string;
  guidance: string;
  sourceIds: readonly string[];
  safetyBoundary: string | null;
};

export type ReviewedCertificatePathwayId =
  | "sres_stc"
  | "veu_veec"
  | "nsw_ess_esc"
  | "nsw_pdrs_prc"
  | "state_rebate_discovery";

export type ReviewedCertificatePathway = {
  id: ReviewedCertificatePathwayId;
  code: "STC" | "VEEC" | "ESC" | "PRC" | "REBATE";
  consumerLabel: string;
  jurisdictions: readonly string[];
  categoryIds: readonly ReviewedProductGuidanceCategoryId[];
  sourceIds: readonly string[];
  exactInputs: readonly string[];
  consumerBoundary: string;
  calculationMode: "governed_exact_inputs_only";
};

export type ReviewedProductGuidanceCategory = {
  id: ReviewedProductGuidanceCategoryId;
  consumerLabel: string;
  reviewStatus: "approved";
  reviewedOn: string;
  reviewedBy: string;
  reviewDue: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  intentTerms: readonly string[];
  productKinds: readonly CreditexOfficialProductKind[];
  comparisonDimensions: readonly ReviewedProductComparisonDimension[];
  contextQuestions: readonly string[];
  tips: readonly ReviewedPracticalTip[];
  sourceIds: readonly string[];
};

const APPROVED_GUIDANCE_METADATA = {
  reviewStatus: "approved",
  reviewedOn: "2026-08-24",
  reviewedBy: "AEA product guidance review",
  effectiveFrom: "2026-08-24",
  effectiveTo: null,
} as const;

const CERTIFICATE_PATHWAYS: readonly ReviewedCertificatePathway[] = [
  {
    id: "sres_stc",
    code: "STC",
    consumerLabel: "Small-scale Renewable Energy Scheme certificates",
    jurisdictions: ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"],
    categoryIds: ["hot_water", "solar_storage"],
    sourceIds: ["cer-small-scale-renewable-energy-scheme", "cer-small-scale-system-requirements"],
    exactInputs: [
      "exact approved product or complete eligible system",
      "installation postcode",
      "installation date",
      "system capacity and quantity",
      "current scheme rules and installation evidence",
    ],
    consumerBoundary: "An approved component or brand does not establish STC eligibility or quantity. Use the governed calculator with the exact product or complete system and installation inputs.",
    calculationMode: "governed_exact_inputs_only",
  },
  {
    id: "veu_veec",
    code: "VEEC",
    consumerLabel: "Victorian Energy Upgrades certificates",
    jurisdictions: ["VIC"],
    categoryIds: ["hot_water", "heating_cooling"],
    sourceIds: ["veu-water-space-activity-guide-v3-19"],
    exactInputs: [
      "current eligible activity",
      "exact approved product",
      "existing equipment and baseline",
      "site and installation date",
      "installer and evidence requirements",
    ],
    consumerBoundary: "A product name or category does not establish VEEC eligibility or quantity. Confirm the current activity, exact product, baseline, site, installer and evidence before stating a discount.",
    calculationMode: "governed_exact_inputs_only",
  },
  {
    id: "nsw_ess_esc",
    code: "ESC",
    consumerLabel: "NSW Energy Savings Scheme certificates",
    jurisdictions: ["NSW"],
    categoryIds: ["hot_water"],
    sourceIds: ["nsw-ess-rule-current-2026", "nsw-iheab-hpwh-fact-sheet-v2-2"],
    exactInputs: [
      "current eligible activity",
      "exact approved product",
      "site and baseline equipment",
      "installation date",
      "installer, nomination, payment and evidence requirements",
    ],
    consumerBoundary: "A category match does not establish ESC eligibility, quantity or customer discount. Confirm the current rule, activity, exact product, site, baseline and evidence in the governed calculator.",
    calculationMode: "governed_exact_inputs_only",
  },
  {
    id: "nsw_pdrs_prc",
    code: "PRC",
    consumerLabel: "NSW Peak Demand Reduction Scheme certificates",
    jurisdictions: ["NSW"],
    categoryIds: ["solar_storage"],
    sourceIds: ["nsw-pdrs-rule-current-2026"],
    exactInputs: [
      "current dated eligible activity",
      "exact approved product",
      "site and baseline equipment",
      "capacity and operating conditions",
      "installation and evidence requirements",
    ],
    consumerBoundary: "A product category does not establish PRC eligibility or quantity. Confirm that a current dated activity covers the exact product and site before using the governed calculator.",
    calculationMode: "governed_exact_inputs_only",
  },
  {
    id: "state_rebate_discovery",
    code: "REBATE",
    consumerLabel: "Government rebate and assistance discovery",
    jurisdictions: ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"],
    categoryIds: [...REVIEWED_PRODUCT_GUIDANCE_CATEGORY_IDS],
    sourceIds: ["energy-gov-rebates"],
    exactInputs: [
      "property postcode",
      "applicant and property type",
      "existing and proposed equipment",
      "exact product and installer",
      "order and installation dates",
    ],
    consumerBoundary: "Program discovery is not an eligibility decision. Check the live official rules before ordering and do not state a rebate amount from category or postcode alone.",
    calculationMode: "governed_exact_inputs_only",
  },
];

export const ENERGY_ASSISTANT_REVIEWED_PRODUCT_GUIDANCE = [
  {
    id: "hot_water",
    consumerLabel: "Hot water",
    ...APPROVED_GUIDANCE_METADATA,
    reviewDue: "2026-09-20",
    intentTerms: ["hot water", "water heater", "heat pump water heater", "heat pump hot water", "solar hot water", "storage water heater"],
    productKinds: ["sres_air_source_heat_pump", "sres_solar_water_heater", "electric_water_heater", "gas_water_heater"],
    comparisonDimensions: [
      { id: "usable_capacity", consumerLabel: "usable hot-water capacity", attributeKeys: ["usableHotWaterCapacityLitres", "tankCapacityLitres", "ratedCapacityLitres"], unit: "L" },
      { id: "recovery", consumerLabel: "recovery rate", attributeKeys: ["recoveryRateLitresPerHour", "recoveryRateLph", "recoveryTimeMinutes"], unit: null },
      { id: "noise", consumerLabel: "verified sound level", attributeKeys: ["soundPowerDb", "noiseDb", "soundPressureDb"], unit: "dB" },
      { id: "efficiency", consumerLabel: "verified efficiency", attributeKeys: ["coefficientOfPerformance", "cop", "annualEnergyUseKwh"], unit: null },
      { id: "climate", consumerLabel: "cold-weather operating range", attributeKeys: ["minimumAmbientTemperatureC", "minAmbientTemperatureC"], unit: "C" },
      { id: "warranty", consumerLabel: "product warranty", attributeKeys: ["warrantyYears", "tankWarrantyYears", "compressorWarrantyYears"], unit: "years" },
    ],
    contextQuestions: [
      "What is the exact model number on each quote?",
      "How many people use hot water and when do showers cluster?",
      "What system is being replaced and how is it fuelled?",
      "Where will the unit sit, including airflow, drainage and nearby bedrooms or neighbours?",
      "What does each complete installed quote include?",
    ],
    tips: [
      {
        id: "hot-water-operating-window",
        guidance: "If rooftop solar is available, ask whether the controller can heat mainly during the solar window while still meeting the household's hot-water needs. Without solar, compare controlled-load or time-of-use operation using the actual tariff.",
        sourceIds: ["energy-gov-electrification"],
        safetyBoundary: "A licensed electrician must confirm the circuit, controls and tariff connection.",
      },
      {
        id: "hot-water-whole-quote",
        guidance: "Compare complete installed scope, including removal of the old unit, electrical work, switchboard work, tempering, valves, condensate drainage, commissioning, certificate paperwork, warranty and local service support.",
        sourceIds: ["energy-gov-electrification", "energy-gov-rebates"],
        safetyBoundary: "Plumbing, electrical, refrigerant and gas work must use appropriately licensed people.",
      },
    ],
    sourceIds: ["energy-gov-electrification", "energy-gov-rebates", "cer-small-scale-system-requirements"],
  },
  {
    id: "heating_cooling",
    consumerLabel: "Heating and cooling",
    ...APPROVED_GUIDANCE_METADATA,
    reviewDue: "2026-11-20",
    intentTerms: ["heating", "cooling", "air conditioner", "reverse cycle", "rcac", "split system", "ducted air", "portable heater", "evaporative cooling"],
    productKinds: ["air_conditioner", "close_control_air_conditioner"],
    comparisonDimensions: [
      { id: "heating_capacity", consumerLabel: "rated and retained heating capacity", attributeKeys: ["ratedHeatingCapacityKw", "retainedHeatingCapacityKw"], unit: "kW" },
      { id: "cooling_capacity", consumerLabel: "rated cooling capacity", attributeKeys: ["ratedCoolingCapacityKw"], unit: "kW" },
      { id: "seasonal_efficiency", consumerLabel: "climate-zone seasonal performance", attributeKeys: ["heatingStarRating", "coolingStarRating", "annualEnergyUseKwh"], unit: null },
      { id: "noise", consumerLabel: "indoor and outdoor sound levels", attributeKeys: ["indoorSoundPowerDb", "outdoorSoundPowerDb", "soundPowerDb", "noiseDb"], unit: "dB" },
      { id: "operating_range", consumerLabel: "verified operating temperature range", attributeKeys: ["minimumOperatingTemperatureC", "maximumOperatingTemperatureC"], unit: "C" },
      { id: "warranty", consumerLabel: "product warranty and local service", attributeKeys: ["warrantyYears"], unit: "years" },
    ],
    contextQuestions: [
      "Which rooms need heating or cooling, and what are their size, insulation, glazing and sun exposure?",
      "What local design temperatures must the unit handle?",
      "Where can indoor and outdoor units go without creating a noise or airflow problem?",
      "What existing heater or cooler is being replaced?",
    ],
    tips: [
      {
        id: "rcac-before-portable-resistance",
        guidance: "Use a suitable fixed reverse-cycle air conditioner as the normal first choice for room heating. It usually uses much less electricity than a plug-in electric heater and often costs less to run than gas. Keep plug-in heaters for short, local use rather than treating them as efficient whole-room heating.",
        sourceIds: ["energy-rating-heating-cooling"],
        safetyBoundary: "Keep required ventilation working and have fixed electrical or refrigerant work completed by licensed people.",
      },
      {
        id: "clean-hvac-filters",
        guidance: "Clean accessible return-air and indoor-unit filters as the manufacturer directs. A blocked filter can restrict airflow and reduce useful heating or cooling.",
        sourceIds: ["energy-rating-heating-cooling"],
        safetyBoundary: "Isolate equipment before maintenance and do not open electrical or refrigerant compartments.",
      },
      {
        id: "seasonal-evaporative-outlets",
        guidance: "For out-of-use evaporative outlets, use only a safe removable purpose-made cover when the system is seasonally isolated and the outlet is not required for ventilation. Do not seal a flue, combustion-air path or required ventilation opening.",
        sourceIds: ["yourhome-ventilation-airtightness"],
        safetyBoundary: "Ask a competent technician if the outlet's ventilation or system role is uncertain.",
      },
      {
        id: "ducted-zones",
        guidance: "Use designed zones where available. Do not close many ducted outlets unless the system manual or installer confirms the airflow remains safe and efficient.",
        sourceIds: ["energy-rating-heating-cooling"],
        safetyBoundary: "Restricted airflow can damage equipment or reduce performance.",
      },
      {
        id: "personal-heating",
        guidance: "For a seated person, a compliant electric blanket or heated throw can warm the person rather than the whole house. Follow the product instructions, inspect cords and controls, and do not use damaged items.",
        sourceIds: ["energy-gov-appliances-cooking"],
        safetyBoundary: "Do not use a heated product in a way the manufacturer prohibits.",
      },
    ],
    sourceIds: ["energy-rating-heating-cooling", "yourhome-ventilation-airtightness"],
  },
  {
    id: "solar_storage",
    consumerLabel: "Solar and storage",
    ...APPROVED_GUIDANCE_METADATA,
    reviewDue: "2026-09-20",
    intentTerms: ["solar", "photovoltaic", "pv panel", "inverter", "battery", "energy storage", "home battery", "solar export"],
    productKinds: ["pv_module", "inverter", "battery", "cec_battery"],
    comparisonDimensions: [
      { id: "solar_power", consumerLabel: "rated solar or inverter power", attributeKeys: ["ratedPowerKw", "nominalPowerKw", "ratedPowerW"], unit: null },
      { id: "usable_capacity", consumerLabel: "usable battery capacity", attributeKeys: ["usableCapacityKwh", "nominalCapacityKwh"], unit: "kWh" },
      { id: "battery_power", consumerLabel: "continuous and peak battery power", attributeKeys: ["maxContinuousPowerKw", "peakPowerKw"], unit: "kW" },
      { id: "efficiency", consumerLabel: "verified conversion or round-trip efficiency", attributeKeys: ["weightedEfficiencyPercent", "roundTripEfficiencyPercent"], unit: "%" },
      { id: "backup", consumerLabel: "documented backup capability", attributeKeys: ["backupCapable", "blackStartCapable"], unit: null },
      { id: "warranty", consumerLabel: "warranty and warranted throughput", attributeKeys: ["warrantyYears", "warrantedThroughputMwh", "cycleLife"], unit: null },
    ],
    contextQuestions: [
      "What are the household's interval load, daytime use, tariff and export limits?",
      "What roof area, orientation and shading are available?",
      "Which loads must operate during an outage, and for how long?",
      "What future hot water, heating, cooking or EV loads are planned?",
      "What exact models and complete installed quotes are being compared?",
    ],
    tips: [
      {
        id: "solar-load-shifting",
        guidance: "When rooftop solar is exporting, shift flexible loads such as hot water, a heat-pump clothes dryer, dishwasher and EV charging into the solar window where tariffs, controls and household needs allow.",
        sourceIds: ["energy-gov-solar-batteries", "energy-gov-batteries"],
        safetyBoundary: "Use appliance timers and charging controls only as their manufacturers allow.",
      },
      {
        id: "tariff-load-shifting",
        guidance: "Without surplus solar, move flexible loads to genuinely cheaper tariff periods, including a retailer's free-use window, only after checking the current plan rates, demand charges and controlled-load rules.",
        sourceIds: ["energy-gov-solar-batteries", "energy-gov-batteries"],
        safetyBoundary: "Do not assume a marketed free period makes every load or plan cheaper overall.",
      },
      {
        id: "battery-load-first",
        guidance: "Before buying a battery, use interval data to identify evening energy, short peaks, export and backup needs. Usable capacity, power, backup design, tariff, warranty, VPP terms and complete installed cost matter more than the brand name alone.",
        sourceIds: ["energy-gov-batteries"],
        safetyBoundary: "Battery siting, electrical work and commissioning must meet current installation and product requirements.",
      },
    ],
    sourceIds: ["energy-gov-solar-batteries", "energy-gov-batteries", "cer-small-scale-system-requirements"],
  },
  {
    id: "insulation_glazing_draughts",
    consumerLabel: "Insulation, glazing and draught control",
    ...APPROVED_GUIDANCE_METADATA,
    reviewDue: "2027-02-20",
    intentTerms: ["insulation", "glazing", "window film", "draught", "draft", "door seal", "window seal", "caulking", "door snake", "honeycomb blind", "secondary glazing", "renshade", "condensation", "humidity"],
    productKinds: [],
    comparisonDimensions: [
      { id: "insulation_r_value", consumerLabel: "installed R-value", attributeKeys: ["installedRValue", "totalRValue"], unit: null },
      { id: "window_u_value", consumerLabel: "whole-window U-value", attributeKeys: ["wholeWindowUValue", "uValue"], unit: null },
      { id: "window_shgc", consumerLabel: "whole-window solar heat gain coefficient", attributeKeys: ["wholeWindowShgc", "shgc"], unit: null },
      { id: "air_leakage", consumerLabel: "verified air-leakage performance", attributeKeys: ["airLeakageRate"], unit: null },
      { id: "fire_and_glass", consumerLabel: "fire, glass and surface compatibility", attributeKeys: ["fireRating", "compatibleGlassTypes"], unit: null },
      { id: "warranty", consumerLabel: "product and installation warranty", attributeKeys: ["warrantyYears"], unit: "years" },
    ],
    contextQuestions: [
      "Is the problem unwanted air leakage, conductive heat flow, direct sun, moisture or a combination?",
      "What insulation is present, and is it continuous, dry and safely clear of electrical hazards?",
      "What are the whole-window U-value, solar heat gain coefficient, frame, seals and shading?",
      "Is the home rented, strata managed or subject to heritage, fire or glazing-safety constraints?",
    ],
    tips: [
      {
        id: "seal-obvious-gaps",
        guidance: "Start with reversible low-cost draught measures such as a door snake, door seals and window seals. Use suitable caulking only where the joint and substrate allow it.",
        sourceIds: ["energy-gov-insulation-draught-proofing", "yourhome-ventilation-airtightness"],
        safetyBoundary: "Never block a flue, combustion-air opening, exhaust path or required ventilation.",
      },
      {
        id: "insulation-top-up",
        guidance: "Before an insulation top-up, inspect for moisture, gaps, compression, thermal bridges, unsafe downlight clearances and electrical hazards. Installed continuity matters as well as the labelled R-value.",
        sourceIds: ["yourhome-insulation", "energy-gov-insulation-draught-proofing"],
        safetyBoundary: "Electrical safety checks and regulated installation work must be completed by appropriately qualified people.",
      },
      {
        id: "window-film-evidence",
        guidance: "Treat low-e window film, reflective window film and secondary glazing film as different products. Check whole-window performance, glass compatibility, safety glazing, condensation risk, window warranty and landlord or strata approval before purchase.",
        sourceIds: ["yourhome-glazing", "energy-gov-windows"],
        safetyBoundary: "Some films are unsuitable for particular glass or exposed locations.",
      },
      {
        id: "removable-reflective-shade",
        guidance: "Compare removable reflective window shades, including products sold as Renshade, on fit, fire safety, view, condensation and window warranty. A product name alone is not performance evidence.",
        sourceIds: ["yourhome-shading", "energy-gov-windows"],
        safetyBoundary: "Check egress, fire and strata or rental requirements before fixing a shade in place.",
      },
      {
        id: "honeycomb-blinds",
        guidance: "Close-fitting honeycomb blinds or curtains with pelmets can reduce room-side heat transfer, but external shade is usually the first control for strong summer sun. Keep coverings clear of heaters and manage condensation at the glass.",
        sourceIds: ["yourhome-glazing", "yourhome-shading", "energy-gov-windows"],
        safetyBoundary: "Follow child-safety rules for blind cords and preserve required egress.",
      },
      {
        id: "humidity-control",
        guidance: "Use kitchen and bathroom exhaust to outdoors and short, purposeful ventilation when outdoor conditions suit. A dehumidifier can help manage indoor humidity, but it does not replace finding leaks, rising damp, condensation causes or failed exhaust ventilation.",
        sourceIds: ["yourhome-ventilation-airtightness"],
        safetyBoundary: "Do not seal required ventilation, especially around combustion appliances.",
      },
      {
        id: "deciduous-shade",
        guidance: "Well-placed deciduous planting can shade suitable windows in summer while allowing more winter sun after leaf fall. Check orientation, mature size, roots, services, bushfire exposure and local rules.",
        sourceIds: ["yourhome-shading"],
        safetyBoundary: "Keep planting clear of required access, services, structures and fire-safety zones.",
      },
    ],
    sourceIds: ["yourhome-insulation", "yourhome-glazing", "yourhome-shading", "yourhome-ventilation-airtightness", "energy-gov-insulation-draught-proofing", "energy-gov-windows"],
  },
  {
    id: "ev_charging",
    consumerLabel: "EV charging",
    ...APPROVED_GUIDANCE_METADATA,
    reviewDue: "2026-09-20",
    intentTerms: ["ev charging", "electric vehicle charging", "car charger", "wallbox", "level 1 charging", "level 2 charging", "vehicle to home", "vehicle to grid"],
    productKinds: [],
    comparisonDimensions: [
      { id: "charge_power", consumerLabel: "maximum charge power", attributeKeys: ["maximumChargePowerKw", "ratedPowerKw"], unit: "kW" },
      { id: "vehicle_limit", consumerLabel: "vehicle onboard-charger limit", attributeKeys: ["vehicleAcChargeLimitKw"], unit: "kW" },
      { id: "smart_controls", consumerLabel: "documented smart charging controls", attributeKeys: ["solarAware", "tariffScheduling", "loadManagement"], unit: null },
      { id: "electrical_capacity", consumerLabel: "site supply and dynamic load control", attributeKeys: ["dynamicLoadControl", "maximumSiteCurrentA"], unit: null },
      { id: "weather", consumerLabel: "siting and weather protection", attributeKeys: ["ingressProtectionRating"], unit: null },
      { id: "warranty", consumerLabel: "warranty and local service", attributeKeys: ["warrantyYears"], unit: "years" },
    ],
    contextQuestions: [
      "How far does the vehicle travel each day and how long is it parked at home?",
      "What AC charge rate can the vehicle accept?",
      "What supply phase, main-switch capacity and other large loads are present?",
      "Is solar-aware, tariff-aware or dynamic load-controlled charging required?",
      "Where can the cable and equipment be installed safely?",
    ],
    tips: [
      {
        id: "ev-slow-first",
        guidance: "Start with the daily kilometres and parked hours. A faster wallbox is not automatically necessary if a compliant lower-power connection can safely replace the daily energy used.",
        sourceIds: ["energy-gov-ev-charging-equipment"],
        safetyBoundary: "A licensed electrician must assess the circuit, protection, supply capacity and installation.",
      },
      {
        id: "ev-smart-window",
        guidance: "Schedule charging for surplus solar or genuinely cheaper tariff periods where the vehicle and charger support it. Compare charge rate, dynamic load control, cable reach, weather rating, warranty, software dependence and local service.",
        sourceIds: ["energy-gov-ev-charging-equipment", "energy-gov-solar-batteries"],
        safetyBoundary: "Do not use unsuitable extension leads or unverified adaptors for routine charging.",
      },
    ],
    sourceIds: ["energy-gov-ev-charging-equipment", "energy-gov-solar-batteries"],
  },
  {
    id: "cooking_appliances",
    consumerLabel: "Cooking and appliances",
    ...APPROVED_GUIDANCE_METADATA,
    reviewDue: "2027-02-20",
    intentTerms: ["induction", "cooktop", "cooking", "appliance", "clothes dryer", "heat pump dryer", "dishwasher", "fridge", "freezer", "portable heater", "electric blanket", "heated throw"],
    productKinds: ["clothes_dryer", "refrigerator_freezer", "television"],
    comparisonDimensions: [
      { id: "capacity", consumerLabel: "usable capacity", attributeKeys: ["ratedCapacityKg", "storageVolumeLitres"], unit: null },
      { id: "annual_energy", consumerLabel: "labelled annual energy use", attributeKeys: ["annualEnergyUseKwh"], unit: "kWh" },
      { id: "efficiency", consumerLabel: "energy rating", attributeKeys: ["starRating", "energyStarRating"], unit: null },
      { id: "noise", consumerLabel: "verified sound level", attributeKeys: ["soundPowerDb", "noiseDb"], unit: "dB" },
      { id: "electrical", consumerLabel: "electrical demand", attributeKeys: ["ratedPowerKw", "ratedCurrentA"], unit: null },
      { id: "warranty", consumerLabel: "warranty and local service", attributeKeys: ["warrantyYears"], unit: "years" },
    ],
    contextQuestions: [
      "What exact model and capacity are being considered?",
      "How often is the appliance used and what does the energy label show?",
      "Does the site have the required circuit, ventilation, drainage, space and cookware?",
      "What warranty, repair network and complete installed cost apply?",
    ],
    tips: [
      {
        id: "heat-pump-dryer",
        guidance: "For regular dryer use, compare a heat-pump clothes dryer using labelled annual energy, cycle duration, capacity, noise, filter and condenser cleaning, drainage, warranty and service. Clean filters as the manufacturer directs.",
        sourceIds: ["energy-gov-appliances-cooking"],
        safetyBoundary: "Keep vents and service clearances open and follow the installation instructions.",
      },
      {
        id: "induction-scope",
        guidance: "For induction cooking, check cookware, circuit and switchboard capacity, bench cutout, ventilation, controls, warranty and the safe disconnection or capping of any gas service.",
        sourceIds: ["energy-gov-appliances-cooking"],
        safetyBoundary: "Electrical and gas disconnection work must use appropriately licensed people.",
      },
      {
        id: "appliance-operating-window",
        guidance: "Run flexible appliances during surplus solar or a verified cheaper tariff period when practical. Compare the whole tariff and any demand charge rather than relying on one advertised free-use window.",
        sourceIds: ["energy-gov-appliances-cooking", "energy-gov-solar-batteries"],
        safetyBoundary: "Use delayed starts only where unattended operation is allowed by the appliance instructions.",
      },
    ],
    sourceIds: ["energy-gov-appliances-cooking"],
  },
] as const satisfies readonly ReviewedProductGuidanceCategory[];

const KNOWLEDGE_BY_ID = new Map(
  ENERGY_ASSISTANT_KNOWLEDGE.map((source) => [source.id, source] as const),
);
const APPROVAL_BY_SOURCE_ID = new Map<string, (typeof ENERGY_ASSISTANT_OFFICIAL_SOURCE_APPROVALS)[number]>(
  ENERGY_ASSISTANT_OFFICIAL_SOURCE_APPROVALS.map((approval) => [approval.sourceId, approval] as const),
);

function day(value: Date | string) {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

export function isCurrentOfficialProductGuidanceSource(
  source: EnergyAssistantKnowledgeSource | undefined,
  asOf: Date | string,
) {
  if (!source?.official || source.storagePolicy !== "local_factual_summary") return false;
  const answerDay = day(asOf);
  const approval = APPROVAL_BY_SOURCE_ID.get(source.id);
  return sourceMayAnswerCurrentFact(
    source,
    asOf,
    false,
    approval,
    approval?.evidenceRecordSha256,
  )
    && (!source.effectiveFrom || source.effectiveFrom <= answerDay)
    && (!source.effectiveTo || source.effectiveTo >= answerDay)
    && source.reviewedAt <= answerDay
    && source.reviewDue >= answerDay;
}

export function currentOfficialProductGuidanceSources(
  sourceIds: readonly string[],
  asOf: Date | string,
) {
  return sourceIds.flatMap((sourceId) => {
    const source = KNOWLEDGE_BY_ID.get(sourceId);
    return isCurrentOfficialProductGuidanceSource(source, asOf) && source ? [source] : [];
  });
}

function normalise(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function isCurrentReviewedProductGuidanceCategory(
  category: ReviewedProductGuidanceCategory,
  asOf: Date | string,
) {
  const answerDay = day(asOf);
  return category.reviewStatus === "approved"
    && category.reviewedOn <= answerDay
    && category.reviewDue >= answerDay
    && category.effectiveFrom <= answerDay
    && (!category.effectiveTo || category.effectiveTo >= answerDay)
    && currentOfficialProductGuidanceSources(category.sourceIds, asOf).length === category.sourceIds.length;
}

export function reviewedProductGuidanceCategoryById(
  categoryId: ReviewedProductGuidanceCategoryId,
) {
  return ENERGY_ASSISTANT_REVIEWED_PRODUCT_GUIDANCE.find((category) => (
    category.id === categoryId
  )) || null;
}

export function resolveReviewedProductGuidanceIntent(text: string) {
  const comparable = ` ${normalise(text)} `;
  return ENERGY_ASSISTANT_REVIEWED_PRODUCT_GUIDANCE
    .map((category, categoryIndex) => {
      const score = category.intentTerms.reduce((highest, term) => {
        const candidate = normalise(term);
        return comparable.includes(` ${candidate} `)
          ? Math.max(highest, candidate.length)
          : highest;
      }, 0);
      return { category, categoryIndex, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => (
      right.score - left.score
      || left.categoryIndex - right.categoryIndex
    ))[0]?.category || null;
}

export function reviewedProductGuidanceCategoryFor(text: string) {
  return resolveReviewedProductGuidanceIntent(text);
}

export function reviewedProductGuidanceCategoryForProductKind(
  productKind: CreditexOfficialProductKind,
) {
  return ENERGY_ASSISTANT_REVIEWED_PRODUCT_GUIDANCE.find((category) => (
    category.productKinds.some((candidate) => candidate === productKind)
  )) || null;
}

export function currentReviewedPracticalTips(
  categoryId: ReviewedProductGuidanceCategoryId,
  asOf: Date | string,
): ReviewedPracticalTip[] {
  const category = reviewedProductGuidanceCategoryById(categoryId);
  if (!category || !isCurrentReviewedProductGuidanceCategory(category, asOf)) return [];
  return (category.tips as readonly ReviewedPracticalTip[]).filter((tip) => (
    currentOfficialProductGuidanceSources(tip.sourceIds, asOf).length === tip.sourceIds.length
  ));
}

export function currentReviewedCertificatePathwayCoverage(
  categoryId: ReviewedProductGuidanceCategoryId,
  asOf: Date | string,
) {
  const category = reviewedProductGuidanceCategoryById(categoryId);
  if (!category || !isCurrentReviewedProductGuidanceCategory(category, asOf)) return [];
  return CERTIFICATE_PATHWAYS.filter((pathway) => (
    pathway.categoryIds.some((candidate) => candidate === categoryId)
    && currentOfficialProductGuidanceSources(pathway.sourceIds, asOf).length === pathway.sourceIds.length
  ));
}

export function reviewedCertificatePathwaysFor(input: {
  categoryId: ReviewedProductGuidanceCategoryId;
  jurisdiction: string;
  asOf: Date | string;
}) {
  const jurisdiction = input.jurisdiction.toUpperCase();
  return currentReviewedCertificatePathwayCoverage(input.categoryId, input.asOf).filter((pathway) => (
    pathway.jurisdictions.some((candidate) => candidate === jurisdiction)
  ));
}

export function allReviewedCertificatePathways() {
  return CERTIFICATE_PATHWAYS;
}
