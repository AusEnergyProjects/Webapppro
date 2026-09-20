"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import styles from "./CreditexPlannedIntakeQueue.module.css";
import { firebaseAuth } from "@/lib/firebase-client";
import { CreditexAuditCallPanel } from "./CreditexAuditCallPanel";

type QueueStatus = "all" | "planned" | "case_linked" | "superseded";
type QueueSort = "plannedStart" | "jobNumber" | "customerName" | "installerBusiness" | "programCode" | "jobStage" | "priority" | "updatedAt";
const EMPTY_FILTERS = { job: "", customer: "", program: "", activity: "", installer: "", serviceSite: "", jobStage: "", priority: "", plannedFrom: "", plannedTo: "", quoteStatus: "", invoiceStatus: "" };

type PlannedIntake = {
  id: string;
  jobId: string;
  jobNumber: string;
  jobTitle: string;
  jobStage: string;
  jobPriority: string;
  workRecordStatus: string;
  jobDetailRecordStatus: string;
  scheduledStart: string;
  scheduledEnd: string;
  assigneeLabel: string;
  pipelineStage: string;
  buildingType: string;
  jobDescription: string;
  nextAction: string;
  jobTags: string;
  estimatedValueCents: number;
  quotedValueCents: number;
  invoicedValueCents: number;
  paidValueCents: number;
  quoteStatus: string;
  invoiceStatus: string;
  installerBusiness: string;
  customerNumber: string;
  customerType: string;
  customerName: string;
  businessNumber: string;
  customerEmail: string;
  customerPhone: string;
  customerTags: string;
  customerPrivateNotes: string;
  customerRecordStatus: string;
  siteLabel: string;
  serviceAddress: string;
  accessInstructions: string;
  parkingInstructions: string;
  hazardNotes: string;
  siteRecordStatus: string;
  planningCurrent: boolean;
  siteJurisdiction: string;
  plannedStart: string;
  programCode: string;
  claimOutputCode: string;
  claimOutputLabel: string;
  registryActivityCode: string;
  activityKey: string;
  activityTitle: string;
  serviceCategory: string;
  catalogueReviewedOn: string;
  status: string;
  complianceCaseId: string;
  updatedAt: string;
};

