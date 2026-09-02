import {
  CUSTOMER_EVERYDAY_ACTIONS_BOUNDARY,
  createCustomerPermissionPack,
  createCustomerProjectPlan,
  customerAdvisorOptions,
  customerHomeFeatureSections,
  customerProjectOptions,
  derivePlanningClimateProfile,
  normalizeHomeFeatureSelections,
  normalizeCustomerAdvisorProfile,
  normalizeCustomerProfessionalReview,
  parseStoredJson,
} from "./customer-projects.mjs";
import {
  CUSTOMER_PLAN_REPORT_DESIGN_VERSION,
  customerPlanDisplayDate,
  customerPlanProfessionalPresentation,
  customerPlanReadinessPresentation,
  customerPlanReportColors,
  customerPlanReportCopy,
  customerPlanReportLayout,
} from "./customer-plan-report-design.mjs";
import { residentialStateFromPostcode } from "./australian-postcodes.mjs";
export const CUSTOMER_PLAN_DOCUMENT_VERSION = "2026-07-29-plan-document-v2";
export const CUSTOMER_PLAN_REPORT_VERSION =
  "2026-08-11-professional-personalised-report-v7";
export const INSTALLER_ENQUIRY_PACK_VERSION =
  "2026-07-31-installer-enquiry-pack-v1";
export const CUSTOMER_PLAN_EMAIL_SUBJECT = "Your home energy plan is ready";
export const CUSTOMER_PLAN_PUBLIC_ORIGIN = "https://ausenergyassessments.com";
export const AEA_BRANDMARK_PUBLIC_URL =
  `${CUSTOMER_PLAN_PUBLIC_ORIGIN}/api/aea-brandmark`;

const emailLayout = customerPlanReportLayout.email;

const allowedGuideHrefs = new Set([
  "/guides/batteries",
  "/guides/cooking",
  "/guides/ev-charging",
  "/guides/heating",
  "/guides/hot-water",
  "/guides/insulation-draught-proofing",
  "/guides/project-preparation#budget-10k-plus",
  "/guides/project-preparation#budget-2-10k",
  "/guides/project-preparation#budget-under-2k",
  "/guides/project-preparation#climate-planning",
  "/guides/project-preparation#evidence-first",
  "/guides/project-preparation#permissions",
  "/guides/project-preparation#room-comfort",
  "/guides/project-preparation#urgent-replacement",
  "/guides/solar",
]);

const trustedPlanResourceHrefs = new Set([
  "/plan",
  "/rebates",
  "/calculator",
  "/compare",
  "/gas-compare",
  "/assessments",
  "https://www.energy.gov.au/households",
  "https://www.energy.gov.au/households/household-guides/reduce-energy-bills",
  "https://www.energy.gov.au/households/insulation-and-draught-proofing",
  "https://www.energy.gov.au/households/quick-wins",
  "https://www.energy.gov.au/rebates",
  "https://www.homeenergyrating.gov.au/",
  "https://www.homeenergyrating.gov.au/resources/existing-homes-guidance-note",
  "https://www.homeenergyrating.gov.au/resources/existing-homes-technical-note",
  "https://www.homeenergyrating.gov.au/households/existing-homes/measuring-energy-efficiency-existing-homes",
  "https://www.climatechoices.act.gov.au/energy/energy-efficiency/window-glazing-or-treatments",
  "https://www.sustainability.vic.gov.au/energy-efficiency-and-reducing-emissions/building-or-renovating/build-for-energy-efficiency/key-principles-of-energy-efficient-design/windows-and-shading/window-glazing",
  "https://www.yourhome.gov.au/passive-design/introduction",
  "https://www.yourhome.gov.au/passive-design/insulation",
]);

const evidenceSourceLabels = new Map([
  ["unknown", "Not known or not checked"],
  ["customer-reported", "Customer reported"],
  ["photo-supported", "Photo recorded in the private project"],
  ["document-supported", "Document recorded in the private project"],
]);

const readinessFactKeyByQuestion = new Map([
  ["comfort-concerns", "draughts"],
  ["ventilation-features", "ventilation"],
  ["exhaust-fans", "ventilation"],
  ["heating-cooling-systems", "heating-cooling"],
]);

const readinessFactKeys = new Set(
  customerHomeFeatureSections.flatMap((section) =>
    section.questions.map((question) =>
      readinessFactKeyByQuestion.get(question.id) || question.id,
    ),
  ),
);
const allowedEverydayActionIds = new Set([
  "moisture-safe-routine",
  "personal-warmth-first",
  "safe-draught-stopper",
  "use-existing-controls",
  "hot-water-routine",
  "efficient-cooking",
  "appliance-routines",
  "lighting-routine",
  "pool-spa-routine",
  "safe-seasonal-airflow",
  "seasonal-window-and-landscape",
  "renter-friendly-diy-boundary",
]);
const everydayActionOutcomeById = new Map([
  ["moisture-safe-routine", "Helps clear everyday moisture while preserving the ventilation the home needs."],
  ["personal-warmth-first", "Can improve comfort without heating every room or increasing fixed equipment capacity."],
  ["safe-draught-stopper", "Reduces a confirmed unwanted gap while keeping required vents, chimneys, flues and exhaust paths clear."],
  ["use-existing-controls", "Reduces unnecessary runtime and helps existing equipment deliver the performance it was designed for."],
  ["hot-water-routine", "Reduces hot-water demand without changing storage temperatures, safety cycles or protected controls."],
  ["efficient-cooking", "Avoids heating more cookware, water or oven space than the task needs while preserving required ventilation."],
  ["appliance-routines", "Targets avoidable laundry, drying, refrigeration and standby energy while keeping essential equipment powered."],
  ["lighting-routine", "Cuts lighting energy first in the rooms and fittings used most often."],
  ["pool-spa-routine", "Can reduce pumping and heating runtime while preserving water quality and required filtration."],
  ["safe-seasonal-airflow", "Uses low-energy air movement when outdoor conditions are helpful and avoids conditioning empty rooms."],
  ["seasonal-window-and-landscape", "Manages heat at the window before a higher-cost glazing or equipment decision."],
  ["renter-friendly-diy-boundary", "Keeps early action reversible while protecting ventilation, the property and the tenancy approval boundary."],
]);

const optionLabel = (options, value, fallback = "") => (
  options.find(([key]) => key === value)?.[1] || fallback
);

const boundedText = (value, maximum = 800) => (
  typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
);

