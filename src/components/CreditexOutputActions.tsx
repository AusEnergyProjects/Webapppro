"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { firebaseAuth } from "@/lib/firebase-client";
import styles from "./CreditexOutputActions.module.css";

type Api = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;

function newClientRequestId(prefix: string) {
  return `${prefix}:${globalThis.crypto.randomUUID()}`;
}

type OutputAction = {
  id: string;
  actionKind: "certificate_submission" | "operational_output";
  outputClass: string;
  outputCode: string;
  activityTemplateId: string;
  workPackInstanceId: string;
  packetSha256: string;
  preparedByUid: string;
  preparedAt: string;
  status: string;
  statusAt: string;
  providerReference: string;
  jobReference: string;
  jobLabel: string;
  customerLabel: string;
  activityTitle: string;
  capabilities: OutputCapabilities;
  review: null | { decision: string; reviewedByUid: string; note: string };
};

type OutputCapabilities = {
  canPrepare: boolean;
  canReview: boolean;
  canSubmit: boolean;
  canRecordOutcome: boolean;
};

type OutputCandidate = {
  activityTemplateId: string;
  caseInstanceId: string;
  finalRecordId: string;
  jobReference: string;
  jobLabel: string;
  customerLabel: string;
  programCode: string;
  activityCode: string;
  activityTitle: string;
  outputClass: string;
  outputCode: string;
  actionKind: "certificate_submission" | "operational_output";
  ready: boolean;
  blockers: string[];
  blockerMessage: string;
  expectedQuantity: string;
  expectedUnit: string;
  existingActionId: string;
  existingStatus: string;
  capabilities: OutputCapabilities;
};

type OutputReceipt = {
  id: string;
  packetId: string;
  providerName: string;
  providerReference: string;
  providerStatus: string;
  httpStatus: number;
  responseSha256: string;
  responseReceivedAt: string;
};

type SresActivationRecord = {
  recordId: string;
  evidenceKind: string;
  resultCode: string;
  reviewed: boolean;
  responseSha256: string;
  supersedesRecordId: string;
};

type SresActivationGate = {
  evidenceKind: string;
  title: string;
  description: string;
  expectedResult: string;
  status: "missing" | "awaiting_review" | "approved" | "rejected";
  record: SresActivationRecord | null;
};

type SresOption = { value: string; label: string };
type SresSourceOption = SresOption & { sourceSha256: string };
type SresEngineReceiptOption = SresOption & { sourceSha256: string };
type SresActivationCandidate = {
  candidate: {
    jobReference: string;
    jobLabel: string;
    customerLabel: string;
    activityTitle: string;
    outputCode: string;
    activityTemplateId: string;
    caseInstanceId: string;
    complianceCaseId: string;
  };
  activation: {
    activityDate: string;
    gates: SresActivationGate[];
    ready: boolean;
    blockers: string[];
    snapshot: null | { snapshotId: string };
    capabilities: {
      canRecord: boolean;
      canReview: boolean;
      canFreeze: boolean;
    };
  };
  options: {
    sources: SresSourceOption[];
    engineReceipts: SresEngineReceiptOption[];
    abilities: (SresOption & { abilityCode: string })[];
  };
};

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The governed action could not be saved.";
}

const blockerLabels: Record<string, string> = {
  output_action_already_prepared: "This exact final work pack already has an output packet.",
  conflicting_output_action_already_prepared:
    "A conflicting output type already exists for this exact final work pack.",
  governed_program_output_definition_required:
    "The governed programme output definition must be approved.",
  approved_output_class_source_binding_required:
    "Approve the exact official source binding that defines this output.",
  exact_product_registry_snapshot_required:
    "Complete and verify the exact product selection.",
  exact_scenario_rule_resolution_required:
    "Complete and verify the exact scenario selection.",
  approved_verified_calculator_run_required:
    "Run the exact calculator and obtain an independent approval.",
  completed_current_work_pack_response_required:
    "Complete the current activity form and all required evidence.",
  immutable_final_work_pack_record_required:
    "Finalise the completed form and its immutable PDF.",
  approved_effective_dated_work_pack_version_required:
    "Publish the independently approved current activity form.",
  approved_official_source_bindings_required:
    "Approve the exact current official-source bindings.",
  independent_named_review_required:
    "A different named compliance reviewer must approve the governed record.",
  actor_not_authorised_to_prepare:
    "Your current compliance role can view this job but cannot prepare output packets.",
};

