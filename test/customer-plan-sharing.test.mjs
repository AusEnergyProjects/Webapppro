import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createCustomerPlanDocument,
  createCustomerPlanReportView,
  customerPlanDocumentHtml,
  customerPlanDocumentText,
  isSingleEmailAddress,
  normalizeCustomerPlanEmailRequest,
} from "../src/lib/customer-plan-document.mjs";
import {
  customerAdvisorOptions,
  customerProjectOptions,
} from "../src/lib/customer-projects.mjs";

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
  assert.match(html, /style="/);
  assert.match(html, /https:\/\/compare\.ausenergyassessments\.com\/guides\//);
  assert.doesNotMatch(html, /attacker\.example/);
  assert.match(text, /YOUR PLANNING CONTEXT/);
  assert.match(text, /ORDERED ROADMAP/);
  assert.match(text, /PRIVATE BY DESIGN/);
  assert.doesNotMatch(text, /SECRET|3006|private-owner/);
});

test("broad customer reports stay concise, ordered and free of repeated per-action rationale", () => {
  const broadRow = {
    ...row,
    goals: JSON.stringify(customerProjectOptions.goals.map(([value]) => value)),
    existing_features: JSON.stringify(
      customerProjectOptions.homeFeatures.map(([value]) => value),
    ),
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
  assert.ok(report.questions.length <= 3);
  assert.ok(report.decisionBasis.length <= 4);
  assert.ok(report.beforeTrade.length <= 3);
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
  assert.ok(html.length < 35_000, `HTML length was ${html.length}`);
  assert.ok(text.length < 10_000, `text length was ${text.length}`);
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
