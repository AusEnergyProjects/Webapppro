import assert from "node:assert/strict";
import test from "node:test";
import {
  ENERGY_ASSISTANT_KNOWLEDGE,
  ENERGY_ASSISTANT_TOPICS,
  ENERGY_ASSISTANT_VOLATILITY_CLASSES,
} from "../src/data/energy-assistant-knowledge.ts";
import { searchEnergyAssistantKnowledge } from "../src/lib/energy-assistant.ts";

const REVIEW_DAY = "2026-09-01";
const PROHIBITED_RUNTIME_HOSTS = [
  "choice.com.au",
  "drkarl.com",
  "ecomaster.com.au",
  "renew.org.au",
  "rewiringaustralia.org",
  "solarquotes.com.au",
  "timforcey.com.au",
];
const OFFICIAL_RUNTIME_HOSTS = new Set([
  "cbos.tas.gov.au",
  "cbs.sa.gov.au",
  "cer.gov.au",
  "www.climatechoices.act.gov.au",
  "nt.gov.au",
  "ncc.abcb.gov.au",
  "reg.energyrating.gov.au",
  "www.act.gov.au",
  "www.asbestossafety.gov.au",
  "www.abcb.gov.au",
  "www.accc.gov.au",
  "www.aemo.com.au",
  "www.aer.gov.au",
  "www.consumer.vic.gov.au",
  "www.consumerprotection.wa.gov.au",
  "www.dcceew.gov.au",
  "www.cbs.sa.gov.au",
  "www.energy.gov.au",
  "www.energy.nsw.gov.au",
  "www.energy.vic.gov.au",
  "www.energysafe.vic.gov.au",
  "www.energymadeeasy.gov.au",
  "www.energysustainabilityschemes.nsw.gov.au",
  "www.energyrating.gov.au",
  "www.esc.vic.gov.au",
  "www.fire.nsw.gov.au",
  "www.greenvehicleguide.gov.au",
  "www.homeenergyrating.gov.au",
  "www.healthdirect.gov.au",
  "www.nathers.gov.au",
  "www.nsw.gov.au",
  "www.productsafety.gov.au",
  "www.rta.qld.gov.au",
  "www.secvictoria.com.au",
  "www.wa.gov.au",
  "www.yourhome.gov.au",
  "www2.education.vic.gov.au",
  "cpd.abcb.gov.au",
  "moneysmart.gov.au",
]);

test("runtime knowledge is a 115-source official Australian corpus", () => {
  assert.equal(ENERGY_ASSISTANT_KNOWLEDGE.length, 115);
  assert.deepEqual(
    [...new Set(ENERGY_ASSISTANT_KNOWLEDGE.map((source) => source.topic))].sort(),
    [...ENERGY_ASSISTANT_TOPICS].sort(),
  );

  for (const source of ENERGY_ASSISTANT_KNOWLEDGE) {
    assert.equal(source.official, true, source.id);
    assert.equal(source.storagePolicy, "local_factual_summary", source.id);
    assert.match(source.reviewedAt, /^\d{4}-\d{2}-\d{2}$/, source.id);
    assert.ok(source.reviewedAt <= REVIEW_DAY, source.id);
    assert.match(source.reviewDue, /^\d{4}-\d{2}-\d{2}$/, source.id);
    assert.ok(source.reviewDue > source.reviewedAt, source.id);
    assert.ok(source.reviewDue <= "2027-08-22", source.id);
    assert.ok(ENERGY_ASSISTANT_VOLATILITY_CLASSES.includes(source.volatilityClass), source.id);
    assert.equal(source.reuseBasis, source.licence, source.id);
    assert.ok(source.jurisdiction.trim().length > 0, source.id);
    assert.ok(source.summary.trim().length >= 80, source.id);
    assert.ok(source.keywords.length >= 5, source.id);
    assert.match(source.url, /^https:\/\//, source.id);
    assert.ok(OFFICIAL_RUNTIME_HOSTS.has(new URL(source.url).hostname), source.id);
    if (source.effectiveFrom !== null) {
      assert.match(source.effectiveFrom, /^\d{4}-\d{2}-\d{2}$/, source.id);
    }
    if (source.effectiveTo !== null) {
      assert.match(source.effectiveTo, /^\d{4}-\d{2}-\d{2}$/, source.id);
      assert.ok(
        source.effectiveFrom === null || source.effectiveTo >= source.effectiveFrom,
        source.id,
      );
    }
  }
});

test("source identifiers and official URLs are unique", () => {
  const ids = ENERGY_ASSISTANT_KNOWLEDGE.map((source) => source.id);
  const urls = ENERGY_ASSISTANT_KNOWLEDGE.map((source) => source.url);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(urls).size, urls.length);
});