const boundedSentenceText = (value, maximum = 800) => {
  const normalized = boundedText(value, maximum + 1_200);
  if (normalized.length <= maximum) return normalized;
  const candidate = normalized.slice(0, maximum);
  const sentenceEnd = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("? "),
    candidate.lastIndexOf("! "),
  );
  if (sentenceEnd >= Math.floor(maximum * 0.55)) {
    return candidate.slice(0, sentenceEnd + 1).trim();
  }
  const wordEnd = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, wordEnd > 0 ? wordEnd : maximum).trim().replace(/[,:;]$/, "")}.`;
};

const boundedStringList = (value, maximumItems = 6, maximumLength = 240) => (
  Array.isArray(value)
    ? value
      .map((item) => boundedText(item, maximumLength))
      .filter(Boolean)
      .slice(0, maximumItems)
    : []
);

const parsedObject = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const parsed = parseStoredJson(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : {};
};

const parsedArray = (value) => {
  if (Array.isArray(value)) return value;
  const parsed = parseStoredJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
};

function safeAdvisorProfile(value) {
  const profile = parsedObject(value);
  const facts = Array.isArray(profile.factEvidence)
    ? profile.factEvidence.slice(0, 16).map((item) => ({
      factKey: boundedText(item?.factKey, 80),
      source: boundedText(item?.source, 40),
    }))
    : [];
  const rooms = Array.isArray(profile.rooms)
    ? profile.rooms.slice(0, 12).map((room, index) => ({
      id: `report-room-${index + 1}`,
      name: `Room ${index + 1}`,
      roomType: boundedText(room?.roomType, 40),
      concerns: boundedStringList(room?.concerns, 7, 40),
      usePeriods: [],
    }))
    : [];
  const professionalReview = normalizeCustomerProfessionalReview(
    profile.professionalReview,
  );
  return {
    factEvidence: facts,
    rooms,
    permissionItems: [],
    ...(professionalReview ? { professionalReview } : {}),
  };
}

function professionalReviewProjection(value) {
  const review = normalizeCustomerProfessionalReview(value);
  if (!review) return null;
  const roleLabel = optionLabel(
    customerAdvisorOptions.professionalRoles,
    review.role,
    "Accredited adviser",
  );
  return {
    ...review,
    roleLabel,
    statement: `These home details were reviewed by ${review.adviserName}, who declares they are an ${roleLabel.toLowerCase()} under ${review.accreditationScheme}, reference ${review.accreditationReference}. Australian Energy Assessments has not independently verified the adviser identity, accreditation, reference or home observations.`,
    readinessBoundary: "These home answers are marked as reviewed by the self-declared accredited adviser named below. Australian Energy Assessments has not independently checked that review.",
    boundary: "This is a self-declared professional review, not an Australian Energy Assessments credential check, site assessment, NatHERS assessment or endorsement.",
  };
}

function safeGuideHref(value) {
  const href = boundedText(value, 180);
  return allowedGuideHrefs.has(href) ? href : "";
}

function safePlanResourceHref(value) {
  const href = boundedText(value, 260);
  return trustedPlanResourceHrefs.has(href) ? href : "";
}

function safePlanResources(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 20).flatMap((resource) => {
    const href = safePlanResourceHref(resource?.href);
    const label = boundedText(resource?.label, 160);
    const description = boundedText(resource?.description, 360);
    if (!href || !label || seen.has(href)) return [];
    seen.add(href);
    return [{ label, description, href }];
  }).slice(0, 12);
}

function safeActionLinks(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 6).flatMap((link) => {
    const suppliedHref = boundedText(link?.href, 260);
    const guideHref = safeGuideHref(suppliedHref);
    const resourceHref = safePlanResourceHref(suppliedHref);
    const href = guideHref || resourceHref;
    const label = boundedText(link?.label, 140);
    if (!href || !label || seen.has(href)) return [];
    seen.add(href);
    return [{ label, href }];
  }).slice(0, 3);
}

function safeGuidance(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return {
    basedOn: boundedStringList(source.basedOn, 6, 240),
    stillUncertain: boundedStringList(source.stillUncertain, 6, 240),
    reconsiderIf: boundedStringList(source.reconsiderIf, 6, 240),
  };
}

function professionalReportSentence(value) {
  let text = boundedText(value, 240)
    .replace(/^Roof type and condition has\b/i, "Roof type and condition have")
    .trim();
  if (!text) return "";
  if (!/[.!?]$/.test(text)) text = `${text}.`;
  return text;
}

const actionReportBlueprints = Object.freeze({
  permissions: Object.freeze({
    whyItMatters: "Written authority prevents a quote from being built around work that cannot be approved or installed.",
    confirmations: [
      "Confirm who owns each surface, service and external location affected by the work.",
      "Confirm any owners-corporation, strata, landlord or property-manager requirements in writing.",
    ],
    quoteChecklist: [
      "The exact approved work area and equipment location.",
      "Who obtains permits or approvals and which costs are included.",
      "Any make-good, access or common-property conditions.",
    ],
    sequence: "Secure written authority before paying a deposit, ordering equipment or booking fixed work.",
    safety: "Do not inspect roofs, electrical equipment, gas equipment or concealed services to answer an approval question.",
  }),
  electrical: Object.freeze({
    whyItMatters: "Electrical supply, switchboard condition and existing loads can change the safe scope, cost and order of electrification work.",
    confirmations: [
      "Have a licensed electrician confirm supply phases, service capacity, main switch, protective devices and available circuit capacity.",
      "Confirm the simultaneous loads expected from hot water, cooking, heating, cooling, solar, batteries and vehicle charging.",
    ],
    quoteChecklist: [
      "Switchboard and circuit work itemised separately from the appliance or system.",
      "Protection, isolation, metering, network and testing requirements.",
      "Allowances, exclusions and a compliance-certificate handover.",
    ],
    sequence: "Confirm capacity before equipment is selected so enabling work is priced once and coordinated across later upgrades.",
    safety: "Use a safe front-on photo only. Never remove the switchboard cover or touch internal electrical parts.",
  }),
  fabric: Object.freeze({
    whyItMatters: "Reducing uncontrolled heat flow first can improve comfort and avoid oversizing later heating or cooling equipment.",
    confirmations: [
      "Confirm the actual construction, existing insulation or seals, condition, moisture risks and safe access.",
      "Distinguish unwanted leakage from required ventilation, flues, chimneys and active exhaust paths.",
    ],
    quoteChecklist: [
      "Areas, quantities, product performance and installation method.",
      "Electrical, moisture, fire, ventilation and clearance checks.",
      "Access, removal, disposal, make-good, warranty and completion evidence.",
    ],
    sequence: "Investigate moisture and ventilation first, then seal uncontrolled gaps and improve insulation before final equipment sizing.",
    safety: "Do not enter a roof or subfloor, disturb insulation, seal a flue or block a fixed vent unless a suitably qualified person confirms it is safe.",
  }),
  windows: Object.freeze({
    whyItMatters: "Window orientation, shade, air leakage and coverings can determine whether a low-cost improvement is enough before glazing replacement.",
    confirmations: [
      "Record the most uncomfortable windows, orientation, direct-sun period, glazing, frame condition, leakage and current coverings.",
      "Confirm external-shade permissions, drainage, access and wind exposure.",
    ],
    quoteChecklist: [
      "Each window and opening identified on the scope.",
      "Frame, glazing, seals, coverings or shade performance and finish.",
      "Access, removal, make-good, warranty and any approval responsibilities.",
    ],
    sequence: "Start with operation, seals, close-fitting coverings and suitable shade; replace glazing only where evidence supports the extra cost.",
    safety: "Do not work at height or alter external fixtures, balustrades, fire egress or common property without the required competent advice and approval.",
  }),
  heating: Object.freeze({
    whyItMatters: "The building shell, occupied rooms and existing equipment determine the capacity and zoning that will actually improve comfort.",
    confirmations: [
      "Confirm rooms served, operating condition, controls, filters, outdoor-unit location and the remaining comfort gap.",
      "Obtain room-by-room or zone sizing after relevant draught, insulation and window work is understood.",
    ],
    quoteChecklist: [
      "Model, rated capacity, efficiency basis and rooms or zones served.",
      "Electrical, drainage, refrigerant, condensate, pipework and outdoor-unit work.",
      "Commissioning, controls demonstration, warranty and disposal of replaced equipment.",
    ],
    sequence: "Use and maintain sound existing equipment, improve the shell, then size only the remaining heating and cooling need.",
    safety: "Refrigerant, fixed electrical and gas work must be completed by appropriately licensed people. Preserve required combustion ventilation until gas equipment is safely removed.",
  }),
  hotWater: Object.freeze({
    whyItMatters: "Household demand, system location, tariffs and enabling work can change the right hot-water capacity and operating cost.",
    confirmations: [
      "Confirm the existing system type, capacity, age, location, household demand and available installation space.",
      "Confirm electrical capacity, plumbing, drainage, condensate, noise, clearances and any tariff or timer requirements.",
    ],
    quoteChecklist: [
      "Exact model, storage or delivery capacity and recovery or backup operation.",
      "Electrical, plumbing, valves, drainage, condensate, base and noise treatment.",
      "Decommissioning, disposal, commissioning, warranty and rebate documentation.",
    ],
    sequence: "Research the replacement before failure, confirm demand and site constraints, then compare eligible systems and written installed prices.",
    safety: "Keep storage water at safe temperatures and use licensed plumbing and electrical trades. Do not alter temperature controls, valves or gas connections without competent advice.",
  }),
  cooking: Object.freeze({
    whyItMatters: "Cookware, bench dimensions, ventilation and circuit capacity can add enabling work that is easy to miss in an appliance-only quote.",
    confirmations: [
      "Confirm appliance dimensions, cookware compatibility, circuit capacity, isolation and effective kitchen exhaust.",
      "Confirm safe gas disconnection and any bench or cabinetry alterations.",
    ],
    quoteChecklist: [
      "Appliance, circuit, isolation and switchboard work separately itemised.",
      "Bench, cabinetry, ventilation and gas-disconnection scope.",
      "Testing, demonstration, warranty and make-good.",
    ],
    sequence: "Confirm the electrical and physical fit before purchasing the appliance or removing the existing cooker.",
    safety: "Fixed electrical and gas disconnection work requires appropriately licensed trades. Keep effective ventilation for the equipment still in use.",
  }),
  solar: Object.freeze({
    whyItMatters: "Roof condition, shade, electricity use, network limits and switchboard capacity determine whether a solar system is suitable and well sized.",
    confirmations: [
      "Confirm roof covering, form, condition, orientation, shade, usable area and safe access.",
      "Review interval electricity use, existing generation, switchboard capacity and current network connection rules.",
    ],
    quoteChecklist: [
      "Panel, inverter and mounting models, layout and proposed annual generation basis.",
      "Roof, switchboard, metering, network application, monitoring and export-limit work.",
      "Warranties, commissioning evidence, emergency information and rebate or certificate treatment.",
    ],
    sequence: "Reduce avoidable demand, understand future electric loads, verify the roof and network boundary, then size solar to the household plan.",
    safety: "Roof access and all electrical work require competent people. Do not rely on aerial imagery or a self-report as proof of roof condition or structural suitability.",
  }),
  battery: Object.freeze({
    whyItMatters: "A battery's usable capacity, power, operating mode and tariff interaction determine what it can actually save or support.",
    confirmations: [
      "Confirm the purpose: bill shifting, solar self-use, backup, resilience or another priority.",
      "Review interval use, solar generation, critical loads, installation location, switchboard capacity and network rules.",
    ],
    quoteChecklist: [
      "Usable capacity, continuous and peak power, reserve setting and backup circuits.",
      "Compatible inverter, switchboard, gateway, monitoring, network and location work.",
      "Operating warranty, throughput terms, commissioning and emergency information.",
    ],
    sequence: "Define the outcome and analyse usage first; coordinate the battery with solar, tariffs, future loads and any backup requirement.",
    safety: "Battery location, clearances, fire response and electrical installation must meet current requirements and manufacturer instructions.",
  }),
  ev: Object.freeze({
    whyItMatters: "Vehicle use, charging speed, tariffs and household peak load determine the circuit and control strategy needed.",
    confirmations: [
      "Confirm vehicle and charger compatibility, daily distance, parking location and realistic charging window.",
      "Have a licensed electrician confirm circuit, switchboard, supply capacity, cable route and load-management options.",
    ],
    quoteChecklist: [
      "Charger model, power, cable, mounting and vehicle compatibility.",
      "Dedicated circuit, protection, load management, metering and network requirements.",
      "Commissioning, app or access setup, warranty and make-good.",
    ],
    sequence: "Set the charging need first, then coordinate electrical capacity, tariff timing, solar and other planned electric loads.",
    safety: "Use a compliant fixed installation by a licensed electrician. Do not use extension leads or an unsuitable general-purpose outlet for routine vehicle charging.",
  }),
  assessment: Object.freeze({
    whyItMatters: "A site-specific assessment can replace assumptions with measured or observed evidence before larger spending decisions.",
    confirmations: [
      "Define the decisions the assessment must support and the rooms or systems causing concern.",
      "Gather bills, safe photos, plans, past invoices and known approval constraints without entering unsafe areas.",
    ],
    quoteChecklist: [
      "Assessment scope, site time, methods, deliverables and exclusions.",
      "Whether thermal performance, appliances, bills, comfort, moisture and upgrade sequencing are included.",
      "Report format, follow-up discussion, credentials and total fee.",
    ],
    sequence: "Use an assessment before coordinating multiple high-cost measures or when the source of discomfort, moisture or high use is unclear.",
    safety: "This self-reported plan is not a NatHERS rating. A formal rating or inspection must follow the applicable current method and safe-access requirements.",
  }),
  bills: Object.freeze({
    whyItMatters: "Supply charges, usage rates, discounts, tariff structures and solar credits can change household costs without changing any equipment.",
    confirmations: [
      "Use a recent bill or current-plan summary to confirm usage, supply charges, tariff type, discounts, expiry dates and solar feed-in terms.",
      "Compare electricity and gas separately, using the correct postcode and the household's actual usage where available.",
    ],
    quoteChecklist: [
      "Estimated annual cost and every usage, supply and controlled-load rate used.",
      "Discount conditions, benefit periods, fees, solar credits and contract terms.",
      "The comparison date, usage period and assumptions so the result can be checked later.",
    ],
    sequence: "Compare the current plan first, then review the full terms before switching. Recheck after major electrification, solar or usage changes.",
    safety: "Use a trusted comparison path. Never share an account password, one-time code or unnecessary identity document to compare plans.",
  }),
  incentives: Object.freeze({
    whyItMatters: "Rebates and certificates can materially change an installed price, but eligibility depends on the current rules, product, property, installer and timing.",
    confirmations: [
      "Confirm the exact activity, product model, installation address, date and customer pathway against current official program rules.",
      "Confirm whether the written price already includes any rebate, certificate value, finance cost or provider fee.",
    ],
    quoteChecklist: [
      "The incentive, certificate quantity or rebate amount shown separately from the installed price.",
      "Eligibility assumptions, required evidence, claim responsibility and what happens if the claim is rejected.",
      "All fees, finance terms, customer contributions and cancellation conditions in writing.",
    ],
    sequence: "Check current assistance and estimate value before accepting a quote, then verify final eligibility before equipment is ordered or work begins.",
    safety: "Treat every estimate as indicative until the official pathway is confirmed. Do not sign blank forms or provide access credentials to claim an incentive.",
  }),
  climate: Object.freeze({
    whyItMatters: "A broad postcode profile helps order early planning, but the home's orientation, shade, construction, moisture and local exposure determine the final scope.",
    confirmations: [
      "Confirm room orientation, seasonal sun, shade, wind exposure, moisture signs and the locations that are actually uncomfortable.",
      "Use a site-specific assessment when formal ratings, equipment sizing or unresolved comfort and moisture problems affect a major decision.",
    ],
    quoteChecklist: [
      "The observed site conditions and household priorities used to develop the scope.",
      "Any measurements, modelling method, assumptions and limitations clearly stated.",
      "The recommended sequence separated from optional work and product choices.",
    ],
    sequence: "Use the broad climate profile to plan investigations, then replace assumptions with site evidence before final sizing or high-cost work.",
    safety: "This self-reported postcode profile is not a climate zone determination, NatHERS assessment, home energy rating or equipment-sizing result.",
  }),
  budget: Object.freeze({
    whyItMatters: "A staged budget works best when enabling work and the highest-value constraint are identified before products are selected.",
    confirmations: [
      "Confirm the first problem to solve, the spending range for this stage and which later upgrades must remain possible.",
      "Separate essential enabling work from optional finishes, future-ready allowances and product upgrades.",
    ],
    quoteChecklist: [
      "Itemised base scope, enabling work, options, exclusions and contingency assumptions.",
      "Expected service life, warranty, maintenance and any work deferred to a later stage.",
      "Current rebates or certificate value shown separately and never treated as guaranteed savings.",
    ],
    sequence: "Resolve safety and enabling constraints first, then fund the measure that best unlocks comfort, cost or later electrification goals.",
    safety: "Do not use an indicative rebate, market estimate or savings claim as the only basis for taking on finance or committing to work.",
  }),
  planning: Object.freeze({
    whyItMatters: "A clear scope keeps later quotes comparable and prevents one upgrade from making another harder or more expensive.",
    confirmations: [
      "Confirm the problem to solve, the rooms or services affected and the evidence already available.",
      "Confirm site condition, access, approvals, electrical capacity and the dependencies named in this step.",
    ],
    quoteChecklist: [
      "A written scope with inclusions, exclusions and assumptions.",
      "Enabling work, access, make-good, disposal and approvals.",
      "Product performance, commissioning, warranties and current incentive treatment.",
    ],
    sequence: "Complete evidence and safety checks first, then compare like-for-like written scopes before committing.",
    safety: "Stay within safe observation and existing records. Use appropriately qualified people for regulated work and uncertain building conditions.",
  }),
});

function reportActionFamily(item) {
  const haystack = `${item?.id || ""} ${item?.title || ""} ${item?.href || ""}`.toLowerCase();
  if (/authority|permission|renter|strata|owner/.test(haystack)) return "permissions";
  if (/energy[- ]?offer|electricity plan|gas plan|plans? (?:you )?already pay|retailer|tariff/.test(haystack)) return "bills";
  if (/rebate|certificate|finance|incentive/.test(haystack)) return "incentives";
  if (/climate|postcode|local conditions/.test(haystack)) return "climate";
  if (/budget|highest-value constraint|stage the work/.test(haystack)) return "budget";
  if (/window|glazing|shade/.test(haystack)) return "windows";
  if (/draught|insulation|fabric|moisture|ventilation/.test(haystack)) return "fabric";
  if (/heating|cooling|reverse-cycle|hydronic|wood-heating/.test(haystack)) return "heating";
  if (/hot-water|hot water/.test(haystack)) return "hotWater";
  if (/cooking|cooktop|induction/.test(haystack)) return "cooking";
  if (/\bev\b|vehicle|charging/.test(haystack)) return "ev";
  if (/battery|storage/.test(haystack)) return "battery";
  if (/solar/.test(haystack)) return "solar";
  if (/switchboard|electrical|supply|circuit/.test(haystack)) return "electrical";
  if (/assessment|assessor|rating/.test(haystack)) return "assessment";
  return "planning";
}

function safeSolutionOptions(value) {
  return (Array.isArray(value) ? value : [])
    .slice(0, 6)
    .flatMap((option) => {
      const source = option && typeof option === "object" && !Array.isArray(option)
        ? option
        : {};
      const label = boundedText(source.label, 80);
      const description = boundedSentenceText(source.description, 420);
      return label && description ? [{ label, description }] : [];
    });
}

function solutionOptionsForAction(item, family, existingFeatures = []) {
  const features = new Set(
    (Array.isArray(existingFeatures) ? existingFeatures : [])
      .map((value) => boundedText(value, 80))
      .filter(Boolean),
  );
  const itemText = `${item?.id || ""} ${item?.title || ""}`.toLowerCase();
  const hasFeature = (...values) => values.some((value) => features.has(value));
  const hasMoistureConcern = hasFeature("condensation-moisture");
  const hasEvaporativeOutlets = hasFeature(
    "evaporative-ducts",
    "evaporative-cooling",
  );
  const needsExternalShade = /shade|window covering/.test(itemText)
    || hasFeature("comfort-too-hot", "external-shading-none");

  if (/lighting/.test(itemText)) {
    return [
      {
        label: "Try now",
        description: "Use daylight and a task lamp where comfortable, and switch off lights in empty rooms.",
      },
      {
        label: "Better fix",
        description: "Replace the most-used old lamps with compatible quality LEDs first. Check dimmers, transformers and enclosed fittings before buying.",
      },
      {
        label: "Long-term upgrade",
        description: "When fittings need replacement, compare an efficient layout with suitable controls or sensors. Use a licensed electrician for fixed wiring.",
      },
    ];
  }
  if (/appliance|standby|fridge|freezer|laundry|dishwasher/.test(itemText)) {
    return [
      {
        label: "Try now",
        description: "Run full loads, use cold washes or economy cycles when suitable, line-dry where practical and turn off genuinely unused standby loads.",
      },
      {
        label: "Better fix",
        description: "Clean accessible filters, check fridge and freezer door seals and keep the ventilation clearances in the appliance instructions.",
      },
      {
        label: "Long-term upgrade",
        description: "Replace equipment when needed, not by default. Compare the government energy label, suitable size, running cost and repairability before buying.",
      },
    ];
  }
  if (/pool|spa/.test(itemText)) {
    return [
      {
        label: "Try now",
        description: "Use a suitable cover and review heating and pump schedules without reducing required filtration, sanitation or safety checks.",
      },
      {
        label: "Better fix",
        description: "Have water balance, filters, pipework and pump settings checked so the existing system runs only as long as safely required.",
      },
      {
        label: "Long-term upgrade",
        description: "When equipment is due for replacement, compare a correctly sized efficient pump and, if heating is needed, suitable solar or heat-pump options.",
      },
    ];
  }
  if (family === "fabric" && /moisture|condensation|mould/.test(itemText)) {
    return [
      {
        label: "Try now",
        description: "Fix or report leaks, use working kitchen and bathroom exhaust fans, and wipe condensation. Briefly air the space only when outdoor humidity, smoke, weather and security make it suitable.",
      },
      {
        label: "Better fix",
        description: hasMoistureConcern
          ? "After moisture sources are controlled, use a suitable dehumidifier only if a humidity meter shows humidity stays high or condensation persists. It does not replace leak or ventilation repairs."
          : "Repair ineffective exhaust fans, ducting, leaks or drainage first. Check that wet areas clear after use before making the home more airtight.",
      },
      {
        label: "Long-term upgrade",
        description: hasEvaporativeOutlets
          ? "Have persistent damp, cold surfaces and ventilation checked. In winter, close or cover evaporative outlets only with a system-suitable, manufacturer-approved method, keep required combustion ventilation clear, and reopen every outlet before use."
          : "Have persistent damp, cold surfaces and ventilation checked so the moisture source, insulation and any mechanical ventilation are treated as one problem.",
      },
    ];
  }
  if (family === "fabric" && /draught|air leakage|seal/.test(itemText)) {
    return [
      {
        label: "Try now",
        description: "Use a door snake at a confirmed unwanted door gap. This suits renters and is easy to remove, but it must not cover a fixed vent, flue, chimney, exhaust path or fire exit.",
      },
      {
        label: "Better fix",
        description: "Adjust a loose latch, replace worn weather strip, or use flexible caulk on a confirmed stationary crack. Ask for permission before attaching anything in a rental or on shared property.",
      },
      {
        label: "Long-term upgrade",
        description: "Have a trade fit a mechanical or drop seal, threshold or frame repair. Replace a badly warped opening only when repair cannot solve it, with egress and weatherproofing checked.",
      },
    ];
  }
  if (family === "fabric" && /insulation|building shell|fabric/.test(itemText)) {
    return [
      {
        label: "Try now",
        description: "Use plans, invoices, an earlier assessment or a safe visual check to identify what is already installed. Do not enter a roof or subfloor just to answer this question.",
      },
      {
        label: "Better fix",
        description: "Ask a qualified installer to correct confirmed gaps, compression or displaced insulation while preserving electrical, moisture, fire and ventilation clearances.",
      },
      {
        label: "Long-term upgrade",
        description: "Add or replace suitable insulation after construction, access, moisture and R-value checks. Coordinate it when roofing, linings or floors are already being opened.",
      },
    ];
  }
  if (family === "windows") {
    if (needsExternalShade) {
      return [
        {
          label: "Try now",
          description: "Close suitable coverings before unwanted summer sun reaches the glass, and open them for useful winter sun. A safe removable shade can test the problem area first.",
        },
        {
          label: "Better fix",
          description: "Compare an awning, external blind or deciduous planting that shades summer sun but preserves useful winter sun. Check permission, mature roots, drainage, services, wind and bushfire clearances.",
        },
        {
          label: "Long-term upgrade",
          description: "Coordinate durable external shade with window seals, close-fitting internal coverings and glazing only where heat, glare or comfort evidence supports the extra work.",
        },
      ];
    }
    return [
      {
        label: "Try now",
        description: "For a suitable single-glazed window, compare removable bubble wrap or shrink film, or a cut-to-fit reflective shade. Bubble wrap suits little or no direct sun. Protect views, ventilation and egress; check permission, condensation and surface fit.",
      },
      {
        label: "Better fix",
        description: "Compare compatible low-e or solar-control film with a fitted clear acrylic secondary panel. A magnetic panel may stay removable. Check winter sun, glass-breakage risk, seals, warranty, views, condensation, cleaning and egress.",
      },
      {
        label: "Long-term upgrade",
        description: "Compare durable secondary glazing with full double glazing in a suitable, preferably thermally improved frame. Include opening operation, seals, drainage, shade, ventilation, egress, approvals and make-good.",
      },
    ];
  }
  if (family === "heating" && features.has("gas-heating")) {
    return [
      {
        label: "Try now",
        description: "Maintain the existing gas system and required ventilation while planning. Improve controls, draughts, insulation and the most uncomfortable occupied rooms first.",
      },
      {
        label: "Better fix",
        description: "Compare a correctly sized efficient reverse-cycle air conditioner for the main occupied zone. This can be staged without promising that one unit will suit the whole home.",
      },
      {
        label: "Long-term upgrade",
        description: "Compare a zoned electric design after room loads are understood. Price circuits, outdoor units, condensate, controls, gas disconnection and make-good before removing working equipment.",
      },
    ];
  }
  if (
    family === "heating"
    && hasEvaporativeOutlets
    && (
      /evaporative/.test(itemText)
      || !hasFeature(
        "reverse-cycle",
        "gas-heating",
        "hydronic-heating",
        "wood-heating",
        "electric-resistance-heating",
      )
    )
  ) {
    return [
      {
        label: "Try now",
        description: "Use fans or evaporative cooling only when outdoor heat, humidity, smoke and the system instructions make them suitable. Clean accessible filters as directed.",
      },
      {
        label: "Better fix",
        description: "Service worn controls, pads, ducts or seals. Weatherise ceiling outlets in winter only with a suitable approved cover or damper, and reopen them before cooling.",
      },
      {
        label: "Long-term upgrade",
        description: "If comfort is still poor, compare a right-sized efficient reverse-cycle system after shade, insulation, draughts, electrical capacity and room needs are understood.",
      },
    ];
  }
  if (family === "heating") {
    return [
      {
        label: "Try now",
        description: "Heat or cool occupied rooms first, use timers and zoning already fitted, clean accessible filters as directed and use fans when they improve comfort.",
      },
      {
        label: "Better fix",
        description: "Service faults and improve confirmed draughts, insulation, shade and window coverings before deciding the capacity of new equipment.",
      },
      {
        label: "Long-term upgrade",
        description: "Compare a right-sized efficient reverse-cycle design for the rooms used, including zoning, circuits, outdoor units, condensate, controls and commissioning.",
      },
    ];
  }
  if (family === "hotWater" && [...features].some((feature) => [
    "gas-storage-hot-water",
    "gas-continuous-flow-hot-water",
    "gas-hot-water-type-unknown",
    "electric-gas-boosted-hot-water",
  ].includes(feature))) {
    return [
      {
        label: "Try now",
        description: "Record the existing unit, household demand and a possible tank location now so an emergency failure does not force a rushed like-for-like gas replacement.",
      },
      {
        label: "Better fix",
        description: "Compare a right-sized heat-pump hot-water system, including its climate suitability, noise, condensate, recovery, backup operation, timer or tariff and available space.",
      },
      {
        label: "Long-term upgrade",
        description: "Scope plumbing, drainage, electrical supply, commissioning and gas disconnection. If a heat-pump location is unsuitable, compare correctly sized electric storage and tariff implications.",
      },
    ];
  }
  if (family === "hotWater") {
    return [
      {
        label: "Try now",
        description: "Take shorter showers where suitable, use cold laundry cycles and run full loads. Do not lower storage temperature or disable safety cycles.",
      },
      {
        label: "Better fix",
        description: "Repair leaks, compare a compatible water-efficient showerhead and use only supported timers or tariff controls.",
      },
      {
        label: "Long-term upgrade",
        description: "Before failure, compare a right-sized heat-pump or other efficient electric system with space, noise, recovery, plumbing, electrical and tariff needs confirmed.",
      },
    ];
  }
  if (family === "cooking" && (
    features.has("gas-cooking") || features.has("mixed-cooking")
  )) {
    return [
      {
        label: "Try now",
        description: "A suitable portable single-zone induction cooker can test compatible cookware and cooking preferences on an outlet confirmed suitable for the appliance. Keep safe ventilation and follow its instructions.",
      },
      {
        label: "Better fix",
        description: "Compare an induction cooktop and efficient electric oven sized for the household, with the required circuit, isolation, ventilation and bench clearances confirmed before purchase.",
      },
      {
        label: "Long-term upgrade",
        description: "Where needed, include switchboard work, a new circuit, bench or cabinetry changes, safe gas disconnection, removal, testing and make-good in one written scope.",
      },
    ];
  }
  if (family === "cooking") {
    return [
      {
        label: "Try now",
        description: "Use lids, match cookware to the cooking zone and heat only the water or oven space needed. Keep effective kitchen exhaust working.",
      },
      {
        label: "Better fix",
        description: "Maintain seals, controls and ventilation. Replace a failing small appliance with a suitable efficient size rather than heating more space than needed.",
      },
      {
        label: "Long-term upgrade",
        description: "When fixed cooking equipment is due, compare induction and an efficient electric oven after cookware, circuit, isolation, ventilation and bench fit are confirmed.",
      },
    ];
  }
  if (family === "electrical") {
    return [
      {
        label: "Try now",
        description: "List the large electrical loads already used and planned. Take only a safe front-on switchboard photo without removing a cover.",
      },
      {
        label: "Better fix",
        description: "Have a licensed electrician confirm supply, protection and spare circuit capacity before equipment is purchased.",
      },
      {
        label: "Long-term upgrade",
        description: "Coordinate any switchboard or supply work once across hot water, cooking, heating, solar, battery and vehicle charging plans.",
      },
    ];
  }
  if (family === "solar") {
    return [
      {
        label: "Try now",
        description: features.has("solar")
          ? "Use supported timers to move flexible loads into safe solar hours, then check the monitoring data before changing the system."
          : "Collect interval use, note daytime loads and future electric appliances, and observe roof shade safely from ground level.",
      },
      {
        label: "Better fix",
        description: "Have roof condition, usable area, shade, switchboard, metering, network limits and the proposed layout checked before comparing quotes.",
      },
      {
        label: "Long-term upgrade",
        description: "Size solar around verified use and planned electrification, then require the final layout, equipment, monitoring, warranties and network work in writing.",
      },
    ];
  }
  if (family === "battery") {
    return [
      {
        label: "Try now",
        description: "Choose the main goal first: solar self-use, bill shifting, backup or resilience. Review interval use and tariff details before choosing a size.",
      },
      {
        label: "Better fix",
        description: "Compare usable capacity, continuous and peak power, reserve settings, compatible equipment, location, monitoring and operating warranty.",
      },
      {
        label: "Long-term upgrade",
        description: "Install only after solar, future electric loads, backup circuits, network rules, switchboard work, clearances and emergency information are coordinated.",
      },
    ];
  }
  if (family === "ev") {
    return [
      {
        label: "Try now",
        description: "Set the daily distance and charging window. Use only the vehicle maker's supported lead and a suitable outlet, never an extension lead for routine charging.",
      },
      {
        label: "Better fix",
        description: "Have a licensed electrician check the parking location, cable route, circuit, protection, supply capacity and load-management options.",
      },
      {
        label: "Long-term upgrade",
        description: "Coordinate a compliant fixed charger with solar, tariffs, hot water, heating, battery plans and other household peak loads.",
      },
    ];
  }
  if (family === "assessment") {
    return [
      {
        label: "Try now",
        description: "List the rooms and decisions that matter, then gather bills, plans, invoices and safe photos already available.",
      },
      {
        label: "Better fix",
        description: "Ask for a targeted review of the unresolved comfort, moisture, equipment or sequencing question before requesting product quotes.",
      },
      {
        label: "Long-term upgrade",
        description: "Use a site-specific assessment when several major measures interact or when formal ratings, sizing or persistent building problems affect the decision.",
      },
    ];
  }
  return [];
}

function practicalEverydayActionDescription(item, existingFeatures = []) {
  const features = new Set(
    (Array.isArray(existingFeatures) ? existingFeatures : [])
      .map((value) => boundedText(value, 80))
      .filter(Boolean),
  );
  const id = boundedText(item?.id, 80);
  const source = boundedSentenceText(item?.text, 900);
  if (id === "moisture-safe-routine") {
    const measuredHumidity = features.has("condensation-moisture")
      ? " If a humidity meter shows humidity remains high, or condensation persists after the source is controlled, a suitable dehumidifier can help dry the affected room. It is not a substitute for fixing leaks, drainage or ineffective ventilation."
      : "";
    return boundedSentenceText(
      "Fix or report leaks and use working exhaust fans while cooking, showering or doing laundry. Briefly open suitable opposite windows or doors only when outdoor humidity, smoke, weather and security make it safe, then close them when conditions become less helpful."
        + measuredHumidity
        + " Keep fixed vents, flues, chimneys and required exhaust paths clear.",
      900,
    );
  }
  if (
    id === "use-existing-controls"
    && (features.has("evaporative-ducts") || features.has("evaporative-cooling"))
  ) {
    return boundedSentenceText(
      `${source} In winter, close built-in dampers or fit only manufacturer-approved, system-suitable outlet covers. Confirm the opening is not required combustion ventilation, and remove covers or reopen every outlet before cooling is used.`,
      900,
    );
  }
  return source;
}

function electrificationMovesForFeatures(existingFeatures = []) {
  const features = new Set(
    (Array.isArray(existingFeatures) ? existingFeatures : [])
      .map((value) => boundedText(value, 80))
      .filter(Boolean),
  );
  const moves = [];
  if (features.has("gas-heating")) {
    moves.push({
      id: "gas-heating-to-reverse-cycle",
      title: "Gas heating: compare a staged reverse-cycle replacement",
      summary: "A correctly sized efficient reverse-cycle air conditioner is the usual electric alternative to compare. A lower-cost first stage can serve the main occupied zone; a later whole-home design can add zones after draughts, insulation and windows are understood.",
      checkFirst: "Keep the current system and required ventilation safe until a licensed team confirms room loads, electrical capacity, equipment locations, condensate and gas disconnection.",
    });
  }
  if ([...features].some((feature) => [
    "gas-storage-hot-water",
    "gas-continuous-flow-hot-water",
    "gas-hot-water-type-unknown",
    "electric-gas-boosted-hot-water",
  ].includes(feature))) {
    moves.push({
      id: "gas-hot-water-to-heat-pump",
      title: "Gas hot water: plan a heat-pump hot-water option before failure",
      summary: "Compare a right-sized heat-pump hot-water system against the household's demand, climate, available space, noise and tariff. Planning early reduces the chance of a rushed like-for-like gas replacement after a breakdown.",
      checkFirst: "Have licensed trades confirm plumbing, drainage, condensate, electrical capacity, recovery and backup operation, safe gas disconnection, commissioning and current incentive eligibility.",
    });
  }
  if (features.has("gas-cooking") || features.has("mixed-cooking")) {
    moves.push({
      id: "gas-cooking-to-induction",
      title: "Gas cooking: try induction, then scope a permanent change",
      summary: "A suitable portable induction cooker can be a low-commitment trial. If it suits the household, compare a permanent induction cooktop and efficient electric oven rather than replacing gas with gas by default.",
      checkFirst: "Confirm cookware, circuit and switchboard capacity, isolation, ventilation, bench or cabinetry fit, safe gas disconnection and make-good before purchasing fixed equipment.",
    });
  }
  return moves.slice(0, 3);
}

function actionReportLinks(item, family) {
  const links = [];
  const guideHref = safeGuideHref(item?.href || item?.guideHref);
  if (guideHref) {
    links.push({
      label: boundedText(item?.action || item?.guideLabel, 120)
        || "Open the related Australian Energy Assessments guide",
      href: guideHref,
    });
  }
  if (["fabric", "windows", "heating", "hotWater", "cooking", "solar", "battery", "ev"].includes(family)) {
    links.push(
      { label: "Check current rebates and assistance", href: "/rebates" },
      { label: "Estimate eligible certificate or rebate value", href: "/calculator" },
    );
  }
  if (family === "assessment") {
    links.push({ label: "Prepare for an independent assessment", href: "/assessments" });
  }
  if (family === "bills") {
    links.push(
      { label: "Compare electricity plans", href: "/compare" },
      { label: "Compare gas plans", href: "/gas-compare" },
    );
  }
  if (["incentives", "budget"].includes(family)) {
    links.push(
      { label: "Check current rebates and assistance", href: "/rebates" },
      { label: "Estimate certificate or rebate value", href: "/calculator" },
    );
  }
  if (family === "climate") {
    links.push({
      label: "Read the July 2026 NatHERS Existing Homes Guidance Note",
      href: "https://www.homeenergyrating.gov.au/resources/existing-homes-guidance-note",
    });
  }
  return links.slice(0, 3);
}

function enrichedReportAction(item, index, completedIds, existingFeatures = []) {
  const safeItem = privacySafeControlledItem(item);
  const family = reportActionFamily(safeItem);
  const blueprint = actionReportBlueprints[family] || actionReportBlueprints.planning;
  const guidance = safeGuidance(safeItem.guidance);
  const householdReason = guidance.basedOn.length
    ? guidance.basedOn.map(professionalReportSentence).filter(Boolean).join(" ")
    : "This step is included because it supports the goals and home context recorded in this plan.";
  const confirmations = uniqueReportText([
    ...guidance.stillUncertain,
    ...blueprint.confirmations,
  ], 4);
  return {
    number: index + 1,
    id: boundedText(safeItem.id, 80),
    stage: boundedText(safeItem.stage, 100),
    title: boundedText(safeItem.title, 180),
    description: boundedSentenceText(safeItem.text, 900),
    whatToDo: boundedSentenceText(safeItem.text, 600),
    whyItMatters: boundedSentenceText(blueprint.whyItMatters, 360),
    householdReason: boundedSentenceText(householdReason, 420),
    confirmBeforeWork: confirmations,
    quoteChecklist: boundedStringList(blueprint.quoteChecklist, 3, 220),
    sequence: boundedSentenceText(
      [blueprint.sequence, ...guidance.reconsiderIf].filter(Boolean).join(" "),
      420,
    ),
    safety: boundedSentenceText(blueprint.safety, 360),
    solutionOptions: solutionOptionsForAction(
      safeItem,
      family,
      existingFeatures,
    ),
    completed: completedIds.has(safeItem.id),
    guideLabel: safeGuideHref(safeItem.href)
      ? boundedText(safeItem.action, 120)
      : "",
    guideHref: safeGuideHref(safeItem.href),
    links: actionReportLinks(safeItem, family),
    guidance,
  };
}

function privacySafeControlledItem(item) {
  if (item?.id !== "room-comfort-profile") return item;
  const sourceTitle = boundedText(item.title, 180).toLowerCase();
  if (sourceTitle.includes("daytime heat")) {
    return {
      ...item,
      title: "Prioritise unwanted heat and sun in the most affected rooms",
      text: "The private room profile indicates that solar exposure and heat should come first. Check direct sun, external shade, glazing exposure and safe air movement before adding cooling capacity.",
    };
  }
  if (sourceTitle.includes("overnight heat")) {
    return {
      ...item,
      title: "Prioritise heat retention in the most affected rooms",
      text: "The private room profile indicates that cold conditions should come first. Check safe draught control, insulation and close-fitting window coverings before adding heating capacity.",
    };
  }
  if (sourceTitle.includes("moisture")) {
    return {
      ...item,
      title: "Resolve moisture and ventilation questions before sealing",
      text: "The private room profile indicates that moisture or ventilation questions should come first. Identify moisture sources and required ventilation before making the building shell more airtight.",
    };
  }
  return {
    ...item,
    title: "Use controlled room comfort evidence",
    text: "The private room profile has been used to order this step without including room names or routine details. Address the leading comfort concern before sizing whole-home equipment.",
  };
}

function orderedControlledItems(generatedItems, snapshotItems) {
  const canonical = new Map(generatedItems.map((item) => [item.id, item]));
  if (!Array.isArray(snapshotItems)) return generatedItems;
  const ordered = [];
  const seen = new Set();
  for (const supplied of snapshotItems.slice(0, 40)) {
    const id = boundedText(supplied?.id, 80);
    const item = canonical.get(id);
    if (!item || seen.has(id)) continue;
    ordered.push(item);
    seen.add(id);
  }
  return ordered;
}

function countPrivateItems(profile, snapshotItems) {
  const count = (value, maximum) => (
    Array.isArray(value) ? Math.min(value.length, maximum) : 0
  );
  return {
    customPlanItems: Array.isArray(snapshotItems)
      ? snapshotItems.slice(0, 40).filter((item) => {
        const id = boundedText(item?.id, 80);
        return id.startsWith("custom:") || id.startsWith("custom-");
      }).length
      : 0,
    roomRecords: count(profile.rooms, 12),
    permissionNotes: count(profile.permissionItems, 30),
    reviewItems: count(profile.reviewItems, 20),
  };
}

function evidenceSummary(profile) {
  const allowedFactKeys = new Set(
    customerAdvisorOptions.factKeys.map(([factKey]) => factKey),
  );
  const sources = new Map(
    [...allowedFactKeys].map((factKey) => [factKey, "unknown"]),
  );
  for (const item of Array.isArray(profile.factEvidence) ? profile.factEvidence : []) {
    const key = boundedText(item?.factKey, 80);
    const source = evidenceSourceLabels.has(item?.source) ? item.source : "unknown";
    if (allowedFactKeys.has(key)) sources.set(key, source);
  }
  const total = allowedFactKeys.size;
  const known = [...sources.values()].filter((source) => source !== "unknown").length;
  const bySource = [...evidenceSourceLabels.entries()].map(([source, label]) => ({
    source,
    label,
    count: [...sources.values()].filter((value) => value === source).length,
  }));
  return { total, known, unknown: Math.max(0, total - known), bySource };
}

function linkedFactEvidenceSummary(evidence, allowedFactKeys) {
  const linkedFacts = new Set();
  for (const row of Array.isArray(evidence) ? evidence.slice(0, 100) : []) {
    const scope = boundedText(row?.sharing_scope, 40);
    if (scope !== "private-plan" && scope !== "allocated-installers") continue;
    for (const factKey of parsedArray(row?.fact_keys).slice(0, 16)) {
      const key = boundedText(factKey, 80);
      if (key && (!allowedFactKeys || allowedFactKeys.has(key))) {
        linkedFacts.add(key);
      }
    }
  }
  return { linkedFacts: linkedFacts.size };
}

export function createCustomerPlanReadiness(existingFeatures, evidence = []) {
  const selected = new Set(normalizeHomeFeatureSelections(existingFeatures));
  const questions = customerHomeFeatureSections
    .flatMap((section) => section.questions);
  let answered = 0;
  let notSure = 0;
  const missingLabels = [];
  for (const question of questions) {
    const selectedValues = question.options
      .map(([value]) => value)
      .filter((value) => selected.has(value));
    if (!selectedValues.length) {
      if (missingLabels.length < 3) missingLabels.push(question.label);
      continue;
    }
    if (
      question.unknownValue
      && selectedValues.includes(question.unknownValue)
    ) {
      notSure += 1;
    } else {
      answered += 1;
    }
  }
  const linked = linkedFactEvidenceSummary(
    evidence,
    readinessFactKeys,
  ).linkedFacts;
  const missing = Math.max(0, questions.length - answered - notSure);
  const statusParts = [
    answered
      ? `${answered} home-detail answer${answered === 1 ? "" : "s"} recorded`
      : "No confirmed home-detail answers recorded yet",
    notSure
      ? `${notSure} marked Not sure`
      : "",
    missing
      ? `${missing} still to answer`
      : "All questions addressed",
    linked
      ? `Supporting evidence linked to ${linked} home detail${linked === 1 ? "" : "s"}`
      : "",
  ].filter(Boolean);
  return {
    answered,
    total: questions.length,
    notSure,
    linked,
    missing,
    missingLabels,
    message: `${statusParts.join(". ")}.`,
    boundary: "These details were supplied by the household and have not been professionally checked.",
  };
}

/**
 * @param {any} row
 * @param {{preparedAt?: string, evidence?: Array<Record<string, unknown>>}} [options]
 */
export function createCustomerPlanDocument(
  row,
  {
    preparedAt = new Date().toISOString(),
    evidence = [],
  } = {},
) {
  const goals = parsedArray(row.goals);
  const existingFeatures = parsedArray(row.existing_features);
  const serviceCategories = parsedArray(row.service_categories);
  const propertyContext = parsedObject(row.property_context);
  const sourceAdvisorProfile = parsedObject(row.advisor_profile);
  const advisorProfile = safeAdvisorProfile(sourceAdvisorProfile);
  const professionalReview = professionalReviewProjection(
    advisorProfile.professionalReview,
  );
  const baseReadiness = createCustomerPlanReadiness(existingFeatures, evidence);
  const readiness = professionalReview
    ? { ...baseReadiness, boundary: professionalReview.readinessBoundary }
    : baseReadiness;
  const planningAdvisorProfile = normalizeCustomerAdvisorProfile(
    sourceAdvisorProfile,
    {
      postcode: boundedText(row.postcode, 4),
      addressState: boundedText(row.address_state, 4),
      householdSituation: boundedText(row.household_situation, 40),
      approvalContext: boundedText(propertyContext.approvalContext, 40),
      propertyContext,
    },
  );
  const storedSnapshot = parsedObject(row.plan_snapshot);
  const completedIds = new Set(
    parsedArray(row.completed_plan_items)
      .map((value) => boundedText(value, 80))
      .filter(Boolean),
  );
  const generatedPlan = createCustomerProjectPlan({
    goals: goals.length ? goals : [boundedText(row.goal, 80)].filter(Boolean),
    pace: boundedText(row.pace, 40),
    situation: boundedText(row.household_situation, 40),
    approvalContext: boundedText(propertyContext.approvalContext, 40),
    features: existingFeatures,
    serviceCategories,
    propertyContext,
    budgetRange: boundedText(row.budget_range, 40),
    postcode: boundedText(row.postcode, 4),
    addressState: boundedText(row.address_state, 4),
    advisorProfile: planningAdvisorProfile,
  });
  const snapshotItems = Array.isArray(storedSnapshot.items)
    ? storedSnapshot.items
    : null;
  const controlledItems = orderedControlledItems(
    Array.isArray(generatedPlan.items) ? generatedPlan.items : [],
    snapshotItems,
  );
  const climate = derivePlanningClimateProfile(row.postcode, row.address_state);
  const permissionPack = createCustomerPermissionPack(advisorProfile, {
    householdSituation: boundedText(row.household_situation, 40),
    approvalContext: boundedText(propertyContext.approvalContext, 40),
    planItems: controlledItems,
  });
  const actions = controlledItems.map((item, index) =>
    enrichedReportAction(item, index, completedIds, existingFeatures)
  );
  const goalLabels = goals
    .map((goal) => optionLabel(customerProjectOptions.goals, goal))
    .filter(Boolean)
    .slice(0, 10);
  const everydayActions = Array.isArray(generatedPlan.everydayActions)
    ? generatedPlan.everydayActions
      .filter((item) => allowedEverydayActionIds.has(item?.id))
      .slice(0, 6)
      .map((item) => ({
        id: boundedText(item.id, 80),
        category: boundedText(item.category, 100),
        title: boundedText(item.title, 180),
        description: practicalEverydayActionDescription(
          item,
          existingFeatures,
        ),
        outcome: everydayActionOutcomeById.get(item.id) || "A practical low-cost action that can be tried before fixed work.",
      }))
    : [];
  return {
    version: CUSTOMER_PLAN_DOCUMENT_VERSION,
    heading: "Your independent home energy plan",
    planTitle: boundedText(generatedPlan.title, 180)
      || "An evidence-led home energy plan",
    summary: boundedText(generatedPlan.summary, 480),
    preparedDate: String(preparedAt).slice(0, 10),
    overview: {
      goals: goalLabels,
      propertyType: optionLabel(
        customerProjectOptions.propertyTypes,
        row.property_type,
        "Home",
      ),
      tenure: optionLabel(
        customerProjectOptions.situations,
        row.household_situation,
        "Not recorded",
      ),
      approval: optionLabel(
        customerProjectOptions.approvalContexts,
        propertyContext.approvalContext,
        "No additional approval context recorded",
      ),
      pace: optionLabel(
        customerProjectOptions.paces,
        row.pace,
        "Staged improvements",
      ),
      budget: optionLabel(
        customerProjectOptions.budgets,
        row.budget_range,
        "Prefer not to set a budget",
      ),
      state: customerProjectOptions.states.includes(row.address_state)
        ? row.address_state
        : "Not recorded",
      homeFacts: {
        storeys: optionLabel(
          customerProjectOptions.storeys,
          propertyContext.storeys,
          "Not sure",
        ),
        ageBand: optionLabel(
          customerProjectOptions.ageBands,
          propertyContext.ageBand,
          "Not sure",
        ),
        floorArea: optionLabel(
          customerProjectOptions.floorAreas,
          propertyContext.floorArea,
          "Not sure",
        ),
        occupants: optionLabel(
          customerProjectOptions.occupants || [],
          propertyContext.occupants,
          "Not sure",
        ),
        sharedWalls: optionLabel(
          customerProjectOptions.sharedWalls || [],
          propertyContext.sharedWalls,
          "Not sure",
        ),
        roofType: optionLabel(
          customerProjectOptions.roofTypes,
          propertyContext.roofType,
          "Not sure",
        ),
        roofColour: optionLabel(
          customerProjectOptions.roofColours || [],
          propertyContext.roofColour,
          "Not sure",
        ),
        roofForm: optionLabel(
          customerProjectOptions.roofForms || [],
          propertyContext.roofForm,
          "Not sure",
        ),
        roofCondition: optionLabel(
          customerProjectOptions.roofConditions || [],
          propertyContext.roofCondition,
          "Not sure",
        ),
        wallConstruction: optionLabel(
          customerProjectOptions.wallConstructions || [],
          propertyContext.wallConstruction,
          "Not sure",
        ),
        floorConstruction: optionLabel(
          customerProjectOptions.floorConstructions || [],
          propertyContext.floorConstruction,
          "Not sure",
        ),
        switchboard: optionLabel(
          customerProjectOptions.switchboards,
          propertyContext.switchboard,
          "Not sure",
        ),
      },
      homeDetails: [
        optionLabel(
          customerProjectOptions.storeys,
          propertyContext.storeys,
          "Home height not recorded",
        ),
        optionLabel(
          customerProjectOptions.ageBands,
          propertyContext.ageBand,
          "Home age not recorded",
        ),
        optionLabel(
          customerProjectOptions.floorAreas,
          propertyContext.floorArea,
          "Floor area not recorded",
        ),
        optionLabel(
          customerProjectOptions.roofTypes,
          propertyContext.roofType,
          "Roof covering not recorded",
        ),
        optionLabel(
          customerProjectOptions.switchboards,
          propertyContext.switchboard,
          "Switchboard type not recorded",
        ),
      ],
      consideredWork: serviceCategories
        .map((category) =>
          optionLabel(customerProjectOptions.serviceCategories, category))
        .filter(Boolean),
    },
    climate: climate
      ? {
        label: boundedText(climate.label, 160),
        summary: boundedText(climate.summary, 480),
        boundary: boundedText(climate.disclaimer, 520),
      }
      : null,
    evidence: {
      ...evidenceSummary(advisorProfile),
      linkedFacts: readiness.linked,
    },
    readiness,
    professionalReview,
    everydayActions,
    everydayActionsBoundary: boundedText(
      generatedPlan.everydayActionsBoundary,
      700,
    ),
    actions,
    electrificationMoves: electrificationMovesForFeatures(existingFeatures),
    questions: [],
    permissionSections: permissionPack.sections
      .map((section) => ({
        label: boundedText(section.label, 160),
        items: section.items.slice(0, 20).map((item) => ({
          title: boundedText(item.title, 220),
          note: boundedText(item.note, 420),
        })),
      }))
      .filter((section) => section.items.length),
    permissionBoundary: boundedText(permissionPack.disclaimer, 700),
    omitted: countPrivateItems(sourceAdvisorProfile, snapshotItems),
    privacyNote: "This shareable copy deliberately excludes the exact postcode, private project names, account details, private notes, room names and routines, permission notes, evidence filenames, meter information and customer review text.",
    adviceBoundary: "This plan is independent planning guidance based on household answers. It is not a quote, product endorsement, NatHERS assessment, home energy rating, equipment sizing result or savings promise. Confirm safety, permissions, suitability and current incentives before committing to work.",
  };
}

/**
 * Build the bounded planning context an allocated installer needs to decide
 * whether to quote. The authoritative customer plan document performs the
 * privacy filtering first; this projection deliberately omits every private
 * document field that is not required for matching or quote preparation.
 *
 * @param {any} row
 * @param {{preparedAt?: string, evidence?: Array<Record<string, unknown>>}} [options]
 */
export function createInstallerEnquiryPack(row, options = {}) {
  const document = createCustomerPlanDocument(row, options);
  const overview = (
    document.overview
    && typeof document.overview === "object"
    && !Array.isArray(document.overview)
  ) ? document.overview : {};
  const readiness = (
    document.readiness
    && typeof document.readiness === "object"
    && !Array.isArray(document.readiness)
  ) ? document.readiness : {};
  const sourceActions = Array.isArray(document.actions)
    ? document.actions
    : [];
  const readinessBoundary = document.professionalReview
    ? "These home answers were marked as reviewed by a self-declared accredited adviser. Australian Energy Assessments has not independently checked that review."
    : boundedText(readiness.boundary, 420);

  return {
    version: INSTALLER_ENQUIRY_PACK_VERSION,
    planTitle: boundedText(document.planTitle, 180),
    summary: boundedText(document.summary, 360),
    goals: boundedStringList(overview.goals, 10, 120),
    planBoundary: {
      pace: boundedText(overview.pace, 100) || "Not recorded",
      budget: boundedText(overview.budget, 100) || "Not recorded",
    },
    homeContext: {
      propertyType: boundedText(overview.propertyType, 100) || "Home",
      tenure: boundedText(overview.tenure, 100) || "Not recorded",
      state: boundedText(overview.state, 20) || "Not recorded",
      approval: boundedText(overview.approval, 180) || "Not recorded",
      details: boundedStringList(overview.homeDetails, 5, 120),
      consideredWork: boundedStringList(
        overview.consideredWork,
        12,
        120,
      ),
    },
    readiness: {
      answered: Math.max(0, Number(readiness.answered || 0)),
      total: Math.max(0, Number(readiness.total || 0)),
      notSure: Math.max(0, Number(readiness.notSure || 0)),
      missing: Math.max(0, Number(readiness.missing || 0)),
      message: boundedText(readiness.message, 360),
      boundary: readinessBoundary,
    },
    actionCount: sourceActions.length,
    privacyNote: "This enquiry pack excludes the exact postcode, private project and account details, contact details, private notes, room names and routines, permission notes, evidence filenames, meter information and customer review text.",
    adviceBoundary: boundedText(document.adviceBoundary, 700),
  };
}

/**
 * Build the complete installer-facing report only after the caller has
 * established an exact authorised match. The customer document has already
 * removed private project fields, custom notes, room names and file names.
 * Professional identity and declaration details are also removed here because
 * they are not needed to prepare a quote.
 *
 * @param {any} row
 * @param {{preparedAt?: string, evidence?: Array<Record<string, unknown>>}} [options]
 */
export function createInstallerPlanReportView(row, options = {}) {
  const document = createCustomerPlanDocument(row, options);
  const installerDocument = {
    ...document,
    professionalReview: null,
    readiness: {
      ...document.readiness,
      boundary: "These home details were supplied for planning. Confirm the relevant site conditions before quoting or carrying out work.",
    },
    privacyNote: "This installer copy excludes the exact postcode, private project and account details, contact details, private notes, room names and routines, permission notes, evidence filenames, meter information, customer review text and professional adviser identity or notes.",
  };
  return createCustomerPlanReportView(installerDocument);
}

export function normalizeCustomerPlanEmailRequest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Enter the plan email details again." };
  }
  const allowedKeys = new Set([
    "projectId",
    "recipient",
    "consentConfirmed",
    "requestId",
  ]);
  if (Object.keys(raw).some((key) => !allowedKeys.has(key))) {
    return { ok: false, error: "The plan email request included an unsupported field." };
  }
  const projectId = boundedText(raw.projectId, 180);
  const requestId = boundedText(raw.requestId, 180);
  const recipient = boundedText(raw.recipient, 254).toLowerCase();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,179}$/.test(projectId)) {
    return { ok: false, error: "Choose a saved plan before sending it." };
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,179}$/.test(requestId)) {
    return { ok: false, error: "Start a new plan email request and try again." };
  }
  if (!isSingleEmailAddress(recipient)) {
    return { ok: false, error: "Enter one valid email address." };
  }
  if (raw.consentConfirmed !== true) {
    return { ok: false, error: "Confirm that this plan can be sent to the named email address." };
  }
  return {
    ok: true,
    value: { projectId, recipient, consentConfirmed: true, requestId },
  };
}

export function isSingleEmailAddress(value) {
  const email = typeof value === "string" ? value.trim() : "";
  if (!email || email.length > 254 || /[\s,;<>()[\]\\"]/.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (
    !local
    || local.length > 64
    || local.startsWith(".")
    || local.endsWith(".")
    || local.includes("..")
    || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
  ) return false;
  if (!domain || domain.length > 253 || domain.includes("..")) return false;
  const labels = domain.split(".");
  return labels.length >= 2
    && labels.every((label) => (
      /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)
    ))
    && /^[A-Za-z]{2,63}$/.test(labels.at(-1));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function absoluteGuideHref(href) {
  return allowedGuideHrefs.has(href)
    ? `${CUSTOMER_PLAN_PUBLIC_ORIGIN}${href}`
    : "";
}

function absolutePlanResourceHref(href) {
  const safeHref = safePlanResourceHref(href);
  if (!safeHref) return "";
  return safeHref.startsWith("/")
    ? `${CUSTOMER_PLAN_PUBLIC_ORIGIN}${safeHref}`
    : safeHref;
}

function uniqueReportText(values, maximum) {
  const seen = new Set();
  const result = [];
  for (const supplied of Array.isArray(values) ? values : []) {
    const value = boundedText(supplied, 320);
    const key = value.toLocaleLowerCase("en-AU");
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= maximum) break;
  }
  return result;
}

function reportReadiness(document) {
  const supplied = document?.readiness
    && typeof document.readiness === "object"
    ? document.readiness
    : null;
  if (supplied && Number(supplied.total || 0) > 0) {
    return {
      answered: Math.max(0, Number(supplied.answered || 0)),
      total: Math.max(0, Number(supplied.total || 0)),
      notSure: Math.max(0, Number(supplied.notSure || 0)),
      linked: Math.max(0, Number(supplied.linked || 0)),
      missing: Math.max(0, Number(supplied.missing || 0)),
      missingLabels: boundedStringList(supplied.missingLabels, 3, 160),
      message: boundedText(supplied.message, 520),
      boundary: boundedText(supplied.boundary, 320),
    };
  }
  if (Array.isArray(document?.existingFeatures)) {
    return createCustomerPlanReadiness(document.existingFeatures);
  }
  return {
    answered: 0,
    total: 0,
    notSure: 0,
    linked: 0,
    missing: 0,
    missingLabels: [],
    message: "This roadmap uses the choices recorded here. Any remaining confirmation is placed inside the step where it affects the scope.",
    boundary: "These details were supplied by the household and have not been professionally checked.",
  };
}

export function createCustomerPlanReportView(document) {
  const sourceActions = Array.isArray(document?.actions)
    ? document.actions.slice(0, 40)
    : [];
  const legacyConfirmations = uniqueReportText([
    ...boundedStringList(document?.readiness?.missingLabels, 6, 160)
      .map((label) => `Confirm ${label.toLowerCase()} before relying on the affected scope.`),
    ...(Array.isArray(document?.questions) ? document.questions : [])
      .slice(0, 6)
      .map((question) => [
        boundedText(question?.prompt, 240),
        boundedText(question?.whyItMatters, 360),
      ].filter(Boolean).join(" ")),
  ], 5);
  const priorityIndexes = new Set(
    sourceActions
      .map((action, index) => ({ action, index }))
      .filter(({ action }) => action?.completed !== true)
      .slice(0, 3)
      .map(({ index }) => index),
  );
  const actions = sourceActions.map((action, index) => {
    const guideHref = safeGuideHref(action?.guideHref || action?.href);
    const completedIds = action?.completed === true
      ? new Set([boundedText(action?.id, 80)])
      : new Set();
    const enriched = enrichedReportAction({
      ...action,
      text: action?.whatToDo || action?.description || action?.text,
      href: guideHref,
      action: action?.guideLabel || action?.action,
    }, index, completedIds);
    const solutionOptions = safeSolutionOptions(
      Array.isArray(action?.solutionOptions) && action.solutionOptions.length
        ? action.solutionOptions
        : enriched.solutionOptions,
    );
    const confirmBeforeWork = uniqueReportText([
      ...boundedStringList(action?.confirmBeforeWork, 3, 220),
      ...enriched.confirmBeforeWork,
      ...(index === 0 ? legacyConfirmations : []),
    ], 3).map((item) => boundedSentenceText(item, 220));
    return {
      ...enriched,
      number: Number.isFinite(Number(action?.number))
        ? Number(action.number)
        : index + 1,
      id: boundedText(action?.id, 80) || `report-action-${index + 1}`,
      stage: boundedText(action?.stage, 100),
      title: boundedText(action?.title, 180),
      description: boundedSentenceText(action?.description || action?.text, 900),
      whatToDo: boundedSentenceText(
        action?.whatToDo || action?.description || action?.text,
        600,
      ),
      whyItMatters: boundedSentenceText(
        action?.whyItMatters || enriched.whyItMatters,
        360,
      ),
      householdReason: boundedSentenceText(
        action?.householdReason || enriched.householdReason,
        420,
      ),
      confirmBeforeWork,
      quoteChecklist: boundedStringList(
        Array.isArray(action?.quoteChecklist)
          ? action.quoteChecklist
          : enriched.quoteChecklist,
        3,
        220,
      ),
      sequence: boundedSentenceText(
        action?.sequence || enriched.sequence,
        420,
      ),
      safety: boundedSentenceText(action?.safety || enriched.safety, 360),
      solutionOptions,
      completed: action?.completed === true,
      priority: priorityIndexes.has(index),
      guideLabel: guideHref
        ? boundedText(action?.guideLabel || action?.action, 120)
          || "Open the related guide"
        : "",
      guideHref,
      links: safeActionLinks(
        Array.isArray(action?.links) && action.links.length
          ? action.links
          : enriched.links,
      ),
    };
  });
  const decisionBasis = uniqueReportText(
    sourceActions
      .flatMap((action) => (
        Array.isArray(action?.guidance?.basedOn)
          ? action.guidance.basedOn
          : []
      ))
      .filter((item) => (
        !/selected goals include/i.test(String(item))
        && !/tracked home facts/i.test(String(item))
        && !/part of the independent planning sequence/i.test(String(item))
      )),
    4,
  ).map(professionalReportSentence).filter(Boolean);
  if (!decisionBasis.length) {
    decisionBasis.push(
      "The sequence reflects the goals, home context, budget and pace recorded for this plan.",
    );
  }
  const professionalReview = professionalReviewProjection(
    document?.professionalReview,
  );
  const readiness = {
    ...reportReadiness(document),
    ...(professionalReview
      ? { boundary: professionalReview.readinessBoundary }
      : {}),
  };
  const overview = document?.overview && typeof document.overview === "object"
    ? document.overview
    : {};
  const goals = boundedStringList(overview.goals, 10, 120);
  const homeDetails = boundedStringList(overview.homeDetails, 12, 120);
  const homeFacts = overview.homeFacts
    && typeof overview.homeFacts === "object"
    && !Array.isArray(overview.homeFacts)
    ? overview.homeFacts
    : {};
  const joinedFacts = (keys, fallback = "Not recorded") => {
    const values = keys
      .map((key) => boundedText(homeFacts[key], 120))
      .filter(Boolean);
    return values.join(", ") || fallback;
  };
  const consideredWork = boundedStringList(
    overview.consideredWork,
    12,
    120,
  );
  const planningSnapshot = [
    {
      label: "Goals",
      value: goals.join(", ") || "Not recorded",
    },
    {
      label: "Home and tenure",
      value: [
        boundedText(overview.propertyType, 100),
        boundedText(overview.tenure, 100),
        boundedText(overview.state, 20),
      ].filter(Boolean).join(", ") || "Not recorded",
    },
    {
      label: "Size and occupancy",
      value: joinedFacts(
        ["storeys", "floorArea", "occupants"],
        homeDetails.join(", ") || "Not recorded",
      ),
    },
    {
      label: "Age and shared walls",
      value: joinedFacts(["ageBand", "sharedWalls"]),
    },
    {
      label: "Roof",
      value: joinedFacts([
        "roofType",
        "roofForm",
        "roofColour",
        "roofCondition",
      ]),
    },
    {
      label: "Walls and floor",
      value: joinedFacts(["wallConstruction", "floorConstruction"]),
    },
    {
      label: "Electrical context",
      value: joinedFacts(["switchboard"]),
    },
    {
      label: "Work being considered",
      value: consideredWork.join(", ") || "No work type selected yet",
    },
    {
      label: "Approval context",
      value: boundedText(overview.approval, 180) || "Not recorded",
    },
    {
      label: "Delivery approach",
      value: [
        boundedText(overview.pace, 100),
        boundedText(overview.budget, 100),
      ].filter(Boolean).join(", ") || "Not recorded",
    },
  ];
  const climate = document?.climate && typeof document.climate === "object"
    ? {
      label: boundedText(document.climate.label, 160),
      summary: boundedText(document.climate.summary, 480),
    }
    : null;
  const seenEverydayActionIds = new Set();
  const everydayActions = (
    Array.isArray(document?.everydayActions) ? document.everydayActions : []
  )
    .slice(0, 24)
    .flatMap((item) => {
      const id = boundedText(item?.id, 80);
      if (
        !allowedEverydayActionIds.has(id)
        || seenEverydayActionIds.has(id)
      ) return [];
      seenEverydayActionIds.add(id);
      const title = boundedText(item?.title, 180);
      const description = boundedText(
        item?.description || item?.text,
        900,
      );
      if (!title || !description) return [];
      return [{
        id,
        category: boundedText(item?.category, 100),
        title,
        description,
        outcome: boundedSentenceText(
          item?.outcome || everydayActionOutcomeById.get(id),
          420,
        ),
      }];
    })
    .slice(0, 12);
  const displayDate = customerPlanDisplayDate(
    boundedText(document?.preparedDate, 20),
  );
  const readinessPresentation = customerPlanReadinessPresentation(
    readiness,
    professionalReview,
  );
  const professionalPresentation =
    customerPlanProfessionalPresentation(professionalReview);
  const electrificationMoves = (Array.isArray(document?.electrificationMoves)
    ? document.electrificationMoves
    : [])
    .slice(0, 3)
    .flatMap((move) => {
      const source = move && typeof move === "object" && !Array.isArray(move)
        ? move
        : {};
      const id = boundedText(source.id, 80);
      const title = boundedText(source.title, 180);
      const summary = boundedSentenceText(source.summary, 520);
      const checkFirst = boundedSentenceText(source.checkFirst, 420);
      return id && title && summary && checkFirst
        ? [{ id, title, summary, checkFirst }]
        : [];
    });
  return {
    version: CUSTOMER_PLAN_REPORT_VERSION,
    designVersion: CUSTOMER_PLAN_REPORT_DESIGN_VERSION,
    heading: boundedText(document?.heading, 180)
      || "Your independent home energy plan",
    planTitle: boundedText(document?.planTitle, 180)
      || "An evidence-led home energy plan",
    summary: boundedText(document?.summary, 480),
    preparedDate: boundedText(document?.preparedDate, 20),
    displayDate,
    preparedFor: boundedText(document?.preparedFor, 120),
    customerSummary: boundedText(document?.customerSummary, 220),
    copy: customerPlanReportCopy,
    planningSnapshot,
    climate: climate?.label || climate?.summary ? climate : null,
    readiness,
    readinessPresentation,
    professionalReview,
    professionalPresentation,
    questions: [],
    decisionBasis,
    everydayActions,
    everydayActionsBoundary: boundedText(
      document?.everydayActionsBoundary,
      700,
    ) || CUSTOMER_EVERYDAY_ACTIONS_BOUNDARY,
    electrificationMoves,
    actions,
    priorityActions: actions.filter((action) => action.priority),
    laterActions: actions.filter((action) => !action.priority),
    changeBoundary: "New evidence or a licensed site check can change safety, capacity, access or the recommended sequence.",
    beforeTrade: [
      "Confirm any owner, agent, strata or owners-corporation approval in writing before fixed or shared-property work.",
      "Use appropriately licensed trades for regulated electrical, plumbing, gas and building work.",
      "Compare written scopes, inclusions, exclusions, warranties and current official incentives before committing.",
    ],
    resources: safePlanResources(document?.resources),
    privacyNote: boundedText(document?.privacyNote, 700)
      || "Private account details and customer-written notes are not included in this shared copy.",
    adviceBoundary: boundedText(document?.adviceBoundary, 700)
      || "This plan is independent general guidance, not a quote, product endorsement, site assessment or savings promise.",
  };
}

function publicPlanResourceSet() {
  return [
    {
      label: "Review or update your Australian Energy Assessments home energy plan",
      description: "Return to the private, no-account planner when your home, priorities or equipment change.",
      href: "/plan",
    },
    {
      label: "Find current rebates and support",
      description: "Use the Australian Energy Assessments rebate finder, then confirm current official program rules before signing a quote.",
      href: "/rebates",
    },
    {
      label: "Estimate certificate and rebate value",
      description: "Use the Australian Energy Assessments calculator for an indicative estimate based on the selected activity, product and location.",
      href: "/calculator",
    },
    {
      label: "Compare electricity plans",
      description: "Use the Australian Energy Assessments guided comparator to check current electricity options against your household usage.",
      href: "/compare",
    },
    {
      label: "Compare gas plans",
      description: "Use the Australian Energy Assessments guided gas comparator if the household still has a gas account.",
      href: "/gas-compare",
    },
    {
      label: "Prepare for an independent assessment",
      description: "See the Australian Energy Assessments assessment path when a site-specific review would make the next decision clearer.",
      href: "/assessments",
    },
    {
      label: "Australian Government quick wins",
      description: "Practical low-cost and no-cost actions for energy use and comfort.",
      href: "https://www.energy.gov.au/households/quick-wins",
    },
    {
      label: "Australian Government guide to reducing energy bills",
      description: "Use the current household guide to understand bills, identify major loads and act in a practical order.",
      href: "https://www.energy.gov.au/households/household-guides/reduce-energy-bills",
    },
    {
      label: "Australian Government insulation and draught-proofing guide",
      description: "Official guidance on insulation, uncontrolled leakage, required ventilation and safe installation checks.",
      href: "https://www.energy.gov.au/households/insulation-and-draught-proofing",
    },
    {
      label: "Victorian Government window glazing guide",
      description: "Official plain-language guidance on window heat flow, retrofit secondary glazing and full glazing replacement.",
      href: "https://www.sustainability.vic.gov.au/energy-efficiency-and-reducing-emissions/building-or-renovating/build-for-energy-efficiency/key-principles-of-energy-efficient-design/windows-and-shading/window-glazing",
    },
    {
      label: "NatHERS Guidance Note for existing homes - July 2026",
      description: "Current official guidance for assessors undertaking a NatHERS existing-home assessment. This self-reported plan is not that assessment.",
      href: "https://www.homeenergyrating.gov.au/resources/existing-homes-guidance-note",
    },
    {
      label: "NatHERS Technical Note for existing homes - July 2026",
      description: "Current requirements for formal NatHERS existing-home assessments and audit assurance.",
      href: "https://www.homeenergyrating.gov.au/resources/existing-homes-technical-note",
    },
  ];
}

function publicPlanHomeDetails(propertyContext) {
  const source = propertyContext
    && typeof propertyContext === "object"
    && !Array.isArray(propertyContext)
    ? propertyContext
    : {};
  return [
    optionLabel(customerProjectOptions.storeys, source.storeys),
    optionLabel(customerProjectOptions.ageBands, source.ageBand),
    optionLabel(customerProjectOptions.floorAreas, source.floorArea),
    optionLabel(customerProjectOptions.occupants || [], source.occupants),
    optionLabel(customerProjectOptions.sharedWalls || [], source.sharedWalls),
    optionLabel(customerProjectOptions.roofTypes || [], source.roofType),
    optionLabel(customerProjectOptions.roofForms || [], source.roofForm),
    optionLabel(customerProjectOptions.roofColours || [], source.roofColour),
    optionLabel(customerProjectOptions.roofConditions || [], source.roofCondition),
    optionLabel(customerProjectOptions.wallConstructions || [], source.wallConstruction),
    optionLabel(customerProjectOptions.floorConstructions || [], source.floorConstruction),
    optionLabel(customerProjectOptions.switchboards || [], source.switchboard),
  ].filter(Boolean);
}

/**
 * Recompute a customer-only public planner report from a normalized selection.
 * Raw plan items, customer notes and client-authored report text are never used.
 *
 * @param {{
 *   snapshot: Record<string, any>,
 *   name?: string,
 *   postcode?: string,
 *   projectCategories?: string[],
 *   preparedAt?: string,
 * }} input
 */
export function createPublicPlanCustomerReportView({
  snapshot,
  name = "",
  postcode = "",
  projectCategories = [],
  preparedAt = new Date().toISOString(),
}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("A normalized public plan snapshot is required.");
  }
  const safePostcode = /^\d{4}$/.test(String(postcode || ""))
    ? String(postcode)
    : "";
  const postcodeState = residentialStateFromPostcode(safePostcode) || "";
  const addressState = postcodeState || boundedText(snapshot.addressState, 4);
  const propertyContext = {
    ...(snapshot.propertyContext || {}),
    approvalContext: boundedText(snapshot.approvalContext, 40),
  };
  const plan = createCustomerProjectPlan({
    goals: snapshot.goals,
    pace: snapshot.pace,
    situation: snapshot.situation,
    approvalContext: snapshot.approvalContext,
    budgetRange: snapshot.budgetRange,
    postcode: safePostcode,
    addressState,
    features: snapshot.features,
    propertyContext,
  });
  const document = createCustomerPlanDocument({
    goals: snapshot.goals,
    pace: snapshot.pace,
    household_situation: snapshot.situation,
    property_context: propertyContext,
    existing_features: snapshot.features,
    service_categories: projectCategories,
    budget_range: snapshot.budgetRange,
    postcode: safePostcode,
    address_state: addressState,
    property_type: boundedText(snapshot.propertyContext?.propertyType, 40)
      || "house",
    plan_snapshot: plan,
  }, { preparedAt });
  const preparedFor = boundedText(name, 120);
  const propertyLabel = optionLabel(
    customerProjectOptions.propertyTypes,
    snapshot.propertyContext?.propertyType,
    "Home",
  );
  const summaryParts = [
    propertyLabel,
    safePostcode ? `postcode ${safePostcode}` : "",
    addressState,
  ].filter(Boolean);
  document.heading = preparedFor
    ? `${preparedFor}'s home energy plan`
    : "Your personalised home energy plan";
  document.preparedFor = preparedFor;
  document.customerSummary = summaryParts.join(" | ");
  document.overview = {
    ...document.overview,
    propertyType: propertyLabel,
    state: addressState || "Not recorded",
    homeDetails: publicPlanHomeDetails(snapshot.propertyContext),
  };
  document.resources = publicPlanResourceSet();
  document.privacyNote = "This personalised copy is emailed only to the customer. It includes the customer's name, postcode and bounded planner selections. It excludes street address, contact details, bills, meter identifiers, usage files, account records, uploaded documents and private trade notes.";
  return createCustomerPlanReportView(document);
}

