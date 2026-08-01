"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./CreditexVeuPilotWorkspace.module.css";

type Api = (
  path: string,
  init?: RequestInit,
) => Promise<Record<string, unknown>>;

type PilotJob = {
  id: string;
  caseNumber: string;
  jobNumber: string;
  activityTemplateId: string;
  registryActivityCode: string;
  specificationPart: string;
  title: string;
  serviceCategory: string;
  productCategory: string;
  scenarioCode: string;
  scenario: string;
  catalogueState: string;
  activityDate: string;
  recordMode: string;
  ruleStatus: string;
  lookupStatus: string;
  evidenceStatus: string;
  calculatorStatus: string;
  connectorStatus: string;
  reviewStatus: string;
  updatedAt: string;
  installer: {
    id: string;
    companyCode: string;
    businessName: string;
  };
  technician: {
    id: string;
    technicianCode: string;
    displayName: string;
  };
};

type PilotSnapshot = {
  configured: boolean;
  confirmationPhrase: string;
  archiveConfirmationPhrase?: string;
  previousRun?: {
    id: string;
    name: string;
    seedVersion: string;
    recordMode: string;
    status: string;
    activityCatalogueSha256: string;
    sourceManifestSha256: string;
    activatedAt: string;
    archivedAt: string;
    updatedAt: string;
  } | null;
  run?: {
    id: string;
    name: string;
    seedVersion: string;
    recordMode: string;
    status: string;
    activityCatalogueSha256: string;
    sourceManifestSha256: string;
    activatedAt: string;
    updatedAt: string;
  };
  targets: {
    installers: number;
    technicians: number;
    jobs: number;
    techniciansPerInstaller: number;
    jobsPerTechnician: number;
    activityFamilies: number;
  };
  counts?: {
    installers: number;
    technicians: number;
    jobs: number;
    activities: number;
    sources: number;
    hashedSources: number;
    controlOptions: number;
    calculatorContracts: number;
    evidenceContracts: number;
    regulatedCases: number;
  };
  priorities: Array<{
    key: string;
    number: number;
    title: string;
    status: string;
    complete: boolean;
    boundary: string;
  }>;
  sources?: Array<{
    sourceKey: string;
    sourceKind: string;
    title: string;
    officialSourceUrl: string;
    officialVersion: string;
    effectiveFrom: string;
    effectiveTo: string;
    officialSourceSha256: string;
    hashStatus: string;
    verificationStatus: string;
    sourcePriority: number;
    capturedAt: string;
  }>;
  controls?: Record<string, Array<{
    code: string;
    label: string;
    liveLookupEnabled: boolean;
  }>>;
  evidenceContracts?: Array<{
    requirementCode: string;
    title: string;
    evidenceKind: string;
    captureTiming: string;
    originalRequired: boolean;
    metadataRequired: boolean;
    gpsRequired: boolean;
    minimumCount: number;
    maximumCount: number;
    allowedContentTypes: string[];
    contractScope: string;
    governmentRequirementStatus: string;
    sourceKey: string;
  }>;
  calculatorSummary?: {
    total: number;
    verified: number;
    reconciledVectors: number;
    executionEnabled: boolean;
    outputUnit: string;
  };
  connectors?: Array<{
    connectorCode: string;
    mappingVersion: string;
    mode: string;
    status: string;
    itemCount: number;
    acceptedCount: number;
    rejectedCount: number;
    unmatchedCount: number;
    duplicateCount: number;
    artifactSha256: string;
    externalSubmissionEnabled: boolean;
    updatedAt: string;
  }>;
  installers?: Array<{
    id: string;
    installerSlot: number;
    companyCode: string;
    businessName: string;
    status: string;
    technicianCount: number;
    jobCount: number;
  }>;
  technicians?: Array<{
    id: string;
    installerId: string;
    technicianSlot: number;
    technicianCode: string;
    displayName: string;
    status: string;
    jobCount: number;
  }>;
  activities?: Array<{
    activityTemplateId: string;
    registryActivityCode: string;
    specificationPart: string;
    title: string;
    serviceCategory: string;
    catalogueState: string;
    jobCount: number;
    verifiedJobCount: number;
  }>;
  jobs?: PilotJob[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
  events?: Array<{
    eventType: string;
    summary: string;
    createdAt: string;
  }>;
  filters: {
    reviewStatuses: string[];
    evidenceStatuses: string[];
    lookupStatuses: string[];
    pageSizes: number[];
  };
  boundaries?: {
    regulatedCasesCreated: number;
    firebaseTestUsersCreated: number;
    customerEmailsOrPhonesCreated: number;
    evidenceObjectsCreated: number;
    certificateLotsCreated: number;
    tradesCreated: number;
    settlementsCreated: number;
    externalSubmissionEnabled: boolean;
    fieldLoginStatus: string;
  };
};

type Filters = {
  installerId: string;
  technicianId: string;
  activityTemplateId: string;
  reviewStatus: string;
  evidenceStatus: string;
  lookupStatus: string;
  query: string;
  page: number;
  pageSize: 25 | 50 | 100;
};

const EMPTY_FILTERS: Filters = {
  installerId: "",
  technicianId: "",
  activityTemplateId: "",
  reviewStatus: "",
  evidenceStatus: "",
  lookupStatus: "",
  query: "",
  page: 0,
  pageSize: 50,
};

const PANELS = [
  ["overview", "Pilot control"],
  ["jobs", "Jobs"],
  ["sources", "Sources"],
  ["lookups", "Lookups"],
  ["evidence", "Evidence"],
  ["calculators", "Calculators"],
  ["connectors", "Connectors"],
] as const;

type Panel = typeof PANELS[number][0];

function readable(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateOnly(value: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function shortHash(value: string) {
  if (!value) return "Hash pending";
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function progress(value: number, target: number) {
  if (!target) return 0;
  return Math.min(100, Math.round((value / target) * 100));
}

export function CreditexVeuPilotWorkspace({
  api,
  role,
}: {
  api: Api;
  role: "admin" | "case_manager" | "reviewer" | "auditor";
}) {
  const [snapshot, setSnapshot] = useState<PilotSnapshot | null>(null);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [panel, setPanel] = useState<Panel>("overview");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [archiveConfirmation, setArchiveConfirmation] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [provisionProgress, setProvisionProgress] = useState("");
  const requestRef = useRef(0);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(filters.page),
      pageSize: String(filters.pageSize),
    });
    if (filters.installerId)
      params.set("installerId", filters.installerId);
    if (filters.technicianId)
      params.set("technicianId", filters.technicianId);
    if (filters.activityTemplateId)
      params.set("activityTemplateId", filters.activityTemplateId);
    if (filters.reviewStatus)
      params.set("reviewStatus", filters.reviewStatus);
    if (filters.evidenceStatus)
      params.set("evidenceStatus", filters.evidenceStatus);
    if (filters.lookupStatus)
      params.set("lookupStatus", filters.lookupStatus);
    if (filters.query) params.set("q", filters.query);
    return params.toString();
  }, [filters]);

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setBusy((current) => current || "load");
    setError("");
    try {
      const result = await api(`/api/creditex/pilot?${query}`);
      if (requestId !== requestRef.current) return;
      setSnapshot(result.pilot as PilotSnapshot);
    } catch (requestError) {
      if (requestId !== requestRef.current) return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The synthetic VEU pilot could not be loaded.",
      );
    } finally {
      if (requestId === requestRef.current) {
        setBusy((current) => current === "load" ? "" : current);
      }
    }
  }, [api, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectedJob = useMemo(
    () => snapshot?.jobs?.find((job) => job.id === selectedJobId) || null,
    [selectedJobId, snapshot?.jobs],
  );
  const visibleTechnicians = useMemo(
    () => (snapshot?.technicians || []).filter(
      (technician) =>
        !draftFilters.installerId
        || technician.installerId === draftFilters.installerId,
    ),
    [draftFilters.installerId, snapshot?.technicians],
  );

  async function runAction(body: Record<string, unknown>) {
    return api("/api/creditex/pilot", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async function provisionPilot() {
    if (!snapshot || role !== "admin") return;
    setBusy("provision");
    setError("");
    setNotice("");
    try {
      await runAction({
        action: "start",
        confirmation,
      });
      for (let cohort = 1; cohort <= 31; cohort += 1) {
        setProvisionProgress(
          `Provisioning technician cohort ${Math.min(cohort, 30)} of 30`,
        );
        const response = await runAction({ action: "provision_next" });
        const result = response.result as { complete?: boolean };
        if (result.complete) break;
      }
      setProvisionProgress("Validating the 300-job dry-run manifest");
      await runAction({ action: "finalise" });
      setConfirmation("");
      setProvisionProgress("");
      setNotice(
        "Created 10 synthetic installers, 30 assignment-only technicians and 300 VEU pilot jobs with a validated dry-run manifest.",
      );
      setFilters(EMPTY_FILTERS);
      setDraftFilters(EMPTY_FILTERS);
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "The synthetic pilot could not be provisioned.",
      );
    } finally {
      setBusy("");
      setProvisionProgress("");
    }
  }

  async function resumePilot() {
    setBusy("provision");
    setError("");
    setNotice("");
    try {
      for (let cohort = 1; cohort <= 31; cohort += 1) {
        setProvisionProgress(
          `Reconciling technician cohort ${Math.min(cohort, 30)} of 30`,
        );
        const response = await runAction({ action: "provision_next" });
        const result = response.result as { complete?: boolean };
        if (result.complete) break;
      }
      setProvisionProgress("Validating the 300-job dry-run manifest");
      await runAction({ action: "finalise" });
      setNotice(
        "The synthetic pilot is fully provisioned and its activation manifest is validated.",
      );
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "The synthetic pilot could not be resumed.",
      );
    } finally {
      setBusy("");
      setProvisionProgress("");
    }
  }

  async function archivePreviousPilot() {
    if (
      !snapshot?.previousRun
      || snapshot.previousRun.status === "archived"
      || role !== "admin"
    ) {
      return;
    }
    setBusy("archive");
    setError("");
    setNotice("");
    try {
      await runAction({
        action: "archive",
        confirmation: archiveConfirmation,
      });
      setArchiveConfirmation("");
      setNotice(
        "The previous synthetic VEU seed was deactivated. The current seed can now be created.",
      );
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "The previous synthetic pilot could not be archived.",
      );
    } finally {
      setBusy("");
    }
  }

  async function saveJob(
    job: PilotJob,
    next: {
      reviewStatus: string;
      evidenceStatus: string;
      lookupStatus: string;
    },
  ) {
    setBusy(`job:${job.id}`);
    setError("");
    setNotice("");
    try {
      await runAction({
        action: "update_job",
        jobId: job.id,
        expectedUpdatedAt: job.updatedAt,
        ...next,
      });
      setNotice(`${job.jobNumber} synthetic workflow status was audited.`);
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "The synthetic job status could not be updated.",
      );
    } finally {
      setBusy("");
    }
  }

  if (!snapshot) {
    return (
      <section className={styles.workspace} aria-label="VEU pilot">
        <div className={styles.loading}>
          {error || "Loading the controlled VEU pilot..."}
        </div>
      </section>
    );
  }

  const counts = snapshot.counts || {
    installers: 0,
    technicians: 0,
    jobs: 0,
    activities: 0,
    sources: 0,
    hashedSources: 0,
    controlOptions: 0,
    calculatorContracts: 0,
    evidenceContracts: 0,
    regulatedCases: 0,
  };
  const isProvisioning =
    snapshot.configured && snapshot.run?.status === "provisioning";
  const isActive = snapshot.run?.status === "active";

  return (
    <section className={styles.workspace} aria-label="VEU synthetic pilot">
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>CONTROLLED TEST ENVIRONMENT</span>
          <h2>Creditex VEU workflow pilot</h2>
          <p>
            Exercise every VEU activity family across synthetic installer
            records, field assignments and Creditex compliance workflow
            structure. Physical field capture is not enabled. These records
            can never become regulated cases, certificates, registry
            submissions, trades or settlements.
          </p>
        </div>
        <div className={styles.mode}>
          <span>Record mode</span>
          <strong>Synthetic test only</strong>
          <small>
            {snapshot.run
              ? `${readable(snapshot.run.status)} | ${snapshot.run.seedVersion}`
              : "Not created"}
          </small>
        </div>
      </header>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {provisionProgress && (
        <p className={styles.progressNotice} role="status">
          {provisionProgress}
        </p>
      )}

      <nav className={styles.panelTabs} aria-label="VEU pilot workspaces">
        {PANELS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={panel === key}
            data-selected={panel === key}
            onClick={() => setPanel(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {panel === "overview" && (
        <>
          <section className={styles.metrics} aria-label="Pilot population">
            {[
              ["Installers", counts.installers, snapshot.targets.installers],
              [
                "Field technicians",
                counts.technicians,
                snapshot.targets.technicians,
              ],
              ["VEU jobs", counts.jobs, snapshot.targets.jobs],
              [
                "Activity families",
                counts.activities,
                snapshot.targets.activityFamilies,
              ],
            ].map(([label, value, target]) => (
              <article key={String(label)}>
                <span>{label}</span>
                <strong>{value} / {target}</strong>
                <div>
                  <i
                    style={{
                      width: `${progress(Number(value), Number(target))}%`,
                    }}
                  />
                </div>
              </article>
            ))}
          </section>

          {!snapshot.configured
            && role === "admin"
            && snapshot.previousRun
            && snapshot.previousRun.status !== "archived"
            && (
              <section className={styles.createPanel}>
                <div>
                  <span>RULE VERSION CHANGE</span>
                  <h3>Archive the previous synthetic seed first</h3>
                  <p>
                    {snapshot.previousRun.seedVersion} remains{" "}
                    {readable(snapshot.previousRun.status)}. It is retained for
                    audit, but must be deactivated before the current
                    government-source seed can create a separate dataset.
                  </p>
                </div>
                <label>
                  Exact confirmation
                  <input
                    value={archiveConfirmation}
                    onChange={(event) =>
                      setArchiveConfirmation(event.target.value)}
                    placeholder={snapshot.archiveConfirmationPhrase}
                  />
                </label>
                <button
                  type="button"
                  disabled={
                    Boolean(busy)
                    || archiveConfirmation
                      !== snapshot.archiveConfirmationPhrase
                  }
                  onClick={() => void archivePreviousPilot()}
                >
                  Archive previous test seed
                </button>
              </section>
            )}

          {!snapshot.configured
            && role === "admin"
            && (!snapshot.previousRun
              || snapshot.previousRun.status === "archived")
            && (
            <section className={styles.createPanel}>
              <div>
                <span>ONE CONTROLLED DATASET</span>
                <h3>Create the 10 x 3 x 10 VEU pilot</h3>
                <p>
                  This creates 10 clearly marked synthetic installer companies,
                  three assignment-only technicians per company and ten jobs
                  per technician. It creates no Firebase field identities and
                  no real customer contact details.
                </p>
              </div>
              <label>
                Exact confirmation
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder={snapshot.confirmationPhrase}
                />
              </label>
              <button
                type="button"
                disabled={
                  Boolean(busy)
                  || confirmation !== snapshot.confirmationPhrase
                }
                onClick={() => void provisionPilot()}
              >
                Create and validate pilot
              </button>
            </section>
            )}

          {isProvisioning && role === "admin" && (
            <section className={styles.createPanel}>
              <div>
                <span>RESUMABLE PROVISIONING</span>
                <h3>Continue from the last complete technician cohort</h3>
                <p>
                  Each cohort contains one assignment-only technician and ten
                  jobs. Existing rows are compared and never replaced.
                </p>
              </div>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void resumePilot()}
              >
                Resume and validate
              </button>
            </section>
          )}

          <section className={styles.priorities}>
            {snapshot.priorities.map((priority) => (
              <article key={priority.key}>
                <span>{String(priority.number).padStart(2, "0")}</span>
                <div>
                  <h3>{priority.title}</h3>
                  <strong data-complete={priority.complete}>
                    {readable(priority.status)}
                  </strong>
                  <p>{priority.boundary}</p>
                </div>
              </article>
            ))}
          </section>

          <section className={styles.safety}>
            <div>
              <span>STRUCTURAL SAFETY CHECK</span>
              <h3>No test data can escape into live certificate operations</h3>
              <p>
                The database rejects any regulated compliance case or
                submission item linked to a synthetic pilot work order.
              </p>
            </div>
            <dl>
              <div>
                <dt>Regulated cases</dt>
                <dd>{snapshot.boundaries?.regulatedCasesCreated ?? 0}</dd>
              </div>
              <div>
                <dt>Firebase test users</dt>
                <dd>{snapshot.boundaries?.firebaseTestUsersCreated ?? 0}</dd>
              </div>
              <div>
                <dt>Certificates</dt>
                <dd>{snapshot.boundaries?.certificateLotsCreated ?? 0}</dd>
              </div>
              <div>
                <dt>External submission</dt>
                <dd>
                  {snapshot.boundaries?.externalSubmissionEnabled
                    ? "Enabled"
                    : "Blocked"}
                </dd>
              </div>
            </dl>
            <small>
              {snapshot.boundaries?.fieldLoginStatus
                || "Field login remains blocked until authorised test identities and devices exist."}
            </small>
          </section>

          {snapshot.installers && snapshot.installers.length > 0 && (
            <section className={styles.roster}>
              <div className={styles.sectionHeading}>
                <span>SYNTHETIC ROSTER</span>
                <h3>Installer companies and assigned workload</h3>
              </div>
              <div className={styles.rosterGrid}>
                {snapshot.installers.map((installer) => (
                  <button
                    key={installer.id}
                    type="button"
                    onClick={() => {
                      const next = {
                        ...EMPTY_FILTERS,
                        installerId: installer.id,
                      };
                      setDraftFilters(next);
                      setFilters(next);
                      setPanel("jobs");
                    }}
                  >
                    <span>{installer.companyCode}</span>
                    <strong>{installer.businessName}</strong>
                    <small>
                      {installer.technicianCount} technicians |{" "}
                      {installer.jobCount} jobs
                    </small>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className={styles.audit}>
            <div className={styles.sectionHeading}>
              <span>APPEND-ONLY HISTORY</span>
              <h3>Latest pilot control events</h3>
            </div>
            <div>
              {(snapshot.events || []).map((event, index) => (
                <article key={`${event.eventType}:${event.createdAt}:${index}`}>
                  <span>{dateOnly(event.createdAt)}</span>
                  <strong>{readable(event.eventType)}</strong>
                  <p>{event.summary}</p>
                </article>
              ))}
              {!snapshot.events?.length && <p>No pilot events yet.</p>}
            </div>
          </section>
        </>
      )}

      {panel === "jobs" && (
        <>
          <section className={styles.filters}>
            <label>
              Search
              <input
                value={draftFilters.query}
                placeholder="Job, case, activity, installer or technician"
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    query: event.target.value,
                  }))}
              />
            </label>
            <label>
              Installer
              <select
                value={draftFilters.installerId}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    installerId: event.target.value,
                    technicianId: "",
                  }))}
              >
                <option value="">All test installers</option>
                {(snapshot.installers || []).map((installer) => (
                  <option key={installer.id} value={installer.id}>
                    {installer.companyCode} | {installer.businessName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Field technician
              <select
                value={draftFilters.technicianId}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    technicianId: event.target.value,
                  }))}
              >
                <option value="">All test technicians</option>
                {visibleTechnicians.map((technician) => (
                  <option key={technician.id} value={technician.id}>
                    {technician.technicianCode} | {technician.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              VEU activity
              <select
                value={draftFilters.activityTemplateId}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    activityTemplateId: event.target.value,
                  }))}
              >
                <option value="">All activity families</option>
                {(snapshot.activities || []).map((activity) => (
                  <option
                    key={activity.activityTemplateId}
                    value={activity.activityTemplateId}
                  >
                    {activity.registryActivityCode} | {activity.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Evidence
              <select
                value={draftFilters.evidenceStatus}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    evidenceStatus: event.target.value,
                  }))}
              >
                <option value="">All evidence states</option>
                {snapshot.filters.evidenceStatuses.map((status) => (
                  <option key={status} value={status}>{readable(status)}</option>
                ))}
              </select>
            </label>
            <label>
              Lookup
              <select
                value={draftFilters.lookupStatus}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    lookupStatus: event.target.value,
                  }))}
              >
                <option value="">All lookup states</option>
                {snapshot.filters.lookupStatuses.map((status) => (
                  <option key={status} value={status}>{readable(status)}</option>
                ))}
              </select>
            </label>
            <label>
              Review
              <select
                value={draftFilters.reviewStatus}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    reviewStatus: event.target.value,
                  }))}
              >
                <option value="">All review states</option>
                {snapshot.filters.reviewStatuses.map((status) => (
                  <option key={status} value={status}>{readable(status)}</option>
                ))}
              </select>
            </label>
            <label>
              Page size
              <select
                value={draftFilters.pageSize}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    pageSize: Number(event.target.value) as 25 | 50 | 100,
                  }))}
              >
                {snapshot.filters.pageSizes.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </label>
            <div className={styles.filterActions}>
              <button
                type="button"
                onClick={() => {
                  setFilters({ ...draftFilters, page: 0 });
                  setSelectedJobId("");
                }}
              >
                Apply filters
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftFilters(EMPTY_FILTERS);
                  setFilters(EMPTY_FILTERS);
                  setSelectedJobId("");
                }}
              >
                Clear
              </button>
            </div>
          </section>

          <section className={styles.jobWorkspace}>
            <div className={styles.jobList}>
              <header>
                <div>
                  <span>VEU TEST WORK QUEUE</span>
                  <h3>
                    {snapshot.pagination?.total || 0} matching synthetic jobs
                  </h3>
                </div>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void load()}
                >
                  Refresh
                </button>
              </header>
              <div className={styles.jobRows} role="list">
                {(snapshot.jobs || []).map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    role="listitem"
                    data-selected={selectedJobId === job.id}
                    onClick={() => setSelectedJobId(job.id)}
                  >
                    <span className={styles.testBadge}>TEST</span>
                    <span>
                      <strong>{job.jobNumber}</strong>
                      <small>{job.caseNumber}</small>
                    </span>
                    <span>
                      <strong>{job.registryActivityCode}</strong>
                      <small>{job.title}</small>
                    </span>
                    <span>
                      <strong>{job.installer.companyCode}</strong>
                      <small>{job.technician.technicianCode}</small>
                    </span>
                    <span>
                      <strong>{readable(job.reviewStatus)}</strong>
                      <small>{readable(job.evidenceStatus)}</small>
                    </span>
                  </button>
                ))}
                {!snapshot.jobs?.length && (
                  <p className={styles.empty}>No synthetic jobs match.</p>
                )}
              </div>
              <footer>
                <button
                  type="button"
                  disabled={(snapshot.pagination?.page || 0) <= 0}
                  onClick={() => {
                    const next = {
                      ...filters,
                      page: Math.max(0, filters.page - 1),
                    };
                    setFilters(next);
                    setDraftFilters(next);
                    setSelectedJobId("");
                  }}
                >
                  Previous
                </button>
                <span>
                  Page {(snapshot.pagination?.page || 0) + 1} of{" "}
                  {Math.max(1, snapshot.pagination?.pageCount || 1)}
                </span>
                <button
                  type="button"
                  disabled={
                    (snapshot.pagination?.page || 0) + 1
                    >= (snapshot.pagination?.pageCount || 0)
                  }
                  onClick={() => {
                    const next = { ...filters, page: filters.page + 1 };
                    setFilters(next);
                    setDraftFilters(next);
                    setSelectedJobId("");
                  }}
                >
                  Next
                </button>
              </footer>
            </div>

            <aside className={styles.jobDetail}>
              {selectedJob ? (
                <PilotJobDetail
                  key={[
                    selectedJob.id,
                    selectedJob.reviewStatus,
                    selectedJob.evidenceStatus,
                    selectedJob.lookupStatus,
                    selectedJob.updatedAt,
                  ].join(":")}
                  job={selectedJob}
                  role={role}
                  busy={busy === `job:${selectedJob.id}`}
                  options={snapshot.filters}
                  onSave={(next) => void saveJob(selectedJob, next)}
                />
              ) : (
                <div className={styles.emptyDetail}>
                  <span>DELIBERATE ACCESS</span>
                  <h3>Select one test job</h3>
                  <p>
                    Open one synthetic record to inspect its installer,
                    technician, activity, evidence, lookup, calculator and
                    connector states.
                  </p>
                </div>
              )}
            </aside>
          </section>
        </>
      )}

      {panel === "sources" && (
        <section className={styles.dataPanel}>
          <div className={styles.sectionHeading}>
            <span>PRIORITY 01</span>
            <h3>Official VEU instrument hierarchy</h3>
            <p>
              Source capture is separate from independent verification. A hash
              is shown only where downloaded bytes were hashed during the
              research pass. The source bytes are not yet retained in TLink,
              so publication remains blocked.
            </p>
          </div>
          <div className={styles.sourceRows}>
            {(snapshot.sources || []).map((source) => (
              <article key={source.sourceKey}>
                <span>{source.sourcePriority}</span>
                <div>
                  <h4>{source.title}</h4>
                  <p>
                    {source.officialVersion || "Live source"}
                    {source.effectiveFrom
                      ? ` | Effective ${source.effectiveFrom}`
                      : ""}
                  </p>
                  <small>
                    {readable(source.hashStatus)} |{" "}
                    {readable(source.verificationStatus)}
                  </small>
                  <code>{shortHash(source.officialSourceSha256)}</code>
                </div>
                <a
                  href={source.officialSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open official source
                </a>
              </article>
            ))}
          </div>
        </section>
      )}

      {panel === "lookups" && (
        <section className={styles.dataPanel}>
          <div className={styles.sectionHeading}>
            <span>PRIORITY 02</span>
            <h3>Controlled operational lookup values</h3>
            <p>
              Every operator choice is a controlled dropdown. Live regulator
              and licence sources are disabled, so no job can be marked
              verified from a local assertion.
            </p>
          </div>
          <div className={styles.controlGrid}>
            {Object.entries(snapshot.controls || {}).map(
              ([controlType, options]) => (
                <article key={controlType}>
                  <h4>{readable(controlType)}</h4>
                  <select aria-label={readable(controlType)} defaultValue="">
                    <option value="">Choose a controlled value</option>
                    {options.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <small>
                    Live lookup:{" "}
                    {options.some((option) => option.liveLookupEnabled)
                      ? "Enabled"
                      : "Blocked pending authorised source"}
                  </small>
                </article>
              ),
            )}
          </div>
        </section>
      )}

      {panel === "evidence" && (
        <section className={styles.dataPanel}>
          <div className={styles.sectionHeading}>
            <span>PRIORITY 03</span>
            <h3>Original evidence transport test contract</h3>
            <p>
              These slots test capture timing, exact original bytes, EXIF,
              location and custody. They are not presented as a complete
              government evidence policy for any VEU activity.
            </p>
          </div>
          <div className={styles.evidenceGrid}>
            {(snapshot.evidenceContracts || []).map((requirement) => (
              <article key={requirement.requirementCode}>
                <span>{readable(requirement.captureTiming)}</span>
                <h4>{requirement.title}</h4>
                <p>
                  {readable(requirement.evidenceKind)} |{" "}
                  {requirement.minimumCount} to {requirement.maximumCount} files
                </p>
                <ul>
                  <li>
                    Original bytes:{" "}
                    {requirement.originalRequired ? "Required" : "Not required"}
                  </li>
                  <li>
                    Metadata:{" "}
                    {requirement.metadataRequired ? "Required" : "Not required"}
                  </li>
                  <li>
                    GPS: {requirement.gpsRequired ? "Required" : "Not required"}
                  </li>
                </ul>
                <small>
                  Government status:{" "}
                  {readable(requirement.governmentRequirementStatus)}
                </small>
              </article>
            ))}
          </div>
        </section>
      )}

      {panel === "calculators" && (
        <section className={styles.dataPanel}>
          <div className={styles.sectionHeading}>
            <span>PRIORITY 04</span>
            <h3>Typed VEEC calculator contracts</h3>
            <p>
              All activity families have a versionable typed boundary. Formula
              execution remains disabled until official tables, units, caps,
              rounding and independent golden vectors reconcile.
            </p>
          </div>
          <section className={styles.calculatorSummary}>
            <article>
              <span>Typed contracts</span>
              <strong>{snapshot.calculatorSummary?.total || 0}</strong>
            </article>
            <article>
              <span>Verified formulas</span>
              <strong>{snapshot.calculatorSummary?.verified || 0}</strong>
            </article>
            <article>
              <span>Reconciled vectors</span>
              <strong>
                {snapshot.calculatorSummary?.reconciledVectors || 0}
              </strong>
            </article>
            <article>
              <span>Execution</span>
              <strong>
                {snapshot.calculatorSummary?.executionEnabled
                  ? "Enabled"
                  : "Blocked"}
              </strong>
            </article>
          </section>
          <div className={styles.activityTable}>
            {(snapshot.activities || []).map((activity) => (
              <article key={activity.activityTemplateId}>
                <strong>{activity.registryActivityCode}</strong>
                <span>{activity.title}</span>
                <small>{readable(activity.catalogueState)}</small>
                <b>Formula blocked</b>
              </article>
            ))}
          </div>
        </section>
      )}

      {panel === "connectors" && (
        <section className={styles.dataPanel}>
          <div className={styles.sectionHeading}>
            <span>PRIORITY 05</span>
            <h3>Registry dry-run and legacy cutover boundary</h3>
            <p>
              The pilot produces a deterministic 300-item manifest and
              validates its structure against its own source cohort. It records
              zero regulator acceptances because no regulator request is sent,
              and no Dataforce or Runabout data is imported.
            </p>
          </div>
          <div className={styles.connectorGrid}>
            {(snapshot.connectors || []).map((connector) => (
              <article key={`${connector.connectorCode}:${connector.mappingVersion}`}>
                <span>{readable(connector.mode)}</span>
                <h4>{connector.connectorCode}</h4>
                <p>
                  {connector.itemCount} items |{" "}
                  {connector.acceptedCount} regulator acceptances |{" "}
                  {connector.rejectedCount} rejected |{" "}
                  {connector.unmatchedCount} unmatched
                </p>
                <code>{connector.artifactSha256}</code>
                <strong>
                  External submission:{" "}
                  {connector.externalSubmissionEnabled
                    ? "Enabled"
                    : "Blocked"}
                </strong>
              </article>
            ))}
            {!snapshot.connectors?.length && (
              <p className={styles.empty}>
                The connector dry-run appears after all 300 jobs validate.
              </p>
            )}
          </div>
          <div className={styles.cutoverGrid}>
            <article>
              <span>DATAFORCE</span>
              <h4>Authorised export required</h4>
              <p>
                Field dictionary, enumerations, source hashes, counts, open
                case states, exceptions and rollback acceptance are still
                required.
              </p>
            </article>
            <article>
              <span>RUNABOUT</span>
              <h4>Capture contract required</h4>
              <p>
                Authorised export, device behaviour, offline rules, evidence
                mapping and representative physical-device acceptance are
                still required.
              </p>
            </article>
          </div>
        </section>
      )}

      {isActive && (
        <nav className={styles.activityRail} aria-label="VEU activity tabs">
          <button
            type="button"
            data-selected={!filters.activityTemplateId}
            onClick={() => {
              const next = {
                ...filters,
                activityTemplateId: "",
                page: 0,
              };
              setFilters(next);
              setDraftFilters(next);
              setPanel("jobs");
            }}
          >
            <strong>Dashboard</strong>
            <small>{counts.jobs} test jobs</small>
          </button>
          {(snapshot.activities || []).map((activity) => (
            <button
              key={activity.activityTemplateId}
              type="button"
              data-selected={
                filters.activityTemplateId === activity.activityTemplateId
              }
              onClick={() => {
                const next = {
                  ...filters,
                  activityTemplateId: activity.activityTemplateId,
                  page: 0,
                };
                setFilters(next);
                setDraftFilters(next);
                setPanel("jobs");
              }}
            >
              <strong>{activity.registryActivityCode}</strong>
              <small>{activity.jobCount} jobs</small>
            </button>
          ))}
        </nav>
      )}
    </section>
  );
}

