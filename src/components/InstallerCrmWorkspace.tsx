"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { TradeHandoverCentre } from "./TradeHandoverCentre";
import { TradeIntegrationCentre } from "./TradeIntegrationCentre";
import { TradePaymentPanel } from "./TradePaymentPanel";
import { TradePropertyView } from "./TradePropertyView";

type Customer = {
  id: string; customerNumber: string; customerType: string; displayName: string; firstName: string;
  lastName: string; businessName: string; email: string; phone: string; addressLine1: string;
  addressLine2: string; suburb: string; addressState: string; postcode: string; tags: string[];
  privateNotes: string; createdAt: string; updatedAt: string;
};
type Task = { id: string; title: string; dueAt: string; status: "pending" | "done"; completedAt: string };
type Appointment = { id: string; appointmentType: string; title: string; startsAt: string; endsAt: string; assigneeLabel: string; status: string; notes: string };
type Note = { id: string; noteType: "internal" | "issue"; body: string; issueStatus: string; createdAt: string; updatedAt: string };
type Job = {
  id: string; workNumber: string; title: string; serviceCategory: string; siteArea: string; stage: string;
  priority: string; scheduledStart: string; scheduledEnd: string; assigneeLabel: string; sourceType: string;
  customerSource: "trade_owned" | "platform_private" | "internal"; crmCustomerId: string; pipelineStage: string;
  description: string; customerReference: string; nextAction: string; tags: string[]; estimatedValueCents: number;
  quotedValueCents: number; invoicedValueCents: number; paidValueCents: number; quoteStatus: string;
  invoiceStatus: string; paymentDueAt: string; handoverStatus: string; tasks: Task[];
  appointments: Appointment[]; notes: Note[]; createdAt: string; updatedAt: string;
};
type CrmResult = { ok?: boolean; customers?: Customer[]; jobs?: Job[]; teamAccess?: boolean; error?: string };
type View = "today" | "jobs" | "schedule" | "customers" | "reports" | "integrations";

const serviceLabels: Record<string, string> = {
  assessment: "Energy assessment", solar: "Rooftop solar", battery: "Home batteries",
  "heating-cooling": "Heating and cooling", "hot-water": "Hot water",
  "insulation-draughts": "Insulation and draught control", "ev-charging": "EV charging", other: "Other work",
};
const pipelineLabels: Record<string, string> = {
  enquiry: "New enquiry", qualifying: "Checking the job", quoting: "Quote in progress", approved: "Approved",
  scheduled: "Scheduled", in_progress: "Work underway", complete: "Work complete", invoiced: "Invoiced",
  paid: "Paid", lost: "Not proceeding",
};
const workStageLabels: Record<string, string> = {
  backlog: "Planning", ready: "Ready to schedule", scheduled: "Scheduled", in_progress: "On site",
  blocked: "Waiting", completed: "Complete", cancelled: "Cancelled",
};
const appointmentLabels: Record<string, string> = {
  phone_call: "Phone call", site_visit: "Site visit", quote_review: "Quote review", installation: "Installation",
  service: "Service visit", admin: "Office task",
};