const CUSTOMER_PLAN_EMAIL_HTML_MAX_BYTES = 88_000;
const CUSTOMER_PLAN_EMAIL_PROFILES = [
  {
    actionCount: 24,
    actionDescription: 260,
    actionStage: 70,
    actionTitle: 140,
    everydayCount: 6,
    everydayDescription: 240,
    everydayTitle: 140,
    generalBody: 420,
    professionalNotes: 640,
  },
  {
    actionCount: 18,
    actionDescription: 220,
    actionStage: 60,
    actionTitle: 120,
    everydayCount: 5,
    everydayDescription: 200,
    everydayTitle: 120,
    generalBody: 360,
    professionalNotes: 480,
  },
  {
    actionCount: 12,
    actionDescription: 180,
    actionStage: 50,
    actionTitle: 110,
    everydayCount: 4,
    everydayDescription: 170,
    everydayTitle: 110,
    generalBody: 300,
    professionalNotes: 360,
  },
  {
    actionCount: 6,
    actionDescription: 140,
    actionStage: 44,
    actionTitle: 96,
    everydayCount: 2,
    everydayDescription: 140,
    everydayTitle: 96,
    generalBody: 240,
    professionalNotes: 240,
  },
];

function emailText(value, maximum) {
  const source = String(value || "").trim();
  const characters = Array.from(source);
  if (characters.length <= maximum) {
    return { value: source, shortened: false };
  }
  const candidate = characters.slice(0, Math.max(1, maximum - 3)).join("");
  const lastSpace = candidate.lastIndexOf(" ");
  const prefix = lastSpace >= Math.floor(maximum / 2)
    ? candidate.slice(0, lastSpace)
    : candidate;
  return {
    value: `${prefix.trimEnd()}...`,
    shortened: true,
  };
}

