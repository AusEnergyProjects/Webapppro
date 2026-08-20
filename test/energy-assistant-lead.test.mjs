import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  createEnergyAssistantLead,
  ENERGY_ASSISTANT_QUOTE_BRIEF_VERSION,
  ENERGY_ASSISTANT_SERVICE_CONSENT_PURPOSE,
  ENERGY_ASSISTANT_SERVICE_CONSENT_VERSION,
  ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
  ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
  EnergyAssistantLeadError,
} from "../src/lib/energy-assistant-lead-server.ts";
import {
  buildEnergyAssistantLeadPayload,
  createEnergyAssistantSubmissionKey,
} from "../src/lib/energy-assistant-lead-client.mjs";
import { ENERGY_SERVICE_IDS } from "../src/lib/energy-service-catalogue.mjs";
import { energyAssistantQuoteQuestionsForServices } from "../src/lib/public-plan-quote-preparation.mjs";

const migration = fs.readFileSync(
  new URL("../drizzle/0152_energy_assistant.sql", import.meta.url),
  "utf8",
);
const NOW = new Date("2026-08-20T02:00:00.000Z");
const leadId = "22222222-2222-4222-8222-222222222222";
const createdEventId = "33333333-3333-4333-8333-333333333333";
const sharedEventId = "44444444-4444-4444-8444-444444444444";

