import * as aeaTradeRouting from "../src/lib/aea-trade-routing.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { certificateTestDependency } from "./helpers/creditex-training-fixture.mjs";
import { migratedDataforceSqlite } from "./helpers/trade-dataforce-database.mjs";

const source = fs.readFileSync(new URL("../src/app/api/trade-opportunities/route.ts", import.meta.url), "utf8");

function loadRoute(state) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: "src/app/api/trade-opportunities/route.ts",
  }).outputText;
  class Statement {
    constructor(sql) { this.sql = sql; }
    bind(...values) { this.values=values; return this; }
    async first() {
      if(state.database)return state.database.prepare(this.sql).get(...(this.values||[]))||null;
      if (this.sql.includes("SELECT o.service_categories")) return { service_categories: Object.hasOwn(state, "serviceCategories") ? state.serviceCategories : JSON.stringify(["solar"]) };
      if (this.sql.includes("SELECT m.status, m.opportunity_id")) return {
        opportunity_service_categories: JSON.stringify(["solar"]), status: state.status, opportunity_id: "opportunity-1", title: "Heat-pump lead", source_reference: "public-plan:lead-1",
      };
      if (this.sql.includes("public_contact.id public_contact_release_id")) return {
        public_contact_release_id: "release-1", source_reference: "public-plan:lead-1",
      };
      return null;
    }
    async all() { return { results: state.database?state.database.prepare(this.sql).all(...(this.values||[])):[] }; }
    async run() { return { success: true, meta: { changes: state.database?Number(state.database.prepare(this.sql).run(...(this.values||[])).changes):0 } }; }
  }
  const db = { prepare: (sql) => new Statement(sql), batch: async statements => {
    if(!state.database)return [];
    state.beforeBatch?.();state.database.exec('BEGIN');
    try{const results=[];for(const statement of statements)results.push(await statement.run());state.database.exec('COMMIT');return results;}
    catch(error){state.database.exec('ROLLBACK');throw error;}
  } };
  const workflow = async () => {
    state.workflowCalls += 1;
    if (state.workflowFails) throw new Error(state.workflowErrorCode || "COPY_FAILED");
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
    "@/lib/aea-trade-routing.mjs": aeaTradeRouting,
    "../../../../db": { getD1: () => db },
    "@/lib/admin-server": { parseJsonList: () => [] },
    "@/lib/opportunity-server": { allocateNearestInstallers: async () => {}, expireStaleOpportunities: async () => {},
      syncMarketplaceEnquiries: async () => { state.syncCalls += 1; } },
    "@/lib/direct-trade-entitlements-server": { accountHasFeature: async () => true },
    "@/lib/trade-access-server": { TradeAccessError, verifiedTradeAccountPredicate: () => "1 = 1",
      requireVerifiedTradeAccess: async () => ({ identity: { uid: "installer-1" }, businessName: "Installer One" }) },
    "@/lib/customer-projects.mjs": { buildInstallerPropertyContext: () => ({}), normalizePlatformQuote: () => ({ ok: false }), parseStoredJson: () => ({}) },
    "@/lib/customer-matching-locality.mjs": { CUSTOMER_MATCHING_NOTICE_VERSION: "v1", matchingLocalityDisclosure: () => null },
    "@/lib/public-plan-enquiry.mjs": { PUBLIC_PLAN_CONSENT_NOTICE_VERSION: "v1", PUBLIC_PLAN_CONSENT_PURPOSE: "lead",allQualifiedTradeOpportunitySql:()=>"0" },
    "@/lib/public-trade-lead-access.mjs": { publicTradeContactForMatchedLead: () => true },
    "@/lib/public-lead-quote-workflow-server": { startPublicLeadQuoteWorkflow: workflow },
    "@/lib/public-plan-quote-preparation.mjs": { PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION: "v1", PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE: "quote",
      publicPlanQuoteAnswersForMatchedCategories: () => [], publicPlanQuoteCategoryIntersection: () => [], strictPublicPlanQuoteServiceCategories: () => [] },
    "@/lib/customer-plan-document.mjs": { createInstallerEnquiryPack: () => null },
    "@/lib/customer-project-arrivals.mjs": { normaliseArrivalWindows: () => [], parseArrivalWindows: () => [] },
    "@/lib/admin-notifications": { adminNotificationStatement: () => ({ bind: () => ({}) }),
      createAdminNotification: async () => { state.notificationCalls += 1; if(state.notificationFails!==false)throw new Error("NOTIFICATION_UNAVAILABLE"); } },
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
    if (certificateTestDependency(specifier)) return certificateTestDependency(specifier);
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

test("customer photo failures return an actionable retry without recording interest", async () => {
  const state = { status: "offered", workflowCalls: 0, workflowFails: true,
    workflowErrorCode: "PUBLIC_LEAD_QUOTE_PHOTO_UNAVAILABLE", handoff: null,
    handoffCommits: 0, notificationCalls: 0, syncCalls: 0 };
  const response = await interested(loadRoute(state)); const body = await response.json();
  assert.equal(response.status, 409); assert.equal(body.ok, false);
  assert.equal(body.error,
    "One or more customer photos are temporarily unavailable. No interest was recorded. Try again.");
  assert.equal(state.status, "offered"); assert.equal(state.handoffCommits, 0);
});


test("reserved or malformed complete opportunity scopes never reach the interest workflow", async () => {
  for (const serviceCategories of [null, "[]", "not-json", '["solar","assessment"]']) {
    const state = { serviceCategories, status: "offered", workflowCalls: 0, handoffCommits: 0, notificationCalls: 0, syncCalls: 0 };
    assert.equal((await interested(loadRoute(state))).status, 404);
    assert.equal(state.workflowCalls, 0);
    assert.equal(state.handoffCommits, 0);
  }
});


function removalFixture(t,status='interested',opportunityStatus='open'){
  const {sqlite}=migratedDataforceSqlite();t.after(()=>sqlite.close());
  const insert=(table,input)=>{
    const values={};for(const column of sqlite.prepare('PRAGMA table_info('+table+')').all())if(column.notnull&&column.dflt_value===null)values[column.name]=/INT/i.test(column.type)?0:'';
    Object.assign(values,input);sqlite.prepare('INSERT INTO '+table+' ('+Object.keys(values).join(',')+') VALUES ('+Object.keys(values).map(()=>'?').join(',')+')').run(...Object.values(values));
  };
  const now=new Date().toISOString();
  for(const [owner,abn] of [['installer-1','51824753556'],['installer-2','53004085616']]){
    insert('trade_accounts',{firebase_uid:owner,email:owner+'@example.test',business_name:owner,partner_type:'installer',account_status:'active',abn,verified_abn:abn,verification_status:'approved',verification_review_id:'review-'+owner,verification_reviewed_at:now,verification_reviewed_by_uid:'reviewer',capabilities:'["solar"]',service_states:'["VIC"]',created_at:now,updated_at:now});
    insert('trade_account_verification_reviews',{id:'review-'+owner,firebase_uid:owner,abn,business_name:owner,partner_type:'installer',decision:'approved',review_method:'official_abr_lookup',reviewed_by_uid:'reviewer',reviewed_at:now});
    insert('trade_team_members',{id:'member-'+owner,owner_uid:owner,member_uid:owner,email:owner+'@example.test',status:'active',created_at:now,updated_at:now});
    insert('creditex_business_onboarding',{owner_uid:owner,status:'approved',application_json:'{}',business_abn:abn,business_name:owner,insurance_expires_on:'2099-12-31',agreement_reference:'SYNTHETIC',reviewed_by_uid:'reviewer',reviewed_at:now,updated_at:now});
  }
  insert('trade_opportunities',{id:'opportunity-1',title:'Existing job',source_reference:'public-plan:lead-1',service_categories:'["solar"]',status:opportunityStatus,state:'VIC',postcode:'3000',expires_at:'2099-01-01T00:00:00.000Z',created_at:now,updated_at:now});
  for(const [id,owner] of [['match-1','installer-1'],['foreign-match','installer-2']]){
    insert('trade_opportunity_matches',{id,opportunity_id:'opportunity-1',firebase_uid:owner,status,matched_categories:'["solar"]',matched_at:now,updated_at:now});
    insert('customer_hub_interests',{match_id:id,opportunity_id:'opportunity-1',interested:1,interested_since:now,updated_at:now,updated_by_uid:owner});
  }
  insert('public_trade_lead_contact_releases',{id:'release-1',opportunity_id:'opportunity-1',source_reference:'public-plan:lead-1',status:'active',withdrawn_at:'',customer_email:'customer@example.test',postcode:'3000',disclosed_fields:'["customer_email","postcode","service_categories"]',notice_version:'v1',consent_purpose:'lead',granted_at:now,created_at:now,updated_at:now});
  insert('trade_work_orders',{id:'saved-work',firebase_uid:'installer-1',source_type:'public_lead',source_reference:'match-1',partner_type:'installer',created_at:now,updated_at:now});
  insert('trade_crm_customers',{id:'saved-customer',firebase_uid:'installer-1',created_at:now,updated_at:now});
  insert('trade_crm_job_details',{id:'saved-detail',work_order_id:'saved-work',firebase_uid:'installer-1',customer_source:'public_lead_released',crm_customer_id:'saved-customer',created_at:now,updated_at:now});
  insert('trade_crm_quotes',{id:'saved-quote',firebase_uid:'installer-1',work_order_id:'saved-work',crm_customer_id:'saved-customer',status:'accepted',created_at:now,updated_at:now});
  const state={database:sqlite,notificationFails:false,notificationCalls:0,syncCalls:0,workflowCalls:0};
  const route=loadRoute(state);
  const remove=(id='match-1')=>route.PATCH(new Request('https://test/api/trade-opportunities',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({matchId:id,action:'respond',status:'declined'})}));
  return {sqlite,state,remove};
}

