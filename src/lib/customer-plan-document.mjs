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
export const CUSTOMER_PLAN_DOCUMENT_VERSION = "2026-07-29-plan-document-v2";
export const CUSTOMER_PLAN_REPORT_VERSION = "2026-07-29-premium-report-v3";
export const INSTALLER_ENQUIRY_PACK_VERSION =
  "2026-07-31-installer-enquiry-pack-v1";
export const CUSTOMER_PLAN_EMAIL_SUBJECT = "Your home energy plan is ready";
export const CUSTOMER_PLAN_PUBLIC_ORIGIN = "https://compare.ausenergyassessments.com";
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

const evidenceSourceLabels = new Map([
  ["unknown", "Not known or not checked"],
  ["customer-reported", "Customer reported"],
  ["photo-supported", "Photo recorded in the private project"],
  ["document-supported", "Document recorded in the private project"],
]);

const readinessFactKeyByQuestion = new Map([
  ["comfort-concerns", "draughts"],
  ["ventilation-features", "ventilation"],
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
  "use-existing-controls",
  "safe-seasonal-airflow",
  "seasonal-window-and-landscape",
  "renter-friendly-diy-boundary",
]);

const optionLabel = (options, value, fallback = "") => (
  options.find(([key]) => key === value)?.[1] || fallback
);

