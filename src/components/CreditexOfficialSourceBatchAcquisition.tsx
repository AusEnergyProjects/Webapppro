"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import styles from "./CreditexOfficialSourceBatchAcquisition.module.css";

type Api = (
  path: string,
  init?: RequestInit,
) => Promise<Record<string, unknown>>;

type CandidateStatus = {
  sourceId: string;
  programCodes: string[];
  sourceTitle: string;
  sourceVersion: string;
  statedEffectiveDate: string;
  authorityHost: string;
  officialUrl: string;
  expectedContentType: string;
  expectedSizeBytes: number;
  expectedSha256: string;
  status: string;
  artifactId: string;
  capturedAt: string;
  latestReviewDecision: string;
};

type AcquisitionSummary = {
  manifestContract: string;
  sourceAuditManifestSha256: string;
  total: number;
  imported: number;
  missing: number;
  pendingIndependentReview: number;
  custodyReceiptMismatches: number;
  operationallyReady: number;
};

type BatchItem = {
  sourceId: string;
  status: string;
  code: string;
  error: string;
};

type StatusFilter = "all" | "missing" | "pending" | "approved" | "error";

const EMPTY_SUMMARY: AcquisitionSummary = {
  manifestContract: "",
  sourceAuditManifestSha256: "",
  total: 0,
  imported: 0,
  missing: 0,
  pendingIndependentReview: 0,
  custodyReceiptMismatches: 0,
  operationallyReady: 0,
};

