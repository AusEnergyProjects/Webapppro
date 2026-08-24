"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  ManualEvidenceField,
  ManualEvidenceResponse,
} from "@/lib/creditex-manual-evidence-lab";
import styles from "./CreditexManualJobAuditWorkspace.module.css";

type Api = (
  path: string,
  init?: RequestInit,
) => Promise<Record<string, unknown>>;

type ManualJobStatus =
  | "draft"
  | "field_testing"
  | "ready_for_audit"
  | "changes_required"
  | "passed"
  | "archived";

type ActivitySnapshot = {
  program?: {
    templateId?: string;
    programCode?: string;
    name?: string;
    jurisdiction?: string;
    outcomeClass?: string;
    administeringBody?: string;
    officialSourceUrl?: string;
    officialSourceTitle?: string;
    catalogueState?: string;
  };
  activity?: {
    templateId?: string;
    programCode?: string;
    activityKey?: string;
    registryActivityCode?: string;
    title?: string;
    serviceCategory?: string;
    specificationPart?: string;
    productCategory?: string;
    scenarioCode?: string;
    scenario?: string;
    catalogueState?: string;
  };
};

type ManualAuditJob = {
  id: string;
  formVersionId: string;
  programCode: string;
  activityTemplateId: string;
  activitySnapshot: ActivitySnapshot;
  formSchema: {
    contract: string;
    catalogueReviewedOn: string;
    fields: ManualEvidenceField[];
  };
  formSchemaSha256: string;
  jobNumber: string;
  installerId: string;
  installerLabel: string;
  technicianId: string;
  technicianLabel: string;
  fieldTesterUid: string;
  customerLabel: string;
  siteState: string;
  sitePostcode: string;
  status: ManualJobStatus;
  responses: ManualEvidenceResponse[];
  responseSha256: string;
  requiredCount: number;
  completedRequiredCount: number;
  issueCount: number;
  reviewNote: string;
  recordMode: "synthetic_test";
  revision: number;
  createdByUid: string;
  updatedByUid: string;
  passedByUid: string;
  createdAt: string;
  passedAt: string;
  archivedAt: string;
  updatedAt: string;
};

type ManualJobEvent = {
  id: string;
  eventType: string;
  actorUid: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type AcceptanceRestoredCapture = {
  captureId: string;
  fieldCode: string;
  integrityReceiptId: string;
  originalSha256: string;
  restoredSha256: string;
  sizeBytes: number;
  metadataState: string;
  gpsState: string;
  captureTimeState: string;
  physicalDeviceState: string;
  authority: string;
};

type AcceptanceScenario = {
  scenario: string;
  outcome: string;
  note: string;
  authority: string;
  captures: AcceptanceRestoredCapture[];
};

type AcceptanceRun = {
  id: string;
  jobId: string;
  testerUid: string;
  reviewerUid: string;
  deviceId: string;
  platform: string;
  appVersion: string;
  scenarioResults: AcceptanceScenario[];
  status: string;
  testerNote: string;
  reviewerNote: string;
  recordMode: "synthetic_test";
  startedAt: string;
  submittedAt: string;
  reviewedAt: string;
  updatedAt: string;
  physicalCustodyAccepted: boolean;
  deviceAttestation: string;
};

type AcceptanceSnapshot = {
  contract: string;
  runs: AcceptanceRun[];
  boundaries: {
    recordMode: "synthetic_test";
    regulatoryAcceptance: string;
    deviceAttestation: string;
    externalSubmissionEnabled: false;
  };
};

export type CreditexManualJobAuditWorkspaceProps = {
  api: Api;
  jobId: string;
  role: string;
  onClose: () => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readable(value: string | null | undefined) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "Not recorded";
  return cleaned
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: string | null | undefined) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "Not recorded";
  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.valueOf())) return cleaned;
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function compactHash(value: string) {
  if (!value) return "Not recorded";
  if (value.length <= 24) return value;
  return `${value.slice(0, 12)}...${value.slice(-12)}`;
}

