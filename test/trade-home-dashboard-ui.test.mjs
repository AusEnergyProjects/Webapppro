import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { resolveReportPeriod } from "../src/lib/trade-business-reports.ts";
import * as reporting from "../src/lib/trade-business-reports.ts";
import * as schedule from "../src/lib/trade-schedule.ts";

const source = fs.readFileSync(new URL("../src/components/TradeHomeDashboard.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(item => nodes(item, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const expand = node => !node || typeof node !== "object" ? node : Array.isArray(node) ? node.map(expand) : typeof node.type === "function" ? expand(node.type(node.props)) : { ...node, props: { ...node.props, children: expand(node.props?.children) } };
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node).trim() === label)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const job = { id: "job-1", workNumber: "TLJ-001", title: "Switchboard inspection", protected: false };

function fixture() {
  const measures = { newJobs: 4, completedJobs: 2, quoteIssues: 3, wonQuotes: 2, declinedQuotes: 1, wonCents: 20000, invoicedCents: 10000, creditCents: 0, invoiceCount: 1, bookedMinutes: 240, visits: 4, completedVisits: 2, missingDurations: 0 };
  return {
    generatedAt: "2026-10-01T02:00:00Z", today: "2026-10-01", timeZone: "Australia/Sydney",
    metrics: { openJobs: 9, waitingJobs: 1, awaitingSchedule: 2, todayJobs: 2, todayVisits: 2, thisWeekJobs: 4, thisWeekVisits: 5, nextWeekJobs: 2, nextWeekVisits: 3, overdueTasks: 1, openIssues: 1 },
    workload: ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"].map((weekStart, index) => ({ weekStart, weekEnd: weekStart, jobs: 4 - index, visits: 5 - index, bookedMinutes: 240, missingDurations: 0 })),
    workStages: { ready: 2, blocked: 1 }, upcomingAppointments: [{ id: "appointment-1", appointmentType: "visit", title: "Inspection", startsAt: "2026-10-02T12:00", endsAt: "2026-10-02T13:00", assigneeLabel: "Alex", status: "scheduled", job }],
    overdueTasks: [{ id: "task-1", title: "Confirm access", dueAt: "2026-09-30", status: "pending", job }], openIssues: [{ id: "issue-1", body: "Replacement part required", createdAt: "2026-09-30", job }],
    financial: {
      generatedAt: "2026-10-01T02:00:00Z", period: resolveReportPeriod(new URLSearchParams(), "NSW", new Date("2026-10-01T02:00:00Z")), service: "", state: "", permissions: { invoices: true, quotes: true }, options: { services: ["electrical"], states: ["NSW"] }, current: measures, previous: { ...measures, invoicedCents: 5000 },
      trend: [], services: [{ key: "electrical", newJobs: 4, completedJobs: 2, invoicedCents: 10000 }], regions: [], work: { openJobs: 9 }, team: [],
      receivables: { outstandingCents: 33000, paidCents: 20000, buckets: [{ key: "Not overdue", count: 1, cents: 22000 }, { key: "1 to 30 days", count: 1, cents: 11000 }, { key: "No due date", count: 0, cents: 0 }], undatedInvoiceCount: 0, undatedInvoiceCents: 0, items: [] },
      recordedGst: { invoiceGstCents: 1000, creditGstCents: 0, netGstCents: 1000 },
      profitability: { jobs: 2, completeJobs: 2, revenueCents: 10000, labourCents: 2500, materialCents: 2500, otherCents: 0, labourMinutes: 60, completeRevenueCents: 10000, marginCents: 5000, marginPercent: 50, page: 1, pageSize: 25, items: [], attentionItems: [], coverage: {invoiceNeeded:0,planNeeded:0,scopeReview:0,costsNeeded:0,missingCosts:0} },
    },
  };
}

