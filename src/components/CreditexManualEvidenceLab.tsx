"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  CREDITEX_MANUAL_EVIDENCE_FORM_CONTRACT,
  MANUAL_EVIDENCE_CAPTURE_TIMINGS,
  MANUAL_EVIDENCE_FIELD_ORIGINS,
  MANUAL_EVIDENCE_FIELD_TYPES,
  MANUAL_EVIDENCE_RESPONSE_OUTCOMES,
  emptyManualEvidenceResponse,
  manualEvidenceProgress,
  type ManualEvidenceField,
  type ManualEvidenceFormSchema,
  type ManualEvidenceResponse,
} from "@/lib/creditex-manual-evidence-lab";
import styles from "./CreditexManualEvidenceLab.module.css";

type Api = (
  path: string,
  init?: RequestInit,
) => Promise<Record<string, unknown>>;

type Programme = {
  templateId: string;
  programCode: string;
  name: string;
  jurisdiction: string;
  outcomeClass: string;
  administeringBody: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  catalogueState: string;
  operatingNote: string;
  activityCount: number;
};

type Activity = {
  templateId: string;
  programCode: string;
  activityKey: string;
  registryActivityCode: string;
  title: string;
  serviceCategory: string;
  specificationPart: string;
  productCategory: string;
  scenarioCode: string;
  scenario: string;
  catalogueState: string;
};

type ManualForm = {
  id: string;
  programCode: string;
  activityTemplateId: string;
  activitySnapshot: Record<string, unknown>;
  version: number;
  title: string;
  status: "draft" | "test_ready" | "archived";
  schema: ManualEvidenceFormSchema;
  schemaSha256: string;
  recordMode: "synthetic_test";
  revision: number;
  createdAt: string;
  lockedAt: string;
  archivedAt: string;
  updatedAt: string;
};

type ManualJob = {
  id: string;
  formVersionId: string;
  programCode: string;
  activityTemplateId: string;
  activitySnapshot: Record<string, unknown>;
  formSchema: ManualEvidenceFormSchema;
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
  status:
    | "draft"
    | "field_testing"
    | "ready_for_audit"
    | "changes_required"
    | "passed"
    | "archived";
  responses: ManualEvidenceResponse[];
  responseSha256: string;
  requiredCount: number;
  completedRequiredCount: number;
  issueCount: number;
  reviewNote: string;
  recordMode: "synthetic_test";
  revision: number;
  passedAt: string;
  archivedAt: string;
  updatedAt: string;
};

type ManualLabSnapshot = {
  contract: string;
  recordMode: "synthetic_test";
  externalActionsEnabled: false;
  programmes: Programme[];
  activities: Activity[];
  forms: ManualForm[];
  jobs: ManualJob[];
  installers: Array<{ id: string; label: string }>;
  technicians: Array<{
    id: string;
    installerId: string;
    label: string;
  }>;
  pagination: {
    pageSize: number;
    forms: { page: number; total: number; totalPages: number };
    jobs: { page: number; total: number; totalPages: number };
  };
  metrics: {
    activeForms: number;
    testReadyForms: number;
    activeJobs: number;
    awaitingReview: number;
    passedJobs: number;
    cataloguedPrograms: number;
    cataloguedActivities: number;
  };
};

type ManualJobEvent = {
  id: string;
  eventType: string;
  actorUid: string;
  summary: string;
  metadata: {
    previousStatus?: string;
    status?: string;
    reviewNote?: string;
    responseSha256?: string;
    completedRequiredCount?: number;
    requiredCount?: number;
    issueCount?: number;
  };
  createdAt: string;
};

type ManualPolicyMergeStatus = {
  inventory: {
    publishedPrograms: number;
    publishedActivities: number;
    publishedCompleteEvidencePolicies: number;
  };
  readiness: {
    status: "blocked" | "ready";
    code: string;
    message: string;
  };
  bindings: Array<{
    id: string;
    activityTemplateId: string;
    version: number;
    lifecycleState: "draft" | "approved" | "withdrawn";
    bindingSnapshotSha256: string;
    requestedByUid: string;
    requestedAt: string;
    approvedByUid: string;
    approvedAt: string;
    bindingSnapshot: {
      requirements: unknown[];
      evidencePolicy: { title: string };
    };
  }>;
};

type LabView = "forms" | "jobs" | "preview";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DOCUMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];
const AUSTRALIAN_STATES = [
  "ACT",
  "NSW",
  "NT",
  "QLD",
  "SA",
  "TAS",
  "VIC",
  "WA",
];

