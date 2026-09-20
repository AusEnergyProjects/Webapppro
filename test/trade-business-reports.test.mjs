import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadBusinessReport } from "../src/lib/trade-business-reports-server.ts";
import { resolveReportPeriod, reportMidnight, reportTrendWindows, reportChange, reportCsvRows } from "../src/lib/trade-business-reports.ts";

const now = new Date("2026-09-20T03:00:00Z");
const access = { isOwner: true, memberId: "owner-member", jobScope: "team", scheduleScope: "team", canViewInvoices: true, canViewQuotes: true };
const params = extra => new URLSearchParams({ period: "monthly", ...extra });
const schema = fs.readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
function fixture() {
  const db = new DatabaseSync(":memory:");
  const tables = ["trade_work_orders", "trade_crm_job_details", "trade_crm_service_sites", "trade_crm_quick_invoices", "trade_crm_accepted_invoices", "trade_crm_quick_invoice_credits", "trade_crm_quotes", "trade_crm_quote_versions", "trade_crm_quote_acceptances", "trade_work_order_events", "trade_crm_accounting_documents", "trade_crm_appointments", "trade_team_members", "trade_work_order_tasks", "trade_crm_job_notes", "trade_crm_job_plans", "trade_crm_job_plan_requirements", "trade_crm_job_actuals", "trade_crm_commercial_handovers"];
  for (const table of tables) {
    const start = schema.indexOf(`sqliteTable("${table}", {`); assert.ok(start >= 0);
    const block = schema.slice(start, schema.indexOf("}, (table)", start));
    const columns = [...block.matchAll(/(?:text|integer|real)\("([a-z_]+)"/g)].map(match => match[1]);
    assert.ok(columns.length); db.exec(`CREATE TABLE ${table} (${columns.map(name => `${name} ${/cents|number|revision|minutes|sort_order/.test(name) && !/invoice_number|work_number|quote_number/.test(name) ? "INTEGER DEFAULT 0" : "TEXT DEFAULT ''"}`).join(",")})`);
  }
  const insert = (table, values) => db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(values).map(() => "?").join(",")})`).run(...Object.values(values));
  const job = (id, values = {}, details = {}) => { insert("trade_work_orders", { id, firebase_uid: "owner", partner_type: "installer", record_status: "active", stage: "backlog", service_category: "hot-water", created_at: "2026-09-10T12:00:00Z", ...values }); insert("trade_crm_job_details", { id: `d-${id}`, work_order_id: id, firebase_uid: values.firebase_uid || "owner", invoice_status: "not_started", ...details }); };
  const invoice = (id, values = {}) => insert("trade_crm_quick_invoices", { id: `i-${id}`, work_order_id: id, firebase_uid: "owner", status: "issued", currency: "AUD", sent_at: "2026-09-12T12:00:00Z", total_cents: 11000, tax_cents: 1000, due_at: "2026-09-15", ...values });
  const prepare = (sql, values = []) => ({ sql, values, bind: (...args) => prepare(sql, args), first: async () => db.prepare(sql).get(...values), all: async () => ({ results: db.prepare(sql).all(...values) }) });
  const d1 = { prepare, async batch(statements) { db.exec("BEGIN"); try { const result = statements.map(statement => ({ results: db.prepare(statement.sql).all(...statement.values) })); db.exec("COMMIT"); return result; } catch(error) { db.exec("ROLLBACK"); throw error; } } };
  return { db, insert, job, invoice, report: (query = {}, permissions = {}) => loadBusinessReport(d1, "owner", { ...access, ...permissions }, params(query), "VIC", now) };
}

function costJob(f, id, actual = true) {
  f.job(id, { stage: "completed", work_number: id }, { crm_customer_id: "customer" }); f.invoice(id);
  f.insert("trade_work_order_events", { id: `e-${id}`, work_order_id: id, firebase_uid: "owner", event_type: "job_completed", created_at: "2026-09-10T12:00Z" });
  f.insert("trade_crm_commercial_handovers", { id: `h-${id}`, work_order_id: id, firebase_uid: "owner", crm_customer_id: "customer", accepted_at: "2026-09-01T12:00Z" });
  f.insert("trade_crm_job_plans", { id: `p-${id}`, commercial_handoff_id: `h-${id}`, work_order_id: id, firebase_uid: "owner", status: "completed" });
  for (const [type, cost, minutes] of [["labour", 2000, 120], ["material", 1000, 0]]) {
    f.insert("trade_crm_job_plan_requirements", { id: `${id}-${type}`, job_plan_id: `p-${id}`, firebase_uid: "owner", requirement_type: type, status: "completed" });
    if (actual) f.insert("trade_crm_job_actuals", { id: `a-${id}-${type}`, job_plan_id: `p-${id}`, job_plan_requirement_id: `${id}-${type}`, work_order_id: id, firebase_uid: "owner", actual_type: type, total_cost_cents: cost, duration_minutes: minutes });
  }
}

test("job margin uses whole-job invoices less credits and separately aggregated actual costs", async () => {
  const f = fixture(); costJob(f, "complete");
  f.db.exec("UPDATE trade_crm_quick_invoices SET sent_at='2026-08-12T12:00Z'");
  f.insert("trade_crm_quick_invoice_credits", { id: "credit", invoice_id: "i-complete", work_order_id: "complete", firebase_uid: "owner", status: "issued", total_cents: 2200, tax_cents: 200, created_at: "2026-09-15T12:00Z" });
  const p = (await f.report()).profitability;
  assert.equal(p.jobs, 1); assert.equal(p.completeJobs, 1); assert.equal(p.revenueCents, 8000);
  assert.equal(p.labourCents, 2000); assert.equal(p.materialCents, 1000); assert.equal(p.labourMinutes, 120);
  assert.equal(p.marginCents, 5000); assert.equal(p.marginPercent, 62.5);
});

test("missing actuals and zero-budget service tasks never count as confirmed zero costs", async () => {
  const f = fixture(); costJob(f, "missing", false); costJob(f, "task");
  f.insert("trade_crm_job_plan_requirements", { id: "service", job_plan_id: "p-task", firebase_uid: "owner", requirement_type: "task", total_cost_cents: 0, status: "completed" });
  let p = (await f.report()).profitability; assert.equal(p.completeJobs, 0); assert.equal(p.marginCents, null);
  assert.equal(p.items.find(item => item.id === "missing").missingCosts, 2); assert.equal(p.items.find(item => item.id === "task").missingCosts, 1);
  f.insert("trade_crm_job_actuals", { id: "explicit-zero", job_plan_id: "p-task", job_plan_requirement_id: "service", work_order_id: "task", firebase_uid: "owner", actual_type: "task", total_cost_cents: 0 });
  p = (await f.report()).profitability; assert.equal(p.completeJobs, 1); assert.equal(p.marginCents, 7000);
  f.db.exec("UPDATE trade_crm_job_plan_requirements SET status='not_needed' WHERE job_plan_id='p-missing'");
  assert.equal((await f.report()).profitability.completeJobs, 2);
});

test("revised scope with earlier actuals withholds margin and respects invoice-linked handoff", async () => {
  const f = fixture(); costJob(f, "revised");
  f.insert("trade_crm_commercial_handovers", { id: "new-h", work_order_id: "revised", firebase_uid: "owner", crm_customer_id: "customer", accepted_at: "2026-09-15T12:00Z" });
  f.insert("trade_crm_job_plans", { id: "new-p", commercial_handoff_id: "new-h", work_order_id: "revised", firebase_uid: "owner" });
  let p = (await f.report()).profitability; assert.equal(p.items[0].status, "scope_review"); assert.equal(p.marginCents, null);
  f.insert("trade_crm_accepted_invoices", { id: "accepted", work_order_id: "revised", firebase_uid: "owner", crm_customer_id: "customer", commercial_handoff_id: "h-revised", created_at: "2026-09-12T12:00Z" });
  p = (await f.report()).profitability; assert.equal(p.items[0].status, "complete"); assert.equal(p.marginCents, 7000);
});

test("negative margins survive and zero revenue has no margin percentage", async () => {
  const f = fixture(); costJob(f, "loss"); f.db.exec("UPDATE trade_crm_quick_invoices SET total_cents=0,tax_cents=0");
  const p = (await f.report()).profitability; assert.equal(p.marginCents, -3000); assert.equal(p.marginPercent, null); assert.equal(p.items[0].marginPercent, null);
});

test("cost permissions and owner scope protect profitability and CSV", async () => {
  const f = fixture(); costJob(f, "mine");
  f.insert("trade_crm_job_actuals", { id: "foreign", job_plan_id: "p-mine", job_plan_requirement_id: "mine-labour", work_order_id: "mine", firebase_uid: "other", actual_type: "labour", total_cost_cents: 900000 });
  assert.equal((await f.report()).profitability.labourCents, 2000);
  for (const permissions of [{ canViewInvoices: false }, { isOwner: false, canViewPriceBook: false }]) {
    const report = await f.report({}, permissions); assert.equal(report.profitability, null); assert.doesNotMatch(JSON.stringify(reportCsvRows(report)), /Job profitability|Recorded labour costs/);
  }
  assert.equal((await f.report({}, { isOwner: false, canViewPriceBook: true })).profitability.completeJobs, 1);
  assert.equal((await f.report({}, { isOwner: false, canViewPriceBook: true, jobScope: "own", memberId: "other-member" })).profitability.jobs, 0);
});

test("profitability totals include every job and every page remains accessible", async () => {
  const f = fixture(); f.db.exec("BEGIN"); for (let i = 0; i < 1051; i++) costJob(f, `cost-${i}`); f.db.exec("COMMIT");
  const p = (await f.report({ profitPage: "22" })).profitability;
  assert.equal(p.jobs, 1051); assert.equal(p.completeJobs, 1051); assert.equal(p.marginCents, 1051 * 7000); assert.equal(p.items.length, 1); assert.equal(p.page, 22);
});

test("presets use calendar weeks, quarters and Australian financial years with fair comparisons", () => {
  const weekly = resolveReportPeriod(params({ period: "weekly" }), "VIC", now);
  assert.equal(weekly.start, "2026-09-14"); assert.equal(weekly.end, "2026-09-20"); assert.equal(weekly.previous.start, "2026-09-07");
  const month = resolveReportPeriod(params(), "VIC", now); assert.equal(month.previous.end, "2026-08-20");
  const quarter = resolveReportPeriod(params({ period: "quarterly" }), "VIC", now); assert.equal(quarter.start,"2026-07-01"); assert.equal(quarter.previous.start,"2026-04-01");
  const fy = resolveReportPeriod(params({ period: "fytd" }), "VIC", new Date("2026-06-30T13:00Z")); assert.equal(fy.start,"2025-07-01");
  const newFy = resolveReportPeriod(params({ period: "fytd" }), "VIC", new Date("2026-06-30T15:00Z")); assert.equal(newFy.start,"2026-07-01"); assert.equal(newFy.previous.end,"2025-07-01");
  assert.equal(resolveReportPeriod(params({anchor:"2026-02-10"}),"VIC",now).end,"2026-02-28");
  assert.equal(resolveReportPeriod(params({anchor:"2024-02-10"}),"VIC",now).end,"2024-02-29");
});
test("local midnight follows DST and half-hour Australian time zones", () => {
  assert.equal(reportMidnight("2026-10-04", "VIC"), "2026-10-03T14:00:00.000Z");
  assert.equal(reportMidnight("2026-10-05", "VIC"), "2026-10-04T13:00:00.000Z");
  assert.equal(reportMidnight("2026-07-01", "SA"), "2026-06-30T14:30:00.000Z");
  assert.equal(reportMidnight("2026-07-01", "WA"), "2026-06-30T16:00:00.000Z");
});
test("invalid, future and reversed reporting windows reject while multi-decade history is allowed", () => {
  for (const input of [{period:"other"},{anchor:"2026-02-30"},{anchor:"2027-01-01"},{period:"custom",from:"2026-09-20",to:"2026-09-10"}]) assert.throws(() => resolveReportPeriod(params(input), "VIC", now));
  assert.equal(resolveReportPeriod(params({period:"custom",from:"1990-01-01",to:"2026-09-20"}),"VIC",now).start,"1990-01-01");
  assert.equal(resolveReportPeriod(params({anchor:"1990-01-01"}),"VIC",now).start,"1990-01-01");
  const custom = resolveReportPeriod(params({period:"custom",from:"2026-09-01",to:"2026-09-03"}),"VIC",now); assert.equal(custom.previous.start,"2026-08-29"); assert.equal(custom.previous.end,"2026-08-31");
  assert.equal(reportChange(10,0), "No prior value"); assert.equal(reportChange(0,0),"No change");
});
test("trend buckets cover long custom periods and all days without gaps", () => {
  const period=resolveReportPeriod(params({period:"custom",from:"2025-10-20",to:"2026-09-20"}),"VIC",now);
  const bins=reportTrendWindows(period,"VIC"); assert.equal(bins[0].start,period.start); assert.equal(bins.at(-1).end,period.end);
  for(let i=1;i<bins.length;i++) assert.equal(bins[i-1].endUtc,bins[i].startUtc);
});
test("issued invoices count once, drafts and accounting exports do not inflate period sales", async () => {
  const f=fixture(); f.job("one"); f.invoice("one"); f.job("draft"); f.invoice("draft",{status:"draft"});
  f.insert("trade_crm_accepted_invoices",{id:"duplicate",firebase_uid:"owner",work_order_id:"one",status:"issued",currency:"AUD",created_at:"2026-09-12T12:00Z",total_cents:99000,tax_cents:9000});
  f.insert("trade_crm_accounting_documents",{id:"export",firebase_uid:"owner",work_order_id:"one",document_type:"invoice",currency:"AUD",status:"issued",amount_cents:11000,paid_amount_cents:0});
  const report=await f.report(); assert.equal(report.current.invoicedCents,10000); assert.equal(report.current.invoiceCount,1); assert.equal(report.receivables.outstandingCents,11000);
});
test("later credits reduce their own period and today's balance, retaining prior invoice issue", async () => {
  const f=fixture(); f.job("one"); f.invoice("one",{sent_at:"2026-08-12T12:00Z",status:"part_credited"});
  f.insert("trade_crm_quick_invoice_credits",{id:"credit",invoice_id:"i-one",work_order_id:"one",firebase_uid:"owner",status:"issued",total_cents:2200,tax_cents:200,created_at:"2026-09-15T12:00Z"});
  const report=await f.report(); assert.equal(report.current.invoicedCents,-2000); assert.equal(report.previous.invoicedCents,10000); assert.equal(report.receivables.outstandingCents,8800);
  assert.equal(report.services[0].invoicedCents,-2000); assert.equal(report.trend.reduce((sum,item)=>sum+item.invoicedCents,0),-2000);
});
test("paid quick invoices use accounting or manual recorded payments without double counting", async () => {
  const f=fixture(); f.job("one",{}, {paid_value_cents:4000}); f.invoice("one");
  assert.equal((await f.report()).receivables.outstandingCents,7000);
  f.insert("trade_crm_accounting_documents",{id:"export",firebase_uid:"owner",work_order_id:"one",document_type:"invoice",currency:"AUD",status:"paid",amount_cents:11000,paid_amount_cents:11000});
  const report=await f.report(); assert.equal(report.receivables.outstandingCents,0); assert.equal(report.receivables.paidCents,11000);
});
test("accepted invoice reconciliation conflict preserves an existing manual balance", async () => {
  const f=fixture(); f.job("one",{}, {invoice_status:"part_paid",invoiced_value_cents:11000,paid_value_cents:3000});
  f.insert("trade_crm_accepted_invoices",{id:"conflict",firebase_uid:"owner",work_order_id:"one",status:"attention_required",currency:"AUD",total_cents:20000});
  const report=await f.report(); assert.equal(report.receivables.outstandingCents,8000); assert.equal(report.receivables.undatedInvoiceCount,1); assert.equal(report.current.invoicedCents,0);
});
test("tenant ownership and permissions hold across summaries, trends, breakdowns and CSV", async () => {
  const f=fixture(); f.job("one"); f.invoice("one"); f.job("foreign",{firebase_uid:"other"}); f.invoice("foreign",{firebase_uid:"other",total_cents:900000}); f.invoice("one",{id:"foreign-child",firebase_uid:"other",total_cents:900000});
  const report=await f.report(); assert.equal(report.current.newJobs,1); assert.equal(report.current.invoicedCents,10000);
  const hidden=await f.report({}, {canViewInvoices:false,canViewQuotes:false}); assert.equal(hidden.receivables,null); assert.equal(hidden.current.invoicedCents,null); assert.equal(hidden.previous.invoicedCents,null); assert.equal(hidden.current.wonCents,null); assert.equal(hidden.services[0].invoicedCents,null); assert.ok(hidden.trend.every(row=>row.invoicedCents===null));
  assert.doesNotMatch(JSON.stringify(reportCsvRows(hidden)),/10000|invoicedCents|wonCents|Receivables/);
});
test("job and schedule scopes exclude unassigned colleagues for restricted staff", async () => {
  const f=fixture(); f.job("one",{assignee_member_id:"me"}); f.job("two",{assignee_member_id:"them"});
  f.insert("trade_crm_appointments",{id:"a",work_order_id:"one",firebase_uid:"owner",assignee_member_id:"them",starts_at:"2026-09-10T09:00",ends_at:"2026-09-10T10:00",status:"scheduled"});
  const report=await f.report({}, {isOwner:false,memberId:"me",jobScope:"own",scheduleScope:"own"}); assert.equal(report.current.newJobs,1); assert.equal(report.current.visits,0); assert.equal(report.team.length,0);
});
test("cancelled jobs retain financial history but no workload; bin and supplier records are excluded", async () => {
  const f=fixture(); f.job("cancelled",{stage:"cancelled"}); f.invoice("cancelled"); f.job("bin",{record_status:"archived"}); f.invoice("bin"); f.job("supplier",{partner_type:"supplier"}); f.invoice("supplier");
  f.insert("trade_crm_appointments",{id:"a",work_order_id:"cancelled",firebase_uid:"owner",starts_at:"2026-09-10T09:00",ends_at:"2026-09-10T10:00",status:"scheduled"});
  const report=await f.report(); assert.equal(report.current.invoicedCents,10000); assert.equal(report.current.newJobs,1); assert.equal(report.current.visits,0); assert.equal(report.work.openJobs,0);
});
test("service and region filters use job sites and include unknown regions explicitly", async () => {
  const f=fixture(); f.job("vic",{}, {service_site_id:"vic-site"}); f.job("nsw",{service_category:"insulation"}, {service_site_id:"nsw-site"}); f.job("unknown");
  f.insert("trade_crm_service_sites",{id:"vic-site",firebase_uid:"owner",address_state:"VIC"}); f.insert("trade_crm_service_sites",{id:"nsw-site",firebase_uid:"owner",address_state:"NSW"});
  const report=await f.report({state:"VIC",service:"hot-water"}); assert.equal(report.current.newJobs,1); assert.deepEqual(report.options.states,["NSW","VIC","unknown"]); assert.equal(report.regions[0].key,"VIC");
});
test("quote win rate inputs use decisions and selected option values, not period-issued quote totals", async () => {
  const f=fixture(); f.job("one"); f.insert("trade_crm_quotes",{id:"q",work_order_id:"one",firebase_uid:"owner"});
  for(const [id,issued] of [["v1","2026-08-05T01:00Z"],["v2","2026-09-05T01:00Z"]]) f.insert("trade_crm_quote_versions",{id,quote_id:"q",firebase_uid:"owner",issued_at:issued});
  for(const [id,decision,total] of [["accept","accepted",20000],["decline","declined",50000]]) f.insert("trade_crm_quote_acceptances",{id,work_order_id:"one",firebase_uid:"owner",decision,decided_at:"2026-09-06T01:00Z",selected_subtotal_cents:total,currency:"AUD"});
  const report=await f.report(); assert.equal(report.current.quoteIssues,0); assert.equal(report.previous.quoteIssues,1); assert.equal(report.current.wonCents,20000); assert.equal(report.current.wonQuotes,1); assert.equal(report.current.declinedQuotes,1);
});
test("completion events deduplicate jobs, dates respect local midnight, and hours use real duration", async () => {
  const f=fixture(); f.job("one",{created_at:"2026-08-31T14:00:00Z"}); f.job("before",{created_at:"2026-08-31T13:59:59Z"});
  for(const id of ["e1","e2"]) f.insert("trade_work_order_events",{id,work_order_id:"one",firebase_uid:"owner",event_type:"job_completed",created_at:"2026-09-10T12:00Z"});
  for(const [id,end,status] of [["a","2026-09-10T19:30","completed"],["b","","scheduled"],["c","2026-09-10T11:00","no_show"]]) f.insert("trade_crm_appointments",{id,work_order_id:"one",firebase_uid:"owner",starts_at:"2026-09-10T09:00",ends_at:end,status});
  const report=await f.report(); assert.equal(report.current.newJobs,1); assert.equal(report.current.completedJobs,1); assert.equal(report.current.bookedMinutes,630); assert.equal(report.current.missingDurations,1); assert.equal(report.current.visits,2);
});
test("ageing correctly separates due today, overdue ranges and missing due dates", async () => {
  const f=fixture(); for(const [id,due] of [["today","2026-09-20"],["late","2026-08-01"],["missing",""]]) { f.job(id); f.invoice(id,{due_at:due}); }
  const report=await f.report(); assert.equal(report.receivables.buckets.find(row=>row.key==="Not overdue").cents,11000); assert.equal(report.receivables.buckets.find(row=>row.key==="31 to 60 days").cents,11000); assert.equal(report.receivables.buckets.find(row=>row.key==="No due date").cents,11000);
});

test("large business reports aggregate all records rather than a display page cap", async () => {
  const f=fixture(); f.db.exec("BEGIN"); for(let i=0;i<1200;i++) { f.job(`job-${i}`); f.invoice(`job-${i}`); } f.db.exec("COMMIT");
  const report=await f.report(); assert.equal(report.current.newJobs,1200); assert.equal(report.current.invoiceCount,1200); assert.equal(report.current.invoicedCents,12000000); assert.equal(report.receivables.outstandingCents,13200000);
});

test("all time includes decades of scoped history with complete trends and no artificial comparison", async () => {
  const f=fixture(); f.job("old",{created_at:"1990-01-01T00:00:00Z"}); f.invoice("old",{sent_at:"1990-01-01T00:00:00Z"});
  f.job("new"); f.invoice("new"); f.job("foreign",{firebase_uid:"other",created_at:"1970-01-01T00:00:00Z"});
  const report=await f.report({period:"all"});
  assert.equal(report.period.start,"1990-01-01"); assert.equal(report.period.previous,null); assert.equal(report.previous,null);
  assert.equal(report.current.newJobs,2); assert.equal(report.current.invoicedCents,20000); assert.ok(report.trend.length<=38);
  assert.equal(report.trend[0].start,report.period.start); assert.equal(report.trend.at(-1).end,report.period.end);
  const windows=reportTrendWindows(report.period,"VIC"); for(let i=1;i<windows.length;i++) assert.equal(windows[i-1].endUtc,windows[i].startUtc);
  assert.equal(report.trend.reduce((total,row)=>total+row.newJobs,0),report.current.newJobs);
  assert.equal(report.trend.reduce((total,row)=>total+row.invoicedCents,0),report.current.invoicedCents);
  assert.equal(reportCsvRows(report).find(row=>row.metric==="Net TLink invoicing").value,"200.00");
  assert.ok(reportCsvRows(report).every(row=>row.comparison===""));
});

test("all time derives earliest eligible event and visit, respecting filters and staff access", async () => {
  const f=fixture(); f.job("one",{assignee_member_id:"me"}); f.invoice("one",{sent_at:"1995-06-01T15:00:00Z"});
  f.job("other-service",{service_category:"insulation",created_at:"1980-01-01T00:00:00Z"});
  f.insert("trade_crm_appointments",{id:"a",work_order_id:"one",firebase_uid:"owner",assignee_member_id:"them",starts_at:"1992-01-01T09:00",ends_at:"1992-01-01T10:00",status:"completed"});
  assert.equal((await f.report({period:"all",service:"hot-water"})).period.start,"1992-01-01");
  const own={isOwner:false,memberId:"me",jobScope:"own",scheduleScope:"own"};
  assert.equal((await f.report({period:"all"},own)).period.start,"1995-06-02");
  assert.equal((await f.report({period:"all"},{...own,canViewInvoices:false})).period.start,"2026-09-10");
  const empty=await f.report({period:"all",state:"WA"}); assert.equal(empty.period.start,empty.period.today); assert.equal(empty.current.newJobs,0);
});

test("reports execute within Cloudflare D1 query limits with the same aggregates as SQLite", async () => {
  const { Miniflare } = await import("miniflare");
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', compatibilityDate: "2025-04-01", d1Databases: { DB: "business-reports-regression" }, port: 0 });
  const f = fixture();
  try {
    f.job("one", {}, { paid_value_cents: 3000 }); f.invoice("one");
    f.job("foreign", { firebase_uid: "other" }); f.invoice("foreign", { firebase_uid: "other", total_cents: 900000 });
    const db = await runtime.getD1Database("DB");
    for (const table of f.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table'").all()) {
      await db.prepare(table.sql).run();
      for (const row of f.db.prepare(`SELECT * FROM ${table.name}`).all()) {
        await db.prepare(`INSERT INTO ${table.name} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).bind(...Object.values(row)).run();
      }
    }
    for (const query of [{}, { period: "weekly" }, { period: "quarterly" }, { period: "fytd" }, { period: "all" }, { period: "custom", from: "1990-01-01", to: "2026-09-10" }]) {
      const actual = await loadBusinessReport(db, "owner", access, params(query), "VIC", now);
      assert.deepEqual(actual, await f.report(query));
    }
  } finally { f.db.close(); await runtime.dispose(); }
});
