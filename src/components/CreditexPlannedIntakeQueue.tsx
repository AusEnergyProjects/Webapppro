"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import styles from "./CreditexPlannedIntakeQueue.module.css";
import { firebaseAuth } from "@/lib/firebase-client";
import { CreditexJobAuditDesk } from "./CreditexJobAuditDesk";
import { JobActionsButton, JobRowMenu, useJobRowMenu } from "./JobRowActions";
import { jobCreationDate } from "@/lib/job-register-dates";
import { CREDITEX_CERTIFICATE_TYPES } from "@/lib/creditex-certificate-types";
import type { CreditexJobLifecycle } from "@/lib/creditex-job-lifecycle";

type QueueStatus = "all" | "planned" | "case_linked" | "superseded";
const PAGE_SIZE = 50;
type QueueSort = "certificateType" | "plannedStart" | "jobNumber" | "createdAt" | "customerName" | "customerFirstName" | "customerLastName" | "installerBusiness" | "programCode" | "jobStage" | "priority" | "updatedAt";
const EMPTY_FILTERS = { job: "", customer: "", firstName: "", lastName: "", program: "", activity: "", installer: "", serviceSite: "", jobStage: "", priority: "", createdFrom: "", createdTo: "", plannedFrom: "", plannedTo: "", quoteStatus: "", invoiceStatus: "" };

type PlannedIntake = {
  id: string;
  jobId: string;
  jobNumber: string;
  createdAt: string;
  jobTitle: string;
  assigneeLabel: string;
  installerBusiness: string;
  customerName: string;
  customerFirstName: string;
  customerLastName: string;
  customerBusinessName: string;
  customerPhone: string;
  serviceAddress: string;
  plannedStart: string;
  programCode: string;
  certificateType: string;
  lifecycle: CreditexJobLifecycle;
  auditCompleted: boolean;
  operationalCorrectionRequired: boolean;
  registryActivityCode: string;
  activityKey: string;
  activityTitle: string;
};

type Api = (
  path: string,
  init?: RequestInit,
) => Promise<Record<string, unknown>>;

function dateTime(value: string) {
  return value
    ? new Date(value).toLocaleString("en-AU", {
      dateStyle: "medium",
      timeStyle: "short",
    })
    : "Not scheduled";
}

