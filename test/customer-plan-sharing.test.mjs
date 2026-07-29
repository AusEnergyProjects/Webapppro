import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  AEA_BRANDMARK_PUBLIC_URL,
  CUSTOMER_PLAN_DOCUMENT_VERSION,
  CUSTOMER_PLAN_EMAIL_SUBJECT,
  CUSTOMER_PLAN_REPORT_VERSION,
  createCustomerPlanDocument,
  createCustomerPlanReportView,
  customerPlanDocumentHtml,
  customerPlanDocumentText,
  isSingleEmailAddress,
  normalizeCustomerPlanEmailRequest,
} from "../src/lib/customer-plan-document.mjs";
import {
  CUSTOMER_PLAN_REPORT_DESIGN_VERSION,
} from "../src/lib/customer-plan-report-design.mjs";
import {
  CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION,
  customerAdvisorOptions,
  customerProjectOptions,
} from "../src/lib/customer-projects.mjs";

const brandmarkRoute = fs.readFileSync(
  new URL("../src/app/api/aea-brandmark/route.ts", import.meta.url),
  "utf8",
);
const HOUSEHOLD_EVIDENCE_BOUNDARY =
  "These details were supplied by the household and have not been professionally checked.";
const SELF_DECLARED_REVIEW_BOUNDARY =
  "This is a self-declared professional review, not an Australian Energy Assessments credential check, site assessment, NatHERS assessment or endorsement.";
const SELF_DECLARED_READINESS_BOUNDARY =
  "These home answers are marked as reviewed by the self-declared accredited adviser named below. Australian Energy Assessments has not independently checked that review.";
const EVERYDAY_ACTION_IDS = [
  "moisture-safe-routine",
  "personal-warmth-first",
  "use-existing-controls",
  "safe-seasonal-airflow",
  "seasonal-window-and-landscape",
  "renter-friendly-diy-boundary",
];
const MAXIMUM_EVERYDAY_ACTION_FEATURES = [
  "comfort-too-hot",
  "comfort-too-cold",
  "ceiling-insulation-none",
  "wall-insulation-none",
  "floor-insulation-none",
  "single-glazing",
  "window-coverings-basic",
  "external-shading-none",
  "ventilation-unknown",
  "reverse-cycle",
  "electric-storage-hot-water",
  "electric-resistance-cooking",
  "solar-none",
  "battery-none",
];

const row = {
  id: "project-private-1",
  firebase_uid: "private-owner",
  title: "SECRET PRIVATE PROJECT",
  home_nickname: "SECRET HOME NAME",
  private_notes: "SECRET PRIVATE NOTE",
  goal: "improve-comfort",
  goals: JSON.stringify(["improve-comfort", "lower-bills"]),
  pace: "staged",
  postcode: "3006",
  address_state: "VIC",
  property_type: "house",
  household_situation: "renter",
  existing_features: JSON.stringify(["draughty", "single-glazing"]),
  budget_range: "under_2k",
  property_context: JSON.stringify({ approvalContext: "not_sure" }),
  advisor_profile: JSON.stringify({
    factEvidence: [
      { factKey: "glazing", source: "customer-reported" },
      { factKey: "draughts", source: "photo-supported" },
    ],
    rooms: [{
      id: "private-room",
      name: "SECRET BEDROOM NAME",
      roomType: "bedroom",
      concerns: ["too-cold", "draughty"],
      usePeriods: ["overnight"],
    }],
    permissionItems: [{
      id: "permission-private",
      title: "SECRET PERMISSION TITLE",
      note: "SECRET PERMISSION NOTE",
      classification: "permission-needed",
    }],
    reviewItems: [{
      id: "review-private",
      text: "SECRET CUSTOMER REVIEW",
      status: "open",
    }],
  }),
  plan_snapshot: JSON.stringify({
    version: "saved-plan",
    items: [
      { id: "budget-under-2k" },
      {
        id: "custom:private-step",
        stage: "SECRET CUSTOM STAGE",
        title: "<script>SECRET CUSTOM TITLE</script>",
        text: "SECRET CUSTOM TEXT",
        href: "https://attacker.example/collect",
      },
      { id: "draught-proofing" },
    ],
  }),
  completed_plan_items: JSON.stringify(["budget-under-2k"]),
  evidence_filename: "SECRET-NMI-NEM12.csv",
};

