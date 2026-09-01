"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./CreditexOfficialSourceWorkbench.module.css";

type ApiCaller = (
  path: string,
  init?: RequestInit,
) => Promise<Record<string, unknown>>;

type ReviewDecision = "approved" | "rejected";
type ReviewSubject = "artifact" | "binding";

type SourceReview = {
  id: string;
  decision: ReviewDecision | "withdrawn";
  reviewNote: string;
  reviewedByUid: string;
  reviewedAt: string;
};

type OfficialSourceArtifact = {
  id: string;
  sourceUrl: string;
  sourceHost: string;
  sourceTitle: string;
  sourceVersion: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  assertedRetrievedAt: string;
  sourceEtag: string;
  sourceLastModified: string;
  custodyState: string;
  capturedAt: string;
};

type OfficialSourceBinding = {
  id: string;
  artifactId: string;
  targetType: string;
  targetId: string;
  citationLocation: string;
  bindingState: string;
  createdAt: string;
};

type OfficialSource = {
  artifact: OfficialSourceArtifact;
  binding: OfficialSourceBinding | null;
  artifactReview: SourceReview | null;
  bindingReview: SourceReview | null;
};

type SourceTarget = {
  type: string;
  id: string;
  label: string;
  state: string;
};

type SourcePagination = {
  total: number;
  pageSize: number;
  hasNext: boolean;
  nextCursor: string;
};

type UploadFields = {
  sourceUrl: string;
  sourceTitle: string;
  sourceVersion: string;
  assertedRetrievedAt: string;
  citationLocation: string;
  sourceEtag: string;
  sourceLastModified: string;
  targetKey: string;
};

type ReviewControlsProps = {
  canReview: boolean;
  subjectType: ReviewSubject;
  subjectId: string;
  current: SourceReview | null;
  approvalDisabled?: boolean;
  approvalDisabledMessage?: string;
  busy: boolean;
  onDecision: (
    subjectType: ReviewSubject,
    subjectId: string,
    decision: ReviewDecision,
    note: string,
  ) => Promise<void>;
};

const EMPTY_UPLOAD: UploadFields = {
  sourceUrl: "",
  sourceTitle: "",
  sourceVersion: "",
  assertedRetrievedAt: "",
  citationLocation: "",
  sourceEtag: "",
  sourceLastModified: "",
  targetKey: "",
};

