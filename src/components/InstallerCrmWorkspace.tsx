"use client";

import { FormEvent, useCallback, useEffect, useId, useState } from "react";
import type { User } from "firebase/auth";
import { TradeAccountingPanel } from "./TradeAccountingPanel";
import { TradeHandoverCentre } from "./TradeHandoverCentre";
import { TradeIntegrationCentre } from "./TradeIntegrationCentre";
import { TradePaymentPanel } from "./TradePaymentPanel";
import { TradeFieldWorkPanel } from "./TradeFieldWorkPanel";
import { TradeTeamCentre } from "./TradeTeamCentre";
import { TradeJobFormsPanel } from "./TradeJobFormsPanel";
import { TradeDataImportWorkspace } from "./TradeDataImportWorkspace";
import type { TLinkCommandTarget } from "./TLinkCommandCentre";
import { WorkspaceListControls, WorkspaceListPreferences } from "./WorkspaceListControls";

type Customer = {
  id: string; customerNumber: string; customerType: string; displayName: string; firstName: string;
  lastName: string; businessName: string; email: string; phone: string; addressLine1: string;
  addressLine2: string; suburb: string; addressState: string; postcode: string; tags: string[];
  privateNotes: string; jobCount?: number; activeJobCount?: number; createdAt: string; updatedAt: string;
};
type Task = { id: string; title: string; dueAt: string; status: "pending" | "done"; completedAt: string };
type Appointment = { id: string; appointmentType: string; title: string; startsAt: string; endsAt: string; assigneeLabel: string; status: string; notes: string };
type Note = { id: string; noteType: "internal" | "issue"; body: string; issueStatus: string; createdAt: string; updatedAt: string };
type JobTemplate = {
  id: string; name: string; title: string; serviceCategory: string; priority: string;
  description: string; taskTitles: string[]; createdAt: string; updatedAt: string;
};
type Job = {
  id: string; workNumber: string; title: string; serviceCategory: string; siteArea: string; stage: string;
  priority: string; scheduledStart: string; scheduledEnd: string; assigneeLabel: string; sourceType: string;
  customerSource: "trade_owned" | "platform_private" | "internal"; crmCustomerId: string; pipelineStage: string;
  description: string; customerReference: string; nextAction: string; tags: string[]; estimatedValueCents: number;
  quotedValueCents: number; invoicedValueCents: number; paidValueCents: number; quoteStatus: string;
  invoiceStatus: string; paymentDueAt: string; handoverStatus: string; tasks: Task[];
  appointments: Appointment[]; notes: Note[]; customerDisplayName?: string; createdAt: string; updatedAt: string;
};
type CrmResult = { ok?: boolean; customers?: Customer[]; jobs?: Job[]; templates?: JobTemplate[]; teamAccess?: boolean; error?: string };
type IndexPagination = { page: number; pageSize: number; total: number; pageCount: number };
type CrmIndexResult = { ok?: boolean; items?: Job[] | Customer[]; pagination?: IndexPagination; error?: string };
type CrmDetailResult = { ok?: boolean; job?: Job; customer?: Customer | null; jobs?: Job[]; error?: string };
type ActivityJob = { id: string; workNumber: string; title: string };
type ActivityAppointment = Appointment & { job: ActivityJob };
type ActivityTask = Task & { job: ActivityJob };
type ActivityNote = Note & { job: ActivityJob };
type CrmMetrics = {
  openJobs: number; nextVisits: number; overdueTasks: number; openIssues: number; waitingJobs: number;
  completedJobs: number; quotedCents: number; invoicedCents: number; paidCents: number; outstandingCents: number;
};
type CrmSummaryResult = { ok?: boolean; metrics?: CrmMetrics; upcomingAppointments?: ActivityAppointment[]; overdueTasks?: ActivityTask[]; openIssues?: ActivityNote[]; error?: string };
type CrmScheduleResult = { ok?: boolean; items?: ActivityAppointment[]; pagination?: IndexPagination; error?: string };
type CrmReportResult = { ok?: boolean; metrics?: CrmMetrics; pipeline?: Record<string, number>; error?: string };
type View = "today" | "jobs" | "schedule" | "customers" | "templates" | "reports" | "import" | "integrations" | "team";