class TestD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }
  bind(...values) { return new TestD1Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(migration);
  database.exec(`CREATE TABLE trade_opportunities (
    id text PRIMARY KEY NOT NULL,
    source_reference text NOT NULL UNIQUE,
    status text NOT NULL,
    updated_at text NOT NULL
  );
  CREATE TABLE public_trade_lead_contact_releases (
    id text PRIMARY KEY NOT NULL,
    opportunity_id text NOT NULL UNIQUE,
    source_reference text NOT NULL UNIQUE,
    status text NOT NULL,
    notice_version text NOT NULL,
    consent_purpose text NOT NULL,
    withdrawn_at text NOT NULL
  );
  CREATE TABLE admin_notifications (
    id text PRIMARY KEY NOT NULL,
    event_key text NOT NULL UNIQUE,
    event_type text NOT NULL,
    category text NOT NULL,
    priority text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    actor_type text NOT NULL,
    actor_uid text NOT NULL,
    requires_action integer NOT NULL,
    status text NOT NULL,
    read_at text NOT NULL,
    read_by_uid text NOT NULL,
    resolved_at text NOT NULL,
    resolved_by_uid text NOT NULL,
    resolution_note text NOT NULL,
    assigned_to_uid text NOT NULL,
    assigned_at text NOT NULL,
    due_at text NOT NULL,
    metadata text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
  );
  CREATE TABLE customer_opportunity_dispatch_jobs (
    id text PRIMARY KEY NOT NULL,
    opportunity_id text NOT NULL UNIQUE,
    admin_notification_id text NOT NULL,
    status text NOT NULL,
    attempts integer NOT NULL,
    next_attempt_at text NOT NULL,
    claimed_at text NOT NULL,
    completed_at text NOT NULL,
    failed_at text NOT NULL,
    last_error text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
  );`);
  const d1 = {
    prepare(sql) { return new TestD1Statement(database, sql); },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { database, d1 };
}

function quoteAnswersForServices(services, preferred = {}) {
  return energyAssistantQuoteQuestionsForServices(services).map((question) => ({
    questionId: question.id,
    answer: preferred[question.id]
      || question.options.find((option) => option !== "Not sure" && option !== "Need advice")
      || question.options.at(-1),
  }));
}

function unknownQuoteAnswersForServices(services) {
  return Object.fromEntries(
    energyAssistantQuoteQuestionsForServices(services).map((question) => [
      question.id,
      question.options.includes("Not sure") ? "Not sure" : "Need advice",
    ]),
  );
}

function widgetQuoteAnswersForServices(services, preferred = {}) {
  return Object.fromEntries(
    quoteAnswersForServices(services, preferred)
      .map(({ questionId, answer }) => [questionId, answer]),
  );
}

function payload(overrides = {}) {
  return {
    requestId: "lead-request-00000001",
    submissionKey: "A".repeat(43),
    sourceRequestId: "ask-request-00000001",
    name: "Jane Citizen",
    email: "JANE@example.com",
    phone: "0400 000 000",
    postcode: "3000",
    suburb: "Melbourne",
    state: "VIC",
    services: ["hot-water"],
    interestConfirmed: true,
    quoteBrief: {
      version: ENERGY_ASSISTANT_QUOTE_BRIEF_VERSION,
      propertyType: "house",
      tenure: "owner-occupier",
      budgetRange: "5000-15000",
      contactPreference: "either",
      bestContactTime: "business-hours",
      answers: quoteAnswersForServices(["hot-water"], {
        timing: "Within 3 months",
        "hot-water-existing-system": "Gas storage",
        "hot-water-household-demand": "Three or four people",
        "hot-water-location-access": "Outdoor area with clear access",
        "hot-water-electrical-supply": "No electrical assessment yet",
      }),
      knownFacts: [{ kind: "existing-system", value: "Gas storage hot water", services: ["hot-water"] }],
      siteConstraints: [{ kind: "space", detail: "Narrow side access", services: ["hot-water"] }],
      explicitUnknowns: ["measurements"],
      additionalContext: "Please explain electrical upgrade assumptions before quoting.",
    },
    serviceConsent: {
      accepted: true,
      noticeVersion: ENERGY_ASSISTANT_SERVICE_CONSENT_VERSION,
      purpose: ENERGY_ASSISTANT_SERVICE_CONSENT_PURPOSE,
      grantedAt: NOW.toISOString(),
    },
    marketingConsent: false,
    tradeSharingConsent: { accepted: false },
    ...overrides,
  };
}

function dependencies(database, overrides = {}) {
  const ids = [leadId, createdEventId, sharedEventId];
  return {
    database,
    now: () => new Date(NOW),
    randomUUID: () => ids.shift() || crypto.randomUUID(),
    ...overrides,
  };
}

function stageAssistantOpportunity(database, opportunityId, exactLeadId = leadId) {
  const sourceReference = `energy-assistant:${exactLeadId}`;
  database.prepare(`INSERT INTO trade_opportunities
    (id, source_reference, status, updated_at)
    VALUES (?, ?, 'draft', ?)
    ON CONFLICT(source_reference) DO NOTHING`)
    .run(opportunityId, sourceReference, NOW.toISOString());
  const canonical = database.prepare(
    "SELECT id FROM trade_opportunities WHERE source_reference = ?",
  ).get(sourceReference);
  database.prepare(`INSERT INTO public_trade_lead_contact_releases
    (id, opportunity_id, source_reference, status, notice_version,
     consent_purpose, withdrawn_at)
    VALUES (?, ?, ?, 'active', ?, ?, '')
    ON CONFLICT(source_reference) DO NOTHING`)
    .run(
      `release:${exactLeadId}`,
      canonical.id,
      sourceReference,
      ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
      ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
    );
  return canonical.id;
}

function shareablePayload(overrides = {}) {
  return payload({
    requestId: "lead-request-00000002",
    submissionKey: "B".repeat(43),
    marketingConsent: true,
    tradeSharingConsent: {
      accepted: true,
      noticeVersion: ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
      purpose: ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
      grantedAt: NOW.toISOString(),
      sharePhone: false,
    },
    ...overrides,
  });
}

test("quote preparation exposes bounded service-specific triage questions with an explicit unknown option", () => {
  const requiredByService = {
    assessment: ["assessment-purpose", "assessment-property-scale", "assessment-information"],
    solar: ["solar-existing-system", "solar-electricity-use", "solar-roof-site", "solar-electrical-export"],
    battery: ["battery-priority", "battery-solar-system", "battery-load-profile", "battery-installation-site", "battery-electrical-supply"],
    "heating-cooling": ["heating-existing-system", "heating-home-load", "heating-outdoor-unit-site", "heating-electrical-supply"],
    "hot-water": ["hot-water-existing-system", "hot-water-household-demand", "hot-water-location-access", "hot-water-electrical-supply"],
    "electric-cooking": ["electric-cooking-scope", "electric-cooking-existing-appliance", "electric-cooking-dimensions", "electric-cooking-electrical-supply", "electric-cooking-gas-scope"],
    "draught-proofing": ["draught-scope", "draught-openings", "draught-ventilation-safety"],
    insulation: ["insulation-scope", "insulation-existing-condition", "insulation-access"],
    glazing: ["glazing-scope", "glazing-existing-frames", "glazing-priority"],
    "window-coverings": ["window-covering-scope", "window-covering-type", "window-covering-access"],
    "ev-charging": ["ev-parking", "ev-vehicle-status", "ev-charging-priority", "ev-electrical-path"],
    other: ["other-category", "other-scope"],
  };
  for (const [service, requiredIds] of Object.entries(requiredByService)) {
    const questions = energyAssistantQuoteQuestionsForServices([service]);
    const ids = new Set(questions.map((question) => question.id));
    assert.ok(ids.has("timing"), `${service} must capture timing`);
    requiredIds.forEach((id) => assert.ok(ids.has(id), `${service} is missing ${id}`));
    questions.forEach((question) => {
      assert.ok(
        question.options.includes("Not sure") || question.options.includes("Need advice"),
        `${question.id} must let the visitor capture an explicit unknown`,
      );
    });
  }
});

test("the widget-shaped client payload is accepted by the canonical standalone lead service", async (t) => {
  const { database, d1 } = fixture();
  t.after(() => database.close());
  const submissionKey = createEnergyAssistantSubmissionKey({
    getRandomValues(bytes) {
      bytes.fill(7);
      return bytes;
    },
  });
  const widgetPayload = buildEnergyAssistantLeadPayload({
    requestId: "widget-lead-request-0001",
    submissionKey,
    grantedAt: NOW.toISOString(),
    lead: {
      name: "Jane Citizen",
      email: "jane@example.com",
      phone: "0400 000 000",
      postcode: "3000",
      suburb: "MELBOURNE",
      state: "VIC",
      services: ["hot-water"],
      propertyType: "house",
      tenure: "owner-occupier",
      budgetRange: "5000-15000",
      contactPreference: "either",
      bestContactTime: "business-hours",
      quoteAnswers: widgetQuoteAnswersForServices(["hot-water"], {
        timing: "Within 3 months",
        "hot-water-existing-system": "Gas storage",
        "hot-water-household-demand": "Three or four people",
        "hot-water-location-access": "Outdoor area with clear access",
        "hot-water-electrical-supply": "No electrical assessment yet",
      }),
      message: "Please explain electrical upgrade assumptions before quoting.",
      marketingConsent: false,
      tradeSharingConsent: false,
      sharePhone: false,
    },
  });

  assert.match(submissionKey, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(widgetPayload.tradeSharingConsent, { accepted: false });
  assert.equal(widgetPayload.quoteBrief.additionalContext, "Please explain electrical upgrade assumptions before quoting.");
  assert.doesNotMatch(JSON.stringify(widgetPayload), /transcript|documentSummary|raw file|sessionId|accessKey/i);
  assert.deepEqual(
    await createEnergyAssistantLead(widgetPayload, dependencies(d1)),
    {
      leadId,
      created: true,
      status: "quote_ready",
      opportunityId: "",
      dispatchJobId: "",
      tradeSharing: "not_requested",
    },
  );
});

test("assistant follow-up is optional, canonical, locality-validated and idempotent without a chat session", async (t) => {
  const { database, d1 } = fixture();
  t.after(() => database.close());
  const firstDependencies = dependencies(d1);
  const created = await createEnergyAssistantLead(payload(), firstDependencies);
  assert.deepEqual(created, {
    leadId,
    created: true,
    status: "quote_ready",
    opportunityId: "",
    dispatchJobId: "",
    tradeSharing: "not_requested",
  });
  const row = database.prepare("SELECT * FROM energy_assistant_leads").get();
  assert.equal(row.email, "jane@example.com");
  assert.equal(row.residential_state, "VIC");
  assert.equal(row.suburb, "MELBOURNE");
  assert.equal(row.interest_confirmed, 1);
  assert.equal(row.status, "quote_ready");
  assert.equal(row.trade_sharing_consent, 0);
  assert.equal(row.trade_disclosed_snapshot_json, "{}");
  assert.equal(row.opportunity_id, "");
  assert.equal(database.prepare("SELECT COUNT(*) total FROM energy_assistant_lead_events").get().total, 1);

  const replay = await createEnergyAssistantLead(payload(), dependencies(d1));
  assert.deepEqual(replay, {
    leadId,
    created: false,
    status: "quote_ready",
    opportunityId: "",
    dispatchJobId: "",
    tradeSharing: "not_requested",
  });
  assert.equal(database.prepare("SELECT COUNT(*) total FROM energy_assistant_leads").get().total, 1);
  assert.equal(database.prepare("SELECT COUNT(*) total FROM energy_assistant_lead_events").get().total, 1);
});

test("invalid residential postcodes, state mismatches, non-canonical services and hidden lead intent fail closed", async (t) => {
  const { database, d1 } = fixture();
  t.after(() => database.close());
  for (const [change, code] of [
    [{ postcode: "0000", suburb: "Unknown" }, "INVALID_LOCALITY"],
    [{ state: "NSW" }, "INVALID_LOCALITY"],
    [{ services: ["solar-battery"] }, "INVALID_SERVICE"],
    [{ interestConfirmed: false }, "INTEREST_CONFIRMATION_REQUIRED"],
  ]) {
    await assert.rejects(
      createEnergyAssistantLead(payload(change), dependencies(d1)),
      (error) => error instanceof EnergyAssistantLeadError && error.code === code,
    );
  }
  const emailOnly = payload({ phone: "" });
  await assert.rejects(
    createEnergyAssistantLead({
      ...emailOnly,
      quoteBrief: { ...emailOnly.quoteBrief, contactPreference: "phone" },
    }, dependencies(d1)),
    (error) => error instanceof EnergyAssistantLeadError && error.code === "INVALID_LEAD",
  );
  const phoneOnly = payload({ email: "" });
  await assert.rejects(
    createEnergyAssistantLead({
      ...phoneOnly,
      quoteBrief: { ...phoneOnly.quoteBrief, contactPreference: "email" },
    }, dependencies(d1)),
    (error) => error instanceof EnergyAssistantLeadError && error.code === "INVALID_LEAD",
  );
  assert.equal(database.prepare("SELECT COUNT(*) total FROM energy_assistant_leads").get().total, 0);
});

test("trade sharing remains AEA-only until the hot-water brief captures every required fact or explicit unknown", async (t) => {
  const { database, d1 } = fixture();
  t.after(() => database.close());
  const complete = payload();
  const incomplete = {
    ...complete,
    requestId: "lead-request-needs-info-01",
    submissionKey: "N".repeat(43),
    quoteBrief: {
      ...complete.quoteBrief,
      answers: [{ questionId: "timing", answer: "Within 3 months" }],
      explicitUnknowns: [],
    },
    tradeSharingConsent: {
      accepted: true,
      noticeVersion: ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
      purpose: ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
      grantedAt: NOW.toISOString(),
      sharePhone: false,
    },
  };
  const result = await createEnergyAssistantLead(incomplete, dependencies(d1, {
    createOpportunity: async () => {
      throw new Error("an incomplete brief must not enter the trade opportunity pipeline");
    },
  }));
  assert.deepEqual(result, {
    leadId,
    created: true,
    status: "needs_information",
    opportunityId: "",
    dispatchJobId: "",
    tradeSharing: "pending_information",
  });
  const row = database.prepare("SELECT * FROM energy_assistant_leads").get();
  const brief = JSON.parse(row.quote_brief_json);
  assert.equal(row.trade_sharing_consent, 1);
  assert.equal(row.opportunity_id, "");
  assert.equal(brief.readiness.state, "needs_information");
  assert.deepEqual(brief.readiness.capturedQuestionIds, ["timing"]);
  assert.ok(brief.readiness.missingQuestionIds.includes("hot-water-existing-system"));
  assert.equal(brief.explicitUnknowns.includes("question:hot-water-existing-system"), false);
  assert.throws(
    () => database.prepare("UPDATE energy_assistant_leads SET status = 'quote_ready' WHERE id = ?").run(leadId),
    /CHECK constraint failed/i,
  );
  assert.throws(
    () => database.prepare("UPDATE energy_assistant_leads SET opportunity_id = 'blocked-opportunity' WHERE id = ?").run(leadId),
    /CHECK constraint failed/i,
  );
});

test("service-specific quote briefs require bounded current-system, load, site and electrical facts while explicit unknowns remain triage ready", async () => {
  for (const [index, service] of [
    "solar",
    "battery",
    "heating-cooling",
    "electric-cooking",
    "insulation",
    "glazing",
    "ev-charging",
  ].entries()) {
    const readyFixture = fixture();
    const readyBase = payload();
    const readyPayload = {
      ...readyBase,
      requestId: `service-ready-request-0${index + 1}`,
      submissionKey: String.fromCharCode(80 + index).repeat(43),
      services: [service],
      quoteBrief: {
        ...readyBase.quoteBrief,
        answers: quoteAnswersForServices([service], { timing: "Not sure" }),
        knownFacts: [],
        siteConstraints: [],
        explicitUnknowns: [],
      },
    };
    const ready = await createEnergyAssistantLead(readyPayload, dependencies(readyFixture.d1));
    assert.equal(ready.status, "quote_ready", `${service} with explicit unknowns should be triage ready`);
    const storedReady = JSON.parse(readyFixture.database.prepare("SELECT quote_brief_json FROM energy_assistant_leads").get().quote_brief_json);
    assert.equal(storedReady.readiness.missingQuestionIds.length, 0);
    assert.ok(storedReady.readiness.requiredQuestionIds.length >= 4, `${service} needs bounded service questions`);
    assert.ok(storedReady.readiness.capturedUnknownQuestionIds.length >= 1);
    readyFixture.database.close();

    const incompleteFixture = fixture();
    const incompletePayload = {
      ...readyPayload,
      requestId: `service-needs-info-req-0${index + 1}`,
      submissionKey: String.fromCharCode(83 + index).repeat(43),
      quoteBrief: {
        ...readyPayload.quoteBrief,
        answers: [{ questionId: "timing", answer: "Not sure" }],
      },
    };
    const incomplete = await createEnergyAssistantLead(incompletePayload, dependencies(incompleteFixture.d1));
    assert.equal(incomplete.status, "needs_information", `${service} must expose unanswered triage facts`);
    incompleteFixture.database.close();
  }
});

test("a fully unknown all-service brief stays AEA-only even after every question is explicitly captured", async (t) => {
  const { database, d1 } = fixture();
  t.after(() => database.close());
  const services = [...ENERGY_SERVICE_IDS];
  const questions = energyAssistantQuoteQuestionsForServices(services);
  const unknownPayload = buildEnergyAssistantLeadPayload({
    requestId: "lead-request-all-unknown-01",
    submissionKey: "U".repeat(43),
    grantedAt: NOW.toISOString(),
    lead: {
      name: "Jane Citizen",
      email: "jane@example.com",
      phone: "0400 000 000",
      postcode: "3000",
      suburb: "MELBOURNE",
      state: "VIC",
      services,
      propertyType: "not-sure",
      tenure: "not-sure",
      budgetRange: "not-set",
      contactPreference: "either",
      bestContactTime: "business-hours",
      quoteAnswers: unknownQuoteAnswersForServices(services),
      message: "AEA follow-up is requested because the property details are not known yet.",
      marketingConsent: false,
      tradeSharingConsent: true,
      sharePhone: false,
    },
  });
  const result = await createEnergyAssistantLead(unknownPayload, dependencies(d1, {
    createOpportunity: async () => {
      throw new Error("a fully unknown brief must not enter the trade opportunity pipeline");
    },
  }));
  assert.deepEqual(result, {
    leadId,
    created: true,
    status: "needs_information",
    opportunityId: "",
    dispatchJobId: "",
    tradeSharing: "pending_information",
  });
  const row = database.prepare("SELECT quote_brief_json, opportunity_id FROM energy_assistant_leads").get();
  const brief = JSON.parse(row.quote_brief_json);
  assert.equal(row.opportunity_id, "");
  assert.equal(brief.readiness.requiredQuestionIds.length, questions.length);
  assert.equal(brief.readiness.missingQuestionIds.length, 0);
  assert.equal(brief.readiness.capturedUnknownQuestionIds.length, questions.length);
  assert.deepEqual(brief.readiness.insufficientKnownServiceIds, services);
  assert.throws(
    () => database.prepare(`UPDATE energy_assistant_leads
      SET quote_brief_json = json_set(quote_brief_json, '$.readiness.state', 'quote_ready'),
          status = 'quote_ready'
      WHERE id = ?`).run(leadId),
    /CHECK constraint failed/i,
  );
});

test("the bounded all-service brief remains storable and shareable with a known-information floor plus site-dependent unknowns", async (t) => {
  const { database, d1 } = fixture();
  t.after(() => database.close());
  const services = [...ENERGY_SERVICE_IDS];
  const questions = energyAssistantQuoteQuestionsForServices(services);
  const allServicePayload = buildEnergyAssistantLeadPayload({
    requestId: "lead-request-all-services-01",
    submissionKey: "Z".repeat(43),
    grantedAt: NOW.toISOString(),
    lead: {
      name: "Jane Citizen",
      email: "jane@example.com",
      phone: "0400 000 000",
      postcode: "3000",
      suburb: "MELBOURNE",
      state: "VIC",
      services,
      propertyType: "house",
      tenure: "owner-occupier",
      budgetRange: "not-set",
      contactPreference: "either",
      bestContactTime: "business-hours",
      quoteAnswers: widgetQuoteAnswersForServices(services, {
        timing: "Not sure",
        "assessment-information": "Not sure",
        "solar-electrical-export": "Not sure",
        "battery-electrical-supply": "Not sure",
        "heating-electrical-supply": "Not sure",
        "hot-water-electrical-supply": "Not sure",
        "electric-cooking-electrical-supply": "Not sure",
        "draught-ventilation-safety": "Not sure",
        "insulation-access": "Not sure",
        "glazing-existing-frames": "Not sure",
        "window-covering-access": "Not sure",
        "ev-electrical-path": "Not sure",
      }),
      message: "Please triage the services that need a site inspection before any quote.",
      marketingConsent: false,
      tradeSharingConsent: true,
      sharePhone: false,
    },
  });
  const result = await createEnergyAssistantLead(allServicePayload, dependencies(d1, {
    createOpportunity: async () => ({
      id: stageAssistantOpportunity(database, "opportunity-all-services"),
      allocation: { allocated: [] },
    }),
  }));
  assert.equal(result.status, "shared_with_trades");
  const row = database.prepare("SELECT quote_brief_json, trade_disclosed_snapshot_json FROM energy_assistant_leads").get();
  const brief = JSON.parse(row.quote_brief_json);
  assert.equal(brief.readiness.requiredQuestionIds.length, questions.length);
  assert.equal(brief.readiness.missingQuestionIds.length, 0);
  assert.ok(brief.readiness.capturedUnknownQuestionIds.length >= 12);
  assert.deepEqual(brief.readiness.insufficientKnownServiceIds, []);
  assert.ok(row.quote_brief_json.length <= 32_768);
  assert.ok(row.trade_disclosed_snapshot_json.length <= 40_000);
});

test("a separately consented trade handoff creates one protected opportunity from the immutable disclosed snapshot", async (t) => {
  const { database, d1 } = fixture();
  t.after(() => database.close());
  const opportunities = [];
  const tradePayload = shareablePayload();
  const created = await createEnergyAssistantLead(tradePayload, dependencies(d1, {
    createOpportunity: async (opportunity) => {
      opportunities.push(opportunity);
      return {
        id: stageAssistantOpportunity(database, "opportunity-1"),
        allocation: { allocated: [] },
      };
    },
  }));
  assert.equal(created.status, "shared_with_trades");
  assert.equal(created.opportunityId, "opportunity-1");
  assert.equal(created.dispatchJobId, `energy-assistant-dispatch:${leadId}`);
  assert.equal(created.tradeSharing, "shared");
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].sourceJourney, "energy-assistant");
  assert.equal(opportunities[0].tradeSharing.phone, false);
  assert.doesNotMatch(JSON.stringify(opportunities[0]), /transcript|nmi|account identifier/i);

  const row = database.prepare("SELECT * FROM energy_assistant_leads").get();
  const disclosedFields = JSON.parse(row.trade_disclosed_fields_json);
  const snapshot = JSON.parse(row.trade_disclosed_snapshot_json);
  assert.deepEqual(disclosedFields, [
    "customer_email",
    "postcode",
    "state",
    "service_categories",
    "quote_brief",
    "customer_name",
  ]);
  assert.equal(snapshot.contact.phone, undefined);
  assert.equal(snapshot.quoteBrief.knownFacts[0].value, "Gas storage hot water");
  assert.match(row.trade_disclosed_snapshot_sha256, /^[a-f0-9]{64}$/);
  assert.equal(row.marketing_consent, 1);
  assert.equal(row.marketing_consent_granted_at, NOW.toISOString());
  assert.equal(database.prepare("SELECT COUNT(*) total FROM energy_assistant_lead_events").get().total, 2);

  const replay = await createEnergyAssistantLead(tradePayload, dependencies(d1, {
    createOpportunity: async () => {
      throw new Error("an existing linked opportunity must not be recreated");
    },
  }));
  assert.equal(replay.created, false);
  assert.equal(replay.opportunityId, "opportunity-1");
  assert.equal(replay.dispatchJobId, `energy-assistant-dispatch:${leadId}`);
});