function withProfessionalReview(professionalReview) {
  return {
    ...row,
    advisor_profile: JSON.stringify({
      ...JSON.parse(row.advisor_profile),
      professionalReview,
    }),
  };
}

function occurrenceCount(value, needle) {
  return value.split(needle).length - 1;
}

test("shareable plan is server-derived, ordered and excludes private project content", () => {
  const document = createCustomerPlanDocument(row, {
    preparedAt: "2026-07-29T10:00:00.000Z",
  });
  assert.equal(document.preparedDate, "2026-07-29");
  assert.deepEqual(
    document.actions.map((action) => action.id),
    ["budget-under-2k", "draught-proofing"],
  );
  assert.equal(document.actions[0].completed, true);
  assert.equal(document.omitted.customPlanItems, 1);
  assert.equal(document.omitted.roomRecords, 1);
  assert.equal(document.omitted.permissionNotes, 1);
  assert.equal(document.omitted.reviewItems, 1);
  assert.equal(document.evidence.total, customerAdvisorOptions.factKeys.length);
  assert.equal(document.evidence.known, 2);
  assert.equal(
    document.evidence.unknown,
    customerAdvisorOptions.factKeys.length - 2,
  );
  assert.equal(
    document.evidence.bySource.reduce((total, source) => total + source.count, 0),
    customerAdvisorOptions.factKeys.length,
  );
  assert.equal(document.overview.state, "VIC");
  assert.ok(document.permissionSections.length > 0);
  assert.match(document.permissionBoundary, /not legal advice/i);
  assert.ok(document.actions.every((action) => (
    !action.guideHref || action.guideHref.startsWith("/guides/")
  )));

  const serialized = JSON.stringify(document);
  for (const privateValue of [
    "3006",
    "SECRET PRIVATE PROJECT",
    "SECRET HOME NAME",
    "SECRET PRIVATE NOTE",
    "SECRET BEDROOM NAME",
    "SECRET PERMISSION TITLE",
    "SECRET PERMISSION NOTE",
    "SECRET CUSTOMER REVIEW",
    "SECRET CUSTOM TITLE",
    "SECRET CUSTOM TEXT",
    "SECRET-NMI-NEM12.csv",
    "private-owner",
    "overnight",
    "attacker.example",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(privateValue));
  }
});

test("plans without a valid professional review retain the exact household evidence boundary", () => {
  const document = createCustomerPlanDocument(row, {
    preparedAt: "2026-07-29T10:00:00.000Z",
  });
  const report = createCustomerPlanReportView(document);

  assert.equal(CUSTOMER_PLAN_DOCUMENT_VERSION, "2026-07-29-plan-document-v2");
  assert.equal(CUSTOMER_PLAN_REPORT_VERSION, "2026-07-29-premium-report-v3");
  assert.equal(document.version, CUSTOMER_PLAN_DOCUMENT_VERSION);
  assert.equal(report.version, CUSTOMER_PLAN_REPORT_VERSION);
  assert.equal(document.professionalReview, null);
  assert.equal(report.professionalReview, null);
  assert.equal(document.readiness.boundary, HOUSEHOLD_EVIDENCE_BOUNDARY);
  assert.equal(report.readiness.boundary, HOUSEHOLD_EVIDENCE_BOUNDARY);
  assert.ok(customerPlanDocumentHtml(document).includes(HOUSEHOLD_EVIDENCE_BOUNDARY));
  assert.ok(customerPlanDocumentText(document).includes(HOUSEHOLD_EVIDENCE_BOUNDARY));
});

