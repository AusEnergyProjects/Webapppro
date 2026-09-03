import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  createLeadEnvelope,
  publicPlanSubmissionFingerprint,
} from "../src/lib/lead-envelope.mjs";
import { createLeadPostHandler } from "../src/lib/lead-route-handler.mjs";
import { validateLeadPayload } from "../src/lib/lead-validation.mjs";
import { persistLeadOpportunity } from "../src/lib/opportunity-source-write.mjs";
import {
  publicPlanContactReleaseDisclosedFieldsAreValid,
} from "../src/lib/public-plan-enquiry.mjs";
import { publicTradeContactForMatchedLead } from "../src/lib/public-trade-lead-access.mjs";
import {
  isQuickUpgradeEnquiry,
  isQuickUpgradeSubmissionId,
  QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
  QUICK_UPGRADE_CONSENT_PURPOSE,
  QUICK_UPGRADE_ENQUIRY_KIND,
  QUICK_UPGRADE_SOURCE_JOURNEY,
} from "../src/lib/quick-upgrade-enquiry.mjs";

function validQuickUpgrade(overrides = {}) {
  return {
    submissionType: "upgrade",
    enquiry: QUICK_UPGRADE_ENQUIRY_KIND,
    submissionId: "20260903.12345678-abcd-4abc-8def-123456789abc",
    customerFirstName: "Jamie",
    customerLastName: "Customer",
    email: "Jamie@Example.com",
    phone: "0400 000 000",
    customerUnitNumber: "Unit 4",
    customerStreetAddress: "15 Example Street",
    customerSuburb: "melbourne",
    customerState: "vic",
    postcode: "3000",
    projectCategories: ["heating-cooling", "insulation"],
    projectNotes: "Please help me compare practical options.",
    tradeSharing: {
      email: true,
      postcode: true,
      address: true,
      name: false,
      phone: false,
    },
    website: "",
    clientStartedAt: Date.now() - 1_000,
    consent: {
      accepted: true,
      purpose: QUICK_UPGRADE_CONSENT_PURPOSE,
      noticeVersion: QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
      grantedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

test("the quick upgrade contract uses one bounded current consent and stable public identity", () => {
  assert.equal(QUICK_UPGRADE_ENQUIRY_KIND, "quick-upgrade-options");
  assert.equal(QUICK_UPGRADE_SOURCE_JOURNEY, "quick-upgrade-options");
  assert.ok(QUICK_UPGRADE_CONSENT_PURPOSE.length <= 160);
  assert.ok(QUICK_UPGRADE_CONSENT_NOTICE_VERSION.length <= 64);
  assert.equal(isQuickUpgradeEnquiry(QUICK_UPGRADE_ENQUIRY_KIND), true);
  assert.equal(
    isQuickUpgradeSubmissionId("20260903.12345678-abcd-4abc-8def-123456789abc"),
    true,
  );
  assert.equal(isQuickUpgradeSubmissionId("20260903.not-a-uuid"), false);
});

test("quick upgrade validation canonicalizes the verified address and keeps only its bounded contract", () => {
  const result = validateLeadPayload(validQuickUpgrade());
  assert.equal(result.ok, true);
  assert.equal(result.value.email, "jamie@example.com");
  assert.equal(result.value.customerSuburb, "MELBOURNE");
  assert.equal(result.value.customerState, "VIC");
  assert.equal(result.value.state, "VIC");
  assert.equal(result.value.preferredContact, "either");
  assert.deepEqual(result.value.projectCategories, ["heating-cooling", "insulation"]);
  assert.deepEqual(result.value.tradeSharing, {
    email: true,
    postcode: true,
    address: true,
    name: false,
    phone: false,
  });
  assert.equal("planSnapshot" in result.value, false);
  assert.equal("quotePreparation" in result.value, false);
  assert.equal("top3" in result.value, false);
  assert.equal("annualKwh" in result.value, false);
});

test("quick upgrade validation fails closed at every public trust boundary", () => {
  const invalidCases = [
    [validQuickUpgrade({ submissionType: "comparison" }), /unknown enquiry type/i],
    [validQuickUpgrade({ submissionId: "bad" }), /new upgrade request/i],
    [validQuickUpgrade({ email: "" }), /email address/i],
    [validQuickUpgrade({ email: "not-email" }), /valid email/i],
    [validQuickUpgrade({ customerStreetAddress: "" }), /street address/i],
    [validQuickUpgrade({ customerSuburb: "Sydney", customerState: "NSW" }), /listed for this postcode/i],
    [validQuickUpgrade({ projectCategories: [] }), /at least one service/i],
    [validQuickUpgrade({ projectCategories: ["not-a-service"] }), /at least one service/i],
    [validQuickUpgrade({ phone: "call me" }), /valid phone/i],
    [validQuickUpgrade({ tradeSharing: { email: true, postcode: true, address: false, name: false, phone: false } }), /address must be shared/i],
    [validQuickUpgrade({ tradeSharing: { email: true, postcode: true, address: true, name: false } }), /optional trade sharing preference/i],
    [validQuickUpgrade({ phone: "", tradeSharing: { email: true, postcode: true, address: true, name: false, phone: true } }), /enter a phone number/i],
    [validQuickUpgrade({ customerLastName: "", tradeSharing: { email: true, postcode: true, address: true, name: true, phone: false } }), /both first and last name/i],
    [validQuickUpgrade({ projectNotes: "My NMI number is 6407123456" }), /remove nmi/i],
    [validQuickUpgrade({ projectNotes: "Access code 123456" }), /remove nmi/i],
    [validQuickUpgrade({ projectNotes: "Card 4111 1111 1111 1111" }), /remove nmi/i],
    [validQuickUpgrade({ projectNotes: "Payment details: BSB 123-456, 12345678" }), /remove nmi/i],
    [validQuickUpgrade({ projectNotes: "Call me on 0400 000 000" }), /remove nmi/i],
    [validQuickUpgrade({ clientStartedAt: undefined }), /new upgrade request/i],
    [validQuickUpgrade({ consent: { accepted: true, purpose: "old", noticeVersion: QUICK_UPGRADE_CONSENT_NOTICE_VERSION, grantedAt: new Date().toISOString() } }), /current sharing notice/i],
  ];
  for (const [payload, expected] of invalidCases) {
    const result = validateLeadPayload(payload);
    assert.equal(result.ok, false, JSON.stringify(payload));
    assert.match(result.error, expected);
  }
  assert.equal(validateLeadPayload(validQuickUpgrade({
    projectNotes: "The house number is 15. I would like help with insulation after 4 pm.",
  })).ok, true);
});

test("the quick envelope opens automatic matching without manufacturing a plan or PDF", () => {
  const validated = validateLeadPayload(validQuickUpgrade({
    tradeSharing: {
      email: true,
      postcode: true,
      address: true,
      name: true,
      phone: true,
    },
  }));
  assert.equal(validated.ok, true);
  const envelope = createLeadEnvelope(validated.value, {
    now: () => new Date("2026-09-03T01:02:03.000Z"),
    createId: () => "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  });
  assert.equal(envelope.eventType, "direct_trade.project");
  assert.equal(envelope.sourceJourney, QUICK_UPGRADE_SOURCE_JOURNEY);
  assert.equal(envelope.reference, "AEA-20260903-12345678ABCD4ABC");
  assert.equal(envelope.directTradeTriage.autoSend, true);
  assert.equal(envelope.directTradeTriage.status, "automatic_verified_area_allocation");
  assert.deepEqual(envelope.directTradeTriage.contactConsentReceipt.disclosedFields, [
    "customer_email",
    "postcode",
    "service_categories",
    "customer_address",
    "customer_name",
    "customer_phone",
    "customer_message",
  ]);
  assert.equal("planSnapshot" in envelope, false);
  assert.equal("quotePreparation" in envelope, false);
  assert.equal("customerPlanDelivery" in envelope, false);
  assert.match(envelope.submissionFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(
    envelope.submissionFingerprint,
    publicPlanSubmissionFingerprint(validated.value),
  );
});

test("quick contact releases require address and reveal only customer-selected optional fields", () => {
  const requiredFields = [
    "customer_email",
    "postcode",
    "service_categories",
    "customer_address",
    "customer_message",
  ];
  assert.equal(publicPlanContactReleaseDisclosedFieldsAreValid(
    QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
    QUICK_UPGRADE_CONSENT_PURPOSE,
    requiredFields,
  ), true);
  assert.equal(publicPlanContactReleaseDisclosedFieldsAreValid(
    QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
    QUICK_UPGRADE_CONSENT_PURPOSE,
    requiredFields.filter((field) => field !== "customer_address"),
  ), false);
  const baseRow = {
    public_contact_release_id: "contact-1",
    public_contact_status: "active",
    public_contact_source_reference: "AEA-20260903-1234",
    source_reference: "AEA-20260903-1234",
    public_contact_withdrawn_at: "",
    public_contact_postcode: "3000",
    opportunity_postcode: "3000",
    public_contact_granted_at: "2026-09-03T01:02:03.000Z",
    public_contact_notice_version: QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
    public_contact_consent_purpose: QUICK_UPGRADE_CONSENT_PURPOSE,
    public_contact_disclosed_fields: JSON.stringify(requiredFields),
    public_customer_first_name: "Jamie",
    public_customer_last_name: "Customer",
    public_customer_email: "jamie@example.com",
    public_customer_phone: "0400 000 000",
    public_customer_street_address: "15 Example Street",
    public_customer_unit_number: "Unit 4",
    public_customer_suburb: "MELBOURNE",
    public_customer_address_state: "VIC",
    public_customer_message: "Please help me compare practical options.",
    state: "VIC",
  };
  const requiredOnly = publicTradeContactForMatchedLead(baseRow);
  assert.deepEqual({
    name: requiredOnly.name,
    phone: requiredOnly.phone,
    email: requiredOnly.email,
    addressLine1: requiredOnly.addressLine1,
    message: requiredOnly.message,
  }, {
    name: "",
    phone: "",
    email: "jamie@example.com",
    addressLine1: "15 Example Street",
    message: "Please help me compare practical options.",
  });
  const allSelected = publicTradeContactForMatchedLead({
    ...baseRow,
    public_contact_disclosed_fields: JSON.stringify([
      ...requiredFields,
      "customer_name",
      "customer_phone",
    ]),
  });
  assert.equal(allSelected.name, "Jamie Customer");
  assert.equal(allSelected.phone, "0400 000 000");
});

function quickHandler({
  createOpportunityFromLead = async () => ({
    id: "opportunity-quick-1",
    allocation: { activeCount: 2 },
  }),
  recordLeadIncident = async () => {},
  recordQuickUpgradeNoMatch = async () => {},
} = {}) {
  return createLeadPostHandler({
    validateLeadPayload,
    createLeadEnvelope,
    createOperationalRecorder: () => ({
      requestId: "request-quick-1",
      record() {},
    }),
    leadRateLimiter: { async check() { return { allowed: true }; } },
    recordLeadIncident,
    recordQuickUpgradeNoMatch,
    async resolveSystemAdminNotifications() {},
    isPublicPlanEnquiry: () => false,
    isQuickUpgradeEnquiry,
    createOpportunityFromLead,
    opportunityNotificationDispatchHeader:
      "X-AEA-Opportunity-Notification-Dispatch",
    env: {},
    fetchImpl: async () => {
      throw new Error("The private webhook must not receive a quick upgrade lead.");
    },
  });
}

async function submitQuick(handler, payload = validQuickUpgrade()) {
  return handler(new Request("https://ausenergyassessments.com/api/leads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://ausenergyassessments.com",
    },
    body: JSON.stringify(payload),
  }));
}

test("the quick route persists, allocates and queues background trade notifications without webhook or plan delivery", async () => {
  let createdPayload;
  const response = await submitQuick(quickHandler({
    createOpportunityFromLead: async (payload) => {
      createdPayload = payload;
      return { id: "opportunity-quick-1", allocation: { activeCount: 2 } };
    },
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    reference: "AEA-20260903-12345678ABCD4ABC",
    matchedBusinessCount: 2,
    notificationStatus: "queued",
  });
  assert.equal(createdPayload.sourceJourney, QUICK_UPGRADE_SOURCE_JOURNEY);
  assert.equal(
    response.headers.get("X-AEA-Opportunity-Notification-Dispatch"),
    "opportunity-quick-1",
  );
});

test("a quick request with no current match queues Australian Energy Assessments follow-up without scheduling an empty trade drain", async () => {
  const reviewQueue = [];
  const response = await submitQuick(quickHandler({
    createOpportunityFromLead: async () => ({
      id: "opportunity-no-match-1",
      allocation: { activeCount: 0 },
    }),
    recordQuickUpgradeNoMatch: async (opportunityId) => reviewQueue.push(opportunityId),
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.notificationStatus, "no_match");
  assert.equal(body.matchedBusinessCount, 0);
  assert.deepEqual(reviewQueue, ["opportunity-no-match-1"]);
  assert.equal(response.headers.has("X-AEA-Opportunity-Notification-Dispatch"), false);
});

test("a quick request fails visibly when its required no-match follow-up cannot be queued", async () => {
  const incidents = [];
  const response = await submitQuick(quickHandler({
    createOpportunityFromLead: async () => ({
      id: "opportunity-no-match-2",
      allocation: { activeCount: 0 },
    }),
    recordQuickUpgradeNoMatch: async () => {
      throw new Error("ADMIN_NOTIFICATION_UNAVAILABLE");
    },
    recordLeadIncident: async (...input) => incidents.push(input),
  }));
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.ok, false);
  assert.equal(body.reference, "AEA-20260903-12345678ABCD4ABC");
  assert.match(body.error, /saved, but follow-up could not be scheduled/);
  assert.equal(incidents[0][0], "platform.quick_upgrade_review_queue_failed");
});

function databaseAdapter(database) {
  return {
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            async run() { return database.prepare(sql).run(...bindings); },
            async first() { return database.prepare(sql).get(...bindings) || null; },
          };
        },
      };
    },
  };
}

function sourceDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE trade_opportunities (
    id text PRIMARY KEY NOT NULL, title text NOT NULL, project_type text NOT NULL,
    postcode text NOT NULL, state text NOT NULL, service_categories text NOT NULL,
    priority text NOT NULL, timing text NOT NULL, summary text NOT NULL, status text NOT NULL,
    source_reference text NOT NULL, contact_limit integer NOT NULL,
    maximum_connected_installers integer NOT NULL, expires_at text NOT NULL,
    expired_at text NOT NULL, created_by_uid text NOT NULL, created_at text NOT NULL,
    updated_at text NOT NULL
  );
  CREATE UNIQUE INDEX trade_opportunities_source_reference_idx
    ON trade_opportunities (source_reference) WHERE source_reference <> '';
  CREATE TABLE public_trade_lead_contact_releases (
    id text PRIMARY KEY NOT NULL, opportunity_id text NOT NULL UNIQUE,
    source_reference text NOT NULL UNIQUE, status text NOT NULL,
    notice_version text NOT NULL, consent_purpose text NOT NULL,
    disclosed_fields text NOT NULL, customer_name text NOT NULL,
    customer_first_name text NOT NULL, customer_last_name text NOT NULL,
    customer_email text NOT NULL, customer_phone text NOT NULL,
    customer_unit_number text NOT NULL, customer_street_address text NOT NULL,
    customer_suburb text NOT NULL, customer_address_state text NOT NULL,
    postcode text NOT NULL, customer_message text NOT NULL, granted_at text NOT NULL,
    withdrawn_at text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL
  );`);
  return database;
}

function durableOpportunity(id) {
  return {
    id,
    title: "Heating and cooling project",
    projectType: "Home | Planning",
    postcode: "3000",
    state: "VIC",
    serviceCategories: JSON.stringify(["heating-cooling"]),
    priority: "standard",
    timing: "planning",
    summary: "Quick upgrade request.",
    requestedStatus: "open",
    sourceReference: "AEA-20260903-IDEMPOTENT",
    contactLimit: 2,
    maximumConnectedInstallers: 3,
    expiresAt: "2026-10-03T00:00:00.000Z",
    createdAt: "2026-09-03T00:00:00.000Z",
    publicPlanEnquiry: true,
  };
}

function durableContact(id, overrides = {}) {
  return {
    id,
    noticeVersion: QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
    consentPurpose: QUICK_UPGRADE_CONSENT_PURPOSE,
    disclosedFields: [
      "customer_email", "postcode", "service_categories", "customer_address",
    ],
    customerFirstName: "",
    customerLastName: "",
    customerEmail: "jamie@example.test",
    customerPhone: "",
    customerUnitNumber: "Unit 4",
    customerStreetAddress: "15 Example Street",
    customerSuburb: "MELBOURNE",
    customerAddressState: "VIC",
    customerMessage: "",
    grantedAt: "2026-09-03T00:00:00.000Z",
    ...overrides,
  };
}

test("quick retries converge on one durable opportunity and reject a changed address", async () => {
  const database = sourceDatabase();
  const adapter = databaseAdapter(database);
  const currentConsent = {
    noticeVersion: QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
    purpose: QUICK_UPGRADE_CONSENT_PURPOSE,
  };
  const [first, retry] = await Promise.all([
    persistLeadOpportunity(adapter, durableOpportunity("opportunity-a"), durableContact("contact-a"), currentConsent),
    persistLeadOpportunity(adapter, durableOpportunity("opportunity-b"), durableContact("contact-b"), currentConsent),
  ]);
  assert.equal(first.id, retry.id);
  assert.equal(first.status, "open");
  assert.equal(retry.contactIsCurrent, true);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_opportunities").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM public_trade_lead_contact_releases").get().count, 1);
  await assert.rejects(() => persistLeadOpportunity(
    adapter,
    durableOpportunity("opportunity-c"),
    durableContact("contact-c", { customerStreetAddress: "99 Changed Street" }),
    currentConsent,
  ), /OPPORTUNITY_SOURCE_REFERENCE_MISMATCH/);
  database.close();
});