test("a failed atomic link leaves the durable opportunity draft and a replay reconciles exactly once", async (t) => {
  const { database, d1 } = fixture();
  t.after(() => database.close());
  const tradePayload = shareablePayload();
  const linkFailingD1 = {
    prepare(sql) { return d1.prepare(sql); },
    async batch(statements) {
      if (statements.some((statement) => statement.sql.includes(
        "INSERT INTO customer_opportunity_dispatch_jobs",
      ))) {
        throw new Error("injected durable link failure");
      }
      return d1.batch(statements);
    },
  };

  await assert.rejects(
    createEnergyAssistantLead(tradePayload, dependencies(linkFailingD1, {
      createOpportunity: async () => ({
        id: stageAssistantOpportunity(database, "opportunity-link-recovery"),
        allocation: { allocated: [] },
      }),
    })),
    /injected durable link failure/,
  );
  assert.deepEqual(
    { ...database.prepare(`SELECT status, opportunity_id
      FROM energy_assistant_leads WHERE id = ?`).get(leadId) },
    { status: "quote_ready", opportunity_id: "" },
  );
  assert.equal(
    database.prepare("SELECT status FROM trade_opportunities").get().status,
    "draft",
  );
  assert.equal(database.prepare("SELECT COUNT(*) total FROM admin_notifications").get().total, 0);
  assert.equal(database.prepare("SELECT COUNT(*) total FROM customer_opportunity_dispatch_jobs").get().total, 0);
  assert.equal(database.prepare("SELECT COUNT(*) total FROM energy_assistant_lead_events").get().total, 1);

  const recovered = await createEnergyAssistantLead(tradePayload, dependencies(d1, {
    createOpportunity: async () => ({
      id: stageAssistantOpportunity(database, "opportunity-link-recovery"),
      allocation: { allocated: [] },
    }),
  }));
  assert.equal(recovered.created, false);
  assert.equal(recovered.status, "shared_with_trades");
  assert.equal(recovered.opportunityId, "opportunity-link-recovery");
  assert.equal(recovered.dispatchJobId, `energy-assistant-dispatch:${leadId}`);
  assert.equal(database.prepare("SELECT status FROM trade_opportunities").get().status, "open");
  assert.equal(database.prepare("SELECT COUNT(*) total FROM admin_notifications").get().total, 1);
  assert.equal(database.prepare("SELECT COUNT(*) total FROM customer_opportunity_dispatch_jobs").get().total, 1);
  assert.equal(database.prepare("SELECT COUNT(*) total FROM energy_assistant_lead_events").get().total, 2);
});