function readable(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function emptyField(): ManualEvidenceField {
  return {
    fieldCode: "",
    label: "",
    instructions: "",
    fieldType: "photo",
    captureTiming: "before_install",
    origin: "creditex_operational_test",
    required: true,
    minimumCount: 1,
    maximumCount: 1,
    originalRequired: true,
    metadataRequired: true,
    gpsRequired: true,
    options: [],
    allowedContentTypes: [...IMAGE_TYPES],
    source: null,
  };
}

function activityLabel(activity: Activity) {
  const code = activity.registryActivityCode || activity.activityKey;
  const scenario = activity.scenarioCode ? ` | ${activity.scenarioCode}` : "";
  return `${code}${scenario} | ${activity.title}`;
}

function formStatusLabel(status: ManualForm["status"]) {
  if (status === "test_ready") return "Test-ready snapshot";
  return readable(status);
}

function jobStatusLabel(status: ManualJob["status"]) {
  if (status === "passed") return "Synthetic complete";
  return readable(status);
}

function responseFor(
  fieldCode: string,
  responses: readonly ManualEvidenceResponse[],
) {
  return responses.find((response) => response.fieldCode === fieldCode)
    || emptyManualEvidenceResponse(fieldCode);
}

export function CreditexManualEvidenceLab({
  api,
  role,
}: {
  api: Api;
  role: "admin" | "case_manager" | "reviewer" | "auditor";
}) {
  const [lab, setLab] = useState<ManualLabSnapshot | null>(null);
  const [view, setView] = useState<LabView>("forms");
  const [programCode, setProgramCode] = useState("VEU");
  const [activityTemplateId, setActivityTemplateId] = useState("");
  const [selectedFormId, setSelectedFormId] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftFields, setDraftFields] = useState<ManualEvidenceField[]>([]);
  const [fieldEditor, setFieldEditor] = useState<ManualEvidenceField>(
    emptyField(),
  );
  const [editingFieldCode, setEditingFieldCode] = useState("");
  const [optionText, setOptionText] = useState("");
  const [jobInstallerId, setJobInstallerId] = useState("");
  const [jobTechnicianId, setJobTechnicianId] = useState("");
  const [jobCustomerLabel, setJobCustomerLabel] =
    useState("[TEST] Customer 001");
  const [jobState, setJobState] = useState("VIC");
  const [jobPostcode, setJobPostcode] = useState("3000");
  const [jobResponses, setJobResponses] =
    useState<ManualEvidenceResponse[]>([]);
  const [reviewNote, setReviewNote] = useState("");
  const [jobEvents, setJobEvents] = useState<ManualJobEvent[]>([]);
  const [policyMerge, setPolicyMerge] =
    useState<ManualPolicyMergeStatus | null>(null);
  const [policyMergeError, setPolicyMergeError] = useState("");
  const [formPage, setFormPage] = useState(1);
  const [jobPage, setJobPage] = useState(1);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const canWrite = role !== "auditor";
  const canReview = role === "admin" || role === "reviewer";

  const load = useCallback(async (
    pageOverride: { formPage?: number; jobPage?: number } = {},
  ) => {
    setBusy((current) => current || "load");
    setError("");
    try {
      const params = new URLSearchParams({
        programCode,
        formPage: String(pageOverride.formPage || formPage),
        jobPage: String(pageOverride.jobPage || jobPage),
        pageSize: "50",
      });
      if (activityTemplateId) {
        params.set("activityTemplateId", activityTemplateId);
      }
      const result = await api(
        `/api/creditex/manual-evidence-lab?${params.toString()}`,
      );
      setLab(result.lab as ManualLabSnapshot);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "The manual evidence lab could not be loaded.",
      );
    } finally {
      setBusy((current) => current === "load" ? "" : current);
    }
  }, [activityTemplateId, api, formPage, jobPage, programCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setPolicyMergeError("");
      const params = new URLSearchParams();
      if (activityTemplateId) {
        params.set("activityTemplateId", activityTemplateId);
      }
      void api(`/api/creditex/manual-policy-merge?${params.toString()}`)
        .then((result) => {
          if (!active) return;
          setPolicyMerge(result.merge as ManualPolicyMergeStatus);
        })
        .catch((mergeError) => {
          if (!active) return;
          setPolicyMerge(null);
          setPolicyMergeError(
            mergeError instanceof Error
              ? mergeError.message
              : "Governed evidence-policy status is unavailable.",
          );
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [activityTemplateId, api]);

  const loadEvents = useCallback(async (jobId: string) => {
    if (!jobId) {
      setJobEvents([]);
      return;
    }
    try {
      const result = await api(
        `/api/creditex/manual-evidence-lab?view=events&jobId=${
          encodeURIComponent(jobId)
        }`,
      );
      setJobEvents((result.events || []) as ManualJobEvent[]);
    } catch (eventError) {
      setJobEvents([]);
      setError(
        eventError instanceof Error
          ? eventError.message
          : "The manual job history could not be loaded.",
      );
    }
  }, [api]);

  const activities = useMemo(
    () => (lab?.activities || []).filter(
      (activity) => activity.programCode === programCode,
    ),
    [lab?.activities, programCode],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!activities.length) {
        setActivityTemplateId("");
        return;
      }
      if (
        !activityTemplateId
        || !activities.some(
          (activity) => activity.templateId === activityTemplateId,
        )
      ) {
        setActivityTemplateId(activities[0].templateId);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activities, activityTemplateId]);

  const selectedActivity = useMemo(
    () => (lab?.activities || []).find(
      (activity) => activity.templateId === activityTemplateId,
    ) || null,
    [activityTemplateId, lab?.activities],
  );
  const selectedProgramme = useMemo(
    () => (lab?.programmes || []).find(
      (programme) => programme.programCode === programCode,
    ) || null,
    [lab?.programmes, programCode],
  );
  const activityForms = useMemo(
    () => (lab?.forms || []).filter(
      (form) => form.activityTemplateId === activityTemplateId,
    ),
    [activityTemplateId, lab?.forms],
  );
  const activityJobs = useMemo(
    () => (lab?.jobs || []).filter(
      (job) => job.activityTemplateId === activityTemplateId,
    ),
    [activityTemplateId, lab?.jobs],
  );
  const selectedForm = useMemo(
    () => (lab?.forms || []).find((form) => form.id === selectedFormId)
      || activityForms[0]
      || null,
    [activityForms, lab?.forms, selectedFormId],
  );
  const selectedJob = useMemo(
    () => (lab?.jobs || []).find((job) => job.id === selectedJobId)
      || activityJobs[0]
      || null,
    [activityJobs, lab?.jobs, selectedJobId],
  );
  const testReadyForms = useMemo(
    () => activityForms.filter((form) => form.status === "test_ready"),
    [activityForms],
  );
  const effectiveTestReadyFormId = testReadyForms.some(
    (form) => form.id === selectedFormId,
  )
    ? selectedFormId
    : testReadyForms[0]?.id || "";
  const visibleTechnicians = useMemo(
    () => (lab?.technicians || []).filter(
      (technician) =>
        !jobInstallerId || technician.installerId === jobInstallerId,
    ),
    [jobInstallerId, lab?.technicians],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!selectedForm) {
        setSelectedFormId("");
        setDraftTitle("");
        setDraftFields([]);
        return;
      }
      setSelectedFormId(selectedForm.id);
      setDraftTitle(selectedForm.title);
      setDraftFields(selectedForm.schema.fields.map((field) => ({
        ...field,
        options: [...field.options],
        allowedContentTypes: [...field.allowedContentTypes],
        source: field.source ? { ...field.source } : null,
      })));
      setEditingFieldCode("");
      setFieldEditor(emptyField());
      setOptionText("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedForm]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!selectedJob) {
        setSelectedJobId("");
        setJobResponses([]);
        setReviewNote("");
        setJobEvents([]);
        return;
      }
      setSelectedJobId(selectedJob.id);
      setJobResponses(selectedJob.responses.map((response) => ({
        ...response,
        captures: response.captures.map((capture) => ({ ...capture })),
      })));
      setReviewNote(selectedJob.reviewNote);
      void loadEvents(selectedJob.id);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadEvents, selectedJob]);

  async function mutate(
    action: string,
    payload: Record<string, unknown>,
    successMessage: string,
  ) {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const result = await api("/api/creditex/manual-evidence-lab", {
        method: "POST",
        body: JSON.stringify({ action, ...payload }),
      });
      const record = result.result as {
        id?: string;
        revision?: number;
      } | undefined;
      const formMutation = action.includes("form")
        || action === "mark_test_ready";
      const nextFormPage = formMutation
        && action !== "update_form"
        && action !== "mark_test_ready"
        ? 1
        : formPage;
      const nextJobPage = !formMutation && action === "create_test_job"
        ? 1
        : jobPage;
      if (nextFormPage !== formPage) setFormPage(nextFormPage);
      if (nextJobPage !== jobPage) setJobPage(nextJobPage);
      await load({ formPage: nextFormPage, jobPage: nextJobPage });
      if (
        formMutation
      ) {
        if (record?.id) setSelectedFormId(record.id);
      } else if (record?.id) {
        setSelectedJobId(record.id);
        await loadEvents(record.id);
      }
      setNotice(successMessage);
      return record;
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "The manual evidence change could not be saved.",
      );
      return null;
    } finally {
      setBusy("");
    }
  }

  function setFieldType(fieldType: ManualEvidenceField["fieldType"]) {
    const fileField = fieldType === "photo" || fieldType === "document";
    setFieldEditor((current) => ({
      ...current,
      fieldType,
      metadataRequired: fieldType === "photo"
        ? current.metadataRequired
        : false,
      gpsRequired: fieldType === "photo" ? current.gpsRequired : false,
      originalRequired:
        fieldType === "photo" || fieldType === "document"
          ? current.originalRequired
          : false,
      allowedContentTypes:
        fieldType === "photo"
          ? [...IMAGE_TYPES]
          : fieldType === "document"
          ? [...DOCUMENT_TYPES]
          : [],
      options: fieldType === "select" ? current.options : [],
      minimumCount: fileField
        ? Math.max(current.required ? 1 : 0, current.minimumCount)
        : current.required ? 1 : 0,
      maximumCount: fileField ? current.maximumCount : 1,
    }));
  }

  function editField(field: ManualEvidenceField) {
    setEditingFieldCode(field.fieldCode);
    setFieldEditor({
      ...field,
      options: [...field.options],
      allowedContentTypes: [...field.allowedContentTypes],
      source: field.source ? { ...field.source } : null,
    });
    setOptionText(field.options.join("\n"));
  }

  function commitField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const options = fieldEditor.fieldType === "select"
      ? optionText
        .split(/\r?\n/)
        .map((option) => option.trim())
        .filter(Boolean)
      : [];
    const nextField = {
      ...fieldEditor,
      fieldCode: fieldEditor.fieldCode.trim().toLowerCase(),
      label: fieldEditor.label.trim(),
      instructions: fieldEditor.instructions.trim(),
      options,
    };
    const duplicate = draftFields.some(
      (field) =>
        field.fieldCode === nextField.fieldCode
        && field.fieldCode !== editingFieldCode,
    );
    if (duplicate) {
      setError("Every evidence prompt needs a unique field code.");
      return;
    }
    setDraftFields((current) => {
      if (editingFieldCode) {
        return current.map((field) =>
          field.fieldCode === editingFieldCode ? nextField : field
        );
      }
      return [...current, nextField];
    });
    setEditingFieldCode("");
    setFieldEditor(emptyField());
    setOptionText("");
    setError("");
  }

  function moveField(index: number, direction: -1 | 1) {
    setDraftFields((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function saveDraft() {
    if (!selectedForm || selectedForm.status !== "draft") return;
    await mutate("update_form", {
      formId: selectedForm.id,
      revision: selectedForm.revision,
      title: draftTitle,
      schema: {
        contract: CREDITEX_MANUAL_EVIDENCE_FORM_CONTRACT,
        catalogueReviewedOn: selectedForm.schema.catalogueReviewedOn,
        fields: draftFields,
      },
    }, "Draft evidence form saved.");
  }

  async function saveAndLockDraft() {
    if (!selectedForm || selectedForm.status !== "draft") return;
    const saved = await mutate("update_form", {
      formId: selectedForm.id,
      revision: selectedForm.revision,
      title: draftTitle,
      schema: {
        contract: CREDITEX_MANUAL_EVIDENCE_FORM_CONTRACT,
        catalogueReviewedOn: selectedForm.schema.catalogueReviewedOn,
        fields: draftFields,
      },
    }, "Draft saved before locking.");
    if (!saved?.id || !saved.revision) return;
    await mutate("mark_test_ready", {
      formId: saved.id,
      revision: saved.revision,
    }, "Exact saved form locked as an immutable test-ready version.");
  }

  function updateResponse(
    fieldCode: string,
    patch: Partial<ManualEvidenceResponse>,
  ) {
    setJobResponses((current) => {
      const existing = current.find(
        (response) => response.fieldCode === fieldCode,
      );
      if (!existing) {
        return [
          ...current,
          { ...emptyManualEvidenceResponse(fieldCode), ...patch },
        ];
      }
      return current.map((response) =>
        response.fieldCode === fieldCode
          ? { ...response, ...patch }
          : response
      );
    });
  }

  async function saveJobProgress(status?: ManualJob["status"]) {
    if (!selectedJob) return;
    const nextStatus = status
      || (
        selectedJob.status === "draft"
          || selectedJob.status === "changes_required"
          ? "field_testing"
          : selectedJob.status
      );
    await mutate("update_test_job", {
      jobId: selectedJob.id,
      revision: selectedJob.revision,
      status: nextStatus,
      responses: jobResponses,
      reviewNote,
    }, nextStatus === selectedJob.status
      ? "Manual evidence progress saved."
      : `Manual test moved to ${jobStatusLabel(nextStatus)}.`);
  }

  const draftProgress = useMemo(
    () => manualEvidenceProgress(draftFields, []),
    [draftFields],
  );
  const jobProgress = useMemo(
    () => selectedJob
      ? manualEvidenceProgress(selectedJob.formSchema.fields, jobResponses)
      : null,
    [jobResponses, selectedJob],
  );
  const previewForm = selectedJob
    ? {
        title: `${selectedJob.jobNumber} field checklist`,
        schema: selectedJob.formSchema,
        version: (selectedJob.activitySnapshot as {
          formVersion?: number;
        }).formVersion || 0,
        status: "test_ready" as const,
      }
    : selectedForm;

  if (!lab) {
    return (
      <section className={styles.loading} aria-busy="true">
        <strong>Loading national manual evidence lab</strong>
        <span>
          Verifying forms, test jobs and protected synthetic boundaries.
        </span>
        {error && (
          <>
            <p role="alert">{error}</p>
            <button type="button" onClick={() => void load()}>
              Retry
            </button>
          </>
        )}
      </section>
    );
  }

  return (
    <div className={styles.workspace}>
      <header className={styles.hero}>
        <div>
          <span>NATIONAL MANUAL TEST LAB</span>
          <h3>Editable evidence forms and installer workflow testing</h3>
          <p>
            Build and exercise an installer checklist for any catalogued
            activity. Creditex operational prompts remain separate from
            source-backed government policies. No file bytes, regulated case,
            certificate or regulator submission is created here.
          </p>
        </div>
        <dl>
          <div>
            <dt>Programs</dt>
            <dd>{lab.metrics.cataloguedPrograms}</dd>
          </div>
          <div>
            <dt>Activities</dt>
            <dd>{lab.metrics.cataloguedActivities}</dd>
          </div>
          <div>
            <dt>Test-ready forms</dt>
            <dd>{lab.metrics.testReadyForms}</dd>
          </div>
          <div>
            <dt>Awaiting audit</dt>
            <dd>{lab.metrics.awaitingReview}</dd>
          </div>
        </dl>
      </header>

      <section className={styles.catalogueBar}>
        <label>
          Program
          <select
            value={programCode}
            onChange={(event) => {
              setProgramCode(event.target.value);
              setActivityTemplateId("");
              setSelectedFormId("");
              setSelectedJobId("");
              setFormPage(1);
              setJobPage(1);
            }}
          >
            {lab.programmes.map((programme) => (
              <option
                key={programme.programCode}
                value={programme.programCode}
              >
                {programme.programCode} | {programme.name} |{" "}
                {programme.activityCount} activities
              </option>
            ))}
          </select>
        </label>
        <label>
          Activity
          <select
            value={activityTemplateId}
            onChange={(event) => {
              setActivityTemplateId(event.target.value);
              setSelectedFormId("");
              setSelectedJobId("");
              setFormPage(1);
              setJobPage(1);
            }}
          >
            {activities.map((activity) => (
              <option key={activity.templateId} value={activity.templateId}>
                {activityLabel(activity)}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.catalogueState}>
          <span>{selectedProgramme?.jurisdiction || "AU"}</span>
          <strong>
            {readable(selectedActivity?.catalogueState || "unknown")}
          </strong>
          <small>
            {selectedProgramme?.administeringBody || "Program authority"}
          </small>
        </div>
      </section>

      <section
        className={styles.policyBoundary}
        data-ready={policyMerge?.readiness.status === "ready"}
        aria-label="Governed evidence policy boundary"
      >
        <div>
          <span>GOVERNMENT MINIMUMS</span>
          <strong>
            {policyMerge?.readiness.status === "ready"
              ? "Published policy inventory available"
              : "Government policy merge blocked"}
          </strong>
          <p>
            {policyMergeError
              || policyMerge?.readiness.message
              || "Checking published government requirements and independent source approvals."}
          </p>
        </div>
        <dl>
          <div>
            <dt>Programs</dt>
            <dd>{policyMerge?.inventory.publishedPrograms ?? "—"}</dd>
          </div>
          <div>
            <dt>Activities</dt>
            <dd>{policyMerge?.inventory.publishedActivities ?? "—"}</dd>
          </div>
          <div>
            <dt>Complete policies</dt>
            <dd>
              {policyMerge?.inventory.publishedCompleteEvidencePolicies
                ?? "—"}
            </dd>
          </div>
          <div>
            <dt>Approved binding</dt>
            <dd>
              {policyMerge?.bindings.some(
                (binding) => binding.lifecycleState === "approved",
              )
                ? "Yes"
                : "No"}
            </dd>
          </div>
        </dl>
        {policyMerge?.bindings.map((binding) => (
          <details key={binding.id}>
            <summary>
              Binding v{binding.version} | {readable(binding.lifecycleState)}
            </summary>
            <p>
              {binding.bindingSnapshot.evidencePolicy.title} |{" "}
              {binding.bindingSnapshot.requirements.length} immutable
              government requirements
            </p>
            <code>{binding.bindingSnapshotSha256}</code>
            <small>
              Requested by {binding.requestedByUid}
              {binding.approvedByUid
                ? ` | independently approved by ${binding.approvedByUid}`
                : " | awaiting an independent administrator"}
            </small>
          </details>
        ))}
        <small className={styles.policyBoundaryNote}>
          Creditex may add instructions and operational fields, but it cannot
          remove, weaken, replace or reorder an approved government minimum.
          The exact composition diff and hashes are generated before a form is
          locked.
        </small>
      </section>

      <nav className={styles.viewTabs} aria-label="Manual evidence views">
        {([
          ["forms", "Form builder"],
          ["jobs", "Manual jobs"],
          ["preview", "Installer preview"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            data-selected={view === key}
            onClick={() => setView(key)}
          >
            {label}
            <span>
              {key === "forms"
                ? lab.pagination.forms.total
                : key === "jobs"
                ? lab.pagination.jobs.total
                : previewForm?.schema.fields.length || 0}
            </span>
          </button>
        ))}
        <button
          type="button"
          className={styles.refresh}
          disabled={Boolean(busy)}
          onClick={() => void load()}
        >
          Refresh
        </button>
      </nav>

      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}

      {view === "forms" && (
        <section className={styles.formWorkspace}>
          <aside className={styles.recordList}>
            <header>
              <div>
                <span>VERSIONS</span>
                <strong>{selectedActivity?.title || "Choose activity"}</strong>
              </div>
              <button
                type="button"
                disabled={!canWrite || !selectedActivity || Boolean(busy)}
                onClick={() =>
                  void mutate("create_starter_form", {
                    activityTemplateId,
                  }, "Editable starter form created.")}
              >
                New starter
              </button>
            </header>
            {activityForms.map((form) => (
              <button
                type="button"
                key={form.id}
                data-selected={selectedForm?.id === form.id}
                onClick={() => setSelectedFormId(form.id)}
              >
                <span>v{form.version} | {formStatusLabel(form.status)}</span>
                <strong>{form.title}</strong>
                <small>{form.schema.fields.length} prompts</small>
              </button>
            ))}
            {!activityForms.length && (
              <div className={styles.empty}>
                <strong>No manual form yet</strong>
                <p>
                  Create a safe editable starter for this activity. It is an
                  operational test form, not an official rule pack.
                </p>
              </div>
            )}
            {lab.pagination.forms.totalPages > 1 && (
              <div className={styles.pager}>
                <button
                  type="button"
                  disabled={formPage <= 1 || Boolean(busy)}
                  onClick={() => setFormPage((page) => page - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {lab.pagination.forms.page} of{" "}
                  {lab.pagination.forms.totalPages} |{" "}
                  {lab.pagination.forms.total} versions
                </span>
                <button
                  type="button"
                  disabled={
                    formPage >= lab.pagination.forms.totalPages
                    || Boolean(busy)
                  }
                  onClick={() => setFormPage((page) => page + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </aside>

          <main className={styles.builder}>
            {selectedForm ? (
              <>
                <header className={styles.builderHeader}>
                  <div>
                    <span>
                      VERSION {selectedForm.version} |{" "}
                      {formStatusLabel(selectedForm.status)}
                    </span>
                    <h4>{selectedForm.title}</h4>
                    <p>
                      Snapshot {selectedForm.schemaSha256.slice(0, 12)}...
                      Jobs keep this exact form after creation.
                    </p>
                  </div>
                  <div>
                    {selectedForm.status === "draft" ? (
                      <>
                        <button
                          type="button"
                          disabled={!canWrite || Boolean(busy)}
                          onClick={() => void saveDraft()}
                        >
                          Save draft
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canWrite
                            || Boolean(busy)
                            || draftProgress.fieldCount === 0
                          }
                          onClick={() => void saveAndLockDraft()}
                        >
                          Lock for testing
                        </button>
                        <button
                          type="button"
                          className={styles.dangerButton}
                          disabled={!canWrite || Boolean(busy)}
                          onClick={() => {
                            if (
                              window.confirm(
                                "Delete this draft manual form? Test-ready versions cannot be deleted.",
                              )
                            ) {
                              void mutate("delete_draft_form", {
                                formId: selectedForm.id,
                                revision: selectedForm.revision,
                              }, "Draft form deleted.");
                            }
                          }}
                        >
                          Delete draft
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={!canWrite || Boolean(busy)}
                        onClick={() =>
                          void mutate("clone_form", {
                            formId: selectedForm.id,
                          }, "New editable form version cloned.")}
                      >
                        Clone next version
                      </button>
                    )}
                  </div>
                </header>

                <label className={styles.formTitle}>
                  Form title
                  <input
                    value={draftTitle}
                    disabled={selectedForm.status !== "draft" || !canWrite}
                    maxLength={240}
                    onChange={(event) => setDraftTitle(event.target.value)}
                  />
                </label>

                <section className={styles.promptList}>
                  {draftFields.map((field, index) => (
                    <article key={field.fieldCode}>
                      <div className={styles.promptOrder}>{index + 1}</div>
                      <div className={styles.promptCopy}>
                        <span>
                          {readable(field.captureTiming)} |{" "}
                          {readable(field.fieldType)} |{" "}
                          {field.origin === "creditex_operational_test"
                            ? "Creditex operational"
                            : "Government candidate"}
                        </span>
                        <strong>{field.label}</strong>
                        <p>{field.instructions}</p>
                        <small>
                          {field.required ? "Required" : "Optional"}
                          {" | "}
                          {field.minimumCount} to{" "}
                          {field.maximumCount || "unlimited"}
                          {field.metadataRequired ? " | metadata" : ""}
                          {field.gpsRequired ? " | GPS" : ""}
                          {field.originalRequired ? " | original" : ""}
                        </small>
                      </div>
                      {selectedForm.status === "draft" && canWrite && (
                        <div className={styles.promptActions}>
                          <button
                            type="button"
                            aria-label={`Move ${field.label} up`}
                            disabled={index === 0}
                            onClick={() => moveField(index, -1)}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${field.label} down`}
                            disabled={index === draftFields.length - 1}
                            onClick={() => moveField(index, 1)}
                          >
                            Down
                          </button>
                          <button
                            type="button"
                            onClick={() => editField(field)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDraftFields((current) =>
                                current.filter(
                                  (item) =>
                                    item.fieldCode !== field.fieldCode,
                                )
                              )}
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </section>

                {selectedForm.status === "draft" && canWrite && (
                  <form
                    className={styles.fieldEditor}
                    onSubmit={commitField}
                  >
                    <header>
                      <div>
                        <span>EDITABLE PROMPT</span>
                        <h5>
                          {editingFieldCode
                            ? "Edit installer prompt"
                            : "Add installer prompt"}
                        </h5>
                      </div>
                      {editingFieldCode && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingFieldCode("");
                            setFieldEditor(emptyField());
                            setOptionText("");
                          }}
                        >
                          Cancel
                        </button>
                      )}
                    </header>
                    <div className={styles.editorGrid}>
                      <label>
                        Field code
                        <input
                          required
                          pattern="[a-z0-9][a-z0-9_-]{1,79}"
                          maxLength={80}
                          value={fieldEditor.fieldCode}
                          disabled={Boolean(editingFieldCode)}
                          onChange={(event) =>
                            setFieldEditor((current) => ({
                              ...current,
                              fieldCode: event.target.value,
                            }))}
                        />
                      </label>
                      <label>
                        Prompt type
                        <select
                          value={fieldEditor.fieldType}
                          onChange={(event) =>
                            setFieldType(
                              event.target.value as ManualEvidenceField["fieldType"],
                            )}
                        >
                          {MANUAL_EVIDENCE_FIELD_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {readable(type)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Capture stage
                        <select
                          value={fieldEditor.captureTiming}
                          onChange={(event) =>
                            setFieldEditor((current) => ({
                              ...current,
                              captureTiming:
                                event.target.value as ManualEvidenceField["captureTiming"],
                            }))}
                        >
                          {MANUAL_EVIDENCE_CAPTURE_TIMINGS.map((timing) => (
                            <option key={timing} value={timing}>
                              {readable(timing)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Requirement source
                        <select
                          value={fieldEditor.origin}
                          onChange={(event) =>
                            setFieldEditor((current) => ({
                              ...current,
                              origin:
                                event.target.value as ManualEvidenceField["origin"],
                              source:
                                event.target.value
                                  === "government_requirement_candidate"
                                  ? current.source || {
                                      officialSourceUrl: "",
                                      officialSourceTitle: "",
                                      officialSourceVersion: "",
                                      officialSourceSha256: "",
                                      clause: "",
                                    }
                                  : null,
                            }))}
                        >
                          {MANUAL_EVIDENCE_FIELD_ORIGINS.map((origin) => (
                            <option key={origin} value={origin}>
                              {origin === "creditex_operational_test"
                                ? "Creditex operational test"
                                : "Government requirement candidate"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.wide}>
                        Installer-facing label
                        <input
                          required
                          maxLength={180}
                          value={fieldEditor.label}
                          onChange={(event) =>
                            setFieldEditor((current) => ({
                              ...current,
                              label: event.target.value,
                            }))}
                        />
                      </label>
                      <label className={styles.wide}>
                        Plain-language capture instructions
                        <textarea
                          required
                          maxLength={1_200}
                          value={fieldEditor.instructions}
                          onChange={(event) =>
                            setFieldEditor((current) => ({
                              ...current,
                              instructions: event.target.value,
                            }))}
                        />
                      </label>
                      <label>
                        Minimum count
                        <select
                          value={fieldEditor.minimumCount}
                          disabled={
                            !["photo", "document"].includes(
                              fieldEditor.fieldType,
                            )
                          }
                          onChange={(event) =>
                            setFieldEditor((current) => ({
                              ...current,
                              minimumCount: Number(event.target.value),
                            }))}
                        >
                          {Array.from({ length: 11 }, (_, index) => index)
                            .map((count) => (
                              <option key={count} value={count}>{count}</option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Maximum count
                        <select
                          value={fieldEditor.maximumCount}
                          disabled={
                            !["photo", "document"].includes(
                              fieldEditor.fieldType,
                            )
                          }
                          onChange={(event) =>
                            setFieldEditor((current) => ({
                              ...current,
                              maximumCount: Number(event.target.value),
                            }))}
                        >
                          <option value={0}>
                            No form limit (manual test cap 20)
                          </option>
                          {Array.from({ length: 20 }, (_, index) => index + 1)
                            .map((count) => (
                              <option key={count} value={count}>{count}</option>
                            ))}
                        </select>
                      </label>
                      {fieldEditor.fieldType === "select" && (
                        <label className={styles.wide}>
                          Dropdown options, one per line
                          <textarea
                            required
                            value={optionText}
                            onChange={(event) =>
                              setOptionText(event.target.value)}
                          />
                        </label>
                      )}
                      {fieldEditor.origin
                        === "government_requirement_candidate"
                        && fieldEditor.source && (
                          <fieldset className={styles.sourceFields}>
                            <legend>
                              Candidate government source, independent
                              governance still required
                            </legend>
                            <label>
                              Official source URL
                              <input
                                type="url"
                                required
                                value={fieldEditor.source.officialSourceUrl}
                                onChange={(event) =>
                                  setFieldEditor((current) => ({
                                    ...current,
                                    source: current.source
                                      ? {
                                          ...current.source,
                                          officialSourceUrl:
                                            event.target.value,
                                        }
                                      : null,
                                  }))}
                              />
                            </label>
                            <label>
                              Source title
                              <input
                                required
                                value={fieldEditor.source.officialSourceTitle}
                                onChange={(event) =>
                                  setFieldEditor((current) => ({
                                    ...current,
                                    source: current.source
                                      ? {
                                          ...current.source,
                                          officialSourceTitle:
                                            event.target.value,
                                        }
                                      : null,
                                  }))}
                              />
                            </label>
                            <label>
                              Version
                              <input
                                required
                                value={fieldEditor.source.officialSourceVersion}
                                onChange={(event) =>
                                  setFieldEditor((current) => ({
                                    ...current,
                                    source: current.source
                                      ? {
                                          ...current.source,
                                          officialSourceVersion:
                                            event.target.value,
                                        }
                                      : null,
                                  }))}
                              />
                            </label>
                            <label>
                              Clause or page
                              <input
                                required
                                value={fieldEditor.source.clause}
                                onChange={(event) =>
                                  setFieldEditor((current) => ({
                                    ...current,
                                    source: current.source
                                      ? {
                                          ...current.source,
                                          clause: event.target.value,
                                        }
                                      : null,
                                  }))}
                              />
                            </label>
                            <label className={styles.wide}>
                              Source SHA-256
                              <input
                                required
                                pattern="[0-9a-fA-F]{64}"
                                minLength={64}
                                maxLength={64}
                                value={
                                  fieldEditor.source.officialSourceSha256
                                }
                                onChange={(event) =>
                                  setFieldEditor((current) => ({
                                    ...current,
                                    source: current.source
                                      ? {
                                          ...current.source,
                                          officialSourceSha256:
                                            event.target.value,
                                        }
                                      : null,
                                  }))}
                              />
                            </label>
                          </fieldset>
                        )}
                      <fieldset className={styles.checks}>
                        <legend>Capture controls</legend>
                        <label>
                          <input
                            type="checkbox"
                            checked={fieldEditor.required}
                            onChange={(event) =>
                             setFieldEditor((current) => ({
                               ...current,
                               required: event.target.checked,
                               minimumCount:
                                 event.target.checked
                                 && ["photo", "document"].includes(
                                   current.fieldType,
                                 )
                                 && current.minimumCount === 0
                                   ? 1
                                   : current.minimumCount,
                              }))}
                          />
                          Required
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={fieldEditor.originalRequired}
                            disabled={
                              !["photo", "document"].includes(
                                fieldEditor.fieldType,
                              )
                            }
                            onChange={(event) =>
                              setFieldEditor((current) => ({
                                ...current,
                                originalRequired: event.target.checked,
                              }))}
                          />
                          Original file
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={fieldEditor.metadataRequired}
                            disabled={fieldEditor.fieldType !== "photo"}
                            onChange={(event) =>
                              setFieldEditor((current) => ({
                                ...current,
                                metadataRequired: event.target.checked,
                              }))}
                          />
                          Metadata
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={fieldEditor.gpsRequired}
                            disabled={fieldEditor.fieldType !== "photo"}
                            onChange={(event) =>
                              setFieldEditor((current) => ({
                                ...current,
                                gpsRequired: event.target.checked,
                              }))}
                          />
                          GPS
                        </label>
                      </fieldset>
                    </div>
                    <button type="submit">
                      {editingFieldCode ? "Apply prompt changes" : "Add prompt"}
                    </button>
                  </form>
                )}
              </>
            ) : (
              <div className={styles.emptyLarge}>
                <strong>Create the first editable form</strong>
                <p>
                  The starter adapts its labels to this activity and remains
                  fully editable until you lock a test-ready version.
                </p>
              </div>
            )}
          </main>
        </section>
      )}

      {view === "jobs" && (
        <section className={styles.jobWorkspace}>
          <aside className={styles.jobCreate}>
            <header>
              <span>NEW SYNTHETIC JOB</span>
              <h4>Exercise a locked form</h4>
              <p>
                Use test aliases only. These jobs never enter the regulated
                case, certificate, trading or settlement tables.
              </p>
            </header>
            <label>
              Test-ready form
              <select
                value={
                  effectiveTestReadyFormId
                }
                onChange={(event) => setSelectedFormId(event.target.value)}
              >
                <option value="">Choose form</option>
                {testReadyForms.map((form) => (
                  <option key={form.id} value={form.id}>
                    v{form.version} | {form.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Test installer
              <select
                value={jobInstallerId}
                onChange={(event) => {
                  setJobInstallerId(event.target.value);
                  setJobTechnicianId("");
                }}
              >
                <option value="">Unassigned test installer</option>
                {(lab.installers || []).map((installer) => (
                  <option key={installer.id} value={installer.id}>
                    {installer.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Test technician
              <select
                value={jobTechnicianId}
                disabled={!jobInstallerId}
                onChange={(event) =>
                  setJobTechnicianId(event.target.value)}
              >
                <option value="">Choose technician</option>
                {visibleTechnicians.map((technician) => (
                  <option key={technician.id} value={technician.id}>
                    {technician.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Synthetic customer alias
              <input
                value={jobCustomerLabel}
                maxLength={160}
                onChange={(event) => setJobCustomerLabel(event.target.value)}
              />
            </label>
            <div className={styles.twoFields}>
              <label>
                Test state
                <select
                  value={jobState}
                  onChange={(event) => setJobState(event.target.value)}
                >
                  {AUSTRALIAN_STATES.map((state) => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
              </label>
              <label>
                Test postcode
                <input
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  value={jobPostcode}
                  onChange={(event) => setJobPostcode(event.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              disabled={
                !canWrite
                || Boolean(busy)
                || !effectiveTestReadyFormId
                || Boolean(jobInstallerId && !jobTechnicianId)
              }
              onClick={() =>
                void mutate("create_test_job", {
                  formId: effectiveTestReadyFormId,
                  installerId: jobInstallerId,
                  technicianId: jobTechnicianId,
                  customerLabel: jobCustomerLabel,
                  siteState: jobState,
                  sitePostcode: jobPostcode,
                }, "Synthetic manual test job created.")}
            >
              Create manual test job
            </button>
            {!testReadyForms.length && (
              <small>
                Lock a draft form for testing before creating a manual job.
              </small>
            )}

            <div className={styles.jobList}>
              <strong>{lab.pagination.jobs.total} manual jobs</strong>
              {activityJobs.map((job) => (
                <button
                  type="button"
                  key={job.id}
                  data-selected={selectedJob?.id === job.id}
                  onClick={() => setSelectedJobId(job.id)}
                >
                  <span>{jobStatusLabel(job.status)}</span>
                  <strong>{job.jobNumber}</strong>
                  <small>
                    {job.completedRequiredCount}/{job.requiredCount} required
                    {" | "}{job.issueCount} issues
                  </small>
                </button>
              ))}
              {lab.pagination.jobs.totalPages > 1 && (
                <div className={styles.pager}>
                  <button
                    type="button"
                    disabled={jobPage <= 1 || Boolean(busy)}
                    onClick={() => setJobPage((page) => page - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    Page {lab.pagination.jobs.page} of{" "}
                    {lab.pagination.jobs.totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={
                      jobPage >= lab.pagination.jobs.totalPages
                      || Boolean(busy)
                    }
                    onClick={() => setJobPage((page) => page + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </aside>

          <main className={styles.fieldTest}>
            {selectedJob ? (
              <>
                <header>
                  <div>
                    <span>SYNTHETIC TEST ONLY</span>
                    <h4>{selectedJob.jobNumber}</h4>
                    <p>
                      {selectedJob.installerLabel} |{" "}
                      {selectedJob.technicianLabel} |{" "}
                      {selectedJob.customerLabel} | {selectedJob.siteState}{" "}
                      {selectedJob.sitePostcode}
                    </p>
                  </div>
                  <div className={styles.progressMeter}>
                    <strong>
                      {jobProgress?.completedRequired || 0}/
                      {jobProgress?.requiredCount || 0}
                    </strong>
                    <span>required complete</span>
                    <progress
                      max={Math.max(1, jobProgress?.requiredCount || 1)}
                      value={jobProgress?.completedRequired || 0}
                    />
                  </div>
                </header>

                <p className={styles.fileBoundary}>
                  File prompts are read-only here. Assign this job to your
                  verified TLink login, then capture original bytes on the
                  device. Creditex shows only the server-verified result and
                  never trusts a manually ticked metadata box.
                </p>

                <div className={styles.fieldAssignment}>
                  <div>
                    <strong>TLink assignment</strong>
                    <span>
                      {selectedJob.fieldTesterUid
                        ? "Assigned to a verified Creditex login"
                        : "Not assigned to a TLink login"}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={
                      !canWrite
                      || Boolean(busy)
                      || ["ready_for_audit", "passed", "archived"].includes(
                        selectedJob.status,
                      )
                    }
                    onClick={() =>
                      void mutate("assign_field_tester", {
                        jobId: selectedJob.id,
                        revision: selectedJob.revision,
                      }, "This synthetic job is available in TLink for the current login.")}
                  >
                    {selectedJob.fieldTesterUid
                      ? "Reassign to my login"
                      : "Assign to my TLink login"}
                  </button>
                </div>

                <section className={styles.testFields}>
                  {selectedJob.formSchema.fields.map((field, index) => {
                    const response = responseFor(
                      field.fieldCode,
                      jobResponses,
                    );
                    const locked = ["ready_for_audit", "passed", "archived"]
                      .includes(selectedJob.status);
                    return (
                      <article key={field.fieldCode}>
                        <header>
                          <div className={styles.promptOrder}>{index + 1}</div>
                          <div>
                            <span>
                              {readable(field.captureTiming)} |{" "}
                              {readable(field.fieldType)}
                            </span>
                            <strong>{field.label}</strong>
                            <p>{field.instructions}</p>
                          </div>
                          <em>
                            {field.required ? "Required" : "Optional"}
                          </em>
                        </header>
                        <div className={styles.responseGrid}>
                          <label>
                            Test result
                            <select
                              value={response.outcome}
                              disabled={
                                locked
                                || !canWrite
                                || ["photo", "document"].includes(
                                  field.fieldType,
                                )
                              }
                              onChange={(event) =>
                                updateResponse(field.fieldCode, {
                                  outcome:
                                    event.target.value as ManualEvidenceResponse["outcome"],
                                })}
                            >
                              {MANUAL_EVIDENCE_RESPONSE_OUTCOMES.map(
                                (outcome) => (
                                  <option key={outcome} value={outcome}>
                                    {readable(outcome)}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>
                          {["photo", "document"].includes(field.fieldType) ? (
                            <section className={styles.captureList}>
                              <header>
                                <div>
                                  <strong>
                                    {response.captures.filter(
                                      (capture) =>
                                        capture.verificationState
                                          === "server_verified",
                                    ).length} verified captures
                                  </strong>
                                  <span>
                                    Required {field.minimumCount} to{" "}
                                    {field.maximumCount || 20}
                                  </span>
                                </div>
                                <span>Captured in TLink</span>
                              </header>
                              {response.captures.map((capture, captureIndex) => (
                                <article
                                  key={capture.captureId
                                    || `${field.fieldCode}-${captureIndex}`}
                                  className={styles.captureRow}
                                >
                                  <strong>Capture {captureIndex + 1}</strong>
                                  <dl className={styles.captureFacts}>
                                    <div>
                                      <dt>File</dt>
                                      <dd>{capture.fileName}</dd>
                                    </div>
                                    <div>
                                      <dt>Type</dt>
                                      <dd>{capture.contentType}</dd>
                                    </div>
                                    <div>
                                      <dt>Original SHA-256</dt>
                                      <dd>{capture.originalSha256 || "Not verified"}</dd>
                                    </div>
                                    <div>
                                      <dt>Device</dt>
                                      <dd>{capture.deviceId || "Not recorded"}</dd>
                                    </div>
                                    <div>
                                      <dt>Checks</dt>
                                      <dd>
                                        Original {capture.originalPresent ? "yes" : "no"}
                                        {" | "}Metadata {capture.metadataPresent ? "yes" : "no"}
                                        {" | "}GPS {capture.gpsPresent ? "yes" : "no"}
                                        {" | "}Time {capture.captureTimePresent ? "yes" : "no"}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt>Device state</dt>
                                      <dd>{readable(capture.physicalDeviceState)}</dd>
                                    </div>
                                  </dl>
                                </article>
                              ))}
                              {!response.captures.length && (
                                <p>
                                  No verified original file has arrived. Open
                                  this assigned job in TLink and follow the
                                  locked prompt.
                                </p>
                              )}
                            </section>
                          ) : field.fieldType === "select" ? (
                            <label>
                              Controlled answer
                              <select
                                value={response.value}
                                disabled={locked || !canWrite}
                                onChange={(event) =>
                                  updateResponse(field.fieldCode, {
                                    value: event.target.value,
                                  })}
                              >
                                <option value="">Choose answer</option>
                                {field.options.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : field.fieldType === "checkbox" ? (
                            <label>
                              Controlled answer
                              <select
                                value={response.value}
                                disabled={locked || !canWrite}
                                onChange={(event) =>
                                  updateResponse(field.fieldCode, {
                                    value: event.target.value,
                                  })}
                              >
                                <option value="">Choose answer</option>
                                <option value="Yes">Yes</option>
                                <option value="No">No</option>
                              </select>
                            </label>
                          ) : (
                            <label>
                              Test answer
                              <input
                                type={
                                  field.fieldType === "number"
                                    ? "number"
                                    : field.fieldType === "date"
                                    ? "date"
                                    : "text"
                                }
                                value={response.value}
                                disabled={locked || !canWrite}
                                onChange={(event) =>
                                  updateResponse(field.fieldCode, {
                                    value: event.target.value,
                                  })}
                              />
                            </label>
                          )}
                          <label className={styles.wide}>
                            Installer or reviewer note
                            <input
                              value={response.note}
                              disabled={locked || !canWrite}
                              onChange={(event) =>
                                updateResponse(field.fieldCode, {
                                  note: event.target.value,
                                })}
                            />
                          </label>
                        </div>
                      </article>
                    );
                  })}
                </section>

                <section className={styles.reviewBar}>
                  <label>
                    Creditex review note
                    <textarea
                      value={reviewNote}
                      disabled={
                        selectedJob.status === "passed"
                        || selectedJob.status === "archived"
                        || !canWrite
                      }
                      placeholder="Record the audit completed or exact changes required."
                      onChange={(event) => setReviewNote(event.target.value)}
                    />
                  </label>
                  <div>
                    {!["ready_for_audit", "passed", "archived"].includes(
                      selectedJob.status,
                    ) && (
                      <>
                        <button
                          type="button"
                          disabled={!canWrite || Boolean(busy)}
                          onClick={() => void saveJobProgress()}
                        >
                          Save field test
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canWrite
                            || Boolean(busy)
                            || !jobProgress?.readyForAudit
                          }
                          onClick={() =>
                            void saveJobProgress("ready_for_audit")}
                        >
                          Submit for Creditex audit
                        </button>
                      </>
                    )}
                    {selectedJob.status === "ready_for_audit" && (
                      <>
                        <button
                          type="button"
                          disabled={!canReview || Boolean(busy)}
                          onClick={() =>
                            void saveJobProgress("changes_required")}
                        >
                          Request changes
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canReview
                            || Boolean(busy)
                            || !jobProgress?.readyForAudit
                          }
                          onClick={() => void saveJobProgress("passed")}
                        >
                          Pass synthetic workflow
                        </button>
                      </>
                    )}
                    {selectedJob.status !== "archived" && (
                      <button
                        type="button"
                        className={styles.dangerButton}
                        disabled={!canWrite || Boolean(busy)}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Archive this synthetic manual test job?",
                            )
                          ) void saveJobProgress("archived");
                        }}
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </section>
                <section className={styles.auditHistory}>
                  <header>
                    <div>
                      <span>APPEND-ONLY HISTORY</span>
                      <strong>{jobEvents.length} recorded events</strong>
                    </div>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void loadEvents(selectedJob.id)}
                    >
                      Refresh history
                    </button>
                  </header>
                  {jobEvents.map((event) => (
                    <article key={event.id}>
                      <div>
                        <strong>{event.summary}</strong>
                        <span>
                          {new Date(event.createdAt).toLocaleString("en-AU")}
                          {" | "}{event.actorUid}
                        </span>
                      </div>
                      <dl>
                        <div>
                          <dt>Status</dt>
                          <dd>
                            {readable(
                              event.metadata.status
                                || event.eventType.split(".").at(-1)
                                || "recorded",
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Required</dt>
                          <dd>
                            {event.metadata.completedRequiredCount ?? 0}/
                            {event.metadata.requiredCount ?? 0}
                          </dd>
                        </div>
                        <div>
                          <dt>Issues</dt>
                          <dd>{event.metadata.issueCount ?? 0}</dd>
                        </div>
                        <div>
                          <dt>Snapshot</dt>
                          <dd>
                            {event.metadata.responseSha256?.slice(0, 12)
                              || "Created"}
                          </dd>
                        </div>
                      </dl>
                      {event.metadata.reviewNote && (
                        <p>{event.metadata.reviewNote}</p>
                      )}
                    </article>
                  ))}
                  {!jobEvents.length && (
                    <p>No synthetic workflow events have been recorded.</p>
                  )}
                </section>
              </>
            ) : (
              <div className={styles.emptyLarge}>
                <strong>Create or choose a manual test job</strong>
                <p>
                  A job pins the exact activity and test-ready evidence form
                  so later edits never change work already in progress.
                </p>
              </div>
            )}
          </main>
        </section>
      )}

      {view === "preview" && (
        <section className={styles.previewWorkspace}>
          <aside>
            <span>INSTALLER HANDOFF</span>
            <h4>Exactly what the field worker sees</h4>
            <p>
              This preview is grouped into a short working sequence. Creditex
              can improve plain-language instructions and add operational
              checks by cloning a new form version.
            </p>
            <dl>
              <div>
                <dt>Program</dt>
                <dd>{selectedProgramme?.programCode || "None"}</dd>
              </div>
              <div>
                <dt>Activity</dt>
                <dd>
                  {selectedActivity?.registryActivityCode
                    || selectedActivity?.activityKey
                    || "None"}
                </dd>
              </div>
              <div>
                <dt>Form state</dt>
                <dd>{previewForm?.status
                  ? formStatusLabel(previewForm.status)
                  : "No form"}</dd>
              </div>
              <div>
                <dt>Prompts</dt>
                <dd>{previewForm?.schema.fields.length || 0}</dd>
              </div>
            </dl>
            <button type="button" onClick={() => setView("forms")}>
              Edit form versions
            </button>
          </aside>
          <div className={styles.phoneFrame}>
            <header>
              <span>TLink</span>
              <strong>{previewForm?.title || "No form selected"}</strong>
              <small>Synthetic installer preview</small>
            </header>
            <main>
              {MANUAL_EVIDENCE_CAPTURE_TIMINGS.map((timing) => {
                const fields = previewForm?.schema.fields.filter(
                  (field) => field.captureTiming === timing,
                ) || [];
                if (!fields.length) return null;
                return (
                  <section key={timing}>
                    <h5>{readable(timing)}</h5>
                    {fields.map((field) => (
                      <article key={field.fieldCode}>
                        <div>
                          <strong>{field.label}</strong>
                          <span>{field.required ? "Required" : "Optional"}</span>
                        </div>
                        <p>{field.instructions}</p>
                        <button type="button" disabled>
                          {field.fieldType === "photo"
                            ? "Open camera"
                            : field.fieldType === "document"
                            ? "Attach document"
                            : field.fieldType === "select"
                            ? "Choose answer"
                            : field.fieldType === "checkbox"
                            ? "Confirm"
                            : "Enter answer"}
                        </button>
                        <small>
                          {readable(field.fieldType)}
                          {field.metadataRequired
                            ? " | metadata retained"
                            : ""}
                          {field.gpsRequired ? " | GPS required" : ""}
                        </small>
                      </article>
                    ))}
                  </section>
                );
              })}
              {!previewForm && (
                <div className={styles.empty}>
                  Create or choose a form to preview the installer checklist.
                </div>
              )}
            </main>
          </div>
        </section>
      )}
    </div>
  );
}
