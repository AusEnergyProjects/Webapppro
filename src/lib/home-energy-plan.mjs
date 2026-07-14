const GOALS = new Set(["lower-bills", "improve-comfort", "replace-now", "move-from-gas", "add-solar-storage", "prepare-renovation"]);
const PACES = new Set(["one-step", "staged", "whole-home"]);
const SITUATIONS = new Set(["owner", "renter", "strata", "planning-building"]);
const FEATURES = new Set(["draughty", "gas-heating", "gas-hot-water", "gas-cooking", "solar", "battery", "ev"]);

function clean(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function cleanFeatures(value) {
  const items = Array.isArray(value) ? value : [];
  return [...new Set(items.filter((item) => FEATURES.has(item)))];
}

const recommendations = {
  urgent: { id: "urgent", stage: "Do first", title: "Define the urgent replacement before accepting a like-for-like swap", text: "Make failed equipment safe, record what it served and ask a licensed trade to price the efficient electric option as well as any enabling work.", href: "/account/projects/new", action: "Prepare an urgent private project" },
  authority: { id: "authority", stage: "Before quotes", title: "Confirm who can approve changes to the property", text: "Renters and strata residents may need written permission before equipment, wiring, external units, solar or EV charging can change.", href: "/account/projects/new", action: "Prepare an authority-aware project" },
  assessment: { id: "assessment", stage: "Start with evidence", title: "Choose the right home or design assessment", text: "A building assessment can separate fabric, comfort and fixed-appliance priorities before a renovation or whole-home scope is priced.", href: "/assessments", action: "Explore assessment pathways" },
  compare: { id: "compare", stage: "Quick win", title: "Check the plans you already pay for", text: "Compare current electricity offers with your location and usage evidence. Keep gas separate while the home still has an active gas connection.", href: "/compare", action: "Compare electricity plans" },
  compareGas: { id: "compare-gas", stage: "Quick win", title: "Check the mains gas plan while it remains connected", text: "Use a full year of MJ or one dated recent bill so seasonal gas use is compared separately from electricity timing.", href: "/gas-compare", action: "Compare mains gas plans" },
  fabric: { id: "fabric", stage: "Reduce demand", title: "Address draughts, insulation and heat loss before sizing equipment", text: "Comfort problems are often a building-fabric problem as well as an appliance problem. Check ventilation, moisture and safety boundaries before sealing or insulating.", href: "/guides/insulation-draught-proofing", action: "Open the building fabric guide" },
  heating: { id: "heating", stage: "Plan the replacement", title: "Size efficient heating and cooling for the rooms that need it", text: "Use climate performance, room use, building fabric, outdoor-unit location, noise and switchboard constraints in the written scope.", href: "/guides/heating", action: "Open the heating guide" },
  hotWater: { id: "hot-water", stage: "Plan the replacement", title: "Match hot water capacity and timing to the household", text: "Compare heat-pump performance, tank size, tariff timing, noise, condensate, backup and current incentive rules before choosing a model.", href: "/guides/hot-water", action: "Open the hot water guide" },
  cooking: { id: "cooking", stage: "Plan the replacement", title: "Include cooking and any electrical enabling work", text: "Check cookware, circuit capacity, ventilation, bench cut-out and the safe removal or isolation of existing gas equipment.", href: "/guides/cooking", action: "Open the electric cooking guide" },
  solar: { id: "solar", stage: "Use the roof", title: "Test rooftop solar against daytime household use", text: "Start with roof-specific generation, self-consumption, export limits, inverter constraints and a complete installed quote.", href: "/guides/solar", action: "Open the solar guide" },
  battery: { id: "battery", stage: "Test storage last", title: "Size storage from surplus solar and evening demand", text: "Use usable capacity, power, reserve, efficiency, warranty, backup behaviour and the current written discount assumption.", href: "/guides/batteries", action: "Open the battery guide" },
  ev: { id: "ev", stage: "Coordinate the load", title: "Match home charging to driving, solar and site capacity", text: "A standard outlet may cover modest driving. A dedicated charger needs a licensed electrician, compatible controls and possible switchboard or supply work.", href: "/guides/ev-charging", action: "Open the EV charging guide" },
  support: { id: "support", stage: "Before accepting a quote", title: "Confirm rebates, certificates and finance at the official source", text: "Treat every incentive as conditional until the product, installer, property, timing and application pathway have been confirmed.", href: "/rebates", action: "Check rebates and assistance" },
  brief: { id: "brief", stage: "When the scope is clear", title: "Save the roadmap as a private project", text: "Carry the services, priorities, region and approval situation into a privacy-safe account project for suitable verified capability.", href: "/account/projects/new", action: "Create a private project" },
};

export function createHomeEnergyPlan(input = {}) {
  const goal = clean(input.goal, GOALS, "lower-bills");
  const pace = clean(input.pace, PACES, "staged");
  const situation = clean(input.situation, SITUATIONS, "owner");
  const features = cleanFeatures(input.features);
  const has = (feature) => features.includes(feature);
  const items = [];
  const add = (item) => { if (!items.some((existing) => existing.id === item.id)) items.push(item); };

  if (goal === "replace-now") add(recommendations.urgent);
  if (situation === "renter" || situation === "strata") add(recommendations.authority);
  if (goal === "prepare-renovation" || pace === "whole-home") add(recommendations.assessment);
  if (goal === "lower-bills") add(recommendations.compare);
  if ((has("gas-heating") || has("gas-hot-water") || has("gas-cooking")) && (goal === "lower-bills" || goal === "move-from-gas")) add(recommendations.compareGas);
  if (has("draughty") || goal === "improve-comfort" || pace === "whole-home") add(recommendations.fabric);
  if (has("gas-heating") || goal === "improve-comfort" || goal === "move-from-gas") add(recommendations.heating);
  if (has("gas-hot-water") || goal === "move-from-gas") add(recommendations.hotWater);
  if (has("gas-cooking") || goal === "move-from-gas") add(recommendations.cooking);
  if (!has("solar") && (goal === "lower-bills" || goal === "add-solar-storage" || goal === "move-from-gas" || pace === "whole-home")) add(recommendations.solar);
  if (has("solar") && !has("battery") && (goal === "add-solar-storage" || pace === "whole-home")) add(recommendations.battery);
  if (has("ev")) add(recommendations.ev);
  add(recommendations.support);
  add(recommendations.brief);

  const paceLabel = pace === "one-step" ? "one practical next step" : pace === "whole-home" ? "a coordinated whole-home scope" : "a staged roadmap";
  const situationLabel = situation === "owner" ? "an owner-occupier" : situation === "renter" ? "a renter" : situation === "strata" ? "a strata household" : "a home in design or renovation";
  return {
    goal,
    pace,
    situation,
    features,
    title: goal === "replace-now" ? "Move quickly without locking in the wrong replacement" : goal === "improve-comfort" ? "Reduce the load, then improve comfort" : goal === "move-from-gas" ? "Stage the move from gas around appliance life" : goal === "add-solar-storage" ? "Match solar and storage to the home" : goal === "prepare-renovation" ? "Coordinate assessment, fabric and equipment decisions" : "Start with evidence, then spend where it matters",
    summary: `This is ${paceLabel} for ${situationLabel}. It is a decision sequence, not a quote or savings promise.`,
    items,
  };
}

export const homeEnergyPlanOptions = {
  goals: [
    ["lower-bills", "Lower energy bills"], ["improve-comfort", "Improve comfort"], ["replace-now", "Replace failed equipment"],
    ["move-from-gas", "Move away from gas"], ["add-solar-storage", "Add solar or storage"], ["prepare-renovation", "Plan a renovation or new home"],
  ],
  paces: [["one-step", "One next step"], ["staged", "Stage upgrades over time"], ["whole-home", "Coordinate the whole home"]],
  situations: [["owner", "I own the home"], ["renter", "I rent"], ["strata", "Apartment or strata"], ["planning-building", "Designing or renovating"]],
  features: [
    ["draughty", "Draughty, too hot or too cold"], ["gas-heating", "Gas heating"], ["gas-hot-water", "Gas hot water"],
    ["gas-cooking", "Gas cooking"], ["solar", "Rooftop solar"], ["battery", "Home battery"], ["ev", "EV or planned EV"],
  ],
};