for (const postPersistFailure of [
  "installer allocation",
  "marketplace enquiry sync",
  "notification enqueue",
]) {
  test(`a worker failure during ${postPersistFailure} stays durably linked and a replay preserves retry state exactly once`, async (t) => {
    const { database, d1 } = fixture();
    t.after(() => database.close());
    const tradePayload = shareablePayload();
    const created = await createEnergyAssistantLead(tradePayload, dependencies(d1, {
      createOpportunity: async () => ({
        id: stageAssistantOpportunity(database, "opportunity-dispatch-recovery"),
        allocation: { allocated: [] },
      }),
    }));
    assert.equal(created.status, "shared_with_trades");
    assert.equal(created.opportunityId, "opportunity-dispatch-recovery");
    assert.equal(created.dispatchJobId, `energy-assistant-dispatch:${leadId}`);
    assert.deepEqual(
      { ...database.prepare(`SELECT status, opportunity_id
        FROM energy_assistant_leads WHERE id = ?`).get(leadId) },
      {
        status: "shared_with_trades",
        opportunity_id: "opportunity-dispatch-recovery",
      },
    );
    assert.equal(database.prepare("SELECT status FROM trade_opportunities").get().status, "open");
    const nextAttemptAt = "2026-08-20T02:05:00.000Z";
    database.prepare(`UPDATE customer_opportunity_dispatch_jobs
      SET status = 'failed', attempts = 1, next_attempt_at = ?, failed_at = ?,
        last_error = ?, updated_at = ?
      WHERE id = ?`)
      .run(
        nextAttemptAt,
        NOW.toISOString(),
        `${postPersistFailure} failed`,
        NOW.toISOString(),
        created.dispatchJobId,
      );
    assert.equal(database.prepare("SELECT COUNT(*) total FROM energy_assistant_lead_events").get().total, 2);

    const replay = await createEnergyAssistantLead(tradePayload, dependencies(d1, {
      createOpportunity: async () => {
        throw new Error("a linked opportunity must be recovered, not recreated");
      },
    }));
    assert.equal(replay.created, false);
    assert.equal(replay.opportunityId, "opportunity-dispatch-recovery");
    assert.equal(replay.dispatchJobId, created.dispatchJobId);
    assert.deepEqual({ ...database.prepare(`SELECT status, attempts, next_attempt_at,
        last_error FROM customer_opportunity_dispatch_jobs`).get() }, {
      status: "failed",
      attempts: 1,
      next_attempt_at: nextAttemptAt,
      last_error: `${postPersistFailure} failed`,
    });
    assert.equal(database.prepare("SELECT COUNT(*) total FROM trade_opportunities").get().total, 1);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM customer_opportunity_dispatch_jobs").get().total, 1);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM admin_notifications").get().total, 1);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM energy_assistant_lead_events").get().total, 2);
  });
}