for(const [status,opportunityStatus] of [['interested','open'],['connected','open'],['connected','paused']]){
  test('removing '+status+' public lead while '+opportunityStatus+' disables Q&A atomically and preserves saved accepted work',async t=>{
    const f=removalFixture(t,status,opportunityStatus);
    const tables=['trade_work_orders','trade_crm_customers','trade_crm_job_details','trade_crm_quotes'];
    const saved=tables.map(table=>f.sqlite.prepare('SELECT * FROM '+table).all());
    const response=await f.remove();assert.equal(response.status,200,await response.text());
    assert.equal(f.sqlite.prepare("SELECT status FROM trade_opportunity_matches WHERE id='match-1'").get().status,'declined');
    const interest=f.sqlite.prepare("SELECT * FROM customer_hub_interests WHERE match_id='match-1'").get();assert.equal(interest.interested,0);assert.equal(interest.revision,2);
    assert.equal(f.sqlite.prepare("SELECT interested FROM customer_hub_interests WHERE match_id='foreign-match'").get().interested,1);
    assert.deepEqual(tables.map(table=>f.sqlite.prepare('SELECT * FROM '+table).all()),saved);
    assert.equal((await f.remove()).status,200);
    assert.equal(f.sqlite.prepare("SELECT revision FROM customer_hub_interests WHERE match_id='match-1'").get().revision,2);
    assert.equal(f.state.workflowCalls,0);
  });
}

