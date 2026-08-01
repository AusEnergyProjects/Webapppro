"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./CreditexEvidencePolicyGovernance.module.css";

type ApiCaller = (
  path: string,
  init?: RequestInit,
) => Promise<Record<string, unknown>>;

type ActivityOption = {
  id: string;
  programId: string;
  programCode: string;
  programName: string;
  activityKey: string;
  title: string;
  registryActivityCode: string;
  productCategory: string;
  scenarioCode: string;
  scenario: string;
  publishState: "draft" | "published" | "withdrawn";
};

type ProgramOption = {
  id: string;
  programCode: string;
  name: string;
  publishState: "draft" | "published" | "withdrawn";
};

type ReadinessBlocker = {
  code: string;
  message: string;
};

type PublicationRequest = {
  id: string;
  targetType: "program" | "activity" | "evidence_policy";
  targetId: string;
  targetLabel: string;
  action: string;
  sealedSnapshotSha256: string;
  status: "pending" | "approved" | "rejected" | "superseded";
  requestReason: string;
  requestedByUid: string;
  requestedByName: string;
  requestedAt: string;
  reviewedByUid: string;
  reviewedByName: string;
  reviewedAt: string;
  reviewNote: string;
  updatedAt: string;
  canReview?: boolean;
  blockReason?: string;
};

type ListPagination = {
  page: number;
  pageSize: number;
  total: number;
  pending?: number;
  hasNext: boolean;
};

type GovernanceLoadState = "loading" | "loaded" | "blocked";

type EvidenceRequirement = {
  id: string;
  policyVersionId: string;
  requirementCode: string;
  title: string;
  description: string;
  evidenceType: string;
  captureTiming: string;
  minimumCount: number;
  maximumCount: number;
  originalRequired: boolean;
  metadataRequired: boolean;
  gpsRequired: boolean;
  dateStampRequired: boolean;
  installerSignatureRequired: boolean;
  customerSignatureRequired: boolean;
  allowedContentTypes: string[];
  conditionSnapshot: Record<string, unknown>;
  fieldSchema: Record<string, unknown>;
  sourceCitation: string;
  sortOrder: number;
};

type EvidencePolicy = {
  id: string;
  activityVersionId: string;
  programId: string;
  programCode: string;
  programName: string;
  activityKey: string;
  activityTitle: string;
  version: number;
  title: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  officialSourceVersion: string;
  officialSourceSha256: string;
  officialSourceCheckedAt: string;
  requirementsComplete: boolean;
  publishState: "draft" | "published" | "withdrawn";
  pendingPublicationRequestId: string;
  publishedAt: string;
  withdrawnAt: string;
  requirements: EvidenceRequirement[];
  readiness: {
    ready: boolean;
    blockers: ReadinessBlocker[];
    requirementCount: number;
    currentSnapshotSha256: string;
  };
  pendingPublicationRequest: PublicationRequest | null;
};

type Props = {
  api: ApiCaller;
  activities: ActivityOption[];
  programs: ProgramOption[];
  refreshToken: number;
  onChanged: () => Promise<void> | void;
  canRequestPublication: boolean;
  selectedProgramId: string;
  selectedActivityVersionId: string;
};

const EVIDENCE_TYPES = [
  "photo",
  "document",
] as const;

const CAPTURE_TIMINGS = [
  "pre_install",
  "during_install",
  "post_install",
  "any",
  "periodic",
] as const;

const CONTENT_TYPES = [
  { value: "image/jpeg", label: "JPEG photo" },
  { value: "image/png", label: "PNG image" },
  { value: "image/webp", label: "WebP image" },
  { value: "application/pdf", label: "PDF document" },
] as const;

function readable(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value: string) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString("en-AU", {
      dateStyle: "medium",
      timeStyle: "short",
    });
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The governed rule request could not be completed.";
}

function emptyPolicyForm() {
  return {
    policyId: "",
    activityVersionId: "",
    version: "1",
    title: "",
    officialSourceUrl: "",
    officialSourceTitle: "",
    officialSourceVersion: "",
    officialSourceSha256: "",
    officialSourceCheckedAt: "",
  };
}

function emptyRequirementForm() {
  return {
    requirementId: "",
    policyId: "",
    requirementCode: "",
    title: "",
    description: "",
    evidenceType: "photo",
    captureTiming: "any",
    minimumCount: "1",
    maximumCount: "1",
    originalRequired: true,
    metadataRequired: false,
    gpsRequired: false,
    dateStampRequired: true,
    allowedContentTypes: ["image/jpeg", "image/png", "image/webp"],
    sourceCitation: "",
    sortOrder: "0",
  };
}

