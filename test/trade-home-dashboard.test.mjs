import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import { loadHomeDashboard } from "../src/lib/trade-home-dashboard-server.ts";
import { ReportInputError } from "../src/lib/trade-business-reports.ts";

const now = new Date("2026-10-01T03:00:00Z");
const schema = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
const defaultAccess = {
  ownerUid: "owner", actorEmail: "worker@example.test", memberId: "me", businessName: "Test trade", isOwner: false,
  jobScope: "own", scheduleScope: "own", canRunReports: false, canViewInvoices: false,
  canViewQuotes: false, canViewPriceBook: false,
};
function fixture() {
  const database = new DatabaseSync(":memory:");
  const queries = [];
  const tables = ["trade_accounts", "trade_work_orders", "trade_crm_job_details", "trade_crm_service_sites",
    "trade_crm_quick_invoices", "trade_crm_accepted_invoices", "trade_crm_quick_invoice_credits", "trade_crm_quotes",
    "trade_crm_quote_versions", "trade_crm_quote_acceptances", "trade_work_order_events", "trade_crm_accounting_documents",
    "trade_crm_appointments", "trade_team_members", "trade_work_order_tasks", "trade_crm_job_notes", "trade_crm_job_plans",
    "trade_crm_job_plan_requirements", "trade_crm_job_actuals", "trade_crm_commercial_handovers"];
  for (const table of tables) {
    const start = schema.indexOf(`sqliteTable("${table}", {`);
    assert.ok(start >= 0, table);
    const block = schema.slice(start, schema.indexOf("}, (table)", start));
    const columns = [...block.matchAll(/(?:text|integer|real)\("([a-z_]+)"/g)].map(match => match[1]);
    database.exec(`CREATE TABLE ${table} (${columns.map(name => `${name} ${/^can_|cents|revision|minutes/.test(name) ? "INTEGER DEFAULT 0" : "TEXT DEFAULT ''"}`).join(",")})`);
  }
  database.exec(readFileSync(new URL('../drizzle/0231_trade_crews.sql', import.meta.url), 'utf8'));
  const insert = (table, values) => database.prepare(`INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(values).map(() => "?").join(",")})`).run(...Object.values(values));
  insert("trade_accounts", { firebase_uid: "owner", address_state: "VIC" });
  const job = (id, values = {}, detail = {}) => {
    insert("trade_work_orders", { id, firebase_uid: "owner", partner_type: "installer", record_status: "active", source_type: "internal",
      work_number: `TLJ-${id}`, title: `Job ${id}`, assignee_member_id: "me", stage: "backlog", service_category: "hot-water", created_at: "2026-10-01T00:00:00Z", ...values });
    insert("trade_crm_job_details", { id: `d-${id}`, firebase_uid: values.firebase_uid || "owner", work_order_id: id,
      customer_source: "trade_owned", invoice_status: "not_started", ...detail });
  };
  const visit = (id, jobId, startsAt = "2026-10-01T09:00", values = {}) => insert("trade_crm_appointments", {
    id, firebase_uid: "owner", work_order_id: jobId, title: `Visit ${id}`, assignee_member_id: "me", assignee_label: "Worker",
    status: "scheduled", starts_at: startsAt, ends_at: startsAt.slice(0, 10) + "T10:00", ...values,
  });
  const task = (id, jobId, values = {}) => insert("trade_work_order_tasks", {
    id, firebase_uid: "owner", work_order_id: jobId, title: `Task ${id}`, status: "pending", due_at: "2026-09-30", ...values,
  });
  const issue = (id, jobId, values = {}) => insert("trade_crm_job_notes", {
    id, firebase_uid: "owner", work_order_id: jobId, body: `Issue ${id}`, note_type: "issue", issue_status: "open", created_at: "2026-10-01", ...values,
  });
  const invoice = (id, jobId, values = {}) => insert("trade_crm_quick_invoices", {
    id, work_order_id: jobId, firebase_uid: "owner", status: "issued", currency: "AUD", sent_at: "2026-10-01T00:00:00Z",
    total_cents: 11000, tax_cents: 1000, due_at: "2026-09-30", ...values,
  });
  const quote = (jobId, options = {}) => {
    const ownerUid = options.ownerUid || "owner";
    const customerId = options.customerId || `customer-${jobId}`;
    const quoteId = `quote-${jobId}`;
    const versionId = `version-${jobId}`;
    insert("trade_crm_quotes", { id: quoteId, work_order_id: jobId, firebase_uid: ownerUid,
      crm_customer_id: customerId, status: "accepted", current_version_number: 1, ...options.quote });
    insert("trade_crm_quote_versions", { id: versionId, quote_id: quoteId, firebase_uid: ownerUid,
      version_number: 1, status: "accepted", ...options.version });
    if (options.acceptance !== false) insert("trade_crm_quote_acceptances", { id: `acceptance-${jobId}`,
      quote_id: quoteId, quote_version_id: versionId, work_order_id: jobId, firebase_uid: ownerUid,
      crm_customer_id: customerId, decision: "accepted", ...options.acceptance });
  };
  const prepare = (sql, values = []) => ({ sql, values, bind: (...args) => prepare(sql, args),
    first: async () => { queries.push(sql); return database.prepare(sql).get(...values) || null; },
    all: async () => { queries.push(sql); return { results: database.prepare(sql).all(...values) }; } });
  const db = { prepare, async batch(statements) {
    return statements.map(statement => { queries.push(statement.sql); return { results: database.prepare(statement.sql).all(...statement.values) }; });
  } };
  return { database, db, queries, insert, job, visit, task, issue, invoice, quote,
    home: (permissions = {}, query = {}, date = now) => loadHomeDashboard(db, "owner", { ...defaultAccess, ...permissions }, new URLSearchParams(query), "VIC", date) };
}

test("operational Home is available without reports and scopes counts, previews and collaborator assignments", async t => {
  const f = fixture(); t.after(() => f.database.close());
  f.job("lead"); f.visit("lead-mine", "lead"); f.visit("lead-other", "lead", undefined, { assignee_member_id: "other" });
  f.job("collaborator", { assignee_member_id: "other" }); f.visit("collaborator-mine", "collaborator");
  f.job("unrelated", { assignee_member_id: "other" }); f.visit("unrelated-other", "unrelated", undefined, { assignee_member_id: "other" });
  f.job("cancelled-assignment", { assignee_member_id: "other" }); f.visit("cancelled", "cancelled-assignment", undefined, { status: "cancelled" });
  f.job("foreign-assignment", { assignee_member_id: "other" }); f.visit("foreign-binding", "foreign-assignment", undefined, { firebase_uid: "another-owner" });
  f.job("foreign", { firebase_uid: "another-owner" }); f.visit("foreign", "foreign", undefined, { firebase_uid: "another-owner" });
  f.job("archived", { record_status: "archived" }); f.visit("archived", "archived");
  f.job("distributor", { partner_type: "distributor" }); f.visit("distributor", "distributor");
  for (const id of ["lead", "collaborator", "unrelated", "cancelled-assignment", "foreign-assignment", "foreign", "archived", "distributor"]) {
    f.task(`task-${id}`, id); f.issue(`issue-${id}`, id);
  }
  f.task("foreign-child", "lead", { firebase_uid: "another-owner" });
  f.issue("foreign-child", "lead", { firebase_uid: "another-owner" });
  const result = await f.home();
  assert.equal(result.financial, null);
  assert.equal(result.metrics.openJobs, 2);
  assert.equal(result.metrics.todayJobs, 2); assert.equal(result.metrics.todayVisits, 2);
  assert.equal(result.metrics.overdueTasks, 2); assert.equal(result.metrics.openIssues, 2);
  assert.deepEqual(result.upcomingAppointments.map(item => item.id).sort(), ["collaborator-mine", "lead-mine"]);
  assert.deepEqual(result.overdueTasks.map(item => item.job.id).sort(), ["collaborator", "lead"]);
  assert.equal(f.queries.some(sql => sql.includes("native_invoices")), false, "Staff Home never loads financial sources without authority");
});

test("jobScope and scheduleScope restrict independent dimensions of Home", async t => {
  const f = fixture(); t.after(() => f.database.close());
  f.job("one"); f.visit("own", "one"); f.visit("colleague", "one", undefined, { assignee_member_id: "other" });
  f.job("two", { assignee_member_id: "other" }); f.visit("unrelated", "two", undefined, { assignee_member_id: "other" });
  const ownJobsTeamSchedule = await f.home({ scheduleScope: "team" });
  assert.equal(ownJobsTeamSchedule.metrics.openJobs, 1); assert.equal(ownJobsTeamSchedule.metrics.todayVisits, 2);
  const teamJobsOwnSchedule = await f.home({ jobScope: "team" });
  assert.equal(teamJobsOwnSchedule.metrics.openJobs, 2); assert.equal(teamJobsOwnSchedule.metrics.todayVisits, 1);
  const owner = await f.home({ isOwner: true });
  assert.equal(owner.metrics.openJobs, 2); assert.equal(owner.metrics.todayVisits, 3);
});

test('crew Home aggregates crew jobs and visits without exposing other crews or their visits on shared jobs', async t => {
  const f = fixture(); t.after(() => f.database.close());
  for (const member of ['me','teammate','other']) f.insert('trade_team_members', {
    id: member, owner_uid: 'owner', member_uid: `${member}-user`, status: 'active',
  });
  f.insert('trade_crews', { id: 'crew', owner_uid: 'owner', name: 'Crew', lead_member_id: 'me', created_at: 'now', updated_at: 'now' });
  for (const member of ['me','teammate']) f.insert('trade_crew_members', { owner_uid: 'owner', crew_id: 'crew', member_id: member, created_at: 'now' });
  f.job('mine'); f.visit('mine', 'mine');
  f.job('crew-job', { assignee_member_id: 'teammate' }); f.visit('crew-visit', 'crew-job', undefined, { assignee_member_id: 'teammate' });
  f.visit('outside-shared', 'crew-job', undefined, { assignee_member_id: 'other' });
  f.job('outside-job', { assignee_member_id: 'other' }); f.visit('outside-visit', 'outside-job', undefined, { assignee_member_id: 'other' });
  f.job('unassigned', { assignee_member_id: '' });
  const access = { crewId: 'crew', crewLead: true, crewMemberIds: ['me','teammate'] };
  const lead = await f.home(access);
  assert.equal(lead.metrics.openJobs, 2); assert.equal(lead.metrics.todayVisits, 2);
  assert.deepEqual(lead.upcomingAppointments.map(item => item.id).sort(), ['crew-visit','mine']);
  const worker = await f.home({ ...access, memberId: 'teammate', crewLead: false, crewMemberIds: ['teammate'] });
  assert.equal(worker.metrics.openJobs, 1); assert.equal(worker.metrics.todayVisits, 1);
  assert.deepEqual(worker.upcomingAppointments.map(item => item.id), ['crew-visit']);
  f.database.prepare("DELETE FROM trade_crew_members WHERE member_id='teammate'").run();
  const removed = await f.home({ ...access, crewMemberIds: ['me'] });
  assert.equal(removed.metrics.openJobs, 1); assert.equal(removed.metrics.todayVisits, 1);
});

test("weekly outlook starts this Monday, counts distinct jobs separately from visits, and keeps completed visits", async t => {
  const f = fixture(); t.after(() => f.database.close());
  f.job("one"); f.job("two");
  f.visit("last-week", "one", "2026-09-27T09:00");
  f.visit("this-monday", "one", "2026-09-28T09:00", { status: "completed" });
  f.visit("today", "one"); f.visit("this-sunday", "one", "2026-10-04T09:00");
  f.visit("next-monday", "one", "2026-10-05T09:00");
  f.visit("next-second", "two", "2026-10-07T09:00", { ends_at: "" });
  f.visit("third-week", "two", "2026-10-12T09:00"); f.visit("fourth-week", "two", "2026-10-25T09:00");
  f.visit("outside-outlook", "two", "2026-10-26T09:00");
  f.visit("cancelled", "one", undefined, { status: "cancelled" }); f.visit("imported", "one", undefined, { status: "imported" });
  const result = await f.home();
  assert.equal(result.today, "2026-10-01"); assert.equal(result.timeZone, "Australia/Melbourne");
  assert.deepEqual(result.workload.map(week => [week.weekStart, week.weekEnd, week.jobs, week.visits]), [
    ["2026-09-28", "2026-10-04", 1, 3], ["2026-10-05", "2026-10-11", 2, 2],
    ["2026-10-12", "2026-10-18", 1, 1], ["2026-10-19", "2026-10-25", 1, 1],
  ]);
  assert.equal(result.metrics.thisWeekJobs, 1); assert.equal(result.metrics.thisWeekVisits, 3);
  assert.equal(result.metrics.nextWeekJobs, 2); assert.equal(result.metrics.nextWeekVisits, 2);
  assert.equal(result.workload[0].bookedMinutes, 180); assert.equal(result.workload[1].missingDurations, 1);
  assert.ok(!result.upcomingAppointments.some(item => item.status === "completed"));
});

test("full Home aggregates are not capped by previews and ignore invalid or undated task and visit dates", async t => {
  const f = fixture(); t.after(() => f.database.close());
  for (let index = 0; index < 75; index++) {
    const id = String(index); f.job(id); f.visit(`v-${id}`, id); f.task(`t-${id}`, id); f.issue(`n-${id}`, id);
  }
  f.task("no-date", "0", { due_at: "" }); f.task("bad-date", "0", { due_at: "bad" });
  f.task("today", "0", { due_at: "2026-10-01" }); f.task("done", "0", { status: "done" });
  f.visit("bad-date", "0", "bad"); f.visit("no-date", "0", "");
  const result = await f.home();
  assert.equal(result.metrics.openJobs, 75); assert.equal(result.metrics.overdueTasks, 75);
  assert.equal(result.metrics.openIssues, 75); assert.equal(result.workload[0].jobs, 75); assert.equal(result.workload[0].visits, 75);
  assert.equal(result.upcomingAppointments.length, 6); assert.equal(result.overdueTasks.length, 5); assert.equal(result.openIssues.length, 5);
  assert.equal(result.metrics.awaitingSchedule, 0); assert.equal(result.metrics.todayJobs, 75); assert.equal(result.metrics.todayVisits, 75);
});

test("scheduling attention requires accepted or explicitly approved work, not a quote awaiting response", async t => {
  const cases = [
    { name: "new enquiry", pipeline: "enquiry", expected: 0 },
    { name: "qualifying", pipeline: "qualifying", expected: 0 },
    { name: "quoting", pipeline: "quoting", expected: 0 },
    { name: "ready work-board label only", stage: "ready", pipeline: "enquiry", expected: 0 },
    { name: "scheduled work-board label only", stage: "scheduled", pipeline: "quoting", expected: 0 },
    { name: "explicitly approved without a quote", pipeline: "approved", expected: 1 },
    { name: "approved return visit", stage: "scheduled", pipeline: "scheduled", expected: 1 },
    { name: "started follow-on work", stage: "in_progress", pipeline: "in_progress", expected: 1 },
    { name: "approved label with draft quote", pipeline: "approved", quoteStatus: "draft", quote: { quote: { status: "draft" }, version: { status: "draft" }, acceptance: false }, expected: 0 },
    { name: "approved label with unanswered quote", pipeline: "approved", quoteStatus: "issued", quote: { quote: { status: "issued" }, version: { status: "issued" }, acceptance: false }, expected: 0 },
    { name: "sent quote without response", pipeline: "scheduled", quoteStatus: "sent", expected: 0 },
    { name: "declined quote", pipeline: "approved", quoteStatus: "declined", expected: 0 },
    { name: "accepted quote still on enquiry board", pipeline: "enquiry", quoteStatus: "accepted", quote: {}, expected: 1 },
    { name: "accepted quote still on quoting board", pipeline: "quoting", quoteStatus: "accepted", quote: {}, expected: 1 },
    { name: "CRM accepted label without acceptance", pipeline: "approved", quoteStatus: "accepted", quote: { acceptance: false }, expected: 0 },
    { name: "new draft after accepted version", pipeline: "approved", quoteStatus: "accepted", quote: { quote: { current_version_number: 2 } }, expected: 0 },
    { name: "current version is not accepted", pipeline: "approved", quoteStatus: "accepted", quote: { version: { status: "issued" } }, expected: 0 },
    { name: "completed work", stage: "completed", pipeline: "approved", quoteStatus: "accepted", quote: {}, expected: 0 },
    { name: "cancelled work", stage: "cancelled", pipeline: "approved", expected: 0 },
    { name: "imported work", stage: "imported", pipeline: "approved", expected: 0 },
    { name: "imported pipeline", pipeline: "imported", quoteStatus: "accepted", quote: {}, expected: 0 },
    { name: "complete pipeline", pipeline: "complete", quoteStatus: "accepted", quote: {}, expected: 0 },
    { name: "invoiced pipeline", pipeline: "invoiced", quoteStatus: "accepted", quote: {}, expected: 0 },
    { name: "paid pipeline", pipeline: "paid", quoteStatus: "accepted", quote: {}, expected: 0 },
    { name: "lost pipeline", pipeline: "lost", quoteStatus: "accepted", quote: {}, expected: 0 },
    { name: "archived work", pipeline: "approved", recordStatus: "archived", expected: 0 },
  ];
  for (const item of cases) await t.test(item.name, async () => {
    const f = fixture();
    try {
      f.job("one", { stage: item.stage || "backlog", record_status: item.recordStatus || "active" }, {
        crm_customer_id: "customer-one", pipeline_stage: item.pipeline, quote_status: item.quoteStatus || "not_started",
      });
      if (item.quote) f.quote("one", item.quote);
      assert.equal((await f.home()).metrics.awaitingSchedule, item.expected);
    } finally { f.database.close(); }
  });
});

test("released public leads require the accepted current quote for the same owner, job and customer", async t => {
  const cases = [
    { name: "accepted current quote", expected: 1 },
    { name: "arbitrary approved board stage", quoteStatus: "not_started", quote: false, expected: 0 },
    { name: "manual accepted label only", quote: false, expected: 0 },
    { name: "unanswered quote", quote: { quote: { status: "issued" }, version: { status: "issued" }, acceptance: false }, expected: 0 },
    { name: "superseded acceptance", quote: { quote: { current_version_number: 2 } }, expected: 0 },
    { name: "foreign quote owner", quote: { ownerUid: "foreign" }, expected: 0 },
    { name: "foreign acceptance owner", quote: { acceptance: { firebase_uid: "foreign" } }, expected: 0 },
    { name: "other job acceptance", quote: { acceptance: { work_order_id: "other-job" } }, expected: 0 },
    { name: "other customer acceptance", quote: { acceptance: { crm_customer_id: "other-customer" } }, expected: 0 },
    { name: "old customer quote", quote: { customerId: "previous-customer" }, expected: 0 },
    { name: "declined acceptance", quote: { acceptance: { decision: "declined" } }, expected: 0 },
  ];
  for (const item of cases) await t.test(item.name, async () => {
    const f = fixture();
    try {
      f.job("one", { source_type: "public_lead" }, { customer_source: "public_lead_released",
        crm_customer_id: "customer-one", pipeline_stage: "approved", quote_status: item.quoteStatus || "accepted" });
      if (item.quote !== false) f.quote("one", item.quote);
      assert.equal((await f.home()).metrics.awaitingSchedule, item.expected);
    } finally { f.database.close(); }
  });
});

test("future visits suppress approved-work suggestions; intentional enquiry visits remain on Home", async t => {
  const f = fixture(); t.after(() => f.database.close());
  for (const id of ["approved", "follow-on", "invalid", "cancelled-visit"]) {
    f.job(id, {}, { pipeline_stage: "approved" });
  }
  f.visit("future-other-worker", "approved", "2026-10-02T09:00", { assignee_member_id: "other" });
  f.visit("finished-visit", "follow-on", "2026-09-30T09:00", { status: "completed" });
  f.visit("invalid", "invalid", "bad");
  f.visit("cancelled", "cancelled-visit", undefined, { status: "cancelled" });
  f.job("quote-visit", {}, { pipeline_stage: "quoting", quote_status: "issued" });
  f.visit("intentional-quote-visit", "quote-visit", undefined, { appointment_type: "site_visit" });
  const result = await f.home();
  assert.equal(result.metrics.awaitingSchedule, 3);
  assert.equal(result.metrics.openJobs, 5, "Sales jobs still belong in the open-jobs total");
  assert.equal(result.metrics.todayVisits, 1);
  assert.equal(result.metrics.thisWeekVisits, 2);
  assert.deepEqual(result.upcomingAppointments.map(item => item.id), ["intentional-quote-visit"]);
});

test("lost jobs leave operational attention and workload even with lingering records, while finance remains intact", async t => {
  const f = fixture(); t.after(() => f.database.close());
  f.job("active", {}, { pipeline_stage: "approved" });
  f.task("active", "active"); f.issue("active", "active"); f.visit("active", "active");
  for (const stage of ["backlog", "blocked", "cancelled"]) {
    f.job(`lost-${stage}`, { stage }, { pipeline_stage: "lost" });
    f.task(`lost-${stage}`, `lost-${stage}`); f.issue(`lost-${stage}`, `lost-${stage}`);
    f.visit(`lost-${stage}`, `lost-${stage}`); f.invoice(`lost-${stage}`, `lost-${stage}`);
  }
  const result = await f.home({ canRunReports: true, canViewInvoices: true });
  assert.equal(result.metrics.openJobs, 1); assert.equal(result.metrics.waitingJobs, 0);
  assert.equal(result.metrics.awaitingSchedule, 0); assert.equal(result.metrics.overdueTasks, 1); assert.equal(result.metrics.openIssues, 1);
  assert.equal(result.metrics.todayJobs, 1); assert.equal(result.metrics.todayVisits, 1);
  assert.deepEqual(result.workStages, { backlog: 1 });
  assert.equal(result.workload[0].jobs, 1); assert.equal(result.workload[0].visits, 1);
  for (const items of [result.upcomingAppointments, result.overdueTasks, result.openIssues]) {
    assert.deepEqual(items.map(item => item.job.id), ["active"]);
  }
  assert.equal(result.financial.current.invoicedCents, 30000);
  assert.equal(result.financial.receivables.outstandingCents, 33000);
});

test("imported, archived and cancelled work does not become operational work; protected previews redact free text", async t => {
  const f = fixture(); t.after(() => f.database.close());
  f.job("protected", { title: "Private customer name", source_type: "opportunity" });
  f.visit("private", "protected", undefined, { title: "Private property address", notes: "Private access code" });
  f.task("private", "protected", { title: "Private tenant details" }); f.issue("private", "protected", { body: "Private phone number" });
  f.job("platform", { title: "Platform private name" }, { customer_source: "platform_private" }); f.issue("platform", "platform", { body: "Platform private address" });
  for (const stage of ["imported", "completed", "cancelled"]) {
    f.job(stage, { stage }); f.task(stage, stage); if (stage !== "completed") f.issue(stage, stage);
  }
  const result = await f.home();
  assert.equal(result.metrics.openJobs, 2); assert.equal(result.metrics.overdueTasks, 1);
  assert.deepEqual(result.workStages, { backlog: 2 });
  assert.equal(result.upcomingAppointments[0].title, "Scheduled work");
  assert.equal(result.upcomingAppointments[0].job.title, "Protected job");
  assert.equal(result.upcomingAppointments[0].job.protected, true);
  assert.equal(result.overdueTasks[0].title, "Assigned task");
  assert.ok(result.openIssues.every(item => item.body === "Protected job issue"));
  assert.doesNotMatch(JSON.stringify(result), /Private customer|Private property|Private access|Private tenant|Private phone|Platform private/);
});

test("finance requires reports plus invoice access, with separate recorded-cost authority and canonical values", async t => {
  const f = fixture(); t.after(() => f.database.close());
  f.job("one", {}, { paid_value_cents: 2000 }); f.invoice("one", "one");
  f.insert("trade_crm_quick_invoice_credits", { id: "credit", firebase_uid: "owner", work_order_id: "one", invoice_id: "one",
    status: "issued", created_at: "2026-10-01T01:00:00Z", total_cents: 2200, tax_cents: 200 });
  for (const permissions of [{}, { canRunReports: true }, { canViewInvoices: true }]) assert.equal((await f.home(permissions)).financial, null);
  const allowed = { canRunReports: true, canViewInvoices: true };
  const report = (await f.home(allowed)).financial;
  assert.equal(report.period.preset, "monthly"); assert.equal(report.current.invoicedCents, 8000);
  assert.equal(report.receivables.outstandingCents, 6800); assert.equal(report.receivables.paidCents, 2000);
  assert.deepEqual(report.recordedGst, { invoiceGstCents: 1000, creditGstCents: 200, netGstCents: 800 });
  assert.equal(report.profitability, null); assert.equal(report.current.wonCents, null);
  assert.ok((await f.home({ ...allowed, canViewPriceBook: true })).financial.profitability);
  for (const period of ["weekly", "monthly", "quarterly", "fytd"]) assert.equal((await f.home(allowed, { period })).financial.period.preset, period);
});

test("local dates roll through DST and invalid report periods fail before querying", async t => {
  const f = fixture(); t.after(() => f.database.close());
  assert.equal((await f.home({}, {}, new Date("2026-10-04T13:30:00Z"))).today, "2026-10-05");
  const before = f.queries.length;
  for (const params of [{ period: "nope" }, { anchor: "2099-01-01" }, { period: "custom", from: "2026-10-02", to: "2026-10-01" }, { period: "custom" }]) {
    await assert.rejects(() => f.home({}, params), ReportInputError);
  }
  assert.equal(f.queries.length, before);
});

// Run the actual GET and crmIdentity functions against SQLite. Authentication,
// schema setup and JSON transport are isolated; all dashboard SQL is executed.
const routeSource = ts.createSourceFile("route.ts", readFileSync(new URL("../src/app/api/trade-crm/route.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const routeCode = ts.transpileModule(["crmIdentity", "GET"].map(name => {
  const declaration = routeSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration); return declaration.getText(routeSource);
}).join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function api(f, overrides = {}, options = {}) {
  let authCalls = 0;
  const dependencies = {
    requireInstallerTeamAccess: async () => { authCalls++; if (options.authError) throw new Error(options.authError); return { ...defaultAccess, ...overrides }; },
    ensureTlinkSchemaGuards: async () => {}, getD1: () => f.db, loadHomeDashboard: (db, uid, access, params, state) => loadHomeDashboard(db, uid, access, params, state, now),
    sameOrigin: () => options.sameOrigin !== false, cleanAdminText: (value, maximum) => String(value || "").trim().slice(0, maximum),
    ReportInputError, adminJson: (body, status = 200) => Response.json(body, { status }),
    errorResponse: error => Response.json({ ok: false, error: error.message }, { status: error.message === "AUTH_REQUIRED" ? 401 : 403 }),
  };
  const exports = {};
  Function("exports", ...Object.keys(dependencies), routeCode)(exports, ...Object.values(dependencies));
  return { get: query => exports.GET(new Request(`https://example.test/api/trade-crm?${query}`)), authCalls: () => authCalls };
}

test("Home API uses authenticated business, validates origin/auth/dates and leaves report gates intact", async t => {
  const f = fixture(); t.after(() => f.database.close());
  f.job("one"); f.job("foreign", { firebase_uid: "foreign" });
  const staff = api(f);
  const response = await staff.get("mode=home&ownerUid=foreign");
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.ok, true); assert.equal(body.dashboard.metrics.openJobs, 1); assert.equal(body.dashboard.financial, null);
  assert.equal((await staff.get("mode=reports")).status, 403); assert.equal((await staff.get("mode=summary")).status, 403);
  assert.equal((await staff.get("mode=home&period=invalid")).status, 400);
  const foreignOrigin = api(f, {}, { sameOrigin: false });
  assert.equal((await foreignOrigin.get("mode=home")).status, 403); assert.equal(foreignOrigin.authCalls(), 0);
  assert.equal((await api(f, {}, { authError: "AUTH_REQUIRED" }).get("mode=home")).status, 401);
  assert.equal((await api(f, {}, { authError: "ABN_REVIEW_REQUIRED" }).get("mode=home")).status, 403);
});