function createCustomerPlanEmailProjection(report, profile) {
  let shortened = false;
  const trim = (value, maximum) => {
    const result = emailText(value, maximum);
    shortened ||= result.shortened;
    return result.value;
  };
  const actions = report.actions
    .slice(0, profile.actionCount)
    .map((action) => ({
      ...action,
      stage: trim(action.stage, profile.actionStage),
      title: trim(action.title, profile.actionTitle),
      description: trim(action.description, profile.actionDescription),
      whatToDo: trim(action.whatToDo, profile.actionDescription),
      whyItMatters: trim(action.whyItMatters, 220),
      householdReason: trim(action.householdReason, 220),
      confirmBeforeWork: boundedStringList(
        action.confirmBeforeWork,
        2,
        180,
      ).map((item) => trim(item, 180)),
      quoteChecklist: boundedStringList(
        action.quoteChecklist,
        2,
        160,
      ).map((item) => trim(item, 160)),
      sequence: trim(action.sequence, 220),
      safety: trim(action.safety, 180),
      guideLabel: trim(action.guideLabel, 80),
    }));
  const everydayActions = report.everydayActions
    .slice(0, profile.everydayCount)
    .map((action) => ({
      ...action,
      category: trim(action.category, 70),
      title: trim(action.title, profile.everydayTitle),
      description: trim(
        action.description,
        profile.everydayDescription,
      ),
      outcome: trim(action.outcome, 180),
    }));
  const professionalPresentation = report.professionalPresentation
    ? {
      ...report.professionalPresentation,
      title: trim(report.professionalPresentation.title, 140),
      role: trim(report.professionalPresentation.role, 100),
      scheme: trim(report.professionalPresentation.scheme, 120),
      reference: trim(report.professionalPresentation.reference, 80),
      notes: trim(
        report.professionalPresentation.notes,
        profile.professionalNotes,
      ),
      boundary: trim(
        report.professionalPresentation.boundary,
        profile.generalBody,
      ),
    }
    : null;
  const projected = {
    ...report,
    heading: trim(report.heading, 160),
    planTitle: trim(report.planTitle, 160),
    summary: trim(report.summary, profile.generalBody),
    planningSnapshot: report.planningSnapshot.map((item) => ({
      label: trim(item.label, 80),
      value: trim(item.value, profile.generalBody),
    })),
    climate: report.climate
      ? {
        label: trim(report.climate.label, 140),
        summary: trim(report.climate.summary, profile.generalBody),
      }
      : null,
    readinessPresentation: {
      title: trim(report.readinessPresentation.title, 180),
      body: trim(report.readinessPresentation.body, profile.generalBody),
    },
    professionalPresentation,
    questions: [],
    decisionBasis: report.decisionBasis.map((item) =>
      trim(item, profile.generalBody)
    ),
    everydayActions,
    everydayActionsBoundary: trim(
      report.everydayActionsBoundary,
      profile.generalBody,
    ),
    actions,
    priorityActions: actions.filter((action) => action.priority),
    laterActions: actions.filter((action) => !action.priority),
    privacyNote: trim(report.privacyNote, profile.generalBody),
    adviceBoundary: trim(report.adviceBoundary, profile.generalBody),
  };
  const notices = [];
  const omittedActions = report.actions.length - actions.length;
  if (omittedActions > 0) {
    notices.push(
      `This email shows the first ${actions.length} of ${report.actions.length} plan steps. The remaining ${omittedActions} step${omittedActions === 1 ? "" : "s"} remain in your saved plan and downloadable PDF.`,
    );
  }
  const omittedEveryday = report.everydayActions.length
    - everydayActions.length;
  if (omittedEveryday > 0) {
    notices.push(
      `This email shows ${everydayActions.length} of ${report.everydayActions.length} optional comfort tips. The remaining ${omittedEveryday} tip${omittedEveryday === 1 ? "" : "s"} remain in your saved plan and downloadable PDF.`,
    );
  }
  if (shortened) {
    notices.push(
      "Some longer wording was shortened for email readability. Your saved plan and downloadable PDF keep the complete wording.",
    );
  }
  return { report: projected, notices };
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function createCustomerPlanEmailRendering(document) {
  const sourceReport = createCustomerPlanReportView(document);
  let fallback = null;
  for (const profile of CUSTOMER_PLAN_EMAIL_PROFILES) {
    const projection = createCustomerPlanEmailProjection(sourceReport, profile);
    const html = renderCustomerPlanDocumentHtml(
      projection.report,
      projection.notices,
    );
    fallback = { ...projection, html };
    if (utf8ByteLength(html) <= CUSTOMER_PLAN_EMAIL_HTML_MAX_BYTES) {
      return fallback;
    }
  }
  return fallback;
}

function htmlBulletRows(items, { color = "#365467" } = {}) {
  if (!items.length) return "";
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${
    items.map((item) => `
      <tr>
        <td width="22" valign="top" style="padding:7px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#00a9e8;">&#8226;</td>
        <td valign="top" style="padding:7px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:${color};">${escapeHtml(item)}</td>
      </tr>`).join("")
  }</table>`;
}

function htmlSectionHeading(eyebrow, title, intro = "") {
  return `
    <div style="width:38px;height:4px;margin:0 0 13px;border-radius:999px;background-color:#20d8c1;font-size:0;line-height:0;">&nbsp;</div>
    <div style="margin:0 0 ${emailLayout.labelTitleGap}px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:#006da6;">${escapeHtml(eyebrow)}</div>
    <h2 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:29px;line-height:34px;font-weight:800;letter-spacing:-.5px;color:#063448;">${escapeHtml(title)}</h2>
    ${intro ? `<p style="margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#536c78;">${escapeHtml(intro)}</p>` : ""}`;
}

function htmlActionCard(action, priority = false) {
  const guideHref = absoluteGuideHref(action.guideHref);
  const number = action.completed
    ? "Done"
    : String(action.number).padStart(2, "0");
  const titleColor = priority ? "#ffffff" : "#063448";
  const bodyColor = priority ? "#cae8f0" : "#365467";
  const labelColor = priority ? "#74f1d7" : "#006da6";
  const linkColor = priority ? "#74f1d7" : "#047857";
  const surface = priority
    ? "border:1px solid #20d8c1;border-top:6px solid #20d8c1;"
    : "border:1px solid #c9dfe5;border-top:5px solid #00a9e8;";
  const cellSurface = priority
    ? "background-color:#063448;background-image:linear-gradient(135deg,#031f38 0%,#05677b 100%);"
    : "background-color:#f8fcfd;";
  const detailSurface = priority ? "rgba(0,21,43,.38)" : "#eaf4f7";
  const confirmation = boundedStringList(action.confirmBeforeWork, 2, 180)
    .join(" ");
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 ${emailLayout.tileGap}px;border-collapse:separate;border-spacing:0;border-radius:${emailLayout.tileRadius}px;overflow:hidden;${surface}">
      <tr>
        <td width="62" valign="top" style="padding:${emailLayout.tilePaddingY}px 0 ${emailLayout.tilePaddingY}px ${emailLayout.tilePaddingX}px;${cellSurface}border-radius:${emailLayout.tileRadius}px 0 0 ${emailLayout.tileRadius}px;">
          <div style="width:40px;padding:10px 0;border-radius:${emailLayout.badgeRadius}px;background-color:${action.completed ? "#047857" : priority ? "#00a9e8" : "#063448"};font-family:Arial,Helvetica,sans-serif;font-size:${action.completed ? "11px" : "13px"};line-height:20px;font-weight:700;text-align:center;color:#ffffff;">${escapeHtml(number)}</div>
        </td>
        <td valign="top" style="padding:${emailLayout.tilePaddingY}px ${emailLayout.tilePaddingX}px ${emailLayout.tilePaddingY}px 16px;${cellSurface}border-radius:0 ${emailLayout.tileRadius}px ${emailLayout.tileRadius}px 0;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;color:${labelColor};">${escapeHtml(priority ? `Start here | ${action.stage}` : action.stage)}</div>
          <h3 style="margin:${emailLayout.labelTitleGap}px 0 ${emailLayout.titleBodyGap}px;font-family:Arial,Helvetica,sans-serif;font-size:${priority ? "22px" : "19px"};line-height:${priority ? "27px" : "24px"};font-weight:800;letter-spacing:-.25px;color:${titleColor};">${escapeHtml(action.title)}</h3>
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:${bodyColor};">${escapeHtml(action.whatToDo || action.description)}</p>
          <div style="margin-top:14px;padding:14px 16px;border-radius:${emailLayout.insetRadius}px;background-color:${detailSurface};">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:${labelColor};">Why it matters</div>
            <p style="margin:4px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:${bodyColor};">${escapeHtml(action.whyItMatters)}</p>
            <div style="margin-top:10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:${labelColor};">Why it is in this plan</div>
            <p style="margin:4px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:${bodyColor};">${escapeHtml(action.householdReason)}</p>
            ${confirmation ? `<div style="margin-top:10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:${labelColor};">Confirm before quoting</div><p style="margin:4px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:${bodyColor};">${escapeHtml(confirmation)}</p>` : ""}
          </div>
          ${guideHref ? `<p style="margin:${emailLayout.bodyLinkGap}px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;"><a href="${escapeHtml(guideHref)}" style="font-weight:700;color:${linkColor};text-decoration:underline;">${escapeHtml(action.guideLabel || customerPlanReportCopy.guideLabel)}</a></p>` : ""}
        </td>
      </tr>
    </table>`;
}

function htmlEverydayActionTile(action, isLast = false) {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 ${isLast ? 0 : emailLayout.tileGap}px;border-collapse:separate;border-spacing:0;border:1px solid rgba(116,241,215,.28);border-radius:${emailLayout.tileRadius}px;overflow:hidden;background-color:#084a60;background-image:linear-gradient(135deg,#073c55 0%,#087388 100%);">
      <tr>
        <td style="padding:18px 20px;border-radius:${emailLayout.tileRadius}px;background-color:#084a60;background-image:linear-gradient(135deg,#073c55 0%,#087388 100%);">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#74f1d7;">${escapeHtml(action.category)}</div>
          <div style="margin-top:${emailLayout.labelTitleGap}px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:25px;font-weight:800;color:#ffffff;">${escapeHtml(action.title)}</div>
          <p style="margin:${emailLayout.titleBodyGap}px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#cae8f0;">${escapeHtml(action.description)}</p>
          ${action.outcome ? `<p style="margin:12px 0 0;padding-top:12px;border-top:1px solid rgba(116,241,215,.3);font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#ffffff;"><strong>Why try it:</strong> ${escapeHtml(action.outcome)}</p>` : ""}
        </td>
      </tr>
    </table>`;
}

function htmlPrimaryResourceRows(resources) {
  const preferred = ["/calculator", "/rebates", "/compare", "/gas-compare"];
  const selected = preferred.flatMap((href) => {
    const resource = (Array.isArray(resources) ? resources : [])
      .find((item) => item?.href === href);
    return resource ? [resource] : [];
  });
  if (!selected.length) return "";
  return selected.map((resource, index) => {
    const href = `${CUSTOMER_PLAN_PUBLIC_ORIGIN}${resource.href}`;
    return `<tr><td style="padding:${index ? "14px 0 0" : "0"};font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;"><a href="${escapeHtml(href)}" style="font-weight:800;color:#047857;text-decoration:underline;">${escapeHtml(resource.label)}</a><div style="margin-top:4px;color:#536c78;">${escapeHtml(resource.description)}</div></td></tr>`;
  }).join("");
}

function renderCustomerPlanDocumentHtml(report, notices = []) {
  const copy = report.copy;
  const readiness = report.readinessPresentation;
  const professional = report.professionalPresentation;
  const [leadSnapshot, ...remainingSnapshots] = report.planningSnapshot;
  const planComplete = report.actions.length > 0
    && report.actions.every((action) => action.completed);
  const reportSignals = planComplete
    ? [
      [report.actions.length, "STEPS COMPLETE"],
      [0, "LEFT TO PLAN"],
      [report.actions.length, "CHECKLISTS INCLUDED"],
    ]
    : [
      [report.priorityActions.length, "START NOW"],
      [report.laterActions.length, "PLAN NEXT"],
      [report.actions.length, "CHECKLISTS INCLUDED"],
    ];
  const preheader = planComplete
    ? `${report.planTitle}. Every current step is marked complete.`
    : report.priorityActions.length
      ? `${report.planTitle}. Your first three steps are ready.`
      : report.actions.length
        ? `${report.planTitle}. Every current step is marked complete.`
        : `${report.planTitle}. Your home energy planning summary is ready.`;
  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="x-aea-report-design" content="${escapeHtml(report.designVersion)}">
    <title>${escapeHtml(report.heading)}</title>
    <!--[if mso]>
    <noscript>
      <xml>
        <o:OfficeDocumentSettings>
          <o:PixelsPerInch>96</o:PixelsPerInch>
        </o:OfficeDocumentSettings>
      </xml>
    </noscript>
    <![endif]-->
    <style>
      body, table, td { margin: 0; padding: 0; }
      table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
      img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
      @media only screen and (max-width: 680px) {
        .email-shell { width: 100% !important; }
        .outer-pad { padding: 0 !important; }
        .hero-pad { padding: 28px 22px !important; }
        .body-pad { padding: 26px 18px !important; }
        .snapshot-cell { display: block !important; width: auto !important; margin-bottom: 12px !important; }
        .snapshot-spacer { display: none !important; }
        .hero-title { font-size: 34px !important; line-height: 39px !important; }
        .section-pad { padding-top: ${emailLayout.mobileSectionGap}px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:${customerPlanReportColors.navyDeep};color:${customerPlanReportColors.text};font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
    <div style="display:none!important;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;mso-hide:all;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background-color:${customerPlanReportColors.navyDeep};">
      <tr><td class="outer-pad" align="center" style="padding:30px 12px;">
        <table class="email-shell" role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;border-collapse:separate;border-spacing:0;border-radius:${emailLayout.shellRadius}px;overflow:hidden;background-color:${customerPlanReportColors.canvas};border:1px solid #0b526b;">
          <tr>
            <td class="hero-pad" style="padding:38px 40px 40px;border-radius:${emailLayout.shellRadius}px ${emailLayout.shellRadius}px 0 0;background-color:${customerPlanReportColors.navy};background-image:linear-gradient(135deg,#00152b 0%,#055b74 100%);border-bottom:7px solid ${customerPlanReportColors.teal};color:#ffffff;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="50" valign="middle" style="width:50px;">
                    <div style="width:42px;height:42px;border:1px solid rgba(116,241,215,.55);border-radius:${emailLayout.badgeRadius}px;background-color:rgba(255,255,255,.08);text-align:center;">
                      <img src="${AEA_BRANDMARK_PUBLIC_URL}" width="32" height="32" alt="" style="display:block;width:32px;height:32px;margin:5px;border:0;border-radius:7px;">
                    </div>
                  </td>
                  <td valign="middle">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:16px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:#ffffff;">${escapeHtml(copy.brand)}</div>
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:15px;font-weight:600;color:#cae8f0;">Independent energy assessments</div>
                  </td>
                  <td align="right" valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#cae8f0;">${escapeHtml(report.displayDate || report.preparedDate)}</td>
                </tr>
              </table>
              <div style="margin:34px 0 9px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:#74f1d7;">${escapeHtml(copy.heroEyebrow)}</div>
              <h1 class="hero-title" style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:44px;line-height:48px;font-weight:800;letter-spacing:-1.1px;color:#ffffff;">${escapeHtml(copy.heroTitle)}</h1>
              <p style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:19px;line-height:28px;font-weight:700;color:#74f1d7;">${escapeHtml(report.planTitle)}</p>
              ${report.summary ? `<p style="margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#cae8f0;">${escapeHtml(report.summary)}</p>` : ""}
              <div style="margin-top:24px;padding-top:15px;border-top:1px solid rgba(116,241,215,.42);font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:16px;font-weight:700;letter-spacing:1px;color:#74f1d7;">INDEPENDENT | BRAND NEUTRAL | BUILT AROUND YOUR HOME</div>
            </td>
          </tr>
          <tr>
            <td class="body-pad" style="padding:36px 40px 44px;background-color:${customerPlanReportColors.canvas};">
              ${htmlSectionHeading(copy.snapshotEyebrow, copy.snapshotTitle)}
              ${leadSnapshot ? `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px;border-collapse:separate;border-spacing:0;border-radius:${emailLayout.featureRadius}px;overflow:hidden;background-color:#063448;background-image:linear-gradient(135deg,#04314a 0%,#058794 100%);border-left:6px solid #20d8c1;">
                <tr><td style="padding:22px 24px;border-radius:${emailLayout.featureRadius}px;background-color:#063448;background-image:linear-gradient(135deg,#04314a 0%,#058794 100%);">
                  <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;color:#74f1d7;">${escapeHtml(leadSnapshot.label)}</div>
                  <div style="margin-top:${emailLayout.labelTitleGap}px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:27px;font-weight:700;color:#ffffff;">${escapeHtml(leadSnapshot.value)}</div>
                </td></tr>
              </table>` : ""}
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:11px;">
                ${Array.from({ length: Math.ceil(remainingSnapshots.length / 2) }, (_, rowIndex) => {
                  const first = remainingSnapshots[rowIndex * 2];
                  const second = remainingSnapshots[(rowIndex * 2) + 1];
                  return `
                  <tr>
                    <td class="snapshot-cell" width="49%" valign="top" style="padding:18px;border-radius:${emailLayout.tileRadius}px;background-color:#f8fcfd;border:1px solid #c9dfe5;border-top:4px solid #00a9e8;">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#006da6;">${escapeHtml(first.label)}</div>
                      <div style="margin-top:${emailLayout.labelTitleGap}px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#082a3a;">${escapeHtml(first.value)}</div>
                    </td>
                    <td class="snapshot-spacer" width="2%" style="font-size:0;line-height:0;">&nbsp;</td>
                    ${second ? `<td class="snapshot-cell" width="49%" valign="top" style="padding:18px;border-radius:${emailLayout.tileRadius}px;background-color:#f8fcfd;border:1px solid #c9dfe5;border-top:4px solid #20d8c1;">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#006da6;">${escapeHtml(second.label)}</div>
                      <div style="margin-top:${emailLayout.labelTitleGap}px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#082a3a;">${escapeHtml(second.value)}</div>
                    </td>` : `<td class="snapshot-cell" width="49%">&nbsp;</td>`}
                  </tr>
                  <tr><td colspan="3" height="10" style="height:10px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
                }).join("")}
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:6px;border-collapse:separate;border-spacing:0;border-radius:${emailLayout.tileRadius}px;overflow:hidden;background-color:#00152b;background-image:linear-gradient(135deg,#00152b 0%,#056779 100%);">
                <tr>
                  ${reportSignals.map(([value, label], index) => `
                  <td width="33%" valign="middle" style="padding:16px 18px;border-left:${index ? "1px solid rgba(116,241,215,.3)" : "0"};">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:25px;line-height:29px;font-weight:800;color:#ffffff;">${value}</div>
                    <div style="margin-top:3px;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:15px;font-weight:700;letter-spacing:.8px;color:#74f1d7;">${label}</div>
                  </td>`).join("")}
                </tr>
              </table>

              ${report.priorityActions.length ? `
              <div class="section-pad" style="padding-top:${emailLayout.sectionGap}px;">
                ${htmlSectionHeading(copy.startEyebrow, copy.startTitle, copy.startIntro)}
                <div style="height:16px;font-size:0;line-height:0;">&nbsp;</div>
                ${report.priorityActions.map((action) => htmlActionCard(action, true)).join("")}
              </div>` : ""}

              ${report.laterActions.length ? `
              <div class="section-pad" style="padding-top:${emailLayout.sectionGap}px;">
                ${htmlSectionHeading(
                  report.priorityActions.length
                    ? copy.roadmapEyebrow
                    : copy.completedEyebrow,
                  report.priorityActions.length
                    ? copy.roadmapTitle
                    : copy.completedTitle,
                  report.priorityActions.length
                    ? copy.roadmapIntro
                    : copy.completedIntro,
                )}
                <div style="height:16px;font-size:0;line-height:0;">&nbsp;</div>
                ${report.laterActions.map((action) => htmlActionCard(action, false)).join("")}
              </div>` : ""}

              ${notices.length ? `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:${emailLayout.tileGap}px;border-collapse:separate;border-spacing:0;border-radius:${emailLayout.tileRadius}px;overflow:hidden;background-color:#fff7e5;border:1px solid #e8c66f;border-left:5px solid #e8c66f;">
                <tr>
                  <td style="padding:${emailLayout.tilePaddingY}px ${emailLayout.tilePaddingX}px;border-radius:${emailLayout.tileRadius}px;background-color:#fff7e5;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#6d5315;">Email copy boundary</div>
                    ${notices.map((notice) => `<p style="margin:${emailLayout.titleBodyGap}px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#6d5315;">${escapeHtml(notice)}</p>`).join("")}
                  </td>
                </tr>
              </table>` : ""}

              ${report.everydayActions.length ? `
              <div class="section-pad" style="padding-top:${emailLayout.sectionGap}px;">
                ${htmlSectionHeading(copy.everydayEyebrow, copy.everydayTitle, copy.everydayIntro)}
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:${emailLayout.tileGap}px;border-collapse:separate;border-spacing:0;border-radius:${emailLayout.featureRadius}px;overflow:hidden;background-color:#063448;background-image:linear-gradient(135deg,#04314a 0%,#056779 100%);border-top:6px solid #20d8c1;">
                  <tr><td style="padding:20px;border-radius:${emailLayout.featureRadius}px;background-color:#063448;background-image:linear-gradient(135deg,#04314a 0%,#056779 100%);">
                    ${report.everydayActions.map((action, index) =>
                      htmlEverydayActionTile(
                        action,
                        index === report.everydayActions.length - 1,
                      )
                    ).join("")}
                    <p style="margin:18px 4px 0;padding-top:16px;border-top:1px solid rgba(116,241,215,.32);font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#b9d6e0;">${escapeHtml(report.everydayActionsBoundary)}</p>
                  </td></tr>
                </table>
              </div>` : ""}

              ${report.climate ? `
              <div class="section-pad" style="padding-top:${emailLayout.sectionGap}px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;border-radius:${emailLayout.featureRadius}px;overflow:hidden;background-color:#063448;background-image:linear-gradient(135deg,#00152b 0%,#006da6 100%);border-bottom:6px solid #20d8c1;">
                  <tr><td style="padding:24px 26px;border-radius:${emailLayout.featureRadius}px;background-color:#063448;background-image:linear-gradient(135deg,#00152b 0%,#006da6 100%);">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#74f1d7;">${escapeHtml(copy.climateEyebrow)}</div>
                    <div style="margin-top:${emailLayout.labelTitleGap}px;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;font-weight:800;color:#ffffff;">${escapeHtml(report.climate.label || "Your local planning context")}</div>
                    ${report.climate.summary ? `<p style="margin:${emailLayout.titleBodyGap}px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#cae8f0;">${escapeHtml(report.climate.summary)}</p>` : ""}
                  </td></tr>
                </table>
              </div>` : ""}

              <div class="section-pad" style="padding-top:${emailLayout.sectionGap}px;">
                ${htmlSectionHeading(copy.readinessEyebrow, "How confident is this plan?")}
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:${emailLayout.tileGap}px;border-collapse:separate;border-spacing:0;border-radius:${emailLayout.tileRadius}px;overflow:hidden;background-color:#e8f7f5;border:1px solid #74f1d7;border-top:5px solid #20d8c1;">
                  <tr><td style="padding:${emailLayout.tilePaddingY}px ${emailLayout.tilePaddingX}px;border-radius:${emailLayout.tileRadius}px;background-color:#e8f7f5;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:27px;font-weight:800;color:#063448;">${escapeHtml(readiness.title)}</div>
                    <p style="margin:${emailLayout.titleBodyGap}px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#365467;">${escapeHtml(readiness.body)}</p>
                  </td></tr>
                </table>
                ${professional ? `
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:${emailLayout.tileGap}px;border-collapse:separate;border-spacing:0;border-radius:${emailLayout.tileRadius}px;overflow:hidden;background-color:#f8fcfd;border:1px solid #c9dfe5;border-top:5px solid #00a9e8;">
                  <tr><td style="padding:${emailLayout.tilePaddingY}px ${emailLayout.tilePaddingX}px;border-radius:${emailLayout.tileRadius}px;background-color:#f8fcfd;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#006da6;">${escapeHtml(professional.eyebrow)}</div>
                    <div style="margin-top:${emailLayout.labelTitleGap}px;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:27px;font-weight:800;color:#063448;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(professional.title)}</div>
                    <p style="margin:${emailLayout.titleBodyGap}px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#365467;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml([professional.role, professional.scheme, professional.reference].filter(Boolean).join(" | "))}</p>
                    ${professional.notes ? `<div style="margin-top:${emailLayout.tileGap}px;padding:15px 17px;border-radius:${emailLayout.insetRadius}px;background-color:#e8f7f5;border-left:4px solid #20d8c1;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#365467;overflow-wrap:anywhere;word-break:break-word;"><strong style="color:#063448;">Adviser note</strong><br>${escapeHtml(professional.notes)}</div>` : ""}
                    <p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#536c78;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(professional.boundary)}</p>
                  </td></tr>
                </table>` : ""}
              </div>

              <div class="section-pad" style="padding-top:${emailLayout.sectionGap}px;">
                ${htmlSectionHeading(copy.whyEyebrow, copy.whyTitle)}
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:${emailLayout.tileGap}px;border-collapse:separate;border-spacing:0;border-radius:${emailLayout.tileRadius}px;overflow:hidden;background-color:#e8f7f5;border-left:5px solid #20d8c1;border-top:1px solid #c9dfe5;">
                  <tr><td style="padding:14px 20px 21px;border-radius:${emailLayout.tileRadius}px;background-color:#e8f7f5;">${htmlBulletRows(report.decisionBasis)}</td></tr>
                </table>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:${emailLayout.tileGap}px;border-collapse:separate;border-spacing:0;border-radius:${emailLayout.tileRadius}px;overflow:hidden;background-color:#fff7e5;border:1px solid #e8c66f;">
                  <tr><td style="padding:${emailLayout.tilePaddingY}px ${emailLayout.tilePaddingX}px;border-radius:${emailLayout.tileRadius}px;background-color:#fff7e5;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#6d5315;">When to review this plan</div>
                    <p style="margin:${emailLayout.titleBodyGap}px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#6d5315;">${escapeHtml(report.changeBoundary)}</p>
                  </td></tr>
                </table>
              </div>

              <div class="section-pad" style="padding-top:${emailLayout.sectionGap}px;">
                ${htmlSectionHeading(copy.tradeEyebrow, copy.tradeTitle)}
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:${emailLayout.tileGap}px;border-collapse:separate;border-spacing:0;border-radius:${emailLayout.tileRadius}px;overflow:hidden;background-color:#f8fcfd;border:1px solid #c9dfe5;border-top:5px solid #00a9e8;">
                  <tr><td style="padding:14px 20px 21px;border-radius:${emailLayout.tileRadius}px;background-color:#f8fcfd;">${htmlBulletRows(report.beforeTrade)}</td></tr>
                </table>
              </div>

              ${htmlPrimaryResourceRows(report.resources) ? `
              <div class="section-pad" style="padding-top:${emailLayout.sectionGap}px;">
                ${htmlSectionHeading("Useful next steps", "Check rebates, estimate support and compare energy plans", "These Australian Energy Assessments tools continue the same guided journey.")}
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:${emailLayout.tileGap}px;border-collapse:separate;border-spacing:0;border-radius:${emailLayout.tileRadius}px;background-color:#f8fcfd;border:1px solid #c9dfe5;border-top:5px solid #20d8c1;">
                  <tr><td style="padding:${emailLayout.tilePaddingY}px ${emailLayout.tilePaddingX}px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${htmlPrimaryResourceRows(report.resources)}</table></td></tr>
                </table>
              </div>` : ""}

              <div class="section-pad" style="padding-top:${emailLayout.sectionGap}px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;border-radius:${emailLayout.featureRadius}px;overflow:hidden;background-color:#063448;background-image:linear-gradient(135deg,#00152b 0%,#056779 100%);border-bottom:6px solid #20d8c1;">
                  <tr><td style="padding:26px;border-radius:${emailLayout.featureRadius}px;background-color:#063448;background-image:linear-gradient(135deg,#00152b 0%,#056779 100%);">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#74f1d7;">${escapeHtml(copy.privacyEyebrow)}</div>
                    <div style="margin-top:${emailLayout.labelTitleGap}px;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;font-weight:800;color:#ffffff;">${escapeHtml(copy.privacyTitle)}</div>
                    <p style="margin:${emailLayout.titleBodyGap}px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#cae8f0;">${escapeHtml(report.privacyNote)}</p>
                    <p style="margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#b9d6e0;">${escapeHtml(report.adviceBoundary)}</p>
                  </td></tr>
                </table>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;border-radius:0 0 ${emailLayout.shellRadius}px ${emailLayout.shellRadius}px;background-color:#00152b;border-top:2px solid #20d8c1;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:#b9d6e0;">
              Prepared ${escapeHtml(report.displayDate || report.preparedDate)} from the saved plan. ${escapeHtml(copy.footer)}.
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
  return html
    .replace(/>\s+</g, "><")
    .replace(/\r?\n\s*/g, "")
    .trim();
}

