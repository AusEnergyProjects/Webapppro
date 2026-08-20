export const SOLAR_STC_SLOT_ORDER = [
  "location",
  "installationDate",
  "technology",
  "projectType",
  "capacity",
  "existingComponents",
  "approvedProducts",
  "accreditedDelivery",
  "requestedOutcome",
  "stateContext",
] as const;

export type SolarStcSlot = typeof SOLAR_STC_SLOT_ORDER[number];

export const SOLAR_STC_SLOT_QUESTIONS: Readonly<Record<SolarStcSlot, string>> = {
  location: "What is the installation postcode, or the STC zone if it has already been verified?",
  installationDate: "What is the proposed installation date?",
  technology: "Is the work solar PV, a battery, or both?",
  projectType: "Is this a completely new system, a replacement, or added capacity?",
  capacity: "What exact PV kW and, if relevant, battery kWh capacity is proposed?",
  existingComponents: "Which panels, inverter or battery already exist and will remain connected?",
  approvedProducts: "What are the exact panel, inverter and battery brand and model numbers, and have they been checked on the current approved lists?",
  accreditedDelivery: "Has an appropriately accredited installer and, if applicable, registered certificate agent been identified?",
  requestedOutcome: "Do you need the certificate quantity, or the separate dollar discount an installer or agent proposes on the quote?",
  stateContext: "Which state or territory programme context should be checked separately from federal STCs?",
};

export const DRAUGHT_SLOT_ORDER = [
  "building",
  "comfort",
  "moisture",
  "heating",
] as const;

export type DraughtSlot = typeof DRAUGHT_SLOT_ORDER[number];

export const DRAUGHT_SLOT_QUESTIONS: Readonly<Record<DraughtSlot, string>> = {
  building: "What building type, age and construction are you dealing with?",
  comfort: "Where and when are the draught or comfort problems most noticeable?",
  moisture: "Is there condensation, mould, dampness or another moisture problem, including none that you have noticed?",
  heating: "What heating, fireplace or other combustion equipment is installed?",
};

export const EV_CHARGING_SLOT_ORDER = [
  "vehicle",
  "dailyUse",
  "siteSupply",
  "tariffSolar",
] as const;

export type EvChargingSlot = typeof EV_CHARGING_SLOT_ORDER[number];

export const EV_CHARGING_SLOT_QUESTIONS: Readonly<Record<EvChargingSlot, string>> = {
  vehicle: "What is the exact vehicle model and its onboard AC charging limit?",
  dailyUse: "How far is it normally driven each day and how long is it parked at home?",
  siteSupply: "What supply, switchboard and available circuit capacity has a licensed electrician confirmed?",
  tariffSolar: "What tariff window and available solar generation should charging use?",
};

export const HEAT_PUMP_SELECTION_SLOT_ORDER = [
  "purpose",
  "climate",
  "demand",
  "site",
  "temperaturePerformance",
  "officialEligibility",
  "refrigerantControls",
  "support",
  "quoteEvidence",
] as const;

export type HeatPumpSelectionSlot = typeof HEAT_PUMP_SELECTION_SLOT_ORDER[number];

export const HEAT_PUMP_SELECTION_SLOT_QUESTIONS: Readonly<Record<HeatPumpSelectionSlot, string>> = {
  purpose: "Is this for space heating and cooling, hot water, or solar water heating?",
  climate: "What is the property postcode?",
  demand: "What measured or calculated room heat load, or household hot-water demand, must it meet?",
  site: "What electrical supply, installation space, noise limits and condensate or drainage route apply?",
  temperaturePerformance: "What delivered capacity retention and efficiency at the relevant outdoor temperature does the official data show?",
  officialEligibility: "Has the exact model been checked in GEMS or Energy Rating and, where relevant, the CER and current state eligibility lists?",
  refrigerantControls: "What refrigerant, operating controls, timers and demand-management features are specified?",
  support: "What written warranty, Australian service coverage, parts pathway and response terms are included?",
  quoteEvidence: "Does the written quote identify the exact model, capacity, electrical and hydraulic work, commissioning, exclusions and evidence?",
};

export type TradePlatformTask = {
  id: "dashboard" | "jobs_schedule" | "calculator" | "forms_evidence" | "quotes_invoices" | "standards";
  label: string;
  priority?: number;
  signals: RegExp;
  directAnswer: string;
  steps: readonly string[];
  actions: readonly { id: string; label: string; href: string }[];
};