test("runtime knowledge excludes editorial, competitor and supplier publishers", () => {
  const runtimeUrls = ENERGY_ASSISTANT_KNOWLEDGE.map((source) => source.url);
  for (const value of runtimeUrls) {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    assert.ok(
      !PROHIBITED_RUNTIME_HOSTS.some(
        (prohibited) => hostname === prohibited || hostname.endsWith(`.${prohibited}`),
      ),
      value,
    );
  }

  const serialised = JSON.stringify(ENERGY_ASSISTANT_KNOWLEDGE).toLowerCase();
  for (const prohibited of [
    "dr karl",
    "ecomaster",
    "electric saul",
    "renew household",
    "rewiring australia",
    "saul griffith",
    "solarquotes",
    "tim forcey",
  ]) {
    assert.doesNotMatch(serialised, new RegExp(prohibited.replace(" ", "\\s+"), "i"));
  }
});

test("official corpus covers every required Australian decision boundary", () => {
  const requiredSources = new Set([
    "nathers-existing-homes",
    "nathers-certificate",
    "nathers-guidance-note",
    "nathers-climate-files",
    "ncc-existing-home-renovations",
    "abcb-upgrading-existing-buildings-handbook",
    "abcb-housing-energy-efficiency-handbook",
    "ncc-condensation-handbook",
    "yourhome-passive-design-system",
    "yourhome-design-for-climate",
    "yourhome-insulation",
    "yourhome-construction-systems",
    "yourhome-thermal-mass",
    "yourhome-embodied-energy",
    "yourhome-glazing",
    "yourhome-shading",
    "yourhome-passive-heating",
    "yourhome-passive-cooling",
    "yourhome-passive-house",
    "yourhome-condensation-moisture",
    "yourhome-indoor-air-quality",
    "energy-gov-insulation-draught-proofing",
    "energy-gov-windows",
    "energy-gov-energy-rating",
    "energy-gov-reduce-energy-bills",
    "energy-gov-heating-cooling",
    "energy-gov-carbon-monoxide-heater-safety",
    "energy-gov-smart-hot-water",
    "healthdirect-toxic-fume-first-aid",
    "asbestos-safety-identification-removal",
    "esv-home-electrical-fault-signs",
    "wa-roof-space-foil-electrical-safety",
    "energy-gov-solar-system-maintenance",
    "vic-extension-lead-overheating",
    "act-bidirectional-ev-charging",
    "dcceew-refrigerant-recovery-licensing",
    "esv-carbon-monoxide-alarm-signals",
    "nsw-home-electrical-safety",
    "yourhome-orientation",
    "yourhome-concrete-slab-floors",
    "yourhome-lightweight-framing",
    "yourhome-brickwork-blockwork",
    "yourhome-autoclaved-aerated-concrete",
    "yourhome-cladding-systems",
    "yourhome-rammed-earth",
    "yourhome-straw-bale",
    "yourhome-green-roofs-walls",
    "yourhome-lighting",
    "yourhome-appliances-technology",
    "yourhome-smart-homes-energy-management",
    "yourhome-renewable-energy",
    "yourhome-skylights",
    "yourhome-landscaping-garden-design",
    "energy-rating-zoned-label",
    "energy-rating-product-register",
    "cer-swh-ashp-register",
    "cer-stc-entitlement-calculation",
    "cer-small-scale-system-requirements",
    "cer-rooftop-solar-trade-requirements",
    "cer-solar-battery-requirements",
    "cer-solar-battery-inspection-checklist",
    "veu-heating-cooling-discounts",
    "veu-water-space-activity-guide-v3-19",
    "nsw-ess-rule-current-2026",
    "nsw-pdrs-rule-current-2026",
    "nsw-iheab-hpwh-fact-sheet-v2-2",
    "product-safety-recalls",
    "accc-consumer-guarantees",
    "aer-understanding-energy-bill",
    "energy-made-easy-current-plan-comparison",
    "green-vehicle-guide-compare",
    "energy-gov-ev-charging-equipment",
    "energy-gov-ev-home-strata-charging",
    "energy-gov-renters",
    "act-rental-ceiling-insulation-standard",
    "vic-rental-minimum-energy-standards",
    "nsw-rental-minimum-standards",
    "qld-rental-minimum-housing-standards",
    "sa-rental-minimum-standards",
    "wa-rental-maintenance-modifications",
    "tas-rental-minimum-standards",
    "nt-rental-repairs-maintenance",
    "energy-gov-strata-personal-ev-charger",
    "energy-gov-rebates",
    "energy-gov-household-energy-upgrades-fund",
    "nsw-home-energy-saver-current",
    "sec-victoria-household-electrification",
    "asic-moneysmart-personal-loans",
    "energy-gov-solar-sharer-offer",
    "aemo-mdff-nem12-nem13-v2-7",
  ]);
  const actual = new Set(ENERGY_ASSISTANT_KNOWLEDGE.map((source) => source.id));
  for (const id of requiredSources) assert.ok(actual.has(id), id);
});

