"use client";

import dynamic from "next/dynamic";

import Image from "next/image";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  COMPLIANCE_OUTCOME_CLASSES,
  GOVERNMENT_ACTIVITY_TEMPLATES,
  GOVERNMENT_CATALOGUE_REVIEWED_ON,
  GOVERNMENT_PROGRAM_TEMPLATES,
  governmentActivityTemplates,
  governmentProgramTemplate,
} from "@/lib/australian-government-program-catalogue";
import { requestWithCreditexTokenRecovery } from "@/lib/creditex-auth-token";
import { firebaseAuth } from "@/lib/firebase-client";
import { FirebaseAccountSecurity, FirebaseMfaChallenge, useFirebaseMfaChallenge } from "./FirebaseMfa";
import { CreditexEvidencePolicyGovernance } from "./CreditexEvidencePolicyGovernance";
const CreditexActivityWorkPackGovernance = dynamic(() => import("./CreditexActivityWorkPackGovernance").then((module) => module.CreditexActivityWorkPackGovernance), { loading: () => <p role="status">Loading master forms...</p> });
const CreditexOnboardingReviewWorkspace = dynamic(() => import("./CreditexOnboardingReviewWorkspace").then((module) => module.CreditexOnboardingReviewWorkspace), { loading: () => <p role="status">Loading onboarding reviews...</p> });
const TrainingQuestionnaireEditor = dynamic(() => import("./TrainingQuestionnaireEditor").then((module) => module.TrainingQuestionnaireEditor), { loading: () => <p role="status">Loading training...</p> });
import { CreditexOutputActions } from "./CreditexOutputActions";
import { CreditexRegistryWorkspace } from "./CreditexRegistryWorkspace";
import { CreditexOfficialSourceWorkbench } from "./CreditexOfficialSourceWorkbench";
import { CreditexOperationsWorkspace, CreditexTeamAccess } from "./CreditexOperationsWorkspace";
import { CreditexPlannedIntakeQueue } from "./CreditexPlannedIntakeQueue";
import CreditexVoiceSetupPanel from "./CreditexVoiceSetupPanel";
import styles from "./CreditexCompliancePortal.module.css";

type ComplianceRole = "admin" | "case_manager" | "reviewer" | "auditor";
type WorkspaceTab = "cases" | "operations" | "submissions" | "sources" | "forms" | "onboarding" | "compliance-questions" | "governance" | "team";

