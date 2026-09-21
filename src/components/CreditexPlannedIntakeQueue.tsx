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
import { JobActionsButton, JobRowMenu, useJobRowMenu } from "./JobRowActions";
import { jobCreationDate } from "@/lib/job-register-dates";
import { CREDITEX_CERTIFICATE_TYPES } from "@/lib/creditex-certificate-types";

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
  customerFirstName: string;
  customerLastName: string;
  customerBusinessName: string;
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
  certificateType: string;
  caseNumber: string;
  caseStatus: string;
  evidenceStatus: string;
  siteSuburb: string;
  sitePostcode: string;
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
  const [queueError, setQueueError] = useState<{ query: string; text: string } | null>(null);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditItem, setAuditItem] = useState<PlannedIntake | null>(null);
  const [audit, setAudit] = useState<AuditWorkspace | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditMessage, setAuditMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [certificateType, setCertificateType] = useState("all");
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const filterLauncherRef = useRef<HTMLButtonElement | null>(null);
  const filterHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const { menu, openMenu, closeMenu } = useJobRowMenu();
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const loadTimer = useRef<number | null>(null);
  const auditSequence = useRef(0);
  const auditHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const auditLauncherRef = useRef<HTMLElement | null>(null);
  const callPanelRef = useRef<HTMLDivElement | null>(null);
  const focusCallRef = useRef(false);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const tableScroll = useRef({ top: 0, left: 0 });

  const query = new URLSearchParams({ status, search, certificateType, page: String(page), sort, sortDirection });
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

  const openAudit = useCallback(async (item: PlannedIntake, launcher: HTMLElement, focusCall = false) => {
    const requestId = auditSequence.current + 1;
    auditSequence.current = requestId;
    auditLauncherRef.current = launcher;
    focusCallRef.current = focusCall;
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
        window.requestAnimationFrame(() => {
          if (focusCallRef.current && callPanelRef.current) {
            callPanelRef.current.focus({ preventScroll: true });
            callPanelRef.current.scrollIntoView({ block: "nearest" });
          } else auditHeadingRef.current?.focus();
        });
      }
    }
  }, [api]);

  async function copyJobValue(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setActionMessage(`${label} copied.`); }
    catch { setActionMessage("Copy was unavailable. Select the text in the job details to copy it."); }
  }

  function rowActions(item: PlannedIntake, launcher: HTMLElement) {
    return [
      { label: "Open job audit", run: () => { void openAudit(item, launcher); } },
      ...(item.customerPhone ? [{ label: "Call customer", run: () => { void openAudit(item, launcher, true); } }] : []),
      { label: "Copy job reference", run: () => { void copyJobValue(item.jobNumber || item.jobId, "Job reference"); } },
      ...(item.serviceAddress ? [{ label: "Copy site address", run: () => { void copyJobValue(item.serviceAddress, "Site address"); } }] : []),
    ];
  }

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
      <strong>{updating ? "Loading" : !hasLoaded ? "Unavailable" : stale ? "Last loaded results" : `${total} ${total === 1 ? "record" : "records"}`}</strong>
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
      <label><span>Certificate type</span><select value={certificateType} onChange={(event) => {
        setCertificateType(event.target.value); setPage(1);
      }}>
        <option value="all">All types</option>
        <option value="certificates">All certificates & credits</option>
        {CREDITEX_CERTIFICATE_TYPES.map((type) => <option key={type} value={type}>{type === "VEEC" ? "VEEC (VEU)" : type}</option>)}
      </select></label>
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
      <button ref={filterLauncherRef} type="button" className={styles.filterToggle} aria-expanded={showFilters} aria-controls="creditex-job-filters" onClick={toggleFilters}>Filters{activeFilters ? ` (${activeFilters})` : ""}</button>
      <button type="button" onClick={() => void load()} disabled={updating}>Refresh</button>
    </div>
    <div className={styles.resultBar} aria-live="polite"><span>{updating ? "Updating jobs..." : message ? hasLoaded ? `${items.length} previously loaded ${items.length === 1 ? "record" : "records"} shown` : "Job count unavailable" : `${total} matching ${total === 1 ? "record" : "records"}${totalPages > 1 ? ` · Page ${page} of ${totalPages}` : ""}`}{!updating && !message && activeFilters ? ` · ${activeFilters} filters applied` : ""}</span>{(search || activeFilters || sort !== "plannedStart" || sortDirection !== "asc") && <button type="button" className={styles.detailButton} onClick={resetFilters}>Reset filters & sort</button>}</div>
    <p className={styles.tableHint}>Each row is a job activity. Click its Job ID to open it, or right-click for options. Scroll across for all details.</p>
    {actionMessage && <p className={styles.tableHint} role="status">{actionMessage}</p>}
    {message && <div className={`${styles.message} ${styles.loadError}`} role="alert"><div><strong>{hasLoaded ? "Jobs could not be updated" : "Jobs could not be loaded"}</strong><p>{message}</p>{hasLoaded && <p>Showing the last loaded results. They may not match the current filters.</p>}</div><button type="button" onClick={() => void load()} disabled={updating}>Retry</button></div>}
      <div ref={tableRef} className={styles.tableWrap} aria-busy={updating} data-stale={stale || undefined} tabIndex={0} role="region" aria-label="Assigned jobs. Scroll horizontally for all columns."><table>
        <thead><tr>{sortableHeading("Job ID", "jobNumber")}{sortableHeading("Created", "createdAt")}{sortableHeading("Certificate", "certificateType")}{sortableHeading("First name", "customerFirstName")}{sortableHeading("Last name", "customerLastName")}<th scope="col">Job title</th>{sortableHeading("Stage", "jobStage")}<th scope="col">Case number</th><th scope="col">Case status</th><th scope="col">Evidence status</th>{sortableHeading("Program", "programCode")}<th scope="col">Activity code</th><th scope="col">Activity name</th><th scope="col">Service</th>{sortableHeading("Installer", "installerBusiness")}<th scope="col">Phone</th><th scope="col">Email</th><th scope="col">Customer ID</th><th scope="col">Business</th><th scope="col">ABN</th><th scope="col">Service address</th><th scope="col">Suburb</th><th scope="col">State</th><th scope="col">Postcode</th>{sortableHeading("Planned", "plannedStart")}<th scope="col">Scheduled end</th>{sortableHeading("Priority", "priority")}<th scope="col">Assigned to</th><th scope="col">Quote amount</th><th scope="col">Quote status</th><th scope="col">Invoice amount</th><th scope="col">Invoice status</th><th scope="col">Paid</th><th scope="col">Record status</th><th scope="col">Next action</th>{sortableHeading("Updated", "updatedAt")}</tr></thead>
        <tbody>{items.map((item) => <tr key={item.id} onContextMenu={event => { if (!updating) openMenu(event, `creditex-job-menu-${item.id}`, item.jobNumber || item.jobId, launcher => rowActions(item, launcher)); }}>
            <td><div className={styles.jobActions}>
              <button type="button" id={`creditex-job-${item.id}`} className={styles.jobButton} onClick={(event) => void openAudit(item, event.currentTarget)} aria-label={`Open job ${item.jobNumber || item.jobId}`} aria-controls="creditex-full-audit-workspace">{item.jobNumber || item.jobId}</button>
              <JobActionsButton label={item.jobNumber || item.jobId} menuId={`creditex-job-menu-${item.id}`} expanded={menu?.id === `creditex-job-menu-${item.id}`} onClick={event => openMenu(event, `creditex-job-menu-${item.id}`, item.jobNumber || item.jobId, launcher => rowActions(item, launcher))} />
            </div></td>
            <td title="Job creation date in Australia/Sydney">{jobCreationDate(item.createdAt)}</td>
            <td title={item.claimOutputLabel || undefined}><strong>{item.certificateType || item.claimOutputCode || "Not recorded"}</strong></td>
            <td>{item.customerFirstName || "Not recorded"}</td>
            <td>{item.customerLastName || "Not recorded"}</td>
            <td className={styles.longCell} title={item.jobTitle}>{item.jobTitle || "Retained job record"}</td>
            <td>{humanField(item.jobStage)}</td>
            <td>{item.caseNumber || "No case"}</td>
            <td>{item.caseStatus ? humanField(item.caseStatus) : "No case"}</td>
            <td>{item.evidenceStatus ? humanField(item.evidenceStatus) : "No case"}</td>
            <td>{item.programCode}</td>
            <td>{item.registryActivityCode || item.activityKey}</td>
            <td className={styles.longCell} title={item.activityTitle}>{item.activityTitle || "Not recorded"}</td>
            <td>{humanField(item.serviceCategory || "")}</td>
            <td>{item.installerBusiness || "Not recorded"}</td>
            <td>{item.customerPhone || "Not recorded"}</td>
            <td>{item.customerEmail || "Not recorded"}</td>
            <td>{item.customerNumber}</td>
            <td>{item.customerBusinessName || "Not recorded"}</td>
            <td>{item.businessNumber || "Not recorded"}</td>
            <td>{item.serviceAddress || "Retained site record"}</td>
            <td>{item.siteSuburb || "Not recorded"}</td>
            <td>{item.siteJurisdiction}</td>
            <td>{item.sitePostcode || "Not recorded"}</td>
            <td>{dateTime(item.plannedStart)}</td>
            <td>{dateTime(item.scheduledEnd)}</td>
            <td><span className={styles.priority} data-priority={item.jobPriority}>{humanField(item.jobPriority)}</span></td>
            <td>{item.assigneeLabel || "Unassigned"}</td>
            <td className={styles.moneyCell}>{money(item.quotedValueCents)}</td>
            <td>{humanField(item.quoteStatus)}</td>
            <td className={styles.moneyCell}>{money(item.invoicedValueCents)}</td>
            <td>{humanField(item.invoiceStatus)}</td>
            <td className={styles.moneyCell}>{money(item.paidValueCents)}</td>
            <td><span className={styles.status}>{itemStatus(item)}</span></td>
            <td className={styles.longCell} title={item.nextAction}>{item.nextAction || "Not recorded"}</td>
            <td>{item.updatedAt ? dateTime(item.updatedAt) : "Not recorded"}</td>
          </tr>
        )}{!items.length && <tr><td colSpan={36}><div className={styles.empty}><strong>{updating ? "Loading jobs..." : message ? "Results unavailable for these filters" : "No matching jobs"}</strong><span>{message ? "Retry or adjust the filters." : "Change the filters or reset your search."}</span></div></td></tr>}</tbody>
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
          <details><summary>Quotes & invoices</summary><div className={styles.filterGroup}>
            <label>Quote status{filterSelect("quoteStatus", "Filter quote status", "All quotes", ["not_started", "draft", "issued", "sent", "accepted", "declined"])}</label>
            <label>Invoice status{filterSelect("invoiceStatus", "Filter invoice status", "All invoices", ["not_started", "draft", "issued", "part_paid", "paid", "overdue", "void"])}</label>
          </div></details>
        </div>
        <footer><button type="button" onClick={resetFilters}>Clear filters</button><button type="submit">Search</button></footer>
      </form>
    </aside>}
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
        {!auditLoading && audit.customer && typeof audit.customer.phone === "string" && audit.customer.phone.trim() && firebaseAuth.currentUser && <div ref={callPanelRef} tabIndex={-1} className={styles.callTarget} aria-label="Customer audit call controls"><CreditexAuditCallPanel key={`${firebaseAuth.currentUser.uid}:${auditItem.id}`} user={firebaseAuth.currentUser} jobIntentId={auditItem.id} /></div>}
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
    <JobRowMenu menu={menu} onClose={closeMenu} />
  </section>;
}