function responseFor(
  fieldCode: string,
  responses: ManualEvidenceResponse[],
) {
  return responses.find((response) => response.fieldCode === fieldCode) || null;
}

function responseValue(
  field: ManualEvidenceField,
  response: ManualEvidenceResponse | null,
) {
  if (!response) return "No response record";
  if (field.fieldType === "photo" || field.fieldType === "document") {
    return `${response.captures.length} capture${
      response.captures.length === 1 ? "" : "s"
    }`;
  }
  return response.value || "No answer recorded";
}

function booleanFact(value: boolean) {
  return value ? "Present" : "Not present";
}

function metadataEntries(metadata: Record<string, unknown>) {
  return Object.entries(metadata).filter(([, value]) =>
    value !== null && value !== undefined && String(value).trim() !== ""
  );
}

function loadJob(payload: Record<string, unknown>, jobId: string) {
  if (!isRecord(payload.lab) || !Array.isArray(payload.lab.jobs)) {
    throw new Error("The manual audit response did not contain a job list.");
  }
  const job = payload.lab.jobs.find((candidate) =>
    isRecord(candidate) && candidate.id === jobId
  );
  if (!isRecord(job)) {
    throw new Error("The requested synthetic manual job was not found.");
  }
  if (
    job.recordMode !== "synthetic_test"
    || !Array.isArray(job.responses)
    || !isRecord(job.formSchema)
    || !Array.isArray(job.formSchema.fields)
  ) {
    throw new Error("The synthetic manual job record is incomplete.");
  }
  return job as unknown as ManualAuditJob;
}

function loadEvents(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.events)) {
    throw new Error("The manual audit response did not contain event history.");
  }
  return payload.events.filter(isRecord).map((event) => ({
    id: String(event.id || ""),
    eventType: String(event.eventType || ""),
    actorUid: String(event.actorUid || ""),
    summary: String(event.summary || ""),
    metadata: isRecord(event.metadata) ? event.metadata : {},
    createdAt: String(event.createdAt || ""),
  }));
}

function loadAcceptance(payload: Record<string, unknown>) {
  if (
    !isRecord(payload.acceptance)
    || !Array.isArray(payload.acceptance.runs)
    || !isRecord(payload.acceptance.boundaries)
  ) {
    throw new Error(
      "The physical-device acceptance response was incomplete.",
    );
  }
  const runs = payload.acceptance.runs.filter(isRecord).map((run) => ({
    id: String(run.id || ""),
    jobId: String(run.jobId || ""),
    testerUid: String(run.testerUid || ""),
    reviewerUid: String(run.reviewerUid || ""),
    deviceId: String(run.deviceId || ""),
    platform: String(run.platform || ""),
    appVersion: String(run.appVersion || ""),
    scenarioResults: Array.isArray(run.scenarioResults)
      ? run.scenarioResults.filter(isRecord).map((scenario) => ({
          scenario: String(scenario.scenario || ""),
          outcome: String(scenario.outcome || ""),
          note: String(scenario.note || ""),
          authority: String(scenario.authority || ""),
          captures: Array.isArray(scenario.captures)
            ? scenario.captures.filter(isRecord).map((capture) => ({
                captureId: String(capture.captureId || ""),
                fieldCode: String(capture.fieldCode || ""),
                integrityReceiptId: String(
                  capture.integrityReceiptId || "",
                ),
                originalSha256: String(capture.originalSha256 || ""),
                restoredSha256: String(capture.restoredSha256 || ""),
                sizeBytes: Number(capture.sizeBytes || 0),
                metadataState: String(capture.metadataState || ""),
                gpsState: String(capture.gpsState || ""),
                captureTimeState: String(capture.captureTimeState || ""),
                physicalDeviceState: String(
                  capture.physicalDeviceState || "",
                ),
                authority: String(capture.authority || ""),
              }))
            : [],
        }))
      : [],
    status: String(run.status || ""),
    testerNote: String(run.testerNote || ""),
    reviewerNote: String(run.reviewerNote || ""),
    recordMode: "synthetic_test" as const,
    startedAt: String(run.startedAt || ""),
    submittedAt: String(run.submittedAt || ""),
    reviewedAt: String(run.reviewedAt || ""),
    updatedAt: String(run.updatedAt || ""),
    physicalCustodyAccepted: run.physicalCustodyAccepted === true,
    deviceAttestation: String(run.deviceAttestation || "not_available"),
  }));
  return {
    contract: String(payload.acceptance.contract || ""),
    runs,
    boundaries: {
      recordMode: "synthetic_test" as const,
      regulatoryAcceptance: String(
        payload.acceptance.boundaries.regulatoryAcceptance || "",
      ),
      deviceAttestation: String(
        payload.acceptance.boundaries.deviceAttestation || "not_available",
      ),
      externalSubmissionEnabled: false as const,
    },
  };
}

