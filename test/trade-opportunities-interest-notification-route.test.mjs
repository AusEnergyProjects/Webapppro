import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/app/api/trade-opportunities/route.ts", import.meta.url), "utf8");

function loadRoute(state) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: "src/app/api/trade-opportunities/route.ts",
  }).outputText;
  class Statement {
    constructor(sql) { this.sql = sql; }
    bind() { return this; }
    async first() {
      if (this.sql.includes("SELECT m.status, m.opportunity_id")) return {
        status: state.status, opportunity_id: "opportunity-1", title: "Heat-pump lead", source_reference: "public-plan:lead-1",
      };
      if (this.sql.includes("public_contact.id public_contact_release_id")) return {
        public_contact_release_id: "release-1", source_reference: "public-plan:lead-1",
      };
      return null;
    }
    async all() { return { results: [] }; }
    async run() { return { success: true, meta: { changes: 0 } }; }
  }
  const db = { prepare: (sql) => new Statement(sql), batch: async () => [] };
  const workflow = async () => {
    state.workflowCalls += 1;
    if (state.workflowFails) throw new Error("COPY_FAILED");
    if (!state.handoff) {
      state.handoff = { workOrderId: "job-1", workNumber: "JOB-1", customerId: "customer-1",
        quoteId: "quote-1", quoteVersionId: "version-1", replayed: false };
      state.status = "interested";
      state.handoffCommits += 1;
      return state.handoff;
    }
    return { ...state.handoff, replayed: true };
  };
  class TradeAccessError extends Error { constructor(code) { super(code); this.code = code; } }
  const mocks = {
    "../../../../db": { getD1: () => db },
    "@/lib/admin-server": { parseJsonList: () => [] },
    "@/lib/opportunity-server": { allocateNearestInstallers: async () => {}, expireStaleOpportunities: async () => {},
      syncMarketplaceEnquiries: async () => { state.syncCalls += 1; } },
    "@/lib/direct-trade-entitlements-server": { accountHasFeature: async () => true },
    "@/lib/trade-access-server": { TradeAccessError, verifiedTradeAccountPredicate: () => "1 = 1",
      requireVerifiedTradeAccess: async () => ({ identity: { uid: "installer-1" }, businessName: "Installer One" }) },
    "@/lib/customer-projects.mjs": { buildInstallerPropertyContext: () => ({}), normalizePlatformQuote: () => ({ ok: false }), parseStoredJson: () => ({}) },
    "@/lib/customer-matching-locality.mjs": { CUSTOMER_MATCHING_NOTICE_VERSION: "v1", matchingLocalityDisclosure: () => null },
    "@/lib/public-plan-enquiry.mjs": { PUBLIC_PLAN_CONSENT_NOTICE_VERSION: "v1", PUBLIC_PLAN_CONSENT_PURPOSE: "lead" },
    "@/lib/public-trade-lead-access.mjs": { publicTradeContactForMatchedLead: () => true },
    "@/lib/public-lead-quote-workflow-server": { startPublicLeadQuoteWorkflow: workflow },
    "@/lib/public-plan-quote-preparation.mjs": { PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION: "v1", PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE: "quote",
      publicPlanQuoteAnswersForMatchedCategories: () => [], publicPlanQuoteCategoryIntersection: () => [], strictPublicPlanQuoteServiceCategories: () => [] },
    "@/lib/customer-plan-document.mjs": { createInstallerEnquiryPack: () => null },
    "@/lib/customer-project-arrivals.mjs": { normaliseArrivalWindows: () => [], parseArrivalWindows: () => [] },
    "@/lib/admin-notifications": { adminNotificationStatement: () => ({ bind: () => ({}) }),
      createAdminNotification: async () => { state.notificationCalls += 1; throw new Error("NOTIFICATION_UNAVAILABLE"); } },
    "@/lib/admin-notification-delivery": { dispatchAdminNotificationDeliveries: async () => {} },
    "@/lib/customer-project-activity-notification-server": { CUSTOMER_PROJECT_ACTIVITY_DISPATCH_HEADER: "x-test",
      customerProjectActivityStatements: async () => ({ statements: [], deliveryId: "delivery-1" }) },
    "@/lib/customer-project-activity-notifications": { customerProjectQuoteId: async () => "quote-1" },
    "@/lib/trade-opportunity-read-projection.mjs": { arrivalProposalForMatchedLead: () => null,
      customerProjectContactForMatchedLead: () => null, customerProjectContextMatchesBase: () => false,
      platformQuoteForMatchedLead: () => null },
  };
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(require, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

async function interested(route) {
  return route.PATCH(new Request("https://test/api/trade-opportunities", {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ matchId: "match-1", action: "respond", status: "interested" }),
  }));
}

test("notification failure after canonical Interested handoff remains a successful replayable response", async () => {
  const state = { status: "offered", workflowCalls: 0, workflowFails: false, handoff: null,
    handoffCommits: 0, notificationCalls: 0, syncCalls: 0 };
  const route = loadRoute(state);
  const first = await interested(route); const firstBody = await first.json();
  assert.equal(first.status, 200); assert.equal(firstBody.ok, true);
  assert.equal(firstBody.quoteWorkflow.workOrderId, "job-1");
  assert.equal(firstBody.quoteWorkflow.quoteId, "quote-1");
  assert.equal(firstBody.quoteWorkflow.replayed, false);
  const retry = await interested(route); const retryBody = await retry.json();
  assert.equal(retry.status, 200); assert.equal(retryBody.quoteWorkflow.replayed, true);
  assert.equal(state.handoffCommits, 1); assert.equal(state.workflowCalls, 2);
  assert.equal(state.notificationCalls, 2);
});

test("canonical workflow failure still returns 409 and records no interest or handoff", async () => {
  const state = { status: "offered", workflowCalls: 0, workflowFails: true, handoff: null,
    handoffCommits: 0, notificationCalls: 0, syncCalls: 0 };
  const response = await interested(loadRoute(state)); const body = await response.json();
  assert.equal(response.status, 409); assert.equal(body.ok, false);
  assert.match(body.error, /No interest was recorded/);
  assert.equal(state.status, "offered"); assert.equal(state.handoffCommits, 0);
  assert.equal(state.notificationCalls, 0);
});