test("request IDs are bound to a secret submission hash and cannot be replayed with changed personal data", async (t) => {
  const { database, d1 } = fixture();
  t.after(() => database.close());
  await createEnergyAssistantLead(payload(), dependencies(d1));
  await assert.rejects(
    createEnergyAssistantLead(payload({ name: "Different Person" }), dependencies(d1)),
    (error) => error instanceof EnergyAssistantLeadError && error.status === 409,
  );
  await assert.rejects(
    createEnergyAssistantLead(payload({ submissionKey: "C".repeat(43) }), dependencies(d1)),
    (error) => error instanceof EnergyAssistantLeadError && error.status === 409,
  );
});

test("lead route preserves origin, body, rate-limit, idempotency and operational notification boundaries", () => {
  const source = fs.readFileSync(
    new URL("../src/app/api/energy-assistant/leads/route.ts", import.meta.url),
    "utf8",
  );
  for (const boundary of [
    "sameOrigin(request)",
    "MAX_BODY_BYTES",
    "createSharedLeadRateLimiter",
    "createEnergyAssistantLead",
    "await createAdminNotification",
    "CUSTOMER_OPPORTUNITY_DISPATCH_HEADER",
    "result.dispatchJobId",
    "energy_assistant_lead",
    "opportunityId",
    "tradeSharing",
    "pending_information",
    "Cache-Control",
  ]) assert.ok(source.includes(boundary), `missing ${boundary}`);
  assert.doesNotMatch(source, /drainCustomerOpportunityDispatchJobs|allocateNearestInstallers/);
  assert.doesNotMatch(source, /verifyEnergyAssistantSessionCredential|sessionId|accessKey|transcript/);
});

test("migration stores only explicit follow-ups and immutable lead audit events", (t) => {
  const { database } = fixture();
  t.after(() => database.close());
  const tables = database.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name LIKE 'energy_assistant_%' ORDER BY name`).all().map((row) => row.name);
  assert.deepEqual(tables, [
    "energy_assistant_lead_events",
    "energy_assistant_leads",
  ]);
  assert.doesNotMatch(migration, /energy_assistant_(?:sessions|messages|request_receipts|rate_limits)/);
  assert.match(migration, /UNIQUE \(`request_id`\)/);
  assert.match(migration, /`submission_key_sha256` text NOT NULL/);
  assert.match(migration, /`trade_disclosed_snapshot_sha256` text DEFAULT '' NOT NULL/);
  assert.match(migration, /`interest_confirmed` integer NOT NULL CHECK \(`interest_confirmed` = 1\)/);
  assert.match(migration, /'needs_information'/);
  assert.match(migration, /json_extract\(`quote_brief_json`, '\$\.readiness\.state'\) = 'quote_ready'/);
});