test('lead removal cannot change a foreign owner match or opt-out',async t=>{
  const f=removalFixture(t);
  assert.equal((await f.remove('foreign-match')).status,404);
  assert.equal(f.sqlite.prepare("SELECT status FROM trade_opportunity_matches WHERE id='foreign-match'").get().status,'interested');
  assert.equal(f.sqlite.prepare("SELECT interested FROM customer_hub_interests WHERE match_id='foreign-match'").get().interested,1);
});

test('revoked public consent at the removal write boundary changes neither lead nor Q&A interest',async t=>{
  const f=removalFixture(t);
  f.state.beforeBatch=()=>f.sqlite.exec("UPDATE public_trade_lead_contact_releases SET withdrawn_at='withdrawn'");
  assert.equal((await f.remove()).status,404);
  assert.equal(f.sqlite.prepare("SELECT status FROM trade_opportunity_matches WHERE id='match-1'").get().status,'interested');
  assert.equal(f.sqlite.prepare("SELECT interested FROM customer_hub_interests WHERE match_id='match-1'").get().interested,1);
});

test('Q&A opt-out storage failure rolls back removing the lead',async t=>{
  const f=removalFixture(t);
  f.sqlite.exec("CREATE TRIGGER fail_optout BEFORE UPDATE ON customer_hub_interests BEGIN SELECT RAISE(ABORT,'optout unavailable'); END");
  await assert.rejects(f.remove(),/optout unavailable/);
  assert.equal(f.sqlite.prepare("SELECT status FROM trade_opportunity_matches WHERE id='match-1'").get().status,'interested');
  assert.equal(f.sqlite.prepare("SELECT interested FROM customer_hub_interests WHERE match_id='match-1'").get().interested,1);
});