function harness(responder, options = {}) {
  let cursor = 0; let currentBusiness = { ownerUid: "business-a", memberId: "" };
  const state = []; const effects = []; const pending = []; const requests = []; const calls = []; const exports = {};
  const user = { uid: "viewer", getIdToken: async () => "token" };
  const props = { user, onOpenJob: (...target) => calls.push(["job", ...target]), onOpenSchedule: week => calls.push(["schedule", week]), onOpenJobs: filter => calls.push(["jobs", filter]), onNewJob: () => calls.push(["new"]), onOpenInvoices: () => calls.push(["invoices"]), onOpenReports: () => calls.push(["reports"]), ...options };
  const request = async (url, init) => { requests.push({ url, init }); return responder(url, init, requests.length); };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], next => state[index] = typeof next === "function" ? next(state[index]) : next]; },
    useEffect(callback, deps) { const index = cursor++; const old = effects[index]; if (!old || deps.some((value, i) => value !== old.deps[i])) { old?.cleanup?.(); effects[index] = { deps }; pending.push(() => effects[index].cleanup = callback()); } },
  };
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "./TradeBusinessProvider" ? { useTradeBusinessFetch: () => request, useTradeBusiness: () => currentBusiness } : id === "@/lib/trade-business-reports" ? reporting : id === "@/lib/trade-schedule" ? schedule : id === "@/lib/energy-service-catalogue.mjs" ? { ENERGY_SERVICE_LABELS: { electrical: "Electrical" } } : id.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : {};
  Function("require", "exports", compiled)(require, exports);
  const render = () => { cursor = 0; const tree = expand(exports.TradeHomeDashboard(props)); for (const effect of pending.splice(0)) effect(); return tree; };
  return { render, props, requests, calls, setBusiness(value) { currentBusiness = value; }, async mount() { render(); await flush(); return render(); }, cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}
const response = dashboard => ({ ok: true, json: async () => ({ ok: true, dashboard }) });

test("Home loads scoped data with a token and no fake zero cards while loading", async () => {
  const h = harness(async () => response(fixture())); const initial = h.render();
  assert.match(text(initial), /Loading your dashboard/); assert.doesNotMatch(text(initial), /\$0|Net invoiced|Jobs this week/);
  await flush(); const tree = h.render(); assert.match(text(tree), /Home dashboard/); assert.match(text(tree), /\$100/);
  assert.equal(h.requests[0].url, "/api/trade-crm?mode=home&period=monthly"); assert.equal(h.requests[0].init.headers.Authorization, "Bearer token"); assert.equal(h.requests[0].init.cache, "no-store"); h.cleanup();
});

test("period selection clears stale numbers and routes all Home actions", async () => {
  const h = harness(async () => response(fixture())); let tree = await h.mount();
  button(tree, "New job").props.onClick(); button(tree, "Open schedule").props.onClick(); button(tree, "View full report").props.onClick();
  nodes(tree, node => node.type === "button" && node.props.className === "scheduleItem")[0].props.onClick();
  nodes(tree, node => node.type === "button" && node.props.className === "actionRow")[0].props.onClick();
  nodes(tree, node => node.type === "button" && node.props["aria-label"]?.startsWith("Open week starting"))[1].props.onClick();
  assert.deepEqual(h.calls, [["new"], ["schedule", undefined], ["reports"], ["job", "job-1"], ["jobs", "awaiting_schedule"], ["schedule", "2026-10-05"]]);
  nodes(tree, node => node.type === "select")[0].props.onChange({ target: { value: "quarterly" } });
  tree = h.render(); assert.match(text(tree), /Loading your dashboard/); assert.doesNotMatch(text(tree), /\$100/);
  await flush(); tree = h.render(); assert.match(h.requests.at(-1).url, /period=quarterly/); assert.equal(nodes(tree, node => node.type === "select")[0].props.value, "quarterly"); h.cleanup();
});

test("attention actions retain the task or issue destination and do not imply scheduling eligibility", async () => {
  const h = harness(async () => response(fixture())); const tree = await h.mount();
  assert.match(text(tree), /Needs scheduling/); assert.match(text(tree), /View accepted or approved work to book/);
  assert.doesNotMatch(text(tree), /Ready to schedule/);
  const actions = nodes(tree, node => node.type === "ul" && node.props.className === "attentionList")[0];
  const targets = nodes(actions, node => node.type === "button");
  targets[0].props.onClick(); targets[1].props.onClick();
  assert.deepEqual(h.calls, [["job", "job-1", "tasks"], ["job", "job-1", "notes"]]); h.cleanup();
});

