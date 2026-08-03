"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import styles from "./CreditexPlannedIntakeQueue.module.css";

type QueueStatus = "all" | "planned" | "case_linked" | "superseded";

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
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState("");
  const [auditItem, setAuditItem] = useState<PlannedIntake | null>(null);
  const [audit, setAudit] = useState<AuditWorkspace | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditMessage, setAuditMessage] = useState("");
  const requestSequence = useRef(0);
  const auditSequence = useRef(0);
  const auditHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const auditLauncherRef = useRef<HTMLButtonElement | null>(null);

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
      });
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
      setExpandedId("");
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
  }, [api, page, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openAudit = useCallback(async (item: PlannedIntake, launcher: HTMLButtonElement) => {
    const requestId = auditSequence.current + 1;
    auditSequence.current = requestId;
    auditLauncherRef.current = launcher;
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
    auditSequence.current += 1;
    setAuditItem(null);
    setAudit(null);
    setAuditMessage("");
    setAuditLoading(false);
    auditLauncherRef.current = null;
    window.requestAnimationFrame(() => {
      if (launcher?.isConnected) launcher.focus();
    });
  }

  return <section
    className={styles.queue}
    aria-labelledby="creditex-planned-intake-title"
  >
    <header>
      <div>
        <span>Installer handoff</span>
        <h2 id="creditex-planned-intake-title">Certificate-work register</h2>
        <p>Creditex can inspect every assigned installer job, customer, service site and retained workflow record from planning onward. Regulated audit actions open only after the exact governed activity and evidence policy are verified.</p>
      </div>
      <strong>{loading ? "Loading" : `${total} jobs`}</strong>
    </header>
    <div className={styles.controls}>
      <label><span>Search all assigned work</span><input
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
        <option value="all">All retained records</option>
        <option value="planned">Waiting for governed intake</option>
        <option value="case_linked">Converted to a case</option>
        <option value="superseded">Superseded planning history</option>
      </select></label>
      <button type="button" onClick={() => void load()} disabled={loading}>Refresh</button>
    </div>
    {message && <p className={styles.message} role="alert">{message}</p>}
    {!loading && !message && (items.length
      ? <div className={styles.tableWrap}><table>
        <thead><tr><th>Job</th><th>Customer</th><th>Installer</th><th>Certificate or support type</th><th>Program and activity</th><th>Service site</th><th>Planned</th><th>Status</th></tr></thead>
        <tbody>{items.map((item) => <Fragment key={item.id}>
          <tr>
            <td>
              <strong>{item.jobNumber || item.jobId}</strong>
              <small>{item.jobTitle || "Retained job record"}</small>
              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.detailButton}
                  onClick={() => setExpandedId((current) => current === item.id ? "" : item.id)}
                  aria-expanded={expandedId === item.id}
                >{expandedId === item.id ? "Hide summary" : "View summary"}</button>
                <button
                  type="button"
                  className={styles.detailButton}
                  onClick={(event) => void openAudit(item, event.currentTarget)}
                  aria-controls="creditex-full-audit-workspace"
                  aria-expanded={auditItem?.id === item.id}
                >Open full audit workspace</button>
              </div>
            </td>
            <td><strong>{item.customerName || "Retained customer"}</strong><small>{item.customerNumber}</small><small>{[item.customerPhone, item.customerEmail].filter(Boolean).join(" | ")}</small></td>
            <td>{item.installerBusiness}</td>
            <td><strong>{item.claimOutputCode || "Program support"}</strong><small>{item.claimOutputLabel}</small></td>
            <td><strong>{item.programCode} | {item.registryActivityCode || item.activityKey}</strong><small>{item.activityTitle}</small></td>
            <td><strong>{item.siteJurisdiction}</strong><small>{item.serviceAddress || "Retained site record"}</small></td>
            <td>{dateTime(item.plannedStart)}</td>
            <td><span className={styles.status}>{itemStatus(item)}</span>{item.complianceCaseId && <small>Case {item.complianceCaseId}</small>}</td>
          </tr>
          {expandedId === item.id && <tr
            key={`${item.id}-details`}
            className={styles.detailRow}
          ><td colSpan={8}><div className={styles.detailGrid}>
            <section><span>Job</span><strong>{item.jobStage.replaceAll("_", " ")} | {item.pipelineStage.replaceAll("_", " ")} | {item.jobPriority}</strong><small>{item.jobDescription || "No scope description yet."}</small><small>Assigned to {item.assigneeLabel || "unassigned"} | {item.buildingType.replaceAll("_", " ")}</small><small>Record state: {item.workRecordStatus} / {item.jobDetailRecordStatus}</small></section>
            <section><span>Customer</span><strong>{item.customerName} | {item.customerType}</strong><small>{item.businessNumber ? `Business number ${item.businessNumber}` : "No business number"}</small><small>{item.customerPrivateNotes || "No private customer notes."}</small><small>Record state: {item.customerRecordStatus}</small></section>
            <section><span>Service site</span><strong>{item.siteLabel} | {item.serviceAddress}</strong><small>Access: {item.accessInstructions || "none recorded"}</small><small>Parking: {item.parkingInstructions || "none recorded"} | Hazards: {item.hazardNotes || "none recorded"}</small><small>Record state: {item.siteRecordStatus}</small></section>
            <section><span>Appointment</span><strong>{dateTime(item.scheduledStart)} to {dateTime(item.scheduledEnd)}</strong><small>Planned activity date: {dateTime(item.plannedStart)}</small><small>Next action: {item.nextAction || "none recorded"}</small></section>
            <section><span>Commercial</span><strong>Quote {item.quoteStatus.replaceAll("_", " ")} | Invoice {item.invoiceStatus.replaceAll("_", " ")}</strong><small>Estimate {money(item.estimatedValueCents)} | Quote {money(item.quotedValueCents)}</small><small>Invoiced {money(item.invoicedValueCents)} | Paid {money(item.paidValueCents)}</small></section>
            <section><span>References</span><strong>Intent {item.id}</strong><small>Planning snapshot: {item.planningCurrent ? "current" : "stale - the live job changed"}</small><small>Job {item.jobId} | catalogue reviewed {item.catalogueReviewedOn}</small><small>Job tags {item.jobTags} | customer tags {item.customerTags}</small></section>
          </div></td></tr>}
        </Fragment>)}</tbody>
      </table></div>
      : <div className={styles.empty}><strong>No matching assigned work</strong><span>Change the retained-record filter or search. New planned activity choices appear here as soon as an installer saves the job.</span></div>)}
    {!loading && !message && totalPages > 1 && <nav className={styles.pagination} aria-label="Certificate-work register pages">
      <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
      <span>Page {page} of {totalPages}</span>
      <button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button>
    </nav>}
    {auditItem && <section id="creditex-full-audit-workspace" className={styles.auditWorkspace} aria-labelledby="creditex-full-audit-title">
      <header>
        <div>
          <span>Authorised job audit</span>
          <h3 id="creditex-full-audit-title" tabIndex={-1} ref={auditHeadingRef}>
            {auditItem.jobNumber || auditItem.jobId} audit workspace
          </h3>
          <p>The job, customer, installer and service site are shown first. Open each retained domain below to load its bounded commercial, field, evidence and audit records. Delivery tokens and authentication secrets are never exposed.</p>
        </div>
        <button type="button" onClick={closeAudit}>Close workspace</button>
      </header>
      {auditLoading && <p className={styles.message} role="status">Loading the authorised job overview...</p>}
      {auditMessage && <p className={styles.message} role="alert">{auditMessage}</p>}
      {audit && <>
        <div className={styles.auditCore}>
          <AuditRecordView title="Compliance intent" record={audit.intent} />
          <AuditRecordView title="Work order" record={audit.workOrder} />
          <AuditRecordView title="Job details" record={audit.jobDetails} />
          <AuditRecordView title="Installer business" record={audit.installer} />
          <AuditRecordView title="Customer" record={audit.customer} />
          <AuditRecordView title="Service site" record={audit.serviceSite} />
          <AddressProvenanceView provenance={audit.serviceSiteAddressProvenance} />
        </div>
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