const dateLabel = (value: string, includeTime = false) => value
  ? new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleString("en-AU", includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" })
  : "Not set";
const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(cents / 100);
const cents = (value: FormDataEntryValue | null) => Math.round(Math.max(0, Number(value || 0)) * 100);
const isoDay = () => new Date().toISOString().slice(0, 10);

export function InstallerCrmWorkspace({ user, teamAccess }: { user: User; teamAccess: boolean }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [hasTeamAccess, setHasTeamAccess] = useState(teamAccess);
  const [view, setView] = useState<View>("today");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [jobFilter, setJobFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  const apply = useCallback((result: CrmResult) => {
    const nextJobs = result.jobs || [];
    const nextCustomers = result.customers || [];
    setJobs(nextJobs);
    setCustomers(nextCustomers);
    if (typeof result.teamAccess === "boolean") setHasTeamAccess(result.teamAccess);
    setSelectedJobId((current) => current && nextJobs.some((item) => item.id === current) ? current : nextJobs[0]?.id || "");
    setSelectedCustomerId((current) => current && nextCustomers.some((item) => item.id === current) ? current : nextCustomers[0]?.id || "");
  }, []);

  const load = useCallback(async () => {
    const token = await user.getIdToken();
    const response = await fetch("/api/trade-crm", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as CrmResult;
    if (!response.ok) throw new Error(result.error || "The installer CRM could not be loaded.");
    apply(result);
  }, [apply, user]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void load().catch((error) => active && setStatus(error instanceof Error ? error.message : "The installer CRM could not be loaded."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [load]);

  async function crmRequest(method: "POST" | "PATCH", body: Record<string, unknown>, busyKey: string, success: string) {
    setBusy(busyKey); setStatus("Saving your private business record...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-crm", {
        method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as CrmResult;
      if (!response.ok) throw new Error(result.error || "The CRM update could not be saved.");
      apply(result); setStatus(success); return true;
    } catch (error) { setStatus(error instanceof Error ? error.message : "The CRM update could not be saved."); return false; }
    finally { setBusy(""); }
  }

  async function workOrderRequest(method: "POST" | "PATCH", body: Record<string, unknown>, busyKey: string, success: string) {
    setBusy(busyKey); setStatus("Saving the job checklist...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-work-orders", {
        method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "The checklist could not be saved.");
      await load(); setStatus(success); return true;
    } catch (error) { setStatus(error instanceof Error ? error.message : "The checklist could not be saved."); return false; }
    finally { setBusy(""); }
  }

  const customerById = useMemo(() => Object.fromEntries(customers.map((customer) => [customer.id, customer])), [customers]);
  const selectedJob = jobs.find((job) => job.id === selectedJobId) || null;
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) || null;
  const today = isoDay();
  const openJobs = jobs.filter((job) => !["completed", "cancelled"].includes(job.stage));
  const overdueTasks = jobs.flatMap((job) => job.tasks.map((task) => ({ ...task, job })))
    .filter((task) => task.status === "pending" && task.dueAt && task.dueAt < today);
  const openIssues = jobs.flatMap((job) => job.notes.map((note) => ({ ...note, job })))
    .filter((note) => note.noteType === "issue" && note.issueStatus === "open");
  const upcomingAppointments = jobs.flatMap((job) => job.appointments.map((appointment) => ({ ...appointment, job })))
    .filter((appointment) => appointment.status === "scheduled" && appointment.startsAt.slice(0, 10) >= today)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const outstandingCents = jobs.reduce((sum, job) => sum + Math.max(0, job.invoicedValueCents - job.paidValueCents), 0);
  const paidCents = jobs.reduce((sum, job) => sum + job.paidValueCents, 0);
  const quotedCents = jobs.reduce((sum, job) => sum + job.quotedValueCents, 0);
  const filteredJobs = jobs.filter((job) => {
    const customer = customerById[job.crmCustomerId];
    const haystack = `${job.workNumber} ${job.title} ${job.siteArea} ${customer?.displayName || ""}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (jobFilter === "all") return true;
    if (jobFilter === "platform") return job.customerSource === "platform_private";
    if (jobFilter === "completed") return ["completed", "cancelled"].includes(job.stage);
    if (jobFilter === "attention") return job.stage === "blocked" || job.notes.some((note) => note.noteType === "issue" && note.issueStatus === "open");
    return !["completed", "cancelled"].includes(job.stage);
  });

  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const saved = await crmRequest("POST", {
      action: "create_customer", customerType: data.get("customerType"), firstName: data.get("firstName"),
      lastName: data.get("lastName"), businessName: data.get("businessName"), email: data.get("email"),
      phone: data.get("phone"), addressLine1: data.get("addressLine1"), suburb: data.get("suburb"),
      addressState: data.get("addressState"), postcode: data.get("postcode"), tags: data.get("tags"),
    }, "create-customer", "Customer added to your private CRM.");
    if (saved) form.reset();
  }

  async function createJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const saved = await crmRequest("POST", {
      action: "create_job", crmCustomerId: data.get("crmCustomerId"), title: data.get("title"),
      serviceCategory: data.get("serviceCategory"), siteArea: data.get("siteArea"), priority: data.get("priority"),
      scheduledStart: data.get("scheduledStart"), scheduledEnd: data.get("scheduledEnd"),
      description: data.get("description"), customerReference: data.get("customerReference"),
      estimatedValueCents: cents(data.get("estimatedValue")),
    }, "create-job", "Job created in your private CRM.");
    if (saved) { form.reset(); setView("jobs"); }
  }

  if (loading) return <section className="crm-loading"><span /><div><strong>Opening your business workspace</strong><p>Loading customers, jobs, schedule and financial records...</p></div></section>;

  return <section id="business-hub" className="installer-crm" aria-labelledby="installer-crm-title">
    <header className="crm-hero">
      <div><span>Installer business workspace</span><h2 id="installer-crm-title">Run the day from one clear place</h2><p>Manage your own customers, jobs, visits, tasks, issues, quotes, invoices and handovers. AEA customer identities remain protected.</p></div>
      <details className="crm-quick-create"><summary>+ New</summary><div><button type="button" onClick={() => { setView("jobs"); window.setTimeout(() => document.getElementById("crm-new-job")?.setAttribute("open", ""), 0); }}>New job</button><button type="button" onClick={() => { setView("customers"); window.setTimeout(() => document.getElementById("crm-new-customer")?.setAttribute("open", ""), 0); }}>New customer</button></div></details>
    </header>
    <nav className="crm-nav" aria-label="Installer CRM">
      {(["today", "jobs", "schedule", "customers", "reports", "integrations"] as View[]).map((item) => <button key={item} type="button" className={view === item ? "active" : ""} onClick={() => setView(item)}>{item === "today" ? "Today" : item[0].toUpperCase() + item.slice(1)}</button>)}
    </nav>
    <div className="crm-privacy-line"><strong>Clear privacy boundary</strong><span><b>AEA protected:</b> reference and region only</span><span><b>Your customer:</b> contacts your business already owns</span></div>

    {view === "today" && <div className="crm-view crm-today">
      <section className="crm-metrics"><article><span>Open jobs</span><strong>{openJobs.length}</strong><small>Across every stage</small></article><article><span>Next visits</span><strong>{upcomingAppointments.length}</strong><small>Scheduled from today</small></article><article className={overdueTasks.length ? "attention" : ""}><span>Overdue tasks</span><strong>{overdueTasks.length}</strong><small>Needs action</small></article><article className={outstandingCents ? "attention" : ""}><span>Outstanding</span><strong>{money(outstandingCents)}</strong><small>Invoice balance</small></article></section>
      <div className="crm-today-grid">
        <section className="crm-card"><header><div><span>Next up</span><h3>Schedule</h3></div><button type="button" onClick={() => setView("schedule")}>Open schedule</button></header>{upcomingAppointments.length ? <ol className="crm-agenda">{upcomingAppointments.slice(0, 6).map((item) => <li key={item.id}><time>{dateLabel(item.startsAt, true)}</time><button type="button" onClick={() => { setSelectedJobId(item.job.id); setView("jobs"); }}><strong>{item.title}</strong><span>{item.job.workNumber} | {item.job.title}</span></button></li>)}</ol> : <div className="crm-empty"><strong>No upcoming visits</strong><span>Add an appointment from any job.</span></div>}</section>
        <section className="crm-card"><header><div><span>Attention</span><h3>Things to clear</h3></div></header>{!overdueTasks.length && !openIssues.length ? <div className="crm-empty"><strong>You are up to date</strong><span>No overdue tasks or open issues.</span></div> : <ul className="crm-attention-list">{overdueTasks.slice(0, 4).map((item) => <li key={item.id}><span>Overdue task</span><button type="button" onClick={() => { setSelectedJobId(item.job.id); setView("jobs"); }}>{item.title}<small>{item.job.workNumber}</small></button></li>)}{openIssues.slice(0, 4).map((item) => <li key={item.id}><span>Open issue</span><button type="button" onClick={() => { setSelectedJobId(item.job.id); setView("jobs"); }}>{item.body}<small>{item.job.workNumber}</small></button></li>)}</ul>}</section>
      </div>
      <details id="crm-new-job" className="crm-create-panel"><summary>Create a new job</summary><NewJobForm customers={customers} busy={busy} onSubmit={createJob} /></details>
    </div>}

    {view === "jobs" && <div className="crm-view">
      <div className="crm-page-heading"><div><span>Job management</span><h3>Jobs</h3><p>Search by job number, title, area or one of your own customers.</p></div><details id="crm-new-job" className="crm-create-popover"><summary>+ New job</summary><NewJobForm customers={customers} busy={busy} onSubmit={createJob} /></details></div>
      <div className="crm-job-toolbar"><label><span>Search jobs</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Job number, work or customer" /></label><div role="group" aria-label="Filter jobs">{[["active", "Active"], ["attention", "Needs attention"], ["platform", "AEA protected"], ["completed", "Completed"], ["all", "All"]].map(([value, label]) => <button key={value} type="button" className={jobFilter === value ? "active" : ""} onClick={() => setJobFilter(value)}>{label}</button>)}</div></div>
      <div className="crm-jobs-layout">
        <aside className="crm-job-list" aria-label="Job results">{filteredJobs.length ? filteredJobs.map((job) => { const customer = customerById[job.crmCustomerId]; return <button type="button" key={job.id} className={selectedJobId === job.id ? "active" : ""} onClick={() => setSelectedJobId(job.id)}><span><b>{job.workNumber}</b><em>{pipelineLabels[job.pipelineStage] || job.pipelineStage}</em></span><strong>{job.title}</strong><small>{job.customerSource === "platform_private" ? "AEA protected customer" : customer?.displayName || "No customer linked"}{job.scheduledStart ? ` | ${dateLabel(job.scheduledStart)}` : ""}</small></button>; }) : <div className="crm-empty"><strong>No matching jobs</strong><span>Try another search or filter.</span></div>}</aside>
        <main className="crm-job-detail">{selectedJob ? <JobDetail key={selectedJob.id} job={selectedJob} customer={customerById[selectedJob.crmCustomerId]} customers={customers} user={user} busy={busy} teamAccess={hasTeamAccess} onCrm={crmRequest} onWorkOrder={workOrderRequest} /> : <div className="crm-empty"><strong>Select a job</strong><span>The job card will open here.</span></div>}</main>
      </div>
    </div>}

    {view === "schedule" && <div className="crm-view">
      <div className="crm-page-heading"><div><span>Appointments and field work</span><h3>Schedule</h3><p>See every booked call, visit, install and service in time order.</p></div></div>
      <section className="crm-schedule-board"><header><strong>Upcoming</strong><span>{upcomingAppointments.length} scheduled</span></header>{upcomingAppointments.length ? <ol>{upcomingAppointments.map((item) => <li key={item.id}><time><strong>{new Date(item.startsAt).toLocaleDateString("en-AU", { day: "2-digit" })}</strong><span>{new Date(item.startsAt).toLocaleDateString("en-AU", { month: "short" })}</span></time><div><span>{appointmentLabels[item.appointmentType] || item.appointmentType}</span><h4>{item.title}</h4><small>{dateLabel(item.startsAt, true)}{item.endsAt ? ` to ${new Date(item.endsAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}` : ""}</small></div><button type="button" onClick={() => { setSelectedJobId(item.job.id); setView("jobs"); }}>{item.job.workNumber}<small>{item.job.title}</small></button><button type="button" disabled={busy === `appointment:${item.id}`} onClick={() => void crmRequest("PATCH", { action: "update_appointment", appointmentId: item.id, status: "completed" }, `appointment:${item.id}`, "Appointment marked complete.")}>Complete</button></li>)}</ol> : <div className="crm-empty"><strong>No scheduled appointments</strong><span>Open a job and add its next visit.</span></div>}</section>
    </div>}

    {view === "customers" && <div className="crm-view">
      <div className="crm-page-heading"><div><span>Contacts you own</span><h3>Your customers</h3><p>Use this only for people or businesses that contacted you directly. AEA protected households never appear here.</p></div><details id="crm-new-customer" className="crm-create-popover"><summary>+ New customer</summary><CustomerForm busy={busy} onSubmit={createCustomer} /></details></div>
      <div className="crm-customers-layout"><aside className="crm-customer-list">{customers.length ? customers.map((customer) => <button key={customer.id} type="button" className={selectedCustomerId === customer.id ? "active" : ""} onClick={() => setSelectedCustomerId(customer.id)}><strong>{customer.displayName}</strong><span>{customer.customerNumber}</span><small>{customer.phone || customer.email || `${customer.suburb} ${customer.addressState}`.trim() || "Contact details not added"}</small></button>) : <div className="crm-empty"><strong>No direct customers yet</strong><span>Add customers your business already owns.</span></div>}</aside>{selectedCustomer ? <CustomerDetail key={selectedCustomer.id} customer={selectedCustomer} jobs={jobs.filter((job) => job.crmCustomerId === selectedCustomer.id)} busy={busy} onSave={crmRequest} onOpenJob={(id) => { setSelectedJobId(id); setView("jobs"); }} /> : <section className="crm-card"><div className="crm-empty"><strong>Select a customer</strong><span>The private contact record will open here.</span></div></section>}</div>
    </div>}

    {view === "reports" && <div className="crm-view">
      <div className="crm-page-heading"><div><span>Business snapshot</span><h3>Reports</h3><p>A simple operational view using the records in this workspace.</p></div></div>
      <section className="crm-metrics crm-report-metrics"><article><span>Quoted</span><strong>{money(quotedCents)}</strong><small>Current job records</small></article><article><span>Invoiced</span><strong>{money(jobs.reduce((sum, job) => sum + job.invoicedValueCents, 0))}</strong><small>Including paid invoices</small></article><article><span>Paid</span><strong>{money(paidCents)}</strong><small>Recorded receipts</small></article><article className={outstandingCents ? "attention" : ""}><span>Outstanding</span><strong>{money(outstandingCents)}</strong><small>Still to collect</small></article></section>
      <div className="crm-report-grid"><section className="crm-card"><header><div><span>Sales flow</span><h3>Jobs by stage</h3></div></header><div className="crm-pipeline-report">{Object.entries(pipelineLabels).map(([stage, label]) => { const count = jobs.filter((job) => job.pipelineStage === stage).length; return <div key={stage}><span>{label}</span><meter min="0" max={Math.max(1, jobs.length)} value={count} /><strong>{count}</strong></div>; })}</div></section><section className="crm-card"><header><div><span>Work health</span><h3>Operational checks</h3></div></header><dl className="crm-report-list"><div><dt>Open jobs</dt><dd>{openJobs.length}</dd></div><div><dt>Jobs waiting</dt><dd>{jobs.filter((job) => job.stage === "blocked").length}</dd></div><div><dt>Open issues</dt><dd>{openIssues.length}</dd></div><div><dt>Overdue tasks</dt><dd>{overdueTasks.length}</dd></div><div><dt>Completed jobs</dt><dd>{jobs.filter((job) => job.stage === "completed").length}</dd></div></dl></section></div>
    </div>}
    {view === "integrations" && <div className="crm-view"><TradeIntegrationCentre user={user} /></div>}
    {status && <p className="crm-status" role="status">{status}</p>}
  </section>;
}

function NewJobForm({ customers, busy, onSubmit }: { customers: Customer[]; busy: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className="crm-form" onSubmit={onSubmit}><div className="crm-form-grid"><label><span>Your customer, optional</span><select name="crmCustomerId"><option value="">No customer linked</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.displayName} | {customer.customerNumber}</option>)}</select><small>AEA protected leads enter automatically and cannot be linked to contact records.</small></label><label><span>Job title</span><input name="title" required maxLength={160} placeholder="Heat pump hot water installation" /></label><label><span>Work type</span><select name="serviceCategory">{Object.entries(serviceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Service area</span><input name="siteArea" maxLength={80} placeholder="Suburb or region" /></label><label><span>Priority</span><select name="priority"><option value="standard">Standard</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label><span>Customer reference</span><input name="customerReference" maxLength={100} placeholder="Purchase order or reference" /></label><label><span>Planned start</span><input type="date" name="scheduledStart" /></label><label><span>Planned finish</span><input type="date" name="scheduledEnd" /></label><label><span>Estimated value</span><input type="number" min="0" step="0.01" name="estimatedValue" placeholder="0.00" /></label><label className="wide"><span>Job description</span><textarea name="description" maxLength={3000} rows={3} placeholder="Scope, access notes and what must happen next" /></label></div><button className="btn" disabled={busy === "create-job"}>{busy === "create-job" ? "Creating..." : "Create job"}</button></form>;
}

function CustomerForm({ busy, onSubmit }: { busy: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className="crm-form" onSubmit={onSubmit}><div className="crm-form-grid"><label><span>Customer type</span><select name="customerType"><option value="residential">Residential</option><option value="business">Business</option></select></label><label><span>First name</span><input name="firstName" maxLength={80} /></label><label><span>Last name</span><input name="lastName" maxLength={80} /></label><label><span>Business name</span><input name="businessName" maxLength={140} /></label><label><span>Email</span><input type="email" name="email" maxLength={180} /></label><label><span>Phone</span><input type="tel" name="phone" maxLength={40} /></label><label className="wide"><span>Street address</span><input name="addressLine1" maxLength={140} /></label><label><span>Suburb</span><input name="suburb" maxLength={80} /></label><label><span>State</span><input name="addressState" maxLength={20} /></label><label><span>Postcode</span><input name="postcode" inputMode="numeric" maxLength={12} /></label><label><span>Tags</span><input name="tags" maxLength={300} placeholder="repeat customer, builder" /></label></div><p className="crm-form-note">Only add contacts who came directly to your business. Do not copy AEA household details into this CRM.</p><button className="btn" disabled={busy === "create-customer"}>{busy === "create-customer" ? "Adding..." : "Add customer"}</button></form>;
}

function JobDetail({ job, customer, customers, user, busy, teamAccess, onCrm, onWorkOrder }: { job: Job; customer?: Customer; customers: Customer[]; user: User; busy: string; teamAccess: boolean; onCrm: (method: "POST" | "PATCH", body: Record<string, unknown>, key: string, success: string) => Promise<boolean>; onWorkOrder: (method: "POST" | "PATCH", body: Record<string, unknown>, key: string, success: string) => Promise<boolean> }) {
  const [tab, setTab] = useState("summary");
  const isProtected = job.customerSource === "platform_private";
  const openIssues = job.notes.filter((note) => note.noteType === "issue" && note.issueStatus === "open").length;
  async function saveSummary(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); await onCrm("PATCH", { action: "update_job", workOrderId: job.id, crmCustomerId: data.get("crmCustomerId"), pipelineStage: data.get("pipelineStage"), stage: data.get("stage"), priority: data.get("priority"), description: data.get("description"), nextAction: data.get("nextAction"), customerReference: data.get("customerReference"), tags: data.get("tags") }, `job:${job.id}`, "Job summary saved."); }
  async function saveFinancials(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); await onCrm("PATCH", { action: "update_job", workOrderId: job.id, quoteStatus: data.get("quoteStatus"), invoiceStatus: data.get("invoiceStatus"), estimatedValueCents: cents(data.get("estimatedValue")), quotedValueCents: cents(data.get("quotedValue")), invoicedValueCents: cents(data.get("invoicedValue")), paidValueCents: cents(data.get("paidValue")), paymentDueAt: data.get("paymentDueAt") }, `finance:${job.id}`, "Quote and invoice summary saved."); }
  async function addTask(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); if (await onWorkOrder("POST", { action: "add_task", workOrderId: job.id, title: data.get("title"), dueAt: data.get("dueAt") }, `task:${job.id}`, "Task added.")) form.reset(); }
  async function addAppointment(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); if (await onCrm("POST", { action: "create_appointment", workOrderId: job.id, appointmentType: data.get("appointmentType"), title: data.get("title"), startsAt: data.get("startsAt"), endsAt: data.get("endsAt"), assigneeLabel: data.get("assigneeLabel"), notes: data.get("notes") }, `appointment-new:${job.id}`, "Appointment added.")) form.reset(); }
  async function addNote(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); if (await onCrm("POST", { action: "create_note", workOrderId: job.id, noteType: data.get("noteType"), body: data.get("body") }, `note:${job.id}`, "Job note added.")) form.reset(); }
  return <article className="crm-job-card"><header className="crm-job-card-header"><div><span>{job.workNumber}</span><h3>{job.title}</h3><small>{serviceLabels[job.serviceCategory] || job.serviceCategory}{job.siteArea ? ` | ${job.siteArea}` : ""}</small></div><div><strong>{pipelineLabels[job.pipelineStage] || job.pipelineStage}</strong><span className={isProtected ? "protected" : "owned"}>{isProtected ? "AEA protected" : customer ? "Your customer" : "Internal"}</span></div></header>
    <nav className="crm-job-tabs" aria-label="Job card sections">{[["summary", "Summary"], ["property", "Property"], ["schedule", `Schedule (${job.appointments.length})`], ["tasks", `Tasks (${job.tasks.filter((task) => task.status === "pending").length})`], ["finance", "Quote and invoice"], ["notes", `Notes and issues${openIssues ? ` (${openIssues})` : ""}`], ["handover", "Assets and handover"]].map(([value, label]) => <button key={value} type="button" className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{label}</button>)}</nav>
    {tab === "summary" && <form className="crm-job-section crm-form" onSubmit={saveSummary}><div className={isProtected ? "crm-customer-boundary protected" : "crm-customer-boundary owned"}><span>{isProtected ? "AEA protected customer" : "Your customer record"}</span><strong>{isProtected ? `Private reference ${job.customerReference || job.workNumber}` : customer?.displayName || "No customer linked"}</strong><p>{isProtected ? "AEA manages the household relationship. No name, phone, email or street address is provided to your business." : customer ? [customer.phone, customer.email, `${customer.addressLine1} ${customer.suburb} ${customer.addressState} ${customer.postcode}`.trim()].filter(Boolean).join(" | ") : "Link a customer who contacted your business directly, or keep this as internal work."}</p></div><div className="crm-form-grid">{!isProtected && <label><span>Your customer</span><select name="crmCustomerId" defaultValue={job.crmCustomerId}><option value="">No customer linked</option>{customers.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>}<label><span>Sales stage</span><select name="pipelineStage" defaultValue={job.pipelineStage}>{Object.entries(pipelineLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Work stage</span><select name="stage" defaultValue={job.stage}>{Object.entries(workStageLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Priority</span><select name="priority" defaultValue={job.priority}><option value="low">Low</option><option value="standard">Standard</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>{!isProtected && <label><span>Customer reference</span><input name="customerReference" defaultValue={job.customerReference} maxLength={100} /></label>}<label className="wide"><span>Next action</span><input name="nextAction" defaultValue={job.nextAction} maxLength={200} placeholder="What should happen next?" /></label><label className="wide"><span>Job description and access notes</span><textarea name="description" defaultValue={job.description} maxLength={3000} rows={4} /></label><label className="wide"><span>Tags</span><input name="tags" defaultValue={job.tags.join(", ")} maxLength={400} placeholder="heat pump, awaiting parts" /></label></div><button className="btn" disabled={busy === `job:${job.id}`}>Save summary</button></form>}
    {tab === "property" && <TradePropertyView user={user} workOrderId={job.id} isProtected={isProtected} hasDirectCustomer={Boolean(customer)} />}
    {tab === "schedule" && <section className="crm-job-section"><div className="crm-section-heading"><div><span>Appointments</span><h4>Calls, visits and installations</h4></div></div>{job.appointments.length ? <ol className="crm-job-appointments">{job.appointments.map((item) => <li key={item.id}><div><span>{appointmentLabels[item.appointmentType] || item.appointmentType}</span><strong>{item.title}</strong><small>{dateLabel(item.startsAt, true)}{item.assigneeLabel ? ` | ${item.assigneeLabel}` : ""}</small>{item.notes && <p>{item.notes}</p>}</div><button type="button" disabled={item.status !== "scheduled" || busy === `appointment:${item.id}`} onClick={() => void onCrm("PATCH", { action: "update_appointment", appointmentId: item.id, status: "completed" }, `appointment:${item.id}`, "Appointment marked complete.")}>{item.status === "scheduled" ? "Complete" : item.status.replaceAll("_", " ")}</button></li>)}</ol> : <div className="crm-empty"><strong>No appointments yet</strong><span>Add the next call, site visit or installation.</span></div>}<form className="crm-inline-form" onSubmit={addAppointment}><select name="appointmentType" aria-label="Appointment type">{Object.entries(appointmentLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><input name="title" required maxLength={160} placeholder="Appointment title" /><input type="datetime-local" name="startsAt" required aria-label="Start time" /><input type="datetime-local" name="endsAt" aria-label="Finish time" />{teamAccess && <input name="assigneeLabel" maxLength={80} placeholder="Assigned staff" />}<input name="notes" maxLength={1000} placeholder="Visit notes" /><button disabled={busy === `appointment-new:${job.id}`}>Add appointment</button></form></section>}
    {tab === "tasks" && <section className="crm-job-section"><div className="crm-section-heading"><div><span>Checklist</span><h4>What the team must complete</h4></div></div>{job.tasks.length ? <ul className="crm-task-list">{job.tasks.map((task) => <li key={task.id} className={task.status === "done" ? "done" : ""}><label><input type="checkbox" checked={task.status === "done"} disabled={busy === `task-toggle:${task.id}`} onChange={(event) => void onWorkOrder("PATCH", { action: "update_task", taskId: task.id, status: event.target.checked ? "done" : "pending" }, `task-toggle:${task.id}`, event.target.checked ? "Task completed." : "Task reopened.")} /><span>{task.title}</span></label><small>{task.dueAt ? `Due ${dateLabel(task.dueAt)}` : "No due date"}</small></li>)}</ul> : <div className="crm-empty"><strong>No tasks yet</strong><span>Add clear steps for the office or field team.</span></div>}<form className="crm-inline-form task" onSubmit={addTask}><input name="title" required maxLength={180} placeholder="Add a task" /><input type="date" name="dueAt" aria-label="Task due date" /><button disabled={busy === `task:${job.id}`}>Add task</button></form></section>}
    {tab === "finance" && <section className="crm-job-section"><form className="crm-form" onSubmit={saveFinancials}><div className="crm-section-heading"><div><span>Financial progress</span><h4>Quote and invoice summary</h4><p>Record the agreed totals, then create a secure online payment link for your direct customer.</p></div></div><div className="crm-finance-summary"><article><span>Estimate</span><strong>{money(job.estimatedValueCents)}</strong></article><article><span>Quoted</span><strong>{money(job.quotedValueCents)}</strong></article><article><span>Invoiced</span><strong>{money(job.invoicedValueCents)}</strong></article><article><span>Paid</span><strong>{money(job.paidValueCents)}</strong></article></div><div className="crm-form-grid"><label><span>Estimate amount</span><input type="number" name="estimatedValue" min="0" step="0.01" defaultValue={(job.estimatedValueCents / 100).toFixed(2)} /></label><label><span>Quote amount</span><input type="number" name="quotedValue" min="0" step="0.01" defaultValue={(job.quotedValueCents / 100).toFixed(2)} /></label><label><span>Quote status</span><select name="quoteStatus" defaultValue={job.quoteStatus}><option value="not_started">Not started</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="accepted">Accepted</option><option value="declined">Declined</option></select></label><label><span>Invoice amount</span><input type="number" name="invoicedValue" min="0" step="0.01" defaultValue={(job.invoicedValueCents / 100).toFixed(2)} /></label><label><span>Amount paid</span><input type="number" name="paidValue" min="0" step="0.01" defaultValue={(job.paidValueCents / 100).toFixed(2)} /></label><label><span>Invoice status</span><select name="invoiceStatus" defaultValue={job.invoiceStatus}><option value="not_started">Not started</option><option value="draft">Draft</option><option value="issued">Issued</option><option value="part_paid">Part paid</option><option value="paid">Paid</option><option value="overdue">Overdue</option><option value="void">Void</option></select></label><label><span>Payment due</span><input type="date" name="paymentDueAt" defaultValue={job.paymentDueAt} /></label></div><button className="btn" disabled={busy === `finance:${job.id}`}>Save financial progress</button></form><TradePaymentPanel user={user} workOrderId={job.id} isProtected={isProtected} suggestedAmountCents={Math.max(0, job.invoicedValueCents - job.paidValueCents) || job.invoicedValueCents} /></section>}
    {tab === "notes" && <section className="crm-job-section"><div className="crm-section-heading"><div><span>Internal history</span><h4>Notes and issues</h4><p>These records are private to your business and are not sent to the customer.</p></div></div><form className="crm-inline-form note" onSubmit={addNote}><select name="noteType"><option value="internal">Internal note</option><option value="issue">Issue to resolve</option></select><textarea name="body" required maxLength={4000} rows={3} placeholder="Record a decision, update or problem" /><button disabled={busy === `note:${job.id}`}>Add record</button></form>{job.notes.length ? <ol className="crm-notes-list">{job.notes.map((note) => <li key={note.id} className={note.noteType === "issue" ? `issue ${note.issueStatus}` : ""}><div><span>{note.noteType === "issue" ? `Issue | ${note.issueStatus}` : "Internal note"}</span><p>{note.body}</p><small>{dateLabel(note.createdAt, true)}</small></div>{note.noteType === "issue" && <button type="button" disabled={busy === `issue:${note.id}`} onClick={() => void onCrm("PATCH", { action: "resolve_issue", noteId: note.id, issueStatus: note.issueStatus === "open" ? "resolved" : "open" }, `issue:${note.id}`, note.issueStatus === "open" ? "Issue resolved." : "Issue reopened.")}>{note.issueStatus === "open" ? "Resolve" : "Reopen"}</button>}</li>)}</ol> : <div className="crm-empty"><strong>No internal history yet</strong><span>Add notes as the job develops.</span></div>}</section>}
    {tab === "handover" && <section className="crm-job-section"><div className="crm-section-heading"><div><span>Completion records</span><h4>Installed products, documents and care</h4><p>Publish approved product and warranty records into the customer&apos;s free home account.</p></div></div><TradeHandoverCentre user={user} workOrderId={job.id} fullAccess /></section>}
  </article>;
}

function CustomerDetail({ customer, jobs, busy, onSave, onOpenJob }: { customer: Customer; jobs: Job[]; busy: string; onSave: (method: "POST" | "PATCH", body: Record<string, unknown>, key: string, success: string) => Promise<boolean>; onOpenJob: (id: string) => void }) {
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); await onSave("PATCH", { action: "update_customer", customerId: customer.id, firstName: data.get("firstName"), lastName: data.get("lastName"), businessName: data.get("businessName"), email: data.get("email"), phone: data.get("phone"), addressLine1: data.get("addressLine1"), addressLine2: data.get("addressLine2"), suburb: data.get("suburb"), addressState: data.get("addressState"), postcode: data.get("postcode"), tags: data.get("tags"), privateNotes: data.get("privateNotes") }, `customer:${customer.id}`, "Customer record saved."); }
  return <section className="crm-customer-detail"><header><div><span>{customer.customerNumber}</span><h3>{customer.displayName}</h3><small>{customer.customerType === "business" ? "Business customer" : "Residential customer"}</small></div><strong>Private installer record</strong></header><form className="crm-form" onSubmit={save}><div className="crm-form-grid"><label><span>First name</span><input name="firstName" defaultValue={customer.firstName} /></label><label><span>Last name</span><input name="lastName" defaultValue={customer.lastName} /></label><label><span>Business name</span><input name="businessName" defaultValue={customer.businessName} /></label><label><span>Email</span><input type="email" name="email" defaultValue={customer.email} /></label><label><span>Phone</span><input type="tel" name="phone" defaultValue={customer.phone} /></label><label className="wide"><span>Street address</span><input name="addressLine1" defaultValue={customer.addressLine1} /></label><label className="wide"><span>Address line 2</span><input name="addressLine2" defaultValue={customer.addressLine2} /></label><label><span>Suburb</span><input name="suburb" defaultValue={customer.suburb} /></label><label><span>State</span><input name="addressState" defaultValue={customer.addressState} /></label><label><span>Postcode</span><input name="postcode" defaultValue={customer.postcode} /></label><label className="wide"><span>Tags</span><input name="tags" defaultValue={customer.tags.join(", ")} /></label><label className="wide"><span>Private notes</span><textarea name="privateNotes" defaultValue={customer.privateNotes} rows={4} /></label></div><button className="btn" disabled={busy === `customer:${customer.id}`}>Save customer</button></form><section className="crm-customer-jobs"><h4>Jobs for this customer</h4>{jobs.length ? jobs.map((job) => <button type="button" key={job.id} onClick={() => onOpenJob(job.id)}><span>{job.workNumber}</span><strong>{job.title}</strong><small>{pipelineLabels[job.pipelineStage] || job.pipelineStage}</small></button>) : <p>No jobs linked yet.</p>}</section></section>;
}