const MAXIMUM_BATCH_ITEMS = 8;
const MAXIMUM_BATCH_BYTES = 32 * 1024 * 1024;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function count(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseCandidate(value: unknown): CandidateStatus | null {
  const item = record(value);
  const sourceId = text(item.sourceId);
  const status = text(item.status);
  if (!sourceId || !status) return null;
  return {
    sourceId,
    programCodes: strings(item.programCodes),
    sourceTitle: text(item.sourceTitle),
    sourceVersion: text(item.sourceVersion),
    statedEffectiveDate: text(item.statedEffectiveDate),
    authorityHost: text(item.authorityHost),
    officialUrl: text(item.officialUrl),
    expectedContentType: text(item.expectedContentType),
    expectedSizeBytes: count(item.expectedSizeBytes),
    expectedSha256: text(item.expectedSha256),
    status,
    artifactId: text(item.artifactId),
    capturedAt: text(item.capturedAt),
    latestReviewDecision: text(item.latestReviewDecision),
  };
}

function parseBatchItem(value: unknown): BatchItem | null {
  const item = record(value);
  const sourceId = text(item.sourceId);
  if (!sourceId) return null;
  return {
    sourceId,
    status: text(item.status),
    code: text(item.code),
    error: text(item.error),
  };
}

function statusKind(status: string): Exclude<StatusFilter, "all"> {
  if (status === "missing_from_creditex_custody") return "missing";
  if (status === "custody_pending_independent_review") return "pending";
  if (status === "custody_review_approved_unbound") return "approved";
  return "error";
}

function statusLabel(item: CandidateStatus) {
  switch (item.status) {
    case "missing_from_creditex_custody":
      return "Missing from Creditex custody";
    case "custody_pending_independent_review":
      return "Pending independent Creditex review";
    case "custody_review_approved_unbound":
      return "Approved source | not attached to an activity";
    case "custody_review_rejected_unbound":
      return "Rejected source | not attached";
    case "custody_review_withdrawn_unbound":
      return "Withdrawn source | not attached";
    case "custody_receipt_mismatch":
      return "Custody receipt mismatch | action required";
    default:
      return item.status.replaceAll("_", " ");
  }
}

function formattedBytes(bytes: number) {
  if (bytes < 1024) return `${bytes.toLocaleString("en-AU")} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function CreditexOfficialSourceBatchAcquisition({
  api,
  endpoint,
  canImport,
  onImported,
}: {
  api: Api;
  endpoint: string;
  canImport: boolean;
  onImported?: () => Promise<void> | void;
}) {
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [items, setItems] = useState<CandidateStatus[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let cursor = "";
      const allItems: CandidateStatus[] = [];
      let nextSummary = EMPTY_SUMMARY;
      for (let page = 0; page < 3; page += 1) {
        const search = new URLSearchParams({ pageSize: "100" });
        if (cursor) search.set("afterSourceId", cursor);
        const response = await api(`${endpoint}?${search.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        const status = record(response.sourceAcquisitionStatus);
        if (page === 0) {
          nextSummary = {
            manifestContract: text(status.manifestContract),
            sourceAuditManifestSha256: text(
              status.sourceAuditManifestSha256,
            ),
            total: count(status.total),
            imported: count(status.imported),
            missing: count(status.missing),
            pendingIndependentReview: count(status.pendingIndependentReview),
            custodyReceiptMismatches: count(status.custodyReceiptMismatches),
            operationallyReady: count(status.operationallyReady),
          };
        }
        const pageItems = Array.isArray(status.items)
          ? status.items.map(parseCandidate).filter(
              (item): item is CandidateStatus => Boolean(item),
            )
          : [];
        allItems.push(...pageItems);
        if (status.hasNext !== true) break;
        const nextCursor = text(status.nextCursor);
        if (!nextCursor || nextCursor === cursor) {
          throw new Error("The source status register returned an invalid cursor.");
        }
        cursor = nextCursor;
      }
      if (nextSummary.total !== allItems.length) {
        throw new Error(
          `Only ${allItems.length} of ${nextSummary.total} source statuses were returned.`,
        );
      }
      setSummary(nextSummary);
      setItems(allItems);
      setSelected((current) => new Set(
        [...current].filter((sourceId) =>
          allItems.some((item) =>
            item.sourceId === sourceId
            && item.status === "missing_from_creditex_custody"),
        ),
      ));
    } catch (loadError) {
      setError(errorMessage(
        loadError,
        "Official source acquisition status could not be loaded.",
      ));
    } finally {
      setLoading(false);
    }
  }, [api, endpoint]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== "all" && statusKind(item.status) !== filter) return false;
      if (!needle) return true;
      return [
        item.sourceTitle,
        item.sourceVersion,
        item.authorityHost,
        item.programCodes.join(" "),
      ].join(" ").toLowerCase().includes(needle);
    });
  }, [filter, items, query]);

  const selectedItems = useMemo(
    () => items.filter((item) => selected.has(item.sourceId)),
    [items, selected],
  );
  const selectedBytes = selectedItems.reduce(
    (total, item) => total + item.expectedSizeBytes,
    0,
  );
  const approvedCount = items.filter(
    (item) => item.status === "custody_review_approved_unbound",
  ).length;

  function setCandidateSelected(item: CandidateStatus, checked: boolean) {
    setNotice("");
    setError("");
    setSelected((current) => {
      const next = new Set(current);
      if (!checked) {
        next.delete(item.sourceId);
        return next;
      }
      const currentBytes = items
        .filter((candidate) => current.has(candidate.sourceId))
        .reduce((total, candidate) => total + candidate.expectedSizeBytes, 0);
      const nextBytes = currentBytes + item.expectedSizeBytes;
      if (next.size >= MAXIMUM_BATCH_ITEMS) {
        setError("Each import action is limited to eight official sources.");
        return current;
      }
      if (nextBytes > MAXIMUM_BATCH_BYTES) {
        setError("Each import action is limited to 32 MB of expected bytes.");
        return current;
      }
      next.add(item.sourceId);
      return next;
    });
  }

  function selectNextVisibleBatch() {
    const next = new Set<string>();
    let bytes = 0;
    for (const item of visibleItems) {
      if (item.status !== "missing_from_creditex_custody") continue;
      if (next.size >= MAXIMUM_BATCH_ITEMS) break;
      if (bytes + item.expectedSizeBytes > MAXIMUM_BATCH_BYTES) continue;
      next.add(item.sourceId);
      bytes += item.expectedSizeBytes;
    }
    setSelected(next);
    setConfirmed(false);
    setError("");
    setNotice(next.size
      ? `${next.size} missing source${next.size === 1 ? "" : "s"} selected for one bounded import action.`
      : "No selectable missing source is visible in this filter.");
  }

  async function importSelected() {
    if (!selectedItems.length || !confirmed || importing) return;
    setImporting(true);
    setError("");
    setNotice("Fetching and verifying the selected exact official source bytes...");
    setBatchItems([]);
    try {
      const response = await api(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifestContract: summary.manifestContract,
          sourceIds: selectedItems.map((item) => item.sourceId),
          confirmExactOfficialSourceCustodyImport: true,
        }),
      });
      const results = Array.isArray(response.items)
        ? response.items.map(parseBatchItem).filter(
            (item): item is BatchItem => Boolean(item),
          )
        : [];
      const failed = count(response.failed);
      const captured = count(response.captured);
      const reused = count(response.reused);
      setBatchItems(results);
      setSelected(new Set());
      setConfirmed(false);
      setNotice(
        `${captured} exact source${captured === 1 ? "" : "s"} verified into custody${reused ? `, including ${reused} safe replay${reused === 1 ? "" : "s"}` : ""}. ${failed ? `${failed} failed and requires action. ` : ""}Every retained source still requires independent Creditex review and activity attachment.`,
      );
      await load();
      await onImported?.();
    } catch (importError) {
      setError(errorMessage(
        importError,
        "The selected official sources could not be imported safely.",
      ));
      setNotice("");
    } finally {
      setImporting(false);
    }
  }

  return (
    <section
      className={styles.panel}
      aria-labelledby="official-source-acquisition-title"
    >
      <header className={styles.heading}>
        <div>
          <span>Exact official source custody</span>
          <h3 id="official-source-acquisition-title">
            Current source acquisition register
          </h3>
          <p>
            Government and regulator candidates are tracked by official URL,
            file type, byte size and SHA-256. Select missing entries to fetch
            and verify the exact original bytes into Creditex custody.
          </p>
        </div>
        <button type="button" disabled={loading || importing} onClick={() => void load()}>
          {loading ? "Loading..." : "Refresh status"}
        </button>
      </header>

      <aside className={styles.boundary} role="note">
        <strong>Custody import only</strong>
        <span>
          Import never approves a source, attaches it to an activity, marks it
          current, or makes a certificate action ready. Independent Creditex
          review and precise workflow attachment remain separate controls.
        </span>
      </aside>

      <dl className={styles.summary}>
        <div><dt>Tracked</dt><dd>{summary.total}</dd></div>
        <div><dt>Missing</dt><dd>{summary.missing}</dd></div>
        <div><dt>Pending review</dt><dd>{summary.pendingIndependentReview}</dd></div>
        <div><dt>Approved, unbound</dt><dd>{approvedCount}</dd></div>
        <div data-alert={summary.custodyReceiptMismatches > 0}>
          <dt>Custody errors</dt><dd>{summary.custodyReceiptMismatches}</dd>
        </div>
      </dl>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.controls}>
        <label>
          Find source
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Program, title or authority"
          />
        </label>
        <label>
          Custody status
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as StatusFilter)}
          >
            <option value="all">All source candidates</option>
            <option value="missing">Missing</option>
            <option value="pending">Pending review</option>
            <option value="approved">Approved, unbound</option>
            <option value="error">Rejected, withdrawn or custody error</option>
          </select>
        </label>
        {canImport ? (
          <button
            type="button"
            disabled={loading || importing}
            onClick={selectNextVisibleBatch}
          >
            Select next visible batch
          </button>
        ) : null}
      </div>

      <div className={styles.list} aria-busy={loading}>
        {visibleItems.map((item) => {
          const kind = statusKind(item.status);
          const selectable = canImport
            && item.status === "missing_from_creditex_custody";
          return (
            <article key={item.sourceId} data-status={kind}>
              {canImport ? (
                <input
                  aria-label={`Select ${item.sourceTitle}`}
                  type="checkbox"
                  disabled={!selectable || importing}
                  checked={selected.has(item.sourceId)}
                  onChange={(event) =>
                    setCandidateSelected(item, event.target.checked)}
                />
              ) : null}
              <div>
                <span>{item.programCodes.join(" | ") || "Program not mapped"}</span>
                <strong>{item.sourceTitle || item.sourceId}</strong>
                <small>
                  {item.authorityHost} | {formattedBytes(item.expectedSizeBytes)} | {item.expectedContentType}
                </small>
                <small className={styles.hash}>SHA-256 {item.expectedSha256}</small>
              </div>
              <div className={styles.itemStatus}>
                <strong>{statusLabel(item)}</strong>
                {item.officialUrl.startsWith("https://") ? (
                  <a href={item.officialUrl} target="_blank" rel="noreferrer">
                    Open official source
                  </a>
                ) : null}
              </div>
            </article>
          );
        })}
        {!loading && !visibleItems.length ? (
          <p className={styles.empty}>No source candidates match this view.</p>
        ) : null}
      </div>

      <footer className={styles.actions}>
        <div>
          <strong>{selectedItems.length} of {MAXIMUM_BATCH_ITEMS} selected</strong>
          <span>{formattedBytes(selectedBytes)} of 32 MB</span>
        </div>
        {canImport ? (
          <>
            <label className={styles.confirmation}>
              <input
                type="checkbox"
                checked={confirmed}
                disabled={!selectedItems.length || importing}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                Import these exact sources into pending Creditex custody only.
              </span>
            </label>
            <button
              className={styles.primary}
              type="button"
              disabled={!selectedItems.length || !confirmed || importing}
              onClick={() => void importSelected()}
            >
              {importing ? "Importing exact bytes..." : "Import selected sources"}
            </button>
          </>
        ) : (
          <p>This role can inspect source status but cannot start an import.</p>
        )}
      </footer>

      {batchItems.length ? (
        <details className={styles.outcomes} open={batchItems.some((item) => item.status === "failed")}>
          <summary>Last import outcomes | {batchItems.length} item(s)</summary>
          <ul>
            {batchItems.map((item) => (
              <li key={item.sourceId} data-failed={item.status === "failed"}>
                <strong>{item.sourceId}</strong>
                <span>{item.status.replaceAll("_", " ")}</span>
                {item.error ? <small>{item.code} | {item.error}</small> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className={styles.manifest}>
        <summary>Tracked manifest identity</summary>
        <dl>
          <div><dt>Contract</dt><dd>{summary.manifestContract || "Not loaded"}</dd></div>
          <div>
            <dt>Acquisition audit SHA-256</dt>
            <dd>{summary.sourceAuditManifestSha256 || "Not loaded"}</dd>
          </div>
          <div><dt>Operationally ready from import</dt><dd>{summary.operationallyReady}</dd></div>
        </dl>
      </details>
    </section>
  );
}

export default CreditexOfficialSourceBatchAcquisition;
