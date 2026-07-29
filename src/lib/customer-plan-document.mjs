import {
  createCustomerPermissionPack,
  createCustomerProjectPlan,
  customerProjectOptions,
  derivePlanningClimateProfile,
  normalizeCustomerAdvisorProfile,
  parseStoredJson,
} from "./customer-projects.mjs";

export const CUSTOMER_PLAN_DOCUMENT_VERSION = "2026-07-29-plan-document-v1";
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
  const sources = new Map();
  for (const item of Array.isArray(profile.factEvidence) ? profile.factEvidence : []) {
    const key = boundedText(item?.factKey, 80);
    const source = evidenceSourceLabels.has(item?.source) ? item.source : "unknown";
    if (key) sources.set(key, source);
  }
  const total = 12;
  const known = [...sources.values()].filter((source) => source !== "unknown").length;
  const bySource = [...evidenceSourceLabels.entries()].map(([source, label]) => ({
    source,
    label,
    count: [...sources.values()].filter((value) => value === source).length,
  }));
  return { total, known, unknown: Math.max(0, total - known), bySource };
}

export function createCustomerPlanDocument(row, { preparedAt = new Date().toISOString() } = {}) {
  const goals = parsedArray(row.goals);
  const existingFeatures = parsedArray(row.existing_features);
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
    evidence: evidenceSummary(advisorProfile),
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

function htmlList(items) {
  if (!items.length) return "";
  return `<ul style="margin:8px 0 0;padding-left:20px;color:#29453d;">${items
    .map((item) => `<li style="margin:4px 0;">${escapeHtml(item)}</li>`)
    .join("")}</ul>`;
}

function actionGuidanceHtml(guidance) {
  const groups = [
    ["Based on", guidance.basedOn],
    ["Still uncertain", guidance.stillUncertain],
    ["Could change if", guidance.reconsiderIf],
  ].filter(([, items]) => items.length);
  if (!groups.length) return "";
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px;border-top:1px solid #d5e5df;">${groups.map(([label, items]) => `
    <tr>
      <td style="padding:10px 0 0;color:#0a704d;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(label)}</td>
    </tr>
    <tr><td>${htmlList(items)}</td></tr>`).join("")}</table>`;
}

export function customerPlanDocumentHtml(document) {
  const badges = [
    ...document.overview.goals.map((goal) => `Goal: ${goal}`),
    document.overview.tenure,
    document.overview.propertyType,
    document.overview.state,
    document.overview.budget,
  ].filter(Boolean);
  const omittedTotal = Object.values(document.omitted).reduce(
    (sum, value) => sum + Number(value || 0),
    0,
  );
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#edf5f1;color:#0a2e3f;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf5f1;">
      <tr><td align="center" style="padding:28px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #c7ddd5;">
          <tr>
            <td style="padding:34px;background:#063448;color:#ffffff;border-bottom:6px solid #20d8c1;">
              <div style="color:#63f1cd;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;">Australian Energy Assessments</div>
              <h1 style="margin:12px 0 8px;font-family:Georgia,serif;font-size:34px;line-height:1.12;color:#ffffff;">${escapeHtml(document.heading)}</h1>
              <p style="margin:0;color:#d8ebf0;font-size:16px;line-height:1.55;">${escapeHtml(document.planTitle)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 34px;">
              <p style="margin:0 0 18px;color:#355a62;font-size:15px;line-height:1.6;">${escapeHtml(document.summary)}</p>
              <div style="margin:0 0 22px;">${badges.map((badge) => `<span style="display:inline-block;margin:0 6px 7px 0;padding:7px 11px;border-radius:999px;background:#e6f7ef;color:#0a704d;font-size:12px;font-weight:700;">${escapeHtml(badge)}</span>`).join("")}</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;background:#f3f8f6;border:1px solid #d5e5df;border-radius:12px;">
                <tr>
                  <td style="padding:18px;">
                    <div style="color:#0a704d;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Evidence boundary</div>
                    <p style="margin:7px 0 0;color:#29453d;font-size:14px;line-height:1.55;">${escapeHtml(`${document.evidence.known} of ${document.evidence.total} tracked home facts have a customer-selected source. ${document.evidence.unknown} remain not known or not checked.`)}</p>
                  </td>
                </tr>
              </table>
              ${document.climate ? `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 28px;background:#073b4c;border-radius:14px;">
                <tr><td style="padding:20px;color:#ffffff;">
                  <div style="color:#63f1cd;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Broad climate planning context</div>
                  <h2 style="margin:7px 0 8px;font-family:Georgia,serif;font-size:22px;color:#ffffff;">${escapeHtml(document.climate.label)}</h2>
                  <p style="margin:0 0 8px;color:#e4f1f4;font-size:14px;line-height:1.55;">${escapeHtml(document.climate.summary)}</p>
                  <p style="margin:0;color:#bfd4da;font-size:12px;line-height:1.5;">${escapeHtml(document.climate.boundary)}</p>
                </td></tr>
              </table>` : ""}
              <div style="color:#0a704d;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">Ordered roadmap</div>
              <h2 style="margin:7px 0 18px;font-family:Georgia,serif;font-size:28px;color:#0a2e3f;">What to consider, in order</h2>
              ${document.actions.map((action) => {
                const guideHref = absoluteGuideHref(action.guideHref);
                return `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 14px;border:1px solid #d5e5df;border-radius:14px;background:#fbfdfc;">
                <tr>
                  <td width="58" valign="top" style="padding:18px 0 18px 18px;">
                    <div style="width:38px;height:38px;line-height:38px;text-align:center;border-radius:12px;background:${action.completed ? "#0a704d" : "#073b4c"};color:#ffffff;font-size:13px;font-weight:700;">${action.completed ? "✓" : String(action.number).padStart(2, "0")}</div>
                  </td>
                  <td valign="top" style="padding:18px;">
                    <div style="color:#0a8c61;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">${escapeHtml(action.stage)}</div>
                    <h3 style="margin:5px 0 7px;font-family:Georgia,serif;font-size:20px;line-height:1.3;color:#0a2e3f;">${escapeHtml(action.title)}</h3>
                    <p style="margin:0;color:#48645c;font-size:14px;line-height:1.55;">${escapeHtml(action.description)}</p>
                    ${guideHref ? `<p style="margin:12px 0 0;"><a href="${escapeHtml(guideHref)}" style="color:#087952;font-size:13px;font-weight:700;text-decoration:underline;">${escapeHtml(action.guideLabel || "Open the related guide")}</a></p>` : ""}
                    ${actionGuidanceHtml(action.guidance)}
                  </td>
                </tr>
              </table>`;
              }).join("")}
              ${document.questions.length ? `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:28px 0 0;background:#fff8e8;border:1px solid #ead8aa;border-radius:14px;">
                <tr><td style="padding:20px;">
                  <div style="color:#7b5c0b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Questions that could improve the plan</div>
                  ${document.questions.map((question) => `<h3 style="margin:14px 0 4px;color:#453607;font-family:Georgia,serif;font-size:18px;">${escapeHtml(`${question.number}. ${question.prompt}`)}</h3><p style="margin:0;color:#68561d;font-size:13px;line-height:1.5;">${escapeHtml(question.whyItMatters)}</p>`).join("")}
                </td></tr>
              </table>` : ""}
              ${document.permissionSections.length ? `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:28px 0 0;background:#f3f8f6;border:1px solid #d5e5df;border-radius:14px;">
                <tr><td style="padding:20px;">
                  <div style="color:#0a704d;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Permission and licensed-work boundary</div>
                  ${document.permissionSections.map((section) => `
                    <h3 style="margin:14px 0 6px;color:#0a2e3f;font-family:Georgia,serif;font-size:18px;">${escapeHtml(section.label)}</h3>
                    <ul style="margin:0;padding-left:20px;color:#355a52;font-size:13px;line-height:1.5;">${section.items.map((item) => `<li style="margin:5px 0;"><strong>${escapeHtml(item.title)}</strong>${item.note ? ` ${escapeHtml(item.note)}` : ""}</li>`).join("")}</ul>
                  `).join("")}
                  <p style="margin:14px 0 0;color:#62776f;font-size:12px;line-height:1.5;">${escapeHtml(document.permissionBoundary)}</p>
                </td></tr>
              </table>` : ""}
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:28px 0 0;background:#edf7f3;border-left:4px solid #13aa78;">
                <tr><td style="padding:18px;">
                  <strong style="color:#0a704d;font-size:14px;">Private by design</strong>
                  <p style="margin:7px 0 0;color:#355a52;font-size:13px;line-height:1.55;">${escapeHtml(document.privacyNote)}${omittedTotal ? ` ${escapeHtml(`${omittedTotal} private or customer-written records were omitted from this copy.`)}` : ""}</p>
                </td></tr>
              </table>
              <p style="margin:20px 0 0;color:#62776f;font-size:12px;line-height:1.55;">${escapeHtml(document.adviceBoundary)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 34px;background:#062f40;color:#cfe2e7;font-size:12px;line-height:1.5;">
              Prepared ${escapeHtml(document.preparedDate)} by Australian Energy Assessments. Product and service brands are not selected or endorsed in this plan.
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function textSection(label, items) {
  return items.length
    ? `\n${label}:\n${items.map((item) => `- ${item}`).join("\n")}\n`
    : "";
}

export function customerPlanDocumentText(document) {
  const lines = [
    document.heading,
    document.planTitle,
    `Prepared ${document.preparedDate}`,
    "",
    document.summary,
    "",
    "YOUR PLANNING CONTEXT",
    `Goals: ${document.overview.goals.join(", ") || "Not recorded"}`,
    `Property: ${document.overview.propertyType}`,
    `State or territory: ${document.overview.state}`,
    `Tenure: ${document.overview.tenure}`,
    `Approval context: ${document.overview.approval}`,
    `Preferred pace: ${document.overview.pace}`,
    `Budget boundary: ${document.overview.budget}`,
    "",
    "EVIDENCE BOUNDARY",
    `${document.evidence.known} of ${document.evidence.total} tracked home facts have a customer-selected source. ${document.evidence.unknown} remain not known or not checked.`,
  ];
  if (document.climate) {
    lines.push(
      "",
      "BROAD CLIMATE PLANNING CONTEXT",
      document.climate.label,
      document.climate.summary,
      document.climate.boundary,
    );
  }
  lines.push("", "ORDERED ROADMAP");
  for (const action of document.actions) {
    lines.push(
      "",
      `${String(action.number).padStart(2, "0")}. ${action.title}${action.completed ? " [completed]" : ""}`,
      action.stage,
      action.description,
    );
    if (action.guideHref) {
      lines.push(`${action.guideLabel || "Related guide"}: ${absoluteGuideHref(action.guideHref)}`);
    }
    lines.push(textSection("Based on", action.guidance.basedOn).trimEnd());
    lines.push(textSection("Still uncertain", action.guidance.stillUncertain).trimEnd());
    lines.push(textSection("Could change if", action.guidance.reconsiderIf).trimEnd());
  }
  if (document.questions.length) {
    lines.push("", "QUESTIONS THAT COULD IMPROVE THE PLAN");
    for (const question of document.questions) {
      lines.push(
        `${question.number}. ${question.prompt}`,
        question.whyItMatters,
      );
    }
  }
  if (document.permissionSections.length) {
    lines.push("", "PERMISSION AND LICENSED-WORK BOUNDARY");
    for (const section of document.permissionSections) {
      lines.push(
        section.label,
        ...section.items.map((item) =>
          `- ${item.title}${item.note ? ` ${item.note}` : ""}`),
      );
    }
    lines.push(document.permissionBoundary);
  }
  const omittedTotal = Object.values(document.omitted).reduce(
    (sum, value) => sum + Number(value || 0),
    0,
  );
  lines.push(
    "",
    "PRIVATE BY DESIGN",
    document.privacyNote,
    ...(omittedTotal
      ? [`${omittedTotal} private or customer-written records were omitted from this copy.`]
      : []),
    "",
    "IMPORTANT BOUNDARY",
    document.adviceBoundary,
  );
  return lines.filter((line, index) => line !== "" || lines[index - 1] !== "").join("\n").trim();
}