test("question-down facts are available locally without publisher referrals", () => {
  const byId = new Map(
    ENERGY_ASSISTANT_KNOWLEDGE.map((source) => [
      source.id,
      `${source.summary} ${source.keywords.join(" ")}`.toLowerCase(),
    ]),
  );

  const stc = byId.get("cer-stc-entitlement-calculation");
  assert.match(stc, /postcode/);
  assert.match(stc, /installation date/);
  assert.match(stc, /deeming period/);

  const register = byId.get("cer-swh-ashp-register");
  assert.match(register, /exact model/);
  assert.match(register, /eligible from/);
  assert.match(register, /eligible to/);

  const draught = byId.get("energy-gov-insulation-draught-proofing");
  assert.match(draught, /diy/);
  assert.match(draught, /professional/);
  assert.match(draught, /licensed electrician/);
  assert.match(draught, /unflued gas heater/);

  const charging = byId.get("energy-gov-ev-home-strata-charging");
  assert.match(charging, /level 1/);
  assert.match(charging, /level 2/);
  assert.match(charging, /licensed electrician/);
  assert.match(charging, /strata approval/);

  const chargingEquipment = byId.get("energy-gov-ev-charging-equipment");
  assert.match(chargingEquipment, /level 1/);
  assert.match(chargingEquipment, /level 2/);
  assert.match(chargingEquipment, /level 3/);
  assert.match(chargingEquipment, /smart charging/);
  assert.match(chargingEquipment, /dc fast/);

  const trade = byId.get("cer-rooftop-solar-trade-requirements");
  assert.match(trade, /exact products/);
  assert.match(trade, /written compliance statement/);
  assert.match(trade, /on site evidence/);

  const battery = byId.get("cer-solar-battery-requirements");
  assert.match(battery, /dwelling that is lived in/);
  assert.match(battery, /sheds or bore pumps, are not eligible/);
  assert.match(battery, /approved-list status is only one requirement/);
});

test("Victorian heating and cooling support uses the consumer page without displacing activity evidence", () => {
  const consumer = searchEnergyAssistantKnowledge(
    "Which Victorian support applies if I replace a gas heater with reverse-cycle air conditioning?",
    { asOf: "2026-09-01", audience: "household", limit: 6 },
  );
  assert.equal(consumer[0]?.source.id, "veu-heating-cooling-discounts");
  assert.equal(
    consumer[0]?.source.url,
    "https://www.energy.vic.gov.au/victorian-energy-upgrades/products/heating-and-cooling-discounts",
  );

  const activityEvidence = searchEnergyAssistantKnowledge(
    "Which current VEEC activity guide and invoice evidence should a trade use?",
    { asOf: "2026-09-01", audience: "trade", limit: 6 },
  );
  assert.equal(activityEvidence[0]?.source.id, "veu-water-space-activity-guide-v3-19");
});