export function CreditexEvidencePolicyGovernance({
  api,
  activities,
  programs,
  refreshToken,
  onChanged,
  canRequestPublication,
  selectedProgramId,
  selectedActivityVersionId,
}: Props) {
  const [policies, setPolicies] = useState<EvidencePolicy[]>([]);
  const [publicationRequests, setPublicationRequests] = useState<
    PublicationRequest[]
  >([]);
  const [policyForm, setPolicyForm] = useState(emptyPolicyForm);
  const [requirementForm, setRequirementForm] = useState(
    emptyRequirementForm,
  );
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<
    "info" | "success" | "error"
  >("info");
  const [loadState, setLoadState] =
    useState<GovernanceLoadState>("loading");
  const [policyPage, setPolicyPage] = useState(1);
  const [requestPage, setRequestPage] = useState(1);
  const [policyPagination, setPolicyPagination] = useState<ListPagination>({
    page: 1,
    pageSize: 25,
    total: 0,
    hasNext: false,
  });
  const [requestPagination, setRequestPagination] = useState<ListPagination>({
    page: 1,
    pageSize: 25,
    total: 0,
    pending: 0,
    hasNext: false,
  });
  const loadRequestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setLoadState("loading");
    const query = new URLSearchParams({
      policyPage: String(policyPage),
      requestPage: String(requestPage),
      pageSize: "25",
    });
    if (selectedProgramId) query.set("programId", selectedProgramId);
    if (selectedActivityVersionId) {
      query.set("activityVersionId", selectedActivityVersionId);
    }
    try {
      const result = await api(
        `/api/creditex/evidence-policies?${query.toString()}`,
      );
      if (loadRequestRef.current !== requestId) return;
      setPolicies((result.policies || []) as EvidencePolicy[]);
      setPublicationRequests(
        (result.publicationRequests || []) as PublicationRequest[],
      );
      const pagination = (result.pagination || {}) as {
        policies?: ListPagination;
        publicationRequests?: ListPagination;
      };
      setPolicyPagination(pagination.policies || {
        page: policyPage,
        pageSize: 25,
        total: 0,
        hasNext: false,
      });
      setRequestPagination(pagination.publicationRequests || {
        page: requestPage,
        pageSize: 25,
        total: 0,
        pending: 0,
        hasNext: false,
      });
      setLoadState("loaded");
    } catch (error) {
      if (loadRequestRef.current !== requestId) return;
      setLoadState("blocked");
      throw error;
    }
  }, [
    api,
    policyPage,
    requestPage,
    selectedActivityVersionId,
    selectedProgramId,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error) => {
        setNotice(errorMessage(error));
        setNoticeKind("error");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshToken]);

  const draftPolicies = useMemo(
    () => policies.filter((policy) => policy.publishState === "draft"),
    [policies],
  );
  const pendingRequests = useMemo(
    () => publicationRequests.filter((request) => request.status === "pending"),
    [publicationRequests],
  );
  const terminalRequests = useMemo(
    () =>
      publicationRequests.filter((request) => request.status !== "pending"),
    [publicationRequests],
  );

  async function post(
    path: string,
    body: Record<string, unknown>,
    success: string,
  ) {
    if (loadState !== "loaded") {
      const message =
        "Governed records are not current. Retry the protected workspace before changing them.";
      setNotice(message);
      setNoticeKind("error");
      throw new Error(message);
    }
    setBusy(String(body.action || "governance"));
    setNotice("Saving the governed rule change...");
    setNoticeKind("info");
    try {
      await api(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await Promise.all([load(), Promise.resolve(onChanged())]);
      setNotice(success);
      setNoticeKind("success");
    } catch (error) {
      setNotice(errorMessage(error));
      setNoticeKind("error");
      throw error;
    } finally {
      setBusy("");
    }
  }

  async function retryLoad() {
    setNotice("Retrying the governed records...");
    setNoticeKind("info");
    try {
      await load();
      setNotice("Governed records refreshed for the current scope.");
      setNoticeKind("success");
    } catch (error) {
      setNotice(errorMessage(error));
      setNoticeKind("error");
    }
  }

  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const editing = Boolean(policyForm.policyId);
    try {
      await post(
        "/api/creditex/evidence-policies",
        {
          action: editing ? "update_policy" : "create_policy",
          ...(editing ? { policyId: policyForm.policyId } : {}),
          activityVersionId: policyForm.activityVersionId,
          version: Number(policyForm.version),
          title: policyForm.title,
          officialSourceUrl: policyForm.officialSourceUrl,
          officialSourceTitle: policyForm.officialSourceTitle,
          officialSourceVersion: policyForm.officialSourceVersion,
          officialSourceSha256: policyForm.officialSourceSha256,
          officialSourceCheckedAt: policyForm.officialSourceCheckedAt,
        },
        editing
          ? "Draft evidence policy updated. Any earlier review request is no longer valid."
          : "Draft evidence policy created. Add every governed requirement before requesting publication.",
      );
      setPolicyForm(emptyPolicyForm());
    } catch {
      // The shared notice already contains the bounded server response.
    }
  }

  async function saveRequirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const editing = Boolean(requirementForm.requirementId);
    try {
      await post(
        "/api/creditex/evidence-policies",
        {
          action: "save_requirement",
          ...(editing
            ? { requirementId: requirementForm.requirementId }
            : {}),
          policyId: requirementForm.policyId,
          requirementCode: requirementForm.requirementCode,
          title: requirementForm.title,
          description: requirementForm.description,
          evidenceType: requirementForm.evidenceType,
          captureTiming: requirementForm.captureTiming,
          minimumCount: Number(requirementForm.minimumCount),
          maximumCount: Number(requirementForm.maximumCount),
          originalRequired: requirementForm.originalRequired,
          metadataRequired: requirementForm.metadataRequired,
          gpsRequired: requirementForm.gpsRequired,
          dateStampRequired: requirementForm.dateStampRequired,
          installerSignatureRequired: false,
          customerSignatureRequired: false,
          allowedContentTypes: requirementForm.allowedContentTypes,
          conditionSnapshot: {},
          fieldSchema: {},
          sourceCitation: requirementForm.sourceCitation,
          sortOrder: Number(requirementForm.sortOrder),
        },
        editing
          ? "Evidence requirement updated and the draft policy resealed."
          : "Evidence requirement added to the draft policy.",
      );
      setRequirementForm(emptyRequirementForm());
    } catch {
      // The shared notice already contains the bounded server response.
    }
  }

  function editPolicy(policy: EvidencePolicy) {
    setPolicyForm({
      policyId: policy.id,
      activityVersionId: policy.activityVersionId,
      version: String(policy.version),
      title: policy.title,
      officialSourceUrl: policy.officialSourceUrl,
      officialSourceTitle: policy.officialSourceTitle,
      officialSourceVersion: policy.officialSourceVersion,
      officialSourceSha256: policy.officialSourceSha256,
      officialSourceCheckedAt: policy.officialSourceCheckedAt.slice(0, 10),
    });
    document
      .getElementById("creditex-policy-editor")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function editRequirement(
    policy: EvidencePolicy,
    requirement: EvidenceRequirement,
  ) {
    setRequirementForm({
      requirementId: requirement.id,
      policyId: policy.id,
      requirementCode: requirement.requirementCode,
      title: requirement.title,
      description: requirement.description,
      evidenceType: requirement.evidenceType,
      captureTiming: requirement.captureTiming,
      minimumCount: String(requirement.minimumCount),
      maximumCount: String(requirement.maximumCount),
      originalRequired: requirement.originalRequired,
      metadataRequired: requirement.metadataRequired,
      gpsRequired: requirement.gpsRequired,
      dateStampRequired: requirement.dateStampRequired,
      allowedContentTypes: requirement.allowedContentTypes,
      sourceCitation: requirement.sourceCitation,
      sortOrder: String(requirement.sortOrder),
    });
    document
      .getElementById("creditex-requirement-editor")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function removeRequirement(requirement: EvidenceRequirement) {
    if (!window.confirm(
      `Delete draft requirement ${requirement.requirementCode}? The immutable audit retains the deletion event.`,
    )) return;
    try {
      await post(
        "/api/creditex/evidence-policies",
        {
          action: "delete_requirement",
          requirementId: requirement.id,
        },
        "Draft evidence requirement deleted.",
      );
    } catch {
      // The shared notice already contains the bounded server response.
    }
  }

  async function moveRequirement(
    policy: EvidencePolicy,
    requirementId: string,
    direction: -1 | 1,
  ) {
    const ordered = [...policy.requirements]
      .sort((left, right) =>
        left.sortOrder - right.sortOrder
        || left.requirementCode.localeCompare(right.requirementCode)
      );
    const index = ordered.findIndex((item) => item.id === requirementId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    [ordered[index], ordered[nextIndex]] = [
      ordered[nextIndex],
      ordered[index],
    ];
    try {
      await post(
        "/api/creditex/evidence-policies",
        {
          action: "reorder_requirements",
          policyId: policy.id,
          requirementIds: ordered.map((item) => item.id),
        },
        "Evidence requirements reordered. The draft policy has a new sealed snapshot.",
      );
    } catch {
      // The shared notice already contains the bounded server response.
    }
  }

  async function deletePolicy(policy: EvidencePolicy) {
    if (!window.confirm(
      `Delete draft policy ${policy.title}? Its source identity remains in the immutable audit.`,
    )) return;
    try {
      await post(
        "/api/creditex/evidence-policies",
        { action: "delete_draft_policy", policyId: policy.id },
        "Draft evidence policy deleted.",
      );
    } catch {
      // The shared notice already contains the bounded server response.
    }
  }

  async function requestPolicyPublication(policy: EvidencePolicy) {
    const requestReason = window.prompt(
      "State why this exact policy and evidence matrix is ready for independent publication review.",
    )?.trim();
    if (!requestReason) return;
    try {
      await post(
        "/api/creditex/evidence-policies",
        {
          action: "request_policy_publication",
          policyId: policy.id,
          requestReason,
        },
        "The sealed policy snapshot is waiting for a different named administrator to review it.",
      );
    } catch {
      // The shared notice already contains the bounded server response.
    }
  }

  async function withdrawPolicy(policy: EvidencePolicy) {
    const reason = window.prompt(
      "Record the emergency withdrawal reason. Existing case snapshots remain available for correction and audit.",
    )?.trim();
    if (!reason) return;
    if (!window.confirm(
      "Withdraw this policy immediately? New jobs will stop using it and it cannot return to published state.",
    )) return;
    try {
      await post(
        "/api/creditex/evidence-policies",
        { action: "withdraw_policy", policyId: policy.id, reason },
        "The policy was withdrawn from new work. Existing case snapshots were retained.",
      );
    } catch {
      // The shared notice already contains the bounded server response.
    }
  }

  function targetLabel(request: PublicationRequest) {
    if (request.targetLabel) return request.targetLabel;
    if (request.targetType === "program") {
      const program = programs.find((item) => item.id === request.targetId);
      return program
        ? `${program.programCode} | ${program.name}`
        : request.targetId;
    }
    if (request.targetType === "activity") {
      const activity = activities.find((item) => item.id === request.targetId);
      return activity
        ? `${activity.programCode} | ${
          activity.registryActivityCode || activity.activityKey
        } | ${activity.title}`
        : request.targetId;
    }
    const policy = policies.find((item) => item.id === request.targetId);
    return policy
      ? `${policy.programCode} | ${policy.activityKey} | ${policy.title}`
      : request.targetId;
  }

  async function reviewPublication(
    request: PublicationRequest,
    decision: "approve" | "reject",
  ) {
    const reviewNote = window.prompt(
      decision === "approve"
        ? "Record the independent checks completed against the sealed source and evidence matrix."
        : "Record why this sealed rule snapshot is rejected.",
    )?.trim();
    if (!reviewNote) return;
    const targetAction = request.targetType === "evidence_policy"
      ? `${decision}_policy_publication`
      : `${decision}_${request.targetType}_publication`;
    const path = request.targetType === "evidence_policy"
      ? "/api/creditex/evidence-policies"
      : "/api/creditex/activities";
    try {
      await post(
        path,
        { action: targetAction, requestId: request.id, reviewNote },
        decision === "approve"
          ? "The independently reviewed sealed snapshot is now published."
          : "The sealed snapshot was rejected and remains unavailable to installers.",
      );
    } catch {
      // The shared notice already contains the bounded server response.
    }
  }

  return (
    <div
      className={styles.workspace}
      aria-busy={loadState === "loading"}
    >
      <section className={styles.intro}>
        <div>
          <span>GOVERNMENT SOURCE CONTROL</span>
          <h3>Evidence requirement transcription</h3>
          <p>
            Transcribe each effective government or regulator requirement into
            the exact evidence the installer must collect. Creditex verifies
            the transcription for its operating workflow. A different named
            administrator must approve the sealed version.
          </p>
        </div>
        <dl>
          {loadState === "loaded" ? (
            <>
              <div>
                <dt>Policies in scope</dt>
                <dd>{policyPagination.total}</dd>
              </div>
              <div>
                <dt>Waiting for review</dt>
                <dd>{requestPagination.pending || 0}</dd>
              </div>
              <div>
                <dt>Decision records</dt>
                <dd>
                  {Math.max(
                    requestPagination.total
                      - (requestPagination.pending || 0),
                    0,
                  )}
                </dd>
              </div>
            </>
          ) : (
            <div className={styles.loadMetric}>
              <dt>Workspace state</dt>
              <dd>
                {loadState === "loading" ? "Loading" : "Unavailable"}
              </dd>
            </div>
          )}
        </dl>
      </section>

      {notice && (
        <p
          className={styles.notice}
          data-kind={noticeKind}
          role={noticeKind === "error" ? "alert" : "status"}
        >
          {notice}
        </p>
      )}

      {loadState !== "loaded" && (
        <section
          className={styles.loadState}
          role={loadState === "blocked" ? "alert" : "status"}
        >
          <h4>
            {loadState === "loading"
              ? "Loading governed records"
              : "Governed records unavailable"}
          </h4>
          <p>
            {loadState === "loading"
              ? "Policies, publication requests and immutable decisions are being verified for the current program scope."
              : "No empty-state or policy count is shown because the protected list could not be verified. Authoring and publication controls remain locked."}
          </p>
          {loadState === "blocked" && (
            <button type="button" onClick={() => void retryLoad()}>
              Retry governed records
            </button>
          )}
        </section>
      )}

      {loadState === "loaded" && (
        <>
          <div className={styles.editorGrid}>
        <section className={styles.editor} id="creditex-policy-editor">
          <header>
            <h4>
              {policyForm.policyId
                ? "Edit draft evidence policy"
                : "Create draft evidence policy"}
            </h4>
            <p>
              The source hash identifies the exact government or regulator
              instrument used for this version. Creditex approval confirms the
              transcription and operational use, not authorship of the rule.
            </p>
          </header>
          <form className={styles.formGrid} onSubmit={savePolicy}>
            <label className={styles.wide}>
              Activity version
              <select
                required
                value={policyForm.activityVersionId}
                disabled={Boolean(policyForm.policyId)}
                onChange={(event) =>
                  setPolicyForm((current) => ({
                    ...current,
                    activityVersionId: event.target.value,
                  }))}
              >
                <option value="">Choose an activity version</option>
                {activities
                  .filter((activity) =>
                    activity.publishState !== "withdrawn"
                  )
                  .map((activity) => (
                    <option key={activity.id} value={activity.id}>
                      {activity.programCode} |{" "}
                      {activity.registryActivityCode || activity.activityKey}
                      {" "}| {activity.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Policy version
              <input
                type="number"
                min={1}
                step={1}
                required
                value={policyForm.version}
                disabled={Boolean(policyForm.policyId)}
                onChange={(event) =>
                  setPolicyForm((current) => ({
                    ...current,
                    version: event.target.value,
                  }))}
              />
            </label>
            <label>
              Source checked date
              <input
                type="date"
                required
                value={policyForm.officialSourceCheckedAt}
                onChange={(event) =>
                  setPolicyForm((current) => ({
                    ...current,
                    officialSourceCheckedAt: event.target.value,
                  }))}
              />
            </label>
            <label className={styles.wide}>
              Policy title
              <input
                required
                maxLength={240}
                value={policyForm.title}
                onChange={(event) =>
                  setPolicyForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))}
              />
            </label>
            <label className={styles.wide}>
              Official or approved source URL
              <input
                type="url"
                required
                value={policyForm.officialSourceUrl}
                onChange={(event) =>
                  setPolicyForm((current) => ({
                    ...current,
                    officialSourceUrl: event.target.value,
                  }))}
              />
            </label>
            <label className={styles.wide}>
              Source title
              <input
                required
                maxLength={240}
                value={policyForm.officialSourceTitle}
                onChange={(event) =>
                  setPolicyForm((current) => ({
                    ...current,
                    officialSourceTitle: event.target.value,
                  }))}
              />
            </label>
            <label>
              Source version
              <input
                required
                maxLength={120}
                value={policyForm.officialSourceVersion}
                onChange={(event) =>
                  setPolicyForm((current) => ({
                    ...current,
                    officialSourceVersion: event.target.value,
                  }))}
              />
            </label>
            <label>
              Source SHA-256
              <input
                required
                minLength={64}
                maxLength={64}
                pattern="[0-9a-fA-F]{64}"
                value={policyForm.officialSourceSha256}
                onChange={(event) =>
                  setPolicyForm((current) => ({
                    ...current,
                    officialSourceSha256: event.target.value,
                  }))}
              />
            </label>
            <div className={`${styles.actions} ${styles.wide}`}>
              <button type="submit" disabled={Boolean(busy)}>
                {policyForm.policyId ? "Save policy changes" : "Save draft policy"}
              </button>
              {policyForm.policyId && (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => setPolicyForm(emptyPolicyForm())}
                >
                  Cancel edit
                </button>
              )}
            </div>
          </form>
        </section>

        <section className={styles.editor} id="creditex-requirement-editor">
          <header>
            <h4>
              {requirementForm.requirementId
                ? "Edit evidence requirement"
                : "Add evidence requirement"}
            </h4>
            <p>
              Only capture controls enforced by AEA Field are available in this
              release. Conditional fields and in-app signatures remain blocked.
            </p>
          </header>
          <form className={styles.formGrid} onSubmit={saveRequirement}>
            <label className={styles.wide}>
              Draft policy
              <select
                required
                value={requirementForm.policyId}
                disabled={Boolean(requirementForm.requirementId)}
                onChange={(event) =>
                  setRequirementForm((current) => ({
                    ...current,
                    policyId: event.target.value,
                  }))}
              >
                <option value="">Choose a draft policy</option>
                {draftPolicies.map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.programCode} | {policy.activityKey} | {policy.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Requirement code
              <input
                required
                maxLength={120}
                value={requirementForm.requirementCode}
                onChange={(event) =>
                  setRequirementForm((current) => ({
                    ...current,
                    requirementCode: event.target.value,
                  }))}
              />
            </label>
            <label>
              Display order
              <input
                type="number"
                min={0}
                step={1}
                required
                value={requirementForm.sortOrder}
                onChange={(event) =>
                  setRequirementForm((current) => ({
                    ...current,
                    sortOrder: event.target.value,
                  }))}
              />
            </label>
            <label className={styles.wide}>
              Installer-facing title
              <input
                required
                maxLength={220}
                value={requirementForm.title}
                onChange={(event) =>
                  setRequirementForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))}
              />
            </label>
            <label className={styles.wide}>
              Capture guidance
              <textarea
                required
                maxLength={2000}
                value={requirementForm.description}
                onChange={(event) =>
                  setRequirementForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))}
              />
            </label>
            <label>
              Evidence type
              <select
                value={requirementForm.evidenceType}
                onChange={(event) =>
                  setRequirementForm((current) => ({
                    ...current,
                    evidenceType: event.target.value,
                    allowedContentTypes:
                      event.target.value === "photo"
                        ? ["image/jpeg", "image/png", "image/webp"]
                        : current.allowedContentTypes,
                  }))}
              >
                {EVIDENCE_TYPES.map((type) => (
                  <option key={type} value={type}>{readable(type)}</option>
                ))}
              </select>
            </label>
            <label>
              Capture timing
              <select
                value={requirementForm.captureTiming}
                onChange={(event) =>
                  setRequirementForm((current) => ({
                    ...current,
                    captureTiming: event.target.value,
                  }))}
              >
                {CAPTURE_TIMINGS.map((timing) => (
                  <option key={timing} value={timing}>{readable(timing)}</option>
                ))}
              </select>
            </label>
            <label>
              Minimum files
              <input
                type="number"
                min={0}
                step={1}
                required
                value={requirementForm.minimumCount}
                onChange={(event) =>
                  setRequirementForm((current) => ({
                    ...current,
                    minimumCount: event.target.value,
                  }))}
              />
            </label>
            <label>
              Maximum files
              <input
                type="number"
                min={0}
                step={1}
                required
                value={requirementForm.maximumCount}
                onChange={(event) =>
                  setRequirementForm((current) => ({
                    ...current,
                    maximumCount: event.target.value,
                  }))}
              />
              <small>Use 0 only when the rule permits no upper limit.</small>
            </label>
            <fieldset className={styles.wide}>
              <legend>Allowed original file types</legend>
              <div className={styles.checkGrid}>
                {CONTENT_TYPES.map((type) => (
                  <label key={type.value}>
                    <input
                      type="checkbox"
                      checked={requirementForm.allowedContentTypes.includes(
                        type.value,
                      )}
                      onChange={(event) =>
                        setRequirementForm((current) => ({
                          ...current,
                          allowedContentTypes: event.target.checked
                            ? [...current.allowedContentTypes, type.value]
                            : current.allowedContentTypes.filter(
                              (value) => value !== type.value,
                            ),
                        }))}
                    />
                    {type.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className={styles.wide}>
              <legend>Capture controls</legend>
              <div className={styles.checkGrid}>
                <label>
                  <input
                    type="checkbox"
                    checked={requirementForm.originalRequired}
                    onChange={(event) =>
                      setRequirementForm((current) => ({
                        ...current,
                        originalRequired: event.target.checked,
                      }))}
                  />
                  Preserve unedited original
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={requirementForm.metadataRequired}
                    onChange={(event) =>
                      setRequirementForm((current) => ({
                        ...current,
                        metadataRequired: event.target.checked,
                      }))}
                  />
                  Camera metadata required
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={requirementForm.gpsRequired}
                    onChange={(event) =>
                      setRequirementForm((current) => ({
                        ...current,
                        gpsRequired: event.target.checked,
                      }))}
                  />
                  Current GPS required
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={requirementForm.dateStampRequired}
                    onChange={(event) =>
                      setRequirementForm((current) => ({
                        ...current,
                        dateStampRequired: event.target.checked,
                      }))}
                  />
                  Capture time and timezone required
                </label>
              </div>
            </fieldset>
            <label className={styles.wide}>
              Exact source clause or citation
              <textarea
                required
                maxLength={1000}
                value={requirementForm.sourceCitation}
                onChange={(event) =>
                  setRequirementForm((current) => ({
                    ...current,
                    sourceCitation: event.target.value,
                  }))}
              />
            </label>
            <div className={`${styles.actions} ${styles.wide}`}>
              <button type="submit" disabled={Boolean(busy)}>
                {requirementForm.requirementId
                  ? "Save requirement changes"
                  : "Add requirement"}
              </button>
              {requirementForm.requirementId && (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => setRequirementForm(emptyRequirementForm())}
                >
                  Cancel edit
                </button>
              )}
            </div>
          </form>
        </section>
      </div>

      <section className={styles.reviewSection}>
        <header>
          <h4>Independent publication review</h4>
          <p>
            Approval is bound to the displayed SHA-256. The requester cannot
            review their own snapshot, and any draft change invalidates the
            pending request. {requestPagination.pending || 0} sealed snapshot
            {(requestPagination.pending || 0) === 1 ? " is" : "s are"} waiting
            in this program scope.
          </p>
        </header>
        <div className={styles.reviewList}>
          {pendingRequests.map((request) => (
            <article key={request.id}>
              <div>
                <div className={styles.requestStatus}>
                  <span>{readable(request.targetType)}</span>
                  <strong data-state="pending">Waiting for review</strong>
                </div>
                <h5>{targetLabel(request)}</h5>
                <p>
                  Requested by {request.requestedByName || request.requestedByUid}
                  {" "}{dateTime(request.requestedAt)}
                </p>
                <p>{request.requestReason}</p>
                <code>{request.sealedSnapshotSha256}</code>
                {request.blockReason && <small>{request.blockReason}</small>}
              </div>
              <div className={styles.reviewActions}>
                <button
                  type="button"
                  disabled={Boolean(busy) || request.canReview === false}
                  onClick={() => void reviewPublication(request, "approve")}
                >
                  Approve sealed snapshot
                </button>
                <button
                  type="button"
                  className={styles.danger}
                  disabled={Boolean(busy) || request.canReview === false}
                  onClick={() => void reviewPublication(request, "reject")}
                >
                  Reject
                </button>
              </div>
            </article>
          ))}
          {!pendingRequests.length && (
            <p className={styles.empty}>No sealed snapshots are waiting for review.</p>
          )}
        </div>
      </section>

      <section className={styles.historySection}>
        <header>
          <h4>Immutable publication decision history</h4>
          <p>
            Approved, rejected and superseded requests retain the sealed hash,
            requester, reviewer, timestamps and decision note for audit.
          </p>
        </header>
        <div className={styles.historyList}>
          {terminalRequests.map((request) => (
            <article key={request.id}>
              <div className={styles.requestStatus}>
                <span>{readable(request.targetType)}</span>
                <strong data-state={request.status}>
                  {readable(request.status)}
                </strong>
              </div>
              <h5>{targetLabel(request)}</h5>
              <dl>
                <div>
                  <dt>Requested</dt>
                  <dd>
                    {request.requestedByName || request.requestedByUid}
                    {" | "}{dateTime(request.requestedAt)}
                  </dd>
                </div>
                <div>
                  <dt>
                    {request.status === "superseded"
                      ? "Superseded"
                      : "Reviewed"}
                  </dt>
                  <dd>
                    {request.reviewedByName
                      || request.reviewedByUid
                      || "Governed draft change"}
                    {" | "}
                    {dateTime(request.reviewedAt || request.updatedAt)}
                  </dd>
                </div>
              </dl>
              <p><strong>Request:</strong> {request.requestReason}</p>
              <p>
                <strong>Decision:</strong>{" "}
                {request.reviewNote
                  || "The sealed request was superseded by a later draft change."}
              </p>
              <code>{request.sealedSnapshotSha256}</code>
            </article>
          ))}
          {!terminalRequests.length && (
            <p className={styles.empty}>
              No terminal publication decisions are shown on this request page.
            </p>
          )}
        </div>
        <div className={styles.pagination}>
          <p>
            Request page {requestPagination.page} |{" "}
            {requestPagination.total
              ? `${
                (requestPagination.page - 1) * requestPagination.pageSize + 1
              } to ${
                Math.min(
                  requestPagination.page * requestPagination.pageSize,
                  requestPagination.total,
                )
              } of ${requestPagination.total}`
              : "No request records"}
          </p>
          <div>
            <button
              type="button"
              className={styles.secondary}
              disabled={Boolean(busy) || requestPage <= 1}
              onClick={() => setRequestPage((page) => Math.max(page - 1, 1))}
            >
              Previous requests
            </button>
            <button
              type="button"
              disabled={Boolean(busy) || !requestPagination.hasNext}
              onClick={() => setRequestPage((page) => page + 1)}
            >
              Next requests
            </button>
          </div>
        </div>
      </section>

      <section className={styles.policySection}>
        <header>
          <h4>Evidence policy versions</h4>
          <p>
            Draft requirements preview the same activity-driven contract sent
            to AEA Field. Published versions are immutable.
          </p>
        </header>
        <div className={styles.policyList}>
          {policies.map((policy) => {
            const ordered = [...policy.requirements].sort((left, right) =>
              left.sortOrder - right.sortOrder
              || left.requirementCode.localeCompare(right.requirementCode)
            );
            return (
              <article className={styles.policy} key={policy.id}>
                <div className={styles.policyHeader}>
                  <div>
                    <span data-state={policy.publishState}>
                      {readable(policy.publishState)}
                    </span>
                    <h5>
                      {policy.programCode} | {policy.activityKey} | {policy.title}
                    </h5>
                    <p>
                      Version {policy.version} | {policy.requirements.length}{" "}
                      requirement{policy.requirements.length === 1 ? "" : "s"} |
                      Source {policy.officialSourceVersion}
                    </p>
                    <a
                      href={policy.officialSourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open approved source
                    </a>
                  </div>
                  <div className={styles.policyActions}>
                    {policy.publishState === "draft" && (
                      <>
                        <button
                          type="button"
                          className={styles.secondary}
                          disabled={Boolean(busy)}
                          onClick={() => editPolicy(policy)}
                        >
                          Edit policy
                        </button>
                        <button
                          type="button"
                          disabled={
                            Boolean(busy)
                            || !policy.readiness.ready
                            || Boolean(policy.pendingPublicationRequestId)
                            || !canRequestPublication
                          }
                          onClick={() => void requestPolicyPublication(policy)}
                        >
                          {policy.pendingPublicationRequestId
                            ? "Waiting for review"
                            : "Request publication"}
                        </button>
                        <button
                          type="button"
                          className={styles.danger}
                          disabled={Boolean(busy)}
                          onClick={() => void deletePolicy(policy)}
                        >
                          Delete draft
                        </button>
                      </>
                    )}
                    {policy.publishState === "published" && (
                      <button
                        type="button"
                        className={styles.danger}
                        disabled={Boolean(busy) || !canRequestPublication}
                        onClick={() => void withdrawPolicy(policy)}
                      >
                        Emergency withdraw
                      </button>
                    )}
                  </div>
                </div>

                <div className={styles.readiness} data-ready={policy.readiness.ready}>
                  <strong>
                    {policy.readiness.ready
                      ? "Ready to seal for independent review"
                      : "Publication blocked"}
                  </strong>
                  {policy.readiness.currentSnapshotSha256 && (
                    <code>{policy.readiness.currentSnapshotSha256}</code>
                  )}
                  {policy.readiness.blockers.map((blocker) => (
                    <p key={`${policy.id}-${blocker.code}`}>
                      {blocker.message}
                    </p>
                  ))}
                </div>

                <div className={styles.requirementList}>
                  {ordered.map((requirement, index) => (
                    <article key={requirement.id}>
                      <div>
                        <span>
                          {requirement.requirementCode} |{" "}
                          {readable(requirement.captureTiming)}
                        </span>
                        <h6>{requirement.title}</h6>
                        <p>{requirement.description}</p>
                        <p>
                          {readable(requirement.evidenceType)} | Minimum{" "}
                          {requirement.minimumCount} | Maximum{" "}
                          {requirement.maximumCount || "unlimited"}
                        </p>
                        <div className={styles.requirementBadges}>
                          {requirement.originalRequired && <small>Original</small>}
                          {requirement.metadataRequired && <small>Metadata</small>}
                          {requirement.gpsRequired && <small>GPS</small>}
                          {requirement.dateStampRequired && <small>Capture time</small>}
                          {requirement.allowedContentTypes.map((type) => (
                            <small key={`${requirement.id}-${type}`}>{type}</small>
                          ))}
                        </div>
                      </div>
                      {policy.publishState === "draft" && (
                        <div className={styles.requirementActions}>
                          <button
                            type="button"
                            className={styles.secondary}
                            onClick={() => editRequirement(policy, requirement)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={styles.secondary}
                            disabled={index === 0 || Boolean(busy)}
                            onClick={() =>
                              void moveRequirement(policy, requirement.id, -1)}
                          >
                            Move up
                          </button>
                          <button
                            type="button"
                            className={styles.secondary}
                            disabled={index === ordered.length - 1 || Boolean(busy)}
                            onClick={() =>
                              void moveRequirement(policy, requirement.id, 1)}
                          >
                            Move down
                          </button>
                          <button
                            type="button"
                            className={styles.danger}
                            disabled={Boolean(busy)}
                            onClick={() => void removeRequirement(requirement)}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                  {!ordered.length && (
                    <p className={styles.empty}>
                      Add the first exact evidence requirement. Empty policies
                      cannot be submitted for review.
                    </p>
                  )}
                </div>
              </article>
            );
          })}
          {!policies.length && (
            <p className={styles.empty}>
              No evidence policies have been authored. Public discovery records
              are not converted into live compliance rules automatically.
            </p>
          )}
        </div>
        <div className={styles.pagination}>
          <p>
            Policy page {policyPagination.page} |{" "}
            {policyPagination.total
              ? `${
                (policyPagination.page - 1) * policyPagination.pageSize + 1
              } to ${
                Math.min(
                  policyPagination.page * policyPagination.pageSize,
                  policyPagination.total,
                )
              } of ${policyPagination.total}`
              : "No policy versions"}
          </p>
          <div>
            <button
              type="button"
              className={styles.secondary}
              disabled={Boolean(busy) || policyPage <= 1}
              onClick={() => setPolicyPage((page) => Math.max(page - 1, 1))}
            >
              Previous policies
            </button>
            <button
              type="button"
              disabled={Boolean(busy) || !policyPagination.hasNext}
              onClick={() => setPolicyPage((page) => page + 1)}
            >
              Next policies
            </button>
          </div>
        </div>
          </section>
        </>
      )}
    </div>
  );
}