function PilotJobDetail({
  job,
  role,
  busy,
  options,
  onSave,
}: {
  job: PilotJob;
  role: "admin" | "case_manager" | "reviewer" | "auditor";
  busy: boolean;
  options: PilotSnapshot["filters"];
  onSave: (next: {
    reviewStatus: string;
    evidenceStatus: string;
    lookupStatus: string;
  }) => void;
}) {
  const [reviewStatus, setReviewStatus] = useState(job.reviewStatus);
  const [evidenceStatus, setEvidenceStatus] = useState(job.evidenceStatus);
  const [lookupStatus, setLookupStatus] = useState(job.lookupStatus);

  const writable = ["admin", "case_manager", "reviewer"].includes(role);
  return (
    <>
      <header>
        <span className={styles.testBadge}>SYNTHETIC TEST ONLY</span>
        <h3>{job.jobNumber}</h3>
        <p>{job.caseNumber}</p>
      </header>
      <dl>
        <div><dt>Installer</dt><dd>{job.installer.businessName}</dd></div>
        <div><dt>Technician</dt><dd>{job.technician.displayName}</dd></div>
        <div><dt>Activity</dt><dd>{job.registryActivityCode} | {job.title}</dd></div>
        <div><dt>Part</dt><dd>{job.specificationPart || "Specialist method"}</dd></div>
        <div><dt>Activity date</dt><dd>{job.activityDate}</dd></div>
        <div><dt>Catalogue state</dt><dd>{readable(job.catalogueState)}</dd></div>
      </dl>
      <section>
        <h4>Controlled workflow status</h4>
        <label>
          Review
          <select
            value={reviewStatus}
            disabled={!writable || busy}
            onChange={(event) => setReviewStatus(event.target.value)}
          >
            {options.reviewStatuses
              .filter(
                (status) =>
                  status !== "test_complete" && status !== "archived",
              )
              .map((status) => (
                <option key={status} value={status}>{readable(status)}</option>
              ))}
          </select>
        </label>
        <label>
          Evidence transport
          <select
            value={evidenceStatus}
            disabled={!writable || busy}
            onChange={(event) => setEvidenceStatus(event.target.value)}
          >
            {options.evidenceStatuses.map((status) => (
              <option key={status} value={status}>{readable(status)}</option>
            ))}
          </select>
        </label>
        <label>
          Authoritative lookups
          <select
            value={lookupStatus}
            disabled={!writable || busy}
            onChange={(event) => setLookupStatus(event.target.value)}
          >
            {options.lookupStatuses
              .filter((status) => status !== "verified")
              .map((status) => (
                <option key={status} value={status}>{readable(status)}</option>
              ))}
          </select>
        </label>
        {writable && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onSave({ reviewStatus, evidenceStatus, lookupStatus })}
          >
            {busy ? "Saving..." : "Save audited test state"}
          </button>
        )}
      </section>
      <section className={styles.blockers}>
        <h4>Hard blockers</h4>
        <p><strong>Rules</strong>{readable(job.ruleStatus)}</p>
        <p><strong>Calculator</strong>{readable(job.calculatorStatus)}</p>
        <p><strong>Connector</strong>{readable(job.connectorStatus)}</p>
      </section>
    </>
  );
}