test("valid adviser self-declaration projects its exact evidence boundary and escaped notes", () => {
  const adviserName = 'Alex <img src=x onerror="ADVISER_NAME_CANARY">';
  const accreditationScheme = "Example Accredited Adviser Scheme";
  const accreditationReference = "EA-1234";
  const adviserNotes =
    'Check draught sources before sealing. <img src=x onerror="ADVISER_NOTES_CANARY">';
  const document = createCustomerPlanDocument(withProfessionalReview({
    enabled: true,
    role: "accredited-energy-adviser",
    adviserName,
    accreditationScheme,
    accreditationReference,
    notes: adviserNotes,
    declarationAccepted: true,
    declarationVersion: CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION,
    privateEmail: "PROFESSIONAL_PRIVATE_CANARY@example.com",
  }), {
    preparedAt: "2026-07-29T10:00:00.000Z",
  });
  const report = createCustomerPlanReportView(document);
  const html = customerPlanDocumentHtml(document);
  const text = customerPlanDocumentText(document);
  const evidenceBoundary =
    `These home details were reviewed by ${adviserName}, who declares they are an accredited energy adviser under ${accreditationScheme}, reference ${accreditationReference}. Australian Energy Assessments has not independently verified the adviser identity, accreditation, reference or home observations.`;

  assert.ok(document.professionalReview);
  assert.equal(document.professionalReview.roleLabel, "Accredited energy adviser");
  assert.equal(document.professionalReview.notes, adviserNotes);
  assert.equal(document.professionalReview.statement, evidenceBoundary);
  assert.equal(document.professionalReview.boundary, SELF_DECLARED_REVIEW_BOUNDARY);
  assert.equal(document.readiness.boundary, SELF_DECLARED_READINESS_BOUNDARY);
  assert.ok(report.professionalReview);
  assert.equal(report.professionalReview.notes, adviserNotes);
  assert.equal(report.professionalReview.statement, evidenceBoundary);
  assert.equal(report.professionalReview.boundary, SELF_DECLARED_REVIEW_BOUNDARY);
  assert.equal(report.readiness.boundary, SELF_DECLARED_READINESS_BOUNDARY);
  assert.doesNotMatch(report.readiness.boundary, /supplied by the household/i);
  assert.match(html, /Professional review, self-declared/);
  assert.match(html, /Alex &lt;img src=x onerror=&quot;ADVISER_NAME_CANARY&quot;&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;ADVISER_NOTES_CANARY&quot;&gt;/);
  assert.doesNotMatch(html, /<img src=x onerror="ADVISER_/);
  assert.match(text, new RegExp(adviserNotes.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(
    `${JSON.stringify(document)}\n${JSON.stringify(report)}\n${html}\n${text}`,
    /PROFESSIONAL_PRIVATE_CANARY/,
  );
});

test("disabled or invalid adviser declarations are excluded without leaking canaries", () => {
  const cases = [
    {
      label: "disabled",
      canary: "DISABLED_REVIEW_CANARY",
      professionalReview: {
        enabled: false,
        role: "accredited-energy-adviser",
        adviserName: "DISABLED_REVIEW_CANARY",
        accreditationScheme: "Example Scheme",
        accreditationReference: "EA-1234",
        notes: "DISABLED_REVIEW_CANARY",
        declarationAccepted: true,
      },
    },
    {
      label: "invalid",
      canary: "INVALID_REVIEW_CANARY",
      professionalReview: {
        enabled: true,
        role: "unsupported-role",
        adviserName: "INVALID_REVIEW_CANARY",
        accreditationScheme: "Example Scheme",
        accreditationReference: "EA-1234",
        notes: "INVALID_REVIEW_CANARY",
        declarationAccepted: false,
      },
    },
  ];

  for (const { label, canary, professionalReview } of cases) {
    const document = createCustomerPlanDocument(
      withProfessionalReview(professionalReview),
      { preparedAt: "2026-07-29T10:00:00.000Z" },
    );
    const report = createCustomerPlanReportView(document);
    const output = [
      JSON.stringify(document),
      JSON.stringify(report),
      customerPlanDocumentHtml(document),
      customerPlanDocumentText(document),
    ].join("\n");

    assert.equal(document.professionalReview, null, label);
    assert.equal(report.professionalReview, null, label);
    assert.equal(document.readiness.boundary, HOUSEHOLD_EVIDENCE_BOUNDARY, label);
    assert.equal(report.readiness.boundary, HOUSEHOLD_EVIDENCE_BOUNDARY, label);
    assert.doesNotMatch(output, new RegExp(canary), label);
    assert.doesNotMatch(output, /professional review, self-declared/i, label);
  }
});

test("shareable plan preserves room-driven advice without exposing room routines", () => {
  const document = createCustomerPlanDocument({
    ...row,
    plan_snapshot: JSON.stringify({
      version: "saved-plan",
      items: [{ id: "room-comfort-profile" }],
    }),
  }, {
    preparedAt: "2026-07-29T10:00:00.000Z",
  });
  assert.equal(document.actions.length, 1);
  assert.equal(document.actions[0].id, "room-comfort-profile");
  assert.match(document.actions[0].title, /heat retention/i);
  assert.doesNotMatch(
    JSON.stringify(document),
    /SECRET BEDROOM NAME|overnight|private-room/i,
  );
});

test("plan email HTML is escaped, inline styled and has a complete plain-text alternative", () => {
  const document = createCustomerPlanDocument(row, {
    preparedAt: "2026-07-29T10:00:00.000Z",
  });
  const html = customerPlanDocumentHtml({
    ...document,
    planTitle: '<img src=x onerror="alert(1)">',
  });
  const text = customerPlanDocumentText(document);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /Australian Energy Assessments/);
  assert.equal(CUSTOMER_PLAN_EMAIL_SUBJECT, "Your home energy plan is ready");
  assert.equal(
    CUSTOMER_PLAN_REPORT_DESIGN_VERSION,
    "2026-07-30-tech-presentation-design-v2",
  );
  assert.match(
    html,
    new RegExp(`x-aea-report-design" content="${CUSTOMER_PLAN_REPORT_DESIGN_VERSION}`),
  );
  assert.match(html, /style="/);
  assert.match(html, /https:\/\/compare\.ausenergyassessments\.com\/guides\//);
  assert.doesNotMatch(html, /attacker\.example/);
  assert.match(html, /29 July 2026/);
  assert.match(html, /@media only screen and \(max-width: 680px\)/);
  assert.match(html, /\.snapshot-cell \{ display: block !important/);
  assert.match(
    html,
    /\.snapshot-cell \{[^}]*margin-bottom: 12px !important/,
  );
  assert.match(html, /border-radius:22px;overflow:hidden/);
  assert.match(html, /border-radius:20px;overflow:hidden/);
  assert.match(html, /border-radius:16px;overflow:hidden/);
  assert.match(html, /padding-top:40px/);
  assert.match(html, /margin:0 0 16px;border-collapse:separate/);
  assert.doesNotMatch(html, /width="145"/);
  assert.doesNotMatch(html, /<ul\b/i);
  const reportImages = html.match(/<img\b[^>]*>/gi) || [];
  assert.equal(reportImages.length, 1);
  assert.ok(reportImages[0].includes(AEA_BRANDMARK_PUBLIC_URL));
  assert.match(reportImages[0], /alt=""/);
  assert.doesNotMatch(html, /data:image\//);
  assert.match(brandmarkRoute, /AEA_BRANDMARK_PNG_DATA_URI/);
  assert.match(brandmarkRoute, /"Content-Type": "image\/png"/);
  assert.match(
    brandmarkRoute,
    /"Cache-Control": "public, max-age=31536000, immutable"/,
  );
  assert.ok(
    html.indexOf("Your plan in one view")
      < html.indexOf("Start with these three moves"),
  );
  assert.ok(
    html.indexOf("Start with these three moves")
      < html.indexOf("Build the rest of your roadmap"),
  );
  assert.ok(
    html.indexOf("Build the rest of your roadmap")
      < html.indexOf("Comfort wins you can try this week"),
  );
  assert.match(text, /YOUR HOME AT A GLANCE/);
  assert.match(text, /START HERE/);
  assert.match(text, /YOUR STEP-BY-STEP PLAN/);
  assert.match(text, /PRIVATE BY DESIGN/);
  assert.doesNotMatch(text, /SECRET|3006|private-owner/);
});

test("everyday actions are allowlisted, capped, rendered once and kept outside report actions", () => {
  const document = createCustomerPlanDocument(row, {
    preparedAt: "2026-07-29T10:00:00.000Z",
  });
  const allowedActions = EVERYDAY_ACTION_IDS.map((id, index) => ({
    id,
    category: `Everyday category ${index + 1}`,
    title: `Everyday action ${index + 1}`,
    description: `Everyday description ${index + 1}`,
  }));
  const projectedDocument = {
    ...document,
    everydayActionsBoundary:
      'Everyday boundary <img src=x onerror="EVERYDAY_BOUNDARY_CANARY">',
    everydayActions: [
      allowedActions[0],
      {
        id: "not-allowlisted",
        category: "DISALLOWED_CATEGORY_CANARY",
        title: "DISALLOWED_TITLE_CANARY",
        description: "DISALLOWED_DESCRIPTION_CANARY",
      },
      {
        ...allowedActions[0],
        title: "DUPLICATE_EVERYDAY_CANARY",
      },
      ...allowedActions.slice(1),
    ],
  };
  const report = createCustomerPlanReportView(projectedDocument);
  const html = customerPlanDocumentHtml(projectedDocument);
  const text = customerPlanDocumentText(projectedDocument);

  assert.deepEqual(
    report.everydayActions.map((action) => action.id),
    EVERYDAY_ACTION_IDS,
  );
  assert.equal(report.everydayActions.length, 6);
  assert.ok(report.everydayActions.every((action) => (
    !("number" in action)
    && !("priority" in action)
    && !("completed" in action)
  )));
  assert.deepEqual(
    report.actions.map((action) => action.id),
    document.actions.map((action) => action.id),
  );
  assert.deepEqual(
    report.actions
      .map((action) => action.id)
      .filter((id) => EVERYDAY_ACTION_IDS.includes(id)),
    [],
  );
  assert.equal(occurrenceCount(html, "Quick comfort wins"), 1);
  assert.equal(occurrenceCount(text, "QUICK COMFORT WINS"), 1);
  for (const action of allowedActions) {
    assert.equal(occurrenceCount(html, action.title), 1, action.id);
    assert.equal(occurrenceCount(text, action.title), 1, action.id);
  }
  assert.match(
    html,
    /Everyday boundary &lt;img src=x onerror=&quot;EVERYDAY_BOUNDARY_CANARY&quot;&gt;/,
  );
  assert.doesNotMatch(html, /<img src=x onerror="EVERYDAY_BOUNDARY_CANARY">/);
  assert.doesNotMatch(
    `${JSON.stringify(report)}\n${html}\n${text}`,
    /DISALLOWED_(?:CATEGORY|TITLE|DESCRIPTION)_CANARY|DUPLICATE_EVERYDAY_CANARY/,
  );
});

test("broad customer reports stay concise, ordered and free of repeated per-action rationale", () => {
  const broadRow = {
    ...row,
    goals: JSON.stringify(customerProjectOptions.goals.map(([value]) => value)),
    existing_features: JSON.stringify(MAXIMUM_EVERYDAY_ACTION_FEATURES),
    plan_snapshot: "",
    completed_plan_items: JSON.stringify([]),
  };
  const document = createCustomerPlanDocument(broadRow, {
    preparedAt: "2026-07-29T10:00:00.000Z",
    evidence: [
      {
        fact_keys: JSON.stringify(["glazing", "ceiling-insulation"]),
        sharing_scope: "private-plan",
      },
      {
        fact_keys: JSON.stringify(["glazing", "switchboard"]),
        sharing_scope: "allocated-installers",
      },
    ],
  });
  const report = createCustomerPlanReportView(document);
  const html = customerPlanDocumentHtml(document);
  const text = customerPlanDocumentText(document);

  assert.ok(report.actions.length >= 15);
  assert.deepEqual(
    report.actions.map((action) => action.id),
    document.actions.map((action) => action.id),
  );
  assert.equal(report.actions.filter((action) => action.priority).length, 3);
  assert.deepEqual(
    report.priorityActions.map((action) => action.id),
    report.actions.filter((action) => action.priority).map((action) => action.id),
  );
  assert.deepEqual(
    report.laterActions.map((action) => action.id),
    report.actions.filter((action) => !action.priority).map((action) => action.id),
  );
  assert.ok(report.questions.length <= 3);
  assert.ok(report.decisionBasis.length <= 4);
  assert.ok(report.beforeTrade.length <= 3);
  assert.deepEqual(
    report.everydayActions.map((action) => action.id),
    EVERYDAY_ACTION_IDS,
  );
  assert.equal(report.readiness.linked, 2);
  assert.ok(report.readiness.missingLabels.length <= 3);
  assert.match(report.readiness.boundary, /supplied by the household/i);
  assert.match(report.readiness.boundary, /not been professionally checked/i);

  for (const action of report.actions) {
    assert.equal(html.split(`>${action.title}</h3>`).length - 1, 1, action.title);
    assert.equal(
      text.split(`${String(action.number).padStart(2, "0")}. ${action.title}`)
        .length - 1,
      1,
      action.title,
    );
  }
  // The premium email keeps client-safe inline typography on every repeated
  // action card. The cap retains bounded headroom while still catching
  // duplicated sections or unbounded per-action detail.
  assert.ok(html.length < 60_000, `HTML length was ${html.length}`);
  assert.ok(text.length < 12_500, `text length was ${text.length}`);
  assert.equal(
    text.split(report.changeBoundary).length - 1,
    1,
    "generic change boundary should appear once",
  );
  assert.doesNotMatch(html, /0 of 12|tracked home facts have/i);
  assert.doesNotMatch(text, /0 of 12|tracked home facts have/i);
  assert.doesNotMatch(html, /Permission and licensed-work boundary/);
  assert.doesNotMatch(text, /Permission and licensed-work boundary/);
});

test("completed plans use a clear progress state instead of an empty start section", () => {
  const source = createCustomerPlanDocument(row, {
    preparedAt: "2026-07-29T10:00:00.000Z",
  });
  const completed = {
    ...source,
    actions: source.actions.map((action) => ({
      ...action,
      completed: true,
    })),
  };
  const report = createCustomerPlanReportView(completed);
  const html = customerPlanDocumentHtml(completed);
  const text = customerPlanDocumentText(completed);

  assert.equal(report.priorityActions.length, 0);
  assert.equal(report.laterActions.length, report.actions.length);
  assert.doesNotMatch(html, />Start with these three moves</);
  assert.doesNotMatch(html, /Start with your first three steps/);
  assert.doesNotMatch(html, />PLAN NEXT</);
  assert.doesNotMatch(text, /\nSTART HERE\n/);
  assert.match(html, />STEPS COMPLETE</);
  assert.match(html, />LEFT TO PLAN</);
  assert.match(html, />Every step in this plan is marked complete</);
  assert.match(text, /\nPLAN PROGRESS\n/);
});

test("plan email request accepts one bounded address, explicit consent and no extra fields", () => {
  const accepted = normalizeCustomerPlanEmailRequest({
    projectId: "project-123",
    recipient: "  Person.Example+plan@Example.COM ",
    consentConfirmed: true,
    requestId: "request-12345678",
  });
  assert.deepEqual(accepted, {
    ok: true,
    value: {
      projectId: "project-123",
      recipient: "person.example+plan@example.com",
      consentConfirmed: true,
      requestId: "request-12345678",
    },
  });
  for (const recipient of [
    "",
    "one@example.com,two@example.com",
    "one@example.com;two@example.com",
    "Person <one@example.com>",
    "one@example",
    "one..two@example.com",
    "one@example..com",
  ]) {
    assert.equal(isSingleEmailAddress(recipient), false, recipient);
  }
  assert.equal(normalizeCustomerPlanEmailRequest({
    projectId: "project-123",
    recipient: "person@example.com",
    consentConfirmed: false,
    requestId: "request-12345678",
  }).ok, false);
  assert.equal(normalizeCustomerPlanEmailRequest({
    projectId: "project-123",
    recipient: "person@example.com",
    consentConfirmed: true,
    requestId: "request-12345678",
    privateNotes: "must not be accepted",
  }).ok, false);
});

test("email route enforces verified ownership, durable rate limiting and honest provider acceptance", () => {
  const route = fs.readFileSync(
    new URL("../src/app/api/customer-project-plan-email/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /requireFirebaseIdentity/);
  assert.match(route, /identity\.emailVerified/);
  assert.match(route, /account_status/);
  assert.match(route, /firebase_uid = \?/);
  assert.match(route, /archived_at = ''/);
  assert.match(route, /createSharedLeadRateLimiter/);
  assert.match(route, /customer-plan-email:\$\{identity\.uid\}/);
  assert.match(
    route,
    /normalized\.value\.projectId\}:\$\{normalized\.value\.recipient\}:\$\{normalized\.value\.requestId\}/,
  );
  assert.match(route, /status: "accepted"/);
  assert.match(route, /Accepted for delivery\./);
  assert.match(route, /status NOT IN \('withdrawn', 'archived'\)/);
  assert.doesNotMatch(route, /SELECT \* FROM customer_projects/);
});