function blockerLabel(value: string) {
  return blockerLabels[value]
    || value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function CreditexOutputActions(props: Readonly<{
  api: Api;
  endpoint: string;
  contextLabel: string;
}>) {
  const { api, endpoint, contextLabel } = props;
  const [actions, setActions] = useState<OutputAction[]>([]);
  const [candidates, setCandidates] = useState<OutputCandidate[]>([]);
  const [receipts, setReceipts] = useState<OutputReceipt[]>([]);
  const [sresActivationCandidates, setSresActivationCandidates] = useState<
    SresActivationCandidate[]
  >([]);
  const [sresDrafts, setSresDrafts] = useState<Record<
    string,
    Record<string, string>
  >>({});
  const [selectedKey, setSelectedKey] = useState("");
  const [search, setSearch] = useState("");
  const [reviewComment, setReviewComment] = useState(
    "Independent evidence and exact packet hashes checked.",
  );
  const [providerName, setProviderName] = useState("");
  const [providerReference, setProviderReference] = useState("");
  const [providerStatus, setProviderStatus] = useState("provider_accepted");
  const [providerResponse, setProviderResponse] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"info" | "error">("info");

  const absorb = useCallback((result: Record<string, unknown>) => {
    setActions(rows<OutputAction>(result.actions));
    setCandidates(rows<OutputCandidate>(result.candidates));
    setReceipts(rows<OutputReceipt>(result.receipts));
    setSresActivationCandidates(
      rows<SresActivationCandidate>(result.sresActivationCandidates),
    );
  }, []);

  const refresh = useCallback(async () => {
    try {
      absorb(await api(endpoint));
    } catch (error) {
      setNotice(errorMessage(error));
      setNoticeKind("error");
    }
  }, [absorb, api, endpoint]);

  useEffect(() => {
    let cancelled = false;
    void api(endpoint).then((result) => {
      if (!cancelled) absorb(result);
    }, (error) => {
      if (!cancelled) {
        setNotice(errorMessage(error));
        setNoticeKind("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [absorb, api, endpoint]);

  const save = useCallback(async (
    method: "POST" | "PATCH",
    body: Record<string, unknown>,
    key: string,
  ) => {
    setBusy(key);
    setNotice("");
    try {
      const result = await api(endpoint, {
        method,
        body: JSON.stringify(body),
      });
      absorb(result);
      setNotice(
        "Governed record saved. The server retained the exact immutable hashes.",
      );
      setNoticeKind("info");
    } catch (error) {
      setNotice(errorMessage(error));
      setNoticeKind("error");
    } finally {
      setBusy("");
    }
  }, [absorb, api, endpoint]);

  const candidateKey = (candidate: OutputCandidate) =>
    `${candidate.activityTemplateId}:${candidate.caseInstanceId}`;
  const visibleCandidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return candidates
      .filter((candidate) => !term || [
        candidate.jobReference,
        candidate.jobLabel,
        candidate.customerLabel,
        candidate.programCode,
        candidate.activityCode,
        candidate.activityTitle,
        candidate.outputCode,
        candidate.outputClass,
      ].some((value) => value.toLowerCase().includes(term)))
      .sort((left, right) =>
        Number(right.ready) - Number(left.ready)
          || right.jobReference.localeCompare(left.jobReference)
      );
  }, [candidates, search]);
  const selected = candidates.find((candidate) =>
    candidateKey(candidate) === selectedKey
  ) || null;
  const selectedSres = selected
    ? sresActivationCandidates.find((item) =>
        item.candidate.activityTemplateId === selected.activityTemplateId
          && item.candidate.caseInstanceId === selected.caseInstanceId
      ) || null
    : null;
  const receiptsByPacket = useMemo(() => {
    const grouped = new Map<string, OutputReceipt[]>();
    for (const receipt of receipts) {
      grouped.set(receipt.packetId, [
        ...(grouped.get(receipt.packetId) || []),
        receipt,
      ]);
    }
    return grouped;
  }, [receipts]);

  const prepare = () => {
    if (!selected || !selected.ready) return;
    void save("POST", {
      action: selected.actionKind === "certificate_submission"
        ? "prepare_certificate"
        : "prepare_operational",
      idempotencyKey:
        `output:${selected.actionKind}:${selected.finalRecordId}`,
      activityTemplateId: selected.activityTemplateId,
      caseInstanceId: selected.caseInstanceId,
    }, "prepare");
  };

  const draftKey = (gate: SresActivationGate) =>
    `${selectedSres?.candidate.complianceCaseId || ""}:${gate.evidenceKind}`;
  const gateDraft = (gate: SresActivationGate) =>
    sresDrafts[draftKey(gate)] || {};
  const updateGateDraft = (
    gate: SresActivationGate,
    field: string,
    value: string,
  ) => {
    const key = draftKey(gate);
    setSresDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] || {}), [field]: value },
    }));
  };

  const activationDetails = (
    gate: SresActivationGate,
    draft: Record<string, string>,
  ) => {
    switch (gate.evidenceKind) {
      case "rec_registry_submission_contract":
        return {
          submissionMethod: "manual",
          providerName: draft.providerName,
          schemaVersion: draft.schemaVersion,
          contractSha256: draft.contractSha256,
        };
      case "declaration_snapshot":
        return {
          declarationVersion: draft.declarationVersion,
          declarationDocumentSha256: draft.declarationDocumentSha256,
        };
      case "component_recall_status":
        return { providerReference: draft.providerReference };
      case "calculator_vector_suite":
        return { engineReceiptId: draft.engineReceiptId };
      case "registered_agent_assignment":
        return {
          participantAbilityId: draft.participantAbilityId,
          assignmentReference: draft.assignmentReference,
        };
      case "installer_accreditation":
      case "designer_accreditation":
        return { participantAbilityId: draft.participantAbilityId };
      default:
        return {};
    }
  };

  const recordSresGate = (gate: SresActivationGate) => {
    if (!selectedSres) return;
    const draft = gateDraft(gate);
    void save("POST", {
      action: "record_sres_activation",
      clientRequestId: newClientRequestId(
        `sres:${selectedSres.candidate.complianceCaseId}:${gate.evidenceKind}`,
      ),
      activityTemplateId: selectedSres.candidate.activityTemplateId,
      caseId: selectedSres.candidate.complianceCaseId,
      evidenceKind: gate.evidenceKind,
      subjectKey: `${selectedSres.candidate.jobReference}:${gate.evidenceKind}`,
      sourceArtifactId: draft.sourceArtifactId,
      sourceRecordKey: draft.sourceRecordKey,
      details: activationDetails(gate, draft),
      supersedesRecordId: gate.status === "rejected"
        ? gate.record?.recordId
        : "",
    }, `sres-record:${gate.evidenceKind}`);
  };

  const now = () => new Date().toISOString();

  async function downloadPacket(action: OutputAction) {
    setBusy(`download:${action.id}`);
    try {
      const user = firebaseAuth.currentUser;
      if (!user) throw new Error("Sign in to download the packet.");
      const token = await user.getIdToken();
      const response = await fetch(
        `${endpoint}?download=packet&packetId=${encodeURIComponent(action.id)}`,
        {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as {
          error?: string;
        };
        throw new Error(
          result.error || "The exact packet could not be downloaded.",
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        `creditex-output-${action.id.replace(/[^a-z0-9_-]+/gi, "-")}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice(errorMessage(error));
      setNoticeKind("error");
    } finally {
      setBusy("");
    }
  }

  async function downloadReceipt(receipt: OutputReceipt) {
    setBusy(`receipt:${receipt.id}`);
    try {
      const user = firebaseAuth.currentUser;
      if (!user) throw new Error("Sign in to download the provider response.");
      const token = await user.getIdToken();
      const response = await fetch(
        `${endpoint}?download=receipt&receiptId=${encodeURIComponent(receipt.id)}`,
        {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as {
          error?: string;
        };
        throw new Error(
          result.error || "The exact provider response could not be downloaded.",
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        `creditex-provider-receipt-${receipt.id.replace(/[^a-z0-9_-]+/gi, "-")}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice(errorMessage(error));
      setNoticeKind("error");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={styles.workspace} aria-labelledby="output-actions-title">
      <header className={styles.heading}>
        <div>
          <h2 id="output-actions-title">Certificate and programme outputs</h2>
          <p>
            {contextLabel} prepares exact immutable packets, independently
            reviews them, then retains the actual provider result. Trade
            accounts cannot use these controls.
          </p>
        </div>
        <button
          type="button"
          data-variant="secondary"
          disabled={Boolean(busy)}
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </header>
      {notice && (
        <p
          className={styles.notice}
          data-kind={noticeKind}
          role={noticeKind === "error" ? "alert" : "status"}
        >
          {notice}
        </p>
      )}

      <section className={styles.section}>
        <div className={styles.cardHeader}>
          <div>
            <h3>Prepare an exact output packet</h3>
            <p>
              Choose a completed current job. Readiness and remediation come
              directly from the governed server record.
            </p>
          </div>
        </div>
        <label className={styles.search}>
          Find a completed job
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search job, customer, programme or activity"
          />
        </label>
        <div className={styles.candidates}>
          {visibleCandidates.map((candidate) => {
            const key = candidateKey(candidate);
            const active = selectedKey === key;
            return (
              <article
                className={styles.candidate}
                data-selected={active ? "true" : "false"}
                key={key}
              >
                <button
                  className={styles.candidateSelect}
                  data-variant="secondary"
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedKey(key)}
                >
                  <span>
                    <strong>{candidate.jobReference}</strong>
                    <small>{candidate.customerLabel} · {candidate.jobLabel}</small>
                  </span>
                  <span>
                    <strong>{candidate.outputCode || candidate.programCode}</strong>
                    <small>
                      {candidate.actionKind === "certificate_submission"
                        ? "Tradable certificate"
                        : "Programme output"}
                    </small>
                  </span>
                  <span
                    className={styles.badge}
                    data-ready={candidate.ready ? "true" : "false"}
                  >
                    {candidate.ready
                      ? "Ready"
                      : candidate.existingActionId
                        ? candidate.existingStatus.replaceAll("_", " ")
                        : "Action required"}
                  </span>
                </button>
                <p className={styles.meta}>
                  {candidate.programCode} · {candidate.activityCode} ·{" "}
                  {candidate.activityTitle}
                  {candidate.expectedQuantity && (
                    <> · {candidate.expectedQuantity} {candidate.expectedUnit}</>
                  )}
                </p>
                {!candidate.ready && (
                  <ul className={styles.blockers}>
                    {candidate.blockerMessage && (
                      <li>{candidate.blockerMessage}</li>
                    )}
                    {candidate.blockers.map((blocker) => (
                      <li key={blocker}>{blockerLabel(blocker)}</li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
          {!visibleCandidates.length && (
            <p className={styles.empty}>
              No completed current work packs match this search.
            </p>
          )}
        </div>
        {selected && (
          <div className={styles.prepareBar}>
            <div>
              <strong>{selected.jobReference}</strong>
              <span>
                {selected.outputCode} ·{" "}
                {selected.actionKind === "certificate_submission"
                  ? "certificate submission"
                  : selected.outputClass.replaceAll("_", " ")}
              </span>
            </div>
            <button
              type="button"
              disabled={Boolean(busy) || !selected.ready}
              onClick={prepare}
            >
              {busy === "prepare"
                ? "Checking exact readiness…"
                : selected.ready
                  ? "Prepare immutable packet"
                  : "Resolve blockers before preparing"}
            </button>
          </div>
        )}
        {selectedSres && (
          <section className={styles.section} aria-label="SRES activation evidence">
            <div className={styles.cardHeader}>
              <div>
                <h3>SRES certificate activation</h3>
                <p>
                  {selectedSres.candidate.jobReference} · {selectedSres.candidate.activityTitle}.
                  Each exact source-backed gate is retained, independently
                  reviewed, then frozen into the certificate packet.
                </p>
              </div>
              <span
                className={styles.badge}
                data-ready={selectedSres.activation.ready ? "true" : "false"}
              >
                {selectedSres.activation.ready
                  ? "Activation ready"
                  : `${selectedSres.activation.gates.filter((gate) =>
                      gate.status === "approved"
                    ).length} of 8 approved`}
              </span>
            </div>
            <div className={styles.cards}>
              {selectedSres.activation.gates.map((gate) => {
                const draft = gateDraft(gate);
                const abilityOptions = selectedSres.options.abilities.filter((option) =>
                  gate.evidenceKind === "registered_agent_assignment"
                    ? option.abilityCode.includes("registered_agent")
                    : gate.evidenceKind === "installer_accreditation"
                      ? option.abilityCode.includes("installer")
                      : gate.evidenceKind === "designer_accreditation"
                        ? option.abilityCode.includes("designer")
                        : false
                );
                const selectedSource = selectedSres.options.sources.find((option) =>
                  option.value === draft.sourceArtifactId
                );
                const engineReceiptOptions = selectedSource
                  ? selectedSres.options.engineReceipts.filter((option) =>
                      option.sourceSha256 === selectedSource.sourceSha256
                    )
                  : [];
                return (
                  <article className={styles.card} key={gate.evidenceKind}>
                    <div className={styles.cardHeader}>
                      <div>
                        <h3>{gate.title}</h3>
                        <p>{gate.description}</p>
                      </div>
                      <span className={styles.badge}>{gate.status.replaceAll("_", " ")}</span>
                    </div>
                    {gate.record && (
                      <div className={styles.hash}>{gate.record.responseSha256}</div>
                    )}
                    {(gate.status === "missing" || gate.status === "rejected")
                      && selectedSres.activation.capabilities.canRecord && (
                      <div className={styles.split}>
                        <label>
                          Approved official source
                          <select
                            value={draft.sourceArtifactId || ""}
                            onChange={(event) => updateGateDraft(
                              gate,
                              "sourceArtifactId",
                              event.target.value,
                            )}
                          >
                            <option value="">Choose reviewed source</option>
                            {selectedSres.options.sources.map((option) => (
                              <option value={option.value} key={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Exact source record or section
                          <input
                            value={draft.sourceRecordKey || ""}
                            onChange={(event) => updateGateDraft(
                              gate,
                              "sourceRecordKey",
                              event.target.value,
                            )}
                            placeholder="Section, schema, register row or receipt reference"
                          />
                        </label>
                        {gate.evidenceKind === "rec_registry_submission_contract" && (
                          <>
                            <label>
                              Submission method
                              <input value="Manual provider pack" readOnly />
                            </label>
                            <label>
                              Provider name
                              <input
                                value={draft.providerName || ""}
                                onChange={(event) => updateGateDraft(
                                  gate,
                                  "providerName",
                                  event.target.value,
                                )}
                              />
                            </label>
                            <label>
                              Schema version
                              <input
                                value={draft.schemaVersion || ""}
                                onChange={(event) => updateGateDraft(
                                  gate,
                                  "schemaVersion",
                                  event.target.value,
                                )}
                              />
                            </label>
                            <label>
                              Exact contract SHA-256
                              <input
                                value={draft.contractSha256 || ""}
                                onChange={(event) => updateGateDraft(
                                  gate,
                                  "contractSha256",
                                  event.target.value,
                                )}
                                placeholder="sha256:…"
                              />
                            </label>
                          </>
                        )}
                        {gate.evidenceKind === "declaration_snapshot" && (
                          <>
                            <label>
                              Declaration version
                              <input
                                value={draft.declarationVersion || ""}
                                onChange={(event) => updateGateDraft(
                                  gate,
                                  "declarationVersion",
                                  event.target.value,
                                )}
                              />
                            </label>
                            <label>
                              Exact declaration document SHA-256
                              <input
                                value={draft.declarationDocumentSha256 || ""}
                                onChange={(event) => updateGateDraft(
                                  gate,
                                  "declarationDocumentSha256",
                                  event.target.value,
                                )}
                                placeholder="sha256:…"
                              />
                            </label>
                          </>
                        )}
                        {gate.evidenceKind === "component_recall_status" && (
                          <label>
                            Official recall search reference
                            <input
                              value={draft.providerReference || ""}
                              onChange={(event) => updateGateDraft(
                                gate,
                                "providerReference",
                                event.target.value,
                              )}
                            />
                          </label>
                        )}
                        {gate.evidenceKind === "calculator_vector_suite" && (
                          <label>
                            Passed calculator receipt
                            <select
                              value={draft.engineReceiptId || ""}
                              onChange={(event) => updateGateDraft(
                                gate,
                                "engineReceiptId",
                                event.target.value,
                              )}
                            >
                              <option value="">Choose passed receipt</option>
                              {engineReceiptOptions.map((option) => (
                                <option value={option.value} key={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {abilityOptions.length > 0 && (
                          <label>
                            Verified person or business
                            <select
                              value={draft.participantAbilityId || ""}
                              onChange={(event) => updateGateDraft(
                                gate,
                                "participantAbilityId",
                                event.target.value,
                              )}
                            >
                              <option value="">Choose active verified record</option>
                              {abilityOptions.map((option) => (
                                <option value={option.value} key={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {gate.evidenceKind === "registered_agent_assignment" && (
                          <label>
                            Exact Creditex assignment reference
                            <input
                              value={draft.assignmentReference || ""}
                              onChange={(event) => updateGateDraft(
                                gate,
                                "assignmentReference",
                                event.target.value,
                              )}
                            />
                          </label>
                        )}
                        <button
                          type="button"
                          disabled={Boolean(busy)
                            || !draft.sourceArtifactId
                            || !draft.sourceRecordKey}
                          onClick={() => recordSresGate(gate)}
                        >
                          {gate.status === "rejected"
                            ? "Replace rejected evidence"
                            : "Retain exact evidence"}
                        </button>
                      </div>
                    )}
                    {gate.status === "awaiting_review"
                      && gate.record
                      && selectedSres.activation.capabilities.canReview && (
                      <div className={styles.actions}>
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void save("PATCH", {
                            action: "review_sres_activation",
                            recordId: gate.record?.recordId,
                            decision: "approved",
                            reviewNote: reviewComment,
                          }, `sres-review:${gate.evidenceKind}`)}
                        >
                          Approve exact evidence
                        </button>
                        <button
                          type="button"
                          data-variant="danger"
                          disabled={Boolean(busy)}
                          onClick={() => void save("PATCH", {
                            action: "review_sres_activation",
                            recordId: gate.record?.recordId,
                            decision: "rejected",
                            reviewNote: reviewComment,
                          }, `sres-reject:${gate.evidenceKind}`)}
                        >
                          Reject evidence
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            {!selectedSres.activation.snapshot
              && selectedSres.activation.capabilities.canFreeze && (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void save("POST", {
                  action: "freeze_sres_activation",
                  clientRequestId: newClientRequestId(
                    `sres-snapshot:${selectedSres.candidate.complianceCaseId}`,
                  ),
                  activityTemplateId: selectedSres.candidate.activityTemplateId,
                  caseId: selectedSres.candidate.complianceCaseId,
                }, "sres-freeze")}
              >
                Freeze all eight approved gates
              </button>
            )}
          </section>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.cardHeader}>
          <div>
            <h3>Prepared and submitted outputs</h3>
            <p>
              “Submitted” is an internal retained submission record. Only an
              actual retained provider response can become provider accepted.
            </p>
          </div>
        </div>
        <label>
          Independent review note
          <input
            value={reviewComment}
            onChange={(event) => setReviewComment(event.target.value)}
          />
        </label>
        <div className={styles.split}>
          <label>
            Provider name
            <input
              value={providerName}
              onChange={(event) => setProviderName(event.target.value)}
            />
          </label>
          <label>
            Provider reference
            <input
              value={providerReference}
              onChange={(event) => setProviderReference(event.target.value)}
            />
          </label>
          <label>
            Provider outcome
            <select
              value={providerStatus}
              onChange={(event) => setProviderStatus(event.target.value)}
            >
              <option value="provider_accepted">Provider accepted</option>
              <option value="rejected">Rejected</option>
              <option value="reconciliation_required">
                Reconciliation required
              </option>
            </select>
          </label>
        </div>
        <label>
          Retained provider response
          <textarea
            value={providerResponse}
            onChange={(event) => setProviderResponse(event.target.value)}
            placeholder="Paste the exact provider response or receipt text."
          />
        </label>
        <div className={styles.cards}>
          {actions.map((item) => (
            <article className={styles.card} key={item.id}>
              <div className={styles.cardHeader}>
                <div>
                  <h3>
                    {item.outputCode} ·{" "}
                    {item.actionKind === "certificate_submission"
                      ? "certificate"
                      : "non-certificate output"}
                  </h3>
                  <p>
                    {item.jobReference} · {item.customerLabel} · {item.activityTitle}
                    {" · "}prepared{" "}
                    {new Date(item.preparedAt).toLocaleString("en-AU")}
                  </p>
                </div>
                <span className={styles.badge}>
                  {item.status.replaceAll("_", " ")}
                </span>
              </div>
              <div className={styles.hash}>{item.packetSha256}</div>
              {(receiptsByPacket.get(item.id) || []).map((receipt) => (
                <div className={styles.receipt} key={receipt.id}>
                  <div>
                    <strong>
                      {receipt.providerStatus.replaceAll("_", " ")}
                    </strong>
                    <span>
                      {receipt.providerName} · {receipt.providerReference || "No provider reference"}
                    </span>
                    <code>{receipt.responseSha256}</code>
                  </div>
                  <button
                    type="button"
                    data-variant="secondary"
                    disabled={Boolean(busy)}
                    onClick={() => void downloadReceipt(receipt)}
                  >
                    Download exact provider response
                  </button>
                </div>
              ))}
              <div className={styles.actions}>
                <button
                  type="button"
                  data-variant="secondary"
                  disabled={Boolean(busy)}
                  onClick={() => void downloadPacket(item)}
                >
                  Download exact packet
                </button>
                {!item.review && item.capabilities.canReview && (
                  <>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void save("PATCH", {
                        action: "review",
                        packetId: item.id,
                        expectedPacketSha256: item.packetSha256,
                        decision: "approved",
                        comment: reviewComment,
                      }, `review:${item.id}`)}
                    >
                      Approve packet
                    </button>
                    <button
                      type="button"
                      data-variant="danger"
                      disabled={Boolean(busy)}
                      onClick={() => void save("PATCH", {
                        action: "review",
                        packetId: item.id,
                        expectedPacketSha256: item.packetSha256,
                        decision: "rejected",
                        comment: reviewComment,
                      }, `review:${item.id}`)}
                    >
                      Reject
                    </button>
                  </>
                )}
                {item.status === "prepared"
                  && item.review?.decision === "approved"
                  && item.capabilities.canSubmit && (
                  <button
                    type="button"
                    disabled={Boolean(busy) || !providerName || !providerReference}
                    onClick={() => void save("POST", {
                      action: "record_manual_submission",
                      packetId: item.id,
                      expectedPacketSha256: item.packetSha256,
                      providerName,
                      providerReference,
                      submittedAt: now(),
                      submissionMethod: "manual_provider_portal",
                    }, `submit:${item.id}`)}
                  >
                    Record actual submission
                  </button>
                )}
                {(item.status === "submitted"
                  || item.status === "reconciliation_required")
                  && item.capabilities.canRecordOutcome && (
                  <button
                    type="button"
                    disabled={Boolean(busy) || !providerName
                      || !providerReference || !providerResponse}
                    onClick={() => void save("PATCH", {
                      action: "record_provider_outcome",
                      packetId: item.id,
                      expectedPacketSha256: item.packetSha256,
                      providerStatus,
                      providerName,
                      providerReference,
                      responseCode: "manual-retained-response",
                      responseText: providerResponse,
                      occurredAt: now(),
                    }, `outcome:${item.id}`)}
                  >
                    Record provider outcome
                  </button>
                )}
              </div>
            </article>
          ))}
          {!actions.length && (
            <p className={styles.empty}>
              No governed output packets have been prepared.
            </p>
          )}
        </div>
      </section>
    </section>
  );
}