const serviceLabels: Record<string, string> = {
  assessment: "Energy assessment", solar: "Rooftop solar", battery: "Home batteries",
  "heating-cooling": "Heating and cooling", "hot-water": "Hot water",
  "insulation-draughts": "Insulation and draught control", "ev-charging": "EV charging",
  electrical: "Electrical services", plumbing: "Plumbing services",
  "mounting-hardware": "Mounting and hardware", controls: "Energy controls", other: "Other work",
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

export function InstallerCrmWorkspace({ user, teamAccess, navigationTarget }: { user: User; teamAccess: boolean; navigationTarget?: TLinkCommandTarget | null }) {
  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const [hasTeamAccess, setHasTeamAccess] = useState(teamAccess);
  const [view, setView] = useState<View>("today");
  const [creating, setCreating] = useState<"" | "job" | "customer">("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [jobFilter, setJobFilter] = useState("active");
  const [jobLayout, setJobLayout] = useState<"list" | "board">("list");
  const [pipelineFocus, setPipelineFocus] = useState("");
  const [search, setSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [jobPage, setJobPage] = useState(1);
  const [jobPageSize, setJobPageSize] = useState(25);
  const [customerPage, setCustomerPage] = useState(1);
  const [customerPageSize, setCustomerPageSize] = useState(25);
  const [jobSort, setJobSort] = useState("updated-desc");
  const [customerSort, setCustomerSort] = useState("name-asc");
  const [indexedJobs, setIndexedJobs] = useState<Job[]>([]);
  const [indexedCustomers, setIndexedCustomers] = useState<Customer[]>([]);
  const [jobPagination, setJobPagination] = useState<IndexPagination>({ page: 1, pageSize: 25, total: 0, pageCount: 1 });
  const [customerPagination, setCustomerPagination] = useState<IndexPagination>({ page: 1, pageSize: 25, total: 0, pageCount: 1 });
  const [summary, setSummary] = useState<CrmSummaryResult>({});
  const [scheduleItems, setScheduleItems] = useState<ActivityAppointment[]>([]);
  const [schedulePage, setSchedulePage] = useState(1);
  const [schedulePageSize, setSchedulePageSize] = useState(25);
  const [schedulePagination, setSchedulePagination] = useState<IndexPagination>({ page: 1, pageSize: 25, total: 0, pageCount: 1 });
  const [report, setReport] = useState<CrmReportResult>({});
  const [boardJobs, setBoardJobs] = useState<Record<string, Job[]>>({});
  const [boardCounts, setBoardCounts] = useState<Record<string, number>>({});
  const [selectedJobDetail, setSelectedJobDetail] = useState<Job | null>(null);
  const [selectedJobCustomer, setSelectedJobCustomer] = useState<Customer | null>(null);
  const [selectedCustomerDetail, setSelectedCustomerDetail] = useState<Customer | null>(null);
  const [selectedCustomerJobs, setSelectedCustomerJobs] = useState<Job[]>([]);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [bulkPriority, setBulkPriority] = useState("standard");
  const [indexLoading, setIndexLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [jobViewSaved, setJobViewSaved] = useState(false);
  const [customerViewSaved, setCustomerViewSaved] = useState(false);
  const [viewBusy, setViewBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const token = await user.getIdToken();
    const response = await fetch("/api/trade-crm?mode=bootstrap", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as CrmResult;
    if (!response.ok || !result.ok) throw new Error(result.error || "The installer CRM could not be loaded.");
    setTemplates(result.templates || []);
    if (typeof result.teamAccess === "boolean") setHasTeamAccess(result.teamAccess);
  }, [user]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void load().catch((error) => active && setStatus(error instanceof Error ? error.message : "The installer CRM could not be loaded."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [load]);

  useEffect(() => {
    let active = true;
    void user.getIdToken().then(async (token) => {
      const headers = { Authorization: `Bearer ${token}` };
      const [jobsResponse, customersResponse] = await Promise.all([
        fetch("/api/trade-list-views?view=installer-jobs", { headers, cache: "no-store" }),
        fetch("/api/trade-list-views?view=installer-customers", { headers, cache: "no-store" }),
      ]);
      const [jobsResult, customersResult] = await Promise.all([jobsResponse.json(), customersResponse.json()]);
      if (!active) return;
      if (jobsResult.ok) {
        const preferences = (jobsResult.preferences || {}) as Partial<WorkspaceListPreferences>;
        setSearch(preferences.search || ""); setJobFilter(preferences.filter || "active");
        setJobSort(preferences.sort || "updated-desc"); setJobPageSize(Number(preferences.pageSize) || 25); setJobViewSaved(Boolean(jobsResult.saved));
      }
      if (customersResult.ok) {
        const preferences = (customersResult.preferences || {}) as Partial<WorkspaceListPreferences>;
        setCustomerSearch(preferences.search || ""); setCustomerSort(preferences.sort || "name-asc"); setCustomerPageSize(Number(preferences.pageSize) || 25);
        setCustomerViewSaved(Boolean(customersResult.saved));
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [user]);

  const loadJobIndex = useCallback(async () => {
    const token = await user.getIdToken();
    const params = new URLSearchParams({ mode: "index", resource: "jobs", search, filter: jobFilter, sort: jobSort, page: String(jobPage), pageSize: String(jobPageSize) });
    if (pipelineFocus) params.set("pipeline", pipelineFocus);
    const response = await fetch(`/api/trade-crm?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as CrmIndexResult;
    if (!response.ok || !result.ok) throw new Error(result.error || "The job list could not be loaded.");
    const items = (result.items || []) as Job[];
    setIndexedJobs(items);
    setJobPagination(result.pagination || { page: jobPage, pageSize: jobPageSize, total: items.length, pageCount: 1 });
    setSelectedJobId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id || "");
  }, [jobFilter, jobPage, jobPageSize, jobSort, pipelineFocus, search, user]);

  const loadCustomerIndex = useCallback(async () => {
    const token = await user.getIdToken();
    const params = new URLSearchParams({ mode: "index", resource: "customers", search: customerSearch, sort: customerSort, page: String(customerPage), pageSize: String(customerPageSize) });
    const response = await fetch(`/api/trade-crm?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as CrmIndexResult;
    if (!response.ok || !result.ok) throw new Error(result.error || "The customer list could not be loaded.");
    const items = (result.items || []) as Customer[];
    setIndexedCustomers(items);
    setCustomerPagination(result.pagination || { page: customerPage, pageSize: customerPageSize, total: items.length, pageCount: 1 });
    setSelectedCustomerId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id || "");
  }, [customerPage, customerPageSize, customerSearch, customerSort, user]);

  useEffect(() => {
    if (view !== "jobs" || creating === "job" || jobLayout !== "list") return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) setIndexLoading(true);
      void loadJobIndex().catch((error) => active && setStatus(error instanceof Error ? error.message : "The job list could not be loaded."))
        .finally(() => active && setIndexLoading(false));
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [creating, jobLayout, loadJobIndex, refreshNonce, view]);

  useEffect(() => {
    if (view !== "customers" || creating === "customer") return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) setIndexLoading(true);
      void loadCustomerIndex().catch((error) => active && setStatus(error instanceof Error ? error.message : "The customer list could not be loaded."))
        .finally(() => active && setIndexLoading(false));
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [creating, loadCustomerIndex, refreshNonce, view]);

  useEffect(() => {
    if (view !== "jobs" || !selectedJobId || jobLayout !== "list") return;
    let active = true;
    void user.getIdToken().then((token) => fetch(`/api/trade-crm?mode=detail&resource=job&id=${encodeURIComponent(selectedJobId)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    })).then(async (response) => {
      const result = await response.json().catch(() => ({})) as CrmDetailResult;
      if (!response.ok || !result.ok || !result.job) throw new Error(result.error || "The job record could not be loaded.");
      if (active) { setSelectedJobDetail(result.job); setSelectedJobCustomer(result.customer || null); }
    }).catch((error) => active && setStatus(error instanceof Error ? error.message : "The job record could not be loaded."));
    return () => { active = false; };
  }, [jobLayout, refreshNonce, selectedJobId, user, view]);

  useEffect(() => {
    if (view !== "customers" || !selectedCustomerId) return;
    let active = true;
    void user.getIdToken().then((token) => fetch(`/api/trade-crm?mode=detail&resource=customer&id=${encodeURIComponent(selectedCustomerId)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    })).then(async (response) => {
      const result = await response.json().catch(() => ({})) as CrmDetailResult;
      if (!response.ok || !result.ok || !result.customer) throw new Error(result.error || "The customer record could not be loaded.");
      if (active) { setSelectedCustomerDetail(result.customer); setSelectedCustomerJobs(result.jobs || []); }
    }).catch((error) => active && setStatus(error instanceof Error ? error.message : "The customer record could not be loaded."));
    return () => { active = false; };
  }, [refreshNonce, selectedCustomerId, user, view]);

  useEffect(() => {
    if (view !== "today") return;
    let active = true;
    void user.getIdToken().then((token) => fetch("/api/trade-crm?mode=summary", {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    })).then(async (response) => {
      const result = await response.json().catch(() => ({})) as CrmSummaryResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "The workday summary could not be loaded.");
      if (active) setSummary(result);
    }).catch((error) => active && setStatus(error instanceof Error ? error.message : "The workday summary could not be loaded."));
    return () => { active = false; };
  }, [refreshNonce, user, view]);

  useEffect(() => {
    if (view !== "schedule") return;
    let active = true;
    const params = new URLSearchParams({ mode: "schedule", page: String(schedulePage), pageSize: String(schedulePageSize) });
    void user.getIdToken().then((token) => fetch(`/api/trade-crm?${params}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    })).then(async (response) => {
      const result = await response.json().catch(() => ({})) as CrmScheduleResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "The schedule could not be loaded.");
      if (active) { setScheduleItems(result.items || []); setSchedulePagination(result.pagination || { page: schedulePage, pageSize: schedulePageSize, total: 0, pageCount: 1 }); }
    }).catch((error) => active && setStatus(error instanceof Error ? error.message : "The schedule could not be loaded."));
    return () => { active = false; };
  }, [refreshNonce, schedulePage, schedulePageSize, user, view]);

  useEffect(() => {
    if (view !== "reports") return;
    let active = true;
    void user.getIdToken().then((token) => fetch("/api/trade-crm?mode=reports", {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    })).then(async (response) => {
      const result = await response.json().catch(() => ({})) as CrmReportResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "The business report could not be loaded.");
      if (active) setReport(result);
    }).catch((error) => active && setStatus(error instanceof Error ? error.message : "The business report could not be loaded."));
    return () => { active = false; };
  }, [refreshNonce, user, view]);

  useEffect(() => {
    if (view !== "jobs" || jobLayout !== "board") return;
    let active = true;
    const stages = ["enquiry", "qualifying", "quoting", "approved", "scheduled", "in_progress"];
    void user.getIdToken().then(async (token) => {
      const results = await Promise.all(stages.map(async (stage) => {
        const params = new URLSearchParams({ mode: "index", resource: "jobs", filter: "all", pipeline: stage, sort: "updated-desc", page: "1", pageSize: "25" });
        const response = await fetch(`/api/trade-crm?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const result = await response.json().catch(() => ({})) as CrmIndexResult;
        if (!response.ok || !result.ok) throw new Error(result.error || "The job board could not be loaded.");
        return [stage, (result.items || []) as Job[], result.pagination?.total || 0] as const;
      }));
      if (active) {
        setBoardJobs(Object.fromEntries(results.map(([stage, items]) => [stage, items])));
        setBoardCounts(Object.fromEntries(results.map(([stage, , total]) => [stage, total])));
      }
    }).catch((error) => active && setStatus(error instanceof Error ? error.message : "The job board could not be loaded."));
    return () => { active = false; };
  }, [jobLayout, refreshNonce, user, view]);

  useEffect(() => {
    if (!navigationTarget) return;
    const frame = window.requestAnimationFrame(() => {
      if (navigationTarget.kind === "job") {
        setCreating("");
        setSearch("");
        setSelectedJobId(navigationTarget.id);
        setView("jobs");
      } else if (navigationTarget.kind === "customer") {
        setCreating("");
        setSelectedCustomerId(navigationTarget.id);
        setView("customers");
      } else if (navigationTarget.kind === "team" && teamAccess) {
        setView("team");
      } else if (navigationTarget.kind === "new-job") {
        setView("jobs");
        setCreating("job");
      } else if (navigationTarget.kind === "new-customer") {
        setView("customers");
        setCreating("customer");
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [navigationTarget, teamAccess]);

  async function crmRequest(method: "POST" | "PATCH", body: Record<string, unknown>, busyKey: string, success: string) {
    setBusy(busyKey); setStatus("Saving your private business record...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-crm", {
        method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "The CRM update could not be saved.");
      await load(); setRefreshNonce((value) => value + 1); setStatus(success); return true;
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
      setRefreshNonce((value) => value + 1); setStatus(success); return true;
    } catch (error) { setStatus(error instanceof Error ? error.message : "The checklist could not be saved."); return false; }
    finally { setBusy(""); }
  }

  async function bulkRequest(body: Record<string, unknown>, busyKey: string, success: string) {
    setBusy(busyKey); setStatus("Updating the selected records...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-crm", {
        method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "The selected records could not be updated.");
      setSelectedJobIds([]); setSelectedCustomerIds([]); setRefreshNonce((value) => value + 1); setStatus(success);
    } catch (error) { setStatus(error instanceof Error ? error.message : "The selected records could not be updated."); }
    finally { setBusy(""); }
  }

  const metrics: CrmMetrics = summary.metrics || { openJobs: 0, nextVisits: 0, overdueTasks: 0, openIssues: 0, waitingJobs: 0, completedJobs: 0, quotedCents: 0, invoicedCents: 0, paidCents: 0, outstandingCents: 0 };
  const upcomingAppointments = summary.upcomingAppointments || [];
  const overdueTasks = summary.overdueTasks || [];
  const openIssues = summary.openIssues || [];
  const reportMetrics = report.metrics || metrics;
  const pipelineCounts = report.pipeline || {};
  const pipelineTotal = Object.values(pipelineCounts).reduce((total, count) => total + count, 0);
  async function updateListView(viewKey: "installer-jobs" | "installer-customers", method: "PATCH" | "DELETE") {
    setViewBusy(true);
    try {
      const token = await user.getIdToken();
      const body = viewKey === "installer-jobs"
        ? { search, filter: jobFilter, sort: jobSort, pageSize: jobPageSize }
        : { search: customerSearch, filter: "all", sort: customerSort, pageSize: customerPageSize };
      const response = await fetch(`/api/trade-list-views?view=${viewKey}`, {
        method, headers: { Authorization: `Bearer ${token}`, ...(method === "PATCH" ? { "Content-Type": "application/json" } : {}) },
        body: method === "PATCH" ? JSON.stringify(body) : undefined,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "The default list view could not be saved.");
      const preferences = (result.preferences || {}) as Partial<WorkspaceListPreferences>;
      if (viewKey === "installer-jobs") {
        if (method === "DELETE") { setSearch(preferences.search || ""); setJobFilter(preferences.filter || "active"); setJobSort(preferences.sort || "updated-desc"); setJobPageSize(Number(preferences.pageSize) || 25); setJobPage(1); }
        setJobViewSaved(method === "PATCH");
      } else {
        if (method === "DELETE") { setCustomerSearch(preferences.search || ""); setCustomerSort(preferences.sort || "name-asc"); setCustomerPageSize(Number(preferences.pageSize) || 25); setCustomerPage(1); }
        setCustomerViewSaved(method === "PATCH");
      }
      setStatus(method === "PATCH" ? "Default list view saved." : "Default list view reset.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The default list view could not be saved."); }
    finally { setViewBusy(false); }
  }

  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const saved = await crmRequest("POST", {
      action: "create_customer", customerType: data.get("customerType"), firstName: data.get("firstName"),
      lastName: data.get("lastName"), businessName: data.get("businessName"), email: data.get("email"),
      phone: data.get("phone"), addressLine1: data.get("addressLine1"), addressLine2: data.get("addressLine2"), suburb: data.get("suburb"),
      addressState: data.get("addressState"), postcode: data.get("postcode"), tags: data.get("tags"),
    }, "create-customer", "Customer added to your private CRM.");
    if (saved) { form.reset(); setCreating(""); setView("customers"); }
  }

  async function createJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const saved = await crmRequest("POST", {
      action: "create_job", crmCustomerId: data.get("crmCustomerId"), title: data.get("title"),
      templateId: data.get("templateId"),
      serviceCategory: data.get("serviceCategory"), siteArea: data.get("siteArea"), priority: data.get("priority"),
      scheduledStart: data.get("scheduledStart"), scheduledEnd: data.get("scheduledEnd"),
      description: data.get("description"),
      estimatedValueCents: cents(data.get("estimatedValue")),
    }, "create-job", "Job created in your private CRM.");
    if (saved) { form.reset(); setCreating(""); setView("jobs"); }
  }

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const saved = await crmRequest("POST", {
      action: "create_template", name: data.get("name"), title: data.get("title"),
      serviceCategory: data.get("serviceCategory"), priority: data.get("priority"),
      description: data.get("description"), taskTitles: data.get("taskTitles"),
    }, "create-template", "Reusable job template saved.");
    if (saved) form.reset();
  }

  if (loading) return <section className="crm-loading"><span /><div><strong>Opening your business workspace</strong><p>Loading your settings and workspace tools...</p></div></section>;

  return <section id="business-hub" className="installer-crm" aria-labelledby="installer-crm-title">
    <header className="crm-hero">
      <div><span>Installer business workspace</span><h2 id="installer-crm-title">Run the day from one clear place</h2><p>Manage your own customers, jobs, visits, tasks, issues, quotes, invoices and handovers. AEA customer identities remain protected.</p></div>
      <div className="crm-primary-actions"><details className="crm-quick-create"><summary>New</summary><div><button type="button" onClick={() => { setView("jobs"); setCreating("job"); }}>Job</button><button type="button" onClick={() => { setView("customers"); setCreating("customer"); }}>Customer</button></div></details></div>
    </header>
    <nav className="crm-nav" aria-label="Installer CRM">
      {(["today", "jobs", "schedule", "customers"] as View[]).map((item) => <button key={item} type="button" className={view === item ? "active" : ""} onClick={() => setView(item)}>{item === "today" ? "My day" : item[0].toUpperCase() + item.slice(1)}</button>)}
      <details className="crm-more-nav"><summary className={["templates", "reports", "import", "integrations", "team"].includes(view) ? "active" : ""}>{["templates", "reports", "import", "integrations", "team"].includes(view) ? view[0].toUpperCase() + view.slice(1) : "More"}</summary><div>{(["templates", "reports", "import", "integrations", ...(hasTeamAccess ? ["team" as View] : [])] as View[]).map((item) => <button key={item} type="button" className={view === item ? "active" : ""} onClick={(event) => { setView(item); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{item === "import" ? "Import data" : item[0].toUpperCase() + item.slice(1)}</button>)}</div></details>
    </nav>
    <div className="crm-privacy-line"><strong>Clear privacy boundary</strong><span><b>AEA protected:</b> reference and region only</span><span><b>Your customer:</b> contacts your business already owns</span></div>

    {view === "today" && <div className="crm-view crm-today">
      <section className="crm-metrics"><article><span>Open jobs</span><strong>{metrics.openJobs}</strong><small>Across every stage</small></article><article><span>Next visits</span><strong>{metrics.nextVisits}</strong><small>Scheduled from today</small></article><article className={metrics.overdueTasks ? "attention" : ""}><span>Overdue tasks</span><strong>{metrics.overdueTasks}</strong><small>Needs action</small></article><article className={metrics.outstandingCents ? "attention" : ""}><span>Outstanding</span><strong>{money(metrics.outstandingCents)}</strong><small>Invoice balance</small></article></section>
      <div className="crm-today-grid">
        <section className="crm-card"><header><div><span>Next up</span><h3>Schedule</h3></div><button type="button" onClick={() => setView("schedule")}>Open schedule</button></header>{upcomingAppointments.length ? <ol className="crm-agenda">{upcomingAppointments.slice(0, 6).map((item) => <li key={item.id}><time>{dateLabel(item.startsAt, true)}</time><button type="button" onClick={() => { setSearch(item.job.workNumber); setJobPage(1); setSelectedJobId(item.job.id); setView("jobs"); }}><strong>{item.title}</strong><span>{item.job.workNumber} | {item.job.title}</span></button></li>)}</ol> : <div className="crm-empty"><strong>No upcoming visits</strong><span>Add an appointment from any job.</span></div>}</section>
        <section className="crm-card"><header><div><span>Attention</span><h3>Things to clear</h3></div></header>{!overdueTasks.length && !openIssues.length ? <div className="crm-empty"><strong>You are up to date</strong><span>No overdue tasks or open issues.</span></div> : <ul className="crm-attention-list">{overdueTasks.slice(0, 4).map((item) => <li key={item.id}><span>Overdue task</span><button type="button" onClick={() => { setSearch(item.job.workNumber); setJobPage(1); setSelectedJobId(item.job.id); setView("jobs"); }}>{item.title}<small>{item.job.workNumber}</small></button></li>)}{openIssues.slice(0, 4).map((item) => <li key={item.id}><span>Open issue</span><button type="button" onClick={() => { setSearch(item.job.workNumber); setJobPage(1); setSelectedJobId(item.job.id); setView("jobs"); }}>{item.body}<small>{item.job.workNumber}</small></button></li>)}</ul>}</section>
      </div>
      <div className="crm-today-action"><button type="button" onClick={() => { setView("jobs"); setCreating("job"); }}>Create a job</button><span>The job number is assigned automatically.</span></div>
    </div>}

    {view === "jobs" && creating === "job" && <div className="crm-view crm-create-screen">
      <div className="crm-page-heading"><div><span>New job</span><h3>Create a clear work record</h3><p>Only the essentials are needed now. The system assigns the next chronological job ID after saving.</p></div><button type="button" className="crm-back-button" onClick={() => setCreating("")}>Back to jobs</button></div>
      <section className="crm-create-card"><div className="crm-create-guidance"><strong>Before you start</strong><p>Choose a direct customer if they already belong to your business. AEA protected work enters from the Leads area automatically and never exposes household details.</p></div><NewJobForm user={user} templates={templates} busy={busy} onSubmit={createJob} /></section>
    </div>}

    {view === "jobs" && creating !== "job" && <div className="crm-view">
      <div className="crm-page-heading"><div><span>Job management</span><h3>Jobs</h3><p>Search by job ID, title, area or one of your own customers.</p></div><button type="button" className="crm-new-button" onClick={() => setCreating("job")}>New job</button></div>
      <div className="crm-job-toolbar"><label><span>Search jobs</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setJobPage(1); setSelectedJobIds([]); }} placeholder="Job number, work or customer" /></label><div role="group" aria-label="Filter jobs">{[["active", "Active"], ["attention", "Needs attention"], ["platform", "AEA protected"], ["completed", "Completed"], ["all", "All"]].map(([value, label]) => <button key={value} type="button" className={jobFilter === value ? "active" : ""} onClick={() => { setJobFilter(value); setPipelineFocus(""); setJobPage(1); setSelectedJobIds([]); }}>{label}</button>)}</div><label className="crm-index-sort"><span>Sort jobs</span><select value={jobSort} onChange={(event) => { setJobSort(event.target.value); setJobPage(1); setSelectedJobIds([]); }}><option value="updated-desc">Recently updated</option><option value="number-asc">Job ID A to Z</option><option value="number-desc">Job ID Z to A</option><option value="date-asc">Scheduled first</option></select></label><div className="crm-layout-toggle" role="group" aria-label="Job layout"><button type="button" className={jobLayout === "list" ? "active" : ""} onClick={() => setJobLayout("list")}>List</button><button type="button" className={jobLayout === "board" ? "active" : ""} onClick={() => { setPipelineFocus(""); setJobLayout("board"); }}>Board</button></div></div>
      {pipelineFocus && <div className="crm-filter-notice"><span>Showing {pipelineLabels[pipelineFocus] || pipelineFocus}</span><button type="button" onClick={() => setPipelineFocus("")}>Clear stage</button></div>}
      {jobLayout === "list" && <WorkspaceListControls page={jobPagination.page} pageCount={jobPagination.pageCount} pageSize={jobPagination.pageSize} total={jobPagination.total} saved={jobViewSaved} busy={viewBusy || indexLoading}
        onPage={(page) => { setJobPage(page); setSelectedJobIds([]); }} onPageSize={(size) => { setJobPageSize(size); setJobPage(1); setSelectedJobIds([]); }} onSave={() => void updateListView("installer-jobs", "PATCH")} onReset={() => void updateListView("installer-jobs", "DELETE")} />}
      {jobLayout === "list" && selectedJobIds.length > 0 && <div className="crm-bulk-actions" role="region" aria-label="Selected job actions"><strong>{selectedJobIds.length} job{selectedJobIds.length === 1 ? "" : "s"} selected</strong><label><span>Set priority</span><select value={bulkPriority} onChange={(event) => setBulkPriority(event.target.value)}><option value="low">Low</option><option value="standard">Standard</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><button type="button" disabled={busy === "bulk-job-priority"} onClick={() => void bulkRequest({ action: "bulk_set_job_priority", ids: selectedJobIds, priority: bulkPriority }, "bulk-job-priority", "Selected job priorities updated.")}>{busy === "bulk-job-priority" ? "Updating..." : "Apply priority"}</button><button type="button" className="secondary" onClick={() => setSelectedJobIds([])}>Clear</button></div>}
      {jobLayout === "list" ? <div className="crm-jobs-layout">
        <aside className="crm-job-list" aria-label="Job results">{indexedJobs.length ? indexedJobs.map((job) => <article key={job.id} className={selectedJobId === job.id ? "active" : ""}><label className="crm-row-select"><input type="checkbox" checked={selectedJobIds.includes(job.id)} onChange={(event) => setSelectedJobIds((current) => event.target.checked ? [...current, job.id] : current.filter((id) => id !== job.id))} /><span className="sr-only">Select {job.workNumber}</span></label><button type="button" className="crm-row-open" onClick={() => setSelectedJobId(job.id)}><span><b>{job.workNumber}</b><em>{pipelineLabels[job.pipelineStage] || job.pipelineStage}</em></span><strong>{job.title}</strong><small>{job.customerDisplayName || "No customer linked"}{job.scheduledStart ? ` | ${dateLabel(job.scheduledStart)}` : ""}</small></button></article>) : <div className="crm-empty"><strong>{indexLoading ? "Loading jobs..." : "No matching jobs"}</strong><span>{indexLoading ? "Fetching this page securely." : "Try another search or filter."}</span></div>}</aside>
        <main className="crm-job-detail">{selectedJobDetail?.id === selectedJobId ? <JobDetail key={`${selectedJobDetail.id}:${refreshNonce}`} job={selectedJobDetail} customer={selectedJobCustomer || undefined} user={user} busy={busy} teamAccess={hasTeamAccess} onCrm={crmRequest} onWorkOrder={workOrderRequest} onReload={async () => setRefreshNonce((value) => value + 1)} /> : <div className="crm-empty"><strong>{selectedJobId ? "Loading job..." : "Select a job"}</strong><span>The job record will open here.</span></div>}</main>
      </div> : <div className="crm-pipeline-board">{[["enquiry", "New"], ["qualifying", "Checking"], ["quoting", "Quoting"], ["approved", "Approved"], ["scheduled", "Scheduled"], ["in_progress", "Underway"]].map(([stage, label]) => { const stageJobs = boardJobs[stage] || []; return <section key={stage}><header><button type="button" onClick={() => { setPipelineFocus(stage); setJobLayout("list"); }}>{label}</button><strong>{boardCounts[stage] || 0}</strong></header><div>{stageJobs.map((job) => <button type="button" key={job.id} onClick={() => { setSearch(job.workNumber); setJobPage(1); setSelectedJobId(job.id); setJobLayout("list"); }}><span>{job.workNumber}</span><strong>{job.title}</strong><small>{job.customerDisplayName || "Internal"}</small><em>{job.nextAction || workStageLabels[job.stage] || job.stage}</em></button>)}{!stageJobs.length && <p>No jobs</p>}</div></section>; })}</div>}
    </div>}

    {view === "schedule" && <div className="crm-view">
      <div className="crm-page-heading"><div><span>Appointments and field work</span><h3>Schedule</h3><p>See every booked call, visit, install and service in time order.</p></div></div>
      <WorkspaceListControls page={schedulePagination.page} pageCount={schedulePagination.pageCount} pageSize={schedulePagination.pageSize} total={schedulePagination.total} saved={false} busy={Boolean(busy)} onPage={setSchedulePage} onPageSize={(size) => { setSchedulePageSize(size); setSchedulePage(1); }} onSave={() => undefined} onReset={() => undefined} showViewActions={false} />
      <section className="crm-schedule-board"><header><strong>Upcoming</strong><span>{schedulePagination.total} scheduled</span></header>{scheduleItems.length ? <ol>{scheduleItems.map((item) => <li key={item.id}><time><strong>{new Date(item.startsAt).toLocaleDateString("en-AU", { day: "2-digit" })}</strong><span>{new Date(item.startsAt).toLocaleDateString("en-AU", { month: "short" })}</span></time><div><span>{appointmentLabels[item.appointmentType] || item.appointmentType}</span><h4>{item.title}</h4><small>{dateLabel(item.startsAt, true)}{item.endsAt ? ` to ${new Date(item.endsAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}` : ""}</small></div><button type="button" onClick={() => { setSearch(item.job.workNumber); setJobPage(1); setSelectedJobId(item.job.id); setView("jobs"); }}>{item.job.workNumber}<small>{item.job.title}</small></button><button type="button" disabled={busy === `appointment:${item.id}`} onClick={() => void crmRequest("PATCH", { action: "update_appointment", appointmentId: item.id, status: "completed" }, `appointment:${item.id}`, "Appointment marked complete.")}>Complete</button></li>)}</ol> : <div className="crm-empty"><strong>No scheduled appointments</strong><span>Open a job and add its next visit.</span></div>}</section>
    </div>}

    {view === "customers" && creating === "customer" && <div className="crm-view crm-create-screen">
      <div className="crm-page-heading"><div><span>New direct customer</span><h3>Add a customer your business owns</h3><p>Contact details and the full service address remain private to your installer workspace.</p></div><button type="button" className="crm-back-button" onClick={() => setCreating("")}>Back to customers</button></div>
      <section className="crm-create-card"><div className="crm-create-guidance"><strong>Privacy check</strong><p>Do not copy a person from an AEA protected lead into this list. AEA jobs remain redacted automatically.</p></div><CustomerForm busy={busy} onSubmit={createCustomer} /></section>
    </div>}

    {view === "customers" && creating !== "customer" && <div className="crm-view">
      <div className="crm-page-heading"><div><span>Contacts you own</span><h3>Your customers</h3><p>Use this only for people or businesses that contacted you directly. AEA protected households never appear here.</p></div><button type="button" className="crm-new-button" onClick={() => setCreating("customer")}>New customer</button></div>
      <div className="crm-customer-toolbar"><input type="search" value={customerSearch} onChange={(event) => { setCustomerSearch(event.target.value); setCustomerPage(1); setSelectedCustomerIds([]); }} placeholder="Search name, customer number, contact or location" aria-label="Search customers" /><label className="crm-index-sort"><span>Sort customers</span><select value={customerSort} onChange={(event) => { setCustomerSort(event.target.value); setCustomerPage(1); setSelectedCustomerIds([]); }}><option value="name-asc">Name A to Z</option><option value="name-desc">Name Z to A</option><option value="updated-desc">Recently updated</option></select></label></div>
      <WorkspaceListControls page={customerPagination.page} pageCount={customerPagination.pageCount} pageSize={customerPagination.pageSize} total={customerPagination.total} saved={customerViewSaved} busy={viewBusy || indexLoading}
        onPage={(page) => { setCustomerPage(page); setSelectedCustomerIds([]); }} onPageSize={(size) => { setCustomerPageSize(size); setCustomerPage(1); setSelectedCustomerIds([]); }} onSave={() => void updateListView("installer-customers", "PATCH")} onReset={() => void updateListView("installer-customers", "DELETE")} />
      {selectedCustomerIds.length > 0 && <div className="crm-bulk-actions" role="region" aria-label="Selected customer actions"><strong>{selectedCustomerIds.length} customer{selectedCustomerIds.length === 1 ? "" : "s"} selected</strong><span>Only customers with no active jobs can be archived.</span><button type="button" disabled={busy === "bulk-customer-archive"} onClick={() => void bulkRequest({ action: "bulk_archive_customers", ids: selectedCustomerIds }, "bulk-customer-archive", "Selected customers archived.")}>{busy === "bulk-customer-archive" ? "Checking..." : "Archive selected"}</button><button type="button" className="secondary" onClick={() => setSelectedCustomerIds([])}>Clear</button></div>}
      <div className="crm-customers-layout"><aside className="crm-customer-list">{indexedCustomers.length ? indexedCustomers.map((customer) => <article key={customer.id} className={selectedCustomerId === customer.id ? "active" : ""}><label className="crm-row-select"><input type="checkbox" checked={selectedCustomerIds.includes(customer.id)} onChange={(event) => setSelectedCustomerIds((current) => event.target.checked ? [...current, customer.id] : current.filter((id) => id !== customer.id))} /><span className="sr-only">Select {customer.displayName}</span></label><button className="crm-row-open" type="button" onClick={() => setSelectedCustomerId(customer.id)}><strong>{customer.displayName}</strong><span>{customer.customerNumber} | {customer.jobCount || 0} job{customer.jobCount === 1 ? "" : "s"}</span><small>{customer.phone || customer.email || `${customer.suburb} ${customer.addressState}`.trim() || "Contact details not added"}</small></button></article>) : <div className="crm-empty"><strong>{indexLoading ? "Loading customers..." : "No direct customers in this view"}</strong><span>{indexLoading ? "Fetching this page securely." : "Change the search or add a customer your business owns."}</span></div>}</aside>{selectedCustomerDetail?.id === selectedCustomerId ? <CustomerDetail key={`${selectedCustomerDetail.id}:${refreshNonce}`} customer={selectedCustomerDetail} jobs={selectedCustomerJobs} busy={busy} onSave={crmRequest} onOpenJob={(id) => { setSearch(selectedCustomerJobs.find((job) => job.id === id)?.workNumber || ""); setJobPage(1); setSelectedJobId(id); setView("jobs"); }} /> : <section className="crm-card"><div className="crm-empty"><strong>{selectedCustomerId ? "Loading customer..." : "Select a customer"}</strong><span>The private contact record will open here.</span></div></section>}</div>
    </div>}

    {view === "templates" && <div className="crm-view crm-template-view">
      <div className="crm-page-heading"><div><span>Repeatable quality</span><h3>Job templates</h3><p>Save the scope and checklist once, then start consistent jobs without rebuilding the same record in the office or field.</p></div><button type="button" className="crm-new-button" onClick={() => { setView("jobs"); setCreating("job"); }}>Use a template</button></div>
      <div className="crm-template-layout">
        <section className="crm-card crm-template-create"><header><div><span>New reusable workflow</span><h3>Create a template</h3></div></header><form className="crm-form" onSubmit={createTemplate}><div className="crm-form-grid"><label><span>Template name</span><input name="name" required maxLength={100} placeholder="Standard heat pump install" /></label><label><span>Default job title</span><input name="title" maxLength={160} placeholder="Heat pump hot water installation" /></label><label><span>Work type</span><select name="serviceCategory">{Object.entries(serviceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Priority</span><select name="priority"><option value="standard">Standard</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label className="wide"><span>Default scope and access notes</span><textarea name="description" maxLength={3000} rows={4} placeholder="The repeatable scope, exclusions and site preparation" /></label><label className="wide"><span>Checklist, one item per line</span><textarea name="taskTitles" maxLength={4200} rows={7} placeholder={"Confirm isolation and site safety\nRecord installed model and serial\nPhotograph completed work\nComplete customer handover"} /><small>Up to 24 clear tasks are copied into every job created from this template.</small></label></div><button className="btn" disabled={busy === "create-template"}>{busy === "create-template" ? "Saving..." : "Save template"}</button></form></section>
        <section className="crm-card crm-template-library"><header><div><span>Template library</span><h3>{templates.length} saved workflow{templates.length === 1 ? "" : "s"}</h3></div></header>{templates.length ? <div>{templates.map((template) => <article key={template.id}><div><span>{serviceLabels[template.serviceCategory] || template.serviceCategory}</span><strong>{template.name}</strong><p>{template.title || "Job title added when used"}</p><small>{template.taskTitles.length} checklist item{template.taskTitles.length === 1 ? "" : "s"} | {template.priority} priority</small></div><button type="button" disabled={busy === `template:${template.id}`} onClick={() => void crmRequest("PATCH", { action: "archive_template", templateId: template.id }, `template:${template.id}`, "Template archived.")}>Archive</button></article>)}</div> : <div className="crm-empty"><strong>No templates yet</strong><span>Create the first repeatable workflow for your most common job.</span></div>}</section>
      </div>
    </div>}

    {view === "reports" && <div className="crm-view">
      <div className="crm-page-heading"><div><span>Business snapshot</span><h3>Reports</h3><p>A simple operational view using the records in this workspace.</p></div></div>
      <section className="crm-metrics crm-report-metrics"><article><span>Quoted</span><strong>{money(reportMetrics.quotedCents)}</strong><small>Current job records</small></article><article><span>Invoiced</span><strong>{money(reportMetrics.invoicedCents)}</strong><small>Including paid invoices</small></article><article><span>Paid</span><strong>{money(reportMetrics.paidCents)}</strong><small>Recorded receipts</small></article><article className={reportMetrics.outstandingCents ? "attention" : ""}><span>Outstanding</span><strong>{money(reportMetrics.outstandingCents)}</strong><small>Still to collect</small></article></section>
      <div className="crm-report-grid"><section className="crm-card"><header><div><span>Sales flow</span><h3>Jobs by stage</h3></div></header><div className="crm-pipeline-report">{Object.entries(pipelineLabels).map(([stage, label]) => { const count = pipelineCounts[stage] || 0; return <div key={stage}><span>{label}</span><meter min="0" max={Math.max(1, pipelineTotal)} value={count} /><strong>{count}</strong></div>; })}</div></section><section className="crm-card"><header><div><span>Work health</span><h3>Operational checks</h3></div></header><dl className="crm-report-list"><div><dt>Open jobs</dt><dd>{reportMetrics.openJobs}</dd></div><div><dt>Jobs waiting</dt><dd>{reportMetrics.waitingJobs}</dd></div><div><dt>Open issues</dt><dd>{reportMetrics.openIssues}</dd></div><div><dt>Overdue tasks</dt><dd>{reportMetrics.overdueTasks}</dd></div><div><dt>Completed jobs</dt><dd>{reportMetrics.completedJobs}</dd></div></dl></section></div>
    </div>}
    {view === "import" && <div className="crm-view"><TradeDataImportWorkspace user={user} partnerType="installer" onImported={async () => { await load(); setRefreshNonce((value) => value + 1); }} /></div>}
    {view === "integrations" && <div className="crm-view"><TradeIntegrationCentre user={user} /></div>}
    {view === "team" && hasTeamAccess && <div className="crm-view"><TradeTeamCentre user={user} /></div>}
    {status && <p className="crm-status" role="status">{status}</p>}
  </section>;
}

function NewJobForm({ user, templates, busy, onSubmit }: { user: User; templates: JobTemplate[]; busy: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [templateId, setTemplateId] = useState("");
  const template = templates.find((item) => item.id === templateId);
  return <form className="crm-form" onSubmit={onSubmit}><div className="crm-system-id-note"><span>Job ID</span><strong>Assigned automatically</strong><small>The next number follows your business sequence, such as JOB-000124.</small></div>{templates.length > 0 && <label className="crm-template-picker"><span>Start from a template, optional</span><select name="templateId" value={templateId} onChange={(event) => setTemplateId(event.target.value)}><option value="">Blank job</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>{template ? `${template.taskTitles.length} checklist items will be added automatically.` : "Templates keep common scopes and checklists consistent."}</small></label>}<div className="crm-form-grid" key={templateId || "blank"}><CustomerLookupSelect user={user} /><label><span>Job title</span><input name="title" required maxLength={160} defaultValue={template?.title || ""} placeholder="Heat pump hot water installation" /></label><label><span>Work type</span><select name="serviceCategory" defaultValue={template?.serviceCategory || "assessment"}>{Object.entries(serviceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Service area</span><input name="siteArea" maxLength={80} placeholder="Suburb or region" /></label><label><span>Priority</span><select name="priority" defaultValue={template?.priority || "standard"}><option value="standard">Standard</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label><span>Planned start</span><input type="date" name="scheduledStart" /></label><label><span>Planned finish</span><input type="date" name="scheduledEnd" /></label><label><span>Estimated value</span><input type="number" min="0" step="0.01" name="estimatedValue" placeholder="0.00" /></label><label className="wide"><span>Job description</span><textarea name="description" maxLength={3000} rows={3} defaultValue={template?.description || ""} placeholder="Scope, access notes and what must happen next" /></label></div><button className="btn" disabled={busy === "create-job"}>{busy === "create-job" ? "Creating..." : "Create job"}</button></form>;
}

function CustomerLookupSelect({ user, initialCustomer }: { user: User; initialCustomer?: Customer }) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Customer[]>(initialCustomer ? [initialCustomer] : []);
  const [selectedId, setSelectedId] = useState(initialCustomer?.id || "");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) setLoading(true);
      void user.getIdToken().then((token) => {
        const params = new URLSearchParams({ mode: "index", resource: "customers", search: query, sort: "name-asc", page: "1", pageSize: "25" });
        return fetch(`/api/trade-crm?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      }).then(async (response) => {
        const result = await response.json().catch(() => ({})) as CrmIndexResult;
        if (!response.ok || !result.ok) throw new Error(result.error || "Customer search unavailable.");
        if (active) setItems((result.items || []) as Customer[]);
      }).catch(() => active && setItems(initialCustomer ? [initialCustomer] : [])).finally(() => active && setLoading(false));
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [initialCustomer, query, user]);
  const choices = initialCustomer && !items.some((item) => item.id === initialCustomer.id) ? [initialCustomer, ...items] : items;
  return <fieldset className="crm-customer-lookup"><legend>Your customer, optional</legend><label htmlFor={searchId}><span>Find a customer</span><input id={searchId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, number, phone or suburb" /></label><label><span>Matched customer</span><select name="crmCustomerId" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">No customer linked</option>{choices.map((customer) => <option key={customer.id} value={customer.id}>{customer.displayName} | {customer.customerNumber}</option>)}</select></label><small>{loading ? "Searching your private customer list..." : "AEA protected leads enter automatically and cannot be linked to contact records."}</small></fieldset>;
}

function CustomerForm({ busy, onSubmit }: { busy: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className="crm-form" onSubmit={onSubmit}><div className="crm-form-grid"><label><span>Customer type</span><select name="customerType"><option value="residential">Residential</option><option value="business">Business</option></select></label><label><span>First name</span><input name="firstName" maxLength={80} /></label><label><span>Last name</span><input name="lastName" maxLength={80} /></label><label><span>Business name</span><input name="businessName" maxLength={140} /></label><label><span>Email</span><input type="email" name="email" maxLength={180} /></label><label><span>Phone</span><input type="tel" name="phone" maxLength={40} /></label><label className="wide"><span>Street address</span><input name="addressLine1" maxLength={140} placeholder="Street number and name" /></label><label className="wide"><span>Address line 2</span><input name="addressLine2" maxLength={140} placeholder="Unit, level or building, optional" /></label><label><span>Suburb</span><input name="suburb" maxLength={80} /></label><label><span>State</span><select name="addressState" defaultValue=""><option value="">Select state</option>{["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"].map((state) => <option key={state}>{state}</option>)}</select></label><label><span>Postcode</span><input name="postcode" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" /></label><label><span>Tags</span><input name="tags" maxLength={300} placeholder="repeat customer, builder" /></label></div><p className="crm-form-note">Only add contacts who came directly to your business. Do not copy AEA household details into this CRM.</p><button className="btn" disabled={busy === "create-customer"}>{busy === "create-customer" ? "Adding..." : "Add customer"}</button></form>;
}

function JobDetail({ job, customer, user, busy, teamAccess, onCrm, onWorkOrder, onReload }: { job: Job; customer?: Customer; user: User; busy: string; teamAccess: boolean; onCrm: (method: "POST" | "PATCH", body: Record<string, unknown>, key: string, success: string) => Promise<boolean>; onWorkOrder: (method: "POST" | "PATCH", body: Record<string, unknown>, key: string, success: string) => Promise<boolean>; onReload: () => Promise<void> }) {
  const [tab, setTab] = useState("summary");
  const isProtected = job.customerSource === "platform_private";
  const openIssues = job.notes.filter((note) => note.noteType === "issue" && note.issueStatus === "open").length;
  async function saveSummary(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); await onCrm("PATCH", { action: "update_job", workOrderId: job.id, crmCustomerId: data.get("crmCustomerId"), pipelineStage: data.get("pipelineStage"), stage: data.get("stage"), priority: data.get("priority"), description: data.get("description"), nextAction: data.get("nextAction"), tags: data.get("tags") }, `job:${job.id}`, "Job summary saved."); }
  async function saveFinancials(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); await onCrm("PATCH", { action: "update_job", workOrderId: job.id, quoteStatus: data.get("quoteStatus"), invoiceStatus: data.get("invoiceStatus"), estimatedValueCents: cents(data.get("estimatedValue")), quotedValueCents: cents(data.get("quotedValue")), invoicedValueCents: cents(data.get("invoicedValue")), paidValueCents: cents(data.get("paidValue")), paymentDueAt: data.get("paymentDueAt") }, `finance:${job.id}`, "Quote and invoice summary saved."); }
  async function addTask(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); if (await onWorkOrder("POST", { action: "add_task", workOrderId: job.id, title: data.get("title"), dueAt: data.get("dueAt") }, `task:${job.id}`, "Task added.")) form.reset(); }
  async function addAppointment(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); if (await onCrm("POST", { action: "create_appointment", workOrderId: job.id, appointmentType: data.get("appointmentType"), title: data.get("title"), startsAt: data.get("startsAt"), endsAt: data.get("endsAt"), assigneeLabel: data.get("assigneeLabel"), notes: data.get("notes") }, `appointment-new:${job.id}`, "Appointment added.")) form.reset(); }
  async function addNote(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); if (await onCrm("POST", { action: "create_note", workOrderId: job.id, noteType: data.get("noteType"), body: data.get("body") }, `note:${job.id}`, "Job note added.")) form.reset(); }
  return <article className="crm-job-card"><header className="crm-job-card-header"><div><span>{job.workNumber}</span><h3>{job.title}</h3><small>{serviceLabels[job.serviceCategory] || job.serviceCategory}{job.siteArea ? ` | ${job.siteArea}` : ""}</small></div><div><strong>{pipelineLabels[job.pipelineStage] || job.pipelineStage}</strong><span className={isProtected ? "protected" : "owned"}>{isProtected ? "AEA protected" : customer ? "Your customer" : "Internal"}</span></div></header>
    <nav className="crm-job-tabs" aria-label="Job card sections">{[["summary", "Overview"], ["field", "Field work"], ["schedule", `Schedule (${job.appointments.length})`], ["finance", "Money"]].map(([value, label]) => <button key={value} type="button" className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{label}</button>)}<details className="crm-job-more"><summary className={["forms", "tasks", "notes", "handover"].includes(tab) ? "active" : ""}>{["forms", "tasks", "notes", "handover"].includes(tab) ? tab[0].toUpperCase() + tab.slice(1) : "More"}</summary><div>{[["forms", "Forms"], ["tasks", `Tasks (${job.tasks.filter((task) => task.status === "pending").length})`], ["notes", `Notes${openIssues ? ` (${openIssues})` : ""}`], ["handover", "Handover"]].map(([value, label]) => <button key={value} type="button" className={tab === value ? "active" : ""} onClick={(event) => { setTab(value); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{label}</button>)}</div></details></nav>
    {tab === "summary" && <form className="crm-job-section crm-form" onSubmit={saveSummary}><div className="crm-readonly-id"><span>System job ID</span><strong>{job.workNumber}</strong><small>Assigned automatically and cannot be edited.</small></div><div className={isProtected ? "crm-customer-boundary protected" : "crm-customer-boundary owned"}><span>{isProtected ? "AEA protected customer" : "Your customer record"}</span><strong>{isProtected ? `Protected reference ${job.customerReference || job.workNumber}` : customer?.displayName || "No customer linked"}</strong><p>{isProtected ? "AEA manages the household relationship. The installer sees only the project scope, broad service region and protected reference." : customer ? [customer.phone, customer.email, [customer.addressLine1, customer.addressLine2, customer.suburb, customer.addressState, customer.postcode].filter(Boolean).join(", ")].filter(Boolean).join(" | ") : "Link a customer who contacted your business directly, or keep this as internal work."}</p></div><div className="crm-form-grid">{!isProtected && <CustomerLookupSelect user={user} initialCustomer={customer} />}<label><span>Sales stage</span><select name="pipelineStage" defaultValue={job.pipelineStage}>{Object.entries(pipelineLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Work stage</span><select name="stage" defaultValue={job.stage}>{Object.entries(workStageLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Priority</span><select name="priority" defaultValue={job.priority}><option value="low">Low</option><option value="standard">Standard</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label className="wide"><span>Next action</span><input name="nextAction" defaultValue={job.nextAction} maxLength={200} placeholder="What should happen next?" /></label><label className="wide"><span>Job description and access notes</span><textarea name="description" defaultValue={job.description} maxLength={3000} rows={4} /></label><label className="wide"><span>Tags</span><input name="tags" defaultValue={job.tags.join(", ")} maxLength={400} placeholder="heat pump, awaiting parts" /></label></div><button className="btn" disabled={busy === `job:${job.id}`}>Save summary</button></form>}
    {tab === "field" && <section className="crm-job-section"><div className="crm-section-heading"><div><span>Mobile field record</span><h4>Time, photos and sign-off</h4><p>Keep on-site evidence attached to this job without opening another system.</p></div></div><TradeFieldWorkPanel user={user} workOrderId={job.id} isProtected={isProtected} /></section>}
    {tab === "forms" && <section className="crm-job-section"><TradeJobFormsPanel user={user} workOrderId={job.id} /></section>}
    {tab === "schedule" && <section className="crm-job-section"><div className="crm-section-heading"><div><span>Appointments</span><h4>Calls, visits and installations</h4></div></div>{job.appointments.length ? <ol className="crm-job-appointments">{job.appointments.map((item) => <li key={item.id}><div><span>{appointmentLabels[item.appointmentType] || item.appointmentType}</span><strong>{item.title}</strong><small>{dateLabel(item.startsAt, true)}{item.assigneeLabel ? ` | ${item.assigneeLabel}` : ""}</small>{item.notes && <p>{item.notes}</p>}</div><button type="button" disabled={item.status !== "scheduled" || busy === `appointment:${item.id}`} onClick={() => void onCrm("PATCH", { action: "update_appointment", appointmentId: item.id, status: "completed" }, `appointment:${item.id}`, "Appointment marked complete.")}>{item.status === "scheduled" ? "Complete" : item.status.replaceAll("_", " ")}</button></li>)}</ol> : <div className="crm-empty"><strong>No appointments yet</strong><span>Add the next call, site visit or installation.</span></div>}<form className="crm-inline-form" onSubmit={addAppointment}><select name="appointmentType" aria-label="Appointment type">{Object.entries(appointmentLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><input name="title" required maxLength={160} placeholder="Appointment title" /><input type="datetime-local" name="startsAt" required aria-label="Start time" /><input type="datetime-local" name="endsAt" aria-label="Finish time" />{teamAccess && <input name="assigneeLabel" maxLength={80} placeholder="Assigned staff" />}<input name="notes" maxLength={1000} placeholder="Visit notes" /><button disabled={busy === `appointment-new:${job.id}`}>Add appointment</button></form></section>}
    {tab === "tasks" && <section className="crm-job-section"><div className="crm-section-heading"><div><span>Checklist</span><h4>What the team must complete</h4></div></div>{job.tasks.length ? <ul className="crm-task-list">{job.tasks.map((task) => <li key={task.id} className={task.status === "done" ? "done" : ""}><label><input type="checkbox" checked={task.status === "done"} disabled={busy === `task-toggle:${task.id}`} onChange={(event) => void onWorkOrder("PATCH", { action: "update_task", taskId: task.id, status: event.target.checked ? "done" : "pending" }, `task-toggle:${task.id}`, event.target.checked ? "Task completed." : "Task reopened.")} /><span>{task.title}</span></label><small>{task.dueAt ? `Due ${dateLabel(task.dueAt)}` : "No due date"}</small></li>)}</ul> : <div className="crm-empty"><strong>No tasks yet</strong><span>Add clear steps for the office or field team.</span></div>}<form className="crm-inline-form task" onSubmit={addTask}><input name="title" required maxLength={180} placeholder="Add a task" /><input type="date" name="dueAt" aria-label="Task due date" /><button disabled={busy === `task:${job.id}`}>Add task</button></form></section>}
    {tab === "finance" && <section className="crm-job-section"><form className="crm-form" onSubmit={saveFinancials}><div className="crm-section-heading"><div><span>Financial progress</span><h4>Quote and invoice summary</h4><p>Record the agreed totals, then export an accounting draft or create a secure payment link for your direct customer.</p></div></div><div className="crm-finance-summary"><article><span>Estimate</span><strong>{money(job.estimatedValueCents)}</strong></article><article><span>Quoted</span><strong>{money(job.quotedValueCents)}</strong></article><article><span>Invoiced</span><strong>{money(job.invoicedValueCents)}</strong></article><article><span>Paid</span><strong>{money(job.paidValueCents)}</strong></article></div><div className="crm-form-grid"><label><span>Estimate amount</span><input type="number" name="estimatedValue" min="0" step="0.01" defaultValue={(job.estimatedValueCents / 100).toFixed(2)} /></label><label><span>Quote amount</span><input type="number" name="quotedValue" min="0" step="0.01" defaultValue={(job.quotedValueCents / 100).toFixed(2)} /></label><label><span>Quote status</span><select name="quoteStatus" defaultValue={job.quoteStatus}><option value="not_started">Not started</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="accepted">Accepted</option><option value="declined">Declined</option></select></label><label><span>Invoice amount</span><input type="number" name="invoicedValue" min="0" step="0.01" defaultValue={(job.invoicedValueCents / 100).toFixed(2)} /></label><label><span>Amount paid</span><input type="number" name="paidValue" min="0" step="0.01" defaultValue={(job.paidValueCents / 100).toFixed(2)} /></label><label><span>Invoice status</span><select name="invoiceStatus" defaultValue={job.invoiceStatus}><option value="not_started">Not started</option><option value="draft">Draft</option><option value="issued">Issued</option><option value="part_paid">Part paid</option><option value="paid">Paid</option><option value="overdue">Overdue</option><option value="void">Void</option></select></label><label><span>Payment due</span><input type="date" name="paymentDueAt" defaultValue={job.paymentDueAt} /></label></div><button className="btn" disabled={busy === `finance:${job.id}`}>Save financial progress</button></form><TradeAccountingPanel user={user} workOrderId={job.id} isProtected={isProtected} hasDirectCustomer={Boolean(customer)} invoiceAmountCents={job.invoicedValueCents} onChanged={onReload} /><TradePaymentPanel user={user} workOrderId={job.id} isProtected={isProtected} suggestedAmountCents={Math.max(0, job.invoicedValueCents - job.paidValueCents) || job.invoicedValueCents} /></section>}
    {tab === "notes" && <section className="crm-job-section"><div className="crm-section-heading"><div><span>Internal history</span><h4>Notes and issues</h4><p>These records are private to your business and are not sent to the customer.</p></div></div><form className="crm-inline-form note" onSubmit={addNote}><select name="noteType"><option value="internal">Internal note</option><option value="issue">Issue to resolve</option></select><textarea name="body" required maxLength={4000} rows={3} placeholder="Record a decision, update or problem" /><button disabled={busy === `note:${job.id}`}>Add record</button></form>{job.notes.length ? <ol className="crm-notes-list">{job.notes.map((note) => <li key={note.id} className={note.noteType === "issue" ? `issue ${note.issueStatus}` : ""}><div><span>{note.noteType === "issue" ? `Issue | ${note.issueStatus}` : "Internal note"}</span><p>{note.body}</p><small>{dateLabel(note.createdAt, true)}</small></div>{note.noteType === "issue" && <button type="button" disabled={busy === `issue:${note.id}`} onClick={() => void onCrm("PATCH", { action: "resolve_issue", noteId: note.id, issueStatus: note.issueStatus === "open" ? "resolved" : "open" }, `issue:${note.id}`, note.issueStatus === "open" ? "Issue resolved." : "Issue reopened.")}>{note.issueStatus === "open" ? "Resolve" : "Reopen"}</button>}</li>)}</ol> : <div className="crm-empty"><strong>No internal history yet</strong><span>Add notes as the job develops.</span></div>}</section>}
    {tab === "handover" && <section className="crm-job-section"><div className="crm-section-heading"><div><span>Completion records</span><h4>Installed products, documents and care</h4><p>Publish approved product and warranty records into the customer&apos;s free home account.</p></div></div><TradeHandoverCentre user={user} workOrderId={job.id} fullAccess /></section>}
  </article>;
}

function CustomerDetail({ customer, jobs, busy, onSave, onOpenJob }: { customer: Customer; jobs: Job[]; busy: string; onSave: (method: "POST" | "PATCH", body: Record<string, unknown>, key: string, success: string) => Promise<boolean>; onOpenJob: (id: string) => void }) {
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); await onSave("PATCH", { action: "update_customer", customerId: customer.id, firstName: data.get("firstName"), lastName: data.get("lastName"), businessName: data.get("businessName"), email: data.get("email"), phone: data.get("phone"), addressLine1: data.get("addressLine1"), addressLine2: data.get("addressLine2"), suburb: data.get("suburb"), addressState: data.get("addressState"), postcode: data.get("postcode"), tags: data.get("tags"), privateNotes: data.get("privateNotes") }, `customer:${customer.id}`, "Customer record saved."); }
  return <section className="crm-customer-detail"><header><div><span>{customer.customerNumber}</span><h3>{customer.displayName}</h3><small>{customer.customerType === "business" ? "Business customer" : "Residential customer"}</small></div><strong>Private installer record</strong></header><form className="crm-form" onSubmit={save}><div className="crm-form-grid"><label><span>First name</span><input name="firstName" defaultValue={customer.firstName} /></label><label><span>Last name</span><input name="lastName" defaultValue={customer.lastName} /></label><label><span>Business name</span><input name="businessName" defaultValue={customer.businessName} /></label><label><span>Email</span><input type="email" name="email" defaultValue={customer.email} /></label><label><span>Phone</span><input type="tel" name="phone" defaultValue={customer.phone} /></label><label className="wide"><span>Street address</span><input name="addressLine1" defaultValue={customer.addressLine1} /></label><label className="wide"><span>Address line 2</span><input name="addressLine2" defaultValue={customer.addressLine2} /></label><label><span>Suburb</span><input name="suburb" defaultValue={customer.suburb} /></label><label><span>State</span><input name="addressState" defaultValue={customer.addressState} /></label><label><span>Postcode</span><input name="postcode" defaultValue={customer.postcode} /></label><label className="wide"><span>Tags</span><input name="tags" defaultValue={customer.tags.join(", ")} /></label><label className="wide"><span>Private notes</span><textarea name="privateNotes" defaultValue={customer.privateNotes} rows={4} /></label></div><button className="btn" disabled={busy === `customer:${customer.id}`}>Save customer</button></form><section className="crm-customer-jobs"><h4>Jobs for this customer</h4>{jobs.length ? jobs.map((job) => <button type="button" key={job.id} onClick={() => onOpenJob(job.id)}><span>{job.workNumber}</span><strong>{job.title}</strong><small>{pipelineLabels[job.pipelineStage] || job.pipelineStage}</small></button>) : <p>No jobs linked yet.</p>}</section></section>;
}