test("Home query batches execute within Cloudflare D1 limits with SQLite-equivalent scoped results", async () => {
  const { Miniflare } = await import("miniflare");
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }',
    compatibilityDate: "2025-04-01", d1Databases: { DB: "trade-home-regression" }, port: 0 });
  const f = fixture();
  try {
    f.job("one"); f.visit("one", "one"); f.task("one", "one"); f.issue("one", "one"); f.invoice("one", "one");
    f.job("other", { assignee_member_id: "other" }); f.visit("other", "other", undefined, { assignee_member_id: "other" });
    f.job("accepted", {}, { crm_customer_id: "customer-accepted", pipeline_stage: "quoting", quote_status: "accepted" });
    f.quote("accepted");
    const db = await runtime.getD1Database("DB");
    for (const table of f.database.prepare("SELECT name,sql FROM sqlite_master WHERE type='table'").all()) {
      await db.prepare(table.sql).run();
      for (const row of f.database.prepare(`SELECT * FROM ${table.name}`).all()) {
        await db.prepare(`INSERT INTO ${table.name} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).bind(...Object.values(row)).run();
      }
    }
    for (const permissions of [{}, { isOwner: true, canViewInvoices: true, canViewQuotes: true }]) {
      const actual = await loadHomeDashboard(db, "owner", { ...defaultAccess, ...permissions }, new URLSearchParams(), "VIC", now);
      assert.deepEqual(actual, await f.home(permissions));
    }
  } finally { f.database.close(); await runtime.dispose(); }
});