export const TRADE_PLATFORM_TASKS: readonly TradePlatformTask[] = [
  {
    id: "jobs_schedule",
    label: "jobs and schedule",
    signals: /\b(?:job|jobs|schedule|calendar|appointment|dispatch)\b/i,
    directAnswer: "Use the TLink dashboard Work area for jobs and its Schedule view for calendar planning. The guide can explain the route, but it does not read or change any customer, job or team record.",
    steps: [
      "Open the TLink dashboard and choose Work.",
      "Use Jobs for the job list or Schedule for calendar planning.",
      "Open the exact job only after confirming you are in the correct signed-in business account.",
    ],
    actions: [{ id: "open-trade-work", label: "Open TLink jobs and schedule", href: "/direct-trade/dashboard" }],
  },
  {
    id: "calculator",
    label: "calculator",
    signals: /\b(?:calculator|calculate|certificate|rebate estimate|stc|veec|esc|prc)\b/i,
    directAnswer: "Use the source-verified calculator to prepare an estimate for a quote or invoice. Keep the jurisdiction, installation date, exact approved product and site facts with the calculation; the estimate does not create or register a certificate.",
    steps: [
      "Open the calculator and choose the correct jurisdiction and programme pathway.",
      "Enter the installation date, property facts and exact approved product details.",
      "Save the resulting estimate with the quote or job evidence without representing it as a registered certificate.",
    ],
    actions: [{ id: "open-trade-calculator", label: "Open the source-verified calculator", href: "/calculator" }],
  },
  {
    id: "forms_evidence",
    label: "forms and evidence",
    priority: 40,
    signals: /\b(?:form|forms|evidence|photo|photos|document|documents|proof|proofs|prove|proving|defensible|evidence note|approved job record|installed product|installed inverter|match(?:es|ing)? (?:the )?(?:approved|job) record|upload|attachment|audit trail|sign-off|compliance)\b/i,
    directAnswer: "Use the Creditex workspace for governed forms and evidence preparation. The guide can explain required workflow boundaries, but it does not open private job evidence or decide that evidence is compliant.",
    steps: [
      "Open Creditex and select the correct programme and activity pathway.",
      "Bind forms and evidence to the exact job, product, installer and installation event.",
      "Complete the applicable review and finalisation controls before any submission or certificate claim.",
    ],
    actions: [{ id: "open-creditex", label: "Open Creditex forms and evidence", href: "/creditex/compliance" }],
  },
  {
    id: "quotes_invoices",
    label: "quotes and invoices",
    signals: /\b(?:quote|quotes|invoice|invoices|payment|price)\b/i,
    directAnswer: "Use the TLink dashboard for trade quotes and invoices. Keep customer approval, certificate estimates, final scope and payment status separate; the guide does not read the private commercial record.",
    steps: [
      "Open the relevant customer or job from the TLink dashboard.",
      "Prepare the quote with the current scope and clearly labelled estimates.",
      "Create or open the invoice only from the accepted scope and verify delivery and payment status in the signed-in workspace.",
    ],
    actions: [{ id: "open-trade-commercial", label: "Open TLink quotes and invoices", href: "/direct-trade/dashboard" }],
  },
  {
    id: "standards",
    label: "standards",
    signals: /\b(?:standard|standards|rule|rules|marketplace requirement|customer standard)\b/i,
    directAnswer: "Use TLink standards for current platform and customer-work expectations, then use the applicable official scheme instrument for technical eligibility. Platform guidance does not replace licensing, accreditation or programme rules.",
    steps: [
      "Open TLink standards and identify the platform or customer-work requirement.",
      "Confirm the separate official technical or programme rule for the jurisdiction and date.",
      "Keep the applicable source and evidence with the job record.",
    ],
    actions: [{ id: "open-trade-standards", label: "Open TLink standards", href: "/direct-trade/standards" }],
  },
  {
    id: "dashboard",
    label: "dashboard overview",
    signals: /\b(?:dashboard|tlink|platform|workspace|where do i start)\b/i,
    directAnswer: "Use the TLink dashboard as the signed-in trade operations entry point. The guide provides navigation and workflow guidance only and does not read private customers, jobs, quotes, invoices or evidence.",
    steps: [
      "Open the TLink dashboard in the correct business account.",
      "Choose Work, Schedule, Invoices, Calculator or the relevant operational area.",
      "Confirm the customer or job before changing any private record.",
    ],
    actions: [{ id: "open-trade-dashboard", label: "Open the TLink dashboard", href: "/direct-trade/dashboard" }],
  },
];