const boundedText = (value, maximum = 800) => (
  typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
);

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
  const actions = controlledItems.map((item, index) => {
    const safeItem = privacySafeControlledItem(item);
    const href = safeGuideHref(safeItem.href);
    return {
      number: index + 1,
      id: boundedText(safeItem.id, 80),
      stage: boundedText(safeItem.stage, 100),
      title: boundedText(safeItem.title, 180),
      description: boundedText(safeItem.text, 900),
      completed: completedIds.has(safeItem.id),
      guideLabel: href ? boundedText(safeItem.action, 120) : "",
      guideHref: href,
      guidance: safeGuidance(safeItem.guidance),
    };
  });
  const goalLabels = goals
    .map((goal) => optionLabel(customerProjectOptions.goals, goal))
    .filter(Boolean)
    .slice(0, 10);
  const questions = Array.isArray(generatedPlan.nextQuestions)
    ? generatedPlan.nextQuestions.slice(0, 3).map((question, index) => ({
      number: index + 1,
      prompt: boundedText(question?.prompt, 240),
      whyItMatters: boundedText(question?.whyItMatters, 360),
    })).filter((question) => question.prompt)
    : [];
  const everydayActions = Array.isArray(generatedPlan.everydayActions)
    ? generatedPlan.everydayActions
      .filter((item) => allowedEverydayActionIds.has(item?.id))
      .slice(0, 6)
      .map((item) => ({
        id: boundedText(item.id, 80),
        category: boundedText(item.category, 100),
        title: boundedText(item.title, 180),
        description: boundedText(item.text, 900),
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
    questions,
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
    adviceBoundary: "This plan is independent general guidance. It is not a quote, product endorsement, home energy rating, equipment sizing result or savings promise. Confirm safety, permissions, suitability and current incentives before committing to work.",
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
    message: "This starter roadmap uses the choices recorded here. Review the open questions before treating the order as final.",
    boundary: "These details were supplied by the household and have not been professionally checked.",
  };
}

export function createCustomerPlanReportView(document) {
  const sourceActions = Array.isArray(document?.actions)
    ? document.actions.slice(0, 40)
    : [];
  const priorityIndexes = new Set(
    sourceActions
      .map((action, index) => ({ action, index }))
      .filter(({ action }) => action?.completed !== true)
      .slice(0, 3)
      .map(({ index }) => index),
  );
  const actions = sourceActions.map((action, index) => {
    const guideHref = safeGuideHref(action?.guideHref || action?.href);
    return {
      number: Number.isFinite(Number(action?.number))
        ? Number(action.number)
        : index + 1,
      id: boundedText(action?.id, 80) || `report-action-${index + 1}`,
      stage: boundedText(action?.stage, 100),
      title: boundedText(action?.title, 180),
      description: boundedText(action?.description || action?.text, 900),
      completed: action?.completed === true,
      priority: priorityIndexes.has(index),
      guideLabel: guideHref
        ? boundedText(action?.guideLabel || action?.action, 120)
          || "Open the related guide"
        : "",
      guideHref,
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
  );
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
  const questions = readiness.missingLabels.length
    ? readiness.missingLabels.map((label, index) => ({
      number: index + 1,
      prompt: label,
      whyItMatters: "Choose the answer that best fits this home. Not sure remains a valid answer.",
    }))
    : (Array.isArray(document?.questions) ? document.questions : [])
      .slice(0, 3)
      .map((question, index) => ({
        number: index + 1,
        prompt: boundedText(question?.prompt, 240),
        whyItMatters: boundedText(question?.whyItMatters, 360),
      }))
      .filter((question) => question.prompt);
  const overview = document?.overview && typeof document.overview === "object"
    ? document.overview
    : {};
  const goals = boundedStringList(overview.goals, 10, 120);
  const homeDetails = boundedStringList(overview.homeDetails, 5, 120);
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
      label: "Home details",
      value: homeDetails.join(", ") || "Not recorded",
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
      label: "Plan boundary",
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
    .slice(0, 12)
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
      }];
    })
    .slice(0, 6);
  const displayDate = customerPlanDisplayDate(
    boundedText(document?.preparedDate, 20),
  );
  const readinessPresentation = customerPlanReadinessPresentation(
    readiness,
    professionalReview,
  );
  const professionalPresentation =
    customerPlanProfessionalPresentation(professionalReview);
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
    copy: customerPlanReportCopy,
    planningSnapshot,
    climate: climate?.label || climate?.summary ? climate : null,
    readiness,
    readinessPresentation,
    professionalReview,
    professionalPresentation,
    questions,
    decisionBasis,
    everydayActions,
    everydayActionsBoundary: boundedText(
      document?.everydayActionsBoundary,
      700,
    ) || CUSTOMER_EVERYDAY_ACTIONS_BOUNDARY,
    actions,
    priorityActions: actions.filter((action) => action.priority),
    laterActions: actions.filter((action) => !action.priority),
    changeBoundary: "New evidence or a licensed site check can change safety, capacity, access or the recommended sequence.",
    beforeTrade: [
      "Confirm any owner, agent, strata or owners-corporation approval in writing before fixed or shared-property work.",
      "Use appropriately licensed trades for regulated electrical, plumbing, gas and building work.",
      "Compare written scopes, inclusions, exclusions, warranties and current official incentives before committing.",
    ],
    privacyNote: boundedText(document?.privacyNote, 700)
      || "Private account details and customer-written notes are not included in this shared copy.",
    adviceBoundary: boundedText(document?.adviceBoundary, 700)
      || "This plan is independent general guidance, not a quote, product endorsement, site assessment or savings promise.",
  };
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
    questions: report.questions.map((question) => ({
      ...question,
      prompt: trim(question.prompt, 180),
      whyItMatters: trim(question.whyItMatters, 240),
    })),
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
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 ${emailLayout.tileGap}px;border-collapse:separate;border-spacing:0;border-radius:${emailLayout.tileRadius}px;overflow:hidden;${surface}">
      <tr>
        <td width="62" valign="top" style="padding:${emailLayout.tilePaddingY}px 0 ${emailLayout.tilePaddingY}px ${emailLayout.tilePaddingX}px;${cellSurface}border-radius:${emailLayout.tileRadius}px 0 0 ${emailLayout.tileRadius}px;">
          <div style="width:40px;padding:10px 0;border-radius:${emailLayout.badgeRadius}px;background-color:${action.completed ? "#047857" : priority ? "#00a9e8" : "#063448"};font-family:Arial,Helvetica,sans-serif;font-size:${action.completed ? "11px" : "13px"};line-height:20px;font-weight:700;text-align:center;color:#ffffff;">${escapeHtml(number)}</div>
        </td>
        <td valign="top" style="padding:${emailLayout.tilePaddingY}px ${emailLayout.tilePaddingX}px ${emailLayout.tilePaddingY}px 16px;${cellSurface}border-radius:0 ${emailLayout.tileRadius}px ${emailLayout.tileRadius}px 0;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;color:${labelColor};">${escapeHtml(priority ? `Start here | ${action.stage}` : action.stage)}</div>
          <h3 style="margin:${emailLayout.labelTitleGap}px 0 ${emailLayout.titleBodyGap}px;font-family:Arial,Helvetica,sans-serif;font-size:${priority ? "22px" : "19px"};line-height:${priority ? "27px" : "24px"};font-weight:800;letter-spacing:-.25px;color:${titleColor};">${escapeHtml(action.title)}</h3>
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:${bodyColor};">${escapeHtml(action.description)}</p>
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
        </td>
      </tr>
    </table>`;
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
      [report.questions.length, "CHECK FIRST"],
    ]
    : [
      [report.priorityActions.length, "START NOW"],
      [report.laterActions.length, "PLAN NEXT"],
      [report.questions.length, "CHECK FIRST"],
    ];
  const preheader = planComplete
    ? `${report.planTitle}. Every current step is marked complete.${
      report.questions.length
        ? ` Check ${report.questions.length} open home detail${report.questions.length === 1 ? "" : "s"}.`
        : ""
    }`
    : report.questions.length
      ? `${report.planTitle}. Start with your first three steps and check ${report.questions.length} open home detail${report.questions.length === 1 ? "" : "s"}.`
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
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:${emailLayout.tileGap}px;border-collapse:separate;border-spacing:0;border-radius:${emailLayout.tileRadius}px;overflow:hidden;background-color:${report.questions.length ? "#fff7e5" : "#e8f7f5"};border:1px solid ${report.questions.length ? "#e8c66f" : "#74f1d7"};border-top:5px solid ${report.questions.length ? "#e8c66f" : "#20d8c1"};">
                  <tr><td style="padding:${emailLayout.tilePaddingY}px ${emailLayout.tilePaddingX}px;border-radius:${emailLayout.tileRadius}px;background-color:${report.questions.length ? "#fff7e5" : "#e8f7f5"};">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:27px;font-weight:800;color:${report.questions.length ? "#6d5315" : "#063448"};">${escapeHtml(readiness.title)}</div>
                    <p style="margin:${emailLayout.titleBodyGap}px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:${report.questions.length ? "#6d5315" : "#365467"};">${escapeHtml(readiness.body)}</p>
                    ${report.questions.length ? htmlBulletRows(report.questions.map((question) => `${question.prompt}: ${question.whyItMatters}`), { color: "#6d5315" }) : ""}
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
        action.description,
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
        action.description,
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
  if (report.questions.length) {
    for (const question of report.questions) {
      lines.push(
        `${question.number}. ${question.prompt}`,
        question.whyItMatters,
      );
    }
  }
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