test("Home shows today workload and routes financial follow-ups to their specific permitted job", async () => {
  const data=fixture(), calls=[];
  data.financial.receivables.items=[{jobId:'late-job',number:'TLJ-LATE',title:'Late job',balanceCents:12500,dueAt:'2026-09-01',overdueDays:30}];
  data.financial.profitability.completeJobs=1;
  data.financial.profitability.attentionItems=[{id:'cost-job',number:'TLJ-COST',status:'costs_needed',missingCosts:2},{id:'invoice-job',number:'TLJ-INVOICE',status:'invoice_needed',missingCosts:0}];
  const h=harness(async()=>response(data),{onOpenJobInvoice:id=>calls.push(['invoice',id]),onOpenJobCosts:id=>calls.push(['cost',id])});
  const tree=await h.mount(); assert.match(text(tree),/Today:\s+2 jobs\s+·\s+2 visits/); assert.match(text(tree),/30 days overdue/); assert.match(text(tree),/2 cost items missing/);
  for(const id of ['TLJ-LATE','TLJ-COST','TLJ-INVOICE']) nodes(tree,node=>node.type==='button'&&text(node).includes(id))[0].props.onClick();
  assert.deepEqual(calls,[['invoice','late-job'],['cost','cost-job'],['invoice','invoice-job']]);
  assert.doesNotMatch(text(tree),/Completed-job gross margin/); h.cleanup();
  const apprentice=harness(async()=>response(data),{staffPermissions:{canRunReports:false,canViewInvoices:false}}); const hidden=await apprentice.mount();
  assert.doesNotMatch(text(hidden),/TLJ-LATE|TLJ-COST|Payment follow-up|Completed job costs/); apprentice.cleanup();
});

test("no active jobs offers permitted creators a new job without treating existing history as first-time setup", async () => {
  const data = fixture(); data.metrics = Object.fromEntries(Object.keys(data.metrics).map(key => [key, 0]));
  data.upcomingAppointments = []; data.overdueTasks = []; data.openIssues = [];
  for (const options of [{}, { staffPermissions: { canCreateJobs: true, canRescheduleJobs: false, jobScope: "own" } }]) {
    const h = harness(async () => response(data), options); const tree = await h.mount();
    assert.match(text(tree), /No active jobs/); assert.doesNotMatch(text(tree), /You are up to date|first job|Get started/);
    button(tree, "Create job").props.onClick(); assert.deepEqual(h.calls, [["new"]]);
    assert.ok(button(tree, options.staffPermissions ? "View schedule" : "Plan your week")); h.cleanup();
  }
});