function Fact({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd className={mono ? styles.mono : undefined}>{children}</dd>
    </div>
  );
}

export function CreditexManualJobAuditWorkspace({
  api,
  jobId,
  role,
  onClose,
}: CreditexManualJobAuditWorkspaceProps) {
  const [job, setJob] = useState<ManualAuditJob | null>(null);
  const [events, setEvents] = useState<ManualJobEvent[]>([]);
  const [acceptance, setAcceptance] =
    useState<AcceptanceSnapshot | null>(null);
  const [acceptanceError, setAcceptanceError] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    setAcceptanceError("");
    try {
      const encodedJobId = encodeURIComponent(jobId);
      const acceptanceRequest = api(
        `/api/creditex/manual-field/acceptance?jobId=${encodedJobId}`,
      ).then(loadAcceptance).catch((acceptanceLoadError: unknown) => {
        setAcceptanceError(
          acceptanceLoadError instanceof Error
            ? acceptanceLoadError.message
            : "Physical-device acceptance could not be loaded.",
        );
        return null;
      });
      const [jobPayload, eventPayload, acceptanceSnapshot] = await Promise.all([
        api(
          `/api/creditex/manual-evidence-lab?jobId=${encodedJobId}&pageSize=50`,
        ),
        api(
          `/api/creditex/manual-evidence-lab?view=events&jobId=${encodedJobId}`,
        ),
        acceptanceRequest,
      ]);
      setJob(loadJob(jobPayload, jobId));
      setEvents(loadEvents(eventPayload));
      setAcceptance(acceptanceSnapshot);
    } catch (loadError) {
      setJob(null);
      setEvents([]);
      setAcceptance(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "The synthetic manual job audit could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }, [api, jobId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const fieldRows = useMemo(() => {
    if (!job) return [];
    return job.formSchema.fields.map((field, index) => ({
      field,
      index,
      response: responseFor(field.fieldCode, job.responses),
    }));
  }, [job]);

  const captureCount = useMemo(
    () =>
      fieldRows.reduce(
        (total, row) => total + (row.response?.captures.length || 0),
        0,
      ),
    [fieldRows],
  );
  const verifiedCaptureCount = useMemo(
    () =>
      fieldRows.reduce(
        (total, row) =>
          total
          + (row.response?.captures.filter(
            (capture) => capture.verificationState === "server_verified",
          ).length || 0),
        0,
      ),
    [fieldRows],
  );

  const activity = job?.activitySnapshot.activity;
  const program = job?.activitySnapshot.program;

  return (
    <div
      className={styles.workspace}
      role="dialog"
      aria-modal="true"
      aria-label="Synthetic manual job audit workspace"
    >
      <header className={styles.topbar}>
        <div className={styles.identity}>
          <span className={styles.syntheticBadge}>Synthetic test only</span>
          <div>
            <span className={styles.crumb}>
              Creditex / Manual job audit / {job?.jobNumber || jobId}
            </span>
            <h1>{job?.jobNumber || "Loading manual job"}</h1>
          </div>
        </div>
        <div className={styles.boundary}>
          <strong>No certificate or submission</strong>
          <span>
            Read-only test evidence. No regulated case or government claim.
          </span>
        </div>
        <div className={styles.actions}>
          <span className={styles.role}>{readable(role)} access</span>
          <button type="button" onClick={() => void load()} disabled={busy}>
            Refresh
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      {busy && !job ? (
        <main className={styles.statePanel}>
          <span className={styles.loader} aria-hidden="true" />
          <strong>Loading immutable manual job evidence</strong>
        </main>
      ) : error ? (
        <main className={styles.statePanel}>
          <strong>Manual audit unavailable</strong>
          <p>{error}</p>
          <div>
            <button type="button" onClick={() => void load()}>
              Retry
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </main>
      ) : job ? (
        <div className={styles.shell}>
          <aside className={styles.summaryRail}>
            <section className={styles.railSection}>
              <span className={styles.eyebrow}>Audit position</span>
              <strong className={styles.status}>
                {readable(job.status)}
              </strong>
              <dl>
                <Fact label="Revision">{job.revision}</Fact>
                <Fact label="Required complete">
                  {job.completedRequiredCount} of {job.requiredCount}
                </Fact>
                <Fact label="Issues">{job.issueCount}</Fact>
                <Fact label="Verified captures">
                  {verifiedCaptureCount} of {captureCount}
                </Fact>
                <Fact label="Physical runs">
                  {acceptance?.runs.length || 0}
                </Fact>
                <Fact label="Last updated">{formatDate(job.updatedAt)}</Fact>
              </dl>
            </section>

            <section className={styles.railSection}>
              <span className={styles.eyebrow}>Assignment</span>
              <dl>
                <Fact label="Installer">
                  {job.installerLabel || job.installerId || "Not assigned"}
                </Fact>
                <Fact label="Technician">
                  {job.technicianLabel || job.technicianId || "Not assigned"}
                </Fact>
                <Fact label="TLink tester">
                  {job.fieldTesterUid || "Not assigned"}
                </Fact>
                <Fact label="Test customer">
                  {job.customerLabel || "Not recorded"}
                </Fact>
                <Fact label="Test site">
                  {[job.siteState, job.sitePostcode].filter(Boolean).join(" ")
                    || "Not recorded"}
                </Fact>
              </dl>
            </section>

            <section className={styles.railSection}>
              <span className={styles.eyebrow}>Locked records</span>
              <dl>
                <Fact label="Form version" mono>
                  {job.formVersionId}
                </Fact>
                <Fact label="Form SHA-256" mono>
                  <span title={job.formSchemaSha256}>
                    {compactHash(job.formSchemaSha256)}
                  </span>
                </Fact>
                <Fact label="Response SHA-256" mono>
                  <span title={job.responseSha256}>
                    {compactHash(job.responseSha256)}
                  </span>
                </Fact>
                <Fact label="Created">{formatDate(job.createdAt)}</Fact>
                <Fact label="Passed">
                  {job.passedAt ? formatDate(job.passedAt) : "Not passed"}
                </Fact>
              </dl>
            </section>
          </aside>

          <main className={styles.content}>
            <section className={styles.panel}>
              <header className={styles.panelHeader}>
                <div>
                  <span className={styles.eyebrow}>Job and activity</span>
                  <h2>Locked synthetic job record</h2>
                </div>
                <span className={styles.readOnly}>Read-only</span>
              </header>
              <dl className={styles.factGrid}>
                <Fact label="Job ID" mono>{job.id}</Fact>
                <Fact label="Job number">{job.jobNumber}</Fact>
                <Fact label="Program">
                  {program?.name || job.programCode}
                </Fact>
                <Fact label="Program code">{job.programCode}</Fact>
                <Fact label="Jurisdiction">
                  {program?.jurisdiction || "Not recorded"}
                </Fact>
                <Fact label="Administering body">
                  {program?.administeringBody || "Not recorded"}
                </Fact>
                <Fact label="Activity">
                  {activity?.title || job.activityTemplateId}
                </Fact>
                <Fact label="Registry activity code">
                  {activity?.registryActivityCode || "Not recorded"}
                </Fact>
                <Fact label="Specification part">
                  {activity?.specificationPart || "Not recorded"}
                </Fact>
                <Fact label="Scenario">
                  {activity?.scenario || activity?.scenarioCode
                    || "No separate scenario recorded"}
                </Fact>
                <Fact label="Service category">
                  {activity?.serviceCategory || "Not recorded"}
                </Fact>
                <Fact label="Product category">
                  {activity?.productCategory || "Not recorded"}
                </Fact>
              </dl>
              {program?.officialSourceUrl && (
                <p className={styles.sourceLine}>
                  Catalogue source:{" "}
                  <a
                    href={program.officialSourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {program.officialSourceTitle || "Open official source"}
                  </a>
                  . This catalogue reference does not certify this test job.
                </p>
              )}
            </section>

            <section className={styles.acceptancePanel}>
              <header className={styles.panelHeader}>
                <div>
                  <span className={styles.eyebrow}>Physical acceptance</span>
                  <h2>Named physical-device custody runs</h2>
                </div>
                <span className={styles.readOnly}>
                  {acceptance?.contract || "Read-only"}
                </span>
              </header>
              <div className={styles.acceptanceBoundary}>
                <strong>Synthetic device-custody acceptance only</strong>
                <span>
                  This permanently isolated test records a named tester&apos;s
                  physical-device observation and checks retained R2 object
                  custody. Hardware attestation is not available. It does not
                  assess or grant regulatory acceptance, create certificates,
                  or enable an external submission.
                </span>
                <dl>
                  <Fact label="Record mode">
                    {readable(
                      acceptance?.boundaries.recordMode || "synthetic_test",
                    )}
                  </Fact>
                  <Fact label="Regulatory acceptance">
                    {readable(
                      acceptance?.boundaries.regulatoryAcceptance
                        || "not_assessed",
                    )}
                  </Fact>
                  <Fact label="Device attestation">
                    {readable(
                      acceptance?.boundaries.deviceAttestation
                        || "not_available",
                    )}
                  </Fact>
                  <Fact label="External submission">
                    {acceptance?.boundaries.externalSubmissionEnabled
                      ? "Enabled"
                      : "Disabled"}
                  </Fact>
                </dl>
              </div>

              {acceptanceError ? (
                <p className={styles.acceptanceError}>
                  Physical acceptance records unavailable: {acceptanceError}
                </p>
              ) : acceptance?.runs.length ? (
                <div className={styles.acceptanceRuns}>
                  {acceptance.runs.map((run, runIndex) => (
                    <article className={styles.acceptanceRun} key={run.id}>
                      <header>
                        <div>
                          <span>
                            Run {acceptance.runs.length - runIndex}
                            {" | "}{formatDate(run.updatedAt)}
                          </span>
                          <strong>{run.id}</strong>
                        </div>
                        <span
                          className={styles.acceptanceStatus}
                          data-status={run.status}
                        >
                          {readable(run.status)}
                        </span>
                      </header>
                      <dl className={styles.acceptanceFacts}>
                        <Fact label="Named tester" mono>
                          {run.testerUid || "Not recorded"}
                        </Fact>
                        <Fact label="Separate reviewer" mono>
                          {run.reviewerUid || "Not yet reviewed"}
                        </Fact>
                        <Fact label="Identity separation">
                          {!run.reviewerUid
                            ? "Independent review pending"
                            : run.reviewerUid !== run.testerUid
                            ? "Different identities recorded"
                            : "Identity conflict recorded"}
                        </Fact>
                        <Fact label="Device ID" mono>
                          {run.deviceId || "Not recorded"}
                        </Fact>
                        <Fact label="Platform">
                          {readable(run.platform)}
                        </Fact>
                        <Fact label="TLink app">
                          {run.appVersion || "Not recorded"}
                        </Fact>
                        <Fact label="Device attestation">
                          {readable(run.deviceAttestation)}
                        </Fact>
                        <Fact label="Started">
                          {formatDate(run.startedAt)}
                        </Fact>
                        <Fact label="Submitted">
                          {formatDate(run.submittedAt)}
                        </Fact>
                        <Fact label="Reviewed">
                          {formatDate(run.reviewedAt)}
                        </Fact>
                        <Fact label="Synthetic custody result">
                          {run.physicalCustodyAccepted
                            ? "Accepted inside synthetic lane"
                            : "Not accepted"}
                        </Fact>
                      </dl>
                      <div className={styles.acceptanceNotes}>
                        <p>
                          <strong>Tester note:</strong>{" "}
                          {run.testerNote || "No tester note recorded."}
                        </p>
                        <p>
                          <strong>Independent reviewer note:</strong>{" "}
                          {run.reviewerNote || "No review decision recorded."}
                        </p>
                      </div>
                      <div className={styles.scenarios}>
                        {run.scenarioResults.map((scenario) => (
                          <article
                            className={styles.scenario}
                            key={`${run.id}-${scenario.scenario}`}
                          >
                            <header>
                              <div>
                                <span>{readable(scenario.authority)}</span>
                                <strong>{readable(scenario.scenario)}</strong>
                              </div>
                              <span
                                className={styles.scenarioOutcome}
                                data-outcome={scenario.outcome}
                              >
                                {readable(scenario.outcome)}
                              </span>
                            </header>
                            <p>
                              {scenario.note
                                || (scenario.scenario === "server_r2_restore"
                                  ? "Server restored retained R2 objects and compared authoritative hashes and byte sizes."
                                  : "No tester scenario note recorded.")}
                            </p>
                            {scenario.captures.length > 0 && (
                              <div className={styles.restoreCaptures}>
                                {scenario.captures.map((capture) => (
                                  <dl key={capture.captureId}>
                                    <Fact label="Field">
                                      {capture.fieldCode}
                                    </Fact>
                                    <Fact label="Capture ID" mono>
                                      {capture.captureId}
                                    </Fact>
                                    <Fact label="Integrity receipt" mono>
                                      {capture.integrityReceiptId}
                                    </Fact>
                                    <Fact label="Original SHA-256" mono>
                                      <span title={capture.originalSha256}>
                                        {compactHash(capture.originalSha256)}
                                      </span>
                                    </Fact>
                                    <Fact label="Restored SHA-256" mono>
                                      <span title={capture.restoredSha256}>
                                        {compactHash(capture.restoredSha256)}
                                      </span>
                                    </Fact>
                                    <Fact label="Retained size">
                                      {capture.sizeBytes.toLocaleString(
                                        "en-AU",
                                      )}{" "}
                                      bytes
                                    </Fact>
                                    <Fact label="Metadata">
                                      {readable(capture.metadataState)}
                                    </Fact>
                                    <Fact label="GPS">
                                      {readable(capture.gpsState)}
                                    </Fact>
                                    <Fact label="Capture time">
                                      {readable(capture.captureTimeState)}
                                    </Fact>
                                    <Fact label="Device state">
                                      {readable(capture.physicalDeviceState)}
                                    </Fact>
                                    <Fact label="Authority">
                                      {readable(capture.authority)}
                                    </Fact>
                                  </dl>
                                ))}
                              </div>
                            )}
                          </article>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className={styles.empty}>
                  No named physical-device custody run has been recorded for
                  this synthetic job. Regulatory acceptance remains not
                  assessed.
                </p>
              )}
            </section>

            <section className={styles.panel}>
              <header className={styles.panelHeader}>
                <div>
                  <span className={styles.eyebrow}>Locked form</span>
                  <h2>
                    {fieldRows.length} evidence requirement
                    {fieldRows.length === 1 ? "" : "s"}
                  </h2>
                </div>
                <div className={styles.schemaMeta}>
                  <span>{job.formSchema.contract}</span>
                  <span>
                    Catalogue reviewed {job.formSchema.catalogueReviewedOn}
                  </span>
                </div>
              </header>

              <div className={styles.requirements}>
                {fieldRows.map(({ field, response, index }) => (
                  <article
                    key={field.fieldCode}
                    className={styles.requirement}
                  >
                    <header className={styles.requirementHeader}>
                      <span className={styles.requirementNumber}>
                        {index + 1}
                      </span>
                      <div>
                        <span className={styles.fieldCode}>
                          {field.fieldCode}
                        </span>
                        <h3>{field.label}</h3>
                        <p>{field.instructions || "No instruction recorded."}</p>
                      </div>
                      <div className={styles.requirementFlags}>
                        <span data-tone={field.required ? "required" : "neutral"}>
                          {field.required ? "Required" : "Optional"}
                        </span>
                        <span>{readable(field.fieldType)}</span>
                        <span>{readable(field.captureTiming)}</span>
                      </div>
                    </header>

                    <div className={styles.requirementBody}>
                      <dl className={styles.ruleGrid}>
                        <Fact label="Origin">{readable(field.origin)}</Fact>
                        <Fact label="Allowed count">
                          {field.minimumCount} to {field.maximumCount || 20}
                        </Fact>
                        <Fact label="Original required">
                          {field.originalRequired ? "Yes" : "No"}
                        </Fact>
                        <Fact label="Metadata required">
                          {field.metadataRequired ? "Yes" : "No"}
                        </Fact>
                        <Fact label="GPS required">
                          {field.gpsRequired ? "Yes" : "No"}
                        </Fact>
                        <Fact label="Allowed formats">
                          {field.allowedContentTypes.length
                            ? field.allowedContentTypes.join(", ")
                            : "Not restricted by this test form"}
                        </Fact>
                        {field.options.length > 0 && (
                          <Fact label="Controlled options">
                            {field.options.join(", ")}
                          </Fact>
                        )}
                      </dl>

                      <section className={styles.response}>
                        <header>
                          <div>
                            <span className={styles.eyebrow}>
                              Recorded response
                            </span>
                            <strong>{responseValue(field, response)}</strong>
                          </div>
                          <span
                            className={styles.outcome}
                            data-outcome={response?.outcome || "not_started"}
                          >
                            {readable(response?.outcome || "not_started")}
                          </span>
                        </header>
                        <p>
                          <strong>Installer or reviewer note:</strong>{" "}
                          {response?.note || "No note recorded."}
                        </p>
                      </section>

                      {(response?.captures || []).length > 0 && (
                        <div className={styles.captures}>
                          {response?.captures.map((capture, captureIndex) => (
                            <article
                              className={styles.capture}
                              key={capture.captureId
                                || `${field.fieldCode}-${captureIndex}`}
                            >
                              <header>
                                <div>
                                  <span>Capture {captureIndex + 1}</span>
                                  <strong>
                                    {capture.fileName || "Unnamed file"}
                                  </strong>
                                </div>
                                <span
                                  className={styles.verification}
                                  data-verified={
                                    capture.verificationState
                                      === "server_verified"
                                  }
                                >
                                  {capture.verificationState
                                    === "server_verified"
                                    ? "Server verified"
                                    : "Not server verified"}
                                </span>
                              </header>
                              <dl className={styles.captureGrid}>
                                <Fact label="Capture ID" mono>
                                  {capture.captureId || "Not recorded"}
                                </Fact>
                                <Fact label="Content type">
                                  {capture.contentType || "Not recorded"}
                                </Fact>
                                <Fact label="Original SHA-256" mono>
                                  <span title={capture.originalSha256}>
                                    {compactHash(capture.originalSha256)}
                                  </span>
                                </Fact>
                                <Fact label="Device ID" mono>
                                  {capture.deviceId || "Not recorded"}
                                </Fact>
                                <Fact label="Captured">
                                  {formatDate(capture.capturedAt)}
                                </Fact>
                                <Fact label="Physical device state">
                                  {readable(capture.physicalDeviceState)}
                                </Fact>
                                <Fact label="Original bytes">
                                  {booleanFact(capture.originalPresent)}
                                </Fact>
                                <Fact label="Embedded metadata">
                                  {booleanFact(capture.metadataPresent)}
                                </Fact>
                                <Fact label="GPS">
                                  {booleanFact(capture.gpsPresent)}
                                </Fact>
                                <Fact label="Capture time">
                                  {booleanFact(capture.captureTimePresent)}
                                </Fact>
                              </dl>
                              <p className={styles.captureBoundary}>
                                These are retained synthetic capture facts.
                                Server verification is not government approval.
                              </p>
                            </article>
                          ))}
                        </div>
                      )}
                    </div>
                    {field.source ? (
                      <footer className={styles.requirementSource}>
                        <strong>Source asserted in locked form</strong>
                        <span>
                          {field.source.officialSourceTitle} |{" "}
                          {field.source.officialSourceVersion} | Clause{" "}
                          {field.source.clause}
                        </span>
                        <a
                          href={field.source.officialSourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open source
                        </a>
                      </footer>
                    ) : (
                      <footer
                        className={`${styles.requirementSource} ${styles.unverifiedSource}`}
                      >
                        No approved government source is bound to this test
                        requirement. Treat it as a Creditex operational test
                        instruction only.
                      </footer>
                    )}
                  </article>
                ))}
                {!fieldRows.length && (
                  <p className={styles.empty}>
                    No locked evidence requirements were returned for this
                    synthetic job.
                  </p>
                )}
              </div>
            </section>

            <section className={styles.reviewPanel}>
              <div>
                <span className={styles.eyebrow}>Creditex review note</span>
                <h2>{job.reviewNote || "No review note recorded."}</h2>
              </div>
              <dl>
                <Fact label="Decision status">{readable(job.status)}</Fact>
                <Fact label="Decision actor">
                  {job.passedByUid || "No pass decision recorded"}
                </Fact>
                <Fact label="Response revision">{job.revision}</Fact>
              </dl>
            </section>

            <section className={styles.panel}>
              <header className={styles.panelHeader}>
                <div>
                  <span className={styles.eyebrow}>
                    Append-only event history
                  </span>
                  <h2>
                    {events.length} immutable event
                    {events.length === 1 ? "" : "s"}
                  </h2>
                </div>
                <span className={styles.readOnly}>Newest first</span>
              </header>
              <ol className={styles.timeline}>
                {events.map((event) => {
                  const entries = metadataEntries(event.metadata);
                  return (
                    <li key={event.id}>
                      <span className={styles.timelineMarker} />
                      <article>
                        <header>
                          <div>
                            <span>{readable(event.eventType)}</span>
                            <strong>{event.summary || "Event recorded"}</strong>
                          </div>
                          <time dateTime={event.createdAt}>
                            {formatDate(event.createdAt)}
                          </time>
                        </header>
                        <p>
                          Actor:{" "}
                          <span className={styles.mono}>
                            {event.actorUid || "System"}
                          </span>
                        </p>
                        {entries.length > 0 && (
                          <dl className={styles.eventMetadata}>
                            {entries.map(([key, value]) => (
                              <Fact key={key} label={readable(key)}>
                                {typeof value === "object"
                                  ? JSON.stringify(value)
                                  : String(value)}
                              </Fact>
                            ))}
                          </dl>
                        )}
                        <span className={styles.eventId}>
                          Event ID: {event.id}
                        </span>
                      </article>
                    </li>
                  );
                })}
              </ol>
              {!events.length && (
                <p className={styles.empty}>
                  No event rows were returned for this synthetic job.
                </p>
              )}
            </section>
          </main>
        </div>
      ) : null}
    </div>
  );
}