test("whole-of-home teaching facts explain causes, trade-offs and safe next checks", () => {
  const facts = Object.fromEntries(
    ENERGY_ASSISTANT_KNOWLEDGE.map((source) => [
      source.id,
      `${source.summary} ${source.keywords.join(" ")}`.toLowerCase(),
    ]),
  );

  assert.match(facts["yourhome-insulation"], /heat flow/);
  assert.match(facts["yourhome-insulation"], /thermal bridging/);
  assert.match(facts["yourhome-insulation"], /fire clearances/);
  assert.match(facts["yourhome-construction-systems"], /system r value/);
  assert.match(facts["yourhome-glazing"], /u-value/);
  assert.match(facts["yourhome-glazing"], /solar heat gain coefficient/);
  assert.match(facts["yourhome-passive-cooling"], /humidity/);
  assert.match(facts["yourhome-passive-house"], /fresh-air ventilation/);
  assert.match(facts["yourhome-indoor-air-quality"], /moisture source/);
  assert.match(facts["yourhome-embodied-energy"], /operational energy/);
  assert.match(facts["energy-gov-energy-rating"], /annual kilowatt-hour/);
  assert.match(facts["energy-gov-energy-rating"], /standby/);
  assert.match(facts["energy-gov-reduce-energy-bills"], /controlled-load/);
  assert.match(facts["energy-gov-reduce-energy-bills"], /feed-in/);
  assert.match(facts["energy-gov-renters"], /portable fan/);
  assert.match(facts["energy-gov-renters"], /written owner approval/);
  assert.match(facts["energy-gov-rebates"], /state and territory/);
  assert.match(facts["energy-gov-rebates"], /administering government/);
  assert.match(facts["energy-gov-carbon-monoxide-heater-safety"], /licensed gas fitter/);
  assert.match(facts["energy-gov-smart-hot-water"], /may not restart correctly/);
  assert.match(facts["energy-gov-smart-hot-water"], /required safety cycles/);
  assert.match(facts["healthdirect-toxic-fume-first-aid"], /fresh air immediately/);
  assert.match(facts["asbestos-safety-identification-removal"], /should not be drilled/);
  assert.match(facts["esv-home-electrical-fault-signs"], /do not investigate live equipment/);
  assert.match(facts["wa-roof-space-foil-electrical-safety"], /metallised foil/);
  assert.match(facts["energy-gov-solar-system-maintenance"], /remains energised/);
  assert.match(facts["vic-extension-lead-overheating"], /under carpet or rugs/);
  assert.match(facts["act-bidirectional-ev-charging"], /safe grid disconnection/);
  assert.match(facts["dcceew-refrigerant-recovery-licensing"], /illegal to release/);
  assert.match(facts["esv-carbon-monoxide-alarm-signals"], /sensor end-of-life/);
  assert.match(facts["nsw-home-electrical-safety"], /must not be touched, drilled into/);
  assert.match(facts["yourhome-orientation"], /true or solar north/);
  assert.match(facts["yourhome-concrete-slab-floors"], /thermal bridges/);
  assert.match(facts["yourhome-lightweight-framing"], /steel is highly conductive/);
  assert.match(facts["yourhome-brickwork-blockwork"], /not interchangeable/);
  assert.match(facts["yourhome-autoclaved-aerated-concrete"], /vapour permeable/);
  assert.match(facts["yourhome-cladding-systems"], /whole wall system/);
  assert.match(facts["yourhome-rammed-earth"], /limited insulation/);
  assert.match(facts["yourhome-straw-bale"], /below 15% moisture/);
  assert.match(facts["yourhome-green-roofs-walls"], /do not replace verified roof insulation/);
  assert.match(facts["yourhome-lighting"], /lumens rather than watts/);
  assert.match(facts["yourhome-appliances-technology"], /annual kilowatt-hour/);
  assert.match(facts["yourhome-smart-homes-energy-management"], /interoperability/);
  assert.match(facts["yourhome-renewable-energy"], /demand timing/);
  assert.match(facts["yourhome-skylights"], /heat gain, heat loss and glare/);
  assert.match(facts["yourhome-landscaping-garden-design"], /guide cooling breezes/);
});

test("reviewed household expansion materially strengthens practical topic coverage", () => {
  const counts = Object.fromEntries(
    ENERGY_ASSISTANT_TOPICS.map((topic) => [
      topic,
      ENERGY_ASSISTANT_KNOWLEDGE.filter((source) => source.topic === topic).length,
    ]),
  );

  assert.equal(counts.comfort_fabric, 18);
  assert.equal(counts.insulation, 3);
  assert.equal(counts.glazing_shading, 5);
  assert.equal(counts.products_ratings, 6);
  assert.equal(counts.solar, 5);
  assert.equal(counts.battery_vpp, 3);

  const addedIds = new Set([
    "yourhome-orientation",
    "yourhome-concrete-slab-floors",
    "yourhome-lightweight-framing",
    "yourhome-brickwork-blockwork",
    "yourhome-autoclaved-aerated-concrete",
    "yourhome-cladding-systems",
    "yourhome-rammed-earth",
    "yourhome-straw-bale",
    "yourhome-green-roofs-walls",
    "yourhome-lighting",
    "yourhome-appliances-technology",
    "yourhome-smart-homes-energy-management",
    "yourhome-renewable-energy",
    "yourhome-skylights",
    "yourhome-landscaping-garden-design",
  ]);
  const yourHomeAdditions = ENERGY_ASSISTANT_KNOWLEDGE.filter((source) =>
    addedIds.has(source.id),
  );
  assert.equal(yourHomeAdditions.length, addedIds.size);
  for (const source of yourHomeAdditions) {
    assert.equal(source.publisher, "Your Home, Australian Government");
    assert.match(source.licence, /CC BY 4\.0/);
  }
});