type AuditRecord = Record<string, unknown>;
type AuditGroupCursor = {
  value: string;
  id: string;
};
type AuditGroup = {
  key: string;
  label: string;
  rows: AuditRecord[];
  loaded: boolean;
  loading?: boolean;
  hasMore: boolean;
  nextCursor: AuditGroupCursor | null;
  retryCursor?: AuditGroupCursor | null;
  error?: string;
};
type ServiceSiteAddressProvenance = {
  entryMode: string;
  provider: string;
  providerReference: string;
  formattedAddress: string;
  verifiedAt: string;
  status: "provider_verified" | "manual_review_required";
  reviewRequired: boolean;
};
type AuditWorkspace = {
  intent: AuditRecord | null;
  workOrder: AuditRecord | null;
  jobDetails: AuditRecord | null;
  installer: AuditRecord | null;
  customer: AuditRecord | null;
  serviceSite: AuditRecord | null;
  serviceSiteAddressProvenance: ServiceSiteAddressProvenance;
  groups: AuditGroup[];
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

function money(cents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

function humanField(field: string) {
  return field
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function auditValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "Not recorded";
  }
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  const text = String(value);
  if (
    (text.startsWith("{") && text.endsWith("}"))
    || (text.startsWith("[") && text.endsWith("]"))
  ) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

function AuditRecordView({
  title,
  record,
}: {
  title: string;
  record: AuditRecord | null;
}) {
  return <section className={styles.auditRecord}>
    <h4>{title}</h4>
    {record
      ? <dl>{Object.entries(record).map(([field, value]) => <div key={field}>
        <dt>{humanField(field)}</dt>
        <dd>{auditValue(value)}</dd>
      </div>)}</dl>
      : <p>No record is currently stored.</p>}
  </section>;
}

function AddressProvenanceView({
  provenance,
}: {
  provenance: ServiceSiteAddressProvenance;
}) {
  return <section className={`${styles.auditRecord} ${provenance.reviewRequired
    ? styles.addressReviewRequired
    : styles.addressProviderVerified}`}>
    <div className={styles.addressProvenanceHeading}>
      <h4>Service-site address provenance</h4>
      <strong>{provenance.reviewRequired
        ? "Manual address: review required"
        : "Provider-selected address"}</strong>
    </div>
    <p>{provenance.reviewRequired
      ? "This address was entered manually. Creditex must compare it with the job evidence before relying on it for compliance."
      : "This address was selected from the configured provider and retains its provider reference for audit."}</p>
    <dl>
      <div><dt>Entry mode</dt><dd>{humanField(provenance.entryMode)}</dd></div>
      <div><dt>Provider</dt><dd>{provenance.provider || "No provider: manual entry"}</dd></div>
      <div><dt>Provider reference</dt><dd>{provenance.providerReference || "Not recorded"}</dd></div>
      <div><dt>Formatted address</dt><dd>{provenance.formattedAddress || "Not recorded"}</dd></div>
      <div><dt>Verified at</dt><dd>{provenance.verifiedAt
        ? dateTime(provenance.verifiedAt)
        : "Not verified"}</dd></div>
    </dl>
  </section>;
}

function itemStatus(item: PlannedIntake) {
  if (item.status === "case_linked") return "Case linked";
  if (item.status === "superseded") return "Superseded history";
  if (!item.planningCurrent) return "Re-plan required";
  return "Setup required";
}

export function CreditexPlannedIntakeQueue({ api }: { api: Api }) {
  const [items, setItems] = useState<PlannedIntake[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<QueueStatus>("all");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<QueueSort>("plannedStart");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [auditItem, setAuditItem] = useState<PlannedIntake | null>(null);
  const [audit, setAudit] = useState<AuditWorkspace | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditMessage, setAuditMessage] = useState("");
  const requestSequence = useRef(0);
  const auditSequence = useRef(0);
  const auditHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const auditLauncherRef = useRef<HTMLButtonElement | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const tableScroll = useRef({ top: 0, left: 0 });

  const load = useCallback(async () => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setLoading(true);
    setMessage("");
    try {
      const query = new URLSearchParams({
        status,
        search,
        page: String(page),
        sort,
        sortDirection,
      });
      for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
      const result = await api(`/api/creditex/job-intents?${query}`);
      if (result.ok !== true) {
        throw new Error(
          String(result.error || "The planned work queue could not be loaded."),
        );
      }
      if (requestId !== requestSequence.current) return;
      setItems((result.items || []) as PlannedIntake[]);
      setTotal(Number(result.total || 0));
      setTotalPages(Math.max(1, Number(result.totalPages || 1)));
      const returnedPage = Math.max(1, Number(result.page || 1));
      if (returnedPage !== page) setPage(returnedPage);
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      setItems([]);
      setTotal(0);
      setTotalPages(1);
      setMessage(
        error instanceof Error
          ? error.message
          : "The planned work queue could not be loaded.",
      );
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [api, page, search, status, filters, sort, sortDirection]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openAudit = useCallback(async (item: PlannedIntake, launcher: HTMLButtonElement) => {
    const requestId = auditSequence.current + 1;
    auditSequence.current = requestId;
    auditLauncherRef.current = launcher;
    if (tableRef.current) tableScroll.current = { top: tableRef.current.scrollTop, left: tableRef.current.scrollLeft };
    setAuditItem(item);
    setAudit(null);
    setAuditMessage("");
    setAuditLoading(true);
    try {
      const result = await api(
        `/api/creditex/job-intents/${encodeURIComponent(item.id)}`,
      );
      if (result.ok !== true) {
        throw new Error(
          String(result.error || "The full audit workspace could not be opened."),
        );
      }
      if (requestId !== auditSequence.current) return;
      setAudit({
        intent: (result.intent || null) as AuditRecord | null,
        workOrder: (result.workOrder || null) as AuditRecord | null,
        jobDetails: (result.jobDetails || null) as AuditRecord | null,
        installer: (result.installer || null) as AuditRecord | null,
        customer: (result.customer || null) as AuditRecord | null,
        serviceSite: (result.serviceSite || null) as AuditRecord | null,
        serviceSiteAddressProvenance: result.serviceSiteAddressProvenance as ServiceSiteAddressProvenance,
        groups: ((result.groups || []) as AuditGroup[]).map((group) => ({
          ...group,
          rows: group.rows || [],
          loaded: group.loaded === true,
          loading: false,
          hasMore: group.hasMore === true,
          nextCursor: group.nextCursor?.value && group.nextCursor?.id
            ? group.nextCursor
            : null,
          retryCursor: null,
        })),
      });
    } catch (error) {
      if (requestId !== auditSequence.current) return;
      setAuditMessage(
        error instanceof Error
          ? error.message
          : "The full audit workspace could not be opened.",
      );
    } finally {
      if (requestId === auditSequence.current) {
        setAuditLoading(false);
        window.requestAnimationFrame(() => auditHeadingRef.current?.focus());
      }
    }
  }, [api]);

  const loadAuditGroup = useCallback(async (
    groupKey: string,
    cursor: AuditGroupCursor | null = null,
  ) => {
    const itemId = auditItem?.id;
    const requestId = auditSequence.current;
    if (!itemId) return;
    setAudit((current) => current
      ? {
        ...current,
        groups: current.groups.map((group) => group.key === groupKey
          ? { ...group, loading: true, error: "" }
          : group),
      }
      : current);
    try {
      const query = new URLSearchParams({ group: groupKey });
      if (cursor) {
        query.set("cursorValue", cursor.value);
        query.set("cursorId", cursor.id);
      }
      const result = await api(
        `/api/creditex/job-intents/${encodeURIComponent(itemId)}?${query}`,
      );
      if (result.ok !== true) {
        throw new Error(
          String(result.error || "This audit record group could not be loaded."),
        );
      }
      const loadedGroup = ((result.groups || []) as AuditGroup[])
        .find((group) => group.key === groupKey && group.loaded === true);
      if (!loadedGroup) {
        throw new Error("The requested audit record group was not returned.");
      }
      if (requestId !== auditSequence.current) return;
      setAudit((current) => current
        ? {
          ...current,
          groups: current.groups.map((group) => group.key === groupKey
            ? {
              ...group,
              rows: cursor
                ? [...group.rows, ...(loadedGroup.rows || [])]
                : (loadedGroup.rows || []),
              loaded: true,
              loading: false,
              hasMore: loadedGroup.hasMore === true,
              nextCursor: loadedGroup.nextCursor?.value
                && loadedGroup.nextCursor?.id
                ? loadedGroup.nextCursor
                : null,
              retryCursor: null,
              error: "",
            }
            : group),
        }
        : current);
    } catch (error) {
      if (requestId !== auditSequence.current) return;
      setAudit((current) => current
        ? {
          ...current,
          groups: current.groups.map((group) => group.key === groupKey
            ? {
              ...group,
              loading: false,
              retryCursor: cursor,
              error: error instanceof Error
                ? error.message
                : "This audit record group could not be loaded.",
            }
            : group),
        }
        : current);
    }
  }, [api, auditItem?.id]);

  function closeAudit() {
    const launcher = auditLauncherRef.current;
    const returnJobId = auditItem?.id;
    auditSequence.current += 1;
    setAuditItem(null);
    setAudit(null);
    setAuditMessage("");
    setAuditLoading(false);
    auditLauncherRef.current = null;
    window.requestAnimationFrame(() => {
      if (tableRef.current) { tableRef.current.scrollTop = tableScroll.current.top; tableRef.current.scrollLeft = tableScroll.current.left; }
      if (launcher?.isConnected) launcher.focus({ preventScroll: true });
      else if (returnJobId) document.getElementById(`creditex-job-${returnJobId}`)?.focus({ preventScroll: true });
    });
  }

  function changeFilter(key: keyof typeof EMPTY_FILTERS, value: string) {
    setFilters((current) => ({ ...current, [key]: value })); setPage(1);
  }

  function resetFilters() {
    setSearch(""); setStatus("all"); setFilters(EMPTY_FILTERS); setPage(1); setSort("plannedStart"); setSortDirection("asc");
  }

  function sortableHeading(label: string, key: QueueSort) {
    return <th scope="col" aria-sort={sort === key ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button type="button" onClick={() => {
      setSort(key); setSortDirection(sort === key && sortDirection === "asc" ? "desc" : "asc"); setPage(1);
    }}>{label}<span aria-hidden="true">{sort === key ? sortDirection === "asc" ? " ↑" : " ↓" : " ↕"}</span></button></th>;
  }

  function filterInput(key: keyof typeof EMPTY_FILTERS, label: string, placeholder: string, type = "search") {
    return <input aria-label={label} type={type} placeholder={placeholder} value={filters[key]} onChange={(event) => changeFilter(key, event.target.value)} />;
  }

  function filterSelect(key: keyof typeof EMPTY_FILTERS, label: string, allLabel: string, options: string[]) {
    return <select aria-label={label} value={filters[key]} onChange={(event) => changeFilter(key, event.target.value)}><option value="">{allLabel}</option>{options.map((value) => <option key={value} value={value}>{humanField(value)}</option>)}</select>;
  }

  const activeFilters = Object.values(filters).filter(Boolean).length + (status !== "all" ? 1 : 0);
  const auditCustomerName = String(audit?.customer?.business_name || "").trim()
    || [audit?.customer?.first_name, audit?.customer?.last_name].filter((value) => typeof value === "string" && value.trim()).join(" ");
  const auditAddress = [audit?.serviceSite?.address_line_1, audit?.serviceSite?.address_line_2, audit?.serviceSite?.suburb, audit?.serviceSite?.address_state, audit?.serviceSite?.postcode]
    .filter((value) => typeof value === "string" && value.trim()).join(", ");

  return <section
    className={styles.queue}
    aria-labelledby={auditItem ? "creditex-full-audit-title" : "creditex-planned-intake-title"}
  >
    {!auditItem && <>
    <header>
      <div>
        <span>Creditex work register</span>
        <h2 id="creditex-planned-intake-title">Jobs</h2>
        <p>Find a job, review its records and call the customer from their audit workspace.</p>
      </div>
      <strong>{loading ? "Loading" : `${total} jobs`}</strong>
    </header>
    <div className={styles.controls}>
      <label><span>Search jobs</span><input
        type="search"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
        placeholder="Job, customer, installer, site, type or activity"
      /></label>
      <label><span>Record status</span><select
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
      </select></label>
      <button type="button" className={styles.filterToggle} aria-expanded={showFilters} aria-controls="creditex-job-filters" onClick={() => setShowFilters((current) => !current)}>Filters{activeFilters ? ` (${activeFilters})` : ""}</button>
      <button type="button" onClick={() => void load()} disabled={loading}>Refresh</button>
    </div>
    <div className={styles.resultBar} aria-live="polite"><span>{loading ? "Updating jobs..." : `${total} matching ${total === 1 ? "job" : "jobs"}${totalPages > 1 ? ` · Page ${page} of ${totalPages}` : ""}`}{!loading && activeFilters ? ` · ${activeFilters} filters applied` : ""}</span>{(search || activeFilters || sort !== "plannedStart" || sortDirection !== "asc") && <button type="button" className={styles.detailButton} onClick={resetFilters}>Reset filters & sort</button>}</div>
    {message && <p className={styles.message} role="alert">{message}</p>}
    {(!message || showFilters) && ((items.length || showFilters)
      ? <div ref={tableRef} className={styles.tableWrap} aria-busy={loading} tabIndex={0} role="region" aria-label="Assigned jobs. Scroll horizontally for all columns."><table>
        <thead><tr>{sortableHeading("Job", "jobNumber")}{sortableHeading("Customer", "customerName")}{sortableHeading("Installer", "installerBusiness")}{sortableHeading("Program & activity", "programCode")}<th scope="col">Service site</th>{sortableHeading("Planned", "plannedStart")}{sortableHeading("Stage & priority", "jobStage")}<th scope="col">Quote & invoice</th>{sortableHeading("Status / updated", "updatedAt")}</tr>
          {showFilters && <tr className={styles.columnFilters} id="creditex-job-filters">
            <td>{filterInput("job", "Filter job", "Job number or title")}</td>
            <td>{filterInput("customer", "Filter customer", "Name, phone or email")}</td>
            <td>{filterInput("installer", "Filter installer", "Business name")}</td>
            <td>{filterInput("program", "Filter program", "Program code")}{filterInput("activity", "Filter activity", "Activity code or name")}</td>
            <td>{filterInput("serviceSite", "Filter service site", "Address or suburb")}</td>
            <td><label>From{filterInput("plannedFrom", "Planned from", "", "date")}</label><label>To{filterInput("plannedTo", "Planned to", "", "date")}</label></td>
            <td>{filterSelect("jobStage", "Filter job stage", "All stages", ["backlog", "ready", "scheduled", "in_progress", "blocked", "completed", "cancelled"])}{filterSelect("priority", "Filter priority", "All priorities", ["low", "standard", "high", "urgent"])}</td>
            <td>{filterSelect("quoteStatus", "Filter quote status", "All quotes", ["not_started", "draft", "issued", "sent", "accepted", "declined"])}{filterSelect("invoiceStatus", "Filter invoice status", "All invoices", ["not_started", "draft", "issued", "part_paid", "paid", "overdue", "void"])}</td>
            <td><small>Record status above</small><button type="button" className={styles.detailButton} onClick={resetFilters}>Reset all</button></td>
          </tr>}
        </thead>
        <tbody>{items.map((item) => <tr key={item.id}>
            <td>
              <button type="button" id={`creditex-job-${item.id}`} className={styles.jobButton} onClick={(event) => void openAudit(item, event.currentTarget)} aria-controls="creditex-full-audit-workspace">
                <strong>{item.jobNumber || item.jobId}</strong><span>{item.jobTitle || "Retained job record"}</span><small>Open job →</small>
              </button>
            </td>
            <td><strong>{item.customerName || "Retained customer"}</strong><small>{item.customerNumber}</small><small>{[item.customerPhone, item.customerEmail].filter(Boolean).join(" | ")}</small></td>
            <td>{item.installerBusiness}</td>
            <td><strong>{item.programCode} · {item.registryActivityCode || item.activityKey}</strong><small>{item.activityTitle}</small><small>{item.claimOutputCode} {item.claimOutputLabel}</small></td>
            <td><strong>{item.siteJurisdiction}</strong><small>{item.serviceAddress || "Retained site record"}</small></td>
            <td>{dateTime(item.plannedStart)}</td>
            <td><strong>{humanField(item.jobStage)}</strong><small data-priority={item.jobPriority}>{humanField(item.jobPriority)} priority</small><small>{item.assigneeLabel || "Unassigned"}</small></td>
            <td><strong>{money(item.quotedValueCents)} quoted</strong><small>{humanField(item.quoteStatus)}</small><small>{money(item.invoicedValueCents)} invoiced · {humanField(item.invoiceStatus)}</small></td>
            <td><span className={styles.status}>{itemStatus(item)}</span><small>{dateTime(item.updatedAt)}</small>{item.complianceCaseId && <small>Case linked</small>}</td>
          </tr>
        )}{!items.length && <tr><td colSpan={9}><div className={styles.empty}><strong>{loading ? "Loading jobs..." : "No matching jobs"}</strong><span>Change the column filters or reset your search.</span></div></td></tr>}</tbody>
      </table></div>
      : loading ? <p className={styles.message} role="status">Loading assigned jobs...</p> : <div className={styles.empty}><strong>No matching jobs</strong><span>Try a different search or reset the filters. Assigned installer jobs appear here when saved.</span></div>)}
    {!loading && !message && totalPages > 1 && <nav className={styles.pagination} aria-label="Certificate-work register pages">
      <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
      <span>Page {page} of {totalPages}</span>
      <button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button>
    </nav>}
    </>}
    {auditItem && <section id="creditex-full-audit-workspace" className={styles.auditWorkspace} aria-labelledby="creditex-full-audit-title">
      <header>
        <div>
          <span>Selected job</span>
          <h3 id="creditex-full-audit-title" tabIndex={-1} ref={auditHeadingRef}>
            {auditItem.jobNumber || auditItem.jobId} · {audit ? auditCustomerName || "Job audit" : auditItem.customerName || "Job audit"}
          </h3>
          <p>{auditItem.jobTitle || auditItem.activityTitle} · {auditItem.installerBusiness}</p>
        </div>
        <button type="button" onClick={closeAudit}>Back to jobs</button>
      </header>
      {auditLoading && <p className={styles.message} role="status">Loading the authorised job overview...</p>}
      {auditMessage && <p className={styles.message} role="alert">{auditMessage}</p>}
      {audit && <>
        <div className={styles.auditSummary}>
          <div><span>Customer</span><strong>{auditCustomerName || "Not recorded"}</strong><p>{String(audit.customer?.phone || "No phone recorded")}</p><p>{String(audit.customer?.email || "")}</p></div>
          <div><span>Service site</span><strong>{auditAddress || "Not recorded"}</strong><p>{dateTime(String(audit.intent?.planned_start || ""))}</p></div>
          <div><span>Activity</span><strong>{auditItem.programCode} · {auditItem.registryActivityCode || auditItem.activityKey}</strong><p>{auditItem.activityTitle}</p><p>{itemStatus(auditItem)}</p></div>
          <div><span>Next action</span><strong>{String(audit.jobDetails?.next_action || "Review the job records")}</strong><p>{humanField(String(audit.workOrder?.stage || "Not recorded"))} · {String(audit.workOrder?.assignee_label || "Unassigned")}</p></div>
        </div>
        {!auditLoading && audit.customer && typeof audit.customer.phone === "string" && audit.customer.phone.trim() && firebaseAuth.currentUser && <CreditexAuditCallPanel key={`${firebaseAuth.currentUser.uid}:${auditItem.id}`} user={firebaseAuth.currentUser} jobIntentId={auditItem.id} />}
        <details className={styles.fullDetails}><summary>Job, customer & site details <span>All saved fields and references</span></summary><div className={styles.auditCore}>
          <AuditRecordView title="Compliance intent" record={audit.intent} />
          <AuditRecordView title="Work order" record={audit.workOrder} />
          <AuditRecordView title="Job details" record={audit.jobDetails} />
          <AuditRecordView title="Installer business" record={audit.installer} />
          <AuditRecordView title="Customer" record={audit.customer} />
          <AuditRecordView title="Service site" record={audit.serviceSite} />
          <AddressProvenanceView provenance={audit.serviceSiteAddressProvenance} />
        </div></details>
        <div className={styles.auditGroups}>
          {audit.groups.map((group) => <details
            key={group.key}
            onToggle={(event) => {
              if (
                event.currentTarget.open
                && !group.loaded
                && !group.loading
                && !group.error
              ) {
                void loadAuditGroup(group.key);
              }
            }}
          >
            <summary><strong>{group.label}</strong><span>{
              group.loading
                ? "Loading..."
                : group.loaded
                  ? `${group.rows.length}${group.hasMore ? "+" : ""} records`
                  : "Open to load"
            }</span></summary>
            {group.error && <p className={styles.message} role="alert">
              {group.error}
              <button
                type="button"
                className={styles.detailButton}
                onClick={() => void loadAuditGroup(
                  group.key,
                  group.retryCursor || null,
                )}
              >Retry</button>
            </p>}
            {!group.loaded && !group.loading && !group.error
              && <p>Open this section to load its authorised records.</p>}
            {group.loading && <p role="status">Loading authorised records...</p>}
            {group.loaded && group.rows.length
              ? <div className={styles.auditGroupRows}>{group.rows.map((record, index) => <AuditRecordView
                key={String(record.id || `${group.key}-${index}`)}
                title={`${group.label} ${index + 1}`}
                record={record}
              />)}{group.hasMore && group.nextCursor !== null && <button
                type="button"
                className={styles.detailButton}
                disabled={group.loading}
                onClick={() => void loadAuditGroup(
                  group.key,
                  group.nextCursor,
                )}
              >Load 50 more records</button>}</div>
              : group.loaded
                ? <p>No records are stored for this job.</p>
                : null}
          </details>)}
        </div>
      </>}
    </section>}
  </section>;
}
