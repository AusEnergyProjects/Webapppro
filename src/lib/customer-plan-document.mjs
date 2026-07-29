import {
  createCustomerPermissionPack,
  createCustomerProjectPlan,
  customerAdvisorOptions,
  customerHomeFeatureSections,
  customerProjectOptions,
  derivePlanningClimateProfile,
  normalizeHomeFeatureSelections,
  normalizeCustomerAdvisorProfile,
  parseStoredJson,
} from "./customer-projects.mjs";

export const CUSTOMER_PLAN_DOCUMENT_VERSION = "2026-07-29-plan-document-v1";
export const CUSTOMER_PLAN_REPORT_VERSION = "2026-07-29-concise-report-v1";
export const CUSTOMER_PLAN_EMAIL_SUBJECT = "Your independent home energy plan";
export const CUSTOMER_PLAN_PUBLIC_ORIGIN = "https://compare.ausenergyassessments.com";

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
  return {
    factEvidence: facts,
    rooms,
    permissionItems: [],
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
  const readiness = createCustomerPlanReadiness(existingFeatures, evidence);
  const propertyContext = parsedObject(row.property_context);
  const sourceAdvisorProfile = parsedObject(row.advisor_profile);
  const advisorProfile = safeAdvisorProfile(sourceAdvisorProfile);
  const planningAdvisorProfile = normalizeCustomerAdvisorProfile(
    sourceAdvisorProfile,
    {
      postcode: boundedText(row.postcode, 4),
      addressState: boundedText(row.address_state, 4),
      householdSituation: boundedText(row.household_situation, 40),
      approvalContext: boundedText(propertyContext.approvalContext, 40),
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
  const readiness = reportReadiness(document);
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
  return {
    version: CUSTOMER_PLAN_REPORT_VERSION,
    heading: boundedText(document?.heading, 180)
      || "Your independent home energy plan",
    planTitle: boundedText(document?.planTitle, 180)
      || "An evidence-led home energy plan",
    summary: boundedText(document?.summary, 480),
    preparedDate: boundedText(document?.preparedDate, 20),
    planningSnapshot,
    climate: climate?.label || climate?.summary ? climate : null,
    readiness,
    questions,
    decisionBasis,
    actions,
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

function htmlList(items) {
  if (!items.length) return "";
  return `<ul style="margin:8px 0 0;padding-left:20px;color:#29453d;">${items
    .map((item) => `<li style="margin:4px 0;">${escapeHtml(item)}</li>`)
    .join("")}</ul>`;
}

export function customerPlanDocumentHtml(document) {
  const report = createCustomerPlanReportView(document);
  const preheader = report.questions.length
    ? `${report.planTitle}. Review ${report.questions.length} open question${report.questions.length === 1 ? "" : "s"} before treating the order as final.`
    : `${report.planTitle}. Your ordered independent home energy roadmap.`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${escapeHtml(report.heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:#edf5f1;color:#0a2e3f;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf5f1;">
      <tr><td align="center" style="padding:28px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #c7ddd5;">
          <tr>
            <td style="padding:34px;background:#063448;color:#ffffff;border-bottom:6px solid #20d8c1;">
              <div style="color:#63f1cd;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;">Australian Energy Assessments</div>
              <h1 style="margin:12px 0 8px;font-family:Georgia,serif;font-size:34px;line-height:1.12;color:#ffffff;">${escapeHtml(report.heading)}</h1>
              <p style="margin:0;color:#d8ebf0;font-size:16px;line-height:1.55;">${escapeHtml(report.planTitle)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 34px;">
              <p style="margin:0 0 20px;color:#355a62;font-size:15px;line-height:1.6;">${escapeHtml(report.summary)}</p>
              <div style="color:#0a704d;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">Your planning snapshot</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:9px 0 20px;border:1px solid #d5e5df;border-radius:12px;background:#f3f8f6;">
                ${report.planningSnapshot.map((item) => `
                <tr>
                  <td width="145" valign="top" style="padding:10px 14px;color:#0a704d;font-size:12px;font-weight:700;">${escapeHtml(item.label)}</td>
                  <td valign="top" style="padding:10px 14px;color:#29453d;font-size:14px;line-height:1.45;">${escapeHtml(item.value)}</td>
                </tr>`).join("")}
              </table>
              ${report.climate ? `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;background:#edf7f3;border-left:4px solid #13aa78;">
                <tr><td style="padding:14px 16px;">
                  <strong style="color:#0a704d;font-size:13px;">${escapeHtml(report.climate.label || "Broad climate planning context")}</strong>
                  ${report.climate.summary ? `<p style="margin:5px 0 0;color:#355a52;font-size:13px;line-height:1.5;">${escapeHtml(report.climate.summary)}</p>` : ""}
                </td></tr>
              </table>` : ""}
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;background:#fff8e8;border:1px solid #ead8aa;border-radius:12px;">
                <tr><td style="padding:16px;">
                  <div style="color:#7b5c0b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Before spending money</div>
                  <p style="margin:7px 0 0;color:#68561d;font-size:14px;line-height:1.5;">${escapeHtml(report.readiness.message)}</p>
                  <p style="margin:5px 0 0;color:#7a672f;font-size:12px;line-height:1.5;">${escapeHtml(report.readiness.boundary)}</p>
                  ${report.questions.length ? htmlList(report.questions.map((question) => `${question.prompt} ${question.whyItMatters}`)) : ""}
                </td></tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;background:#f3f8f6;border:1px solid #d5e5df;border-radius:12px;">
                <tr><td style="padding:16px;">
                  <div style="color:#0a704d;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Why this order</div>
                  ${htmlList(report.decisionBasis)}
                </td></tr>
              </table>
              <div style="color:#0a704d;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">Your ordered roadmap</div>
              <h2 style="margin:7px 0 6px;font-family:Georgia,serif;font-size:28px;color:#0a2e3f;">What to consider, in order</h2>
              <p style="margin:0 0 18px;color:#62776f;font-size:13px;line-height:1.5;">The first three unfinished steps are highlighted. Every remaining step stays in its original order.</p>
              ${report.actions.map((action) => {
                const guideHref = absoluteGuideHref(action.guideHref);
                return action.priority ? `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 12px;border:2px solid #9fd3c3;border-radius:14px;background:#f7fcfa;">
                <tr>
                  <td width="54" valign="top" style="padding:16px 0 16px 16px;">
                    <div style="width:36px;height:36px;line-height:36px;text-align:center;border-radius:11px;background:#073b4c;color:#ffffff;font-size:13px;font-weight:700;">${String(action.number).padStart(2, "0")}</div>
                  </td>
                  <td valign="top" style="padding:16px;">
                    <div style="color:#087952;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Priority step</div>
                    <div style="color:#0a8c61;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">${escapeHtml(action.stage)}</div>
                    <h3 style="margin:4px 0 7px;font-family:Georgia,serif;font-size:20px;line-height:1.3;color:#0a2e3f;">${escapeHtml(action.title)}</h3>
                    <p style="margin:0;color:#48645c;font-size:14px;line-height:1.55;">${escapeHtml(action.description)}</p>
                    ${guideHref ? `<p style="margin:12px 0 0;"><a href="${escapeHtml(guideHref)}" style="color:#087952;font-size:13px;font-weight:700;text-decoration:underline;">${escapeHtml(action.guideLabel || "Open the related guide")}</a></p>` : ""}
                  </td>
                </tr>
              </table>` : `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 8px;border:1px solid #d5e5df;border-radius:10px;background:#ffffff;">
                <tr>
                  <td width="46" valign="top" style="padding:12px 0 12px 12px;color:${action.completed ? "#0a704d" : "#073b4c"};font-size:12px;font-weight:700;">${action.completed ? "Done" : String(action.number).padStart(2, "0")}</td>
                  <td valign="top" style="padding:12px;">
                    <div style="color:#0a8c61;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(action.stage)}</div>
                    <h3 style="margin:3px 0 4px;font-family:Georgia,serif;font-size:17px;line-height:1.3;color:#0a2e3f;">${escapeHtml(action.title)}</h3>
                    <p style="margin:0;color:#48645c;font-size:13px;line-height:1.5;">${escapeHtml(action.description)}</p>
                    ${guideHref ? `<p style="margin:8px 0 0;"><a href="${escapeHtml(guideHref)}" style="color:#087952;font-size:12px;font-weight:700;text-decoration:underline;">${escapeHtml(action.guideLabel || "Open the related guide")}</a></p>` : ""}
                  </td>
                </tr>
              </table>`;
              }).join("")}
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0 0;background:#fff8e8;border-left:4px solid #c49723;">
                <tr><td style="padding:16px;">
                  <strong style="color:#6d520b;font-size:14px;">What could change this order</strong>
                  <p style="margin:6px 0 0;color:#68561d;font-size:13px;line-height:1.5;">${escapeHtml(report.changeBoundary)}</p>
                </td></tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 0;background:#f3f8f6;border:1px solid #d5e5df;border-radius:12px;">
                <tr><td style="padding:16px;">
                  <div style="color:#0a704d;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Before engaging a trade</div>
                  ${htmlList(report.beforeTrade)}
                </td></tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 0;background:#edf7f3;border-left:4px solid #13aa78;">
                <tr><td style="padding:16px;">
                  <strong style="color:#0a704d;font-size:14px;">Private by design</strong>
                  <p style="margin:6px 0 0;color:#355a52;font-size:13px;line-height:1.55;">${escapeHtml(report.privacyNote)}</p>
                </td></tr>
              </table>
              <p style="margin:18px 0 0;color:#62776f;font-size:12px;line-height:1.55;">${escapeHtml(report.adviceBoundary)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 34px;background:#062f40;color:#cfe2e7;font-size:12px;line-height:1.5;">
              Prepared ${escapeHtml(report.preparedDate)} by Australian Energy Assessments. Product and service brands are not selected or endorsed in this plan.
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function customerPlanDocumentText(document) {
  const report = createCustomerPlanReportView(document);
  const lines = [
    report.heading,
    report.planTitle,
    `Prepared ${report.preparedDate}`,
    "",
    report.summary,
    "",
    "YOUR PLANNING CONTEXT",
    ...report.planningSnapshot.map((item) => `${item.label}: ${item.value}`),
    "",
    "BEFORE SPENDING MONEY",
    report.readiness.message,
    report.readiness.boundary,
  ];
  if (report.questions.length) {
    for (const question of report.questions) {
      lines.push(
        `${question.number}. ${question.prompt}`,
        question.whyItMatters,
      );
    }
  }
  if (report.climate) {
    lines.push(
      "",
      "BROAD CLIMATE PLANNING CONTEXT",
      report.climate.label,
      report.climate.summary,
    );
  }
  lines.push("", "WHY THIS ORDER", ...report.decisionBasis.map((item) => `- ${item}`));
  lines.push("", "ORDERED ROADMAP");
  for (const action of report.actions) {
    lines.push(
      "",
      `${String(action.number).padStart(2, "0")}. ${action.title}${action.completed ? " [completed]" : action.priority ? " [priority]" : ""}`,
      action.stage,
      action.description,
    );
    if (action.guideHref) {
      lines.push(`${action.guideLabel || "Related guide"}: ${absoluteGuideHref(action.guideHref)}`);
    }
  }
  lines.push(
    "",
    "WHAT COULD CHANGE THIS ORDER",
    report.changeBoundary,
    "",
    "BEFORE ENGAGING A TRADE",
    ...report.beforeTrade.map((item) => `- ${item}`),
    "",
    "PRIVATE BY DESIGN",
    report.privacyNote,
    "",
    "IMPORTANT BOUNDARY",
    report.adviceBoundary,
  );
  return lines.filter((line, index) => line !== "" || lines[index - 1] !== "").join("\n").trim();
}
