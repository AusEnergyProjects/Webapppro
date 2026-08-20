import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
  ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
  publicPlanContactReleaseAccessSql,
  publicPlanContactReleaseDisclosedFieldsAreValid,
} from "../src/lib/public-plan-enquiry.mjs";

function read(path) {
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

test("assistant trade-sharing policy requires the quote brief, routing region, canonical services and selected contact fields", () => {
  const fields = [
    "customer_email",
    "postcode",
    "state",
    "service_categories",
    "quote_brief",
    "customer_name",
  ];
  assert.equal(publicPlanContactReleaseDisclosedFieldsAreValid(
    ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
    ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
    fields,
  ), true);
  assert.equal(publicPlanContactReleaseDisclosedFieldsAreValid(
    ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
    ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
    fields.filter((field) => field !== "quote_brief"),
  ), false);
  assert.equal(publicPlanContactReleaseDisclosedFieldsAreValid(
    ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
    ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
    [...fields, "customer_address"],
  ), false);
  const sql = publicPlanContactReleaseAccessSql("assistant_release");
  assert.match(sql, /energy-assistant-trade-sharing-v1/);
  assert.match(sql, /quote_brief/);
  assert.match(sql, /state/);
});

test("admin API is authenticated and supports list, detail, assignment, due dates, notes, transitions and immutable audit", () => {
  const route = read("../src/app/api/admin/energy-assistant-leads/route.ts");
  for (const boundary of [
    "requireAdminIdentity(request)",
    "requireAdminIdentity(request, [\"owner\", \"admin\", \"support\"])",
    "energy_assistant_lead_events",
    "assigned_to_uid",
    "due_at",
    "status_changed",
    "note_added",
    "writeAdminAudit",
    "trade_disclosed_snapshot_sha256",
    "needs_information",
    "currentReadiness",
    "insufficientKnownServiceIds",
  ]) assert.ok(route.includes(boundary), `missing ${boundary}`);
  assert.match(
    route,
    /shared_with_trades: new Set\(\["contacting", "resolved"\]\)/,
    "a dispatched trade-sharing consent cannot be represented as withdrawn",
  );
  assert.doesNotMatch(
    route,
    /shared_with_trades: new Set\(\[[^\]]*"withdrawn"/,
  );
  assert.doesNotMatch(route, /energy_assistant_(?:sessions|messages|request_receipts)/);
});

test("admin lead updates reject stale concurrent state before appending events or the external audit", () => {
  const route = read("../src/app/api/admin/energy-assistant-leads/route.ts");
  assert.match(
    route,
    /SELECT id, status, assigned_to_uid, due_at,\s*quote_brief_json, updated_at/,
  );
  assert.match(
    route,
    /WHERE id = \? AND status = \? AND assigned_to_uid = \? AND due_at = \?\s*AND updated_at = \?/,
    "the write must compare every independently mutable lead field and its version timestamp",
  );
  assert.match(route, /WHERE \$\{committedStateGuardSql\}/);
  assert.match(route, /const revisionDigits = crypto\.randomUUID\(\)/);
  assert.match(route, /const \[updateResult\] = await db\.batch\(\[updateStatement, \.\.\.eventStatements\]\)/);
  assert.match(route, /Number\(updateResult\.meta\?\.changes \|\| 0\) !== 1/);

  const conflictCheck = route.indexOf("Number(updateResult.meta?.changes || 0) !== 1");
  const immutableAudit = route.indexOf("await writeAdminAudit", conflictCheck);
  assert.ok(conflictCheck >= 0 && immutableAudit > conflictCheck,
    "a stale write must return before the external audit is appended");
  assert.match(
    route.slice(conflictCheck, immutableAudit),
    /changed while you were editing it[\s\S]*409/,
  );
});

test("notification Open routes directly to the protected follow-up record before generic customer routing", () => {
  const portal = read("../src/components/AdminOperationsPortal.tsx");
  const specific = portal.indexOf('notification.entityType === "energy_assistant_lead"');
  const generic = portal.indexOf('notification.actorType === "customer"');
  assert.ok(specific >= 0 && generic >= 0 && specific < generic);
  assert.match(portal, /setAssistantLeadTarget\(\{ id: notification\.entityId/);
  assert.match(portal, /setTab\("assistant-leads"\)/);
  assert.match(portal, /<AdminEnergyAssistantLeads/);
});

test("matched-trade opportunity creation has an assistant-specific, consent-current and document-free path", () => {
  const opportunity = read("../src/lib/opportunity-server.ts");
  const leadServer = read("../src/lib/energy-assistant-lead-server.ts");
  for (const boundary of [
    'payload.sourceJourney === "energy-assistant"',
    "ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION",
    "ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE",
    "publicPlanContactReleaseDisclosedFieldsAreValid",
    "protectedPublicLead",
    "assistantDurableDispatch",
    "dispatchRequired: true",
    "Chat history, documents, bills, photos, NMI and account identifiers are not shared",
  ]) assert.ok(opportunity.includes(boundary), `missing ${boundary}`);
  for (const boundary of [
    "reconcileAssistantTradeDispatch",
    "INSERT INTO customer_opportunity_dispatch_jobs",
    "INSERT INTO admin_notifications",
    "status = 'open'",
    "dispatchJobId: durable.dispatchJobId",
  ]) assert.ok(leadServer.includes(boundary), `missing ${boundary}`);
  assert.doesNotMatch(leadServer, /drainCustomerOpportunityDispatchJobs|dispatchAssistantTradeOpportunity/);
  assert.match(
    opportunity,
    /const allocation = assistantDurableDispatch[\s\S]*dispatchRequired: true[\s\S]*await allocateNearestInstallers/,
    "assistant disclosure must link and queue durably before installer allocation",
  );
});

test("operations UI states the information-first boundary and exposes the complete quote brief and consent record", () => {
  const component = read("../src/components/AdminEnergyAssistantLeads.tsx");
  for (const boundary of [
    "Information and advice remain available without submitting contact details",
    "Quote answers",
    "Known facts",
    "Site constraints",
    "Explicit unknowns",
    "Structured quote readiness",
    "Needs information",
    "More known property details are needed",
    "No trade visibility exists",
    "Trade sharing",
    "No trade record was created",
    "Audit history",
    "Assign to me",
  ]) assert.ok(component.includes(boundary), `missing ${boundary}`);
});