function WorkspaceIcon({ tab }: { tab: WorkspaceTab }) {
  const paths: Record<WorkspaceTab, string> = {
    cases: "M8 6V4h8v2M4 6h16v14H4zM4 11h16M10 11v3h4v-3",
    operations: "M4 5h6l2 2h8v13H4zM8 12h8M8 16h5",
    submissions: "M14 3H5v18h14V8zM14 3v5h5M8 14l3 3 5-6",
    "compliance-questions": "m2 8 10-5 10 5-10 5zM6 10v7c4 3 8 3 12 0v-7M22 8v9",
    forms: "M8 4h11v17H5V7M8 3H5v5h6V3zM9 12h6M9 16h6",
    onboarding: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 8h5M19.5 5.5v5",
    sources: "M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1v15",
    governance: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6",
    team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 8v6M17 11h6",
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={paths[tab]} /></svg>;
}

type ComplianceSession = {
  email: string;
  displayName: string;
  role: ComplianceRole;
  governanceIdentityVerified: boolean;
  canEditFieldMasters: boolean;
  canConfirmNamedOwner?: boolean;
  namedOwnerConfirmed?: boolean;
  organisation: {
    code: string;
    legalName: string;
    tradingName: string;
  };
};

type CaseQueueItem = {
  caseId?: string;
  caseNumber: string;
  jobNumber: string;
  installerBusiness: string;
  jurisdiction: string;
  activityDate: string;
  activity: {
    programName: string;
    activityKey: string;
    registryActivityCode: string;
    title: string;
    version: number;
    specificationPart: string;
    productCategory: string;
    scenarioCode: string;
    scenario: string;
    effectiveFrom: string;
    effectiveTo: string;
    officialSourceVersion: string;
  };
  evidenceStatus: string;
  workflowStatus: string;
  createdAt: string;
  updatedAt: string;
};

type ProgramRecord = {
  id: string;
  programCode: string;
  name: string;
  schemeKind: string;
  jurisdiction: string;
  administeringBody: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  officialSourceVersion: string;
  officialSourceCheckedAt: string;
  publishState: "draft" | "published" | "withdrawn";
  pendingPublicationRequestId: string;
  publishedAt: string;
  withdrawnAt: string;
  createdAt: string;
  updatedAt: string;
};

type ActivityRecord = {
  id: string;
  programId: string;
  programCode: string;
  programName: string;
  activityKey: string;
  version: number;
  title: string;
  serviceCategory: string;
  registryActivityCode: string;
  specificationPart: string;
  productCategory: string;
  scenarioCode: string;
  scenario: string;
  jurisdiction: string;
  effectiveFrom: string;
  effectiveTo: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  officialSourceVersion: string;
  officialSourceCheckedAt: string;
  publishState: "draft" | "published" | "withdrawn";
  pendingPublicationRequestId: string;
  calculationApprovalState: string;
  publishedAt: string;
  withdrawnAt: string;
  createdAt: string;
  updatedAt: string;
};

type ApiFailure = Error & {
  result?: { error?: string; code?: string };
};

type ApiResult = {
  ok?: boolean;
  error?: string;
  code?: string;
};

type ApiAttempt = {
  response: Response;
  result: ApiResult;
};

const CASE_STATUSES = [
  "open",
  "all",
  "draft",
  "ready_for_submission",
  "submitted",
  "in_review",
  "changes_requested",
  "accepted",
  "rejected",
  "closed",
] as const;

const SERVICE_CATEGORIES = [
  "assessment",
  "solar",
  "battery",
  "heating-cooling",
  "hot-water",
  "draught-proofing",
  "insulation",
  "glazing",
  "window-coverings",
  "ev-charging",
  "electrical",
  "plumbing",
  "mounting-hardware",
  "controls",
  "other",
] as const;

const AUSTRALIAN_JURISDICTIONS = [
  "AU",
  "ACT",
  "NSW",
  "NT",
  "QLD",
  "SA",
  "TAS",
  "VIC",
  "WA",
] as const;

function canControlPublication(session: ComplianceSession | null) {
  return Boolean(
    session?.role === "admin"
    && session.governanceIdentityVerified
  );
}

function readable(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateOnly(value: string) {
  if (!value) return "Open ended";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-AU", { dateStyle: "medium" });
}

function authMessage(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  if (code.includes("network-request-failed")) {
    return "The secure sign-in service could not be reached. Check your connection and retry.";
  }
  if (code.includes("invalid-credential") || code.includes("wrong-password"))
    return "The email or password was not recognised.";
  if (code.includes("popup-closed"))
    return "Google sign-in was closed before it finished.";
  if (code.includes("popup-blocked"))
    return "Allow the Google sign-in pop-up and try again.";
  return error instanceof Error
    ? error.message
    : "The secure compliance request could not be completed.";
}

function workspaceMessage(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  if (code.includes("network-request-failed")) {
    return "The secure sign-in service could not be reached. Check your connection, then retry the workspace.";
  }
  return error instanceof Error
    ? error.message
    : "The protected Creditex workspace could not be loaded.";
}

function caseMatches(item: CaseQueueItem, query: string) {
  const search = query.trim().toLowerCase();
  if (!search) return true;
  return [
    item.caseNumber,
    item.jobNumber,
    item.installerBusiness,
    item.jurisdiction,
    item.activity.programName,
    item.activity.activityKey,
    item.activity.registryActivityCode,
    item.activity.title,
    item.activity.scenario,
  ].some((value) => value.toLowerCase().includes(search));
}

function emptyProgramForm() {
  return {
    programCode: "",
    name: "",
    schemeKind: "",
    jurisdiction: "",
    administeringBody: "",
    officialSourceUrl: "",
    officialSourceTitle: "",
    officialSourceVersion: "",
    officialSourceSha256: "",
    officialSourceCheckedAt: "",
  };
}

function emptyActivityForm() {
  return {
    programId: "",
    activityKey: "",
    version: "1",
    title: "",
    serviceCategory: "other",
    registryActivityCode: "",
    specificationPart: "",
    productCategory: "",
    scenarioCode: "",
    scenario: "",
    jurisdiction: "",
    effectiveFrom: "",
    effectiveTo: "",
    officialSourceUrl: "",
    officialSourceTitle: "",
    officialSourceVersion: "",
    officialSourceSha256: "",
    officialSourceCheckedAt: "",
    requirementsSnapshot: "{}",
  };
}

export function CreditexCompliancePortal() {
  const { resolver, captureMfaError, clearMfaChallenge } = useFirebaseMfaChallenge();
  const [mfaRequired, setMfaRequired] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState<ComplianceSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState(
    "Loading the protected compliance workspace...",
  );
  const authUidRef = useRef("");
  const workspaceLoadRef = useRef<{
    uid: string;
    promise: Promise<void>;
  } | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"info" | "success" | "error">(
    "info",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState<WorkspaceTab>("cases");
  const questionnaireDirty = useRef(false);
  const fieldFormDirty = useRef(false);
  const reportQuestionnaireDirty = useCallback((dirty: boolean) => { questionnaireDirty.current = dirty; }, []);
  const reportFieldFormDirty = useCallback((dirty: boolean) => { fieldFormDirty.current = dirty; }, []);
  function selectTab(next: typeof tab) {
    if (next === tab) return true;
    if (questionnaireDirty.current && !window.confirm("Discard the unsaved changes to this questionnaire?")) return false;
    if (fieldFormDirty.current && !window.confirm("Discard the unsaved changes to this activity form?")) return false;
    questionnaireDirty.current = false;
    fieldFormDirty.current = false;
    setTab(next);
    return true;
  }
  const [cases, setCases] = useState<CaseQueueItem[]>([]);
  const [caseQuery, setCaseQuery] = useState("");
  const [caseStatus, setCaseStatus] =
    useState<(typeof CASE_STATUSES)[number]>("open");
  const [casePagination, setCasePagination] = useState({
    pageSize: 50,
    hasNext: false,
    nextCursor: "",
  });
  const [programs, setPrograms] = useState<ProgramRecord[]>([]);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [programForm, setProgramForm] = useState(emptyProgramForm);
  const [activityForm, setActivityForm] = useState(emptyActivityForm);
  const [programTemplateId, setProgramTemplateId] = useState("");
  const [activityTemplateId, setActivityTemplateId] = useState("");
  const [activityHasEndDate, setActivityHasEndDate] = useState(false);
  const [governanceRefreshToken, setGovernanceRefreshToken] = useState(0);
  const [governanceProgramId, setGovernanceProgramId] = useState("");
  const [governanceActivityId, setGovernanceActivityId] = useState("");
  const canRequestPublication = canControlPublication(session);
  const canReviewTraining = Boolean(session?.governanceIdentityVerified && ["admin", "reviewer"].includes(session.role));
  // The editor endpoint also authorises internal operations editors. Let it resolve access.
  const canOpenQuestionnaires = Boolean(session && ["admin", "reviewer"].includes(session.role));
  // The confirmed bootstrap owner already has platform access. These endpoints
  // independently recheck that authority and retain the platform actor in audits.
  const usePlatformSubmissionAccess = session?.namedOwnerConfirmed === true
    && session.role === "admin" && session.organisation.code === "CREDITEX-AU";
  const registryEndpoint = usePlatformSubmissionAccess
    ? "/api/admin/compliance-registry" : "/api/creditex/registry";
  const outputEndpoint = usePlatformSubmissionAccess
    ? "/api/admin/compliance-output-actions" : "/api/creditex/output-actions";

  const api = useCallback(async (
    path: string,
    init: RequestInit = {},
    options: { requestTimeoutMs?: number } = {},
  ) => {
    const activeUser = firebaseAuth.currentUser;
    if (!activeUser) throw new Error("Sign in to continue.");
    const activeUid = activeUser.uid;
    const requestTimeoutMs = Math.min(
      Math.max(options.requestTimeoutMs ?? 20_000, 1_000),
      120_000,
    );
    const headers = new Headers(init.headers);
    if (
      init.body
      && !(init.body instanceof FormData)
      && !headers.has("Content-Type")
    )
      headers.set("Content-Type", "application/json");

    const { response, result } =
      await requestWithCreditexTokenRecovery<ApiAttempt>({
        user: activeUser,
        currentUid: () => firebaseAuth.currentUser?.uid,
        isUnauthorized: (attempt) => attempt.response.status === 401,
        request: async (idToken) => {
          headers.set("Authorization", `Bearer ${idToken}`);
          for (let attempt = 0; attempt < 20; attempt += 1) {
            init.signal?.throwIfAborted();
            const controller = new AbortController();
            const cancelRequest = () => controller.abort(init.signal?.reason);
            init.signal?.addEventListener("abort", cancelRequest, { once: true });
            let timedOut = false;
            const requestTimeout = window.setTimeout(
              () => { timedOut = true; controller.abort(); },
              requestTimeoutMs,
            );
            let response: Response;
            let result: ApiResult;
            try {
              response = await fetch(path, {
                ...init,
                headers,
                cache: "no-store",
                signal: controller.signal,
              });
              result = (await response.json().catch((error: unknown) => {
                if (controller.signal.aborted) throw error;
                return {};
              })) as ApiResult;
            } catch (error) {
              init.signal?.throwIfAborted();
              if (timedOut) {
                throw new Error(
                  `The compliance service did not respond within ${Math.ceil(
                    requestTimeoutMs / 1_000,
                  )} seconds. Retry the workspace.`,
                );
              }
              throw error;
            } finally {
              window.clearTimeout(requestTimeout);
              init.signal?.removeEventListener("abort", cancelRequest);
            }
            if (firebaseAuth.currentUser?.uid !== activeUid) {
              throw new Error(
                "The signed-in account changed. Loading the new workspace.",
              );
            }
            if (
              response.status === 503
              && (
                result.code === "CREDITEX_SCHEMA_GUARDS_INSTALLING"
                || result.code === "OFFICIAL_PRODUCT_FLEET_BUSY"
              )
              && attempt < 19
            ) {
              const retryAfterSeconds = Number(
                response.headers.get("Retry-After"),
              );
              const retryAfterMilliseconds = Number.isFinite(retryAfterSeconds)
                ? Math.min(Math.max(retryAfterSeconds * 1_000, 1_000), 5_000)
                : 1_000;
              setLoadingMessage(
                "Updating the exact official product register. Product choices will load automatically.",
              );
              await new Promise((resolve) =>
                window.setTimeout(resolve, retryAfterMilliseconds)
              );
              if (firebaseAuth.currentUser?.uid !== activeUid) {
                throw new Error(
                  "The signed-in account changed. Loading the new workspace.",
                );
              }
              continue;
            }
            return { response, result };
          }
          throw new Error(
            "The governed Creditex workspace could not be prepared.",
          );
        },
      });

    if (result.code === "MFA_REQUIRED") setMfaRequired(true);
    if (!response.ok || result.ok === false) {
      const error = new Error(
        result.error || "The compliance request could not be completed.",
      ) as ApiFailure;
      error.result = result;
      throw error;
    }
    return result as Record<string, unknown>;
  }, []);

  const downloadOfficialSource = useCallback(async (
    artifactId: string,
    originalFileName: string,
  ) => {
    const activeUser = firebaseAuth.currentUser;
    if (!activeUser) throw new Error("Sign in to continue.");
    const activeUid = activeUser.uid;
    const response = await requestWithCreditexTokenRecovery<Response>({
      user: activeUser,
      currentUid: () => firebaseAuth.currentUser?.uid,
      isUnauthorized: (attempt) => attempt.status === 401,
      request: async (idToken) =>
        fetch(
          `/api/creditex/official-sources/${encodeURIComponent(artifactId)}`,
          {
            cache: "no-store",
            headers: { Authorization: `Bearer ${idToken}` },
          },
        ),
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as ApiResult;
      throw new Error(
        result.error || "The retained official source could not be downloaded.",
      );
    }
    if (firebaseAuth.currentUser?.uid !== activeUid) {
      throw new Error(
        "The signed-in account changed. Loading the new workspace.",
      );
    }
    const accessReceipt = response.headers.get(
      "X-Creditex-Official-Source-Receipt",
    )?.trim();
    if (!accessReceipt) {
      throw new Error(
        "The retained source was verified but no access receipt was returned.",
      );
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = originalFileName
      .replace(/[^A-Za-z0-9._ ()-]/g, "_")
      .slice(0, 180) || "official-source";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    return accessReceipt;
  }, []);

  const loadCases = useCallback(async ({
    status = "open",
    cursor = "",
    append = false,
  }: {
    status?: (typeof CASE_STATUSES)[number];
    cursor?: string;
    append?: boolean;
  } = {}) => {
    const query = new URLSearchParams({ status, pageSize: "50" });
    if (cursor) query.set("cursor", cursor);
    const result = await api(`/api/creditex/cases?${query.toString()}`);
    const nextCases = (result.cases || []) as CaseQueueItem[];
    setCases((current) => {
      if (!append) return nextCases;
      const known = new Set(current.map((item) => item.caseNumber));
      return [
        ...current,
        ...nextCases.filter((item) => !known.has(item.caseNumber)),
      ];
    });
    setCasePagination(
      (result.pagination || {
        pageSize: 50,
        hasNext: false,
        nextCursor: "",
      }) as {
        pageSize: number;
        hasNext: boolean;
        nextCursor: string;
      },
    );
  }, [api]);

  const loadGovernance = useCallback(async () => {
    const result = await api("/api/creditex/activities");
    setPrograms((result.programs || []) as ProgramRecord[]);
    setActivities((result.activities || []) as ActivityRecord[]);
  }, [api]);

  const loadWorkspace = useCallback(() => {
    const activeUser = firebaseAuth.currentUser;
    if (!activeUser) return Promise.resolve();
    const activeUid = activeUser.uid;
    if (workspaceLoadRef.current?.uid === activeUid) {
      return workspaceLoadRef.current.promise;
    }
    const request = (async () => {
      setLoading(true);
      setLoadingMessage("Verifying Creditex access...");
      setNotice("");
      try {
        const result = await api("/api/creditex/session");
        if (firebaseAuth.currentUser?.uid !== activeUid) return;
        const nextSession = result.member as ComplianceSession;
        setSession(nextSession);
        setCaseStatus("open");
        setCaseQuery("");
        await loadCases({ status: "open" });
        if (firebaseAuth.currentUser?.uid !== activeUid) return;
        if (nextSession.role === "admin") await loadGovernance();
        else {
          setPrograms([]);
          setActivities([]);
          setTab("cases");
        }
      } catch (error) {
        if (firebaseAuth.currentUser?.uid !== activeUid) return;
        setSession(null);
        setNotice(workspaceMessage(error));
        setNoticeKind("error");
      } finally {
        if (firebaseAuth.currentUser?.uid === activeUid) {
          setLoading(false);
          setLoadingMessage("Loading the protected compliance workspace...");
        }
      }
    })();
    workspaceLoadRef.current = { uid: activeUid, promise: request };
    void request.finally(() => {
      if (workspaceLoadRef.current?.promise === request) {
        workspaceLoadRef.current = null;
      }
    });
    return request;
  }, [api, loadCases, loadGovernance]);

  useEffect(
    () =>
      onAuthStateChanged(firebaseAuth, (nextUser) => {
        const nextUid = nextUser?.uid || "";
        const identityChanged = authUidRef.current !== nextUid;
        authUidRef.current = nextUid;
        if (identityChanged) {
          if (workspaceLoadRef.current?.uid !== nextUid) {
            workspaceLoadRef.current = null;
          }
          setSession(null);
          setCases([]);
          setCasePagination({ pageSize: 50, hasNext: false, nextCursor: "" });
          setPrograms([]);
          setActivities([]);
          setCaseStatus("open");
          setCaseQuery("");
          setGovernanceProgramId("");
          setGovernanceActivityId("");
          setProgramTemplateId("");
          setActivityTemplateId("");
          setProgramForm(emptyProgramForm());
          setActivityForm(emptyActivityForm());
          setTab("cases");
          setNotice("");
        }
        setUser(nextUser);
        if (!nextUser) setMfaRequired(false);
        setAuthReady(true);
        if (nextUser) {
          setLoading(true);
          void loadWorkspace();
        }
        else {
          setLoading(false);
        }
      }),
    [loadWorkspace],
  );

  const visibleCases = useMemo(
    () => cases.filter((item) => caseMatches(item, caseQuery)),
    [caseQuery, cases],
  );
  const selectedGovernanceProgram = useMemo(
    () =>
      programs.find((program) => program.id === governanceProgramId)
      || programs[0]
      || null,
    [governanceProgramId, programs],
  );
  const governanceProgramActivities = useMemo(
    () =>
      selectedGovernanceProgram
        ? activities.filter(
          (activity) => activity.programId === selectedGovernanceProgram.id,
        )
        : [],
    [activities, selectedGovernanceProgram],
  );
  const effectiveGovernanceActivityId = governanceProgramActivities.some(
    (activity) => activity.id === governanceActivityId,
  )
    ? governanceActivityId
    : "";
  const visibleGovernanceActivities = useMemo(
    () =>
      effectiveGovernanceActivityId
        ? governanceProgramActivities.filter(
          (activity) => activity.id === effectiveGovernanceActivityId,
        )
        : governanceProgramActivities,
    [effectiveGovernanceActivityId, governanceProgramActivities],
  );
  const selectedProgramTemplate = useMemo(
    () => governmentProgramTemplate(programTemplateId) || null,
    [programTemplateId],
  );
  const selectedActivityProgram = useMemo(
    () => programs.find((program) => program.id === activityForm.programId) || null,
    [activityForm.programId, programs],
  );
  const availableActivityTemplates = useMemo(
    () => governmentActivityTemplates(selectedActivityProgram?.programCode || ""),
    [selectedActivityProgram],
  );
  const selectedActivityTemplate = useMemo(
    () =>
      availableActivityTemplates.find(
        (activityTemplate) => activityTemplate.templateId === activityTemplateId,
      ) || null,
    [activityTemplateId, availableActivityTemplates],
  );
  const catalogueByJurisdiction = useMemo(
    () =>
      AUSTRALIAN_JURISDICTIONS.map((jurisdiction) => ({
        jurisdiction,
        programs: GOVERNMENT_PROGRAM_TEMPLATES.filter(
          (program) => program.jurisdiction === jurisdiction,
        ),
      })).filter((group) => group.programs.length > 0),
    [],
  );

  function chooseGovernanceProgram(programId: string) {
    setGovernanceProgramId(programId);
    setGovernanceActivityId("");
  }

  function chooseProgramTemplate(templateId: string) {
    setProgramTemplateId(templateId);
    const template = governmentProgramTemplate(templateId);
    if (!template) {
      setProgramForm(emptyProgramForm());
      return;
    }
    setProgramForm({
      ...emptyProgramForm(),
      programCode: template.programCode,
      name: template.name,
      schemeKind: template.outcomeClass,
      jurisdiction: template.jurisdiction,
      administeringBody: template.administeringBody,
      officialSourceUrl: template.officialSourceUrl,
      officialSourceTitle: template.officialSourceTitle,
      officialSourceCheckedAt: GOVERNMENT_CATALOGUE_REVIEWED_ON,
    });
  }

  function chooseActivityTemplate(templateId: string) {
    setActivityTemplateId(templateId);
    const template = availableActivityTemplates.find(
      (activityTemplate) => activityTemplate.templateId === templateId,
    );
    if (!template || !selectedActivityProgram) {
      setActivityForm((current) => ({
        ...emptyActivityForm(),
        programId: current.programId,
        jurisdiction: selectedActivityProgram?.jurisdiction || "",
      }));
      return;
    }
    setActivityForm((current) => ({
      ...emptyActivityForm(),
      programId: current.programId,
      activityKey: template.activityKey,
      title: template.title,
      serviceCategory: template.serviceCategory,
      registryActivityCode: template.registryActivityCode,
      specificationPart: template.specificationPart,
      productCategory: template.productCategory,
      scenarioCode: template.scenarioCode,
      scenario: template.scenario,
      jurisdiction: selectedActivityProgram.jurisdiction,
      officialSourceUrl: selectedActivityProgram.officialSourceUrl,
      officialSourceTitle: selectedActivityProgram.officialSourceTitle,
      officialSourceCheckedAt: GOVERNMENT_CATALOGUE_REVIEWED_ON,
    }));
  }

  async function changeCaseStatus(
    nextStatus: (typeof CASE_STATUSES)[number],
  ) {
    setCaseStatus(nextStatus);
    setCaseQuery("");
    setBusy("cases");
    try {
      await loadCases({ status: nextStatus });
    } catch (error) {
      setCases([]);
      setCasePagination({ pageSize: 50, hasNext: false, nextCursor: "" });
      setNotice(workspaceMessage(error));
      setNoticeKind("error");
    } finally {
      setBusy("");
    }
  }

  async function refreshCases() {
    setBusy("cases");
    try {
      await loadCases({ status: caseStatus });
      setNotice("Case queue refreshed from the first page.");
      setNoticeKind("success");
    } catch (error) {
      setNotice(workspaceMessage(error));
      setNoticeKind("error");
    } finally {
      setBusy("");
    }
  }

  async function loadNextCases() {
    if (!casePagination.hasNext || !casePagination.nextCursor) return;
    setBusy("case-page");
    try {
      await loadCases({
        status: caseStatus,
        cursor: casePagination.nextCursor,
        append: true,
      });
    } catch (error) {
      setNotice(workspaceMessage(error));
      setNoticeKind("error");
    } finally {
      setBusy("");
    }
  }

  async function signInEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy === "auth") return;
    setBusy("auth");
    setNotice("Signing in...");
    setNoticeKind("info");
    try {
      await signInWithEmailAndPassword(
        firebaseAuth,
        email.trim().toLowerCase(),
        password,
      );
      setPassword("");
    } catch (error) {
      if (!captureMfaError(error)) setNotice(authMessage(error));
      setNoticeKind("error");
    } finally {
      setBusy("");
    }
  }

  async function signInGoogle() {
    if (busy === "auth") return;
    setBusy("auth");
    setNotice("Opening secure Google sign-in...");
    setNoticeKind("info");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(firebaseAuth, provider);
    } catch (error) {
      if (!captureMfaError(error)) setNotice(authMessage(error));
      setNoticeKind("error");
    } finally {
      setBusy("");
    }
  }

  async function resetPassword() {
    if (busy === "auth") return;
    const accountEmail = email.trim().toLowerCase();
    if (!accountEmail) {
      setNotice("Enter your compliance account email first.");
      setNoticeKind("error");
      return;
    }
    setBusy("auth");
    try {
      await sendPasswordResetEmail(firebaseAuth, accountEmail);
      setNotice("Password reset instructions have been sent.");
      setNoticeKind("success");
    } catch (error) {
      setNotice(authMessage(error));
      setNoticeKind("error");
    } finally {
      setBusy("");
    }
  }

  async function createProgram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("program");
    setNotice("Saving the draft program...");
    setNoticeKind("info");
    try {
      await api("/api/creditex/activities", {
        method: "POST",
        body: JSON.stringify({ action: "create_program", ...programForm }),
      });
      setProgramForm(emptyProgramForm());
      setProgramTemplateId("");
      await loadGovernance();
      setNotice("Draft program saved. Review its official source before publication.");
      setNoticeKind("success");
    } catch (error) {
      setNotice(workspaceMessage(error));
      setNoticeKind("error");
    } finally {
      setBusy("");
    }
  }

  async function createActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("activity");
    setNotice("Saving the draft activity version...");
    setNoticeKind("info");
    try {
      await api("/api/creditex/activities", {
        method: "POST",
        body: JSON.stringify({
          action: "create_activity",
          ...activityForm,
          version: Number(activityForm.version),
        }),
      });
      setActivityForm(emptyActivityForm());
      setActivityTemplateId("");
      setActivityHasEndDate(false);
      await loadGovernance();
      setNotice(
        "Draft activity version saved. It is not available to installers until publication.",
      );
      setNoticeKind("success");
    } catch (error) {
      setNotice(workspaceMessage(error));
      setNoticeKind("error");
    } finally {
      setBusy("");
    }
  }

  async function changePublishState(
    entity: "program" | "activity",
    id: string,
    action: "publish" | "withdraw",
  ) {
    const reason = window.prompt(
      action === "publish"
        ? "State why this exact source-backed record is ready for independent publication review."
        : "Record the emergency withdrawal reason. Existing case snapshots remain unchanged.",
    )?.trim();
    if (!reason) return;
    if (
      action === "withdraw"
      && !window.confirm(
        "Withdraw this governed record immediately? It cannot return to draft or published state.",
      )
    ) return;
    setBusy(`${action}:${entity}:${id}`);
    setNotice(
      action === "publish"
        ? `Sealing the ${entity} for independent review...`
        : `Withdrawing the ${entity}...`,
    );
    setNoticeKind("info");
    try {
      await api("/api/creditex/activities", {
        method: "POST",
        body: JSON.stringify({
          action: action === "publish"
            ? `request_${entity}_publication`
            : `withdraw_${entity}`,
          [`${entity}Id`]: id,
          ...(action === "publish"
            ? { requestReason: reason }
            : { reason }),
        }),
      });
      await loadGovernance();
      setGovernanceRefreshToken((current) => current + 1);
      setNotice(
        action === "publish"
          ? `${readable(entity)} sealed. A different named administrator must approve the unchanged snapshot before publication.`
          : `${readable(entity)} withdrawn. Existing case snapshots remain retained.`,
      );
      setNoticeKind("success");
    } catch (error) {
      setNotice(workspaceMessage(error));
      setNoticeKind("error");
    } finally {
      setBusy("");
    }
  }

  async function deleteDraft(
    entity: "program" | "activity",
    id: string,
  ) {
    const warning = entity === "program"
      ? "Permanently delete this draft program? Deletion is allowed only when it has no activity versions. This cannot be undone."
      : "Permanently delete this draft activity version? Only an unpublished draft can be deleted. This cannot be undone.";
    if (!window.confirm(warning)) return;
    setBusy(`delete:${entity}:${id}`);
    setNotice(`Deleting the draft ${entity}...`);
    setNoticeKind("info");
    try {
      await api("/api/creditex/activities", {
        method: "POST",
        body: JSON.stringify({
          action: `delete_draft_${entity}`,
          [`${entity}Id`]: id,
        }),
      });
      if (entity === "program") {
        setActivityForm((current) => current.programId === id
          ? { ...current, programId: "" }
          : current);
      }
      await loadGovernance();
      setNotice(`Draft ${entity} deleted.`);
      setNoticeKind("success");
    } catch (error) {
      setNotice(workspaceMessage(error));
      setNoticeKind("error");
    } finally {
      setBusy("");
    }
  }

  const primaryTabs: { id: WorkspaceTab; label: string }[] = [
    { id: "cases", label: "Jobs" },
    { id: "operations", label: "Cases" },
    { id: "submissions", label: "Submissions" },
  ];
  const toolsTabs: { id: WorkspaceTab; label: string }[] = [
    ...(canOpenQuestionnaires ? [{ id: "compliance-questions" as const, label: "Training" }] : []),
    { id: "forms", label: "Activity forms" },
  ];
  const reviewTabs: { id: WorkspaceTab; label: string }[] = [
    ...(canReviewTraining ? [{ id: "onboarding" as const, label: "Trade onboarding" }] : []),
    { id: "sources", label: "Official sources" },
    ...(session?.role === "admin" ? [{ id: "governance" as const, label: "Government rules" }] : []),
    ...(session?.role === "admin" ? [{ id: "team" as const, label: "Team access" }] : []),
  ];
  const visibleTabs = [...primaryTabs, ...toolsTabs, ...reviewTabs];

  function handleWorkspaceTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const currentIndex = visibleTabs.findIndex((item) => item.id === tab);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? visibleTabs.length - 1
        : ["ArrowDown", "ArrowRight"].includes(event.key)
          ? (currentIndex + 1) % visibleTabs.length
          : (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;
    const nextTab = visibleTabs[nextIndex].id;
    if (!selectTab(nextTab)) return;
    window.requestAnimationFrame(() => {
      document.getElementById(`creditex-tab-${nextTab}`)?.focus();
    });
  }

  if (resolver) return <main className={styles.shell}><FirebaseMfaChallenge resolver={resolver} onCancel={clearMfaChallenge} onComplete={clearMfaChallenge} /></main>;
  if (user && mfaRequired) return <main className={styles.shell}><FirebaseAccountSecurity key={user.uid} user={user} onComplete={async () => { setMfaRequired(false); await loadWorkspace(); }} /><p style={{ textAlign: "center" }}><button type="button" onClick={() => void signOut(firebaseAuth)}>Sign out</button></p></main>;

  if (!authReady || (user && loading)) {
    return (
      <main className={styles.shell} id="site-content">
        <div className={styles.loading} role="status">
          {loadingMessage}
        </div>
      </main>
    );
  }

  if (!user || !session) {
    return (
      <main className={styles.shell} id="site-content">
        <div className={styles.signInWrap}>
          <section className={styles.signInCard} aria-labelledby="creditex-sign-in-title">
            <div className={styles.signInIntro}>
              <div className={styles.brand}>
                <Image
                  src="/tlink-icon-192.png"
                  alt=""
                  aria-hidden="true"
                  width={48}
                  height={48}
                />
                <div>
                  <strong>TLink</strong>
                  <span>Creditex compliance</span>
                </div>
              </div>
              <h1>Controlled compliance operations</h1>
              <p>
                Review privacy-minimised queues, open audited full case records
                and govern official program activity versions. Access is limited
                to pre-approved, active Creditex memberships with a verified
                Firebase identity.
              </p>
            </div>
            <form
              className={styles.signInForm}
              onSubmit={signInEmail}
              aria-busy={busy === "auth"}
            >
              <h2 id="creditex-sign-in-title">Sign in</h2>
              <p>
                Use the email already assigned to your compliance membership.
                There is no public registration on this portal.
              </p>
              {user ? (
                <>
                  <p>
                    Firebase is signed in as {user.email || "an account"}, but
                    the protected Creditex workspace did not open.
                  </p>
                  <button
                    className={styles.button}
                    type="button"
                    onClick={() => void loadWorkspace()}
                  >
                    Retry workspace
                  </button>
                  <button
                    className={styles.textButton}
                    type="button"
                    onClick={() => void signOut(firebaseAuth)}
                  >
                    Sign out this Firebase account
                  </button>
                </>
              ) : (
                <>
                  <label>
                    Email
                    <input
                      className={styles.input}
                      type="email"
                      autoComplete="username"
                      required
                      disabled={busy === "auth"}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </label>
                  <label>
                    Password
                    <input
                      className={styles.input}
                      type="password"
                      autoComplete="current-password"
                      required
                      disabled={busy === "auth"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </label>
                  <button
                    className={styles.button}
                    type="submit"
                    disabled={busy === "auth"}
                  >
                    {busy === "auth" ? "Signing in..." : "Sign in securely"}
                  </button>
                  <button
                    className={styles.textButton}
                    type="button"
                    disabled={busy === "auth"}
                    onClick={resetPassword}
                  >
                    Reset password
                  </button>
                  <div className={styles.divider}>or</div>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={busy === "auth"}
                    onClick={signInGoogle}
                  >
                    Continue with Google
                  </button>
                </>
              )}
              {notice && (
                <p
                  className={styles.status}
                  data-kind={noticeKind}
                  role={noticeKind === "error" ? "alert" : "status"}
                >
                  {notice}
                </p>
              )}
            </form>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main
      className={styles.shell}
      id="site-content"
    >
      <div className={styles.frame}>
        <aside className={styles.sidebar} aria-label="Creditex navigation">
          <div className={styles.brand}>
            <Image
              src="/tlink-icon-192.png"
              alt=""
              aria-hidden="true"
              width={42}
              height={42}
            />
            <div>
              <h1>Creditex</h1>
              <span>TLink partner workspace</span>
            </div>
          </div>
          <label className={styles.mobileNavigation}>
            Workspace
            <select value={tab} onChange={(event) => {
              const next = visibleTabs.find((item) => item.id === event.target.value);
              if (next) selectTab(next.id);
            }}>
              {visibleTabs.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <nav className={styles.tabs} aria-label="Creditex workspace" role="tablist" aria-orientation="vertical">
            <div className={styles.navGroup} role="presentation">
              <span className={styles.groupLabel}>Work</span>
              {primaryTabs.map((item) => <button key={item.id} className={styles.tab} type="button" role="tab" id={`creditex-tab-${item.id}`} aria-controls={`creditex-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => selectTab(item.id)} onKeyDown={handleWorkspaceTabKeyDown}><WorkspaceIcon tab={item.id} /><span>{item.label}</span></button>)}
            </div>
            <div className={styles.navGroup} role="presentation">
              <span className={styles.groupLabel}>Training &amp; forms</span>
              {toolsTabs.map((item) => <button key={item.id} className={styles.tab} type="button" role="tab" id={`creditex-tab-${item.id}`} aria-controls={`creditex-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => selectTab(item.id)} onKeyDown={handleWorkspaceTabKeyDown}><WorkspaceIcon tab={item.id} /><span>{item.label}</span></button>)}
            </div>
            <div className={styles.navGroup} role="presentation">
              <span className={styles.groupLabel}>Management</span>
              {reviewTabs.map((item) => <button key={item.id} className={styles.tab} type="button" role="tab" id={`creditex-tab-${item.id}`} aria-controls={`creditex-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => selectTab(item.id)} onKeyDown={handleWorkspaceTabKeyDown}><WorkspaceIcon tab={item.id} /><span>{item.label}</span></button>)}
            </div>
          </nav>
          <div className={styles.railFooter}>
            <span>Partner workspace</span>
            <strong>{session.organisation.tradingName || session.organisation.legalName}</strong>
          </div>
        </aside>
        <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.workspaceContext}>
            <span>Creditex workspace</span>
            <strong>{visibleTabs.find((item) => item.id === tab)?.label}</strong>
          </div>
          <div className={styles.identity}>
            <div>
              <strong>
                {session.displayName || session.email} | {readable(session.role)}
              </strong>
              <span>
                {session.organisation.tradingName ||
                  session.organisation.legalName}
              </span>
            </div>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => void signOut(firebaseAuth)}
            >
              Sign out
            </button>
          </div>
        </header>
        <div className={styles.content}>
        {!["cases", "operations", "submissions", "forms", "compliance-questions", "team"].includes(tab) && (
          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <h1>
                {tab === "sources"
                  ? "Official sources"
                  : tab === "onboarding"
                    ? "Business and training review"
                  : tab === "governance"
                    ? "Government rules"
                    : "Compliance case control"}
              </h1>
              <p>
                {tab === "sources"
                  ? "Find government sources, review retained documents and track publication changes."
                  : tab === "onboarding"
                    ? "Review trade applications, agreements and staff training in one place."
                  : tab === "governance"
                    ? "Manage published programs, activities, effective dates and evidence requirements."
                    : "Queue lists minimise private data. Authorised Creditex staff can open the audited case workspace for the customer, installer, site, appointments, evidence originals and captured metadata needed to review, correct and submit that exact job."}
              </p>
            </div>
            <details className={styles.guardrail}>
              <summary>About publication and case decisions</summary>
              <p>
                Activity publication records source provenance and effective
                dates. It does not make a financial, technical or regulator
                decision for a case.
              </p>
            </details>
          </section>
        )}

        {notice && (
          <p
            className={styles.status}
            data-kind={noticeKind}
            role={noticeKind === "error" ? "alert" : "status"}
          >
            {notice}
          </p>
        )}

        {tab === "cases" && (
          <div
            id="creditex-panel-cases"
            role="tabpanel"
            aria-labelledby="creditex-tab-cases"
          >
            {session.role === "admin" && user && <CreditexVoiceSetupPanel user={user} />}
            <CreditexPlannedIntakeQueue api={api} />
          </div>
        )}

        {tab === "operations" && (
          <div id="creditex-panel-operations" role="tabpanel" aria-labelledby="creditex-tab-operations">
            <CreditexOperationsWorkspace
              session={session}
              seedCases={visibleCases}
              seedPagination={casePagination}
              seedStatus={caseStatus}
              seedStatusOptions={CASE_STATUSES}
              seedLoadNextLabel={`Load next ${casePagination.pageSize}`}
              seedBusy={busy === "cases" || busy === "case-page"}
              onSeedStatusChange={(status) =>
                void changeCaseStatus(
                  status as (typeof CASE_STATUSES)[number],
                )}
              onRefreshSeedCases={() => void refreshCases()}
              onLoadNextSeedCases={() => void loadNextCases()}
              onOpenActivityRules={() =>
                selectTab(session.role === "admin" ? "governance" : "sources")}
            />
          </div>
        )}

        {tab === "sources" && (
          <section
            className={`${styles.panel} ${styles.governancePanel}`}
            id="creditex-panel-sources"
            role="tabpanel"
            aria-labelledby="creditex-tab-sources"
          >
            <CreditexOfficialSourceWorkbench
              api={api}
              canCapture={
                session.role === "admin"
                || session.role === "case_manager"
              }
              canReview={
                session.role === "admin"
                && session.governanceIdentityVerified
              }
              onDownload={downloadOfficialSource}
            />
          </section>
        )}

        {tab === "forms" && (
          <section
            className={`${styles.panel} ${styles.governancePanel}`}
            id="creditex-panel-forms"
            role="tabpanel"
            aria-labelledby="creditex-tab-forms"
          >
            <CreditexActivityWorkPackGovernance
              api={api}
              endpoint="/api/creditex/work-packs"
              sourceEndpoint="/api/creditex/official-sources"
              sourceBatchEndpoint="/api/creditex/official-sources/batch-import"
              canCaptureSource={["admin", "case_manager"].includes(session.role)}
              fieldMasterCanAuthor={session.canEditFieldMasters}
              onManageFormAccess={session.role === "admin" ? () => selectTab("team") : undefined}
              onFieldFormDirtyChange={reportFieldFormDirty}
              onDownloadSource={downloadOfficialSource}
              contextLabel="Creditex"
            />
          </section>
        )}

        {tab === "team" && session.role === "admin" && (
          <section className={styles.panel} id="creditex-panel-team" role="tabpanel" aria-labelledby="creditex-tab-team">
            <CreditexTeamAccess session={session} onSessionChanged={loadWorkspace} />
          </section>
        )}

        {tab === "submissions" && (
          <section
            className={styles.panel}
            id="creditex-panel-submissions"
            role="tabpanel"
            aria-labelledby="creditex-tab-submissions"
          >
            <CreditexRegistryWorkspace
              api={api}
              endpoint={registryEndpoint}
              outputEndpoint={outputEndpoint}
            >
              <CreditexOutputActions
                api={api}
                endpoint={outputEndpoint}
                contextLabel={usePlatformSubmissionAccess ? "Australian Energy Assessments administration" : "Creditex compliance"}
              />
            </CreditexRegistryWorkspace>
          </section>
        )}

        {tab === "onboarding" && user && canReviewTraining && <section className={`${styles.panel} ${styles.governancePanel}`} id="creditex-panel-onboarding" role="tabpanel" aria-labelledby="creditex-tab-onboarding"><CreditexOnboardingReviewWorkspace api={api} user={user} canReview={canReviewTraining} /></section>}
        {tab === "compliance-questions" && canOpenQuestionnaires && <section className={`${styles.panel} ${styles.governancePanel}`} id="creditex-panel-compliance-questions" role="tabpanel" aria-labelledby="creditex-tab-compliance-questions"><TrainingQuestionnaireEditor api={api} canEdit={canOpenQuestionnaires} onDirtyChange={reportQuestionnaireDirty} /></section>}

        {tab === "governance" && session.role === "admin" && (
          <section
            className={`${styles.panel} ${styles.governancePanel}`}
            id="creditex-panel-governance"
            role="tabpanel"
            aria-labelledby="creditex-tab-governance"
          >
            <header className={styles.panelHeader}>
              <div>
                <h2 id="governance-title">Program and activity governance</h2>
                <p>
                  Admin-only control for effective-dated records backed by an
                  official source.
                </p>
              </div>
            </header>

            <section
              className={styles.governanceScope}
              aria-labelledby="governance-scope-title"
            >
              <div>
                <span>ACTIVE PROGRAM WORKSPACE</span>
                <h3 id="governance-scope-title">
                  {selectedGovernanceProgram
                    ? `${selectedGovernanceProgram.programCode} | ${selectedGovernanceProgram.name}`
                    : "No governed program selected"}
                </h3>
                <p>
                  Program and activity tabs keep every government-source
                  version and evidence decision separated. Creditex verifies
                  the operational transcription but does not author the rule.
                </p>
              </div>
              <label>
                Activity version
                <select
                  className={styles.select}
                  value={effectiveGovernanceActivityId}
                  disabled={!governanceProgramActivities.length}
                  onChange={(event) =>
                    setGovernanceActivityId(event.target.value)}
                >
                  <option value="">All activities in this program</option>
                  {governanceProgramActivities.map((activity) => (
                    <option key={activity.id} value={activity.id}>
                      {activity.registryActivityCode || activity.activityKey}
                      {" "}| Version {activity.version} | {activity.title}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            <section
              className={styles.cataloguePanel}
              aria-labelledby="government-catalogue-title"
            >
              <div className={styles.catalogueHeader}>
                <div>
                  <span className={styles.eyebrow}>OFFICIAL DISCOVERY CATALOGUE</span>
                  <h3 id="government-catalogue-title">
                    Australian government program pathways
                  </h3>
                  <p>
                    Reviewed {dateOnly(GOVERNMENT_CATALOGUE_REVIEWED_ON)}.
                    These controlled templates separate certificates, retailer
                    obligations, rebates, grants, loans, tariffs and specialist
                    project pathways. A template is not an activated rule.
                  </p>
                </div>
                <div className={styles.catalogueSummary}>
                  <strong>{GOVERNMENT_PROGRAM_TEMPLATES.length}</strong>
                  <span>program pathways</span>
                  <strong>{GOVERNMENT_ACTIVITY_TEMPLATES.length}</strong>
                  <span>activity templates</span>
                </div>
              </div>
              <div className={styles.catalogueGrid}>
                {catalogueByJurisdiction.map((group) => (
                  <section key={group.jurisdiction}>
                    <h4>
                      {group.jurisdiction === "AU"
                        ? "Australia-wide"
                        : group.jurisdiction}
                    </h4>
                    <div>
                      {group.programs.map((program) => {
                        const activityCount = governmentActivityTemplates(
                          program.programCode,
                        ).length;
                        return (
                          <article key={program.templateId}>
                            <div>
                              <strong>{program.programCode}</strong>
                              <span data-state={program.catalogueState}>
                                {readable(program.catalogueState)}
                              </span>
                            </div>
                            <h5>{program.name}</h5>
                            <p>
                              {readable(program.outcomeClass)}
                              {" | "}
                              {activityCount} controlled{" "}
                              {activityCount === 1 ? "activity" : "activities"}
                            </p>
                            <p>{program.operatingNote}</p>
                            <a
                              href={program.officialSourceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open official source
                            </a>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
              <p className={styles.catalogueCaveat}>
                Before publication, a named administrator must capture the
                exact effective instrument, source version, dates, content hash,
                evidence policy and any Creditex accreditation or connector
                restriction. Closed, future, limited and specialist routes stay
                unavailable to installers unless independently verified.
              </p>
            </section>

            <div className={styles.governanceGrid}>
              <section className={styles.formCard}>
                <h3>Create draft program</h3>
                <p>
                  Draft first, verify the source, then use the explicit publish
                  action below.
                </p>
                <form className={styles.formGrid} onSubmit={createProgram}>
                  <label className={styles.wide}>
                    Government program template
                    <select
                      className={styles.select}
                      value={programTemplateId}
                      onChange={(event) =>
                        chooseProgramTemplate(event.target.value)}
                    >
                      <option value="">Start from a controlled template</option>
                      {AUSTRALIAN_JURISDICTIONS.map((jurisdiction) => {
                        const templates = GOVERNMENT_PROGRAM_TEMPLATES.filter(
                          (program) => program.jurisdiction === jurisdiction,
                        );
                        return templates.length ? (
                          <optgroup
                            key={jurisdiction}
                            label={
                              jurisdiction === "AU"
                                ? "Australia-wide"
                                : jurisdiction
                            }
                          >
                            {templates.map((program) => (
                              <option
                                key={program.templateId}
                                value={program.templateId}
                              >
                                {program.programCode} | {program.name} |{" "}
                                {readable(program.outcomeClass)}
                              </option>
                            ))}
                          </optgroup>
                        ) : null;
                      })}
                    </select>
                  </label>
                  {selectedProgramTemplate && (
                    <div className={`${styles.templateNotice} ${styles.wide}`}>
                      <strong>
                        {readable(selectedProgramTemplate.catalogueState)} source
                        template
                      </strong>
                      <p>{selectedProgramTemplate.operatingNote}</p>
                      <p>
                        Template values are a research starting point. Add the
                        exact source version and SHA-256 before saving a draft.
                      </p>
                    </div>
                  )}
                  <label>
                    Program code
                    <input
                      className={styles.input}
                      required
                      maxLength={60}
                      value={programForm.programCode}
                      onChange={(event) =>
                        setProgramForm((current) => ({
                          ...current,
                          programCode: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Jurisdiction
                    <select
                      className={styles.select}
                      required
                      value={programForm.jurisdiction}
                      onChange={(event) =>
                        setProgramForm((current) => ({
                          ...current,
                          jurisdiction: event.target.value,
                        }))
                      }
                    >
                      <option value="">Choose a jurisdiction</option>
                      {AUSTRALIAN_JURISDICTIONS.map((jurisdiction) => (
                        <option key={jurisdiction} value={jurisdiction}>
                          {jurisdiction === "AU" ? "Australia-wide" : jurisdiction}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.wide}>
                    Program name
                    <input
                      className={styles.input}
                      required
                      maxLength={180}
                      value={programForm.name}
                      onChange={(event) =>
                        setProgramForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Outcome class
                    <select
                      className={styles.select}
                      required
                      value={programForm.schemeKind}
                      onChange={(event) =>
                        setProgramForm((current) => ({
                          ...current,
                          schemeKind: event.target.value,
                        }))
                      }
                    >
                      <option value="">Choose the government outcome</option>
                      {COMPLIANCE_OUTCOME_CLASSES.map((outcomeClass) => (
                        <option key={outcomeClass} value={outcomeClass}>
                          {readable(outcomeClass)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Administering body
                    <input
                      className={styles.input}
                      required
                      maxLength={180}
                      value={programForm.administeringBody}
                      onChange={(event) =>
                        setProgramForm((current) => ({
                          ...current,
                          administeringBody: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className={styles.wide}>
                    Official source URL
                    <input
                      className={styles.input}
                      type="url"
                      required
                      value={programForm.officialSourceUrl}
                      onChange={(event) =>
                        setProgramForm((current) => ({
                          ...current,
                          officialSourceUrl: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className={styles.wide}>
                    Official source title
                    <input
                      className={styles.input}
                      required
                      maxLength={240}
                      value={programForm.officialSourceTitle}
                      onChange={(event) =>
                        setProgramForm((current) => ({
                          ...current,
                          officialSourceTitle: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Source version
                    <input
                      className={styles.input}
                      maxLength={100}
                      value={programForm.officialSourceVersion}
                      onChange={(event) =>
                        setProgramForm((current) => ({
                          ...current,
                          officialSourceVersion: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Source checked date
                    <input
                      className={styles.input}
                      type="date"
                      required
                      value={programForm.officialSourceCheckedAt}
                      onChange={(event) =>
                        setProgramForm((current) => ({
                          ...current,
                          officialSourceCheckedAt: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className={styles.wide}>
                    Source SHA-256
                    <input
                      className={styles.input}
                      required
                      minLength={64}
                      maxLength={64}
                      pattern="[0-9a-fA-F]{64}"
                      value={programForm.officialSourceSha256}
                      onChange={(event) =>
                        setProgramForm((current) => ({
                          ...current,
                          officialSourceSha256: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <button
                    className={`${styles.button} ${styles.wide}`}
                    type="submit"
                    disabled={busy === "program"}
                  >
                    Save draft program
                  </button>
                </form>
              </section>

              <section className={styles.formCard}>
                <h3>Create draft activity version</h3>
                <p>
                  Keep registry code, specification part, product category and
                  scenario in separate fields.
                </p>
                <form className={styles.formGrid} onSubmit={createActivity}>
                  <label className={styles.wide}>
                    Program
                    <select
                      className={styles.select}
                      required
                      value={activityForm.programId}
                      onChange={(event) => {
                        const selected = programs.find(
                          (program) => program.id === event.target.value,
                        );
                        setActivityTemplateId("");
                        setActivityHasEndDate(false);
                        setActivityForm({
                          ...emptyActivityForm(),
                          programId: event.target.value,
                          jurisdiction: selected?.jurisdiction || "",
                        });
                      }}
                    >
                      <option value="">Choose a program</option>
                      {programs
                        .filter((program) => program.publishState !== "withdrawn")
                        .map((program) => (
                          <option key={program.id} value={program.id}>
                            {program.programCode} · {program.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className={styles.wide}>
                    Government activity template
                    <select
                      className={styles.select}
                      value={activityTemplateId}
                      disabled={!activityForm.programId}
                      onChange={(event) =>
                        chooseActivityTemplate(event.target.value)}
                    >
                      <option value="">
                        {activityForm.programId
                          ? availableActivityTemplates.length
                            ? "Choose a controlled activity"
                            : "No controlled activity template is available"
                          : "Choose a program first"}
                      </option>
                      {availableActivityTemplates.map((activityTemplate) => (
                        <option
                          key={activityTemplate.templateId}
                          value={activityTemplate.templateId}
                          disabled={
                            activityTemplate.catalogueState === "closed"
                            || activityTemplate.catalogueState === "future"
                          }
                        >
                          {activityTemplate.registryActivityCode} |{" "}
                          {activityTemplate.title} |{" "}
                          {readable(activityTemplate.catalogueState)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedActivityTemplate && (
                    <div className={`${styles.templateNotice} ${styles.wide}`}>
                      <strong>
                        {selectedActivityTemplate.registryActivityCode} |{" "}
                        {readable(selectedActivityTemplate.catalogueState)}
                      </strong>
                      <p>
                        Confirm the exact official product category, scenario,
                        effective dates, source version and evidence requirements.
                        This selection does not calculate or create an outcome.
                      </p>
                    </div>
                  )}
                  <label>
                    Activity key
                    <input
                      className={styles.input}
                      required
                      maxLength={100}
                      value={activityForm.activityKey}
                      onChange={(event) =>
                        setActivityForm((current) => ({
                          ...current,
                          activityKey: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Version
                    <input
                      className={styles.input}
                      type="number"
                      required
                      min={1}
                      step={1}
                      value={activityForm.version}
                      onChange={(event) =>
                        setActivityForm((current) => ({
                          ...current,
                          version: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className={styles.wide}>
                    Activity title
                    <input
                      className={styles.input}
                      required
                      maxLength={220}
                      value={activityForm.title}
                      onChange={(event) =>
                        setActivityForm((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Service category
                    <select
                      className={styles.select}
                      value={activityForm.serviceCategory}
                      onChange={(event) =>
                        setActivityForm((current) => ({
                          ...current,
                          serviceCategory: event.target.value,
                        }))
                      }
                    >
                      {SERVICE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {readable(category)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Jurisdiction
                    <select
                      className={styles.select}
                      required
                      value={activityForm.jurisdiction}
                      onChange={(event) =>
                        setActivityForm((current) => ({
                          ...current,
                          jurisdiction: event.target.value,
                        }))
                      }
                    >
                      <option value="">Choose a jurisdiction</option>
                      {AUSTRALIAN_JURISDICTIONS.map((jurisdiction) => (
                        <option key={jurisdiction} value={jurisdiction}>
                          {jurisdiction === "AU" ? "Australia-wide" : jurisdiction}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Registry activity code
                    <input
                      className={styles.input}
                      maxLength={80}
                      value={activityForm.registryActivityCode}
                      onChange={(event) =>
                        setActivityForm((current) => ({
                          ...current,
                          registryActivityCode: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Specification part
                    <input
                      className={styles.input}
                      maxLength={80}
                      value={activityForm.specificationPart}
                      onChange={(event) =>
                        setActivityForm((current) => ({
                          ...current,
                          specificationPart: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Product category
                    <input
                      className={styles.input}
                      required
                      maxLength={160}
                      value={activityForm.productCategory}
                      onChange={(event) =>
                        setActivityForm((current) => ({
                          ...current,
                          productCategory: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Scenario code
                    <input
                      className={styles.input}
                      maxLength={80}
                      value={activityForm.scenarioCode}
                      onChange={(event) =>
                        setActivityForm((current) => ({
                          ...current,
                          scenarioCode: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className={styles.wide}>
                    Scenario
                    <textarea
                      className={styles.textarea}
                      required
                      maxLength={2000}
                      value={activityForm.scenario}
                      onChange={(event) =>
                        setActivityForm((current) => ({
                          ...current,
                          scenario: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Effective from
                    <input
                      className={styles.input}
                      type="date"
                      required
                      value={activityForm.effectiveFrom}
                      data-date-range-group={
                        activityHasEndDate
                          ? "creditex-activity-effective"
                          : undefined
                      }
                      data-date-range-role={
                        activityHasEndDate ? "start" : undefined
                      }
                      onChange={(event) =>
                        setActivityForm((current) => ({
                          ...current,
                          effectiveFrom: event.target.value,
                        }))
                      }
                    />
                  </label>
                  {activityHasEndDate ? (
                    <label>
                      Effective to
                      <input
                        className={styles.input}
                        type="date"
                        min={activityForm.effectiveFrom}
                        value={activityForm.effectiveTo}
                        data-date-range-group="creditex-activity-effective"
                        data-date-range-role="end"
                        onChange={(event) =>
                          setActivityForm((current) => ({
                            ...current,
                            effectiveTo: event.target.value,
                          }))
                        }
                      />
                    </label>
                  ) : (
                    <div>
                      <span className={styles.label}>Effective to</span>
                      <button
                        className={styles.textButton}
                        type="button"
                        onClick={() => setActivityHasEndDate(true)}
                      >
                        Add an end date
                      </button>
                    </div>
                  )}
                  {activityHasEndDate && (
                    <button
                      className={`${styles.textButton} ${styles.wide}`}
                      type="button"
                      onClick={() => {
                        setActivityHasEndDate(false);
                        setActivityForm((current) => ({
                          ...current,
                          effectiveTo: "",
                        }));
                      }}
                    >
                      Keep this version open ended
                    </button>
                  )}
                  <label className={styles.wide}>
                    Official source URL
                    <input
                      className={styles.input}
                      type="url"
                      required
                      value={activityForm.officialSourceUrl}
                      onChange={(event) =>
                        setActivityForm((current) => ({
                          ...current,
                          officialSourceUrl: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className={styles.wide}>
                    Official source title
                    <input
                      className={styles.input}
                      required
                      maxLength={240}
                      value={activityForm.officialSourceTitle}
                      onChange={(event) =>
                        setActivityForm((current) => ({
                          ...current,
                          officialSourceTitle: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Source version
                    <input
                      className={styles.input}
                      maxLength={100}
                      value={activityForm.officialSourceVersion}
                      onChange={(event) =>
                        setActivityForm((current) => ({
                          ...current,
                          officialSourceVersion: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Source checked date
                    <input
                      className={styles.input}
                      type="date"
                      required
                      value={activityForm.officialSourceCheckedAt}
                      onChange={(event) =>
                        setActivityForm((current) => ({
                          ...current,
                          officialSourceCheckedAt: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className={styles.wide}>
                    Source SHA-256
                    <input
                      className={styles.input}
                      required
                      minLength={64}
                      maxLength={64}
                      pattern="[0-9a-fA-F]{64}"
                      value={activityForm.officialSourceSha256}
                      onChange={(event) =>
                        setActivityForm((current) => ({
                          ...current,
                          officialSourceSha256: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className={styles.wide}>
                    Requirements snapshot JSON
                    <textarea
                      className={styles.textarea}
                      required
                      spellCheck={false}
                      value={activityForm.requirementsSnapshot}
                      onChange={(event) =>
                        setActivityForm((current) => ({
                          ...current,
                          requirementsSnapshot: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <button
                    className={`${styles.button} ${styles.wide}`}
                    type="submit"
                    disabled={busy === "activity"}
                  >
                    Save draft activity version
                  </button>
                </form>
              </section>
            </div>

            <p className={styles.warning}>
              Publication requires a second named administrator reviewing the
              exact sealed snapshot. It controls catalogue availability only
              and does not authorise an installation outcome. Emergency
              withdrawal remains immediate, audited and irreversible.
            </p>
            {!canRequestPublication && (
              <p className={styles.warning}>
                This shared account may administer drafts but cannot request
                or approve publication. Invite at least two named Creditex
                administrators to operate the independent publication
                controls.
              </p>
            )}

            <CreditexEvidencePolicyGovernance
              key={`${selectedGovernanceProgram?.id || "none"}:${
                effectiveGovernanceActivityId || "all"
              }`}
              api={api}
              activities={visibleGovernanceActivities}
              programs={
                selectedGovernanceProgram ? [selectedGovernanceProgram] : []
              }
              selectedProgramId={selectedGovernanceProgram?.id || ""}
              selectedActivityVersionId={effectiveGovernanceActivityId}
              refreshToken={governanceRefreshToken}
              onChanged={loadGovernance}
              canRequestPublication={canRequestPublication}
            />

            <section className={styles.formCard}>
              <h3>Selected program</h3>
              <div className={styles.records}>
                {(selectedGovernanceProgram
                  ? [selectedGovernanceProgram]
                  : []
                ).map((program) => (
                  <article className={styles.record} key={program.id}>
                    <div>
                      <h4>
                        {program.programCode} · {program.name}
                      </h4>
                      <p>
                        {program.jurisdiction} · {program.administeringBody} ·{" "}
                        {readable(program.publishState)}
                      </p>
                      <p>
                        Source checked {dateOnly(program.officialSourceCheckedAt)}
                        {program.officialSourceVersion
                          ? ` · ${program.officialSourceVersion}`
                          : ""}
                      </p>
                    </div>
                    <div className={styles.recordActions}>
                      <a
                        className={styles.textButton}
                        href={program.officialSourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Official source
                      </a>
                      {program.publishState === "draft" && (
                        <>
                          <button
                            className={styles.button}
                            type="button"
                            disabled={
                              Boolean(busy)
                              || !canRequestPublication
                              || Boolean(program.pendingPublicationRequestId)
                            }
                            onClick={() =>
                              void changePublishState(
                                "program",
                                program.id,
                                "publish",
                              )
                            }
                          >
                            {program.pendingPublicationRequestId
                              ? "Waiting for review"
                              : "Request publication"}
                          </button>
                          <button
                            className={styles.dangerButton}
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void deleteDraft("program", program.id)
                            }
                          >
                            Delete draft
                          </button>
                        </>
                      )}
                      {program.publishState === "published" && (
                        <button
                          className={styles.dangerButton}
                          type="button"
                          disabled={
                            Boolean(busy) || !canRequestPublication
                          }
                          onClick={() =>
                            void changePublishState(
                              "program",
                              program.id,
                              "withdraw",
                            )
                          }
                        >
                          Withdraw
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {!selectedGovernanceProgram && (
                  <div className={styles.empty}>No governed programs yet.</div>
                )}
              </div>
            </section>

            <section className={styles.formCard}>
              <h3>
                {effectiveGovernanceActivityId
                  ? "Selected activity version"
                  : "Activity versions in this program"}
              </h3>
              <div className={styles.records}>
                {visibleGovernanceActivities.map((activity) => (
                  <article className={styles.record} key={activity.id}>
                    <div>
                      <h4>
                        {activity.programCode} ·{" "}
                        {activity.registryActivityCode || activity.activityKey} ·
                        Version {activity.version}
                      </h4>
                      <p>
                        {activity.title} · {activity.productCategory} ·{" "}
                        {readable(activity.publishState)}
                      </p>
                      <p>
                        Effective {dateOnly(activity.effectiveFrom)} to{" "}
                        {dateOnly(activity.effectiveTo)} · Source checked{" "}
                        {dateOnly(activity.officialSourceCheckedAt)}
                      </p>
                    </div>
                    <div className={styles.recordActions}>
                      <a
                        className={styles.textButton}
                        href={activity.officialSourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Official source
                      </a>
                      {activity.publishState === "draft" && (
                        <>
                          <button
                            className={styles.button}
                            type="button"
                            disabled={
                              Boolean(busy)
                              || !canRequestPublication
                              || Boolean(activity.pendingPublicationRequestId)
                            }
                            onClick={() =>
                              void changePublishState(
                                "activity",
                                activity.id,
                                "publish",
                              )
                            }
                          >
                            {activity.pendingPublicationRequestId
                              ? "Waiting for review"
                              : "Request publication"}
                          </button>
                          <button
                            className={styles.dangerButton}
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void deleteDraft("activity", activity.id)
                            }
                          >
                            Delete draft
                          </button>
                        </>
                      )}
                      {activity.publishState === "published" && (
                        <button
                          className={styles.dangerButton}
                          type="button"
                          disabled={
                            Boolean(busy) || !canRequestPublication
                          }
                          onClick={() =>
                            void changePublishState(
                              "activity",
                              activity.id,
                              "withdraw",
                            )
                          }
                        >
                          Withdraw
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {!visibleGovernanceActivities.length && (
                  <div className={styles.empty}>
                    No governed activity versions in this program.
                  </div>
                )}
              </div>
            </section>

            <nav
              className={styles.governanceProgramTabs}
              aria-label="Governance program and activity workspaces"
            >
              <span>Programs</span>
              <div>
                {programs.map((program) => {
                  const selected = program.id === selectedGovernanceProgram?.id;
                  return (
                    <button
                      key={program.id}
                      type="button"
                      aria-pressed={selected}
                      data-selected={selected}
                      onClick={() => chooseGovernanceProgram(program.id)}
                    >
                      <strong>{program.programCode}</strong>
                      <small>{program.name}</small>
                    </button>
                  );
                })}
                {!programs.length && (
                  <small>No governed programs have been created.</small>
                )}
              </div>
              {selectedGovernanceProgram && (
                <>
                  <span>Activities</span>
                  <div>
                    <button
                      type="button"
                      aria-pressed={!effectiveGovernanceActivityId}
                      data-selected={!effectiveGovernanceActivityId}
                      onClick={() => setGovernanceActivityId("")}
                    >
                      <strong>All activities</strong>
                      <small>{governanceProgramActivities.length} versions</small>
                    </button>
                    {governanceProgramActivities.map((activity) => {
                      const selected =
                        activity.id === effectiveGovernanceActivityId;
                      return (
                        <button
                          key={activity.id}
                          type="button"
                          aria-pressed={selected}
                          data-selected={selected}
                          onClick={() =>
                            setGovernanceActivityId(activity.id)}
                        >
                          <strong>
                            {activity.registryActivityCode
                              || activity.activityKey}
                          </strong>
                          <small>
                            {activity.title} | version {activity.version}
                          </small>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </nav>
          </section>
        )}
        </div>
        </div>
      </div>
    </main>
  );
}
