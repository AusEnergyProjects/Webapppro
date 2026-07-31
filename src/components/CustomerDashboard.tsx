"use client";

/* eslint-disable @next/next/no-html-link-for-pages */

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  onAuthStateChanged,
  sendEmailVerification,
  signOut,
  type User,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import {
  buildAnonymizedOpportunity,
  CUSTOMER_LEGACY_PLAN_VERSIONS,
  CUSTOMER_ADVISOR_PROFILE_VERSION,
  CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION,
  customerHomeFeatureSections as rawCustomerHomeFeatureSections,
  createCustomerPermissionPack,
  createCustomerProjectPlan,
  customerAdvisorOptions as rawCustomerAdvisorOptions,
  customerProjectOptions as rawCustomerProjectOptions,
  deriveCustomerProjectPriorities,
  derivePlanningClimateProfile,
  platformQuoteOptions as rawPlatformQuoteOptions,
  preserveEditedPlanItems,
  resetCustomerProfessionalReviewDeclaration,
  updateHomeFeatureSelection,
  validateCustomerProfessionalReview,
} from "@/lib/customer-projects.mjs";
import {
  customerReviewOptions as rawCustomerReviewOptions,
} from "@/lib/customer-plan-decision-support.mjs";
import { Field, SiteFooter, SiteHeader } from "./ComparatorChrome";
import { FirebaseAccountPanel } from "./FirebaseAccountPanel";
import { CustomerAssetLifecycle } from "./CustomerAssetLifecycle";
import { CustomerTradeQuotes } from "./CustomerTradeQuotes";
import { CustomerAppointmentRescheduling } from "./CustomerAppointmentRescheduling";
import { HomeFeatureIntake } from "./HomeFeatureIntake";
import {
  CustomerProjectPhotoCapture,
  type GuidedStoredEvidence,
} from "./CustomerProjectPhotoCapture";
import { CustomerPlanReportPreviewDialog } from "./CustomerPlanReportPreviewDialog";
import {
  CustomerPlanHistoryProgress,
  type CustomerPlanProgressInput,
} from "./CustomerPlanHistoryProgress";
import { CustomerDraftDeleteDialog } from "./CustomerDraftDeleteDialog";
import {
  CustomerInstallerRequestDialog,
  type CustomerInstallerRequestContact,
  type CustomerInstallerRequestProgress,
} from "./CustomerInstallerRequestDialog";
import {
  CustomerPlanShareDialog,
} from "./CustomerPlanShareDialog";
import { prepareCustomerPhotoUpload } from "@/lib/customer-photo-upload";
import {
  canRecoverInstallerRequest,
  canUpdateReplayedCustomerDraft,
  installerRequestFingerprint,
} from "@/lib/customer-installer-request-recovery.mjs";
import {
  createCustomerPlanDocument,
  createCustomerPlanReportView,
} from "@/lib/customer-plan-document.mjs";
import { downloadCustomerPlanPdf } from "@/lib/customer-plan-pdf-client";
import {
  uploadCustomerProjectEvidence,
  type CustomerEvidenceUploadProgress,
} from "@/lib/customer-project-evidence-upload-client";

type DashboardView =
  | "overview"
  | "editor"
  | "profile"
  | "detail"
  | "quotes"
  | "appointments";
type Option = [string, string];
type EvidenceSource =
  | "unknown"
  | "customer-reported"
  | "photo-supported"
  | "document-supported";
type PermissionClassification =
  | "portable"
  | "permission-needed"
  | "fixed-or-shared"
  | "not-sure";
type CustomerReviewKind =
  | "question"
  | "customer-recorded-feedback"
  | "proposed-change";
type CustomerReviewTargetType = "fact" | "plan-item" | "general";
type CustomerReviewStatus = "open" | "answered" | "accepted" | "declined";
type PermissionPackSectionKey =
  | "portable"
  | "owner-agent"
  | "strata-shared"
  | "licensed-site-checks"
  | "evidence-questions";
type PlanningClimateProfile = {
  basis: "postcode-state-planning";
  code:
    | "hot-humid"
    | "hot-dry"
    | "warm-humid"
    | "temperate-dry"
    | "temperate-mixed"
    | "cool-temperate";
  label: string;
  summary: string;
  priorities: string[];
  notNatHERSAssessment: true;
  disclaimer: string;
};
type CustomerAdvisorProfile = {
  version?: string;
  factEvidence: Array<{ factKey: string; source: EvidenceSource }>;
  rooms: Array<{
    id: string;
    name: string;
    roomType: string;
    concerns: string[];
    usePeriods: string[];
  }>;
  permissionItems: Array<{
    id: string;
    title: string;
    classification: PermissionClassification;
    note: string;
  }>;
  reviewItems: Array<{
    id: string;
    kind: CustomerReviewKind;
    targetType: CustomerReviewTargetType;
    targetId: string;
    text: string;
    status: CustomerReviewStatus;
  }>;
  professionalReview?: {
    enabled: true;
    role: string;
    adviserName: string;
    accreditationScheme: string;
    accreditationReference: string;
    notes: string;
    declarationAccepted: boolean;
    declarationVersion?: string;
  };
  climate?: PlanningClimateProfile;
};
type CustomerPermissionPack = {
  version: string;
  title: string;
  context: {
    householdSituation: "owner" | "renter" | "";
    approvalContext: "none" | "strata" | "not_sure";
  };
  sections: Array<{
    classification: PermissionPackSectionKey;
    label: string;
    items: Array<{ id: string; title: string; note: string }>;
  }>;
  disclaimer: string;
};

const resetProfessionalReviewDeclaration = (
  profile: CustomerAdvisorProfile,
) => resetCustomerProfessionalReviewDeclaration(
  profile,
) as CustomerAdvisorProfile;

const PROJECT_REVISION_CONFLICT_MESSAGE =
  "This plan was updated in another tab. Your unsaved edits are still here.";

const customerProjectOptions = rawCustomerProjectOptions as {
  goals: Option[];
  paces: Option[];
  situations: Option[];
  approvalContexts: Option[];
  homeFeatures: Option[];
  states: string[];
  propertyTypes: Option[];
  serviceCategories: Option[];
  priorities: Option[];
  stages: Option[];
  timings: Option[];
  budgets: Option[];
  storeys: Option[];
  ageBands: Option[];
  floorAreas: Option[];
  roofTypes: Option[];
  switchboards: Option[];
  accessConstraints: Option[];
};
const customerAdvisorOptions = rawCustomerAdvisorOptions as {
  factKeys: Option[];
  evidenceSources: Option[];
  roomTypes: Option[];
  comfortConcerns: Option[];
  usePeriods: Option[];
  permissionClasses: Option[];
  professionalRoles: Option[];
};
const customerReviewOptions = rawCustomerReviewOptions as {
  kinds: Option[];
  statuses: Option[];
};
type HomeFeatureQuestion = {
  id: string;
  unknownValue?: string;
  options: Option[];
};
const homeFeatureQuestions = (
  rawCustomerHomeFeatureSections as unknown as Array<{
    questions: HomeFeatureQuestion[];
  }>
).flatMap((section) => section.questions);
const platformQuoteOptions = rawPlatformQuoteOptions as {
  quoteTypes: Option[];
  inclusions: Option[];
  startWindows: Option[];
};

type CustomerProfile = {
  displayName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  postcode: string;
  addressState: string;
  propertyType: string;
  householdSituation: string;
  accountUpdates: boolean;
  accountStatus: string;
  accountTier: string;
  updatedAt: string;
};

type ProjectQuote = {
  id: string;
  optionLabel: string;
  installerBusinessName: string;
  installerVerified: boolean;
  inclusions: string[];
  products: Array<{
    brand: string;
    name: string;
    modelNumber: string;
    quantity: number;
    unitLabel: string;
    unitPriceCentsExGst: number;
  }>;
  productSubtotalCentsExGst: number;
  labourCentsExGst: number;
  otherCentsExGst: number;
  totalCentsExGst: number;
  quoteType: string;
  startWindow: string;
  durationWeeks: number;
  workmanshipWarrantyYears: number;
  customerDecision: "reviewing" | "shortlisted" | "declined" | "accepted";
  contactRelease: null | {
    status: "active" | "withdrawn";
    grantedAt: string;
    withdrawnAt: string;
  };
  arrivalProposal: null | {
    id: string;
    status: "proposed" | "selected" | "direct_contact" | "withdrawn";
    windows: Array<{ id: string; startsAt: string; endsAt: string }>;
    installerNote: string;
    selectedWindow: null | { id: string; startsAt: string; endsAt: string };
    directContact: null | {
      businessName: string;
      phone: string;
      email: string;
      abn: string;
    };
    directContactSelectedAt: string;
    crmWorkOrderId: string;
    crmAppointmentId: string;
    preparationAcknowledgedAt: string;
    revision: number;
    proposedAt: string;
    selectedAt: string;
  };
  submittedAt: string;
};

type CustomerHandoverPack = {
  id: string;
  workNumber: string;
  serviceCategory: string;
  publishedAt: string;
  updatedAt: string;
  assets: Array<{
    id: string;
    assetCategory: string;
    brand: string;
    modelNumber: string;
    serialNumber: string;
    quantity: number;
    installedAt: string;
    warrantyProvider: string;
    warrantyReference: string;
    warrantyStart: string;
    warrantyEnd: string;
  }>;
  complianceItems: Array<{
    id: string;
    label: string;
    status: string;
    completedAt: string;
  }>;
  documents: Array<{
    id: string;
    category: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    createdAt: string;
  }>;
  corrections: Array<{
    id: string;
    assetId: string;
    versionNumber: number;
    fieldKey: string;
    previousValue: string;
    approvedValue: string;
    reason: string;
    publishedAt: string;
  }>;
};

type CustomerPlanItem = {
  id: string;
  stage: string;
  title: string;
  text: string;
  href: string;
  action: string;
  guidance?: {
    basedOn: string[];
    stillUncertain: string[];
    reconsiderIf: string[];
  };
};
type CustomerEverydayAction = {
  id: string;
  category: string;
  title: string;
  text: string;
};
type CustomerPlanQuestion = {
  id: string;
  prompt: string;
  whyItMatters: string;
  targetStep: number;
  targetAnchor: string;
  notSureAllowed: true;
};

type CustomerProject = {
  id: string;
  title: string;
  homeNickname: string;
  postcode: string;
  addressState: string;
  propertyType: string;
  householdSituation: string;
  goal: string;
  goals: string[];
  pace: string;
  existingFeatures: string[];
  serviceCategories: string[];
  priorities: string[];
  projectStage: string;
  timing: string;
  budgetRange: string;
  propertyContext: {
    storeys: string;
    ageBand: string;
    floorArea: string;
    roofType: string;
    switchboard: string;
    approvalContext: string;
    accessConstraints: string[];
  };
  privateNotes: string;
  advisorProfile: CustomerAdvisorProfile;
  planSnapshot: {
    version?: string;
    title?: string;
    summary?: string;
    items?: CustomerPlanItem[];
    nextQuestions?: CustomerPlanQuestion[];
    serviceCategories?: string[];
    propertyContext?: {
      storeys: string;
      ageBand: string;
      floorArea: string;
      roofType: string;
      switchboard: string;
    };
  };
  planRevision: number;
  completedPlanItems: string[];
  status: string;
  displayStatus: string;
  submittedAt: string;
  archivedAt: string;
  createdAt: string;
  updatedAt: string;
  hasRetainedAssetHistory: boolean;
  deletionPending?: boolean;
  contactReady: boolean;
  progress: {
    installerCount: number;
    reviewingCount: number;
    responseCount: number;
    quoteCount: number;
    opportunityStatus: string;
    expiresAt: string;
  };
  quotes: ProjectQuote[];
  evidence: Array<{
    id: string;
    category: string;
    captureSlot: string;
    factKeys: string[];
    sharingScope: "private-plan" | "allocated-installers";
    fileName: string;
    contentType: string;
    sizeBytes: number;
    privacyStatus: string;
    revision: number;
    previewUrl: string;
    thumbnailUrl: string;
    createdAt: string;
    updatedAt: string;
  }>;
  planRevisions: Array<{
    id: string;
    revisionNumber: number;
    eventType: string;
    planVersion: string;
    goals: string[];
    homeFeatures: string[];
    pace: string;
    budgetRange: string;
    planSnapshot: {
      version?: string;
      title?: string;
      summary?: string;
      items?: CustomerPlanItem[];
    };
    restoredFromRevision: number;
    createdAt: string;
  }>;
  outcomeCheckins: Array<{
    id: string;
    comfortOutcome: string;
    energyOutcome: string;
    completedItemIds: string[];
    note: string;
    recordedAt: string;
  }>;
  evidenceSharingConsent: boolean;
  handoverPacks: CustomerHandoverPack[];
};

type ProjectDraft = Pick<
  CustomerProject,
  | "title"
  | "homeNickname"
  | "postcode"
  | "addressState"
  | "propertyType"
  | "householdSituation"
  | "goal"
  | "goals"
  | "pace"
  | "existingFeatures"
  | "serviceCategories"
  | "priorities"
  | "projectStage"
  | "timing"
  | "budgetRange"
  | "propertyContext"
  | "privateNotes"
  | "advisorProfile"
  | "planSnapshot"
>;
type PendingProjectEvidence = {
  id: string;
  file: File;
  category: string;
  captureSlot: string;
  factKeys: string[];
  sharingScope: "private-plan" | "allocated-installers";
  replaceEvidenceId?: string;
  expectedEvidenceRevision?: number;
  uploadProgress?: number;
  uploadStatus?: CustomerEvidenceUploadProgress["status"];
  uploadError?: string;
};

type AccountResult = {
  profile: CustomerProfile | null;
  emailVerified: boolean;
  tradeWorkspace: null | { partnerType: "installer" | "supplier" };
};

const optionLabel = (options: Array<[string, string]>, value: string) =>
  options.find(([key]) => key === value)?.[1] || value.replaceAll("_", " ");