function humanField(field: string) {
  return field
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function CreditexPlannedIntakeQueue({ api, onDirtyChange, mode = "jobs", initialSearch = "" }: { api: Api; onDirtyChange?: (dirty: boolean) => void; mode?: "jobs" | "corrections"; initialSearch?: string }) {
  const corrections = mode === "corrections";
  const [items, setItems] = useState<PlannedIntake[]>([]);
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState<QueueStatus>("all");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<QueueSort>("plannedStart");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [queueError, setQueueError] = useState<{ query: string; text: string } | null>(null);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditItem, setAuditItem] = useState<PlannedIntake | null>(null);
  const [focusCall, setFocusCall] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [certificateType, setCertificateType] = useState("all");
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [queueView, setQueueView] = useState<"active" | "bin">("active");
  const filterLauncherRef = useRef<HTMLButtonElement | null>(null);
  const filterHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const { menu, openMenu, closeMenu } = useJobRowMenu();
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const loadTimer = useRef<number | null>(null);
  const auditLauncherRef = useRef<HTMLElement | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const tableScroll = useRef({ top: 0, left: 0 });

  const query = new URLSearchParams({ status: corrections ? "all" : status, search, certificateType, page: String(page), sort, sortDirection });
  if (corrections) query.set("mode", "corrections");
  if (!corrections && queueView === "bin") query.set("view", "bin");
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  const queryKey = query.toString();
  const message = queueError?.query === queryKey ? queueError.text : "";
  const hasLoaded = loadedQuery !== null;
  const updating = loading || (loadedQuery !== queryKey && !message);
  const stale = hasLoaded && (loadedQuery !== queryKey || Boolean(message));

  const load = useCallback(async () => {
    if (loadTimer.current !== null) window.clearTimeout(loadTimer.current);
    loadTimer.current = null;
    closeMenu(false);
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    setQueueError(null);
    try {
      const result = await api(`/api/creditex/job-intents?${queryKey}`, { signal: controller.signal });
      if (result.ok !== true) {
        throw new Error(
          String(result.error || "The planned work queue could not be loaded."),
        );
      }
      if (requestId !== requestSequence.current || controller.signal.aborted) return;
      if (!Array.isArray(result.items) || typeof result.total !== "number" || !Number.isSafeInteger(result.total) || result.total < 0) {
        throw new Error("The job results were incomplete. Please retry.");
      }
      setItems(result.items as PlannedIntake[]);
      setTotal(Number(result.total || 0));
      setTotalPages(Math.max(1, Number(result.totalPages || 1)));
      setLoadedQuery(queryKey);
      const returnedPage = Math.max(1, Number(result.page || 1));
      if (returnedPage !== page) setPage(returnedPage);
    } catch (error) {
      if (requestId !== requestSequence.current || controller.signal.aborted) return;
      setQueueError({ query: queryKey, text: error instanceof Error
          ? error.message
          : "The planned work queue could not be loaded." });
    } finally {
      if (requestId === requestSequence.current && !controller.signal.aborted) {
        requestController.current = null;
        setLoading(false);
      }
    }
  }, [api, page, queryKey, closeMenu]);

  useEffect(() => {
    loadTimer.current = window.setTimeout(() => void load(), 180);
    return () => {
      if (loadTimer.current !== null) window.clearTimeout(loadTimer.current);
      loadTimer.current = null;
      requestSequence.current += 1;
      requestController.current?.abort();
      requestController.current = null;
    };
  }, [load]);

  useEffect(() => {
    if (showFilters) filterHeadingRef.current?.focus();
  }, [showFilters]);

  function openAudit(item: PlannedIntake, launcher: HTMLElement, call = false) {
    auditLauncherRef.current = launcher;
    if (tableRef.current) tableScroll.current = { top: tableRef.current.scrollTop, left: tableRef.current.scrollLeft };
    setFocusCall(call);
    setAuditItem(item);
  }

  useEffect(() => {
    if (!actionMessage) return;
    const timer = window.setTimeout(() => setActionMessage(""), 3000);
    return () => window.clearTimeout(timer);
  }, [actionMessage]);

  async function copyJobValue(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setActionMessage(`${label} copied.`); }
    catch { setActionMessage("Copy was unavailable. Select the text in the job details to copy it."); }
  }

  function rowActions(item: PlannedIntake, launcher: HTMLElement) {
    return [
      { label: "Audit", run: () => { void openAudit(item, launcher); } },
      ...(item.customerPhone ? [{ label: "Call customer", run: () => { void openAudit(item, launcher, true); } }] : []),
      { label: "Copy job reference", run: () => { void copyJobValue(item.jobNumber || item.jobId, "Job reference"); } },
      ...(item.serviceAddress ? [{ label: "Copy site address", run: () => { void copyJobValue(item.serviceAddress, "Site address"); } }] : []),
    ];
  }

  function closeAudit() {
    const launcher = auditLauncherRef.current;
    const returnJobId = auditItem?.id;
    setAuditItem(null);
    auditLauncherRef.current = null;
    window.requestAnimationFrame(() => {
      if (tableRef.current) { tableRef.current.scrollTop = tableScroll.current.top; tableRef.current.scrollLeft = tableScroll.current.left; }
      if (launcher?.isConnected) launcher.focus({ preventScroll: true });
      else if (returnJobId) document.getElementById(`creditex-job-${returnJobId}`)?.focus({ preventScroll: true });
    });
  }

  function closeFilters() {
    setShowFilters(false);
    filterLauncherRef.current?.focus({ preventScroll: true });
  }

  function toggleFilters() {
    if (showFilters) closeFilters();
    else { setDraftFilters(filters); setShowFilters(true); }
  }

  function changeFilter(key: keyof typeof EMPTY_FILTERS, value: string) {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }

  function resetFilters() {
    setSearch(""); setStatus("all"); setCertificateType("all"); setFilters(EMPTY_FILTERS); setDraftFilters(EMPTY_FILTERS); setPage(1); setSort("plannedStart"); setSortDirection("asc");
  }

  function sortableHeading(label: string, key: QueueSort) {
    return <th scope="col" aria-sort={sort === key ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button type="button" onClick={() => {
      setSort(key); setSortDirection(sort === key && sortDirection === "asc" ? "desc" : "asc"); setPage(1);
    }}>{label}<span aria-hidden="true">{sort === key ? sortDirection === "asc" ? " ↑" : " ↓" : " ↕"}</span></button></th>;
  }

  function filterInput(key: keyof typeof EMPTY_FILTERS, label: string, placeholder: string, type = "search") {
    const range = key.startsWith("created") ? "creditex-job-created" : "creditex-job-planned";
    return <input aria-label={label} type={type} placeholder={placeholder} value={draftFilters[key]} data-date-range-group={type === "date" ? range : undefined} data-date-range-role={type === "date" ? key.endsWith("From") ? "start" : "end" : undefined} onChange={(event) => changeFilter(key, event.target.value)} />;
  }

  function filterSelect(key: keyof typeof EMPTY_FILTERS, label: string, allLabel: string, options: string[]) {
    return <select aria-label={label} value={draftFilters[key]} onChange={(event) => changeFilter(key, event.target.value)}><option value="">{allLabel}</option>{options.map((value) => <option key={value} value={value}>{humanField(value)}</option>)}</select>;
  }

  const activeFilters = Object.values(filters).filter(Boolean).length + (status !== "all" ? 1 : 0) + (certificateType !== "all" ? 1 : 0);

  return <section
    className={styles.queue}
    aria-labelledby={auditItem ? "creditex-full-audit-title" : "creditex-planned-intake-title"}
  >
    {!auditItem && <>
    <header>
      <div>
        <span>Creditex work register</span>
        <h2 id="creditex-planned-intake-title">{corrections ? "Corrections required" : "Jobs"}</h2>
        <p>{corrections ? "Jobs awaiting changes. Open a job to review the correction and its evidence." : "Find a job, review its records and call the customer from their audit workspace."}</p>
      </div>
      <strong>{updating ? "Loading" : !hasLoaded ? "Unavailable" : stale ? "Last loaded results" : `${total} ${total === 1 ? "record" : "records"}`}</strong>
    </header>
    <div className={styles.controls} data-corrections={corrections || undefined}>
      <label><span>Search jobs</span><input
        type="search"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
        placeholder="Job, customer, installer, site, type or activity"
      /></label>
      <label><span>Certificate type</span><select value={certificateType} onChange={(event) => {
        setCertificateType(event.target.value); setPage(1);
      }}>
        <option value="all">All types</option>
        <option value="certificates">All certificates & credits</option>
        {CREDITEX_CERTIFICATE_TYPES.map((type) => <option key={type} value={type}>{type === "VEEC" ? "VEEC (VEU)" : type}</option>)}
      </select></label>
      {!corrections && <label><span>Record status</span><select
        value={status}
        onChange={(event) => {
          setStatus(event.target.value as QueueStatus);
          setPage(1);
        }}
      >
        <option value="all">All records</option>
        <option value="planned">Awaiting case setup</option>
        <option value="case_linked">Case linked</option>
        <option value="superseded">Superseded history</option>
      </select></label>}
      <button ref={filterLauncherRef} type="button" className={styles.filterToggle} aria-expanded={showFilters} aria-controls="creditex-job-filters" onClick={toggleFilters}>Filters{activeFilters ? ` (${activeFilters})` : ""}</button>
      <button type="button" onClick={() => void load()} disabled={updating}>Refresh</button>
      {!corrections && <button type="button" aria-pressed={queueView === "bin"} onClick={() => {
        closeAudit(); setQueueView(queueView === "bin" ? "active" : "bin"); setPage(1);
      }}>{queueView === "bin" ? "Back to active jobs" : "Bin"}</button>}
    </div>
    <div className={styles.resultBar} aria-live="polite"><span>{updating ? "Updating jobs..." : message ? hasLoaded ? `${items.length} previously loaded ${items.length === 1 ? "record" : "records"} shown` : "Job count unavailable" : `${total} matching ${total === 1 ? "record" : "records"}${totalPages > 1 ? ` · Page ${page} of ${totalPages}` : ""}`}{!updating && !message && activeFilters ? ` · ${activeFilters} filters applied` : ""}</span>{(search || activeFilters || sort !== "plannedStart" || sortDirection !== "asc") && <button type="button" className={styles.detailButton} onClick={resetFilters}>Reset filters & sort</button>}</div>
    <p className={styles.tableHint}>{corrections ? "Only open corrections appear here. Corrected and resubmitted work returns to Jobs for review." : "Each row is a job activity. Click a row and choose Audit to review its answers, files and verification call."}</p>
    {actionMessage && <p className={styles.tableHint} role="status">{actionMessage}</p>}
    {message && <div className={`${styles.message} ${styles.loadError}`} role="alert"><div><strong>{hasLoaded ? "Jobs could not be updated" : "Jobs could not be loaded"}</strong><p>{message}</p>{hasLoaded && <p>Showing the last loaded results. They may not match the current filters.</p>}</div><button type="button" onClick={() => void load()} disabled={updating}>Retry</button></div>}
      <div ref={tableRef} className={styles.tableWrap} aria-busy={updating} data-stale={stale || undefined} tabIndex={0} role="region" aria-label={corrections ? "Jobs requiring corrections" : "Assigned jobs"}><table>
        <thead><tr>{sortableHeading("Job ID", "jobNumber")}{sortableHeading("Created", "createdAt")}{sortableHeading("Customer", "customerName")}<th scope="col">Activity</th>{sortableHeading("Installer", "installerBusiness")}{sortableHeading("Planned", "plannedStart")}<th scope="col">Assigned to</th><th scope="col">Status</th></tr></thead>
        <tbody>{items.map((item) => {
          const reviewStage = ["unscheduled", "assigned", "partial", "complete", "reviewed"].includes(item.lifecycle?.status);
          const statusLabel = reviewStage && item.operationalCorrectionRequired ? "Correction required" : reviewStage && item.auditCompleted ? "Audit completed" : item.lifecycle?.label || "Status unavailable";
          const auditDetail = !item.auditCompleted ? "" : item.lifecycle?.status === "audited" ? "Submission approval recorded" : reviewStage && !item.operationalCorrectionRequired ? "Awaiting submission approval" : "Audit completed";
          return <tr key={item.id}
          onClick={event => { if (!updating && event.target instanceof HTMLElement && !event.target.closest("button, a, input")) openMenu(event, `creditex-job-menu-${item.id}`, item.jobNumber || item.jobId, launcher => rowActions(item, launcher)); }}
          onContextMenu={event => { if (!updating) openMenu(event, `creditex-job-menu-${item.id}`, item.jobNumber || item.jobId, launcher => rowActions(item, launcher)); }}>
          <td><div className={styles.jobActions}>
            <button type="button" id={`creditex-job-${item.id}`} className={styles.jobButton} onClick={(event) => openAudit(item, event.currentTarget)} aria-label={`Open job ${item.jobNumber || item.jobId}`} aria-controls="creditex-full-audit-workspace">{item.jobNumber || item.jobId}</button>
            <JobActionsButton label={item.jobNumber || item.jobId} menuId={`creditex-job-menu-${item.id}`} expanded={menu?.id === `creditex-job-menu-${item.id}`} onClick={event => openMenu(event, `creditex-job-menu-${item.id}`, item.jobNumber || item.jobId, launcher => rowActions(item, launcher))} />
          </div></td>
          <td>{jobCreationDate(item.createdAt)}</td>
          <td className={styles.longCell}><strong>{item.customerBusinessName || [item.customerFirstName, item.customerLastName].filter(Boolean).join(" ") || item.customerName || "Not recorded"}</strong><small>{item.serviceAddress || "Address not recorded"}</small></td>
          <td className={styles.longCell}><strong>{item.activityTitle || item.jobTitle}</strong><small>{item.certificateType || item.programCode} · {item.registryActivityCode || item.activityKey}</small></td>
          <td>{item.installerBusiness || "Not recorded"}</td>
          <td>{dateTime(item.plannedStart)}</td>
          <td>{item.assigneeLabel || "Unassigned"}</td>
          <td><span className={styles.status}>{statusLabel}</span>{auditDetail && <small>{auditDetail}</small>}{item.lifecycle?.detail && <small>{item.lifecycle.detail}</small>}</td>
        </tr>; })}{!items.length && <tr><td colSpan={8}><div className={styles.empty}><strong>{updating ? "Loading jobs..." : message ? "Results unavailable for these filters" : corrections && !search && !activeFilters ? "No corrections required" : "No matching jobs"}</strong><span>{message ? "Retry or adjust the filters." : corrections && !search && !activeFilters ? "Jobs appear here when a correction is requested." : "Change the filters or reset your search."}</span></div></td></tr>}</tbody>
      </table></div>
    {!updating && !message && <nav className={styles.pagination} aria-label="Certificate-work register pages">
      <span className={styles.pageSize}>{PAGE_SIZE} records per page</span>
      <span>{total ? `${(page - 1) * PAGE_SIZE + 1} to ${Math.min(page * PAGE_SIZE, total)} of ${total}` : "0 records"}</span>
      <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
      <span>Page {page} of {totalPages}</span>
      <button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button>
    </nav>}
    {showFilters && <aside id="creditex-job-filters" className={styles.filterDrawer} aria-labelledby="creditex-job-filters-title" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeFilters(); }
    }}>
      <form onSubmit={(event) => { event.preventDefault(); setFilters(draftFilters); setPage(1); }}>
        <header><div><h3 id="creditex-job-filters-title" tabIndex={-1} ref={filterHeadingRef}>Job filters</h3><p>Choose your filters, then search.</p></div><button type="button" aria-label="Close filters" onClick={closeFilters}>&times;</button></header>
        <div className={styles.filterFields}>
          <details open><summary>Dates</summary><div className={styles.filterGroup}>
            <fieldset><legend>Creation date</legend><div className={styles.dateRange}><label>From{filterInput("createdFrom", "Created from", "", "date")}</label><label>To{filterInput("createdTo", "Created to", "", "date")}</label></div><small>Sydney dates, including both selected days.</small></fieldset>
            <fieldset><legend>Planned date</legend><div className={styles.dateRange}><label>From{filterInput("plannedFrom", "Planned from", "", "date")}</label><label>To{filterInput("plannedTo", "Planned to", "", "date")}</label></div></fieldset>
          </div></details>
          <details open><summary>Job & activity</summary><div className={styles.filterGroup}>
            <label>Job{filterInput("job", "Filter job", "Job number or title")}</label>
            <label>Program{filterInput("program", "Filter program", "Program code")}</label>
            <label>Activity{filterInput("activity", "Filter activity", "Activity code or name")}</label>
            <label>Job stage{filterSelect("jobStage", "Filter job stage", "All stages", ["backlog", "ready", "scheduled", "in_progress", "blocked", "completed", "cancelled"])}</label>
            <label>Priority{filterSelect("priority", "Filter priority", "All priorities", ["low", "standard", "high", "urgent"])}</label>
            <label>Installer{filterInput("installer", "Filter installer", "Business name")}</label>
          </div></details>
          <details><summary>Customer & address</summary><div className={styles.filterGroup}>
            <label>First name{filterInput("firstName", "Filter first name", "First name")}</label>
            <label>Last name{filterInput("lastName", "Filter last name", "Last name")}</label>
            <label>Customer{filterInput("customer", "Filter customer", "Business or customer ID")}</label>
            <label>Service site{filterInput("serviceSite", "Filter service site", "Address or suburb")}</label>
          </div></details>
        </div>
        <footer><button type="button" onClick={resetFilters}>Clear filters</button><button type="submit">Search</button></footer>
      </form>
    </aside>}
    </>}
    {auditItem && firebaseAuth.currentUser && <CreditexJobAuditDesk key={auditItem.id} user={firebaseAuth.currentUser} intentId={auditItem.id} actorMode="creditex" focusCall={focusCall} onClose={closeAudit} onChanged={() => void load()} onDirtyChange={onDirtyChange} />}
    <JobRowMenu menu={menu} onClose={closeMenu} />
  </section>;
}