test("empty field and crew views explain assignment and expose only existing schedule actions", async () => {
  const data = fixture(); data.financial = null; data.metrics = Object.fromEntries(Object.keys(data.metrics).map(key => [key, 0]));
  data.upcomingAppointments = []; data.overdueTasks = []; data.openIssues = [];
  for (const crewLead of [false, true]) {
    const h = harness(async () => response(data), { staffPermissions: { canCreateJobs: false, canRescheduleJobs: false, jobScope: "own", crewLead } });
    const tree = await h.mount();
    assert.match(text(tree), crewLead ? /Your crew's next assigned jobs/ : /Your dispatcher can assign your next job/);
    assert.doesNotMatch(text(tree), /You are up to date|Plan your week|Create job|New job|\$/);
    const actions = nodes(tree, node => node.type === "section" && node.props["aria-label"] === "Next actions")[0];
    button(actions, "View schedule").props.onClick(); assert.deepEqual(h.calls, [["schedule", undefined]]); h.cleanup();
  }
});

test("active jobs with no outstanding actions retain the up-to-date state", async () => {
  const data = fixture(); Object.assign(data.metrics, { awaitingSchedule: 0, waitingJobs: 0, overdueTasks: 0, openIssues: 0 });
  data.overdueTasks = []; data.openIssues = [];
  const h = harness(async () => response(data)); const tree = await h.mount();
  assert.match(text(tree), /You are up to date/); assert.doesNotMatch(text(tree), /No active jobs/);
  button(tree, "View jobs").props.onClick(); assert.deepEqual(h.calls, [["jobs", "all"]]); h.cleanup();
});

test("server-null and staff-denied finance never render money or financial controls", async () => {
  for (const options of [{ serverNull: true }, { staffPermissions: { canRunReports: false, canViewInvoices: true, canCreateJobs: false } }, { staffPermissions: { canRunReports: true, canViewInvoices: false, canCreateJobs: false } }]) {
    const data = fixture(); if (options.serverNull) data.financial = null;
    const h = harness(async () => response(data), options); const tree = await h.mount();
    assert.doesNotMatch(text(tree), /\$|Revenue|Net invoiced|Recorded job costs|Net GST/); assert.match(text(tree), /Open jobs/); assert.match(text(tree), /Four-week workload/);
    assert.equal(nodes(tree, node => node.type === "select").length, 0); if (options.staffPermissions) assert.equal(button(tree, "New job"), undefined); h.cleanup();
  }
});

test("late business response cannot reveal the previous business data", async () => {
  let release; const h = harness(async (_url, _init, count) => count === 1 ? new Promise(resolve => release = resolve) : response({ ...fixture(), financial: null }));
  h.render(); await flush(); h.setBusiness({ ownerUid: "business-b", memberId: "member-b" }); let tree = h.render();
  assert.match(text(tree), /Loading your dashboard/); assert.equal(h.requests[0].init.signal.aborted, true);
  await flush(); tree = h.render(); assert.doesNotMatch(text(tree), /\$/);
  release(response(fixture())); await flush(); tree = h.render(); assert.doesNotMatch(text(tree), /\$/); h.cleanup();
});

test("negative service totals retain signed amounts and suppress misleading doughnut shares", async () => {
  const data = fixture(); data.financial.current.invoicedCents = 7000;
  data.financial.services.push({ key: "credit-service", newJobs: 0, completedJobs: 0, invoicedCents: -3000 });
  const h = harness(async () => response(data)); const tree = await h.mount();
  assert.match(text(tree), /-\$30/); assert.match(text(tree), /Signed totals are shown without a proportional split/);
  assert.equal(nodes(tree, node => node.type === "circle" && node.props.strokeDasharray).length, 0);
  assert.match(nodes(tree, node => node.type === "svg" && node.props.role === "img")[0].props["aria-label"], /Net invoicing \$70.00 excluding GST/); h.cleanup();
});

test("incomplete cost records suppress margin and keep financial bases explicit", async () => {
  const data = fixture(); data.financial.profitability.completeJobs = 1;
  const h = harness(async () => response(data)); const tree = await h.mount();
  assert.doesNotMatch(text(tree), /Completed-job gross margin|50\.0%/); assert.match(text(tree), /Margin is not shown/); assert.match(text(tree), /different group from invoices issued/); assert.match(text(tree), /Net GST on invoices/); h.cleanup();
});

test("load errors offer a working retry without leaking old metrics", async () => {
  const h = harness(async (_url, _init, count) => count === 1 ? { ok: false, json: async () => ({ error: "Dashboard temporarily unavailable" }) } : response(fixture()));
  let tree = await h.mount(); assert.match(text(tree), /Dashboard temporarily unavailable/); assert.doesNotMatch(text(tree), /\$/);
  button(tree, "Try again").props.onClick(); h.render(); await flush(); tree = h.render(); assert.match(text(tree), /Net invoiced/); assert.equal(h.requests.length, 2); h.cleanup();
});

test("week chart exposes real counts, dates and missing-duration limitations", async () => {
  const data = fixture(); data.workload[0].missingDurations = 2;
  const h = harness(async () => response(data)); const tree = await h.mount();
  const columns = nodes(tree, node => node.type === "button" && node.props["aria-label"]?.startsWith("Open week starting"));
  assert.equal(columns.length, 4); assert.match(columns[0].props["aria-label"], /4 jobs, 5 visits, 4 h booked, 2 visits without a duration/); assert.match(text(tree), /excluded from booked time/); h.cleanup();
});

test("upcoming business-local dates and times do not shift with the viewer timezone", async () => {
  const originalZone = process.env.TZ;
  try {
    for (const viewerZone of ["UTC", "America/Los_Angeles", "Australia/Sydney", "Australia/Perth"]) {
      process.env.TZ = viewerZone;
      for (const scenario of [
        { zone: "Australia/Perth", value: "2026-10-05T09:00", expected: /Mon, 5 Oct\s*·\s*9:00 am/, day: "5" },
        { zone: "Australia/Sydney", value: "2026-10-05T00:15", expected: /Mon, 5 Oct\s*·\s*12:15 am/, day: "5" },
        { zone: "Australia/Adelaide", value: "2026-06-14T23:45", expected: /Sun, 14 June\s*·\s*11:45 pm/, day: "14" },
      ]) {
        const data = fixture(); data.timeZone = scenario.zone; data.upcomingAppointments[0].startsAt = scenario.value;
        const h = harness(async () => response(data));
        try {
          const tree = await h.mount(); const appointmentTime = nodes(tree, node => node.type === "time")[0];
          assert.match(text(appointmentTime), scenario.expected, `${viewerZone} viewer, ${scenario.zone} business`);
          assert.equal(appointmentTime.props.dateTime, scenario.value);
          const badge = nodes(tree, node => node.props.className === "dateBadge")[0];
          assert.equal(text(nodes(badge, node => node.type === "b")[0]), scenario.day);
        } finally { h.cleanup(); }
      }
    }
  } finally { if (originalZone === undefined) delete process.env.TZ; else process.env.TZ = originalZone; }
});