test("heat-pump guidance is exact-model, performance based and commercially neutral", () => {
  const selected = ENERGY_ASSISTANT_KNOWLEDGE.filter((source) =>
    ["rcac", "heat_pump_hot_water"].includes(source.topic),
  );
  const localFacts = selected
    .map((source) => `${source.summary} ${source.keywords.join(" ")}`)
    .join(" ")
    .toLowerCase();

  for (const fact of [
    "heat load",
    "design temperature",
    "capacity retention",
    "cop",
    "eer",
    "aeer",
    "noise",
    "condensate",
    "refrigerant",
    "controls",
    "hot water demand",
    "cold climate recovery",
    "warranty service",
  ]) {
    assert.match(localFacts, new RegExp(fact), fact);
  }

  const serialised = JSON.stringify(ENERGY_ASSISTANT_KNOWLEDGE).toLowerCase();
  assert.doesNotMatch(
    serialised,
    /best brand|brand ranking|brand recommendation|manufacturer recommendation|recommended manufacturer|affiliate|sponsored|commission link/,
  );
});

test("solar and battery certificate facts distinguish eligibility from dollar value", () => {
  const byId = new Map(
    ENERGY_ASSISTANT_KNOWLEDGE.map((source) => [
      source.id,
      `${source.summary} ${source.keywords.join(" ")}`.toLowerCase(),
    ]),
  );
  const entitlement = byId.get("cer-stc-entitlement-calculation");
  const system = byId.get("cer-small-scale-system-requirements");
  const battery = byId.get("cer-solar-battery-requirements");

  assert.match(entitlement, /not a fixed national rebate/);
  assert.match(entitlement, /capacity/);
  assert.match(entitlement, /postcode zone/);
  assert.match(entitlement, /installation date/);
  assert.match(system, /approved components/);
  assert.match(system, /accredited designer and installer/);
  assert.match(battery, /approved battery/);
  assert.match(battery, /one eligible battery system/);
});

test("current technical documents and every rental jurisdiction are versioned in the local corpus", () => {
  const byId = new Map(
    ENERGY_ASSISTANT_KNOWLEDGE.map((source) => [source.id, source]),
  );

  assert.equal(byId.get("nathers-technical-note")?.effectiveFrom, "2026-07-01");
  assert.match(byId.get("nathers-technical-note")?.title || "", /July 2026/);
  assert.equal(byId.get("nathers-guidance-note")?.effectiveFrom, "2026-07-01");
  assert.match(byId.get("nathers-guidance-note")?.title || "", /July 2026/);
  assert.equal(byId.get("aemo-mdff-nem12-nem13-v2-7")?.effectiveFrom, "2025-12-01");
  assert.match(byId.get("aemo-mdff-nem12-nem13-v2-7")?.title || "", /v2\.7/);
  assert.equal(byId.get("veu-water-space-activity-guide-v3-19")?.effectiveFrom, "2026-03-24");
  assert.equal(byId.get("nsw-ess-rule-current-2026")?.effectiveFrom, "2026-07-01");
  assert.equal(byId.get("nsw-pdrs-rule-current-2026")?.effectiveFrom, "2026-07-01");
  assert.equal(byId.get("nsw-iheab-hpwh-fact-sheet-v2-2")?.effectiveFrom, "2026-08-07");

  for (const id of [
    "act-rental-ceiling-insulation-standard",
    "vic-rental-minimum-energy-standards",
    "nsw-rental-minimum-standards",
    "qld-rental-minimum-housing-standards",
    "sa-rental-minimum-standards",
    "wa-rental-maintenance-modifications",
    "tas-rental-minimum-standards",
    "nt-rental-repairs-maintenance",
  ]) {
    const source = byId.get(id);
    assert.ok(source, id);
    assert.equal(source.topic, "renters_strata", id);
    assert.ok(source.reviewDue <= "2026-10-20", id);
  }

  for (const id of [
    "ncc-condensation-handbook",
    "home-energy-ratings-disclosure-framework",
    "veu-water-space-activity-guide-v3-19",
  ]) {
    assert.match(byId.get(id)?.url || "", /\.pdf$/i, id);
  }
});