const currency = (cents: number) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
const fileSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
function permissionPackText(pack: CustomerPermissionPack) {
  return [
    pack.title,
    "",
    `Household situation: ${pack.context.householdSituation || "Not recorded"}`,
    `Approval context: ${pack.context.approvalContext.replaceAll("_", " ")}`,
    "",
    ...pack.sections.flatMap((section) => [
      section.label,
      ...(section.items.length
        ? section.items.map((item) =>
            `- ${item.title}${item.note ? ` | ${item.note}` : ""}`,
          )
        : ["- No items listed"]),
      "",
    ]),
    pack.disclaimer,
    "",
  ].join("\r\n");
}
function downloadPermissionPack(
  profile: CustomerAdvisorProfile,
  context: {
    householdSituation: string;
    approvalContext: string;
    planItems: CustomerPlanItem[];
  },
) {
  const pack = createCustomerPermissionPack(profile, context) as CustomerPermissionPack;
  const url = URL.createObjectURL(
    new Blob([permissionPackText(pack)], { type: "text/plain;charset=utf-8" }),
  );
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = "property-permission-checklist.txt";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function prepareEvidenceUpload(item: PendingProjectEvidence) {
  const quotingPhotoCategories = new Set([
    "property-photo",
    "existing-equipment",
    "switchboard",
  ]);
  if (
    !quotingPhotoCategories.has(item.category) ||
    !item.file.type.startsWith("image/")
  )
    return item.file;
  return prepareCustomerPhotoUpload(item.file, "property-photo");
}
const statusLabels: Record<string, string> = {
  draft: "Draft",
  matching: "Installer matching",
  responses: "Responses received",
  quote_review: "Quote review",
  completed: "Complete",
  withdrawn: "Withdrawn",
  archived: "Archived",
};

function projectDefaults(profile: CustomerProfile | null): ProjectDraft {
  return {
    title: "",
    homeNickname: "My home",
    postcode: profile?.postcode || "",
    addressState: profile?.addressState || "",
    propertyType: profile?.propertyType || "house",
    householdSituation: ["owner", "renter"].includes(
      profile?.householdSituation || "",
    )
      ? profile!.householdSituation
      : "",
    goal: "",
    goals: [],
    pace: "staged",
    existingFeatures: [],
    serviceCategories: [],
    priorities: [],
    projectStage: "exploring",
    timing: "planning",
    budgetRange: "not_set",
    propertyContext: {
      storeys: "",
      ageBand: "",
      floorArea: "",
      roofType: "",
      switchboard: "",
      approvalContext: "none",
      accessConstraints: [],
    },
    advisorProfile: {
      version: CUSTOMER_ADVISOR_PROFILE_VERSION,
      factEvidence: customerAdvisorOptions.factKeys.map(([factKey]) => ({
        factKey,
        source: "unknown",
      })),
      rooms: [],
      permissionItems: [],
      reviewItems: [],
    },
    privateNotes: "",
    planSnapshot: {},
  };
}

function projectDefaultsWithSelection(
  profile: CustomerProfile | null,
  selection?: {
    goal?: string;
    goals?: string[];
    pace?: string;
    situation?: string;
    approvalContext?: string;
    budgetRange?: string;
    addressState?: string;
    features?: string[];
    categories?: string[];
    postcode?: string;
  },
): ProjectDraft {
  const draft = projectDefaults(profile);
  if (!selection) return draft;
  return {
    ...draft,
    goal: selection.goals?.[0] || selection.goal || draft.goal,
    goals: selection.goals?.length
      ? selection.goals
      : selection.goal
        ? [selection.goal]
        : draft.goals,
    pace: selection.pace || draft.pace,
    householdSituation: ["owner", "renter"].includes(
      selection.situation || "",
    )
      ? selection.situation!
      : draft.householdSituation,
    existingFeatures: selection.features || draft.existingFeatures,
    serviceCategories: selection.categories || draft.serviceCategories,
    postcode: selection.postcode || draft.postcode,
    addressState: selection.addressState || draft.addressState,
    budgetRange: selection.budgetRange || draft.budgetRange,
    propertyContext: {
      ...draft.propertyContext,
      approvalContext:
        selection.approvalContext || draft.propertyContext.approvalContext,
    },
  };
}

function ProfileForm({
  user,
  profile,
  onSaved,
}: {
  user: User;
  profile: CustomerProfile | null;
  onSaved: (profile: CustomerProfile) => void;
}) {
  const [draft, setDraft] = useState(() => ({
    displayName: profile?.displayName || user.displayName || "",
    phone: profile?.phone || "",
    addressLine1: profile?.addressLine1 || "",
    addressLine2: profile?.addressLine2 || "",
    suburb: profile?.suburb || "",
    postcode: profile?.postcode || "",
    addressState: profile?.addressState || "",
    propertyType: profile?.propertyType || "house",
    householdSituation: ["owner", "renter"].includes(
      profile?.householdSituation || "",
    )
      ? profile!.householdSituation
      : "",
    accountUpdates: profile?.accountUpdates ?? false,
    consent: Boolean(profile),
  }));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus("Saving your private household profile...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/customer-account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(draft),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok)
        throw new Error(result.error || "Your profile could not be saved.");
      onSaved(result.profile);
      setStatus(
        "Saved. Your customer account remains free and your household details stay private.",
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Your profile could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="customer-profile-panel"
      aria-labelledby="customer-profile-title"
    >
      <div className="customer-panel-heading">
        <span>{profile ? "Privacy and profile" : "One quick setup step"}</span>
        <h2 id="customer-profile-title">
          Set the defaults for your home projects
        </h2>
        <p>
          Your phone and service address stay private while you plan and while
          installers review an anonymised lead. They are required only when
          requesting trades, and are released only when you deliberately connect
          with one shortlisted installer.
        </p>
      </div>
      <form onSubmit={save} noValidate>
        <div className="customer-field-grid">
          <Field label="Name shown in your account">
            <input
              value={draft.displayName}
              onChange={(event) =>
                setDraft({ ...draft, displayName: event.target.value })
              }
              autoComplete="name"
            />
          </Field>
          <Field label="Account email">
            <input value={user.email || ""} readOnly aria-readonly="true" />
          </Field>
          <Field
            label="Contact phone"
            optional="required before requesting trades"
          >
            <input
              value={draft.phone}
              onChange={(event) =>
                setDraft({ ...draft, phone: event.target.value })
              }
              inputMode="tel"
              autoComplete="tel"
            />
          </Field>
          <Field
            label="Service street address"
            optional="required before requesting trades"
          >
            <input
              value={draft.addressLine1}
              onChange={(event) =>
                setDraft({ ...draft, addressLine1: event.target.value })
              }
              autoComplete="address-line1"
            />
          </Field>
          <Field label="Address line 2" optional="optional">
            <input
              value={draft.addressLine2}
              onChange={(event) =>
                setDraft({ ...draft, addressLine2: event.target.value })
              }
              autoComplete="address-line2"
            />
          </Field>
          <Field
            label="Service suburb"
            optional="required before requesting trades"
          >
            <input
              value={draft.suburb}
              onChange={(event) =>
                setDraft({ ...draft, suburb: event.target.value })
              }
              autoComplete="address-level2"
            />
          </Field>
          <Field label="Home postcode">
            <input
              value={draft.postcode}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  postcode: event.target.value.replace(/\D/g, "").slice(0, 4),
                })
              }
              inputMode="numeric"
              maxLength={4}
              autoComplete="postal-code"
            />
          </Field>
          <Field label="State or territory">
            <select
              value={draft.addressState}
              onChange={(event) =>
                setDraft({ ...draft, addressState: event.target.value })
              }
            >
              <option value="">Choose one</option>
              {customerProjectOptions.states.map((state: string) => (
                <option value={state} key={state}>
                  {state}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Usual property type">
            <select
              value={draft.propertyType}
              onChange={(event) =>
                setDraft({ ...draft, propertyType: event.target.value })
              }
            >
              {customerProjectOptions.propertyTypes.map(
                ([value, label]: [string, string]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field label="Property situation">
            <select
              required
              value={draft.householdSituation}
              onChange={(event) =>
                setDraft({ ...draft, householdSituation: event.target.value })
              }
            >
              <option value="">Choose owner or renter</option>
              {customerProjectOptions.situations.map(
                ([value, label]: [string, string]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ),
              )}
            </select>
          </Field>
        </div>
        <label className="customer-check-row">
          <input
            type="checkbox"
            checked={draft.accountUpdates}
            onChange={(event) =>
              setDraft({ ...draft, accountUpdates: event.target.checked })
            }
          />
          <span>
            <strong>Optional project updates</strong>
            <small>
              Allow helpful project progress emails. Security and account
              notices are separate. No marketing list is created.
            </small>
          </span>
        </label>
        <label className="customer-check-row">
          <input
            type="checkbox"
            checked={draft.consent}
            onChange={(event) =>
              setDraft({ ...draft, consent: event.target.checked })
            }
          />
          <span>
            <strong>Private account notice</strong>
            <small>
              I understand my contact details are stored privately. No trade can
              access them unless I later confirm a release to that specific
              shortlisted installer.
            </small>
          </span>
        </label>
        <div className="customer-form-actions">
          <button className="btn" disabled={busy}>
            {busy
              ? "Saving..."
              : profile
                ? "Update private profile"
                : "Open my free dashboard"}
          </button>
        </div>
        {status && (
          <p className="customer-inline-status" role="status">
            {status}
          </p>
        )}
      </form>
    </section>
  );
}

function ProjectEditor({
  initial,
  existingId,
  existingPlanRevision,
  storedEvidence,
  emailVerified,
  profile,
  onCancel,
  onReloadLatest,
  onSave,
  onUploadEvidence,
  onLoadEvidencePreview,
  onDeleteEvidence,
  onCheckInstallerRequestSubmitted,
  onRequestInstallerResponses,
  onRequestComplete,
}: {
  initial: ProjectDraft;
  existingId?: string;
  existingPlanRevision?: number;
  storedEvidence: CustomerProject["evidence"];
  emailVerified: boolean;
  profile: CustomerProfile;
  onCancel: () => void;
  onReloadLatest: () => void;
  onSave: (
    draft: ProjectDraft,
    id?: string,
    expectedPlanRevision?: number,
    clientCreateId?: string,
  ) => Promise<{ id: string; planRevision: number }>;
  onUploadEvidence: (
    projectId: string,
    evidence: PendingProjectEvidence[],
    confirmInstallerPhotoSharing: boolean,
    onProgress?: (
      evidenceId: string,
      progress: CustomerEvidenceUploadProgress,
    ) => void,
  ) => Promise<CustomerProject["evidence"]>;
  onLoadEvidencePreview: (
    evidence: GuidedStoredEvidence,
  ) => Promise<Blob>;
  onDeleteEvidence: (
    evidence: CustomerProject["evidence"][number],
  ) => Promise<void>;
  onCheckInstallerRequestSubmitted: (
    projectId: string,
  ) => Promise<CustomerProject | null>;
  onRequestInstallerResponses: (
    projectId: string,
    expectedPlanRevision: number,
    confirmAllProjectPhotoSharing: boolean,
    contact: CustomerInstallerRequestContact,
    recoverCommittedSubmit?: boolean,
  ) => Promise<void>;
  onRequestComplete: () => void;
}) {
  const [draft, setDraft] = useState<ProjectDraft>(initial);
  const [step, setStep] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [validationError, setValidationError] = useState("");
  const [savedId, setSavedId] = useState(existingId || "");
  const [savedPlanRevision, setSavedPlanRevision] = useState(
    existingPlanRevision || 0,
  );
  const [customPlanItem, setCustomPlanItem] = useState("");
  const [reviewKind, setReviewKind] =
    useState<CustomerReviewKind>("question");
  const [reviewTarget, setReviewTarget] = useState("general");
  const [reviewText, setReviewText] = useState("");
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [shareError, setShareError] = useState("");
  const [shareRequestId, setShareRequestId] = useState("");
  const [reportPreviewOpen, setReportPreviewOpen] = useState(false);
  const [installerRequestOpen, setInstallerRequestOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const draggedPlanItem = useRef("");
  const activePdfDownload = useRef(false);
  const editGeneration = useRef(0);
  const createRequestId = useRef("");
  const uncertainInstallerSubmit = useRef<{
    projectId: string;
    planRevision: number;
    editGeneration: number;
    requestFingerprint: string;
  } | null>(null);
  const [revisionConflict, setRevisionConflict] = useState(false);
  const [pendingEvidence, setPendingEvidence] = useState<
    PendingProjectEvidence[]
  >([]);
  const [uploadedEvidence, setUploadedEvidence] = useState<
    CustomerProject["evidence"]
  >([]);
  const visibleStoredEvidence = useMemo(() => {
    const merged = new Map(
      storedEvidence.map((item) => [item.id, item]),
    );
    uploadedEvidence.forEach((item) => merged.set(item.id, item));
    return [...merged.values()];
  }, [storedEvidence, uploadedEvidence]);
  const storedEvidenceCount = visibleStoredEvidence.length;
  const pendingReplacementEvidenceIds = new Set(
    pendingEvidence.flatMap((item) =>
      item.replaceEvidenceId ? [item.replaceEvidenceId] : [],
    ),
  );
  const storedProjectPhotoCount = visibleStoredEvidence.filter(
    (item) =>
      item.contentType.startsWith("image/")
      && !pendingReplacementEvidenceIds.has(item.id),
  ).length;
  const pendingProjectPhotoCount = pendingEvidence.filter(
    (item) => item.file.type.startsWith("image/"),
  ).length;
  const projectPhotoCount = storedProjectPhotoCount + pendingProjectPhotoCount;
  const answeredHomeQuestionCount = homeFeatureQuestions.filter((question) =>
    question.options.some(([value]) => draft.existingFeatures.includes(value)),
  ).length;
  const firstUnansweredHomeQuestion = homeFeatureQuestions.find(
    (question) =>
      !question.options.some(([value]) =>
        draft.existingFeatures.includes(value),
      ),
  );
  const notSureHomeQuestionCount = homeFeatureQuestions.filter(
    (question) =>
      question.unknownValue
      && draft.existingFeatures.includes(question.unknownValue),
  ).length;
  const planningClimate = useMemo(
    () =>
      derivePlanningClimateProfile(
        draft.postcode,
        draft.addressState,
      ) as PlanningClimateProfile | null,
    [draft.addressState, draft.postcode],
  );
  const advisorPlan = useMemo(
    () =>
      createCustomerProjectPlan({
        goals: draft.goals,
        goal: draft.goal,
        pace: draft.pace,
        householdSituation: draft.householdSituation,
        approvalContext: draft.propertyContext.approvalContext,
        propertyContext: draft.propertyContext,
        existingFeatures: draft.existingFeatures,
        serviceCategories: draft.serviceCategories,
        budgetRange: draft.budgetRange,
        postcode: draft.postcode,
        addressState: draft.addressState,
        advisorProfile: {
          ...draft.advisorProfile,
          climate: planningClimate || undefined,
        },
      }),
    [
      draft.goals,
      draft.goal,
      draft.pace,
      draft.householdSituation,
      draft.propertyContext,
      draft.existingFeatures,
      draft.serviceCategories,
      draft.budgetRange,
      draft.postcode,
      draft.addressState,
      draft.advisorProfile,
      planningClimate,
    ],
  );
  const [planItems, setPlanItems] = useState<CustomerPlanItem[]>(() => {
    const prepared = createCustomerProjectPlan({
      goals: initial.goals,
      goal: initial.goal,
      pace: initial.pace,
      householdSituation: initial.householdSituation,
      approvalContext: initial.propertyContext.approvalContext,
      propertyContext: initial.propertyContext,
      existingFeatures: initial.existingFeatures,
      serviceCategories: initial.serviceCategories,
      budgetRange: initial.budgetRange,
      postcode: initial.postcode,
      addressState: initial.addressState,
      advisorProfile: initial.advisorProfile,
      planSnapshot: initial.planSnapshot,
    });
    return prepared.items as CustomerPlanItem[];
  });
  const [planEdited, setPlanEdited] = useState(
    Array.isArray(initial.planSnapshot?.items),
  );
  const [planInputsChanged, setPlanInputsChanged] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(
    () => new Set(),
  );
  const [planSnapshotConflict, setPlanSnapshotConflict] = useState(() => {
    const snapshot = initial.planSnapshot;
    if (!snapshot || Object.keys(snapshot).length === 0) return false;
    if (
      snapshot.version
      && CUSTOMER_LEGACY_PLAN_VERSIONS.includes(snapshot.version)
    ) {
      return false;
    }
    return (
      snapshot.version !== advisorPlan.version
      || !Array.isArray(snapshot.items)
    );
  });
  const visiblePlanItems = planEdited
    ? planItems
    : (advisorPlan.items as CustomerPlanItem[]);
  const everydayActions = (
    Array.isArray(advisorPlan.everydayActions)
      ? advisorPlan.everydayActions
      : []
  ) as CustomerEverydayAction[];
  const everydayActionsBoundary =
    typeof advisorPlan.everydayActionsBoundary === "string"
      ? advisorPlan.everydayActionsBoundary
      : "";
  const permissionPackPreview = createCustomerPermissionPack(
    draft.advisorProfile,
    {
      householdSituation: draft.householdSituation,
      approvalContext: draft.propertyContext.approvalContext,
      planItems: visiblePlanItems,
    },
  ) as CustomerPermissionPack;
  const professionalReviewValidation = validateCustomerProfessionalReview(
    draft.advisorProfile.professionalReview,
  ) as { ok: boolean; error?: string };
  const professionalReviewError = professionalReviewValidation.ok
    ? ""
    : professionalReviewValidation.error
      || "Complete the professional review details before continuing.";

  const draftWithPlan = (): ProjectDraft => ({
    ...draft,
    goal: draft.goals[0] || "",
    priorities: deriveCustomerProjectPriorities(draft.goals),
    advisorProfile: {
      ...draft.advisorProfile,
      version: CUSTOMER_ADVISOR_PROFILE_VERSION,
      climate: planningClimate || undefined,
    },
    planSnapshot: {
      version: advisorPlan.version,
      title: advisorPlan.title,
      summary: advisorPlan.summary,
      items: visiblePlanItems,
      nextQuestions: advisorPlan.nextQuestions as CustomerPlanQuestion[],
      serviceCategories: draft.serviceCategories,
      propertyContext: {
        storeys: draft.propertyContext.storeys,
        ageBand: draft.propertyContext.ageBand,
        floorArea: draft.propertyContext.floorArea,
        roofType: draft.propertyContext.roofType,
        switchboard: draft.propertyContext.switchboard,
      },
    },
  });
  const shareablePlanDocument = createCustomerPlanDocument(
    {
      goal: draft.goals[0] || "",
      goals: JSON.stringify(draft.goals),
      pace: draft.pace,
      postcode: draft.postcode,
      address_state: draft.addressState,
      property_type: draft.propertyType,
      household_situation: draft.householdSituation,
      existing_features: JSON.stringify(draft.existingFeatures),
      service_categories: JSON.stringify(draft.serviceCategories),
      budget_range: draft.budgetRange,
      property_context: JSON.stringify(draft.propertyContext),
      advisor_profile: JSON.stringify(draft.advisorProfile),
      plan_snapshot: JSON.stringify(draftWithPlan().planSnapshot),
      completed_plan_items: "[]",
    },
    {
      evidence: [...visibleStoredEvidence, ...pendingEvidence].map(
        (item) => ({
          fact_keys: JSON.stringify(item.factKeys),
          sharing_scope: item.sharingScope,
        }),
      ),
    },
  );

  const invalidateStepsFrom = (firstStep: number) => {
    setCompletedSteps((current) => new Set(
      [...current].filter((completedStep) => completedStep < firstStep),
    ));
  };

  const markDirty = () => {
    editGeneration.current += 1;
    setDirty(true);
  };

  const describeEditorError = (error: unknown, fallback: string) => {
    if (
      error instanceof Error
      && error.message === PROJECT_REVISION_CONFLICT_MESSAGE
    ) {
      setRevisionConflict(true);
      return `${PROJECT_REVISION_CONFLICT_MESSAGE} Review them, then choose whether to load the latest saved version.`;
    }
    return error instanceof Error ? error.message : fallback;
  };

  const set = <K extends keyof ProjectDraft>(
    key: K,
    value: ProjectDraft[K],
  ) => {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      return {
        ...next,
        advisorProfile: resetProfessionalReviewDeclaration(
          next.advisorProfile,
        ),
      };
    });
    if (
      key === "goals" ||
      key === "goal" ||
      key === "pace" ||
      key === "postcode" ||
      key === "addressState" ||
      key === "householdSituation" ||
      key === "existingFeatures" ||
      key === "serviceCategories" ||
      key === "budgetRange"
    ) {
      if (planEdited) setPlanInputsChanged(true);
    }
    if (
      key === "title" ||
      key === "homeNickname" ||
      key === "postcode" ||
      key === "addressState" ||
      key === "propertyType" ||
      key === "householdSituation"
    ) {
      invalidateStepsFrom(1);
    } else if (
      key === "goals" ||
      key === "goal" ||
      key === "pace" ||
      key === "existingFeatures" ||
      key === "serviceCategories" ||
      key === "budgetRange"
    ) {
      invalidateStepsFrom(2);
    } else if (
      key === "priorities" ||
      key === "projectStage" ||
      key === "timing"
    ) {
      invalidateStepsFrom(4);
    }
    markDirty();
    setStatus("");
    setValidationError("");
  };
  const toggleGoal = (value: string) => {
    const goals = draft.goals.includes(value)
      ? draft.goals.filter((item) => item !== value)
      : [...draft.goals, value].slice(0, 10);
    setDraft((current) => ({
      ...current,
      goals,
      goal: goals[0] || "",
      advisorProfile: resetProfessionalReviewDeclaration(
        current.advisorProfile,
      ),
    }));
    if (planEdited) setPlanInputsChanged(true);
    invalidateStepsFrom(2);
    markDirty();
    setStatus("");
    setValidationError("");
  };
  const toggle = (
    key: "existingFeatures" | "serviceCategories",
    value: string,
  ) =>
    set(
      key,
      draft[key].includes(value)
        ? draft[key].filter((item) => item !== value)
        : [...draft[key], value],
    );
  const setPropertyContext = (
    key: keyof ProjectDraft["propertyContext"],
    value: string | string[],
  ) => {
    set("propertyContext", { ...draft.propertyContext, [key]: value });
    if (key === "approvalContext") {
      if (planEdited) setPlanInputsChanged(true);
      invalidateStepsFrom(1);
    } else if (key === "accessConstraints") {
      invalidateStepsFrom(4);
    } else {
      if (planEdited) setPlanInputsChanged(true);
      invalidateStepsFrom(2);
    }
  };
  const toggleAccessConstraint = (value: string) =>
    setPropertyContext(
      "accessConstraints",
      draft.propertyContext.accessConstraints.includes(value)
        ? draft.propertyContext.accessConstraints.filter(
            (item) => item !== value,
          )
        : [...draft.propertyContext.accessConstraints, value],
    );
  const updateAdvisorProfile = (
    update: (profile: CustomerAdvisorProfile) => CustomerAdvisorProfile,
    affectsAdvice = true,
  ) => {
    setDraft((current) => {
      const updatedProfile = update(current.advisorProfile);
      return {
        ...current,
        advisorProfile: affectsAdvice
          ? resetProfessionalReviewDeclaration(updatedProfile)
          : updatedProfile,
      };
    });
    if (affectsAdvice && planEdited) setPlanInputsChanged(true);
    if (affectsAdvice) invalidateStepsFrom(2);
    markDirty();
    setStatus("");
    setValidationError("");
  };
  const setProfessionalReviewEnabled = (enabled: boolean) => {
    updateAdvisorProfile((profile) => {
      if (!enabled) {
        const next = { ...profile };
        delete next.professionalReview;
        return next;
      }
      return {
        ...profile,
        professionalReview: {
          enabled: true,
          role: "accredited-energy-adviser",
          adviserName: "",
          accreditationScheme: "",
          accreditationReference: "",
          notes: "",
          declarationAccepted: false,
        },
      };
    }, false);
  };
  const updateProfessionalReview = (
    update: Partial<NonNullable<CustomerAdvisorProfile["professionalReview"]>>,
  ) => {
    const confirmsCurrentDeclaration =
      Object.keys(update).length === 1
      && update.declarationAccepted === true;
    updateAdvisorProfile((profile) => {
      const nextProfile = {
        ...profile,
        professionalReview: {
          enabled: true as const,
          role:
            profile.professionalReview?.role
            || "accredited-energy-adviser",
          adviserName: profile.professionalReview?.adviserName || "",
          accreditationScheme:
            profile.professionalReview?.accreditationScheme || "",
          accreditationReference:
            profile.professionalReview?.accreditationReference || "",
          notes: profile.professionalReview?.notes || "",
          declarationAccepted:
            profile.professionalReview?.declarationAccepted || false,
          ...update,
        },
      };
      if (confirmsCurrentDeclaration) {
        return {
          ...nextProfile,
          professionalReview: {
            ...nextProfile.professionalReview,
            declarationAccepted: true,
            declarationVersion:
              CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION,
          },
        };
      }
      return resetProfessionalReviewDeclaration(nextProfile);
    }, false);
  };
  const markUnansweredHomeQuestionsNotSure = () => {
    let next = draft.existingFeatures;
    for (const question of homeFeatureQuestions) {
      const answered = question.options.some(([value]) => next.includes(value));
      if (!answered && question.unknownValue) {
        next = updateHomeFeatureSelection(
          next,
          question.id,
          question.unknownValue,
          true,
        );
      }
    }
    set("existingFeatures", next);
  };
  const addRoom = () => {
    if (draft.advisorProfile.rooms.length >= 12) {
      setValidationError("Up to 12 rooms can be included in one comfort profile.");
      return;
    }
    updateAdvisorProfile((profile) => ({
      ...profile,
      rooms: [
        ...profile.rooms,
        {
          id: crypto.randomUUID(),
          name: `Room ${profile.rooms.length + 1}`,
          roomType: customerAdvisorOptions.roomTypes[0]?.[0] || "",
          concerns: [],
          usePeriods: [],
        },
      ],
    }));
  };
  const updateRoom = (
    id: string,
    update: Partial<CustomerAdvisorProfile["rooms"][number]>,
  ) =>
    updateAdvisorProfile((profile) => ({
      ...profile,
      rooms: profile.rooms.map((room) =>
        room.id === id ? { ...room, ...update } : room,
      ),
    }));
  const toggleRoomValue = (
    id: string,
    key: "concerns" | "usePeriods",
    value: string,
  ) => {
    const room = draft.advisorProfile.rooms.find((item) => item.id === id);
    if (!room) return;
    updateRoom(id, {
      [key]: room[key].includes(value)
        ? room[key].filter((item) => item !== value)
        : [...room[key], value],
    });
  };
  const removeRoom = (id: string) =>
    updateAdvisorProfile((profile) => ({
      ...profile,
      rooms: profile.rooms.filter((room) => room.id !== id),
    }));
  const buildPermissionChecklist = () => {
    const existing = new Map(
      draft.advisorProfile.permissionItems.map((item) => [item.id, item]),
    );
    const permissionItems = visiblePlanItems.slice(0, 30).map((item) => {
      const id = `plan-${item.id}`
        .replace(/[^a-z0-9:_-]/gi, "-")
        .slice(0, 80);
      const previous = existing.get(id);
      return {
        id,
        title: item.title,
        classification: previous?.classification || "not-sure" as const,
        note: previous?.note || "",
      };
    });
    updateAdvisorProfile(
      (profile) => ({ ...profile, permissionItems }),
      false,
    );
    setStatus(
      "Permission checklist built from the current plan. Each new item starts as Not sure until you confirm it.",
    );
  };
  const updatePermissionItem = (
    id: string,
    update: Partial<CustomerAdvisorProfile["permissionItems"][number]>,
  ) =>
    updateAdvisorProfile(
      (profile) => ({
        ...profile,
        permissionItems: profile.permissionItems.map((item) =>
          item.id === id ? { ...item, ...update } : item,
        ),
      }),
      false,
    );
  const addEvidence = (
    files: FileList | File[] | null,
    preset?: Pick<
      PendingProjectEvidence,
      | "category"
      | "captureSlot"
      | "factKeys"
      | "replaceEvidenceId"
      | "expectedEvidenceRevision"
    > & { replacePendingId?: string },
  ) => {
    if (!files?.length) return;
    const incoming = Array.from(files);
    const replacePendingId =
      preset?.replacePendingId
      || (
        preset?.replaceEvidenceId
          ? pendingEvidence.find(
              (item) => item.replaceEvidenceId === preset.replaceEvidenceId,
            )?.id
          : ""
      );
    const availableSlots = Math.max(
      0,
      12
        - storedEvidenceCount
        - pendingEvidence.filter(
          (item) =>
            !item.replaceEvidenceId
            && item.id !== replacePendingId,
        ).length,
    );
    const next = incoming
      .slice(
        0,
        preset?.replaceEvidenceId || replacePendingId
          ? 1
          : availableSlots,
      )
      .map((file) => {
        const id = crypto.randomUUID();
        return {
          id,
          file,
          category:
            preset?.category
            || (file.type.startsWith("image/")
              ? "property-photo"
              : "supporting-document"),
          captureSlot:
            preset?.captureSlot
            || (file.type.startsWith("image/") ? `other:${id}` : ""),
          factKeys: preset?.factKeys || [],
          sharingScope: "private-plan" as const,
          replaceEvidenceId: preset?.replaceEvidenceId,
          expectedEvidenceRevision: preset?.expectedEvidenceRevision,
          uploadStatus: "queued" as const,
          uploadProgress: 0,
          uploadError: "",
        };
      });
    setPendingEvidence((current) => [
      ...current.filter(
        (item) => item.id !== replacePendingId,
      ),
      ...next,
    ]);
    markDirty();
    setStatus(
      next.length < incoming.length
        ? "Up to 12 files can be added to one project. Remove one to choose another."
        : "Photo selected in its matching prompt. Select Save changes to store it privately with this plan.",
    );
  };

  const removePendingEvidence = (id: string) => {
    setPendingEvidence((current) =>
      current.filter((item) => item.id !== id),
    );
    markDirty();
    setStatus("The unsaved photo was removed from this draft.");
  };

  const removeStoredEvidence = async (summary: GuidedStoredEvidence) => {
    const evidence = visibleStoredEvidence.find(
      (item) => item.id === summary.id,
    );
    if (!evidence) return;
    if (
      !window.confirm(
        `Remove "${evidence.fileName}" from this project? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await onDeleteEvidence(evidence);
      setUploadedEvidence((current) =>
        current.filter((item) => item.id !== evidence.id),
      );
      setStatus("The saved photo was removed from this project.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "The saved photo could not be removed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const loadStoredEvidencePreview = useCallback(
    (summary: GuidedStoredEvidence) => onLoadEvidencePreview(summary),
    [onLoadEvidencePreview],
  );

  const updateEvidenceUploadProgress = (
    evidenceId: string,
    progress: CustomerEvidenceUploadProgress,
  ) => {
    setPendingEvidence((current) =>
      current.map((item) =>
        item.id === evidenceId
          ? {
              ...item,
              uploadStatus: progress.status,
              uploadProgress: progress.progress,
              uploadError: progress.error || "",
            }
          : item,
      ),
    );
  };

  const updateEvidenceCategory = (id: string, category: string) => {
    setPendingEvidence((current) =>
      current.map((item) => (item.id === id ? { ...item, category } : item)),
    );
    markDirty();
  };

  const updateEvidenceFact = (id: string, factKey: string) => {
    setPendingEvidence((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, factKeys: factKey ? [factKey] : [] }
          : item,
      ),
    );
    markDirty();
  };

  const updateEvidenceSharingScope = (
    id: string,
    sharingScope: PendingProjectEvidence["sharingScope"],
  ) => {
    setPendingEvidence((current) =>
      current.map((item) =>
        item.id === id ? { ...item, sharingScope } : item,
      ),
    );
    markDirty();
  };

  const updatePlanItems = (items: CustomerPlanItem[]) => {
    setPlanItems(items);
    setPlanEdited(true);
    setPlanSnapshotConflict(false);
    invalidateStepsFrom(3);
    markDirty();
    setStatus("");
    setValidationError("");
  };

  const resetAdvisorSuggestions = () => {
    setPlanItems(advisorPlan.items as CustomerPlanItem[]);
    setPlanEdited(false);
    setPlanInputsChanged(false);
    setPlanSnapshotConflict(false);
    invalidateStepsFrom(3);
    markDirty();
    setValidationError("");
  };

  const movePlanItem = (id: string, direction: -1 | 1) => {
    const from = visiblePlanItems.findIndex((item) => item.id === id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= visiblePlanItems.length) return;
    const next = [...visiblePlanItems];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    updatePlanItems(next);
  };

  const dropPlanItem = (targetId: string) => {
    const sourceId = draggedPlanItem.current;
    draggedPlanItem.current = "";
    if (!sourceId || sourceId === targetId) return;
    const sourceIndex = visiblePlanItems.findIndex(
      (item) => item.id === sourceId,
    );
    const targetIndex = visiblePlanItems.findIndex(
      (item) => item.id === targetId,
    );
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...visiblePlanItems];
    const [item] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, item);
    updatePlanItems(next);
  };

  const addCustomPlanItem = () => {
    const title = customPlanItem.trim();
    if (!title) {
      setValidationError("Write a short home-specific step before adding it.");
      return;
    }
    updatePlanItems([
      ...visiblePlanItems,
      {
        id: `custom-${crypto.randomUUID()}`,
        stage: "Your note",
        title: title.slice(0, 160),
        text: "Added to this private plan for your home or budget.",
        href: "",
        action: "",
      },
    ]);
    setCustomPlanItem("");
  };

  const addReviewItem = () => {
    const text = reviewText.trim();
    if (!text) {
      setValidationError("Write the private question or feedback before recording it.");
      return;
    }
    if (draft.advisorProfile.reviewItems.length >= 20) {
      setValidationError("Up to 20 private review items can be kept in one project.");
      return;
    }
    const [targetTypeValue, ...targetParts] = reviewTarget.split(":");
    const targetType = (
      ["fact", "plan-item"].includes(targetTypeValue)
        ? targetTypeValue
        : "general"
    ) as CustomerReviewTargetType;
    const targetId = targetType === "general"
      ? "general"
      : targetParts.join(":");
    updateAdvisorProfile(
      (profile) => ({
        ...profile,
        reviewItems: [
          ...profile.reviewItems,
          {
            id: `review-${crypto.randomUUID()}`,
            kind: reviewKind,
            targetType,
            targetId,
            text: text.slice(0, 500),
            status: "open",
          },
        ],
      }),
      false,
    );
    setReviewText("");
    setStatus(
      "Recorded privately by you. It is not treated as assessor-authored or verified.",
    );
  };

  const updateReviewItem = (
    id: string,
    update: Partial<CustomerAdvisorProfile["reviewItems"][number]>,
  ) =>
    updateAdvisorProfile(
      (profile) => ({
        ...profile,
        reviewItems: profile.reviewItems.map((item) =>
          item.id === id ? { ...item, ...update } : item,
        ),
      }),
      false,
    );

  const removeReviewItem = (id: string) =>
    updateAdvisorProfile(
      (profile) => ({
        ...profile,
        reviewItems: profile.reviewItems.filter((item) => item.id !== id),
      }),
      false,
    );

  const addAcceptedReviewToPlan = (
    item: CustomerAdvisorProfile["reviewItems"][number],
  ) => {
    const planItemId = `custom-review-${item.id}`
      .replace(/[^a-z0-9:_-]/gi, "-")
      .slice(0, 80);
    if (visiblePlanItems.some((entry) => entry.id === planItemId)) {
      setStatus("That accepted proposal is already a private plan step.");
      return;
    }
    updatePlanItems([
      ...visiblePlanItems,
      {
        id: planItemId,
        stage: "Recorded by you",
        title: item.text.slice(0, 160),
        text: "Added as a private step after your explicit confirmation. This wording has not been professionally verified.",
        href: "",
        action: "",
        guidance: {
          basedOn: ["A private proposed change you recorded and explicitly added."],
          stillUncertain: ["This private wording has not been assessed or verified."],
          reconsiderIf: ["New evidence or your priorities change."],
        },
      },
    ]);
    setStatus("The accepted proposal was added as a private plan step.");
  };

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);

  function isStepReady(candidateStep: number) {
    if (candidateStep === 1) {
      return Boolean(
        draft.title.trim()
        && /^\d{4}$/.test(draft.postcode)
        && draft.addressState
        && draft.householdSituation,
      );
    }
    if (candidateStep === 2) {
      return Boolean(
        draft.goals.length
        && draft.serviceCategories.length
        && !professionalReviewError
        && [
          draft.propertyContext.storeys,
          draft.propertyContext.ageBand,
          draft.propertyContext.floorArea,
          draft.propertyContext.roofType,
          draft.propertyContext.switchboard,
        ].every(Boolean),
      );
    }
    if (candidateStep === 3) {
      return !planSnapshotConflict && !planInputsChanged;
    }
    if (candidateStep === 4) {
      return Boolean(draft.projectStage && draft.timing);
    }
    return false;
  }

  function openStep(nextStep: number) {
    if (nextStep !== step && isStepReady(step)) {
      setCompletedSteps((current) => new Set(current).add(step));
    }
    setValidationError("");
    setStep(nextStep);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openPlanQuestion(question: CustomerPlanQuestion) {
    setValidationError("");
    setStep(question.targetStep);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = window.document.getElementById(question.targetAnchor);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        const focusTarget = (
          target instanceof HTMLInputElement
          || target instanceof HTMLSelectElement
          || target instanceof HTMLButtonElement
        )
          ? target
          : target?.querySelector<HTMLElement>(
              "input, select, button, textarea, [tabindex]:not([tabindex='-1'])",
            );
        focusTarget?.focus({ preventScroll: true });
      });
    });
  }

  function showProfessionalReviewError(message = professionalReviewError) {
    openStep(2);
    setValidationError(message);
    window.requestAnimationFrame(() => {
      const section = window.document.getElementById(
        "customer-professional-review",
      );
      const fieldId =
        message.includes("adviser name")
          ? "customer-professional-review-name"
          : message.includes("scheme or professional body")
            ? "customer-professional-review-scheme"
            : message.includes("reference")
              ? "customer-professional-review-reference"
              : message.includes("declaration")
                ? "customer-professional-review-declaration"
                : "customer-professional-review-role";
      const target =
        window.document.getElementById(fieldId)
        || section?.querySelector<HTMLElement>("input, select, textarea");
      section?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({
        preventScroll: true,
      });
    });
  }

  function validate(nextStep: number) {
    if (
      step === 1 &&
      (!draft.title.trim() ||
        !/^\d{4}$/.test(draft.postcode) ||
        !draft.addressState ||
        !draft.householdSituation)
    ) {
      setValidationError(
        "Add a private project name, postcode, state and ownership situation before continuing.",
      );
      return false;
    }
    if (step === 2 && !draft.goals.length) {
      setValidationError(
        "Choose at least one goal so the advisor can build your plan.",
      );
      return false;
    }
    if (step === 2 && !draft.serviceCategories.length) {
      setValidationError(
        "Choose at least one type of work so the advisor can prepare the right roadmap.",
      );
      return false;
    }
    if (
      step === 2 &&
      ![
        draft.propertyContext.storeys,
        draft.propertyContext.ageBand,
        draft.propertyContext.floorArea,
        draft.propertyContext.roofType,
        draft.propertyContext.switchboard,
      ].every(Boolean)
    ) {
      setValidationError(
        "Choose an answer for home height, age, floor area, roof covering and switchboard type. Not sure is a valid answer.",
      );
      return false;
    }
    if (step === 2 && professionalReviewError) {
      showProfessionalReviewError();
      return false;
    }
    if (step === 3 && planInputsChanged) {
      setValidationError(
        "Refresh the advisor suggestions or confirm that you want to keep your edited steps before continuing.",
      );
      return false;
    }
    if (
      step === 4 &&
      !draft.serviceCategories.length
    ) {
      openStep(2);
      setValidationError(
        "Choose at least one type of work in Plan details before reviewing the enquiry.",
      );
      return false;
    }
    setCompletedSteps((current) => new Set(current).add(step));
    openStep(nextStep);
    return true;
  }

  async function storePendingEvidence(
    projectId: string,
    evidence: PendingProjectEvidence[],
    confirmInstallerSharing: boolean,
    reportRequestProgress?: (
      progress: CustomerInstallerRequestProgress,
    ) => void,
  ) {
    const storedByIndex: Array<CustomerProject["evidence"] | undefined> =
      new Array(evidence.length);
    const photoItems = evidence.filter(
      (item) => item.file.type.startsWith("image/"),
    );
    const photoNumberById = new Map(
      photoItems.map((item, index) => [item.id, index + 1]),
    );
    let nextIndex = 0;
    let firstError: unknown = null;

    const storeNext = async () => {
      while (nextIndex < evidence.length) {
        const index = nextIndex;
        nextIndex += 1;
        const item = evidence[index];
        const photoNumber = photoNumberById.get(item.id);
        if (photoNumber) {
          reportRequestProgress?.({
            phase: "securing-photo",
            current: photoNumber,
            total: photoItems.length,
            progress: 0,
          });
        }
        try {
          const uploaded = await onUploadEvidence(
            projectId,
            [item],
            confirmInstallerSharing,
            (evidenceId, progress) => {
              updateEvidenceUploadProgress(evidenceId, progress);
              if (photoNumber) {
                reportRequestProgress?.({
                  phase: "securing-photo",
                  current: photoNumber,
                  total: photoItems.length,
                  progress: progress.progress,
                });
              }
            },
          );
          if (!uploaded.length) {
            throw new Error(`${item.file.name} did not finish saving.`);
          }
          storedByIndex[index] = uploaded;
          setUploadedEvidence((current) => {
            const merged = new Map(current.map((entry) => [entry.id, entry]));
            uploaded.forEach((entry) => merged.set(entry.id, entry));
            return [...merged.values()];
          });
          setPendingEvidence((current) =>
            current.filter((entry) => entry.id !== item.id),
          );
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : `${item.file.name} could not be saved.`;
          updateEvidenceUploadProgress(item.id, {
            status: "failed",
            progress: item.uploadProgress || 0,
            error: message,
          });
          firstError ||= error;
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(2, evidence.length) },
        () => storeNext(),
      ),
    );
    if (firstError) throw firstError;
    return storedByIndex.flatMap((items) => items || []);
  }

  async function saveDraft() {
    if (professionalReviewError) {
      showProfessionalReviewError();
      return;
    }
    if (planInputsChanged) {
      openStep(3);
      setValidationError(
        "Your home answers changed after you edited the plan. Refresh the suggestions or confirm that you want to keep your edited steps before saving.",
      );
      return;
    }
    if (planSnapshotConflict) {
      openStep(3);
      setValidationError(
        "This saved plan was created by a different advisor version. Reset the advisor suggestions before saving.",
      );
      return;
    }
    const saveGeneration = editGeneration.current;
    setBusy(true);
    setStatus("Saving your draft...");
    try {
      const saved = await onSave(
        draftWithPlan(),
        savedId || undefined,
        savedId ? savedPlanRevision : undefined,
        savedId
          ? undefined
          : createRequestId.current ||= crypto.randomUUID(),
      );
      setSavedId(saved.id);
      setSavedPlanRevision(saved.planRevision);
      const privateEvidence = pendingEvidence.filter(
        (item) => item.sharingScope === "private-plan",
      );
      const pendingInstallerEvidence = pendingEvidence.filter(
        (item) => item.sharingScope === "allocated-installers",
      );
      if (privateEvidence.length) {
        setStatus(
          `Saving ${privateEvidence.length} selected ${
            privateEvidence.length === 1 ? "file" : "files"
          } privately...`,
        );
        await storePendingEvidence(saved.id, privateEvidence, false);
      }
      const noNewerEdits = editGeneration.current === saveGeneration;
      if (noNewerEdits) {
        setDirty(pendingInstallerEvidence.length > 0);
      }
      setRevisionConflict(false);
      setStatus(
        noNewerEdits
          ? pendingInstallerEvidence.length
            ? `Draft saved. ${pendingInstallerEvidence.length} ${
                pendingInstallerEvidence.length === 1 ? "file remains" : "files remain"
              } selected for installer sharing and will not upload until you confirm sharing when requesting responses.`
            : privateEvidence.length
              ? "Draft and selected photos saved privately to your account."
              : "Draft saved to your private account."
          : "Draft saved. Changes made while it was saving are still unsaved.",
      );
    } catch (error) {
      setStatus(describeEditorError(error, "The draft could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  function planShareBlocker() {
    if (professionalReviewError) return professionalReviewError;
    if (planInputsChanged) {
      return "Refresh the advisor suggestions or confirm that you want to keep the edited steps before sharing.";
    }
    if (planSnapshotConflict) {
      return "Reset the advisor suggestions from the older plan version before sharing.";
    }
    if (
      !draft.title.trim()
      || !/^\d{4}$/.test(draft.postcode)
      || !draft.addressState
      || !draft.householdSituation
      || !draft.goals.length
    ) {
      return "Complete the home details and choose at least one goal before sharing the plan.";
    }
    return "";
  }

  async function savePlanForSharing() {
    const blocker = planShareBlocker();
    if (blocker) throw new Error(blocker);
    const saveGeneration = editGeneration.current;
    const saved = await onSave(
      draftWithPlan(),
      savedId || undefined,
      savedId ? savedPlanRevision : undefined,
      savedId
        ? undefined
        : createRequestId.current ||= crypto.randomUUID(),
    );
    const id = saved.id;
    const privatePlanEvidence = pendingEvidence.filter(
      (item) => item.sharingScope === "private-plan",
    );
    const pendingInstallerEvidence = pendingEvidence.filter(
      (item) => item.sharingScope === "allocated-installers",
    );
    if (privatePlanEvidence.length) {
      await storePendingEvidence(id, privatePlanEvidence, false);
    }
    setSavedId(id);
    setSavedPlanRevision(saved.planRevision);
    const noNewerEdits = editGeneration.current === saveGeneration;
    if (noNewerEdits) {
      setDirty(pendingInstallerEvidence.length > 0);
    }
    setRevisionConflict(false);
    setStatus(
      noNewerEdits
        ? pendingInstallerEvidence.length
          ? `Plan saved. ${pendingInstallerEvidence.length} ${
              pendingInstallerEvidence.length === 1 ? "file remains" : "files remain"
            } selected for installer sharing and will not upload until you confirm sharing when requesting responses.`
          : privatePlanEvidence.length
            ? "Plan and its private supporting evidence saved to your account."
            : "Plan saved to your private account."
        : "Plan copy saved. Changes made while it was saving are still unsaved.",
    );
    return id;
  }

  function openShareDialog() {
    const blocker = planShareBlocker();
    if (blocker) {
      setValidationError(blocker);
      return;
    }
    setShareError("");
    setShareStatus("");
    setShareRequestId(crypto.randomUUID());
    setShareDialogOpen(true);
  }

  function openReportPreview() {
    const blocker = planShareBlocker();
    if (blocker) {
      setValidationError(blocker);
      return;
    }
    setValidationError("");
    setReportPreviewOpen(true);
  }

  function reviewHomeDetailsBeforeSharing() {
    setShareDialogOpen(false);
    openStep(2);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = firstUnansweredHomeQuestion
          ? window.document.getElementById(
              `customer-home-feature-${firstUnansweredHomeQuestion.id}`,
            )
          : window.document.getElementById(
              "customer-home-feature-section-comfort",
            );
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
        target?.querySelector<HTMLInputElement>("input")?.focus({
          preventScroll: true,
        });
      });
    });
  }

  async function emailPlan(recipient: string) {
    setShareBusy(true);
    setShareError("");
    setShareStatus("Saving the exact plan before requesting delivery...");
    try {
      const projectId = await savePlanForSharing();
      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) throw new Error("Sign in again to email this plan.");
      const token = await currentUser.getIdToken();
      const response = await fetch("/api/customer-project-plan-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectId,
          recipient,
          consentConfirmed: true,
          requestId: shareRequestId,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(
          result.error || "The plan email request could not be accepted.",
        );
      }
       setShareStatus(
         result.message
         || "Accepted by the email provider. Inbox delivery has not been confirmed.",
       );
    } catch (error) {
      setShareStatus("");
      setShareError(describeEditorError(
        error,
        "The plan email request could not be accepted.",
      ));
    } finally {
      setShareBusy(false);
    }
  }

  function downloadPlanPdf() {
    if (activePdfDownload.current) return;
    const blocker = planShareBlocker();
    if (blocker) {
      setValidationError(blocker);
      return;
    }
    activePdfDownload.current = true;
    setPdfBusy(true);
    setValidationError("");
    try {
      const report = createCustomerPlanReportView(
        shareablePlanDocument,
      );
      downloadCustomerPlanPdf(report);
      setStatus(
        "PDF download requested. Your private draft and evidence were not changed.",
      );
    } catch (error) {
      setStatus("");
      setValidationError(
        error instanceof Error
          ? error.message
          : "The PDF could not be prepared.",
      );
      activePdfDownload.current = false;
      setPdfBusy(false);
      return;
    }
    window.setTimeout(() => {
      activePdfDownload.current = false;
      setPdfBusy(false);
    }, 1_500);
  }

  function openInstallerRequest() {
    if (planInputsChanged) {
      openStep(3);
      setValidationError(
        "Your home answers changed after you edited the plan. Refresh the suggestions or confirm that you want to keep your edited steps before requesting responses.",
      );
      return;
    }
    if (planSnapshotConflict) {
      openStep(3);
      setValidationError(
        "This saved plan was created by a different advisor version. Reset the advisor suggestions before requesting responses.",
      );
      return;
    }
    if (
      !draft.title.trim() ||
      !/^\d{4}$/.test(draft.postcode) ||
      !draft.addressState ||
      !draft.householdSituation
    ) {
      openStep(1);
      setValidationError(
        "Complete the home and project details before requesting responses.",
      );
      return;
    }
    if (!draft.goals.length) {
      openStep(2);
      setValidationError(
        "Choose at least one goal before requesting responses.",
      );
      return;
    }
    if (professionalReviewError) {
      showProfessionalReviewError();
      return;
    }
    if (!draft.serviceCategories.length) {
      openStep(2);
      setValidationError(
        "Choose at least one type of work in Plan details before submitting.",
      );
      return;
    }
    if (
      ![
        draft.propertyContext.storeys,
        draft.propertyContext.ageBand,
        draft.propertyContext.floorArea,
        draft.propertyContext.roofType,
        draft.propertyContext.switchboard,
      ].every(Boolean)
    ) {
      openStep(2);
      setValidationError(
        "Complete the five property questions before requesting responses. Not sure is a valid answer.",
      );
      return;
    }
    if (!emailVerified) {
      setValidationError(
        "Verify your account email before requesting installer responses.",
      );
      return;
    }
    setStatus("");
    setValidationError("");
    setInstallerRequestOpen(true);
  }

  async function completeInstallerRequest(
    contact: CustomerInstallerRequestContact,
    confirmAllProjectPhotoSharing: boolean,
    reportProgress: (progress: CustomerInstallerRequestProgress) => void,
  ) {
    const requestFingerprint = installerRequestFingerprint(
      contact,
      confirmAllProjectPhotoSharing,
    );
    const saveGeneration = editGeneration.current;
    try {
      reportProgress({ phase: "checking-previous-request" });
      const uncertainSubmit = uncertainInstallerSubmit.current;
      if (uncertainSubmit) {
        const submittedProject = await onCheckInstallerRequestSubmitted(
          uncertainSubmit.projectId,
        );
        if (submittedProject) {
          const sameRequest = canRecoverInstallerRequest(uncertainSubmit, {
            projectId: savedId || uncertainSubmit.projectId,
            planRevision: savedPlanRevision,
            editGeneration: editGeneration.current,
            requestFingerprint,
          });
          uncertainInstallerSubmit.current = null;
          if (sameRequest) return;
          await onRequestInstallerResponses(
            uncertainSubmit.projectId,
            uncertainSubmit.planRevision,
            confirmAllProjectPhotoSharing,
            contact,
            false,
          );
          return "Your earlier request was sent, and your latest contact details were saved. Any plan or evidence-sharing changes made after the network interruption were not applied. Review the submitted project from your overview.";
        }
        uncertainInstallerSubmit.current = null;
      }
      reportProgress({ phase: "saving-plan" });
      const saved = await onSave(
        draftWithPlan(),
        savedId || undefined,
        savedId ? savedPlanRevision : undefined,
        savedId
          ? undefined
          : createRequestId.current ||= crypto.randomUUID(),
      );
      setSavedId(saved.id);
      setSavedPlanRevision(saved.planRevision);
      const submissionEvidence = pendingEvidence.map((item) =>
        item.file.type.startsWith("image/")
          ? { ...item, sharingScope: "allocated-installers" as const }
          : item,
      );
      await storePendingEvidence(
        saved.id,
        submissionEvidence,
        confirmAllProjectPhotoSharing,
        reportProgress,
      );
      uncertainInstallerSubmit.current = {
        projectId: saved.id,
        planRevision: saved.planRevision,
        editGeneration: editGeneration.current,
        requestFingerprint,
      };
      reportProgress({ phase: "sending-request" });
      await onRequestInstallerResponses(
        saved.id,
        saved.planRevision,
        confirmAllProjectPhotoSharing,
        contact,
      );
      uncertainInstallerSubmit.current = null;
      if (editGeneration.current === saveGeneration) setDirty(false);
      setRevisionConflict(false);
    } catch (error) {
      throw new Error(describeEditorError(
        error,
        "The enquiry could not be submitted.",
      ));
    }
  }

  const propertyLabel = optionLabel(
    customerProjectOptions.propertyTypes,
    draft.propertyType,
  );
  const categoryLabels = draft.serviceCategories.map((item) =>
    optionLabel(customerProjectOptions.serviceCategories, item),
  );
  const homeContextLabels = [
    optionLabel(
      customerProjectOptions.storeys,
      draft.propertyContext.storeys,
    ),
    optionLabel(
      customerProjectOptions.ageBands,
      draft.propertyContext.ageBand,
    ),
    optionLabel(
      customerProjectOptions.floorAreas,
      draft.propertyContext.floorArea,
    ),
    optionLabel(
      customerProjectOptions.roofTypes,
      draft.propertyContext.roofType,
    ),
    optionLabel(
      customerProjectOptions.switchboards,
      draft.propertyContext.switchboard,
    ),
  ].filter(Boolean);
  const goalLabels = draft.goals.map((item) =>
    optionLabel(customerProjectOptions.goals, item),
  );
  const siteConsiderationLabels = [
    draft.propertyContext.approvalContext === "strata"
      ? "Strata, owners corporation or common-property approval may apply"
      : draft.propertyContext.approvalContext === "not_sure"
        ? "Approval requirements are not confirmed"
        : "",
    ...draft.propertyContext.accessConstraints.map((item) =>
      optionLabel(customerProjectOptions.accessConstraints, item),
    ),
  ].filter(Boolean);
  const installerPreview = buildAnonymizedOpportunity(
    draftWithPlan(),
    "customer-preview",
  );
  const stepReadiness = [1, 2, 3, 4, 5].map(isStepReady);
  const stepIsComplete = (stepNumber: number) =>
    Boolean(
      stepReadiness[stepNumber - 1]
      && (
        completedSteps.has(stepNumber)
        || (Boolean(savedId) && stepNumber <= 2)
      ),
    );
  const completedStepCount = stepReadiness.filter(
    (_ready, index) => stepIsComplete(index + 1),
  ).length;
  return (
    <section
      className="customer-project-editor"
      aria-labelledby="project-editor-title"
    >
      <header className="customer-editor-header">
        <div>
          <span>
            {savedId ? "Edit your saved project" : "Create a home project"}
          </span>
          <h1 id="project-editor-title">
            {draft.title || "Build a simple project plan"}
          </h1>
          <p>
            Answer one small step at a time. Save whenever you want and come
            back later.
          </p>
        </div>
        <button type="button" onClick={onCancel}>
          Exit project
        </button>
      </header>
      <nav
        className="customer-stepper"
        aria-label="Project builder steps"
      >
        <div style={{ width: `${completedStepCount * 20}%` }} />
        <ol>
          {["Home", "Plan details", "Your roadmap", "Quote prep", "Privacy"].map(
            (label, index) => {
              const stepNumber = index + 1;
              const complete = stepIsComplete(stepNumber);
              const active = step === stepNumber;
              return (
                <li
                  className={[
                    active ? "active" : "",
                    complete ? "complete" : "",
                  ].filter(Boolean).join(" ")}
                  key={label}
                >
                  <button
                    type="button"
                    aria-current={active ? "step" : undefined}
                    aria-label={`${label}${complete ? ", complete" : ""}${active ? ", current step" : ""}`}
                    onClick={() => openStep(stepNumber)}
                  >
                    <span aria-hidden="true">
                      {complete && !active ? "✓" : stepNumber}
                    </span>
                    {label}
                  </button>
                </li>
              );
            },
          )}
        </ol>
      </nav>
      {status && (
        <p className="customer-editor-status" role="alert">
          {status}
        </p>
      )}
      {revisionConflict && (
        <section className="customer-plan-conflict-warning" role="alert">
          <strong>A newer saved version is available</strong>
          <p>
            Your unsaved edits are still on this screen. Review them first.
            Loading the latest saved version will discard only these unsaved
            edits.
          </p>
          <button
            type="button"
            disabled={busy || shareBusy || pdfBusy}
            onClick={() => {
              setRevisionConflict(false);
              onReloadLatest();
            }}
          >
            Discard my unsaved edits and load the latest saved version
          </button>
        </section>
      )}
      <div className="customer-editor-body">
        {step === 1 && (
          <section className="customer-editor-step">
            <div className="customer-step-heading">
              <span>Step 1</span>
              <h2>Which home and project is this?</h2>
              <p>
                Start with whether you own or rent. That changes which actions
                you can take yourself and which may need permission.
              </p>
            </div>
            <fieldset className="customer-choice-group first-question">
              <legend>Do you own or rent this home?</legend>
              <div className="customer-choice-grid compact">
                {customerProjectOptions.situations.map(([value, label]) => (
                  <label
                    className={
                      draft.householdSituation === value ? "selected" : ""
                    }
                    key={value}
                  >
                    <input
                      id={`customer-situation-${value}`}
                      type="radio"
                      name="customer-situation"
                      checked={draft.householdSituation === value}
                      onChange={() => set("householdSituation", value)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <p className="customer-choice-help">
                {draft.householdSituation === "renter"
                  ? "Your plan will lead with portable or reversible actions and flag changes that may need the owner’s permission."
                  : "This answer helps separate actions you control from work that needs another approval."}
              </p>
            </fieldset>
            <div className="customer-field-grid">
              <Field label="Private project name">
                <input
                  value={draft.title}
                  onChange={(event) => set("title", event.target.value)}
                  placeholder="Example: Winter comfort plan"
                />
              </Field>
              <Field label="Home nickname">
                <input
                  value={draft.homeNickname}
                  onChange={(event) => set("homeNickname", event.target.value)}
                  placeholder="My home"
                />
              </Field>
              <p className="customer-private-field-note">
                Project names and home nicknames stay inside your account.
                Installers do not receive them.
              </p>
              <Field label="Project postcode">
                <input
                  value={draft.postcode}
                  onChange={(event) =>
                    set(
                      "postcode",
                      event.target.value.replace(/\D/g, "").slice(0, 4),
                    )
                  }
                  inputMode="numeric"
                  maxLength={4}
                />
              </Field>
              <Field label="State or territory">
                <select
                  value={draft.addressState}
                  onChange={(event) => set("addressState", event.target.value)}
                >
                  <option value="">Choose one</option>
                  {customerProjectOptions.states.map((state: string) => (
                    <option key={state}>{state}</option>
                  ))}
                </select>
              </Field>
              <Field label="Property type">
                <select
                  value={draft.propertyType}
                  onChange={(event) => set("propertyType", event.target.value)}
                >
                  {customerProjectOptions.propertyTypes.map(
                    ([value, label]: [string, string]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <Field
                label="Strata or common-property approval"
                hint="This can apply whether you own or rent, especially for apartments, units and some townhouses."
              >
                <select
                  id="customer-approval-context"
                  value={draft.propertyContext.approvalContext}
                  onChange={(event) =>
                    setPropertyContext(
                      "approvalContext",
                      event.target.value,
                    )
                  }
                >
                  {customerProjectOptions.approvalContexts.map(
                    ([value, label]: [string, string]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </Field>
            </div>
          </section>
        )}
        {step === 2 && (
          <section className="customer-editor-step">
            <div className="customer-step-heading">
              <span>Step 2</span>
              <h2>Tell us what should shape your roadmap</h2>
              <p>
                Choose your goals and add the home details you safely know.
                These answers can change what comes first. Not sure is always
                a valid answer.
              </p>
            </div>
            <fieldset className="customer-choice-group">
              <legend>Main goals, choose all that apply</legend>
              <div className="customer-choice-grid">
                {customerProjectOptions.goals.map(
                  ([value, label]: [string, string]) => (
                    <label
                      className={
                        draft.goals.includes(value) ? "selected" : ""
                      }
                      key={value}
                    >
                      <input
                        type="checkbox"
                        checked={draft.goals.includes(value)}
                        onChange={() => toggleGoal(value)}
                      />
                      <span>{label}</span>
                    </label>
                  ),
                )}
              </div>
            </fieldset>
            <section
              id="customer-roadmap-home-basics"
              className="customer-roadmap-input-panel"
              aria-labelledby="customer-roadmap-home-basics-title"
            >
              <header>
                <span>Home planning context</span>
                <h3 id="customer-roadmap-home-basics-title">
                  Home details that can change the roadmap
                </h3>
                <p>
                  These broad details guide the order, checks and quote
                  preparation. They do not calculate equipment size, cost or
                  savings.
                </p>
              </header>
              <div className="customer-field-grid customer-property-context-grid">
                <Field
                  label="How many storeys?"
                  hint="Helps flag safe access and possible scaffolding."
                >
                  <select
                    id="customer-property-storeys"
                    value={draft.propertyContext.storeys}
                    onChange={(event) =>
                      setPropertyContext("storeys", event.target.value)
                    }
                  >
                    <option value="">Choose one</option>
                    {customerProjectOptions.storeys.map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="When was the home built?"
                  hint="Helps identify construction details worth checking. It does not assume what insulation or wiring exists."
                >
                  <select
                    id="customer-property-age"
                    value={draft.propertyContext.ageBand}
                    onChange={(event) =>
                      setPropertyContext("ageBand", event.target.value)
                    }
                  >
                    <option value="">Choose one</option>
                    {customerProjectOptions.ageBands.map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Approximate floor area"
                  hint="Provides broad scale only. It is not enough to size equipment."
                >
                  <select
                    id="customer-property-floor-area"
                    value={draft.propertyContext.floorArea}
                    onChange={(event) =>
                      setPropertyContext("floorArea", event.target.value)
                    }
                  >
                    <option value="">Choose one</option>
                    {customerProjectOptions.floorAreas.map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Main roof covering"
                  hint="Changes solar, insulation and safe roof-access questions."
                >
                  <select
                    id="customer-property-roof"
                    value={draft.propertyContext.roofType}
                    onChange={(event) =>
                      setPropertyContext("roofType", event.target.value)
                    }
                  >
                    <option value="">Choose one</option>
                    {customerProjectOptions.roofTypes.map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Switchboard type"
                  hint="Changes when electrical capacity and licensed safety checks should happen."
                >
                  <select
                    id="customer-property-switchboard"
                    value={draft.propertyContext.switchboard}
                    onChange={(event) =>
                      setPropertyContext("switchboard", event.target.value)
                    }
                  >
                    <option value="">Choose one</option>
                    {customerProjectOptions.switchboards.map(
                      ([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </Field>
              </div>
              <div className="customer-question-help-grid">
                <details className="customer-question-help">
                  <summary>Home height and floor area</summary>
                  <p>
                    Count the main levels above ground. For floor area, a broad
                    estimate from a plan, listing or memory is enough.
                  </p>
                </details>
                <details className="customer-question-help">
                  <summary>Roof covering</summary>
                  <p>
                    Choose the main visible roof covering, such as metal or
                    tiles. A safely taken exterior or satellite image can help.
                  </p>
                </details>
                <details className="customer-question-help">
                  <summary>Switchboard</summary>
                  <p>
                    A front photo with the normal door open is enough. Never
                    remove the internal panel or touch wiring.
                  </p>
                </details>
                <details className="customer-question-help">
                  <summary>Not sure is a useful answer</summary>
                  <p>
                    Not sure tells the advisor or trade what to confirm instead
                    of encouraging a guess.
                  </p>
                </details>
              </div>
            </section>
            <section className="customer-choice-group">
              <h3>What describes the home today?</h3>
              <p className="customer-choice-help">
                Work through the categories below. Each question has a clear
                answer or a safe Not sure option, so you do not need to guess.
              </p>
              <div className="customer-home-fact-readiness" aria-live="polite">
                <div>
                  <strong>
                    {answeredHomeQuestionCount} of {homeFeatureQuestions.length}
                    {" "}home questions completed
                  </strong>
                  <p>
                    {notSureHomeQuestionCount
                      ? `${notSureHomeQuestionCount} marked Not sure. That is valid and shows what may need checking later.`
                      : "Answers are recorded as household supplied, not professionally verified."}
                  </p>
                </div>
                {answeredHomeQuestionCount < homeFeatureQuestions.length && (
                  <button
                    type="button"
                    onClick={markUnansweredHomeQuestionsNotSure}
                  >
                    Mark remaining questions Not sure
                  </button>
                )}
              </div>
              <HomeFeatureIntake
                idPrefix="customer-home-feature"
                selected={draft.existingFeatures}
                onChange={(next) => set("existingFeatures", next)}
              />
            </section>
            <details className="customer-question-help">
              <summary>How can I tell what glazing or insulation I have?</summary>
              <div>
                <p>
                  Double glazing usually has a visible spacer at the glass
                  edge, but homes can contain a mix. Insulation may be recorded
                  on plans, invoices or an earlier assessment.
                </p>
                <p>
                  Do not enter a roof space, remove a cover or guess. Choose Not
                  sure and add a safe photo or document later if useful.
                </p>
              </div>
            </details>
            <fieldset
              id="customer-considered-work"
              className="customer-choice-group customer-considered-work"
            >
              <legend>Work you are already considering, optional</legend>
              <p className="customer-choice-help">
                Select anything already on your mind. It can add the relevant
                neutral checks to the roadmap, but it does not commit you to a
                quote, product or trade.
              </p>
              <div className="customer-choice-grid">
                {customerProjectOptions.serviceCategories.map(
                  ([value, label]: [string, string]) => (
                    <label
                      className={
                        draft.serviceCategories.includes(value)
                          ? "selected"
                          : ""
                      }
                      key={value}
                    >
                      <input
                        type="checkbox"
                        checked={draft.serviceCategories.includes(value)}
                        onChange={() => toggle("serviceCategories", value)}
                      />
                      <span>{label}</span>
                    </label>
                  ),
                )}
              </div>
            </fieldset>
            <section
              id="customer-professional-review"
              className={`customer-professional-review${
                draft.advisorProfile.professionalReview ? " is-enabled" : ""
              }`}
              aria-labelledby="customer-professional-review-title"
            >
              <header>
                <div>
                  <span>Optional professional review</span>
                  <h3 id="customer-professional-review-title">
                    Preparing this plan as an accredited adviser?
                  </h3>
                  <p>
                    Add a self-declared review to the customer email and print
                    copy. It stays out of installer matching and does not make
                    this a NatHERS assessment.
                  </p>
                </div>
                <label className="customer-professional-review-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(
                      draft.advisorProfile.professionalReview,
                    )}
                    onChange={(event) =>
                      setProfessionalReviewEnabled(event.target.checked)
                    }
                  />
                  <span>
                    I am an accredited energy or home-comfort adviser and I
                    reviewed these home answers
                  </span>
                </label>
              </header>
              {draft.advisorProfile.professionalReview && (
                <div className="customer-professional-review-fields">
                  <label>
                    <span>Adviser role</span>
                    <select
                      id="customer-professional-review-role"
                      value={draft.advisorProfile.professionalReview.role}
                      onChange={(event) =>
                        updateProfessionalReview({ role: event.target.value })
                      }
                    >
                      {customerAdvisorOptions.professionalRoles.map(
                        ([value, label]) => (
                          <option value={value} key={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    <span>Adviser name</span>
                    <input
                      id="customer-professional-review-name"
                      type="text"
                      autoComplete="name"
                      maxLength={80}
                      value={
                        draft.advisorProfile.professionalReview.adviserName
                      }
                      onChange={(event) =>
                        updateProfessionalReview({
                          adviserName: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Accreditation scheme or professional body</span>
                    <input
                      id="customer-professional-review-scheme"
                      type="text"
                      maxLength={120}
                      value={
                        draft.advisorProfile.professionalReview
                          .accreditationScheme
                      }
                      onChange={(event) =>
                        updateProfessionalReview({
                          accreditationScheme: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Accreditation or membership reference</span>
                    <input
                      id="customer-professional-review-reference"
                      type="text"
                      maxLength={80}
                      value={
                        draft.advisorProfile.professionalReview
                          .accreditationReference
                      }
                      onChange={(event) =>
                        updateProfessionalReview({
                          accreditationReference: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="customer-professional-review-notes">
                    <span>Adviser notes for the customer report</span>
                    <textarea
                      maxLength={1200}
                      rows={5}
                      placeholder="Add relevant observations, limitations or details the household should keep with this plan."
                      value={draft.advisorProfile.professionalReview.notes}
                      onChange={(event) =>
                        updateProfessionalReview({ notes: event.target.value })
                      }
                    />
                    <small>
                      These notes appear in emailed and printed plan copies.
                      They do not enter installer matching or the private review
                      worksheet.
                    </small>
                  </label>
                  <label className="customer-professional-review-declaration">
                    <input
                      id="customer-professional-review-declaration"
                      type="checkbox"
                      checked={
                        draft.advisorProfile.professionalReview
                          .declarationAccepted
                      }
                      onChange={(event) =>
                        updateProfessionalReview({
                          declarationAccepted: event.target.checked,
                        })
                      }
                    />
                    <span>
                      I confirm these are my details and I reviewed the home
                      answers. Australian Energy Assessments has not checked my
                      identity, accreditation, reference or observations and
                      does not endorse this as an assessment.
                    </span>
                  </label>
                  {validationError === professionalReviewError
                    && professionalReviewError && (
                    <p className="customer-professional-review-error" role="alert">
                      {professionalReviewError}
                    </p>
                  )}
                </div>
              )}
            </section>
            <section
              className="customer-room-profile"
              aria-labelledby="room-profile-title"
            >
              <header>
                <div>
                  <span>Optional detail</span>
                  <h3 id="room-profile-title">Room-by-room comfort profile</h3>
                  <p>
                    Add only rooms where heat, cold, draughts, moisture or use
                    patterns could change the advice. Private room names are not
                    sent to installers.
                  </p>
                </div>
                <button id="customer-add-room" type="button" onClick={addRoom}>
                  Add a room
                </button>
              </header>
              {draft.advisorProfile.rooms.length > 0 ? (
                <div className="customer-room-list">
                  {draft.advisorProfile.rooms.map((room, roomIndex) => (
                    <article key={room.id}>
                      <header>
                        <strong>Room {roomIndex + 1}</strong>
                        <button type="button" onClick={() => removeRoom(room.id)}>
                          Remove
                        </button>
                      </header>
                      <div className="customer-room-basics">
                        <label>
                          <span>Private room label</span>
                          <input
                            value={room.name}
                            maxLength={60}
                            onChange={(event) =>
                              updateRoom(room.id, {
                                name: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          <span>Room type</span>
                          <select
                            value={room.roomType}
                            onChange={(event) =>
                              updateRoom(room.id, {
                                roomType: event.target.value,
                              })
                            }
                          >
                            {customerAdvisorOptions.roomTypes.map(
                              ([value, roomLabel]) => (
                                <option value={value} key={value}>
                                  {roomLabel}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                      </div>
                      <fieldset>
                        <legend>What happens here?</legend>
                        <div className="customer-room-options">
                          {customerAdvisorOptions.comfortConcerns.map(
                            ([value, concernLabel]) => (
                              <label
                                className={
                                  room.concerns.includes(value) ? "selected" : ""
                                }
                                key={value}
                              >
                                <input
                                  type="checkbox"
                                  checked={room.concerns.includes(value)}
                                  onChange={() =>
                                    toggleRoomValue(
                                      room.id,
                                      "concerns",
                                      value,
                                    )
                                  }
                                />
                                <span>{concernLabel}</span>
                              </label>
                            ),
                          )}
                        </div>
                      </fieldset>
                      <fieldset>
                        <legend>When does this room matter most?</legend>
                        <div className="customer-room-options">
                          {customerAdvisorOptions.usePeriods.map(
                            ([value, periodLabel]) => (
                              <label
                                className={
                                  room.usePeriods.includes(value)
                                    ? "selected"
                                    : ""
                                }
                                key={value}
                              >
                                <input
                                  type="checkbox"
                                  checked={room.usePeriods.includes(value)}
                                  onChange={() =>
                                    toggleRoomValue(
                                      room.id,
                                      "usePeriods",
                                      value,
                                    )
                                  }
                                />
                                <span>{periodLabel}</span>
                              </label>
                            ),
                          )}
                        </div>
                      </fieldset>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="customer-room-empty">
                  No rooms added. The advisor can still build a whole-home plan.
                </p>
              )}
            </section>
            <div className="customer-budget-question">
              <div>
                <span>Planning range</span>
                <h3>What budget should the plan work around?</h3>
                <p>
                  This only changes sequence and scope. It is not a price
                  estimate, savings promise or claim that an upgrade will fit.
                </p>
              </div>
              <select
                id="customer-budget-range"
                aria-label="Private planning budget"
                value={draft.budgetRange}
                onChange={(event) => set("budgetRange", event.target.value)}
              >
                {customerProjectOptions.budgets.map(
                  ([value, label]: [string, string]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </div>
            <fieldset className="customer-choice-group">
              <legend>Preferred pace</legend>
              <div className="customer-choice-grid compact">
                {customerProjectOptions.paces.map(
                  ([value, label]: [string, string]) => (
                    <label
                      className={draft.pace === value ? "selected" : ""}
                      key={value}
                    >
                      <input
                        type="radio"
                        name="customer-pace"
                        checked={draft.pace === value}
                        onChange={() => set("pace", value)}
                      />
                      <span>{label}</span>
                    </label>
                  ),
                )}
              </div>
            </fieldset>
            {draft.householdSituation === "renter" && (
              <div className="customer-guidance-note renter">
                <strong>Renter-friendly ideas come first</strong>
                <p>
                  Your starting plan can include layers and electric throws,
                  draught snakes, removable window insulation or solar-control
                  screens, portable fans and suitable portable induction
                  cooking. Fixed sealing, vent covers and installed equipment
                  still need permission and a safety check where relevant.
                </p>
              </div>
            )}
          </section>
        )}
        {step === 3 && (
          <section className="customer-editor-step">
            <div className="customer-step-heading">
              <span>Your home energy roadmap</span>
              <h2>{advisorPlan.title}</h2>
              <p>
                Built from your goals, home details, considered work, budget
                and preferred pace. The order can change when you update those
                answers or add better evidence. {advisorPlan.summary}
              </p>
            </div>
            <section
              className="customer-roadmap-basis"
              aria-labelledby="customer-roadmap-basis-title"
            >
              <header>
                <span>What shaped this roadmap</span>
                <h3 id="customer-roadmap-basis-title">
                  Your answers are carried into the plan
                </h3>
              </header>
              <dl>
                <div>
                  <dt>Goals</dt>
                  <dd>{goalLabels.join(", ") || "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Home and tenure</dt>
                  <dd>
                    {propertyLabel},{" "}
                    {optionLabel(
                      customerProjectOptions.situations,
                      draft.householdSituation,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Home details</dt>
                  <dd>{homeContextLabels.join(", ") || "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Current home answers</dt>
                  <dd>
                    {answeredHomeQuestionCount} of{" "}
                    {homeFeatureQuestions.length} categories answered
                  </dd>
                </div>
                <div>
                  <dt>Work being considered</dt>
                  <dd>
                    {categoryLabels.join(", ")
                      || "No work type selected yet"}
                  </dd>
                </div>
                <div>
                  <dt>Budget and pace</dt>
                  <dd>
                    {optionLabel(
                      customerProjectOptions.budgets,
                      draft.budgetRange,
                    )},{" "}
                    {optionLabel(
                      customerProjectOptions.paces,
                      draft.pace,
                    )}
                  </dd>
                </div>
              </dl>
              {notSureHomeQuestionCount > 0 && (
                <p>
                  {notSureHomeQuestionCount} home answer
                  {notSureHomeQuestionCount === 1 ? "" : "s"} remain Not sure.
                  They stay visible as things to check, not reasons to guess.
                </p>
              )}
            </section>
            {planningClimate && (
              <aside className="customer-climate-profile">
                <div>
                  <span>Broad postcode planning guide</span>
                  <h3>{planningClimate.label}</h3>
                  <p>{planningClimate.summary}</p>
                </div>
                <ul>
                  {planningClimate.priorities.map((priority) => (
                    <li key={priority}>{priority}</li>
                  ))}
                </ul>
                <small>{planningClimate.disclaimer}</small>
              </aside>
            )}
            {(advisorPlan.nextQuestions as CustomerPlanQuestion[]).length > 0 && (
              <section
                className="customer-next-questions"
                aria-labelledby="customer-next-questions-title"
              >
                <header>
                  <span>Best next information</span>
                  <h3 id="customer-next-questions-title">
                    Up to three questions that could change the plan
                  </h3>
                  <p>
                    Not sure is a valid answer. These questions reuse your
                    existing private inputs and never require unsafe inspection.
                  </p>
                </header>
                <ol>
                  {(advisorPlan.nextQuestions as CustomerPlanQuestion[]).map(
                    (question) => (
                      <li key={question.id}>
                        <div>
                          <strong>{question.prompt}</strong>
                          <p>{question.whyItMatters}</p>
                          <small>Not sure is allowed</small>
                        </div>
                        <button
                          type="button"
                          onClick={() => openPlanQuestion(question)}
                        >
                          Review this answer
                        </button>
                      </li>
                    ),
                  )}
                </ol>
              </section>
            )}
            {planInputsChanged && (
              <div className="customer-plan-change-warning" role="status">
                <strong>Your edited plan is preserved</strong>
                <p>
                  You changed an answer that can affect the advice. Refresh the
                  suggestions to rebuild the plan, or confirm that you want to
                  keep your current removals, order and private notes. Steps
                  that are no longer part of the new advice stay as private
                  items without an advisor link.
                </p>
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setPlanItems(
                        advisorPlan.items as CustomerPlanItem[],
                      );
                      setPlanEdited(false);
                      setPlanInputsChanged(false);
                      setPlanSnapshotConflict(false);
                      invalidateStepsFrom(3);
    markDirty();
                      setValidationError("");
                    }}
                  >
                    Refresh advisor suggestions
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlanItems(
                        preserveEditedPlanItems(
                          visiblePlanItems,
                          advisorPlan.items,
                        ) as CustomerPlanItem[],
                      );
                      setPlanEdited(true);
                      setPlanInputsChanged(false);
                      invalidateStepsFrom(3);
                      markDirty();
                      setValidationError("");
                    }}
                  >
                    Keep my edited steps
                  </button>
                </div>
              </div>
            )}
            {everydayActions.length > 0 && (
              <section
                className="customer-everyday-actions"
                aria-labelledby="customer-everyday-actions-title"
              >
                <header>
                  <span>Useful alongside the roadmap</span>
                  <h3 id="customer-everyday-actions-title">
                    Helpful things you can try now
                  </h3>
                  <p>{everydayActionsBoundary}</p>
                </header>
                <div>
                  {everydayActions.map((action) => (
                    <article key={action.id}>
                      <small>{action.category}</small>
                      <h4>{action.title}</h4>
                      <p>{action.text}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
            <div className="customer-plan-toolbar">
              <p>
                Drag steps into your preferred order, use the arrow buttons on
                touch or keyboard, or remove anything that does not apply.
              </p>
              <div className="customer-plan-toolbar-actions">
                <button
                  type="button"
                  disabled={busy || shareBusy || pdfBusy}
                  onClick={openReportPreview}
                >
                  Preview full report
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={!emailVerified || busy || shareBusy || pdfBusy}
                  onClick={openShareDialog}
                >
                  {emailVerified
                    ? "Email this plan"
                    : "Verify email to send"}
                </button>
                <button
                  type="button"
                  disabled={busy || shareBusy || pdfBusy}
                  onClick={downloadPlanPdf}
                >
                  {pdfBusy ? "Starting download..." : "Download PDF"}
                </button>
                {(planEdited || planSnapshotConflict) && (
                  <button
                    type="button"
                    disabled={busy || shareBusy || pdfBusy}
                    onClick={resetAdvisorSuggestions}
                  >
                    Reset advisor suggestions
                  </button>
                )}
              </div>
            </div>
            <ol className="customer-roadmap-preview">
              {visiblePlanItems.map((item, index) => (
                  <li
                    draggable
                    onDragStart={() => {
                      draggedPlanItem.current = item.id;
                    }}
                    onDragEnd={() => {
                      draggedPlanItem.current = "";
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => dropPlanItem(item.id)}
                    key={item.id}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <small>{item.stage}</small>
                      <h3>{item.title}</h3>
                      <p>{item.text}</p>
                      {item.href && item.action && (
                        <a href={item.href} target="_blank" rel="noreferrer">
                          {item.action}
                        </a>
                      )}
                      {item.guidance && (
                        <details className="customer-plan-rationale">
                          <summary>Why this is in your plan</summary>
                          <div>
                            <section>
                              <strong>Based on</strong>
                              <ul>
                                {item.guidance.basedOn.map((reason) => (
                                  <li key={reason}>{reason}</li>
                                ))}
                              </ul>
                            </section>
                            <section>
                              <strong>Still uncertain</strong>
                              <ul>
                                {item.guidance.stillUncertain.map((reason) => (
                                  <li key={reason}>{reason}</li>
                                ))}
                              </ul>
                            </section>
                            <section>
                              <strong>Could change if</strong>
                              <ul>
                                {item.guidance.reconsiderIf.map((reason) => (
                                  <li key={reason}>{reason}</li>
                                ))}
                              </ul>
                            </section>
                          </div>
                        </details>
                      )}
                    </div>
                    <div className="customer-plan-item-actions">
                      <button
                        type="button"
                        aria-label={`Move ${item.title} earlier`}
                        onClick={() => movePlanItem(item.id, -1)}
                        disabled={index === 0}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${item.title} later`}
                        onClick={() => movePlanItem(item.id, 1)}
                        disabled={index === visiblePlanItems.length - 1}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="remove"
                        aria-label={`Remove ${item.title} from the plan`}
                        onClick={() =>
                          updatePlanItems(
                            visiblePlanItems.filter(
                              (entry) => entry.id !== item.id,
                            ),
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
            </ol>
            {!visiblePlanItems.length && (
              <div className="customer-plan-empty">
                <strong>Your plan is empty</strong>
                <p>
                  Add a home-specific step below or reset the advisor
                  suggestions.
                </p>
              </div>
            )}
            <div className="customer-plan-add">
              <div>
                <span>Add a home-specific step</span>
                <strong>Include something unique to this home or budget</strong>
              </div>
              <input
                value={customPlanItem}
                maxLength={160}
                placeholder="Example: Ask strata about external shading approval"
                aria-label="Home-specific plan step"
                onChange={(event) => setCustomPlanItem(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  addCustomPlanItem();
                }}
              />
              <button type="button" onClick={addCustomPlanItem}>
                Add to plan
              </button>
            </div>
            <section
              className="customer-review-workspace"
              aria-labelledby="customer-review-title"
            >
              <header>
                <div>
                  <span>Private review worksheet</span>
                  <h3 id="customer-review-title">
                    Record questions and feedback without changing the plan
                  </h3>
                  <p>
                    Everything here is labelled Recorded by you. It does not
                    claim that an assessor authored, approved or verified the
                    wording, and it is excluded from shared plan documents.
                  </p>
                </div>
                <small>
                  {draft.advisorProfile.reviewItems.length} of 20 recorded
                </small>
              </header>
              <div className="customer-review-compose">
                <label>
                  <span>What are you recording?</span>
                  <select
                    value={reviewKind}
                    onChange={(event) =>
                      setReviewKind(event.target.value as CustomerReviewKind)
                    }
                  >
                    {customerReviewOptions.kinds.map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>What does it relate to?</span>
                  <select
                    value={reviewTarget}
                    onChange={(event) => setReviewTarget(event.target.value)}
                  >
                    <option value="general">The overall plan</option>
                    <optgroup label="Home facts">
                      {customerAdvisorOptions.factKeys.map(
                        ([factKey, factLabel]) => (
                          <option value={`fact:${factKey}`} key={factKey}>
                            {factLabel}
                          </option>
                        ),
                      )}
                    </optgroup>
                    <optgroup label="Plan steps">
                      {visiblePlanItems.map((item) => (
                        <option
                          value={`plan-item:${item.id}`}
                          key={item.id}
                        >
                          {item.title}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </label>
                <label className="customer-review-text">
                  <span>Recorded by you</span>
                  <textarea
                    value={reviewText}
                    maxLength={500}
                    rows={3}
                    placeholder="Example: Ask whether the window frames should be repaired before choosing coverings or glazing."
                    onChange={(event) => setReviewText(event.target.value)}
                  />
                </label>
                <button type="button" onClick={addReviewItem}>
                  Record privately
                </button>
              </div>
              {draft.advisorProfile.reviewItems.length > 0 ? (
                <div className="customer-review-list">
                  {draft.advisorProfile.reviewItems.map((item) => (
                    <article key={item.id}>
                      <div>
                        <span>Recorded by you</span>
                        <strong>
                          {optionLabel(customerReviewOptions.kinds, item.kind)}
                        </strong>
                        <p>{item.text}</p>
                      </div>
                      <label>
                        <span>Status</span>
                        <select
                          value={item.status}
                          onChange={(event) =>
                            updateReviewItem(item.id, {
                              status: event.target
                                .value as CustomerReviewStatus,
                            })
                          }
                        >
                          {customerReviewOptions.statuses.map(
                            ([value, label]) => (
                              <option value={value} key={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <div className="customer-review-actions">
                        {item.kind === "proposed-change"
                          && item.status === "accepted" && (
                            <button
                              type="button"
                              onClick={() => addAcceptedReviewToPlan(item)}
                            >
                              Add as private plan step
                            </button>
                          )}
                        <button
                          type="button"
                          className="remove"
                          onClick={() => removeReviewItem(item.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="customer-review-empty">
                  No review items recorded. This worksheet is optional and
                  remains private to your signed-in project.
                </p>
              )}
            </section>
            <section
              className="customer-permission-pack"
              aria-labelledby="permission-pack-title"
            >
              <header>
                <div>
                  <span>Renter and strata planning</span>
                  <h3 id="permission-pack-title">Property permission checklist</h3>
                  <p>
                    Build a neutral review list from the plan. New items start as
                    Not sure. Confirm the proposal with the owner, agent, strata
                    or owners corporation before treating approval as complete.
                  </p>
                </div>
                <button type="button" onClick={buildPermissionChecklist}>
                  Build from current plan
                </button>
              </header>
              {draft.advisorProfile.permissionItems.length > 0 ? (
                <>
                  <div className="customer-permission-items">
                    {draft.advisorProfile.permissionItems.map((item) => (
                      <article key={item.id}>
                        <strong>{item.title}</strong>
                        <label>
                          <span>Permission class</span>
                          <select
                            value={item.classification}
                            onChange={(event) =>
                              updatePermissionItem(item.id, {
                                classification: event.target
                                  .value as PermissionClassification,
                              })
                            }
                          >
                            {customerAdvisorOptions.permissionClasses.map(
                              ([value, classLabel]) => (
                                <option value={value} key={value}>
                                  {classLabel}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                        <label>
                          <span>Private question or approval note, optional</span>
                          <input
                            value={item.note}
                            maxLength={240}
                            onChange={(event) =>
                              updatePermissionItem(item.id, {
                                note: event.target.value,
                              })
                            }
                            placeholder="Saved in this project; not copied into the download"
                          />
                        </label>
                      </article>
                    ))}
                  </div>
                  <div
                    className="customer-permission-preview"
                    aria-label="Permission checklist preview"
                  >
                    <strong>Review what the download will contain</strong>
                    <p>
                      These five sections combine your tenure, approval context,
                      current plan, evidence gaps and classifications. They flag
                      questions and checks; they do not grant permission. Any
                      optional approval note stays in this signed-in project and
                      is replaced by a private-note reminder in the download.
                    </p>
                    <div>
                      {permissionPackPreview.sections.map((section) => (
                        <details key={section.classification}>
                          <summary>
                            {section.label}{" "}
                            <span>{section.items.length}</span>
                          </summary>
                          {section.items.length > 0 ? (
                            <ul>
                              {section.items.map((item) => (
                                <li key={item.id}>
                                  <strong>{item.title}</strong>
                                  {item.note && <span>{item.note}</span>}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>No items listed.</p>
                          )}
                        </details>
                      ))}
                    </div>
                    <small>{permissionPackPreview.disclaimer}</small>
                  </div>
                  <button
                    type="button"
                    className="customer-permission-download"
                    onClick={() =>
                      downloadPermissionPack(draftWithPlan().advisorProfile, {
                        householdSituation: draft.householdSituation,
                        approvalContext:
                          draft.propertyContext.approvalContext,
                        planItems: visiblePlanItems,
                      })
                    }
                  >
                    Download permission checklist
                  </button>
                </>
              ) : (
                <p className="customer-permission-empty">
                  Build the checklist after reviewing the plan. The download
                  excludes your project location, private plan wording and
                  approval-note wording.
                </p>
              )}
            </section>
            <div className="customer-guidance-note">
              <strong>Keep this plan even if you do not request prices</strong>
              <p>
                Save it, tick off completed steps and keep private notes.
                Installer options are completely optional and start only after
                the privacy check.
              </p>
            </div>
            <div className="customer-plan-toolbar customer-plan-toolbar-bottom">
              <p>
                Finished reviewing the roadmap? Preview it, email it or download
                a PDF without scrolling back to the top.
              </p>
              <div className="customer-plan-toolbar-actions">
                <button
                  type="button"
                  disabled={busy || shareBusy || pdfBusy}
                  onClick={openReportPreview}
                >
                  Preview full report
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={!emailVerified || busy || shareBusy || pdfBusy}
                  onClick={openShareDialog}
                >
                  {emailVerified
                    ? "Email this plan"
                    : "Verify email to send"}
                </button>
                <button
                  type="button"
                  disabled={busy || shareBusy || pdfBusy}
                  onClick={downloadPlanPdf}
                >
                  {pdfBusy ? "Starting download..." : "Download PDF"}
                </button>
                {(planEdited || planSnapshotConflict) && (
                  <button
                    type="button"
                    disabled={busy || shareBusy || pdfBusy}
                    onClick={resetAdvisorSuggestions}
                  >
                    Reset advisor suggestions
                  </button>
                )}
              </div>
            </div>
          </section>
        )}
        {step === 4 && (
          <section className="customer-editor-step">
            <div className="customer-step-heading">
              <span>Step 4</span>
              <h2>Prepare for quotes, only if you want them</h2>
              <p>
                Your roadmap is already complete. Add timing, site constraints
                and safe evidence only if you may request prices later.
              </p>
            </div>
            <section className="customer-quote-work-summary">
              <div>
                <span>From your plan details</span>
                <h3>Work you may want priced</h3>
                <p>
                  {categoryLabels.length
                    ? categoryLabels.join(", ")
                    : "No work type selected yet. You can keep using the roadmap without requesting quotes."}
                </p>
              </div>
              <button type="button" onClick={() => openStep(2)}>
                Review work choices
              </button>
            </section>
            <fieldset className="customer-choice-group">
              <legend>What should a trade know before quoting? Optional</legend>
              <div className="customer-choice-grid">
                {customerProjectOptions.accessConstraints.map(
                  ([value, label]) => (
                    <label
                      className={
                        draft.propertyContext.accessConstraints.includes(value)
                          ? "selected"
                          : ""
                      }
                      key={value}
                    >
                      <input
                        type="checkbox"
                        checked={draft.propertyContext.accessConstraints.includes(
                          value,
                        )}
                        onChange={() => toggleAccessConstraint(value)}
                      />
                      <span>{label}</span>
                    </label>
                  ),
                )}
              </div>
            </fieldset>
            <h3 className="customer-quote-readiness-title">
              How ready are you?
            </h3>
            <div className="customer-field-grid">
              <Field label="Project stage">
                <select
                  value={draft.projectStage}
                  onChange={(event) => set("projectStage", event.target.value)}
                >
                  {customerProjectOptions.stages.map(
                    ([value, label]: [string, string]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="Timing">
                <select
                  value={draft.timing}
                  onChange={(event) => set("timing", event.target.value)}
                >
                  {customerProjectOptions.timings.map(
                    ([value, label]: [string, string]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </Field>
            </div>
            <section
              className="customer-project-evidence-picker"
              aria-labelledby="project-evidence-title"
              >
                <header>
                  <div>
                    <span>Optional property evidence</span>
                    <h3 id="project-evidence-title">
                      Add useful photos or documents
                    </h3>
                    <p>
                      Start with a guided photo or add a supporting document.
                      Files stay private to your plan unless you explicitly
                      choose installer quoting access.
                    </p>
                  </div>
                  <strong>
                    {storedEvidenceCount} saved, {pendingEvidence.length} ready
                  </strong>
                </header>
                <CustomerProjectPhotoCapture
                  serviceCategories={draft.serviceCategories}
                  remainingSlots={
                    12
                    - storedEvidenceCount
                    - pendingEvidence.filter(
                      (item) => !item.replaceEvidenceId,
                    ).length
                  }
                  pendingEvidence={pendingEvidence}
                  storedEvidence={visibleStoredEvidence}
                  onAdd={(files, preset) => addEvidence(files, preset)}
                  onRemovePending={removePendingEvidence}
                  onRemoveStored={(item) => void removeStoredEvidence(item)}
                  onLoadStoredPreview={loadStoredEvidencePreview}
                />
                <div className="customer-project-evidence-secondary">
                  <div>
                    <span>Other evidence</span>
                    <h4>Add a photo or a supporting PDF</h4>
                    <p>
                      Use this when the guided cards do not cover something
                      useful and home-specific.
                    </p>
                  </div>
                  <div className="customer-project-evidence-actions">
                    <label>
                      <span>Add another safe photo</span>
                      <small>JPEG, PNG or WebP, up to 8 MB</small>
                      <input
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) => {
                          addEvidence(event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    <label>
                      <span>Add a supporting document</span>
                      <small>PDF only, up to 8 MB</small>
                      <input
                        type="file"
                        multiple
                        accept="application/pdf"
                        onChange={(event) => {
                          addEvidence(event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>
              {pendingEvidence.some(
                (item) =>
                  !item.captureSlot || item.captureSlot.startsWith("other:"),
              ) && (
                <ul>
                  {pendingEvidence
                    .filter(
                      (item) =>
                        !item.captureSlot
                        || item.captureSlot.startsWith("other:"),
                    )
                    .map((item) => (
                    <li key={item.id}>
                      <span>
                        <strong>{item.file.name}</strong>
                        <small>
                          {fileSize(item.file.size)} |{" "}
                          {item.category.replaceAll("-", " ")}
                        </small>
                        <select
                          aria-label={`Category for ${item.file.name}`}
                          value={item.category}
                          onChange={(event) =>
                            updateEvidenceCategory(
                              item.id,
                              event.target.value,
                            )
                          }
                        >
                          <option value="property-photo">
                            Home or site photo
                          </option>
                          <option value="existing-equipment">
                            Existing equipment
                          </option>
                          <option value="switchboard">Switchboard</option>
                          <option value="supporting-document">
                            Supporting document
                          </option>
                          <option value="other">Other useful evidence</option>
                        </select>
                        <select
                          aria-label={`Home fact supported by ${item.file.name}`}
                          value={item.factKeys[0] || ""}
                          onChange={(event) =>
                            updateEvidenceFact(item.id, event.target.value)
                          }
                        >
                          <option value="">General plan evidence</option>
                          {customerAdvisorOptions.factKeys.map(
                            ([value, label]) => (
                              <option value={value} key={value}>
                                Supports: {label}
                              </option>
                            ),
                          )}
                        </select>
                        <select
                          aria-label={`Sharing setting for ${item.file.name}`}
                          value={item.sharingScope}
                          onChange={(event) =>
                            updateEvidenceSharingScope(
                              item.id,
                              event.target.value as PendingProjectEvidence["sharingScope"],
                            )
                          }
                        >
                          <option value="private-plan">
                            Private to my plan
                          </option>
                          <option value="allocated-installers">
                            Share with allocated verified installers
                          </option>
                        </select>
                      </span>
                      <button
                        type="button"
                        onClick={() => removePendingEvidence(item.id)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <small>
                Up to 12 files, 8 MB each. Private-plan files stay in your
                signed-in plan. Only files you explicitly mark for installer
                sharing can be viewed by allocated verified installers after
                you confirm the sharing notice. Do not upload people, mail,
                licence plates, identity documents, unredacted bills, meter
                identifiers or passwords.
              </small>
            </section>
            <Field
              label="Questions or reminders for yourself"
              optional="never shared with trades"
              hint="Use this for questions, product ideas or reminders. Do not store passwords, identity documents, bills or meter identifiers."
            >
              <textarea
                rows={6}
                maxLength={2000}
                value={draft.privateNotes}
                onChange={(event) => set("privateNotes", event.target.value)}
              />
            </Field>
          </section>
        )}
        {step === 5 && (
          <section className="customer-editor-step">
            <div className="customer-step-heading">
              <span>Step 5</span>
              <h2>Review exactly what installers can see</h2>
              <p>
                The platform generates this summary from controlled choices.
                Your name, email, home nickname, project name, private notes and
                exact postcode stay hidden during matching and quote review.
              </p>
            </div>
            <div className="customer-privacy-preview">
              <div className="customer-preview-visible">
                <span>Installer view</span>
                <h3>
                  {categoryLabels.length === 1
                    ? `${categoryLabels[0]} project`
                    : categoryLabels.length > 1
                      ? "Multi-upgrade home project"
                      : "Home energy project"}
                </h3>
                <dl>
                  <div>
                    <dt>Region</dt>
                    <dd>{draft.addressState}, exact location withheld</dd>
                  </div>
                  <div>
                    <dt>Property</dt>
                    <dd>{propertyLabel}</dd>
                  </div>
                  <div>
                    <dt>Goals</dt>
                    <dd>{goalLabels.join(", ") || "Choose goals"}</dd>
                  </div>
                  <div>
                    <dt>Home context</dt>
                    <dd>
                      {homeContextLabels.join(", ")
                        || "Complete or choose Not sure for the five property questions"}
                    </dd>
                  </div>
                  <div>
                    <dt>Stage</dt>
                    <dd>
                      {optionLabel(
                        customerProjectOptions.stages,
                        draft.projectStage,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Timing</dt>
                    <dd>
                      {optionLabel(
                        customerProjectOptions.timings,
                        draft.timing,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Work</dt>
                    <dd>{categoryLabels.join(", ") || "Choose work types"}</dd>
                  </div>
                  <div>
                    <dt>Site considerations</dt>
                    <dd>
                      {siteConsiderationLabels.join(", ")
                        || "No additional site constraint selected"}
                    </dd>
                  </div>
                  <div>
                    <dt>Photos included with the enquiry</dt>
                    <dd>
                      {projectPhotoCount || "None attached"}
                    </dd>
                  </div>
                  <div>
                    <dt>Generated installer summary</dt>
                    <dd>{installerPreview.summary}</dd>
                  </div>
                </dl>
              </div>
              <aside>
                <strong>Withheld during matching</strong>
                <ul>
                  <li>Name or account email</li>
                  <li>Phone or street address</li>
                  <li>Exact postcode or precise distance</li>
                  <li>Private project names and notes</li>
                  <li>Bills, NMI or meter data</li>
                </ul>
              </aside>
            </div>
            <p className="customer-submit-consent">
              You will confirm the privacy-safe plan and all project photos in
              the final request window. Other documents keep the sharing choice
              shown on each file.
            </p>
          </section>
        )}
      </div>
      <footer className="customer-editor-actions">
        <div>
          <button
            type="button"
            onClick={() => void saveDraft()}
            disabled={busy}
          >
            {busy
              ? "Working..."
              : savedId
                ? "Save changes"
                : "Save private draft"}
          </button>
          <small role="status" aria-live="polite">
            {dirty
              ? "Changes not yet saved"
              : savedId
                ? "Saved to your account"
                : "Nothing is sent until you choose"}
          </small>
        </div>
        <div className="customer-editor-next">
          {validationError && (
            <p className="customer-action-error" role="alert">
              {validationError}
            </p>
          )}
          {step > 1 && (
            <button
              type="button"
              onClick={() => openStep(step - 1)}
              disabled={busy}
            >
              Back
            </button>
          )}
          {step < 5 ? (
            <button
              className="primary"
              type="button"
              onClick={() => validate(step + 1)}
              disabled={busy}
            >
              Continue
            </button>
          ) : (
            <button
              className="primary"
              type="button"
              onClick={openInstallerRequest}
              disabled={busy || !emailVerified}
            >
              {emailVerified
                ? "Request private installer responses"
                : "Verify email to submit"}
            </button>
          )}
        </div>
      </footer>
      <CustomerInstallerRequestDialog
        open={installerRequestOpen}
        initialContact={{
          phone: profile.phone,
          addressLine1: profile.addressLine1,
          addressLine2: profile.addressLine2,
          suburb: profile.suburb,
        }}
        projectPostcode={draft.postcode}
        projectState={draft.addressState}
        projectPhotoCount={projectPhotoCount}
        onClose={() => setInstallerRequestOpen(false)}
        onSubmit={completeInstallerRequest}
        onComplete={onRequestComplete}
      />
      <CustomerPlanShareDialog
        key={shareRequestId || "plan-share"}
        open={shareDialogOpen}
        defaultRecipient={firebaseAuth.currentUser?.email || ""}
        readiness={shareablePlanDocument.readiness}
        busy={shareBusy}
        status={shareStatus}
        error={shareError}
        onClose={() => {
          if (!shareBusy) setShareDialogOpen(false);
        }}
        onReviewHomeDetails={reviewHomeDetailsBeforeSharing}
        onSubmit={emailPlan}
      />
      <CustomerPlanReportPreviewDialog
        open={reportPreviewOpen}
        report={createCustomerPlanReportView(shareablePlanDocument)}
        onClose={() => setReportPreviewOpen(false)}
      />
    </section>
  );
}

function ArrivalCoordination({
  quote,
  busy,
  checks,
  setChecks,
  onAction,
}: {
  quote: ProjectQuote;
  busy: boolean;
  checks: Record<string, boolean>;
  setChecks: (checks: Record<string, boolean>) => void;
  onAction: (action: string, extra?: Record<string, unknown>) => Promise<void>;
}) {
  const proposal = quote.arrivalProposal;
  if (!proposal) return null;
  if (proposal.status === "proposed")
    return (
      <article className="customer-arrival-proposal">
        <strong>Fourth option</strong>
        <p>
          If none of the three proposed windows suit, you can reveal the
          installer&apos;s four business contact fields and continue directly.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void onAction("select_installer_contact", {
              proposalId: proposal.id,
              expectedRevision: proposal.revision,
            })
          }
        >
          Contact installer directly
        </button>
        <small>
          AEA records this choice so administrators can see that the connection
          may continue outside TLink.
        </small>
      </article>
    );
  if (proposal.status === "direct_contact" && proposal.directContact)
    return (
      <article className="customer-contact-release active">
        <strong>Installer contact details</strong>
        <dl>
          <div>
            <dt>Business name</dt>
            <dd>{proposal.directContact.businessName}</dd>
          </div>
          <div>
            <dt>Contact number</dt>
            <dd>
              <a href={`tel:${proposal.directContact.phone}`}>
                {proposal.directContact.phone}
              </a>
            </dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${proposal.directContact.email}`}>
                {proposal.directContact.email}
              </a>
            </dd>
          </div>
          <div>
            <dt>ABN</dt>
            <dd>{proposal.directContact.abn}</dd>
          </div>
        </dl>
        <small>
          AEA recorded that you chose direct contact. Agreements or arrangements
          made outside TLink may not be visible to AEA.
        </small>
      </article>
    );
  if (proposal.status !== "selected" || !proposal.selectedWindow) return null;
  if (!proposal.crmAppointmentId) return null;
  return (
    <article className="customer-arrival-proposal selected">
      {proposal.preparationAcknowledgedAt ? (
        <small>
          Site preparation confirmed. The installer has this window in its CRM
          appointment workflow.
        </small>
      ) : (
        <div className="customer-contact-release">
          <strong>Prepare for the visit</strong>
          {[
            ["access", "Clear safe access to the work area and switchboard"],
            ["adult", "Ensure an adult is present for the agreed window"],
            ["pets", "Secure pets and identify any access restrictions"],
          ].map(([key, label]) => (
            <label className="customer-check-row" key={key}>
              <input
                type="checkbox"
                checked={Boolean(checks[key])}
                onChange={(event) =>
                  setChecks({ ...checks, [key]: event.target.checked })
                }
              />
              <span>
                <small>{label}</small>
              </span>
            </label>
          ))}
          <button
            type="button"
            className="primary"
            disabled={busy || !checks.access || !checks.adult || !checks.pets}
            onClick={() =>
              void onAction("acknowledge_arrival_preparation", {
                proposalId: proposal.id,
                confirmAccessClear: true,
                confirmAdultPresent: true,
                confirmPetsManaged: true,
              })
            }
          >
            Confirm site preparation
          </button>
        </div>
      )}
    </article>
  );
}

function ProjectDetail({
  user,
  project,
  profile,
  emailVerified,
  busy,
  onAction,
  onRequestStart,
  onCheckInstallerRequestSubmitted,
  onRequestInstallerResponses,
  onRequestComplete,
  onDownloadHandover,
  onDownloadEvidence,
  onDeleteEvidence,
  onUpdateEvidence,
  onRecordOutcome,
}: {
  user: User;
  project: CustomerProject;
  profile: CustomerProfile;
  emailVerified: boolean;
  busy: boolean;
  onAction: (action: string, extra?: Record<string, unknown>) => Promise<void>;
  onRequestStart: () => void;
  onCheckInstallerRequestSubmitted: (
    projectId: string,
  ) => Promise<CustomerProject | null>;
  onRequestInstallerResponses: (
    projectId: string,
    expectedPlanRevision: number,
    confirmAllProjectPhotoSharing: boolean,
    contact: CustomerInstallerRequestContact,
    recoverCommittedSubmit?: boolean,
  ) => Promise<void>;
  onRequestComplete: () => void;
  onDownloadHandover: (
    document: CustomerHandoverPack["documents"][number],
  ) => Promise<void>;
  onDownloadEvidence: (
    item: CustomerProject["evidence"][number],
  ) => Promise<void>;
  onDeleteEvidence: (
    item: CustomerProject["evidence"][number],
  ) => Promise<void>;
  onUpdateEvidence: (
    item: CustomerProject["evidence"][number],
    factKeys: string[],
  ) => Promise<void>;
  onRecordOutcome: (
    projectId: string,
    input: CustomerPlanProgressInput,
  ) => Promise<void>;
}) {
  const [releaseConfirmations, setReleaseConfirmations] = useState<
    Record<string, boolean>
  >({});
  const [acceptConfirmations, setAcceptConfirmations] = useState<
    Record<string, boolean>
  >({});
  const [preparationConfirmations, setPreparationConfirmations] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [installerRequestOpen, setInstallerRequestOpen] = useState(false);
  const uncertainInstallerSubmit = useRef<{
    projectId: string;
    planRevision: number;
    editGeneration: number;
    requestFingerprint: string;
  } | null>(null);
  const planItems = project.planSnapshot.items || [];
  const permissionPack = createCustomerPermissionPack(
    project.advisorProfile,
    {
      householdSituation: project.householdSituation,
      approvalContext: project.propertyContext.approvalContext,
      planItems,
    },
  ) as CustomerPermissionPack;
  const answeredHomeQuestions = homeFeatureQuestions.filter((question) =>
    question.options.some(([value]) => project.existingFeatures.includes(value)),
  );
  const notSureHomeQuestions = homeFeatureQuestions.filter(
    (question) =>
      question.unknownValue
      && project.existingFeatures.includes(question.unknownValue),
  );
  const linkedEvidenceFacts = new Set(
    project.evidence.flatMap((item) => item.factKeys),
  );
  const progressSteps = [
    ["Scope saved", Boolean(project.submittedAt)],
    ["Eligible installers matched", project.progress.installerCount > 0],
    ["Structured response received", project.progress.responseCount > 0],
    ["Quote option ready", project.quotes.length > 0],
    ["Digital handover published", project.handoverPacks.length > 0],
  ] as const;
  const projectPhotos = project.evidence.filter(
    (item) => item.contentType.startsWith("image/"),
  );
  const privateProjectPhotoCount = projectPhotos.filter(
    (item) => item.sharingScope === "private-plan",
  ).length;
  const projectPhotoSharingRepairAvailable =
    projectPhotos.length > 0
    && (
      privateProjectPhotoCount > 0
      || !project.evidenceSharingConsent
    )
    && ["matching", "quote_review"].includes(project.status);

  async function completeInstallerRequest(
    contact: CustomerInstallerRequestContact,
    confirmAllProjectPhotoSharing: boolean,
    reportProgress: (progress: CustomerInstallerRequestProgress) => void,
  ) {
    const requestFingerprint = installerRequestFingerprint(
      contact,
      confirmAllProjectPhotoSharing,
    );
    reportProgress({ phase: "checking-previous-request" });
    const uncertainSubmit = uncertainInstallerSubmit.current;
    if (uncertainSubmit) {
      const submittedProject = await onCheckInstallerRequestSubmitted(
        uncertainSubmit.projectId,
      );
      if (submittedProject) {
        const sameRequest = canRecoverInstallerRequest(uncertainSubmit, {
          projectId: project.id,
          planRevision: project.planRevision,
          editGeneration: 0,
          requestFingerprint,
        });
        uncertainInstallerSubmit.current = null;
        if (sameRequest) return;
        await onRequestInstallerResponses(
          uncertainSubmit.projectId,
          uncertainSubmit.planRevision,
          confirmAllProjectPhotoSharing,
          contact,
          false,
        );
        return "Your earlier request was sent, and your latest contact details were saved. Any evidence-sharing change made after the network interruption was not applied. Review the submitted project from your overview.";
      }
      uncertainInstallerSubmit.current = null;
    }
    uncertainInstallerSubmit.current = {
      projectId: project.id,
      planRevision: project.planRevision,
      editGeneration: 0,
      requestFingerprint,
    };
    reportProgress({ phase: "sending-request" });
    await onRequestInstallerResponses(
      project.id,
      project.planRevision,
      confirmAllProjectPhotoSharing,
      contact,
    );
    uncertainInstallerSubmit.current = null;
  }

  function confirmEvidenceDeletion(
    item: CustomerProject["evidence"][number],
  ) {
    const confirmed = window.confirm(
      `Remove "${item.fileName}" from this project? This permanently removes future portal access and cannot be undone.`,
    );
    if (!confirmed) return;
    void onDeleteEvidence(item).catch(() => {
      // The dashboard reports the API error beside the project controls.
    });
  }

  return (
    <section
      className="customer-project-detail"
      aria-labelledby="customer-project-title"
    >
      <header className="customer-project-detail-header">
        <div>
          <span>
            {statusLabels[project.displayStatus] || project.displayStatus}
          </span>
          <h1 id="customer-project-title">{project.title}</h1>
          <p>
            {project.homeNickname} | {project.addressState} {project.postcode} |
            Updated {new Date(project.updatedAt).toLocaleDateString("en-AU")}
          </p>
        </div>
        <div>
          <a href="/account">All projects</a>
          {project.status === "draft" && (
            <a
              className="primary"
              href={`/account/projects/${project.id}?edit=1`}
            >
              Edit draft
            </a>
          )}
        </div>
      </header>
      <div className="customer-project-detail-grid">
        <div className="customer-project-primary">
          <section className="customer-detail-panel">
            <div className="customer-panel-heading">
              <span>Saved roadmap</span>
              <h2>
                {project.planSnapshot.title || "Your ordered home energy plan"}
              </h2>
              <p>{project.planSnapshot.summary}</p>
            </div>
            <ol className="customer-saved-roadmap">
              {planItems.map((item, index) => {
                const complete = project.completedPlanItems.includes(item.id);
                return (
                  <li className={complete ? "complete" : ""} key={item.id}>
                    <button
                      type="button"
                      aria-pressed={complete}
                      onClick={() =>
                        void onAction("toggle_milestone", {
                          itemId: item.id,
                          complete: !complete,
                          expectedPlanRevision: project.planRevision,
                        })
                      }
                      disabled={busy}
                    >
                      <span>
                        {complete ? "✓" : String(index + 1).padStart(2, "0")}
                      </span>
                    </button>
                    <div>
                      <small>{item.stage}</small>
                      <h3>{item.title}</h3>
                      <p>{item.text}</p>
                      {item.href && item.action && (
                        <a href={item.href}>{item.action}</a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
          {project.planRevisions.length > 0 && (
            <CustomerPlanHistoryProgress
              project={{
                id: project.id,
                status: project.status,
                planRevision: project.planRevision,
                updatedAt: project.updatedAt,
                planRevisions: project.planRevisions,
                outcomeCheckins: project.outcomeCheckins,
              }}
              labels={{
                goals: customerProjectOptions.goals,
                homeFeatures: customerProjectOptions.homeFeatures,
                paces: customerProjectOptions.paces,
                budgets: customerProjectOptions.budgets,
                serviceCategories: customerProjectOptions.serviceCategories,
              }}
              busy={busy}
              onRecordOutcome={(input) =>
                onRecordOutcome(project.id, input)
              }
              onRestore={(sourceRevisionNumber) =>
                onAction("restore_plan_revision", {
                  sourceRevisionNumber,
                  expectedPlanRevision: project.planRevision,
                  confirmRestore: true,
                })
              }
            />
          )}
          {project.advisorProfile.climate && (
            <section className="customer-detail-panel customer-detail-climate">
              <div className="customer-panel-heading">
                <span>Broad postcode planning guide</span>
                <h2>{project.advisorProfile.climate.label}</h2>
                <p>{project.advisorProfile.climate.summary}</p>
              </div>
              <ul>
                {project.advisorProfile.climate.priorities.map((priority) => (
                  <li key={priority}>{priority}</li>
                ))}
              </ul>
              <small>{project.advisorProfile.climate.disclaimer}</small>
            </section>
          )}
          <section className="customer-detail-panel customer-detail-advisor-profile">
            <div className="customer-panel-heading">
              <span>Advice basis</span>
              <h2>Your home answers and useful supporting evidence</h2>
              <p>
                Your selections are household-supplied observations. Linked
                photos and documents are available for later review; neither is
                treated as professional verification.
              </p>
            </div>
            <dl>
              <div>
                <dt>Home questions completed</dt>
                <dd>
                  {answeredHomeQuestions.length} of {homeFeatureQuestions.length}
                </dd>
              </div>
              <div>
                <dt>Answered Not sure</dt>
                <dd>{notSureHomeQuestions.length}</dd>
              </div>
              <div>
                <dt>Tracked home facts with linked evidence</dt>
                <dd>
                  {linkedEvidenceFacts.size} of {customerAdvisorOptions.factKeys.length}
                </dd>
              </div>
              <div>
                <dt>Rooms profiled</dt>
                <dd>{project.advisorProfile.rooms.length}</dd>
              </div>
              <div>
                <dt>Permission items reviewed</dt>
                <dd>{project.advisorProfile.permissionItems.length}</dd>
              </div>
            </dl>
            {project.advisorProfile.rooms.length > 0 && (
              <details>
                <summary>Review private room comfort details</summary>
                <ul>
                  {project.advisorProfile.rooms.map((room) => (
                    <li key={room.id}>
                      <strong>{room.name}</strong>
                      <span>
                        {optionLabel(
                          customerAdvisorOptions.roomTypes,
                          room.roomType,
                        )}
                        {" | "}
                        {room.concerns
                          .map((item) =>
                            optionLabel(
                              customerAdvisorOptions.comfortConcerns,
                              item,
                            ),
                          )
                          .join(", ") || "No concern selected"}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          {project.advisorProfile.permissionItems.length > 0 && (
            <section className="customer-detail-panel customer-detail-permission-pack">
              <div className="customer-panel-heading">
                <span>Permission planning</span>
                <h2>{permissionPack.title}</h2>
                <p>
                  Portable, permission-dependent and fixed or shared-property
                  items stay separate. This checklist is not a legal or strata
                  approval determination.
                </p>
              </div>
              <div>
                {permissionPack.sections.map((section) => (
                  <article key={section.classification}>
                    <h3>{section.label}</h3>
                    {section.items.length > 0 ? (
                      <ul>
                        {section.items.map((item) => (
                          <li key={item.id}>
                            <strong>{item.title}</strong>
                            {item.note && <span>{item.note}</span>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No items listed.</p>
                    )}
                  </article>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  downloadPermissionPack(project.advisorProfile, {
                    householdSituation: project.householdSituation,
                    approvalContext: project.propertyContext.approvalContext,
                    planItems,
                  })
                }
              >
                Download permission checklist
              </button>
              <small>{permissionPack.disclaimer}</small>
            </section>
          )}
          {project.status !== "draft" && (
            <section className="customer-detail-panel">
              <div className="customer-panel-heading">
                <span>Platform progress</span>
                <h2>Your enquiry stays inside the platform</h2>
                <p>
                  Installers can review and submit structured options without
                  seeing your identity or exact location. Direct contact becomes
                  available only to an installer you deliberately connect with.
                </p>
              </div>
              <ol className="customer-progress-list">
                {progressSteps.map(([label, complete], index) => (
                  <li className={complete ? "complete" : ""} key={label}>
                    <span>{complete ? "✓" : index + 1}</span>
                    <div>
                      <strong>{label}</strong>
                      <small>{complete ? "Complete" : "Waiting"}</small>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="customer-progress-stats">
                <div>
                  <strong>{project.progress.installerCount}</strong>
                  <span>eligible installers allocated</span>
                </div>
                <div>
                  <strong>{project.progress.responseCount}</strong>
                  <span>expressions of interest</span>
                </div>
                <div>
                  <strong>{project.progress.quoteCount}</strong>
                  <span>structured quote options</span>
                </div>
              </div>
            </section>
          )}
          {project.evidence.length > 0 && (
            <section className="customer-detail-panel customer-project-evidence-library">
              <div className="customer-panel-heading">
                <span>Property evidence</span>
                <h2>Your project photos and files</h2>
                <p>
                  Private-plan files stay owner-only. Only files explicitly
                  marked for installer access are shared with allocated verified
                  installers after consent.
                </p>
              </div>
              <div>
                {project.evidence.map((item) => (
                  <article key={item.id}>
                    <div>
                      <span>{item.category.replaceAll("-", " ")}</span>
                      <strong>{item.fileName}</strong>
                      <small>
                        {fileSize(item.sizeBytes)} | Added{" "}
                        {new Date(item.createdAt).toLocaleDateString("en-AU")}
                      </small>
                      <small>
                        {item.sharingScope === "private-plan"
                          ? "Private to this plan"
                          : "Available to allocated verified installers after consent"}
                        {" | "}
                        {item.factKeys.length
                          ? item.factKeys
                              .map((factKey) =>
                                optionLabel(
                                  customerAdvisorOptions.factKeys,
                                  factKey,
                                ),
                              )
                              .join(", ")
                          : "General plan evidence"}
                      </small>
                      <label>
                        <span>What this file supports</span>
                        <select
                          value={item.factKeys[0] || ""}
                          disabled={busy}
                          onChange={(event) =>
                            void onUpdateEvidence(
                              item,
                              event.target.value ? [event.target.value] : [],
                            )
                          }
                        >
                          <option value="">General plan evidence</option>
                          {customerAdvisorOptions.factKeys.map(
                            ([value, label]) => (
                              <option value={value} key={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                    </div>
                    <div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onDownloadEvidence(item)}
                      >
                        Download
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => confirmEvidenceDeletion(item)}
                      >
                        Remove future access
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <small>
                Removing a file stops future portal downloads. It cannot erase
                information an installer already viewed or saved.
              </small>
            </section>
          )}
          {project.quotes.length > 0 && (
            <section
              id="structured-quote-options"
              className="customer-detail-panel"
              tabIndex={-1}
              aria-labelledby="structured-quote-options-heading"
            >
              <div className="customer-panel-heading">
                <span>Compare safely</span>
                <h2 id="structured-quote-options-heading">
                  Structured quote options
                </h2>
                <p>
                  Review the verified business behind each option before
                  deciding whether to share your contact details. Product lines
                  preserve the wholesaler price selected by the installer at
                  submission.
                </p>
              </div>
              <div className="customer-quote-grid">
                {project.quotes.map((quote) => (
                  <article
                    className={
                      quote.customerDecision === "accepted"
                        ? "accepted"
                        : quote.customerDecision === "shortlisted"
                          ? "shortlisted"
                          : quote.customerDecision === "declined"
                            ? "declined"
                            : ""
                    }
                    key={quote.id}
                  >
                    <header>
                      <div>
                        <span>
                          {quote.installerVerified
                            ? "Verified installer"
                            : quote.optionLabel}
                        </span>
                        <h3>{quote.installerBusinessName}</h3>
                        <small>
                          {optionLabel(
                            platformQuoteOptions.quoteTypes,
                            quote.quoteType,
                          )}
                        </small>
                      </div>
                      {quote.customerDecision === "accepted" ? (
                        <strong>Accepted for next step</strong>
                      ) : (
                        quote.customerDecision === "shortlisted" && (
                          <strong>Shortlisted</strong>
                        )
                      )}
                    </header>
                    <div className="customer-quote-total">
                      <span>Indicative total</span>
                      <strong>
                        {currency(Math.round(quote.totalCentsExGst * 1.1))}
                      </strong>
                      <small>{currency(quote.totalCentsExGst)} ex GST</small>
                    </div>
                    <dl>
                      <div>
                        <dt>Products</dt>
                        <dd>
                          {currency(quote.productSubtotalCentsExGst)} ex GST
                        </dd>
                      </div>
                      <div>
                        <dt>Labour</dt>
                        <dd>{currency(quote.labourCentsExGst)} ex GST</dd>
                      </div>
                      <div>
                        <dt>Other services</dt>
                        <dd>{currency(quote.otherCentsExGst)} ex GST</dd>
                      </div>
                      <div>
                        <dt>Start window</dt>
                        <dd>
                          {optionLabel(
                            platformQuoteOptions.startWindows,
                            quote.startWindow,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Expected duration</dt>
                        <dd>
                          {quote.durationWeeks
                            ? `${quote.durationWeeks} week${quote.durationWeeks === 1 ? "" : "s"}`
                            : "To confirm"}
                        </dd>
                      </div>
                      <div>
                        <dt>Workmanship warranty</dt>
                        <dd>
                          {quote.workmanshipWarrantyYears
                            ? `${quote.workmanshipWarrantyYears} years`
                            : "To confirm"}
                        </dd>
                      </div>
                    </dl>
                    {quote.products.length > 0 && (
                      <details>
                        <summary>
                          Fixed-price products ({quote.products.length})
                        </summary>
                        <ul>
                          {quote.products.map((product) => (
                            <li key={`${product.brand}-${product.modelNumber}`}>
                              <span>
                                {product.brand} {product.name}
                                <small>
                                  {product.modelNumber} | {product.quantity}{" "}
                                  {product.unitLabel}
                                </small>
                              </span>
                              <strong>
                                {currency(
                                  product.quantity *
                                    product.unitPriceCentsExGst,
                                )}{" "}
                                ex GST
                              </strong>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <details>
                      <summary>Included services</summary>
                      <ul>
                        {quote.inclusions.map((item) => (
                          <li key={item}>
                            {optionLabel(platformQuoteOptions.inclusions, item)}
                          </li>
                        ))}
                      </ul>
                    </details>
                    {quote.customerDecision !== "accepted" && (
                      <div className="customer-quote-actions">
                        <button
                          type="button"
                          className="primary"
                          disabled={
                            busy || quote.customerDecision === "shortlisted"
                          }
                          onClick={() =>
                            void onAction("quote_decision", {
                              quoteId: quote.id,
                              decision: "shortlisted",
                            })
                          }
                        >
                          {quote.customerDecision === "shortlisted"
                            ? "Shortlisted"
                            : "Shortlist this option"}
                        </button>
                        <button
                          type="button"
                          disabled={
                            busy || quote.customerDecision === "declined"
                          }
                          onClick={() =>
                            void onAction("quote_decision", {
                              quoteId: quote.id,
                              decision: "declined",
                            })
                          }
                        >
                          Not for me
                        </button>
                      </div>
                    )}
                    {quote.customerDecision === "shortlisted" &&
                      quote.contactRelease?.status !== "active" && (
                        <div className="customer-contact-release">
                          <strong>
                            Connect with {quote.installerBusinessName}
                          </strong>
                          {project.contactReady ? (
                            <>
                              <label className="customer-check-row">
                                <input
                                  type="checkbox"
                                  checked={Boolean(
                                    releaseConfirmations[quote.id],
                                  )}
                                  onChange={(event) =>
                                    setReleaseConfirmations((current) => ({
                                      ...current,
                                      [quote.id]: event.target.checked,
                                    }))
                                  }
                                />
                                <span>
                                  <small>
                                    I authorise AEA to release my account name,
                                    email, phone and full service address to
                                    this specific verified installer so they can
                                    contact me about this project. Other
                                    installers remain anonymised.
                                  </small>
                                </span>
                              </label>
                              <button
                                type="button"
                                className="primary"
                                disabled={
                                  busy || !releaseConfirmations[quote.id]
                                }
                                onClick={() =>
                                  void onAction("release_contact", {
                                    quoteId: quote.id,
                                    confirmContactRelease: true,
                                  })
                                }
                              >
                                Share details with this installer
                              </button>
                            </>
                          ) : (
                            <p>
                              Add your phone and complete service address in{" "}
                              <a href="/account/profile">Privacy and profile</a>
                              , matching this project postcode, before
                              connecting.
                            </p>
                          )}
                        </div>
                      )}
                    {quote.customerDecision === "shortlisted" &&
                      quote.contactRelease?.status === "active" && (
                        <div className="customer-contact-release active">
                          <strong>
                            Choose {quote.installerBusinessName} for the next
                            step
                          </strong>
                          <p>
                            All allocated installers can view only the files you
                            marked for installer sharing. Accepting this
                            installer lets them propose arrival windows. It does
                            not accept a final contract or authorise installation
                            work.
                          </p>
                          <label className="customer-check-row">
                            <input
                              type="checkbox"
                              checked={Boolean(acceptConfirmations[quote.id])}
                              onChange={(event) =>
                                setAcceptConfirmations((current) => ({
                                  ...current,
                                  [quote.id]: event.target.checked,
                                }))
                              }
                            />
                            <span>
                              <small>
                                I choose this verified installer for site
                                assessment and scheduling preparation.
                              </small>
                            </span>
                          </label>
                          <button
                            type="button"
                            className="primary"
                            disabled={busy || !acceptConfirmations[quote.id]}
                            onClick={() =>
                              void onAction("quote_decision", {
                                quoteId: quote.id,
                                decision: "accepted",
                                confirmInstallerAcceptance: true,
                              })
                            }
                          >
                            Accept installer for next step
                          </button>
                        </div>
                      )}
                    {quote.customerDecision === "accepted" &&
                      quote.contactRelease?.status === "active" && (
                        <div className="customer-contact-release active">
                          <strong>
                            {quote.installerBusinessName} is accepted for the
                            next step
                          </strong>
                          <p>
                            This installer can view your released contact
                            details. All allocated installers can view only the
                            project files you marked for installer sharing. The
                            accepted installer provides the arrival windows for
                            you to review.
                          </p>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void onAction("withdraw_contact", {
                                quoteId: quote.id,
                              })
                            }
                          >
                            Stop future platform access
                          </button>
                          <small>
                            This cannot erase information already viewed or
                            saved.
                          </small>
                        </div>
                      )}
                    {quote.customerDecision === "accepted" &&
                      quote.arrivalProposal?.status === "proposed" && (
                        <div className="customer-arrival-proposal">
                          <strong>
                            Choose an installer-proposed arrival window
                          </strong>
                          {quote.arrivalProposal.installerNote && (
                            <p>{quote.arrivalProposal.installerNote}</p>
                          )}
                          <div>
                            {quote.arrivalProposal.windows.map((window) => (
                              <button
                                type="button"
                                key={window.id}
                                disabled={busy}
                                onClick={() =>
                                  void onAction("select_arrival_window", {
                                    proposalId: quote.arrivalProposal?.id,
                                    windowId: window.id,
                                    expectedRevision:
                                      quote.arrivalProposal?.revision,
                                  })
                                }
                              >
                                <span>
                                  {new Date(window.startsAt).toLocaleDateString(
                                    "en-AU",
                                    {
                                      weekday: "short",
                                      day: "numeric",
                                      month: "short",
                                    },
                                  )}
                                </span>
                                <strong>
                                  {window.startsAt.slice(11)} to{" "}
                                  {window.endsAt.slice(11)}
                                </strong>
                              </button>
                            ))}
                          </div>
                          <small>
                            The installer supplies these options. Your selection
                            is recorded before any CRM appointment is created or
                            changed.
                          </small>
                        </div>
                      )}
                    {quote.customerDecision === "accepted" &&
                      quote.arrivalProposal?.status === "selected" &&
                      quote.arrivalProposal.selectedWindow && (
                        <div className="customer-arrival-proposal selected">
                          <strong>Arrival window selected</strong>
                          <p>
                            {new Date(
                              quote.arrivalProposal.selectedWindow.startsAt,
                            ).toLocaleDateString("en-AU", {
                              weekday: "long",
                              day: "numeric",
                              month: "long",
                              year: "numeric",
                            })}
                            ,{" "}
                            {quote.arrivalProposal.selectedWindow.startsAt.slice(
                              11,
                            )}{" "}
                            to{" "}
                            {quote.arrivalProposal.selectedWindow.endsAt.slice(
                              11,
                            )}
                          </p>
                          <small>
                            The installer can now use this reviewed window when
                            preparing the CRM appointment.
                          </small>
                        </div>
                      )}
                  </article>
                ))}
              </div>
              <div className="customer-guidance-note">
                <strong>You control the handover</strong>
                <p>
                  Shortlisting alone does not create a contract, release your
                  contact details or authorise work. Only photos and documents
                  you marked for installer sharing are available to allocated
                  verified installers under the submission notice. Private-plan
                  files remain owner-only.
                </p>
              </div>
            </section>
          )}
          {project.quotes.some(
            (quote) =>
              quote.customerDecision === "accepted" && quote.arrivalProposal,
          ) && (
            <section className="customer-detail-panel">
              <div className="customer-panel-heading">
                <span>Arrival coordination</span>
                <h2>Choose a proposed window or contact the installer</h2>
                <p>
                  The installer provides up to three arrival windows. Contacting
                  them directly is the fourth option and records a notice for
                  AEA administrators.
                </p>
              </div>
              {project.quotes
                .filter(
                  (quote) =>
                    quote.customerDecision === "accepted" &&
                    quote.arrivalProposal,
                )
                .map((quote) => (
                  <ArrivalCoordination
                    key={quote.id}
                    quote={quote}
                    busy={busy}
                    checks={
                      preparationConfirmations[quote.arrivalProposal!.id] || {}
                    }
                    setChecks={(checks) =>
                      setPreparationConfirmations((current) => ({
                        ...current,
                        [quote.arrivalProposal!.id]: checks,
                      }))
                    }
                    onAction={onAction}
                  />
                ))}
            </section>
          )}
          {project.handoverPacks.length > 0 && (
            <section className="customer-detail-panel customer-handover-library">
              <div className="customer-panel-heading">
                <span>Keep for the life of your home</span>
                <h2>Your digital asset and handover library</h2>
                <p>
                  Approved installed products, warranty records, completion
                  checks and documents stay in this free household account. Only
                  an installer you explicitly connected with received contact
                  details for this project.
                </p>
              </div>
              <div className="customer-handover-list">
                {project.handoverPacks.map((handover) => (
                  <article key={handover.id}>
                    <header>
                      <div>
                        <span>{handover.workNumber}</span>
                        <h3>
                          {optionLabel(
                            customerProjectOptions.serviceCategories,
                            handover.serviceCategory,
                          )}
                        </h3>
                        <small>
                          Platform reviewed and published{" "}
                          {new Date(handover.publishedAt).toLocaleDateString(
                            "en-AU",
                          )}
                        </small>
                      </div>
                      <strong>Approved handover</strong>
                    </header>
                    <div className="customer-handover-metrics">
                      <span>
                        {handover.assets.length} installed asset
                        {handover.assets.length === 1 ? "" : "s"}
                      </span>
                      <span>
                        {handover.complianceItems.length} completion checks
                      </span>
                      <span>
                        {handover.documents.length} protected document
                        {handover.documents.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="customer-handover-assets">
                      {handover.assets.map((asset) => (
                        <section key={asset.id}>
                          <div>
                            <span>
                              {asset.assetCategory.replaceAll("-", " ")}
                            </span>
                            <h4>
                              {asset.brand} {asset.modelNumber}
                            </h4>
                            <small>
                              {asset.serialNumber
                                ? `Serial ${asset.serialNumber}`
                                : "Serial not recorded"}{" "}
                              | Quantity {asset.quantity}
                            </small>
                          </div>
                          <dl>
                            <div>
                              <dt>Installed</dt>
                              <dd>{asset.installedAt || "Not recorded"}</dd>
                            </div>
                            <div>
                              <dt>Warranty provider</dt>
                              <dd>
                                {asset.warrantyProvider || "Not recorded"}
                              </dd>
                            </div>
                            <div>
                              <dt>Warranty reference</dt>
                              <dd>
                                {asset.warrantyReference || "Not recorded"}
                              </dd>
                            </div>
                            <div>
                              <dt>Warranty end</dt>
                              <dd>{asset.warrantyEnd || "Not recorded"}</dd>
                            </div>
                          </dl>
                        </section>
                      ))}
                    </div>
                    <details>
                      <summary>Completion record</summary>
                      <ul>
                        {handover.complianceItems.map((item) => (
                          <li key={item.id}>
                            <span>{item.label}</span>
                            <strong>
                              {item.status === "not_applicable"
                                ? "Not applicable"
                                : "Complete"}
                            </strong>
                          </li>
                        ))}
                      </ul>
                    </details>
                    <div className="customer-handover-documents">
                      <h4>Documents to keep</h4>
                      {handover.documents.map((document) => (
                        <section key={document.id}>
                          <div>
                            <span>
                              {document.category.replaceAll("-", " ")}
                            </span>
                            <strong>{document.fileName}</strong>
                            <small>{fileSize(document.sizeBytes)}</small>
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void onDownloadHandover(document)}
                          >
                            Download
                          </button>
                        </section>
                      ))}
                    </div>
                    {handover.corrections.length > 0 && (
                      <details className="customer-correction-history">
                        <summary>
                          Approved record corrections (
                          {handover.corrections.length})
                        </summary>
                        <ol>
                          {handover.corrections.map((correction) => (
                            <li key={correction.id}>
                              <span>Version {correction.versionNumber}</span>
                              <strong>
                                {correction.fieldKey.replaceAll("_", " ")}:{" "}
                                {correction.previousValue || "Not recorded"} to{" "}
                                {correction.approvedValue || "Not recorded"}
                              </strong>
                              <p>{correction.reason}</p>
                              <small>
                                Published{" "}
                                {new Date(
                                  correction.publishedAt,
                                ).toLocaleDateString("en-AU")}
                              </small>
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}
          {project.handoverPacks.length > 0 && (
            <CustomerAssetLifecycle user={user} projectId={project.id} />
          )}
        </div>
        <aside className="customer-project-sidebar">
          <section>
            <span>Private project record</span>
            <h2>Scope at a glance</h2>
            <dl>
              <div>
                <dt>Work</dt>
                <dd>
                  {project.serviceCategories
                    .map((item) =>
                      optionLabel(
                        customerProjectOptions.serviceCategories,
                        item,
                      ),
                    )
                    .join(", ") || "Not selected"}
                </dd>
              </div>
              <div>
                <dt>Timing</dt>
                <dd>
                  {optionLabel(customerProjectOptions.timings, project.timing)}
                </dd>
              </div>
              <div>
                <dt>Private budget</dt>
                <dd>
                  {optionLabel(
                    customerProjectOptions.budgets,
                    project.budgetRange,
                  )}
                </dd>
              </div>
              <div>
                <dt>Completed roadmap steps</dt>
                <dd>
                  {project.completedPlanItems.length} of {planItems.length}
                </dd>
              </div>
            </dl>
          </section>
          <section className="customer-private-notes">
            <span>Only you can see this</span>
            <h2>Private notes</h2>
            <p>{project.privateNotes || "No private notes saved yet."}</p>
          </section>
          <section className="customer-project-controls">
            <span>Project controls</span>
            {project.status === "draft" && (
              <button
                className="primary"
                type="button"
                onClick={() => {
                  onRequestStart();
                  setInstallerRequestOpen(true);
                }}
                disabled={busy || !emailVerified}
              >
                {emailVerified
                  ? "Request installer responses"
                  : "Verify email to submit"}
              </button>
            )}
            {projectPhotoSharingRepairAvailable && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const confirmed = window.confirm(
                    `Share all ${projectPhotos.length} ${
                      projectPhotos.length === 1 ? "project photo" : "project photos"
                    } with the verified installers allocated to this enquiry? Other uploaded documents keep their current sharing setting.`,
                  );
                  if (!confirmed) return;
                  void onAction("share_all_photos", {
                    confirmAllProjectPhotoSharing: true,
                  });
                }}
              >
                Share all project photos with matched installers
              </button>
            )}
            <button
              type="button"
              onClick={() => void onAction("duplicate")}
              disabled={busy}
            >
              Duplicate as a new draft
            </button>
            {["matching", "quote_review"].includes(project.status) && (
              <button
                type="button"
                onClick={() => void onAction("withdraw")}
                disabled={busy}
              >
                Withdraw enquiry
              </button>
            )}
            {["matching", "quote_review"].includes(project.status) && (
              <button
                type="button"
                onClick={() => void onAction("complete")}
                disabled={busy}
              >
                Mark project complete
              </button>
            )}
            {project.hasRetainedAssetHistory ? (
              <small>
                Asset and handover history stays in your completed project
                library. Live asset access may belong to another household after
                an approved transfer.
              </small>
            ) : (
              ["withdrawn", "completed"].includes(project.status) && (
                <button
                  type="button"
                  onClick={() => void onAction("archive")}
                  disabled={busy}
                >
                  Archive project
                </button>
              )
            )}
          </section>
        </aside>
      </div>
      <CustomerInstallerRequestDialog
        open={installerRequestOpen}
        initialContact={{
          phone: profile.phone,
          addressLine1: profile.addressLine1,
          addressLine2: profile.addressLine2,
          suburb: profile.suburb,
        }}
        projectPostcode={project.postcode}
        projectState={project.addressState}
        projectPhotoCount={projectPhotos.length}
        onClose={() => setInstallerRequestOpen(false)}
        onSubmit={completeInstallerRequest}
        onComplete={onRequestComplete}
      />
    </section>
  );
}

export function CustomerDashboard({
  initialView = "overview",
  initialProjectId = "",
  initialEdit = false,
  initialPlannerSelection,
}: {
  initialView?:
    "overview" | "new" | "profile" | "quotes" | "appointments";
  initialProjectId?: string;
  initialEdit?: boolean;
  initialPlannerSelection?: {
    goal?: string;
    goals?: string[];
    pace?: string;
    situation?: string;
    approvalContext?: string;
    budgetRange?: string;
    addressState?: string;
    features?: string[];
    categories?: string[];
    postcode?: string;
  };
}) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [projectConflictVersion, setProjectConflictVersion] = useState(0);
  const [account, setAccount] = useState<AccountResult>({
    profile: null,
    emailVerified: false,
    tradeWorkspace: null,
  });
  const [projects, setProjects] = useState<CustomerProject[]>([]);
  const [view, setView] = useState<DashboardView>(
    initialProjectId
      ? initialEdit
        ? "editor"
        : "detail"
      : initialView === "new"
        ? "editor"
        : initialView === "profile"
          ? "profile"
          : initialView === "quotes"
            ? "quotes"
            : initialView === "appointments"
              ? "appointments"
              : "overview",
  );
  const [selectedId, setSelectedId] = useState(initialProjectId);
  const [editingId, setEditingId] = useState(
    initialEdit ? initialProjectId : "",
  );
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [draftToDelete, setDraftToDelete] =
    useState<CustomerProject | null>(null);
  const [deleteDraftBusy, setDeleteDraftBusy] = useState(false);
  const [deleteDraftError, setDeleteDraftError] = useState("");
  const [deleteDraftReturnFocus, setDeleteDraftReturnFocus] =
    useState<HTMLButtonElement | null>(null);
  const projectListHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const projectRefreshSequenceRef = useRef(0);

  const refreshProjects = useCallback(async (nextUser: User) => {
    const refreshSequence = projectRefreshSequenceRef.current + 1;
    projectRefreshSequenceRef.current = refreshSequence;
    const token = await nextUser.getIdToken();
    const projectsResponse = await fetch("/api/customer-projects", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const projectsResult = await projectsResponse.json().catch(() => ({}));
    if (!projectsResponse.ok || !projectsResult.ok) {
      throw new Error(
        projectsResult.error || "Your projects could not be loaded.",
      );
    }
    const refreshedProjects =
      (projectsResult.projects || []) as CustomerProject[];
    if (projectRefreshSequenceRef.current === refreshSequence) {
      setProjects(refreshedProjects);
    }
    return refreshedProjects;
  }, []);

  useEffect(
    () =>
      onAuthStateChanged(firebaseAuth, (nextUser) => {
        projectRefreshSequenceRef.current += 1;
        setUser(nextUser);
        setAuthReady(true);
        if (!nextUser) {
          setAccount({
            profile: null,
            emailVerified: false,
            tradeWorkspace: null,
          });
          setProjects([]);
        }
      }),
    [],
  );

  const load = useCallback(async (nextUser: User) => {
    setLoading(true);
    setStatus("");
    try {
      const token = await nextUser.getIdToken();
      const accountResponse = await fetch("/api/customer-account", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const accountResult = await accountResponse.json().catch(() => ({}));
      if (!accountResponse.ok || !accountResult.ok)
        throw new Error(
          accountResult.error || "The customer account could not be loaded.",
        );
      setAccount({
        profile: accountResult.profile,
        emailVerified: Boolean(accountResult.emailVerified),
        tradeWorkspace: accountResult.tradeWorkspace || null,
      });
      if (!accountResult.profile) {
        setView("profile");
        return;
      }
      await refreshProjects(nextUser);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Your dashboard could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [refreshProjects]);

  useEffect(() => {
    if (!user) return;
    const frame = window.requestAnimationFrame(() => void load(user));
    return () => window.cancelAnimationFrame(frame);
  }, [load, user]);

  useEffect(() => {
    if (!user) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refreshProjects(user).catch(() => {});
    };
    const intervalId = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshProjects, user]);

  async function saveProfile(profile: CustomerProfile) {
    setAccount((current) => ({ ...current, profile }));
    setView(
      initialView === "new"
        ? "editor"
        : "overview",
    );
    if (user) await load(user);
  }

  async function projectRequest(
    method: "POST" | "PATCH",
    body: Record<string, unknown>,
  ) {
    if (!user) throw new Error("Sign in to continue.");
    const token = await user.getIdToken();
    const response = await fetch("/api/customer-projects", {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      if (
        response.status === 409
        && result.code === "PLAN_REVISION_CONFLICT"
      ) {
        const refreshedResponse = await fetch("/api/customer-projects", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const refreshed = await refreshedResponse.json().catch(() => ({}));
        if (refreshedResponse.ok && refreshed.ok) {
          projectRefreshSequenceRef.current += 1;
          setProjects(refreshed.projects || []);
        }
        throw new Error(PROJECT_REVISION_CONFLICT_MESSAGE);
      }
      throw new Error(result.error || "The project could not be updated.");
    }
    if (Array.isArray(result.projects)) {
      projectRefreshSequenceRef.current += 1;
      setProjects(result.projects as CustomerProject[]);
    }
    return result;
  }

  async function deleteDraftProject() {
    if (!user || !draftToDelete || deleteDraftBusy) return;
    setDeleteDraftBusy(true);
    setDeleteDraftError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/customer-projects", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: draftToDelete.id,
          confirmDelete: true,
          expectedPlanRevision: draftToDelete.planRevision,
          expectedUpdatedAt: draftToDelete.updatedAt,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        if (result.code === "PROJECT_DELETE_CLEANUP_RETRY") {
          const refreshedResponse = await fetch("/api/customer-projects", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          const refreshed = await refreshedResponse.json().catch(() => ({}));
          if (refreshedResponse.ok && refreshed.ok) {
            const refreshedProjects =
              (refreshed.projects || []) as CustomerProject[];
            setProjects(refreshedProjects);
            const refreshedDraft = refreshedProjects.find(
              (project) => project.id === draftToDelete.id,
            );
            if (refreshedDraft) setDraftToDelete(refreshedDraft);
          }
        }
        throw new Error(
          result.error
          || "This draft could not be deleted. Refresh the dashboard and try again.",
        );
      }
      const deletedTitle = draftToDelete.title;
      setProjects(result.projects || []);
      setDraftToDelete(null);
      setStatus(`Draft "${deletedTitle}" was permanently deleted.`);
      window.requestAnimationFrame(() => {
        projectListHeadingRef.current?.focus();
        setDeleteDraftReturnFocus(null);
      });
    } catch (error) {
      setDeleteDraftError(
        error instanceof Error
          ? error.message
          : "This draft could not be deleted. Try again.",
      );
    } finally {
      setDeleteDraftBusy(false);
    }
  }

  async function saveProject(
    draft: ProjectDraft,
    id?: string,
    expectedPlanRevision?: number,
    clientCreateId?: string,
  ) {
    if (id && !expectedPlanRevision) {
      throw new Error("Refresh this project before saving it again.");
    }
    let result = await projectRequest(
      id ? "PATCH" : "POST",
      id
        ? { ...draft, id, action: "update", expectedPlanRevision }
        : { ...draft, clientCreateId },
    );
    const savedId = id || String(result.id);
    let savedProject = (result.projects || []).find(
      (project: CustomerProject) => project.id === savedId,
    );
    if (!id && result.created === false) {
      if (!savedProject || savedProject.status !== "draft") {
        throw new Error(
          "This project was already submitted elsewhere. Return to your overview and review its current status.",
        );
      }
      if (!canUpdateReplayedCustomerDraft(savedProject)) {
        throw new Error(PROJECT_REVISION_CONFLICT_MESSAGE);
      }
      result = await projectRequest("PATCH", {
        ...draft,
        id: savedId,
        action: "update",
        expectedPlanRevision: savedProject.planRevision,
        expectedUpdatedAt: savedProject.updatedAt,
      });
      savedProject = (result.projects || []).find(
        (project: CustomerProject) => project.id === savedId,
      );
    }
    return {
      id: savedId,
      planRevision: Number(savedProject?.planRevision || 1),
    };
  }

  async function uploadProjectEvidence(
    projectId: string,
    evidence: PendingProjectEvidence[],
    confirmInstallerPhotoSharing: boolean,
    onProgress?: (
      evidenceId: string,
      progress: CustomerEvidenceUploadProgress,
    ) => void,
  ) {
    if (!evidence.length) return [];
    if (!user) throw new Error("Sign in to continue.");
    const token = await user.getIdToken();
    const stored: CustomerProject["evidence"] = [];
    for (const item of evidence) {
      try {
        const uploadFile = await prepareEvidenceUpload(item);
        const result = await uploadCustomerProjectEvidence({
          token,
          projectId,
          candidate: {
            ...item,
            file: uploadFile,
          },
          confirmInstallerPhotoSharing,
          onProgress: (progress) => onProgress?.(item.id, progress),
        });
        stored.push(result);
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : `${item.file.name} could not be uploaded.`;
        onProgress?.(item.id, {
          status: "failed",
          progress: item.uploadProgress || 0,
          error: message,
        });
        throw error;
      }
    }
    return stored;
  }

  async function checkInstallerRequestSubmitted(projectId: string) {
    if (!user) throw new Error("Sign in to check this installer request.");
    const token = await user.getIdToken();
    const response = await fetch("/api/customer-projects", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      throw new Error(
        result.error
        || "We could not confirm whether the request was sent. Check your connection and try again.",
      );
    }
    const nextProjects = (result.projects || []) as CustomerProject[];
    setProjects(nextProjects);
    const recovered = nextProjects.find(
      (project) => project.id === projectId,
    );
    return recovered
      && ["matching", "quote_review"].includes(recovered.status)
      ? recovered
      : null;
  }

  async function requestInstallerResponses(
    projectId: string,
    expectedPlanRevision: number,
    confirmAllProjectPhotoSharing: boolean,
    contact: CustomerInstallerRequestContact,
    recoverCommittedSubmit = true,
  ) {
    const keepAuthoritativeContact = (
      savedProfile?: Partial<CustomerProfile> & {
        serviceStreet?: string;
        serviceUnit?: string;
        serviceSuburb?: string;
        servicePostcode?: string;
        serviceState?: string;
      },
      submittedProject?: CustomerProject,
    ) => {
      setAccount((current) => {
        if (!current.profile) return current;
        return {
          ...current,
          profile: {
            ...current.profile,
            phone: savedProfile?.phone || contact.phone,
            addressLine1:
              savedProfile?.addressLine1
              || savedProfile?.serviceStreet
              || contact.addressLine1,
            addressLine2:
              savedProfile?.addressLine2
              || savedProfile?.serviceUnit
              || contact.addressLine2,
            suburb:
              savedProfile?.suburb
              || savedProfile?.serviceSuburb
              || contact.suburb,
            postcode:
              savedProfile?.postcode
              || savedProfile?.servicePostcode
              || submittedProject?.postcode
              || current.profile.postcode,
            addressState:
              savedProfile?.addressState
              || savedProfile?.serviceState
              || submittedProject?.addressState
              || current.profile.addressState,
          },
        };
      });
    };
    try {
      const result = await projectRequest("PATCH", {
        id: projectId,
        action: "submit",
        confirmAllProjectPhotoSharing,
        expectedPlanRevision,
        contact,
      });
      const compactProject = (
        result.project && typeof result.project === "object"
          ? result.project
          : {
              id: projectId,
              status: "matching",
              submittedAt: new Date().toISOString(),
              planRevision: expectedPlanRevision,
            }
      ) as Partial<CustomerProject> & { id: string };
      setProjects((current) =>
        current.map((project) =>
          project.id === projectId
            ? {
                ...project,
                status: compactProject.status || "matching",
                displayStatus:
                  compactProject.displayStatus || "Installer matching",
                submittedAt:
                  compactProject.submittedAt
                  || project.submittedAt
                  || new Date().toISOString(),
                planRevision: Number(
                  compactProject.planRevision || project.planRevision,
                ),
                progress: compactProject.progress
                  ? { ...project.progress, ...compactProject.progress }
                  : project.progress,
              }
            : project,
        ),
      );
      keepAuthoritativeContact(
        result.profile as (
          Partial<CustomerProfile> & {
            serviceStreet?: string;
            serviceUnit?: string;
            serviceSuburb?: string;
            servicePostcode?: string;
            serviceState?: string;
          }
        ) | undefined,
      );
    } catch (error) {
      if (!recoverCommittedSubmit) throw error;
      try {
        const submittedProject =
          await checkInstallerRequestSubmitted(projectId);
        if (submittedProject) {
          keepAuthoritativeContact(undefined, submittedProject);
          return;
        }
      } catch {
        // Preserve the original submit error. The dialog will reconcile the
        // uncertain request status before it allows another submission.
      }
      throw error;
    }
  }

  function completeInstallerRequest() {
    setEditingId("");
    setSelectedId("");
    setView("overview");
    setStatus("Your anonymised project is now in private installer matching.");
    window.history.replaceState({}, "", "/account");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => projectListHeadingRef.current?.focus());
    });
  }

  async function recordProjectOutcome(
    projectId: string,
    input: CustomerPlanProgressInput,
  ) {
    if (!user) throw new Error("Sign in to save a progress check-in.");
    setBusy(true);
    setStatus("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/customer-project-history", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "record_outcome",
          projectId,
          ...input,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        if (
          response.status === 409
          && result.code === "PLAN_REVISION_CONFLICT"
        ) {
          const refreshedResponse = await fetch("/api/customer-projects", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          const refreshed = await refreshedResponse.json().catch(() => ({}));
          if (refreshedResponse.ok && refreshed.ok) {
            setProjects(refreshed.projects || []);
          }
        }
        throw new Error(
          result.error || "The progress check-in could not be saved.",
        );
      }
      const checkin = result.checkin as CustomerProject["outcomeCheckins"][number];
      setProjects((current) =>
        current.map((project) =>
          project.id === projectId
            ? {
                ...project,
                planRevision: Number(result.planRevision || project.planRevision),
                updatedAt: String(result.updatedAt || project.updatedAt),
                outcomeCheckins: [
                  checkin,
                  ...project.outcomeCheckins.filter(
                    (item) => item.id !== checkin.id,
                  ),
                ],
              }
            : project,
        ),
      );
      setStatus(
        "Private progress check-in saved. It is not shared with installers or presented as verified savings.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function projectAction(
    project: CustomerProject,
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    setBusy(true);
    setStatus("");
    try {
      const result = await projectRequest("PATCH", {
        id: project.id,
        action,
        ...extra,
      });
      if (action === "quote_decision" && user) {
        void refreshProjects(user).catch(() => {});
      }
      if (action === "duplicate") {
        setEditingId(result.id);
        setSelectedId("");
        setView("editor");
        window.history.replaceState(
          {},
          "",
          `/account/projects/${result.id}?edit=1`,
        );
      } else if (action === "archive") {
        setView("overview");
        setSelectedId("");
        window.history.replaceState({}, "", "/account");
      } else if (action === "quote_decision" && extra.decision === "accepted")
        setStatus(
          "Installer accepted for the next step. They can now propose arrival windows.",
        );
      else if (action === "quote_decision")
        setStatus(
          "Quote preference saved. Your details remain private until you separately confirm a connection.",
        );
      else if (action === "release_contact")
        setStatus(
          "Contact details released only to the selected verified installer.",
        );
      else if (action === "withdraw_contact")
        setStatus(
          "Future portal access to those contact details has been removed.",
        );
      else if (action === "select_arrival_window")
        setStatus(
          "Installer arrival window selected and recorded for scheduling preparation.",
        );
      else if (action === "select_installer_contact")
        setStatus(
          "Installer business contact details are now available. AEA administrators were notified of the direct-contact choice.",
        );
      else if (action === "acknowledge_arrival_preparation")
        setStatus("Site preparation confirmed for the CRM appointment.");
      else if (action === "record_outcome")
        setStatus(
          "Private progress check-in saved. It is not shared with installers or presented as verified savings.",
        );
      else if (action === "restore_plan_revision")
        setStatus(
          `Version ${String(result.restoredFromRevision || "")} restored as new current version ${String(result.planRevision || "")}. Private notes, evidence and installer activity were not changed.`,
        );
      else if (action === "share_all_photos") {
        setProjects((current) =>
          current.map((currentProject) =>
            currentProject.id === project.id
              ? {
                  ...currentProject,
                  evidenceSharingConsent: true,
                  evidence: currentProject.evidence.map((item) =>
                    item.contentType.startsWith("image/")
                      ? {
                          ...item,
                          sharingScope: "allocated-installers" as const,
                        }
                      : item,
                  ),
                }
              : currentProject,
          ),
        );
        setStatus(
          "All project photos are now available to verified installers allocated to this enquiry. Other documents kept their existing sharing setting.",
        );
      } else setStatus("Project updated.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "The project could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function downloadHandoverDocument(
    document: CustomerHandoverPack["documents"][number],
  ) {
    if (!user) return;
    setBusy(true);
    setStatus("Preparing your protected handover document...");
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/trade-handover/documents?download=${encodeURIComponent(document.id)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(
          result.error || "The handover document could not be downloaded.",
        );
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = document.fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Protected handover document download started.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "The handover document could not be downloaded.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function downloadProjectEvidence(
    item: CustomerProject["evidence"][number],
  ) {
    if (!user) return;
    setBusy(true);
    setStatus("Preparing your protected project file...");
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/customer-project-evidence?download=${encodeURIComponent(item.id)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(
          result.error || "The project file could not be downloaded.",
        );
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = item.fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Protected project file download started.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "The project file could not be downloaded.",
      );
    } finally {
      setBusy(false);
    }
  }

  const loadProjectEvidencePreview = useCallback(
    async (item: GuidedStoredEvidence) => {
      if (!user) throw new Error("Sign in to view this saved photo.");
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/customer-project-evidence?preview=${encodeURIComponent(item.id)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(
          result.error || "The saved photo preview could not be loaded.",
        );
      }
      return response.blob();
    },
    [user],
  );

  async function deleteProjectEvidence(
    item: CustomerProject["evidence"][number],
  ) {
    if (!user) {
      throw new Error("Sign in to remove this saved project file.");
    }
    setBusy(true);
    setStatus("Removing the project file...");
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/customer-project-evidence?id=${encodeURIComponent(
          item.id,
        )}&expectedRevision=${encodeURIComponent(String(item.revision))}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok)
        throw new Error(
          result.error || "The project file could not be removed.",
        );
      await load(user);
      setStatus("Future portal access to that project file has been removed.");
    } catch (error) {
      const failure = error instanceof Error
        ? error
        : new Error("The project file could not be removed.");
      setStatus(failure.message);
      throw failure;
    } finally {
      setBusy(false);
    }
  }

  async function updateProjectEvidence(
    item: CustomerProject["evidence"][number],
    factKeys: string[],
  ) {
    if (!user) return;
    setBusy(true);
    setStatus("Updating the evidence link...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/customer-project-evidence", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: item.id,
          factKeys,
          sharingScope: item.sharingScope,
          expectedRevision: item.revision,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(
          result.error || "The evidence link could not be updated.",
        );
      }
      await load(user);
      setStatus("Evidence link updated. A linked file remains available for review, not verified.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "The evidence link could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmail() {
    if (!user) return;
    setBusy(true);
    try {
      await sendEmailVerification(user);
      setStatus(
        "A fresh verification link has been sent to your account email.",
      );
    } catch {
      setStatus("The verification email could not be sent. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  const selected = projects.find((project) => project.id === selectedId);
  const editing = projects.find((project) => project.id === editingId);
  const activeProjects = projects.filter(
    (project) =>
      !project.deletionPending
      && ["draft", "matching", "quote_review"].includes(project.status),
  );
  const deletionBlockedProject =
    view === "editor"
      ? editing?.deletionPending
        ? editing
        : null
      : view === "detail" && selected?.deletionPending
        ? selected
        : null;
  const completedSteps = projects.reduce(
    (sum, project) => sum + project.completedPlanItems.length,
    0,
  );
  const responseCount = projects.reduce(
    (sum, project) => sum + project.progress.responseCount,
    0,
  );
  const projectQuotes = useMemo(
    () =>
      projects.flatMap((project) =>
        project.quotes
          .map((quote) => ({
            projectId: project.id,
            projectTitle: project.title,
            quote,
          })),
      ).sort((left, right) =>
        right.quote.submittedAt.localeCompare(left.quote.submittedAt),
      ),
    [projects],
  );
  const quotesAwaitingReview = useMemo(
    () =>
      projectQuotes.filter(({ quote }) =>
        ["reviewing", "shortlisted"].includes(quote.customerDecision),
      ),
    [projectQuotes],
  );
  const quoteReviewCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    quotesAwaitingReview.forEach(({ projectId }) => {
      counts.set(projectId, (counts.get(projectId) || 0) + 1);
    });
    return counts;
  }, [quotesAwaitingReview]);
  const visibleProjectsWithQuoteCounts = useMemo(
    () =>
      projects
        .filter((project) => project.status !== "archived")
        .map((project) => ({
          project,
          installerQuoteCount: quoteReviewCountByProject.get(project.id) || 0,
        })),
    [projects, quoteReviewCountByProject],
  );
  const selectedProjectId = selected?.id || "";
  const selectedQuoteCount = selected?.quotes.length || 0;

  useEffect(() => {
    if (
      !authReady
      || loading
      || !user
      || view !== "detail"
      || !selectedProjectId
      || selectedQuoteCount === 0
      || window.location.hash !== "#structured-quote-options"
    ) {
      return;
    }
    let focusFrame = 0;
    const scrollFrame = window.requestAnimationFrame(() => {
      focusFrame = window.requestAnimationFrame(() => {
        const target = window.document.getElementById(
          "structured-quote-options",
        );
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
        target?.focus({ preventScroll: true });
      });
    });
    return () => {
      window.cancelAnimationFrame(scrollFrame);
      if (focusFrame) window.cancelAnimationFrame(focusFrame);
    };
  }, [
    authReady,
    loading,
    selectedProjectId,
    selectedQuoteCount,
    user,
    view,
  ]);

  return (
    <main id="main-content" className="wrap customer-account-page">
      <SiteHeader active="account" />
      {!authReady || loading ? (
        <section className="customer-loading-state" aria-live="polite">
          <span />
          <div>
            <strong>Preparing your private dashboard</strong>
            <p>Loading saved homes, projects and roadmaps...</p>
          </div>
        </section>
      ) : !user ? (
        <>
          <header className="customer-account-hero">
            <div>
              <span>Private home energy workspace</span>
              <h1>
                Plan every upgrade without opening the door to sales calls
              </h1>
              <p>
                Create projects, save a whole-home roadmap and request
                structured installer options. Your identity stays private until
                you choose a specific installer.
              </p>
              <div>
                <strong>Always free for households</strong>
                <small>All household project tools are included at no cost.</small>
              </div>
            </div>
            <aside>
              <span>What trades can see first</span>
              <strong>An anonymised project scope</strong>
              <ul>
                <li>Controlled work categories and timing</li>
                <li>State and service-area eligibility</li>
                <li>
                  No name, email, phone or exact address until you connect
                </li>
              </ul>
            </aside>
          </header>
          <FirebaseAccountPanel />
          <section className="customer-public-benefits">
            <article>
              <span>01</span>
              <h2>Build more than one project</h2>
              <p>
                Keep heating, solar, hot water, insulation and EV plans separate
                or coordinate them as one staged roadmap.
              </p>
            </article>
            <article>
              <span>02</span>
              <h2>Return to your decisions</h2>
              <p>
                Save recommendations, mark roadmap steps complete and keep
                private notes without resubmitting your details.
              </p>
            </article>
            <article>
              <span>03</span>
              <h2>Control each connection</h2>
              <p>
                Review structured options anonymously, then release contact
                details only to the verified installer you choose.
              </p>
            </article>
          </section>
        </>
      ) : !account.profile || view === "profile" ? (
        <>
          <header className="customer-compact-hero">
            <div>
              <span>
                {account.profile
                  ? "Household settings"
                  : "Welcome to your free account"}
              </span>
              <h1>
                {account.profile
                  ? "Keep your defaults and privacy choices current"
                  : "Set up your private household workspace"}
              </h1>
              <p>
                {account.profile
                  ? "Changes apply to future projects. Existing submitted scopes remain locked."
                  : "A few private defaults make each new project faster. Nothing is sent to installers during setup."}
              </p>
            </div>
            <div className="customer-account-controls">
              <span>{user.email}</span>
              {account.profile && <a href="/account">Back to dashboard</a>}
              <button type="button" onClick={() => void signOut(firebaseAuth)}>
                Sign out
              </button>
            </div>
          </header>
          <ProfileForm
            user={user}
            profile={account.profile}
            onSaved={(profile) => void saveProfile(profile)}
          />
        </>
      ) : (
        <>
          <header className="customer-dashboard-hero">
            <div>
              <span>Welcome back, {account.profile.displayName}</span>
              <h1>Your home upgrade plans</h1>
              <p>
                See what to do next, start another project or review installer
                options before choosing any direct contact handover.
              </p>
            </div>
            <aside>
              <span>Household account</span>
              <strong>Always free</strong>
              <small>
                All planning, projects and response tools are included.
              </small>
            </aside>
          </header>
          <nav className="customer-dashboard-nav" aria-label="Customer account">
            <a className={view === "overview" ? "active" : ""} href="/account">
              Overview
            </a>
            <a
              className={`customer-nav-quote-link${view === "quotes" ? " active" : ""}`}
              href="/account/quotes"
            >
              Quotes
              {quotesAwaitingReview.length > 0 && (
                <span
                  className="customer-nav-quote-badge"
                  aria-label={`${quotesAwaitingReview.length} installer ${quotesAwaitingReview.length === 1 ? "quote" : "quotes"} awaiting review`}
                >
                  {quotesAwaitingReview.length}
                </span>
              )}
            </a>
            <a
              className={view === "appointments" ? "active" : ""}
              href="/account/appointments"
            >
              Appointments
            </a>
            <a
              className={view === "editor" && !editingId ? "active" : ""}
              href="/account/projects/new"
            >
              New project
            </a>
            <a href="/account/profile">Privacy and profile</a>
            {account.tradeWorkspace && (
              <a href="/direct-trade/dashboard">Trade workspace</a>
            )}
            <button type="button" onClick={() => void signOut(firebaseAuth)}>
              Sign out
            </button>
          </nav>
          {!account.emailVerified && (
            <section className="customer-verification-banner" role="status">
              <div>
                <strong>
                  Verify your email before sending an enquiry or accepting a
                  direct quote
                </strong>
                <p>
                  You can create and save projects now. Verification protects
                  installer responses and binding quote decisions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void verifyEmail()}
                disabled={busy}
              >
                Send verification link
              </button>
            </section>
          )}
          {status && (
            <p className="customer-dashboard-status" role="status">
              {status}
            </p>
          )}
          {deletionBlockedProject ? (
            <section
              className="customer-project-delete-recovery"
              role="status"
            >
              <span>Secure deletion is paused</span>
              <h1>Finish removing this draft</h1>
              <p>
                This draft is locked while its remaining private files are
                removed. You cannot continue editing it, but you can safely
                retry the cleanup now.
              </p>
              <div>
                <a href="/account">Return to overview</a>
                <button
                  type="button"
                  onClick={(event) => {
                    setDeleteDraftReturnFocus(event.currentTarget);
                    setDeleteDraftError("");
                    setDraftToDelete(deletionBlockedProject);
                  }}
                >
                  Finish deleting
                </button>
              </div>
            </section>
          ) : view === "editor" ? (
            <ProjectEditor
              key={`${editing?.id || "new"}:${projectConflictVersion}`}
              initial={
                editing
                  ? {
                      title: editing.title,
                      homeNickname: editing.homeNickname,
                      postcode: editing.postcode,
                      addressState: editing.addressState,
                      propertyType: editing.propertyType,
                      householdSituation: editing.householdSituation,
                      goal: editing.goal,
                      goals:
                        editing.goals?.length > 0
                          ? editing.goals
                          : [editing.goal],
                      pace: editing.pace,
                      existingFeatures: editing.existingFeatures,
                      serviceCategories: editing.serviceCategories,
                      priorities: editing.priorities,
                      projectStage: editing.projectStage,
                      timing: editing.timing,
                      budgetRange: editing.budgetRange,
                      propertyContext: {
                        ...projectDefaults(account.profile).propertyContext,
                        ...(editing.propertyContext || {}),
                      },
                      advisorProfile: {
                        ...projectDefaults(account.profile).advisorProfile,
                        ...(editing.advisorProfile || {}),
                        factEvidence:
                          editing.advisorProfile?.factEvidence
                          || projectDefaults(account.profile).advisorProfile
                            .factEvidence,
                        rooms: editing.advisorProfile?.rooms || [],
                        permissionItems:
                          editing.advisorProfile?.permissionItems || [],
                        reviewItems:
                          editing.advisorProfile?.reviewItems || [],
                      },
                      privateNotes: editing.privateNotes,
                      planSnapshot: editing.planSnapshot,
                    }
                  : projectDefaultsWithSelection(
                      account.profile,
                      initialPlannerSelection,
                    )
              }
              existingId={editing?.id}
              existingPlanRevision={editing?.planRevision}
              storedEvidence={editing?.evidence || []}
              emailVerified={account.emailVerified}
              profile={account.profile}
              onCancel={() => {
                setView("overview");
                setEditingId("");
              }}
              onReloadLatest={() =>
                setProjectConflictVersion((current) => current + 1)
              }
              onSave={saveProject}
              onUploadEvidence={uploadProjectEvidence}
              onLoadEvidencePreview={loadProjectEvidencePreview}
              onDeleteEvidence={deleteProjectEvidence}
              onCheckInstallerRequestSubmitted={checkInstallerRequestSubmitted}
              onRequestInstallerResponses={requestInstallerResponses}
              onRequestComplete={completeInstallerRequest}
            />
          ) : view === "detail" && selected ? (
            <ProjectDetail
              user={user}
              project={selected}
              profile={account.profile}
              emailVerified={account.emailVerified}
              busy={busy}
              onAction={(action, extra) =>
                projectAction(selected, action, extra)
              }
              onRequestStart={() => setStatus("")}
              onCheckInstallerRequestSubmitted={checkInstallerRequestSubmitted}
              onRequestInstallerResponses={requestInstallerResponses}
              onRequestComplete={completeInstallerRequest}
              onDownloadHandover={downloadHandoverDocument}
              onDownloadEvidence={downloadProjectEvidence}
              onDeleteEvidence={deleteProjectEvidence}
              onUpdateEvidence={updateProjectEvidence}
              onRecordOutcome={recordProjectOutcome}
            />
          ) : view === "quotes" ? (
            <section
              className="customer-quote-centre"
              aria-labelledby="customer-quote-centre-heading"
            >
              <header>
                <div>
                  <span>Your quote centre</span>
                  <h2 id="customer-quote-centre-heading">
                    Your project installer quotes
                  </h2>
                  <p>
                    Compare each response inside its project before choosing a
                    shortlist or sharing any contact details.
                  </p>
                </div>
                <strong>
                  {quotesAwaitingReview.length}{" "}
                  {quotesAwaitingReview.length === 1
                    ? "quote to review"
                    : "quotes to review"}
                </strong>
              </header>
              {projectQuotes.length > 0 ? (
                <div className="customer-project-quote-list">
                  {projectQuotes.map(
                    ({ projectId, projectTitle, quote }) => (
                      <article key={`${projectId}:${quote.id}`}>
                        <header>
                          <div>
                            <span>
                              {quote.customerDecision === "accepted"
                                ? "Accepted for the next step"
                                : quote.customerDecision === "shortlisted"
                                  ? "Shortlisted, next step ready"
                                  : quote.customerDecision === "declined"
                                    ? "Not selected"
                                    : "Ready to review"}
                            </span>
                            <h3>{quote.installerBusinessName}</h3>
                          </div>
                          {quote.installerVerified && (
                            <strong>Verified installer</strong>
                          )}
                        </header>
                        <dl>
                          <div>
                            <dt>Project</dt>
                            <dd>{projectTitle}</dd>
                          </div>
                          <div>
                            <dt>Total including GST</dt>
                            <dd>
                              {currency(
                                Math.round(quote.totalCentsExGst * 1.1),
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>Submitted</dt>
                            <dd>
                              <time dateTime={quote.submittedAt}>
                                {new Date(
                                  quote.submittedAt,
                                ).toLocaleDateString("en-AU", {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </time>
                            </dd>
                          </div>
                        </dl>
                        <a
                          href={`/account/projects/${projectId}#structured-quote-options`}
                        >
                          {quote.customerDecision === "accepted"
                            ? "View accepted quote"
                            : quote.customerDecision === "shortlisted"
                              ? "Continue with quote"
                              : quote.customerDecision === "declined"
                                ? "View quote history"
                                : "Review quote"}
                        </a>
                      </article>
                    ),
                  )}
                </div>
              ) : (
                <div className="customer-quote-centre-empty" role="status">
                  <strong>No project installer quotes yet</strong>
                  <p>
                    New installer responses will appear here and on the related
                    project as soon as they are ready.
                  </p>
                </div>
              )}
              <section
                className="customer-quote-centre-secondary"
                aria-labelledby="customer-direct-quotes-heading"
              >
                <div className="customer-panel-heading">
                  <span>Other quote tools</span>
                  <h2 id="customer-direct-quotes-heading">
                    Direct service quotes
                  </h2>
                  <p>
                    Review quote requests created outside a saved home upgrade
                    project.
                  </p>
                </div>
                <CustomerTradeQuotes user={user} />
              </section>
            </section>
          ) : view === "appointments" ? (
            <CustomerAppointmentRescheduling user={user} />
          ) : (
            <>
              {quotesAwaitingReview.length > 0 && (
                <section
                  className="customer-quote-ready-alert"
                  role="status"
                  aria-labelledby="customer-quote-ready-heading"
                >
                  <div>
                    <span>Installer quotes ready</span>
                    <h2 id="customer-quote-ready-heading">
                      {quotesAwaitingReview.length}{" "}
                      {quotesAwaitingReview.length === 1
                        ? "quote is waiting"
                        : "quotes are waiting"}{" "}
                      for your review
                    </h2>
                    <p>
                      Compare the details before you shortlist an installer or
                      share any contact information.
                    </p>
                  </div>
                  <a href="/account/quotes">Review your quotes</a>
                </section>
              )}
              <section className="customer-metric-grid">
                <article>
                  <span>Active projects</span>
                  <strong>{activeProjects.length}</strong>
                  <small>
                    {projects.length
                      ? `${projects.length} saved in total`
                      : "Create your first saved plan"}
                  </small>
                </article>
                <article>
                  <span>Plan progress</span>
                  <strong>{completedSteps}</strong>
                  <small>steps completed across your homes</small>
                </article>
                <article>
                  <span>Installer options</span>
                  <strong>{responseCount}</strong>
                  <small>replies kept inside AEA</small>
                </article>
                <article className="privacy">
                  <span>Your details</span>
                  <strong>You decide</strong>
                  <small>released only to a selected installer</small>
                </article>
              </section>
              <div className="customer-overview-grid">
                <section className="customer-project-list-panel">
                  <div className="customer-panel-heading">
                    <span>My projects</span>
                    <h2 ref={projectListHeadingRef} tabIndex={-1}>
                      Continue where you left off
                    </h2>
                    <p>
                      Each saved plan and price enquiry stays separate in your
                      free account.
                    </p>
                  </div>
                  {visibleProjectsWithQuoteCounts.length ? (
                    <div className="customer-project-list">
                      {visibleProjectsWithQuoteCounts.map(
                        ({ project, installerQuoteCount }) => (
                          <article key={project.id}>
                            <header>
                              <div>
                                <span>
                                  {statusLabels[project.displayStatus] ||
                                    project.displayStatus}
                                </span>
                                <h3>{project.title}</h3>
                              </div>
                              <strong>{project.addressState}</strong>
                            </header>
                            <p>
                              {project.serviceCategories.length
                                ? project.serviceCategories
                                    .map((item) =>
                                      optionLabel(
                                        customerProjectOptions.serviceCategories,
                                        item,
                                      ),
                                    )
                                    .join(", ")
                                : "Planning only, no installer work selected"}
                            </p>
                            <div className="customer-project-card-progress">
                              <span>
                                <i
                                  style={{
                                    width: `${Math.round((project.completedPlanItems.length / Math.max(1, project.planSnapshot.items?.length || 1)) * 100)}%`,
                                  }}
                                />
                              </span>
                              <small>
                                {project.completedPlanItems.length} of{" "}
                                {project.planSnapshot.items?.length || 0} plan
                                steps complete
                              </small>
                            </div>
                            {project.deletionPending && (
                              <p
                                className="customer-project-delete-pending"
                                role="status"
                              >
                                File cleanup paused before this draft was fully
                                removed. Finish deleting to complete it safely.
                              </p>
                            )}
                            <footer className="customer-project-card-footer">
                              <small>
                                Updated{" "}
                                {new Date(project.updatedAt).toLocaleDateString(
                                  "en-AU",
                                )}
                              </small>
                              <div className="customer-project-card-actions">
                                {project.status === "draft" && (
                                  <button
                                    className="customer-project-card-delete"
                                    type="button"
                                    aria-label={
                                      project.deletionPending
                                        ? `Finish deleting draft ${project.title}`
                                        : `Delete draft ${project.title}`
                                    }
                                    onClick={(event) => {
                                      setDeleteDraftReturnFocus(
                                        event.currentTarget,
                                      );
                                      setDeleteDraftError("");
                                      setDraftToDelete(project);
                                    }}
                                  >
                                    {project.deletionPending
                                      ? "Finish deleting"
                                      : "Delete draft"}
                                  </button>
                                )}
                                {!project.deletionPending && (
                                  <a
                                    className="customer-project-card-open"
                                    href={
                                      installerQuoteCount > 0
                                        ? `/account/projects/${project.id}#structured-quote-options`
                                        : `/account/projects/${project.id}`
                                    }
                                    aria-label={
                                      installerQuoteCount > 0
                                        ? `Review ${installerQuoteCount} installer ${installerQuoteCount === 1 ? "quote" : "quotes"} for ${project.title}`
                                        : undefined
                                    }
                                  >
                                    {installerQuoteCount > 0
                                      ? `Review ${installerQuoteCount} installer ${installerQuoteCount === 1 ? "quote" : "quotes"}`
                                      : project.status === "draft"
                                        ? "Continue project"
                                        : "Open project"}
                                  </a>
                                )}
                              </div>
                            </footer>
                          </article>
                        ),
                      )}
                    </div>
                  ) : (
                    <div className="customer-empty-state">
                      <span>Start with one decision</span>
                      <h3>Create your first home project</h3>
                      <p>
                        Build a step-by-step plan first. You decide later
                        whether to request installer options.
                      </p>
                      <a className="btn" href="/account/projects/new">
                        Create a project
                      </a>
                    </div>
                  )}
                </section>
                <aside className="customer-overview-sidebar">
                  <section>
                    <span>Your privacy boundary</span>
                    <h2>Personal information stays on this side</h2>
                    <ul>
                      <li>Trades cannot browse your account profile</li>
                      <li>Exact postcode is used for matching, then hidden</li>
                      <li>Private notes never enter the trade scope</li>
                      <li>
                        Each real contact handover requires your named-installer
                        confirmation
                      </li>
                    </ul>
                    <a href="/account/profile">Review privacy settings</a>
                  </section>
                  <section>
                    <span>Recommended next step</span>
                    <h2>
                      {activeProjects.length
                        ? "Complete the next plan step"
                        : "Start a whole-home plan"}
                    </h2>
                    <p>
                      {activeProjects.length
                        ? `Open ${activeProjects[0].title} and mark the next decision you have completed.`
                        : "A saved project gives you a clear order of work you can return to."}
                    </p>
                    <a
                      href={
                        activeProjects.length
                          ? `/account/projects/${activeProjects[0].id}`
                          : "/account/projects/new"
                      }
                    >
                      {activeProjects.length
                        ? "Continue project"
                        : "Build a project"}
                    </a>
                  </section>
                </aside>
              </div>
            </>
          )}
        </>
      )}
      <CustomerDraftDeleteDialog
        open={Boolean(draftToDelete)}
        projectTitle={draftToDelete?.title || ""}
        busy={deleteDraftBusy}
        error={deleteDraftError}
        recovery={Boolean(draftToDelete?.deletionPending)}
        returnFocus={deleteDraftReturnFocus}
        onCancel={() => {
          if (deleteDraftBusy) return;
          setDeleteDraftError("");
          setDraftToDelete(null);
          window.requestAnimationFrame(() => {
            setDeleteDraftReturnFocus(null);
          });
        }}
        onConfirm={() => void deleteDraftProject()}
      />
      <SiteFooter>
        Customer accounts, saved roadmaps and project enquiries remain free.
        Installer responses are indicative until the complete property,
        products, approvals and installed scope are confirmed in writing.
      </SiteFooter>
    </main>
  );
}