const EMPTY_PAGINATION: SourcePagination = {
  total: 0,
  pageSize: 50,
  hasNext: false,
  nextCursor: "",
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function sourceReview(value: unknown): SourceReview | null {
  const review = objectValue(value);
  const decision = textValue(review.decision);
  if (
    decision !== "approved"
    && decision !== "rejected"
    && decision !== "withdrawn"
  ) {
    return null;
  }
  return {
    id: textValue(review.id),
    decision,
    reviewNote: textValue(review.reviewNote),
    reviewedByUid: textValue(review.reviewedByUid),
    reviewedAt: textValue(review.reviewedAt),
  };
}

function officialSource(value: unknown): OfficialSource | null {
  const source = objectValue(value);
  const artifact = objectValue(source.artifact);
  const binding = objectValue(source.binding);
  const artifactId = textValue(artifact.id);
  const bindingId = textValue(binding.id);
  if (!artifactId) return null;
  return {
    artifact: {
      id: artifactId,
      sourceUrl: textValue(artifact.sourceUrl),
      sourceHost: textValue(artifact.sourceHost),
      sourceTitle: textValue(artifact.sourceTitle),
      sourceVersion: textValue(artifact.sourceVersion),
      originalFileName: textValue(artifact.originalFileName),
      contentType: textValue(artifact.contentType),
      sizeBytes: numberValue(artifact.sizeBytes),
      sha256: textValue(artifact.sha256),
      assertedRetrievedAt: textValue(artifact.assertedRetrievedAt),
      sourceEtag: textValue(artifact.sourceEtag),
      sourceLastModified: textValue(artifact.sourceLastModified),
      custodyState: textValue(artifact.custodyState),
      capturedAt: textValue(artifact.capturedAt),
    },
    binding: bindingId
      ? {
          id: bindingId,
          artifactId: textValue(binding.artifactId),
          targetType: textValue(binding.targetType),
          targetId: textValue(binding.targetId),
          citationLocation: textValue(binding.citationLocation),
          bindingState: textValue(binding.bindingState),
          createdAt: textValue(binding.createdAt),
        }
      : null,
    artifactReview: sourceReview(source.artifactReview),
    bindingReview: sourceReview(source.bindingReview),
  };
}

function sourceTarget(value: unknown): SourceTarget | null {
  const target = objectValue(value);
  const type = textValue(target.type);
  const id = textValue(target.id);
  const label = textValue(target.label);
  if (!type || !id || !label) return null;
  return {
    type,
    id,
    label,
    state: textValue(target.state),
  };
}

function sourcePagination(value: unknown): SourcePagination {
  const pagination = objectValue(value);
  return {
    total: Math.max(0, numberValue(pagination.total)),
    pageSize: Math.max(1, numberValue(pagination.pageSize) || 50),
    hasNext: pagination.hasNext === true,
    nextCursor: textValue(pagination.nextCursor),
  };
}

function listValue<T>(
  value: unknown,
  parser: (item: unknown) => T | null,
) {
  return Array.isArray(value)
    ? value.map(parser).filter((item): item is T => item !== null)
    : [];
}

function targetKey(target: SourceTarget) {
  return `${target.type}:${target.id}`;
}

function readable(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formattedDate(value: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formattedBytes(value: number) {
  if (value < 1_000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${(value / 1_000_000).toFixed(2)} MB`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function reviewTone(review: SourceReview | null) {
  if (!review) return "pending";
  return review.decision;
}

function ReviewControls({
  canReview,
  subjectType,
  subjectId,
  current,
  approvalDisabled = false,
  approvalDisabledMessage =
    "Approve the exact retained artifact before approving its target binding.",
  busy,
  onDecision,
}: ReviewControlsProps) {
  const [note, setNote] = useState("");
  const [validation, setValidation] = useState("");

  const submit = async (decision: ReviewDecision) => {
    const cleanNote = note.trim();
    if (!cleanNote) {
      setValidation("Record the reason for this decision.");
      return;
    }
    setValidation("");
    try {
      await onDecision(subjectType, subjectId, decision, cleanNote);
      setNote("");
    } catch {
      // The parent reports the API error. Keep the note so it can be retried.
    }
  };

  return (
    <section className={styles.reviewPanel}>
      <header>
        <div>
          <span>{subjectType === "artifact" ? "Step 1" : "Step 2"}</span>
          <strong>
            {subjectType === "artifact"
              ? "Review retained source"
              : "Review target binding"}
          </strong>
        </div>
        <span className={styles.status} data-tone={reviewTone(current)}>
          {current ? readable(current.decision) : "Pending"}
        </span>
      </header>
      {current ? (
        <p className={styles.reviewHistory}>
          Latest decision {formattedDate(current.reviewedAt)}. {current.reviewNote}
        </p>
      ) : (
        <p className={styles.reviewHistory}>No independent decision recorded.</p>
      )}
      {canReview && !current ? (
        <>
          <label className={styles.field}>
            <span>Decision note</span>
            <textarea
              maxLength={1000}
              placeholder="Explain the evidence checked and the reason for this decision."
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                if (validation) setValidation("");
              }}
            />
          </label>
          {validation ? (
            <p className={styles.fieldError} role="alert">{validation}</p>
          ) : null}
          {approvalDisabled ? (
            <p className={styles.sequenceNote}>
              {approvalDisabledMessage}
            </p>
          ) : null}
          <div className={styles.reviewActions}>
            <button
              className={styles.secondaryButton}
              disabled={busy}
              type="button"
              onClick={() => void submit("rejected")}
            >
              Reject
            </button>
            <button
              className={styles.primaryButton}
              disabled={busy || approvalDisabled}
              type="button"
              onClick={() => void submit("approved")}
            >
              {busy ? "Recording..." : "Approve"}
            </button>
          </div>
        </>
      ) : current ? (
        <p className={styles.sequenceNote}>
          This decision is immutable. A separately governed withdrawal is
          required to supersede an approval.
        </p>
      ) : (
        <p className={styles.sequenceNote}>
          A named Creditex administrator with verified governance access records this decision.
        </p>
      )}
    </section>
  );
}

export type CreditexOfficialSourceWorkbenchProps = {
  api: ApiCaller;
  canCapture: boolean;
  canReview: boolean;
  onDownload: (
    artifactId: string,
    fileName: string,
  ) => Promise<string>;
};

export function CreditexOfficialSourceWorkbench({
  api,
  canCapture,
  canReview,
  onDownload,
}: CreditexOfficialSourceWorkbenchProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<OfficialSource[]>([]);
  const [targets, setTargets] = useState<SourceTarget[]>([]);
  const [pagination, setPagination] =
    useState<SourcePagination>(EMPTY_PAGINATION);
  const [pageCursor, setPageCursor] = useState("");
  const [previousCursors, setPreviousCursors] = useState<string[]>([]);
  const [upload, setUpload] = useState<UploadFields>(EMPTY_UPLOAD);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [clientRequestId, setClientRequestId] = useState(
    () => `source-capture:${crypto.randomUUID()}`,
  );
  const [loading, setLoading] = useState(true);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState("");
  const [downloadBusy, setDownloadBusy] = useState("");
  const [accessedArtifacts, setAccessedArtifacts] =
    useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (cursor = "") => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ pageSize: "50" });
      if (cursor) query.set("cursor", cursor);
      const result = await api(
        `/api/creditex/official-sources?${query.toString()}`,
        {
        method: "GET",
        cache: "no-store",
        },
      );
      setSources(listValue(result.sources, officialSource));
      setTargets(listValue(result.targets, sourceTarget));
      setPagination(sourcePagination(result.sourcePagination));
      return true;
    } catch (loadError) {
      setError(errorMessage(
        loadError,
        "The governed official source register could not be loaded.",
      ));
      return false;
    } finally {
      setLoading(false);
    }
  }, [api]);

  const loadFirstPage = useCallback(async () => {
    if (await load("")) {
      setPageCursor("");
      setPreviousCursors([]);
    }
  }, [load]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void loadFirstPage(), 0);
    return () => window.clearTimeout(loadTimer);
  }, [loadFirstPage]);

  const draftTargets = useMemo(
    () => targets.filter((target) => target.state === "draft"),
    [targets],
  );

  const selectedTarget = useMemo(
    () => draftTargets.find((target) => targetKey(target) === upload.targetKey),
    [draftTargets, upload.targetKey],
  );

  const targetLabels = useMemo(
    () => new Map(
      draftTargets.map((target) => [targetKey(target), target.label]),
    ),
    [draftTargets],
  );

  const updateUpload = <K extends keyof UploadFields>(
    key: K,
    value: UploadFields[K],
  ) => {
    setUpload((current) => ({ ...current, [key]: value }));
  };

  const submitUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!selectedTarget || !sourceFile) {
      setError("Choose a draft target and the exact official source file.");
      return;
    }
    const retrievedAt = new Date(upload.assertedRetrievedAt);
    if (!Number.isFinite(retrievedAt.getTime())) {
      setError("Enter the date and time the official source was retrieved.");
      return;
    }

    const body = new FormData();
    body.set("clientRequestId", clientRequestId);
    body.set("sourceUrl", upload.sourceUrl.trim());
    body.set("sourceTitle", upload.sourceTitle.trim());
    body.set("sourceVersion", upload.sourceVersion.trim());
    body.set("assertedRetrievedAt", retrievedAt.toISOString());
    body.set("citationLocation", upload.citationLocation.trim());
    body.set("targetType", selectedTarget.type);
    body.set("targetId", selectedTarget.id);
    body.set("sourceFile", sourceFile);
    if (upload.sourceEtag.trim()) {
      body.set("sourceEtag", upload.sourceEtag.trim());
    }
    if (upload.sourceLastModified.trim()) {
      body.set("sourceLastModified", upload.sourceLastModified.trim());
    }

    setUploadBusy(true);
    try {
      await api("/api/creditex/official-sources", {
        method: "POST",
        body,
      });
      setMessage(
        "Exact source bytes retained. Independent artifact and binding reviews are still required.",
      );
      setUpload(EMPTY_UPLOAD);
      setSourceFile(null);
      setClientRequestId(`source-capture:${crypto.randomUUID()}`);
      if (fileInput.current) fileInput.current.value = "";
      await loadFirstPage();
    } catch (uploadError) {
      setError(errorMessage(
        uploadError,
        "The official source could not be retained.",
      ));
    } finally {
      setUploadBusy(false);
    }
  };

  const recordDecision = async (
    subjectType: ReviewSubject,
    subjectId: string,
    decision: ReviewDecision,
    note: string,
  ) => {
    const busyKey = `${subjectType}:${subjectId}`;
    setReviewBusy(busyKey);
    setError("");
    setMessage("");
    try {
      await api("/api/creditex/official-sources/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "record_decision",
          subjectType,
          subjectId,
          decision,
          reviewNote: note,
        }),
      });
      setMessage(
        `${subjectType === "artifact" ? "Artifact" : "Binding"} decision recorded.`,
      );
      await loadFirstPage();
    } catch (reviewError) {
      setError(errorMessage(
        reviewError,
        "The governance decision could not be recorded.",
      ));
      throw reviewError;
    } finally {
      setReviewBusy("");
      }
  };

  const loadNextPage = async () => {
    if (!pagination.hasNext || !pagination.nextCursor) return;
    const nextCursor = pagination.nextCursor;
    if (await load(nextCursor)) {
      setPreviousCursors((current) => [...current, pageCursor]);
      setPageCursor(nextCursor);
    }
  };

  const loadPreviousPage = async () => {
    const previousCursor = previousCursors.at(-1);
    if (previousCursor === undefined) return;
    if (await load(previousCursor)) {
      setPreviousCursors((current) => current.slice(0, -1));
      setPageCursor(previousCursor);
    }
  };

  const download = async (artifact: OfficialSourceArtifact) => {
    setDownloadBusy(artifact.id);
    setError("");
    setMessage("");
    try {
      await onDownload(
        artifact.id,
        artifact.originalFileName,
      );
      setAccessedArtifacts((current) => {
        const next = new Set(current);
        next.add(artifact.id);
        return next;
      });
      setMessage("The retained source passed the custody check and was downloaded.");
    } catch (downloadError) {
      setError(errorMessage(
        downloadError,
        "The retained official source could not be downloaded.",
      ));
    } finally {
      setDownloadBusy("");
    }
  };

  return (
    <section className={styles.workbench} aria-labelledby="official-source-title">
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Official source custody</span>
          <h2 id="official-source-title">Governed source workbench</h2>
          <p>
            Retain exact government source bytes, bind them to a draft compliance
            target, then complete independent artifact and binding reviews.
          </p>
        </div>
        <button
          className={styles.secondaryButton}
          disabled={loading}
          type="button"
          onClick={() => {
            void loadFirstPage();
          }}
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </header>

      <div className={styles.boundary} role="note">
        <strong>
          {canCapture ? "Draft only and immutable" : "Read-only custody view"}
        </strong>
        <span>
          {canCapture
            ? "Capture never activates a rule. Retained bytes, server hash and target citation stay fixed. Publication remains a separate governed action."
            : "Inspect current government links, exact retained bytes, hashes and immutable review decisions. This role cannot capture or approve a source."}
        </span>
      </div>

      {message ? (
        <p className={styles.notice} role="status">{message}</p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">{error}</p>
      ) : null}

      {canCapture ? (
        <form className={styles.uploadPanel} onSubmit={submitUpload}>
        <header>
          <span>Capture</span>
          <h3>Upload exact official source</h3>
          <p>
            Use the downloaded government file. A website link alone is not
            retained evidence.
          </p>
        </header>
        <div className={styles.formGrid}>
          <label className={`${styles.field} ${styles.wideField}`}>
            <span>Draft compliance target</span>
            <select
              required
              value={upload.targetKey}
              onChange={(event) => updateUpload("targetKey", event.target.value)}
            >
              <option value="">Choose a draft target</option>
              {draftTargets.map((target) => (
                <option key={targetKey(target)} value={targetKey(target)}>
                  {readable(target.type)} | {target.label}
                </option>
              ))}
            </select>
            <small>
              {draftTargets.length
                ? "Only draft targets can receive a source binding."
                : "No eligible draft targets are available. Create one in the governance workspace below, then refresh."}
            </small>
          </label>
          <label className={`${styles.field} ${styles.wideField}`}>
            <span>Current government source URL</span>
            <input
              required
              inputMode="url"
              maxLength={1000}
              placeholder="Paste the official source URL"
              type="url"
              value={upload.sourceUrl}
              onChange={(event) => updateUpload("sourceUrl", event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Source title</span>
            <input
              required
              maxLength={300}
              value={upload.sourceTitle}
              onChange={(event) => updateUpload("sourceTitle", event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Official version or effective date</span>
            <input
              required
              maxLength={160}
              value={upload.sourceVersion}
              onChange={(event) => updateUpload("sourceVersion", event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Retrieved at</span>
            <input
              required
              type="datetime-local"
              value={upload.assertedRetrievedAt}
              onChange={(event) =>
                updateUpload("assertedRetrievedAt", event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Citation location</span>
            <input
              required
              maxLength={500}
              placeholder="Page, table, clause or worksheet"
              value={upload.citationLocation}
              onChange={(event) =>
                updateUpload("citationLocation", event.target.value)}
            />
          </label>
          <label className={`${styles.field} ${styles.wideField}`}>
            <span>Exact source file</span>
            <input
              ref={fileInput}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.json,.xml,.html,.htm,.txt,.csv"
              required
              type="file"
              onChange={(event) =>
                setSourceFile(event.currentTarget.files?.[0] || null)}
            />
            <small>Maximum retained file size is 15 MB.</small>
          </label>
        </div>
        <details className={styles.optional}>
          <summary>Optional HTTP source metadata</summary>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>ETag</span>
              <input
                maxLength={300}
                value={upload.sourceEtag}
                onChange={(event) =>
                  updateUpload("sourceEtag", event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>Last-Modified</span>
              <input
                maxLength={300}
                value={upload.sourceLastModified}
                onChange={(event) =>
                  updateUpload("sourceLastModified", event.target.value)}
              />
            </label>
          </div>
        </details>
        <div className={styles.uploadActions}>
          <span>
            {sourceFile
              ? `${sourceFile.name} | ${formattedBytes(sourceFile.size)}`
              : "No file selected"}
          </span>
          <button
            className={styles.primaryButton}
            disabled={uploadBusy || !draftTargets.length}
            type="submit"
          >
            {uploadBusy ? "Retaining..." : "Retain source"}
          </button>
        </div>
        </form>
      ) : null}

      <section className={styles.register} aria-labelledby="source-register-title">
        <header className={styles.registerHeading}>
          <div>
            <span className={styles.eyebrow}>Custody register</span>
            <h3 id="source-register-title">Retained official sources</h3>
          </div>
          <strong>
            {sources.length} shown of {pagination.total} record
            {pagination.total === 1 ? "" : "s"}
          </strong>
        </header>

        {loading && !sources.length ? (
          <p className={styles.zeroState}>Loading governed source records...</p>
        ) : !sources.length ? (
          <div className={styles.zeroState}>
            <strong>No official source has been retained</strong>
            <span>
              Upload exact government source bytes and bind them to an eligible
              draft target to start independent review.
            </span>
          </div>
        ) : (
          <div className={styles.sourceList}>
            {sources.map((source) => {
              const artifactApproved =
                source.artifactReview?.decision === "approved";
              const binding = source.binding;
              const currentUrl = source.artifact.sourceUrl.startsWith("https://")
                ? source.artifact.sourceUrl
                : "";
              return (
                <article
                  className={styles.sourceCard}
                  key={`${source.artifact.id}:${binding?.id || "library"}`}
                >
                  <header className={styles.sourceHeader}>
                    <div>
                      <span>
                        {binding
                          ? targetLabels.get(
                            `${binding.targetType}:${binding.targetId}`,
                          ) || `${readable(binding.targetType)} | ${binding.targetId}`
                          : "Forms document library | placement pending"}
                      </span>
                      <h4>{source.artifact.sourceTitle}</h4>
                      <p>
                        {source.artifact.sourceVersion} |{" "}
                        {source.artifact.originalFileName}
                      </p>
                    </div>
                    <div className={styles.sourceActions}>
                      {currentUrl ? (
                        <a
                          className={styles.linkButton}
                          href={currentUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Current source
                        </a>
                      ) : null}
                      <button
                        className={styles.secondaryButton}
                        disabled={downloadBusy === source.artifact.id}
                        type="button"
                        onClick={() => void download(source.artifact)}
                      >
                        {downloadBusy === source.artifact.id
                          ? "Checking..."
                          : "Download retained file"}
                      </button>
                    </div>
                  </header>

                  <dl className={styles.metadata}>
                    <div>
                      <dt>Server SHA-256</dt>
                      <dd className={styles.hash}>{source.artifact.sha256}</dd>
                    </div>
                    <div>
                      <dt>Retained bytes</dt>
                      <dd>
                        {formattedBytes(source.artifact.sizeBytes)} |{" "}
                        {source.artifact.sizeBytes.toLocaleString("en-AU")} bytes
                      </dd>
                    </div>
                    <div>
                      <dt>Custody status</dt>
                      <dd>{readable(source.artifact.custodyState)}</dd>
                    </div>
                    {binding ? (
                      <div>
                        <dt>Binding status</dt>
                        <dd>{readable(binding.bindingState)}</dd>
                      </div>
                    ) : (
                      <div>
                        <dt>Workflow placement</dt>
                        <dd>Waiting for artifact approval</dd>
                      </div>
                    )}
                    <div>
                      <dt>Retrieved</dt>
                      <dd>{formattedDate(source.artifact.assertedRetrievedAt)}</dd>
                    </div>
                    <div>
                      <dt>Citation</dt>
                      <dd>
                        {binding?.citationLocation
                          || "Chosen when the approved document is attached to a workflow"}
                      </dd>
                    </div>
                  </dl>

                  <details className={styles.sourceDetails}>
                    <summary>Custody and source metadata</summary>
                    <dl>
                      <div>
                        <dt>Artifact ID</dt>
                        <dd>{source.artifact.id}</dd>
                      </div>
                      {binding ? (
                        <div>
                          <dt>Binding ID</dt>
                          <dd>{binding.id}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>Content type</dt>
                        <dd>{source.artifact.contentType || "Not supplied"}</dd>
                      </div>
                      <div>
                        <dt>Captured</dt>
                        <dd>{formattedDate(source.artifact.capturedAt)}</dd>
                      </div>
                      <div>
                        <dt>ETag</dt>
                        <dd>{source.artifact.sourceEtag || "Not supplied"}</dd>
                      </div>
                      <div>
                        <dt>Last-Modified</dt>
                        <dd>
                          {source.artifact.sourceLastModified || "Not supplied"}
                        </dd>
                      </div>
                    </dl>
                  </details>

                  <div className={styles.reviewGrid}>
                    <ReviewControls
                      approvalDisabled={
                        !accessedArtifacts.has(source.artifact.id)
                      }
                      approvalDisabledMessage="Download this exact retained file in the current session before approving it."
                      busy={reviewBusy === `artifact:${source.artifact.id}`}
                      canReview={canReview}
                      current={source.artifactReview}
                      subjectId={source.artifact.id}
                      subjectType="artifact"
                      onDecision={recordDecision}
                    />
                    {binding ? (
                      <ReviewControls
                        approvalDisabled={!artifactApproved}
                        busy={reviewBusy === `binding:${binding.id}`}
                        canReview={canReview}
                        current={source.bindingReview}
                        subjectId={binding.id}
                        subjectType="binding"
                        onDecision={recordDecision}
                      />
                    ) : (
                      <section className={styles.libraryReviewNotice}>
                        <span>Workflow placement</span>
                        <strong>Not attached yet</strong>
                        <p>
                          Approve the exact artifact first. A Forms author can
                          then place it against a precise workflow question,
                          declaration or requirement for separate review.
                        </p>
                      </section>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <footer className={styles.pagination}>
          <span>
            Page {previousCursors.length + 1} | {pagination.pageSize} per page
          </span>
          <div>
            <button
              className={styles.secondaryButton}
              disabled={loading || !previousCursors.length}
              type="button"
              onClick={() => void loadPreviousPage()}
            >
              Previous
            </button>
            <button
              className={styles.secondaryButton}
              disabled={loading || !pagination.hasNext}
              type="button"
              onClick={() => void loadNextPage()}
            >
              Next
            </button>
          </div>
        </footer>
      </section>
    </section>
  );
}

export default CreditexOfficialSourceWorkbench;