export function customerPlanDocumentHtml(document) {
  return createCustomerPlanEmailRendering(document).html;
}

function renderCustomerPlanDocumentText(report, notices = []) {
  const copy = report.copy;
  const professional = report.professionalPresentation;
  const lines = [
    copy.brand,
    copy.heroTitle,
    report.planTitle,
    `Prepared ${report.displayDate || report.preparedDate}`,
    "",
    report.summary,
    "",
    copy.snapshotEyebrow.toUpperCase(),
    ...report.planningSnapshot.map((item) => `${item.label}: ${item.value}`),
  ];
  if (report.priorityActions.length) {
    lines.push("", copy.startEyebrow.toUpperCase(), copy.startIntro);
    for (const action of report.priorityActions) {
      lines.push(
        "",
        `${String(action.number).padStart(2, "0")}. ${action.title}${action.completed ? " [completed]" : ""}`,
        action.stage,
        `What to do: ${action.whatToDo || action.description}`,
        `Why it matters: ${action.whyItMatters}`,
        `Why this applies to your home: ${action.householdReason}`,
        "Confirm before quoting:",
        ...action.confirmBeforeWork.map((item) => `- ${item}`),
        "Quote and evidence checklist:",
        ...action.quoteChecklist.map((item) => `- ${item}`),
        `Sequence and dependencies: ${action.sequence}`,
        `Safety boundary: ${action.safety}`,
      );
      if (action.guideHref) {
        lines.push(
          `${action.guideLabel || copy.guideLabel}: ${
            absoluteGuideHref(action.guideHref)
          }`,
        );
      }
    }
  }
  if (report.laterActions.length) {
    lines.push(
      "",
      (
        report.priorityActions.length
          ? copy.roadmapEyebrow
          : copy.completedEyebrow
      ).toUpperCase(),
      report.priorityActions.length
        ? copy.roadmapIntro
        : copy.completedIntro,
    );
    for (const action of report.laterActions) {
      lines.push(
        "",
        `${String(action.number).padStart(2, "0")}. ${action.title}${action.completed ? " [completed]" : ""}`,
        action.stage,
        `What to do: ${action.whatToDo || action.description}`,
        `Why it matters: ${action.whyItMatters}`,
        `Why this applies to your home: ${action.householdReason}`,
        "Confirm before quoting:",
        ...action.confirmBeforeWork.map((item) => `- ${item}`),
        "Quote and evidence checklist:",
        ...action.quoteChecklist.map((item) => `- ${item}`),
        `Sequence and dependencies: ${action.sequence}`,
        `Safety boundary: ${action.safety}`,
      );
      if (action.guideHref) {
        lines.push(
          `${action.guideLabel || copy.guideLabel}: ${
            absoluteGuideHref(action.guideHref)
          }`,
        );
      }
    }
  }
  if (notices.length) {
    lines.push("", "EMAIL COPY BOUNDARY", ...notices);
  }
  if (report.everydayActions.length) {
    lines.push(
      "",
      copy.everydayEyebrow.toUpperCase(),
      copy.everydayIntro,
    );
    for (const action of report.everydayActions) {
      lines.push(
        "",
        `${action.category}: ${action.title}`,
        action.description,
        action.outcome ? `Why try it: ${action.outcome}` : "",
      );
    }
    lines.push("", report.everydayActionsBoundary);
  }
  if (report.climate) {
    lines.push(
      "",
      copy.climateEyebrow.toUpperCase(),
      report.climate.label,
      report.climate.summary,
    );
  }
  lines.push(
    "",
    "HOW CONFIDENT IS THIS PLAN?",
    report.readinessPresentation.title,
    report.readinessPresentation.body,
  );
  if (professional) {
    lines.push(
      "",
      professional.eyebrow.toUpperCase(),
      professional.title,
      [professional.role, professional.scheme, professional.reference]
        .filter(Boolean)
        .join(" | "),
    );
    if (professional.notes) {
      lines.push("Adviser note:", professional.notes);
    }
    lines.push(professional.boundary);
  }
  lines.push(
    "",
    copy.whyEyebrow.toUpperCase(),
    ...report.decisionBasis.map((item) => `- ${item}`),
    "",
    "WHEN TO REVIEW THIS PLAN",
    report.changeBoundary,
    "",
    copy.tradeEyebrow.toUpperCase(),
    ...report.beforeTrade.map((item) => `- ${item}`),
    "",
    "USEFUL NEXT STEPS",
    ...report.resources.slice(0, 6).map((resource) =>
      `${resource.label}: ${absolutePlanResourceHref(resource.href)}`
    ),
    "",
    copy.privacyEyebrow.toUpperCase(),
    report.privacyNote,
    "",
    report.adviceBoundary,
  );
  return lines.filter((line, index) => line !== "" || lines[index - 1] !== "").join("\n").trim();
}

export function customerPlanDocumentText(document) {
  const rendering = createCustomerPlanEmailRendering(document);
  return renderCustomerPlanDocumentText(
    rendering.report,
    rendering.notices,
  );
}
