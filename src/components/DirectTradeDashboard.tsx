"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { SiteFooter } from "./SiteFooter";
import { TradeBusinessHub } from "./TradeBusinessHub";
import {
  AeaProductLink,
  TLinkBrand,
  TLinkHeader,
} from "./TLinkChrome";
import { TLinkCommandCentre, type TLinkCommandTarget } from "./TLinkCommandCentre";
import { TradeJobNotifications } from "./TradeJobNotifications";
import { isCalendarIntegration, readIntegrationReturn } from "@/lib/trade-integration-return";
import { CustomerPlanReportPreviewDialog } from "./CustomerPlanReportPreviewDialog";
import { downloadCustomerPlanPdf } from "@/lib/customer-plan-pdf-client";
import type { CustomerPlanReportView } from "@/lib/customer-plan-report";
import {
  type FeatureKey,
} from "@/lib/direct-trade-entitlements";
import { DEFAULT_TRADE_BRAND_THEME } from "@/lib/trade-business-branding";
import { ENERGY_SERVICE_LABELS } from "@/lib/energy-service-catalogue.mjs";
import { publicLeadQuoteNavigationTarget } from "@/lib/public-lead-quote-workflow.mjs";
import {
  TradeBusinessSettingsWorkspace,
  tradeBusinessThemeGradient,
  type TradeBusinessSettingsProfile,
} from "./TradeBusinessSettingsWorkspace";
import { resetTradeDashboardStateOnUidChange } from "./trade-rebate-calculator-state";
import {
  readTLinkColourMode,
  TLINK_COLOUR_MODE_STORAGE_KEY,
  type TLinkColourMode,
  writeTLinkColourMode,
} from "@/lib/tlink-colour-mode";

const SupplierCatalogueWorkspace = dynamic(() => import("./SupplierCatalogueWorkspace").then((module) => module.SupplierCatalogueWorkspace));
const InstallerProductMarketplace = dynamic(() => import("./InstallerProductMarketplace").then((module) => module.InstallerProductMarketplace));
const InstallerPlatformQuote = dynamic(() => import("./InstallerPlatformQuote").then((module) => module.InstallerPlatformQuote));
const InstallerArrivalWindows = dynamic(() => import("./InstallerArrivalWindows").then((module) => module.InstallerArrivalWindows));
const TradePurchasingWorkspace = dynamic(() => import("./TradePurchasingWorkspace").then((module) => module.TradePurchasingWorkspace));
const TradeDataImportWorkspace = dynamic(() => import("./TradeDataImportWorkspace").then((module) => module.TradeDataImportWorkspace));
const TradeInvoiceWorkspace = dynamic(() => import("./TradeInvoiceWorkspace").then((module) => module.TradeInvoiceWorkspace));
const TradeServiceFollowUpWorkspace = dynamic(() => import("./TradeServiceFollowUpWorkspace").then((module) => module.TradeServiceFollowUpWorkspace));
const TradeRebateCalculatorWorkspace = dynamic(() => import("./TradeRebateCalculatorWorkspace").then((module) => module.TradeRebateCalculatorWorkspace));
const TradeTeamSettings = dynamic(() => import("./TradeTeamSettings").then((module) => module.TradeTeamSettings));

type DashboardProfile = TradeBusinessSettingsProfile & {
  entitlements: {
    verified: boolean;
    accessLabel: string;
    features: Record<FeatureKey, boolean>;
  };
};

type DashboardOpportunity = {
  matchId: string;
  matchStatus:
    "offered" | "viewed" | "interested" | "declined" | "connected" | "closed";
  matchedAt: string;
  updatedAt: string;
  id: string;
  title: string;
  projectType: string;
  suburb: string;
  postcode: string;
  state: string;
  serviceCategories: string[];
  matchedCategories: string[];
  distanceBand: string;
  allocationRank: number;
  contactAttemptCount: number;
  contactLimit: number;
  lastContactAt: string;
  connectedAt: string;
  expiresAt: string;
  priority: string;
  timing: string;
  summary: string;
  propertyContext: Record<string, string | string[]>;
  enquiryPack: null | {
    version: string;
    planTitle: string;
    summary: string;
    goals: string[];
    planBoundary: {
      pace: string;
      budget: string;
    };
    homeContext: {
      propertyType: string;
      tenure: string;
      state: string;
      approval: string;
      details: string[];
      consideredWork: string[];
    };
    readiness: {
      answered: number;
      total: number;
      notSure: number;
      missing: number;
      message: string;
      boundary: string;
    };
    actionCount: number;
    privacyNote: string;
    adviceBoundary: string;
  };
  quotePreparation: null | {
    answers: Array<{
      questionId: string;
      label: string;
      answer: string;
      services: string[];
    }>;
    expectedPhotoCount: number;
    availablePhotoCount: number;
  };
  approvedSharedFileCount: number;
  opportunityStatus: string;
  platformOnly: boolean;
  customerContact: null | {
    name: string;
    email: string;
    phone: string;
    addressLine1: string;
    addressLine2: string;
    suburb: string;
    addressState: string;
    postcode: string;
    grantedAt: string;
    message: string;
    releaseScope: "shortlisted_installer" | "all_qualified_trades";
  };
  evidence: Array<{
    id: string;
    category: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    createdAt: string;
    sharingScope: "allocated-installers";
    promptLabel: string;
    downloadHref: string;
  }>;
  arrivalProposal: null | {
    id: string;
    status: "proposed" | "selected" | "direct_contact" | "withdrawn";
    windows: Array<{ id: string; startsAt: string; endsAt: string }>;
    installerNote: string;
    selectedWindow: null | { id: string; startsAt: string; endsAt: string };
    revision: number;
    proposedAt: string;
    selectedAt: string;
    crmWorkOrderId: string;
    crmAppointmentId: string;
    preparationAcknowledgedAt: string;
  };
  quote: null | {
    productListId: string;
    inclusions: string[];
    productSubtotalCentsExGst: number;
    labourCentsExGst: number;
    otherCentsExGst: number;
    totalCentsExGst: number;
    quoteType: string;
    startWindow: string;
    durationWeeks: number;
    workmanshipWarrantyYears: number;
    status: string;
    customerDecision: string;
  };
};
type ProtectedPhotoLightbox = {
  item: DashboardOpportunity["evidence"][number];
  url: string;
  alt: string;
  status: "loading" | "ready" | "error";
};
type PublicLeadHandoffState = {
  matchId: string;
  customerName: string;
  phase: "working" | "success" | "error";
  stageIndex: number;
  error: string;
  requestReference: string;
  workNumber: string;
};

const publicLeadHandoffStages = [
  {
    progress: 16,
    title: "Starting the protected handoff",
    detail: "Preparing the customer, site, job and quote request.",
  },
  {
    progress: 42,
    title: "Processing the job and quote details",
    detail: "Keeping the customer details connected to this exact business job.",
  },
  {
    progress: 68,
    title: "Securing shared files with the job",
    detail: "Keeping customer-shared photos available from the new job files.",
  },
  {
    progress: 86,
    title: "Waiting for the server to confirm the quote",
    detail: "The quote will open automatically as soon as the handoff is confirmed.",
  },
] as const;
type DashboardWorkspace = "work" | "team" | "invoices" | "follow-ups" | "products" | "calculator" | "orders" | "import" | "account";
const dashboardWorkspaces = new Set<DashboardWorkspace>([
  "work",
  "team",
  "invoices",
  "follow-ups",
  "products",
  "calculator",
  "orders",
  "import",
  "account",
]);

function dashboardWorkspaceFromSearch(search: string): DashboardWorkspace {
  const requested = new URLSearchParams(search).get("workspace");
  if (requested === "schedule" || requested === "leads") return "work";
  return dashboardWorkspaces.has(requested as DashboardWorkspace)
    ? requested as DashboardWorkspace
    : "work";
}

function dashboardWorkViewFromSearch(search: string) {
  const requested = new URLSearchParams(search).get("workspace");
  if (requested === "schedule" || requested === "leads") return requested;
  return "today";
}

const workOrderIdPattern = /^[A-Za-z0-9:_-]{1,180}$/;

function jobNavigationFromSearch(search: string): TLinkCommandTarget | null {
  const parameters = new URLSearchParams(search);
  const jobId = parameters.get("jobId") || "";
  if (dashboardWorkspaceFromSearch(search) !== "work" || !workOrderIdPattern.test(jobId)) return null;
  return { workspace: "work", kind: "job", id: jobId, query: "", jobTab: "schedule", nonce: Date.now() };
}

function dashboardCommandTargetFromSearch(search: string): TLinkCommandTarget | null {
  const jobTarget = jobNavigationFromSearch(search);
  if (jobTarget) return jobTarget;
  const parameters = new URLSearchParams(search);
  if (parameters.get("workspace") === "schedule") {
    return { workspace: "work", kind: "crm-view", id: "schedule", query: "", nonce: Date.now() };
  }
  if (parameters.get("workspace") === "leads") {
    return { workspace: "work", kind: "crm-view", id: "leads", query: "", nonce: Date.now() };
  }
  const teamMemberId = parameters.get("teamMemberId") || "";
  if (parameters.get("workspace") === "team" && teamMemberId) {
    return { workspace: "team", kind: "team", id: teamMemberId, query: "", nonce: Date.now() };
  }
  return null;
}

const opportunityMatchIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function opportunityMatchFromSearch(search: string) {
  const requested = new URLSearchParams(search).get("matchId") || "";
  return opportunityMatchIdPattern.test(requested) ? requested : "";
}

function protectedIdentityContinuationIsCurrent(
  capturedUid = "",
  capturedRevision = -1,
  currentUid = "",
  currentRevision = -1,
) {
  return Boolean(capturedUid)
    && capturedUid === currentUid
    && capturedRevision === currentRevision;
}

function shouldClearOpportunityDeepLink(
  previousUid = "",
  nextUid = "",
) {
  return Boolean(previousUid) && previousUid !== nextUid;
}

function opportunityBroadLocation(opportunity: DashboardOpportunity) {
  const locality = [opportunity.suburb, opportunity.postcode]
    .filter(Boolean)
    .join(" ");
  return locality
    ? `${locality}, ${opportunity.state}`
    : `${opportunity.state} region`;
}

function opportunityNextAction(opportunity: DashboardOpportunity) {
  if (
    opportunity.quote?.customerDecision === "accepted"
  ) {
    return opportunity.customerContact
      ? "Customer contact ready"
      : "Customer choice recorded";
  }
  if (opportunity.quote?.status === "submitted") {
    return "Quote with customer";
  }
  if (opportunity.matchStatus === "interested") {
    return "Prepare the quote";
  }
  if (opportunity.matchStatus === "connected") {
    return "Review customer progress";
  }
  if (opportunity.matchStatus === "declined") {
    return "No action required";
  }
  if (opportunity.matchStatus === "closed") {
    return "Lead closed";
  }
  return "Review and respond";
}

const capabilityLabels: Record<string, string> = {
  ...ENERGY_SERVICE_LABELS,
  electrical: "Electrical services",
  plumbing: "Plumbing services",
  "mounting-hardware": "Mounting and hardware",
  controls: "Energy controls",
};

function ProtectedPhotoThumbnail({
  url,
  alt,
  onOpen,
}: {
  url: string;
  alt: string;
  onOpen: () => void;
}) {
  if (!url) {
    return (
      <div className="dashboard-enquiry-thumbnail-unavailable">
        Preview unavailable. The protected download may still be available.
      </div>
    );
  }

  return (
    <button
      type="button"
      className="dashboard-enquiry-photo-button"
      aria-label={`View full image: ${alt}`}
      onClick={onOpen}
    >
      {/* Authenticated evidence is exposed as a short-lived object URL. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} />
      <span aria-hidden="true">View full image</span>
    </button>
  );
}

function EnquiryPack({
  opportunity,
  photoUrls,
  photosVisible,
  photoBusy,
  photoError,
  downloadBusy,
  planBusy,
  planError,
  onTogglePhotos,
  onViewPhoto,
  onDownload,
  onOpenPlan,
  onDownloadPlan,
}: {
  opportunity: DashboardOpportunity;
  photoUrls: Record<string, string>;
  photosVisible: boolean;
  photoBusy: boolean;
  photoError: string;
  downloadBusy: string;
  planBusy: boolean;
  planError: string;
  onTogglePhotos: () => void;
  onViewPhoto: (
    item: DashboardOpportunity["evidence"][number],
    url: string,
    alt: string,
  ) => void;
  onDownload: (item: DashboardOpportunity["evidence"][number]) => void;
  onOpenPlan: () => void;
  onDownloadPlan: () => void;
}) {
  const pack = opportunity.enquiryPack;
  if (!pack) return null;
  const photos = opportunity.evidence.filter((item) =>
    item.contentType.startsWith("image/")
  );
  const documents = opportunity.evidence.filter(
    (item) => item.contentType === "application/pdf",
  );
  const sharedFileCount = opportunity.approvedSharedFileCount;

  return (
    <section className="dashboard-enquiry-pack" aria-label="Enquiry pack">
      <div className="dashboard-enquiry-pack-heading">
        <div>
          <span>Enquiry pack</span>
          <h4>{pack.planTitle}</h4>
          {pack.summary && <p>{pack.summary}</p>}
        </div>
        <strong>
          {sharedFileCount} shared file{sharedFileCount === 1 ? "" : "s"}
        </strong>
      </div>

      <div className="dashboard-enquiry-pack-grid">
        <div>
          <span>Customer goals</span>
          <p>{pack.goals.join(", ") || "No goals recorded"}</p>
        </div>
        <div>
          <span>Plan boundary</span>
          <p>{pack.planBoundary.pace} | {pack.planBoundary.budget}</p>
        </div>
        <div>
          <span>Home context</span>
          <p>
            {[pack.homeContext.propertyType, pack.homeContext.tenure, pack.homeContext.state]
              .filter(Boolean)
              .join(", ")}
          </p>
          <small>{pack.homeContext.details.join(", ")}</small>
          {pack.homeContext.consideredWork.length > 0 && (
            <small>
              Work being considered: {pack.homeContext.consideredWork.join(", ")}
            </small>
          )}
          {pack.homeContext.approval && (
            <small>Approval: {pack.homeContext.approval}</small>
          )}
        </div>
        <div>
          <span>Planning readiness</span>
          <p>{pack.readiness.message}</p>
          <small>{pack.readiness.boundary}</small>
        </div>
      </div>

      <div className="dashboard-enquiry-plan-actions">
        <div>
          <span>Complete privacy-safe plan</span>
          <strong>
            {pack.actionCount} ordered step{pack.actionCount === 1 ? "" : "s"}
          </strong>
          <small>
            Open the complete customer plan before preparing a scope or quote.
          </small>
        </div>
        <div>
          <button type="button" disabled={planBusy} onClick={onOpenPlan}>
            {planBusy ? "Opening complete plan..." : "Open complete plan"}
          </button>
          <button type="button" disabled={planBusy} onClick={onDownloadPlan}>
            Download complete plan PDF
          </button>
        </div>
        {planError && (
          <p className="dashboard-enquiry-plan-error" role="alert">
            {planError}
          </p>
        )}
      </div>

      <div className="dashboard-enquiry-evidence">
        <div className="dashboard-enquiry-evidence-heading">
          <div>
            <span>Customer-shared files</span>
            <strong>
              {sharedFileCount
                ? `${sharedFileCount} protected file${sharedFileCount === 1 ? "" : "s"} available`
                : "No files shared with this enquiry"}
            </strong>
          </div>
          {photos.length > 0 && (
            <button
              type="button"
              disabled={photoBusy}
              onClick={onTogglePhotos}
            >
              {photoBusy
                ? "Opening shared photos..."
                : photosVisible
                  ? "Hide shared photos"
                  : `Show all shared photos (${photos.length})`}
            </button>
          )}
        </div>

        {!sharedFileCount ? (
          <p>
            No photos or documents are shared with this enquiry.
          </p>
        ) : (
          <p>
            Files are available only to verified installers allocated to this
            enquiry. Every protected file access is authorised and recorded.
          </p>
        )}

        {photosVisible && photos.length > 0 && (
          <div className="dashboard-enquiry-thumbnails">
            {photos.map((item) => (
              <article key={item.id}>
                <ProtectedPhotoThumbnail
                  url={photoUrls[item.id] || ""}
                  alt={`Customer-shared ${item.category.replaceAll("-", " ")} photo`}
                  onOpen={() => onViewPhoto(
                    item,
                    photoUrls[item.id],
                    `Customer-shared ${item.category.replaceAll("-", " ")} photo`,
                  )}
                />
                <div>
                  <span>Customer-shared quoting photo</span>
                  <strong>{item.category.replaceAll("-", " ")}</strong>
                  <small>{Math.max(1, Math.round(item.sizeBytes / 1024))} KB</small>
                </div>
                <button
                  type="button"
                  disabled={downloadBusy === item.id}
                  onClick={() => onDownload(item)}
                >
                  Protected download
                </button>
              </article>
            ))}
          </div>
        )}

        {documents.length > 0 && (
          <div className="dashboard-enquiry-documents">
            {documents.map((item) => (
              <article key={item.id}>
                <div>
                  <span>Customer-shared project document</span>
                  <strong>{item.category.replaceAll("-", " ")}</strong>
                  <small>{Math.max(1, Math.round(item.sizeBytes / 1024))} KB</small>
                </div>
                <button
                  type="button"
                  disabled={downloadBusy === item.id}
                  onClick={() => onDownload(item)}
                >
                  Protected PDF download
                </button>
              </article>
            ))}
          </div>
        )}

        {photoError && (
          <p className="dashboard-enquiry-evidence-error" role="alert">
            {photoError}
          </p>
        )}
      </div>

      <small className="dashboard-enquiry-privacy">
        {opportunity.customerContact
          ? "The customer-selected contact and service address above are released to this business. Private notes, room details and evidence filenames remain withheld."
          : "Suburb, postcode and state are shown for service-area planning. Customer identity, contact details, street and unit address, private notes, room details and evidence filenames remain withheld."}
      </small>
    </section>
  );
}

function PublicQuotePreparation({
  opportunity,
  photoUrls,
  photosVisible,
  photoBusy,
  photoError,
  downloadBusy,
  onTogglePhotos,
  onViewPhoto,
  onDownload,
}: {
  opportunity: DashboardOpportunity;
  photoUrls: Record<string, string>;
  photosVisible: boolean;
  photoBusy: boolean;
  photoError: string;
  downloadBusy: string;
  onTogglePhotos: () => void;
  onViewPhoto: (
    item: DashboardOpportunity["evidence"][number],
    url: string,
    alt: string,
  ) => void;
  onDownload: (item: DashboardOpportunity["evidence"][number]) => void;
}) {
  const preparation = opportunity.quotePreparation;
  if (!preparation) return null;
  const photos = opportunity.evidence.filter((item) =>
    item.category === "quote-photo" && item.contentType.startsWith("image/")
  );
  return (
    <section className="dashboard-enquiry-pack dashboard-public-quote-preparation" aria-label="Desktop quote preparation">
      <div className="dashboard-enquiry-pack-heading">
        <div>
          <span>Customer-prepared quote details</span>
          <h4>Review before preparing a desktop quote</h4>
          <p>
            These optional answers and photos were supplied once with the
            enquiry to reduce follow-up questions. Confirm site conditions
            before treating them as final scope evidence.
          </p>
        </div>
        <strong>
          {preparation.answers.length} answer{preparation.answers.length === 1 ? "" : "s"}
          {" | "}{photos.length} photo{photos.length === 1 ? "" : "s"}
        </strong>
      </div>

      {preparation.answers.length > 0 ? (
        <dl className="dashboard-public-quote-answers">
          {preparation.answers.map((item) => (
            <div key={item.questionId}>
              <dt>{item.label}</dt>
              <dd>{item.answer}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>No optional quote questions were answered.</p>
      )}

      <div className="dashboard-enquiry-evidence">
        <div className="dashboard-enquiry-evidence-heading">
          <div>
            <span>Private quote photos</span>
            <strong>
              {photos.length
                ? `${photos.length} protected photo${photos.length === 1 ? "" : "s"} available`
                : preparation.expectedPhotoCount
                  ? "Selected photos have not finished uploading"
                  : "No quote photos were selected"}
            </strong>
          </div>
          {photos.length > 0 && (
            <button type="button" disabled={photoBusy} onClick={onTogglePhotos}>
              {photoBusy
                ? "Opening quote photos..."
                : photosVisible
                  ? "Hide quote photos"
                  : `Show quote photos (${photos.length})`}
            </button>
          )}
        </div>
        <p>
          Photos are stored privately and are available only to active,
          approved TLink trades matched to this exact enquiry. Every download
          is authorised and recorded.
        </p>
        {photosVisible && photos.length > 0 && (
          <div className="dashboard-enquiry-thumbnails">
            {photos.map((item) => (
              <article key={item.id}>
                <ProtectedPhotoThumbnail
                  url={photoUrls[item.id] || ""}
                  alt={item.promptLabel || "Customer-shared quote photo"}
                  onOpen={() => onViewPhoto(
                    item,
                    photoUrls[item.id],
                    item.promptLabel || "Customer-shared quote photo",
                  )}
                />
                <div>
                  <span>Customer-shared quoting photo</span>
                  <strong>{item.promptLabel || "Quote preparation photo"}</strong>
                  <small>{Math.max(1, Math.round(item.sizeBytes / 1024))} KB</small>
                </div>
                <button
                  type="button"
                  disabled={downloadBusy === item.id}
                  onClick={() => onDownload(item)}
                >
                  Protected download
                </button>
              </article>
            ))}
          </div>
        )}
        {photoError && <p className="dashboard-enquiry-evidence-error" role="alert">{photoError}</p>}
      </div>
    </section>
  );
}

const verifiedTradeFeatures = [
  "Leads and privacy-safe marketplace opportunities",
  "CRM, quotes, scheduling and customer handover",
  "Team, field work, forms and purchasing",
  "Catalogue, product selection and guided imports",
];

function TradeAccessPanel({ profile }: { profile: DashboardProfile }) {
  return (
    <section className="dashboard-access-overview" aria-labelledby="trade-access-title">
      <div className="dashboard-access-summary">
        <div>
          <span>Current access</span>
          <h2 id="trade-access-title">{profile.entitlements.accessLabel}</h2>
          <p>
            Core trade operations cost A$0. Verification, licensing, insurance
            and role permissions remain mandatory safety controls.
          </p>
        </div>
        <a href="/direct-trade/dashboard/verification">Open verification centre</a>
      </div>
      <div className="dashboard-access-stage-grid">
        <article>
          <span>Before approval</span>
          <h3>Set up and verify</h3>
          <ul><li>Complete the business profile</li><li>Set service areas and capabilities</li><li>Provide the required verification evidence</li></ul>
          <strong>No payment details are required.</strong>
        </article>
        <article>
          <span>After approval</span>
          <h3>Verified trade workspace</h3>
          <ul>{verifiedTradeFeatures.map((item) => <li key={item}>{item}</li>)}</ul>
          <strong>Unlimited users, leads, jobs and quotes remain A$0.</strong>
        </article>
      </div>
    </section>
  );
}

export function DirectTradeDashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<DashboardProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [opportunities, setOpportunities] = useState<DashboardOpportunity[]>(
    [],
  );
  const [opportunityBusy, setOpportunityBusy] = useState("");
  const [opportunityStatus, setOpportunityStatus] = useState("");
  const [opportunityLoadError, setOpportunityLoadError] = useState("");
  const [publicLeadHandoff, setPublicLeadHandoff] =
    useState<PublicLeadHandoffState | null>(null);
  const [opportunityNavigationStatus, setOpportunityNavigationStatus] =
    useState("");
  const [leadSearch, setLeadSearch] = useState("");
  const [leadStatusFilter, setLeadStatusFilter] = useState("");
  const [leadServiceFilter, setLeadServiceFilter] = useState("");
  const [leadStateFilter, setLeadStateFilter] = useState("");
  const [focusedOpportunityMatchId, setFocusedOpportunityMatchId] = useState("");
  const [selectedOpportunityMatchId, setSelectedOpportunityMatchId] = useState(() =>
    typeof window === "undefined" ? "" : opportunityMatchFromSearch(window.location.search));
  const [opportunityRouteRequestNonce, setOpportunityRouteRequestNonce] = useState(0);
  const [workspace, setWorkspace] = useState<DashboardWorkspace>(() =>
    typeof window === "undefined"
      ? "work"
      : dashboardWorkspaceFromSearch(window.location.search)
  );
  const [activeWorkView, setActiveWorkView] = useState(() =>
    typeof window === "undefined" ? "today" : dashboardWorkViewFromSearch(window.location.search)
  );
  const [commandTarget, setCommandTarget] = useState<TLinkCommandTarget | null>(() =>
    typeof window === "undefined" ? null : dashboardCommandTargetFromSearch(window.location.search)
  );
  const [visibleEvidenceMatches, setVisibleEvidenceMatches] = useState<Record<string, boolean>>({});
  const [evidencePhotoUrls, setEvidencePhotoUrls] = useState<Record<string, Record<string, string>>>({});
  const [evidencePhotoBusy, setEvidencePhotoBusy] = useState("");
  const [evidencePhotoErrors, setEvidencePhotoErrors] = useState<Record<string, string>>({});
  const [installerPlanBusy, setInstallerPlanBusy] = useState("");
  const [installerPlanErrors, setInstallerPlanErrors] = useState<Record<string, string>>({});
  const [installerPlanPreview, setInstallerPlanPreview] = useState<CustomerPlanReportView | null>(null);
  const [photoLightbox, setPhotoLightbox] = useState<ProtectedPhotoLightbox | null>(null);
  const [colourMode, setColourMode] = useState<TLinkColourMode>("day");
  const evidenceObjectUrls = useRef(new Set<string>());
  const photoLightboxDialog = useRef<HTMLDivElement | null>(null);
  const photoLightboxCloseButton = useRef<HTMLButtonElement | null>(null);
  const publicLeadHandoffDialog = useRef<HTMLDivElement | null>(null);
  const publicLeadHandoffRetryButton = useRef<HTMLButtonElement | null>(null);
  const publicLeadHandoffOpener = useRef<HTMLElement | null>(null);
  const publicLeadHandoffRequestMatchId = useRef("");
  const workspaceRouteInitialised = useRef(false);
  const workspacePopstateSync = useRef(false);
  const pendingOpportunityMatchId = useRef(
    typeof window === "undefined"
      ? ""
      : opportunityMatchFromSearch(window.location.search),
  );
  const exactOpportunityMatchId = useRef(
    typeof window === "undefined"
      ? ""
      : opportunityMatchFromSearch(window.location.search),
  );

  useEffect(() => {
    const applyColourMode = (nextMode: TLinkColourMode) => {
      setColourMode(nextMode);
      document.documentElement.dataset.tlinkColourMode = nextMode;
    };
    const syncStoredColourMode = () => {
      try {
        applyColourMode(readTLinkColourMode(window.localStorage));
      } catch {
        applyColourMode("day");
      }
    };
    const syncColourModeAcrossTabs = (event: StorageEvent) => {
      if (event.key === TLINK_COLOUR_MODE_STORAGE_KEY || event.key === null) {
        syncStoredColourMode();
      }
    };

    syncStoredColourMode();
    window.addEventListener("storage", syncColourModeAcrossTabs);
    return () => {
      window.removeEventListener("storage", syncColourModeAcrossTabs);
      delete document.documentElement.dataset.tlinkColourMode;
    };
  }, []);

  const toggleColourMode = () => {
    const nextMode = colourMode === "night" ? "day" : "night";
    setColourMode(nextMode);
    document.documentElement.dataset.tlinkColourMode = nextMode;
    try {
      writeTLinkColourMode(window.localStorage, nextMode);
    } catch {
      // The visual preference still works for this tab when storage is unavailable.
    }
  };

  useEffect(() => {
    const onPopstate = () => {
      workspacePopstateSync.current = true;
      const nextWorkspace = dashboardWorkspaceFromSearch(window.location.search);
      const nextWorkView = dashboardWorkViewFromSearch(window.location.search);
      const nextMatchId = nextWorkspace === "work" && nextWorkView === "leads"
        ? opportunityMatchFromSearch(window.location.search)
        : "";
      setWorkspace(nextWorkspace);
      setActiveWorkView(nextWorkView);
      setSelectedOpportunityMatchId(nextMatchId);
      setFocusedOpportunityMatchId(nextMatchId);
      pendingOpportunityMatchId.current = nextMatchId;
      exactOpportunityMatchId.current = nextMatchId;
      if (nextMatchId) setOpportunityRouteRequestNonce((value) => value + 1);
      const nextTarget = dashboardCommandTargetFromSearch(window.location.search);
      setCommandTarget((current) => nextTarget || (current?.kind === "job" && nextWorkspace === "work"
        ? { workspace: "work", kind: "crm-view", id: "jobs", query: "", nonce: Date.now() }
        : null));
    };
    window.addEventListener("popstate", onPopstate);
    return () => window.removeEventListener("popstate", onPopstate);
  }, []);

  useEffect(() => {
    const initialJobTarget = dashboardCommandTargetFromSearch(window.location.search);
    if (!commandTarget && workspace === "work" && initialJobTarget?.kind === "job") {
      setCommandTarget(initialJobTarget);
      return;
    }
    const nextUrl = new URL(window.location.href);
    const routeWorkspace = workspace === "work" && (activeWorkView === "schedule" || activeWorkView === "leads")
      ? activeWorkView
      : workspace;
    let changed = nextUrl.searchParams.get("workspace") !== routeWorkspace;
    nextUrl.searchParams.set("workspace", routeWorkspace);
    if (workspace === "work" && activeWorkView === "leads") {
      if (selectedOpportunityMatchId && nextUrl.searchParams.get("matchId") !== selectedOpportunityMatchId) {
        nextUrl.searchParams.set("matchId", selectedOpportunityMatchId);
        changed = true;
      } else if (!selectedOpportunityMatchId && nextUrl.searchParams.has("matchId")) {
        nextUrl.searchParams.delete("matchId");
        changed = true;
      }
    } else {
      if (nextUrl.searchParams.has("matchId")) { nextUrl.searchParams.delete("matchId"); changed = true; }
      if (nextUrl.hash === "#opportunity-inbox") { nextUrl.hash = ""; changed = true; }
    }
    const openJobId = workspace === "work" && commandTarget?.kind === "job" ? commandTarget.id : "";
    if (openJobId && nextUrl.searchParams.get("jobId") !== openJobId) {
      nextUrl.searchParams.set("jobId", openJobId);
      changed = true;
    } else if (!openJobId && nextUrl.searchParams.has("jobId")) {
      nextUrl.searchParams.delete("jobId");
      changed = true;
    }
    const nextLocation = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    if (changed) {
      if (!workspaceRouteInitialised.current || workspacePopstateSync.current) window.history.replaceState(window.history.state, "", nextLocation);
      else window.history.pushState(window.history.state, "", nextLocation);
    }
    workspaceRouteInitialised.current = true;
    workspacePopstateSync.current = false;
  }, [activeWorkView, commandTarget, selectedOpportunityMatchId, workspace]);
  const photoLightboxOpener = useRef<HTMLElement | null>(null);
  const protectedOpportunityRequestControllers = useRef(
    new Set<AbortController>(),
  );
  const protectedIdentityUid = useRef<string | null>(null);
  const protectedIdentityRevision = useRef(0);

  const revokeEvidenceObjectUrl = useCallback((url: string) => {
    if (!evidenceObjectUrls.current.delete(url)) return;
    URL.revokeObjectURL(url);
  }, []);

  const revokeAllEvidenceObjectUrls = useCallback(() => {
    for (const url of evidenceObjectUrls.current) URL.revokeObjectURL(url);
    evidenceObjectUrls.current.clear();
  }, []);

  const photoLightboxOpen = Boolean(photoLightbox);

  useEffect(() => {
    if (!photoLightboxOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      photoLightboxCloseButton.current?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPhotoLightbox(null);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = photoLightboxDialog.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      const opener = photoLightboxOpener.current;
      photoLightboxOpener.current = null;
      if (opener?.isConnected) opener.focus();
    };
  }, [photoLightboxOpen]);

  const publicLeadHandoffOpen = Boolean(publicLeadHandoff);
  const publicLeadHandoffPhase = publicLeadHandoff?.phase || "";
  const publicLeadHandoffMatchId = publicLeadHandoff?.matchId || "";

  useEffect(() => {
    if (!publicLeadHandoffOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = publicLeadHandoffDialog.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      const opener = publicLeadHandoffOpener.current;
      publicLeadHandoffOpener.current = null;
      if (opener?.isConnected) opener.focus();
    };
  }, [publicLeadHandoffOpen]);

  useEffect(() => {
    if (!publicLeadHandoffOpen) return;
    const frame = window.requestAnimationFrame(() => {
      if (publicLeadHandoffPhase === "error") {
        publicLeadHandoffRetryButton.current?.focus();
      } else {
        publicLeadHandoffDialog.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [publicLeadHandoffMatchId, publicLeadHandoffOpen, publicLeadHandoffPhase]);

  useEffect(() => {
    if (
      publicLeadHandoffPhase !== "working"
      || !publicLeadHandoffMatchId
    ) return;
    const stageTimers = [
      window.setTimeout(() => setPublicLeadHandoff((current) =>
        current?.phase === "working" && current.matchId === publicLeadHandoffMatchId
          ? { ...current, stageIndex: 1 }
          : current
      ), 1_600),
      window.setTimeout(() => setPublicLeadHandoff((current) =>
        current?.phase === "working" && current.matchId === publicLeadHandoffMatchId
          ? { ...current, stageIndex: 2 }
          : current
      ), 4_000),
      window.setTimeout(() => setPublicLeadHandoff((current) =>
        current?.phase === "working" && current.matchId === publicLeadHandoffMatchId
          ? { ...current, stageIndex: 3 }
          : current
      ), 7_000),
    ];
    return () => stageTimers.forEach((timer) => window.clearTimeout(timer));
  }, [publicLeadHandoffMatchId, publicLeadHandoffPhase]);

  const abortProtectedOpportunityRequests = useCallback(() => {
    for (const controller of protectedOpportunityRequestControllers.current) {
      controller.abort();
    }
    protectedOpportunityRequestControllers.current.clear();
  }, []);

  const scrubProtectedOpportunityNavigation = useCallback(() => {
    pendingOpportunityMatchId.current = "";
    exactOpportunityMatchId.current = "";
    const nextUrl = new URL(window.location.href);
    let changed = false;
    if (nextUrl.searchParams.has("matchId")) {
      nextUrl.searchParams.delete("matchId");
      changed = true;
    }
    if (nextUrl.searchParams.get("workspace") === "leads") {
      nextUrl.searchParams.set("workspace", "work");
      changed = true;
    }
    if (nextUrl.hash === "#opportunity-inbox") {
      nextUrl.hash = "";
      changed = true;
    }
    if (!changed) return;
    window.history.replaceState(
      window.history.state,
      "",
      `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
    );
  }, []);

  const clearProtectedInstallerState = useCallback(() => {
    abortProtectedOpportunityRequests();
    revokeAllEvidenceObjectUrls();
    setProfile(null);
    setError("");
    setOpportunities([]);
    setOpportunityBusy("");
    setOpportunityStatus("");
    setOpportunityLoadError("");
    setPublicLeadHandoff(null);
    publicLeadHandoffRequestMatchId.current = "";
    setOpportunityNavigationStatus("");
    setLeadSearch("");
    setLeadStatusFilter("");
    setLeadServiceFilter("");
    setLeadStateFilter("");
    setWorkspace("work");
    setActiveWorkView("today");
    setCommandTarget(null);
    setInstallerPlanPreview(null);
    setInstallerPlanBusy("");
    setInstallerPlanErrors({});
    setVisibleEvidenceMatches({});
    setEvidencePhotoUrls({});
    setEvidencePhotoBusy("");
    setEvidencePhotoErrors({});
    setPhotoLightbox(null);
    setSelectedOpportunityMatchId("");
    setFocusedOpportunityMatchId("");
  }, [abortProtectedOpportunityRequests, revokeAllEvidenceObjectUrls]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const returned = readIntegrationReturn(window.location.search);
      if (!returned) return;
      if (isCalendarIntegration(returned.provider)) {
        setWorkspace("work");
        setCommandTarget({ workspace: "work", kind: "crm-view", id: "schedule", query: "", nonce: Date.now() });
        return;
      }
      setWorkspace("work");
      setCommandTarget({ workspace: "work", kind: "crm-view", id: "integrations", query: "", nonce: Date.now() });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => () => {
    abortProtectedOpportunityRequests();
    revokeAllEvidenceObjectUrls();
  }, [abortProtectedOpportunityRequests, revokeAllEvidenceObjectUrls]);

  useEffect(
    () =>
      onAuthStateChanged(firebaseAuth, (nextUser) => {
        const nextUid = nextUser?.uid || null;
        const previousUid = protectedIdentityUid.current;
        if (resetTradeDashboardStateOnUidChange(
          previousUid,
          nextUid,
          clearProtectedInstallerState,
        )) {
          if (shouldClearOpportunityDeepLink(
            previousUid || "",
            nextUid || "",
          )) {
            scrubProtectedOpportunityNavigation();
          }
          protectedIdentityUid.current = nextUid;
          protectedIdentityRevision.current += 1;
          setLoading(Boolean(nextUser));
        }
        setUser(nextUser);
        setAuthReady(true);
        if (!nextUser) {
          setLoading(false);
          setOpportunities([]);
        }
      }),
    [clearProtectedInstallerState, scrubProtectedOpportunityNavigation],
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const identityRevision = protectedIdentityRevision.current;
    const identityIsCurrent = () => (
      protectedIdentityRevision.current === identityRevision
      && protectedIdentityUid.current === user.uid
    );
    async function loadDashboard() {
      setLoading(true);
      setError("");
      try {
        const token = await user!.getIdToken();
        const response = await fetch("/api/trade-profile", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(result.error || "The dashboard could not be loaded.");
        if (!cancelled && identityIsCurrent()) {
          const nextProfile = result.profile as DashboardProfile | null;
          setProfile(nextProfile);
          if (nextProfile) {
            if (nextProfile.partnerType === "supplier" || !nextProfile.entitlements?.features?.installer_leads) setOpportunities([]);
          }
        }
      } catch (loadError) {
        if (!cancelled && identityIsCurrent())
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The dashboard could not be loaded.",
          );
      } finally {
        if (!cancelled && identityIsCurrent()) setLoading(false);
      }
    }
    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (profile?.partnerType === "supplier" && workspace === "calculator") {
      setWorkspace("work");
    }
  }, [profile?.partnerType, workspace]);

  useEffect(() => {
    if (!user || !profile || profile.partnerType === "supplier" || !profile.entitlements?.features?.installer_leads) return;
    const controller = new AbortController();
    let active = true;
    setOpportunityLoadError("");
    const identityRevision = protectedIdentityRevision.current;
    const identityIsCurrent = () => (
      protectedIdentityRevision.current === identityRevision
      && protectedIdentityUid.current === user.uid
    );
    void user.getIdToken().then((token) => fetch("/api/trade-opportunities", {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
    })).then(async (response) => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Leads could not be loaded.");
      if (active && identityIsCurrent()) {
        const loadedOpportunities = result.opportunities || [];
        setOpportunities((current) => {
          const requestedMatchId = exactOpportunityMatchId.current;
          const exactOpportunity = requestedMatchId
            ? current.find((item) => item.matchId === requestedMatchId)
            : null;
          return exactOpportunity && !loadedOpportunities.some((item: DashboardOpportunity) => item.matchId === requestedMatchId)
            ? [exactOpportunity, ...loadedOpportunities]
            : loadedOpportunities;
        });
        setOpportunityLoadError("");
      }
    }).catch((loadError) => {
      if (active && identityIsCurrent() && !controller.signal.aborted) {
        setOpportunityLoadError(loadError instanceof Error ? loadError.message : "Leads could not be loaded.");
      }
    });
    return () => { active = false; controller.abort(); };
  }, [profile, user]);

  const isSupplier = profile?.partnerType === "supplier";
  const hasLeadAccess = Boolean(profile?.entitlements?.features?.installer_leads);
  const hasMarketplaceAccess = Boolean(profile?.entitlements?.features?.installer_marketplace);
  const hasSupplierVisibility = Boolean(profile?.entitlements?.features?.supplier_visibility);
  const hasBulkImport = Boolean(profile?.entitlements?.features?.supplier_bulk_import);
  const hasBusinessOperations = Boolean(profile?.entitlements?.features?.business_operations);
  const hasTeamAccess = Boolean(profile?.entitlements?.features?.team_access);
  const profileComplete = Boolean(
    profile?.businessName &&
    profile.addressLine1 &&
    profile.suburb &&
    profile.addressState &&
    /^\d{4}$/.test(profile.postcode),
  );
  const offeredCount = opportunities.filter((item) =>
    ["offered", "viewed"].includes(item.matchStatus),
  ).length;
  const visibleLeadOpportunities = useMemo(() => {
    const term = leadSearch.trim().toLowerCase();
    return opportunities
      .filter((item) => !leadStatusFilter || item.matchStatus === leadStatusFilter)
      .filter((item) => !leadStateFilter || item.state === leadStateFilter)
      .filter((item) => !leadServiceFilter || (item.matchedCategories.length ? item.matchedCategories : item.serviceCategories).includes(leadServiceFilter))
      .filter((item) => !term || `${item.title} ${item.summary} ${item.projectType} ${item.suburb} ${item.postcode} ${item.state} ${item.distanceBand}`.toLowerCase().includes(term));
  }, [leadSearch, leadServiceFilter, leadStateFilter, leadStatusFilter, opportunities]);
  const selectedLeadOpportunity = visibleLeadOpportunities.find((item) => item.matchId === selectedOpportunityMatchId)
    || visibleLeadOpportunities[0]
    || null;

  useEffect(() => {
    if (workspace !== "work" || activeWorkView !== "leads") return;
    const exactMatchIsLoading = Boolean(
      selectedOpportunityMatchId
      && exactOpportunityMatchId.current === selectedOpportunityMatchId
      && !opportunities.some((item) => item.matchId === selectedOpportunityMatchId),
    );
    if (exactMatchIsLoading) return;
    const visibleMatchId = selectedLeadOpportunity?.matchId || "";
    if (visibleMatchId !== selectedOpportunityMatchId) setSelectedOpportunityMatchId(visibleMatchId);
  }, [activeWorkView, opportunities, selectedLeadOpportunity, selectedOpportunityMatchId, workspace]);

  const openOpportunityNotification = useCallback(async (matchId: string) => {
    const activeUser = user;
    if (!activeUser || protectedIdentityUid.current !== activeUser.uid) return;
    const identityUid = activeUser.uid;
    const identityRevision = protectedIdentityRevision.current;
    const identityIsCurrent = () => protectedIdentityContinuationIsCurrent(
      identityUid,
      identityRevision,
      protectedIdentityUid.current || "",
      protectedIdentityRevision.current,
    );
    const controller = new AbortController();
    protectedOpportunityRequestControllers.current.add(controller);
    const requestIsCurrent = () =>
      identityIsCurrent() && !controller.signal.aborted;
    setLeadSearch("");
    setLeadStatusFilter("");
    setLeadServiceFilter("");
    setLeadStateFilter("");
    setFocusedOpportunityMatchId(matchId);
    setSelectedOpportunityMatchId(matchId);
    exactOpportunityMatchId.current = matchId;
    setActiveWorkView("leads");
    setCommandTarget({ workspace: "work", kind: "crm-view", id: "leads", query: "", nonce: Date.now() });
    setWorkspace("work");
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("workspace", "leads");
    nextUrl.searchParams.set("matchId", matchId);
    nextUrl.hash = "opportunity-inbox";
    window.history.replaceState(
      window.history.state,
      "",
      `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
    );
    setOpportunityNavigationStatus("Opening lead...");
    try {
      const token = await activeUser.getIdToken();
      if (!requestIsCurrent()) return;
      const response = await fetch(
        `/api/trade-opportunities?matchId=${encodeURIComponent(matchId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (!requestIsCurrent()) return;
      const result = await response.json().catch(() => ({}));
      if (!requestIsCurrent()) return;
      if (!response.ok) {
        throw new Error(result.error || "The lead could not be refreshed.");
      }
      const selectedLead = result.opportunities?.[0];
      if (!selectedLead || selectedLead.matchId !== matchId) {
        throw new Error("The lead is no longer available.");
      }
      setOpportunities((current) => [
        selectedLead,
        ...current.filter((item) => item.matchId !== matchId),
      ]);
      setOpportunityNavigationStatus("");
    } catch (openError) {
      if (!requestIsCurrent()) return;
      if (exactOpportunityMatchId.current === matchId) exactOpportunityMatchId.current = "";
      setFocusedOpportunityMatchId((current) => current === matchId ? "" : current);
      setSelectedOpportunityMatchId((current) => current === matchId ? "" : current);
      setOpportunityNavigationStatus(
        openError instanceof Error
          ? openError.message
          : "The lead could not be refreshed.",
      );
    } finally {
      protectedOpportunityRequestControllers.current.delete(controller);
    }
  }, [user]);

  useEffect(() => {
    if (!user || !pendingOpportunityMatchId.current) return;
    const matchId = pendingOpportunityMatchId.current;
    pendingOpportunityMatchId.current = "";
    void openOpportunityNotification(matchId);
  }, [openOpportunityNotification, opportunityRouteRequestNonce, user]);

  useEffect(() => {
    if (workspace !== "work" || activeWorkView !== "leads" || !focusedOpportunityMatchId) return;
    if (!opportunities.some((item) => item.matchId === focusedOpportunityMatchId)) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(
        `opportunity-${focusedOpportunityMatchId}`,
      );
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      target?.focus({ preventScroll: true });
    });
    const timeout = window.setTimeout(
      () => setFocusedOpportunityMatchId(""),
      5_000,
    );
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [
    activeWorkView,
    focusedOpportunityMatchId,
    opportunities,
    workspace,
  ]);

  async function respondToOpportunity(
    matchId: string,
    status: "viewed" | "interested" | "declined",
  ) {
    const activeUser = user;
    if (!activeUser || protectedIdentityUid.current !== activeUser.uid) return;
    if (publicLeadHandoffRequestMatchId.current === matchId) return;
    const identityUid = activeUser.uid;
    const identityRevision = protectedIdentityRevision.current;
    const identityIsCurrent = () => protectedIdentityContinuationIsCurrent(
      identityUid,
      identityRevision,
      protectedIdentityUid.current || "",
      protectedIdentityRevision.current,
    );
    const controller = new AbortController();
    protectedOpportunityRequestControllers.current.add(controller);
    const requestIsCurrent = () =>
      identityIsCurrent() && !controller.signal.aborted;
    const selectedOpportunity = opportunities.find(
      (opportunity) => opportunity.matchId === matchId,
    );
    const preparesCustomerQuote =
      status === "interested" && !selectedOpportunity?.platformOnly;
    const startsCustomerQuoteHandoff = Boolean(
      preparesCustomerQuote
      && selectedOpportunity
      && selectedOpportunity.matchStatus !== "interested"
    );
    if (startsCustomerQuoteHandoff && selectedOpportunity) {
      publicLeadHandoffRequestMatchId.current = matchId;
      if (!publicLeadHandoffOpen) {
        publicLeadHandoffOpener.current = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      }
      setPublicLeadHandoff({
        matchId,
        customerName: selectedOpportunity.customerContact?.name.trim()
          || selectedOpportunity.title
          || "this customer",
        phase: "working",
        stageIndex: 0,
        error: "",
        requestReference: "",
        workNumber: "",
      });
    }
    setOpportunityBusy(matchId);
    setOpportunityStatus(
      preparesCustomerQuote
        ? "Creating your job and quote..."
        : status === "interested"
        ? "Sending your expression of interest..."
        : "Updating the opportunity...",
    );
    let requestReference = "";
    try {
      const token = await activeUser.getIdToken();
      if (!requestIsCurrent()) return;
      const response = await fetch("/api/trade-opportunities", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ matchId, status }),
        signal: controller.signal,
      });
      if (!requestIsCurrent()) return;
      const result = await response.json().catch(() => ({}));
      if (!requestIsCurrent()) return;
      requestReference = [result.requestId, result.errorCode]
        .filter((item) => typeof item === "string" && item.trim())
        .join(" | ");
      if (!response.ok || !result.ok)
        throw new Error(
          result.error || "The opportunity response could not be saved.",
        );
      const quoteWorkflow = result.quoteWorkflow && typeof result.quoteWorkflow === "object"
        ? result.quoteWorkflow as { workOrderId?: unknown; workNumber?: unknown; quoteId?: unknown }
        : null;
      const quoteTarget = publicLeadQuoteNavigationTarget(quoteWorkflow);
      if (startsCustomerQuoteHandoff && !quoteTarget) {
        throw new Error(
          "The handoff was saved, but the editable quote was not returned. Retry to reopen the same job safely.",
        );
      }
      setOpportunities((current) => status === "declined"
        ? current.filter((item) => item.matchId !== matchId)
        : current.map((item) =>
            item.matchId === matchId
              ? {
                  ...item,
                  matchStatus: status,
                  updatedAt: new Date().toISOString(),
                }
              : item,
          ));
      if (status === "declined") {
        setSelectedOpportunityMatchId((current) => current === matchId ? "" : current);
        setFocusedOpportunityMatchId((current) => current === matchId ? "" : current);
      }
      if (status === "interested" && quoteTarget) {
        const workNumber = typeof quoteWorkflow?.workNumber === "string"
          ? quoteWorkflow.workNumber
          : "The customer quote";
        if (startsCustomerQuoteHandoff) {
          setPublicLeadHandoff((current) =>
            current?.matchId === matchId
              ? {
                  ...current,
                  phase: "success",
                  stageIndex: publicLeadHandoffStages.length - 1,
                  error: "",
                  requestReference,
                  workNumber,
                }
              : current
          );
          await new Promise((resolve) => window.setTimeout(resolve, 250));
          if (!requestIsCurrent()) return;
        }
        setCommandTarget({
          ...quoteTarget,
          nonce: Date.now(),
        });
        setWorkspace("work");
        setOpportunityStatus(
          `${workNumber} is ready to edit.`,
        );
        if (startsCustomerQuoteHandoff) setPublicLeadHandoff(null);
        return;
      }
      setOpportunityStatus(
        status === "interested"
          ? typeof result.warning === "string" && result.warning
            ? result.warning
            : "Interest recorded. You can now prepare a structured platform response when the project supports it."
          : status === "declined"
            ? "Lead removed from this business. Other matched trades are unaffected."
            : "Opportunity marked as reviewed.",
      );
    } catch (responseError) {
      if (!requestIsCurrent()) return;
      const responseMessage = responseError instanceof Error
        ? responseError.message
        : "The opportunity response could not be saved.";
      if (startsCustomerQuoteHandoff) {
        setPublicLeadHandoff((current) =>
          current?.matchId === matchId
            ? {
                ...current,
                phase: "error",
                error: responseMessage,
                requestReference,
              }
            : current
        );
      }
      setOpportunityStatus(
        responseMessage,
      );
    } finally {
      protectedOpportunityRequestControllers.current.delete(controller);
      if (publicLeadHandoffRequestMatchId.current === matchId) {
        publicLeadHandoffRequestMatchId.current = "";
      }
      if (requestIsCurrent()) setOpportunityBusy("");
    }
  }

  async function openPublicLeadQuote(opportunity: DashboardOpportunity) {
    const activeUser = user;
    if (!activeUser || opportunity.platformOnly || protectedIdentityUid.current !== activeUser.uid) return;
    const identityUid = activeUser.uid;
    const identityRevision = protectedIdentityRevision.current;
    const controller = new AbortController();
    protectedOpportunityRequestControllers.current.add(controller);
    const requestIsCurrent = () => protectedIdentityContinuationIsCurrent(
      identityUid,
      identityRevision,
      protectedIdentityUid.current || "",
      protectedIdentityRevision.current,
    ) && !controller.signal.aborted;
    setOpportunityBusy(opportunity.matchId);
    setOpportunityStatus("Reopening the editable quote...");
    try {
      const token = await activeUser.getIdToken();
      if (!requestIsCurrent()) return;
      const response = await fetch("/api/trade-opportunities", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "open_public_quote", matchId: opportunity.matchId }),
        signal: controller.signal,
      });
      if (!requestIsCurrent()) return;
      const result = await response.json().catch(() => ({}));
      if (!requestIsCurrent()) return;
      const quoteTarget = publicLeadQuoteNavigationTarget(result.quoteWorkflow);
      if (!response.ok || !result.ok || !quoteTarget) {
        throw new Error(result.error || "The editable quote could not be reopened.");
      }
      setCommandTarget({ ...quoteTarget, nonce: Date.now() });
      setWorkspace("work");
      setOpportunityStatus("The editable quote is open.");
    } catch (openError) {
      if (requestIsCurrent()) {
        setOpportunityStatus(openError instanceof Error
          ? openError.message
          : "The editable quote could not be reopened.");
      }
    } finally {
      protectedOpportunityRequestControllers.current.delete(controller);
      if (requestIsCurrent()) setOpportunityBusy("");
    }
  }

  function dismissOpportunity(opportunity: DashboardOpportunity) {
    if (!(["offered", "viewed"].includes(opportunity.matchStatus)
      || (opportunity.platformOnly && opportunity.matchStatus === "interested"))) return;
    const confirmed = window.confirm(
      opportunity.platformOnly && opportunity.matchStatus === "interested"
        ? "Remove this lead from your business and withdraw its unaccepted quote? This does not remove it for other matched trades."
        : "Remove this lead from your business? This does not remove it for other matched trades.",
    );
    if (confirmed) void respondToOpportunity(opportunity.matchId, "declined");
  }

  async function convertOpportunity(matchId: string) {
    const activeUser = user;
    if (!activeUser || protectedIdentityUid.current !== activeUser.uid) return;
    const identityUid = activeUser.uid;
    const identityRevision = protectedIdentityRevision.current;
    const identityIsCurrent = () => protectedIdentityContinuationIsCurrent(
      identityUid,
      identityRevision,
      protectedIdentityUid.current || "",
      protectedIdentityRevision.current,
    );
    const controller = new AbortController();
    protectedOpportunityRequestControllers.current.add(controller);
    const requestIsCurrent = () =>
      identityIsCurrent() && !controller.signal.aborted;
    setOpportunityBusy(matchId);
    setOpportunityStatus("Creating the CRM job...");
    try {
      const token = await activeUser.getIdToken();
      if (!requestIsCurrent()) return;
      const workResponse = await fetch("/api/trade-work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: "create_work_order",
          sourceType: "opportunity",
          sourceReference: matchId,
        }),
        signal: controller.signal,
      });
      if (!requestIsCurrent()) return;
      const workResult = await workResponse.json().catch(() => ({}));
      if (!requestIsCurrent()) return;
      if (!workResponse.ok || !workResult.ok) {
        throw new Error(workResult.error || "The marketplace opportunity could not be converted.");
      }
      setWorkspace("work");
      setOpportunityStatus(workResult.createdAppointmentId
        ? `${workResult.workNumber} is ready in Work and the customer-selected window is now an unassigned CRM appointment for dispatch review.`
        : `${workResult.workNumber} is ready in Work.`);
    } catch (conversionError) {
      if (!requestIsCurrent()) return;
      setOpportunityStatus(
        conversionError instanceof Error
          ? conversionError.message
          : "The marketplace opportunity could not be converted.",
      );
    } finally {
      protectedOpportunityRequestControllers.current.delete(controller);
      if (requestIsCurrent()) setOpportunityBusy("");
    }
  }

  async function toggleOpportunityPhotos(opportunity: DashboardOpportunity) {
    const activeUser = user;
    if (!activeUser || protectedIdentityUid.current !== activeUser.uid) return;
    const identityUid = activeUser.uid;
    const identityRevision = protectedIdentityRevision.current;
    const identityIsCurrent = () => protectedIdentityContinuationIsCurrent(
      identityUid,
      identityRevision,
      protectedIdentityUid.current || "",
      protectedIdentityRevision.current,
    );
    const photos = opportunity.evidence.filter((item) =>
      item.contentType.startsWith("image/")
    );
    if (!photos.length) return;
    const existing = evidencePhotoUrls[opportunity.matchId];
    if (existing && Object.keys(existing).length === photos.length) {
      setVisibleEvidenceMatches((current) => ({
        ...current,
        [opportunity.matchId]: !current[opportunity.matchId],
      }));
      return;
    }

    const controller = new AbortController();
    protectedOpportunityRequestControllers.current.add(controller);
    const requestIsCurrent = () =>
      identityIsCurrent() && !controller.signal.aborted;
    setEvidencePhotoBusy(opportunity.matchId);
    setEvidencePhotoErrors((current) => ({
      ...current,
      [opportunity.matchId]: "",
    }));
    const createdUrls: string[] = [];
    try {
      const token = await activeUser.getIdToken();
      if (!requestIsCurrent()) return;
      const nextUrls: Record<string, string> = { ...(existing || {}) };
      const missingPhotos = photos.filter((item) => !nextUrls[item.id]);
      const results = await Promise.allSettled(missingPhotos.map(async (item) => {
        if (!requestIsCurrent()) return null;
        const downloadHref = item.downloadHref
          || `/api/customer-project-evidence?download=${encodeURIComponent(item.id)}`;
        const response = await fetch(
          downloadHref,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!requestIsCurrent()) return null;
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          if (!requestIsCurrent()) return null;
          throw new Error(
            result.error || "The shared photo could not be opened.",
          );
        }
        const blob = await response.blob();
        if (!requestIsCurrent()) return null;
        const url = URL.createObjectURL(blob);
        if (!requestIsCurrent()) {
          URL.revokeObjectURL(url);
          return null;
        }
        evidenceObjectUrls.current.add(url);
        createdUrls.push(url);
        return { id: item.id, url };
      }));
      if (!requestIsCurrent()) {
        for (const url of createdUrls) revokeEvidenceObjectUrl(url);
        return;
      }
      let failed = 0;
      for (const result of results) {
        if (result.status === "rejected") {
          failed += 1;
          continue;
        }
        if (!result.value) continue;
        nextUrls[result.value.id] = result.value.url;
      }
      setEvidencePhotoUrls((current) => ({
        ...current,
        [opportunity.matchId]: nextUrls,
      }));
      setVisibleEvidenceMatches((current) => ({
        ...current,
        [opportunity.matchId]: true,
      }));
      if (failed > 0) {
        setEvidencePhotoErrors((current) => ({
          ...current,
          [opportunity.matchId]:
            `${Object.keys(nextUrls).length} of ${photos.length} shared photos opened. ${failed} preview${failed === 1 ? "" : "s"} could not be opened. Protected download remains available for each file.`,
        }));
      }
    } catch (previewError) {
      for (const url of createdUrls) revokeEvidenceObjectUrl(url);
      if (!requestIsCurrent()) return;
      setEvidencePhotoErrors((current) => ({
        ...current,
        [opportunity.matchId]: previewError instanceof Error
          ? previewError.message
          : "The shared photos could not be opened.",
      }));
    } finally {
      protectedOpportunityRequestControllers.current.delete(controller);
      if (requestIsCurrent()) setEvidencePhotoBusy("");
    }
  }

  function openOpportunityPhoto(
    item: DashboardOpportunity["evidence"][number],
    url: string,
    alt: string,
  ) {
    if (!url || !evidenceObjectUrls.current.has(url)) return;
    photoLightboxOpener.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setPhotoLightbox({ item, url, alt, status: "loading" });
  }

  async function installerPlanReport(
    opportunity: DashboardOpportunity,
    activeUser: User,
  ): Promise<CustomerPlanReportView> {
    if (protectedIdentityUid.current !== activeUser.uid) {
      throw new Error("Sign in to open this household plan.");
    }
    const token = await activeUser.getIdToken();
    const response = await fetch(
      `/api/trade-opportunity-plan?matchId=${encodeURIComponent(opportunity.matchId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok || !result.report) {
      throw new Error(result.error || "The complete household plan could not be opened.");
    }
    return result.report as CustomerPlanReportView;
  }

  async function openInstallerPlan(opportunity: DashboardOpportunity) {
    const activeUser = user;
    if (!activeUser || protectedIdentityUid.current !== activeUser.uid) return;
    const identityUid = activeUser.uid;
    const identityRevision = protectedIdentityRevision.current;
    const identityIsCurrent = () =>
      protectedIdentityUid.current === identityUid &&
      protectedIdentityRevision.current === identityRevision;
    setInstallerPlanBusy(opportunity.matchId);
    setInstallerPlanErrors((current) => ({
      ...current,
      [opportunity.matchId]: "",
    }));
    try {
      const report = await installerPlanReport(opportunity, activeUser);
      if (identityIsCurrent()) setInstallerPlanPreview(report);
    } catch (planError) {
      if (!identityIsCurrent()) return;
      setInstallerPlanErrors((current) => ({
        ...current,
        [opportunity.matchId]: planError instanceof Error
          ? planError.message
          : "The complete household plan could not be opened.",
      }));
    } finally {
      if (identityIsCurrent()) setInstallerPlanBusy("");
    }
  }

  async function downloadInstallerPlan(opportunity: DashboardOpportunity) {
    const activeUser = user;
    if (!activeUser || protectedIdentityUid.current !== activeUser.uid) return;
    const identityUid = activeUser.uid;
    const identityRevision = protectedIdentityRevision.current;
    const identityIsCurrent = () =>
      protectedIdentityUid.current === identityUid &&
      protectedIdentityRevision.current === identityRevision;
    setInstallerPlanBusy(opportunity.matchId);
    setInstallerPlanErrors((current) => ({
      ...current,
      [opportunity.matchId]: "",
    }));
    try {
      const report = await installerPlanReport(opportunity, activeUser);
      if (identityIsCurrent()) {
        await downloadCustomerPlanPdf(report);
        setOpportunityStatus("The complete privacy-safe plan PDF download started.");
      }
    } catch (planError) {
      if (!identityIsCurrent()) return;
      setInstallerPlanErrors((current) => ({
        ...current,
        [opportunity.matchId]: planError instanceof Error
          ? planError.message
          : "The complete plan PDF could not be downloaded.",
      }));
    } finally {
      if (identityIsCurrent()) setInstallerPlanBusy("");
    }
  }

  async function downloadOpportunityEvidence(item: DashboardOpportunity["evidence"][number]) {
    const activeUser = user;
    if (!activeUser || protectedIdentityUid.current !== activeUser.uid) return;
    const identityUid = activeUser.uid;
    const identityRevision = protectedIdentityRevision.current;
    const identityIsCurrent = () =>
      protectedIdentityUid.current === identityUid &&
      protectedIdentityRevision.current === identityRevision;
    setOpportunityBusy(item.id); setOpportunityStatus("Preparing protected customer evidence...");
    try {
      const token = await activeUser.getIdToken();
      const downloadHref = item.downloadHref
        || `/api/customer-project-evidence?download=${encodeURIComponent(item.id)}`;
      const response = await fetch(downloadHref, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || "The project file could not be downloaded."); }
      const url = URL.createObjectURL(await response.blob()); const anchor = window.document.createElement("a");
      evidenceObjectUrls.current.add(url);
      if (!identityIsCurrent()) {
        revokeEvidenceObjectUrl(url);
        return;
      }
      anchor.href = url; anchor.download = item.fileName; anchor.click();
      setOpportunityStatus("Protected project file download started and access was audited.");
      setTimeout(() => revokeEvidenceObjectUrl(url), 1000);
    } catch (error) {
      if (identityIsCurrent()) {
        setOpportunityStatus(error instanceof Error ? error.message : "The project file could not be downloaded.");
      }
    }
    finally {
      if (identityIsCurrent()) setOpportunityBusy("");
    }
  }

  return (
    <main className="wrap direct-trade-dashboard-page">
      <TLinkHeader active="dashboard" />
      {authReady && user && installerPlanPreview && (
        <CustomerPlanReportPreviewDialog
          context="installer-enquiry"
          open
          report={installerPlanPreview}
          onClose={() => setInstallerPlanPreview(null)}
        />
      )}
      {authReady && user && photoLightbox && (
        <div
          className="dashboard-photo-lightbox-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPhotoLightbox(null);
          }}
        >
          <div
            ref={photoLightboxDialog}
            className="dashboard-photo-lightbox-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dashboard-photo-lightbox-title"
            aria-describedby="dashboard-photo-lightbox-help"
            tabIndex={-1}
            onClick={(event) => {
              if (event.target === event.currentTarget) setPhotoLightbox(null);
            }}
          >
            <header>
              <div>
                <span>Customer-shared quoting photo</span>
                <h2 id="dashboard-photo-lightbox-title">
                  {photoLightbox.item.promptLabel || photoLightbox.alt}
                </h2>
              </div>
              <button
                ref={photoLightboxCloseButton}
                type="button"
                aria-label="Close full image"
                onClick={() => setPhotoLightbox(null)}
              >
                <span aria-hidden="true">X</span>
              </button>
            </header>
            <div
              className={`dashboard-photo-lightbox-stage ${photoLightbox.status}`}
              aria-busy={photoLightbox.status === "loading"}
              onClick={(event) => {
                if (event.target === event.currentTarget) setPhotoLightbox(null);
              }}
            >
              {/* The full image reuses the authenticated, audited object URL. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoLightbox.url}
                alt={photoLightbox.alt}
                onLoad={() => setPhotoLightbox((current) =>
                  current?.item.id === photoLightbox.item.id
                    ? { ...current, status: "ready" }
                    : current
                )}
                onError={() => setPhotoLightbox((current) =>
                  current?.item.id === photoLightbox.item.id
                    ? { ...current, status: "error" }
                    : current
                )}
              />
              {photoLightbox.status === "loading" && (
                <p role="status">Opening the protected full image...</p>
              )}
              {photoLightbox.status === "error" && (
                <p role="alert">
                  The full image could not be displayed. Close this view and use
                  the protected download if needed.
                </p>
              )}
            </div>
            <p id="dashboard-photo-lightbox-help">
              Select the close button, press Escape or click outside the image to close.
            </p>
          </div>
        </div>
      )}
      {authReady && user && publicLeadHandoff && (() => {
        const stage = publicLeadHandoffStages[
          Math.min(publicLeadHandoff.stageIndex, publicLeadHandoffStages.length - 1)
        ];
        const progress = publicLeadHandoff.phase === "success"
          ? 100
          : stage.progress;
        const phaseLabel = publicLeadHandoff.phase === "success"
          ? "Job and quote ready"
          : publicLeadHandoff.phase === "error"
            ? "We could not confirm the handoff"
            : "Creating the job and quote";
        const progressText = publicLeadHandoff.phase === "success"
          ? "Server confirmed. Opening the Quote tab."
          : publicLeadHandoff.phase === "error"
            ? "The request needs attention before continuing."
            : stage.title;
        return (
          <div className="dashboard-lead-handoff-backdrop">
            <div
              ref={publicLeadHandoffDialog}
              className={`dashboard-lead-handoff-dialog is-${publicLeadHandoff.phase}`}
              role="dialog"
              aria-modal="true"
              aria-busy={publicLeadHandoff.phase === "working"}
              aria-labelledby="dashboard-lead-handoff-title"
              aria-describedby="dashboard-lead-handoff-description"
              tabIndex={-1}
            >
              <div className="dashboard-lead-handoff-visual" aria-hidden="true">
                <span>{publicLeadHandoff.phase === "success" ? "Ready" : publicLeadHandoff.phase === "error" ? "!" : ""}</span>
              </div>
              <div className="dashboard-lead-handoff-heading">
                <span>Protected lead handoff</span>
                <h2 id="dashboard-lead-handoff-title">{phaseLabel}</h2>
                <p>{publicLeadHandoff.customerName}</p>
              </div>
              <div
                className="dashboard-lead-handoff-progress"
                role="progressbar"
                aria-label="Create job and quote progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                aria-valuetext={progressText}
              >
                <span style={{ width: `${progress}%` }}><i /></span>
              </div>
              {publicLeadHandoff.phase === "error" ? (
                <div className="dashboard-lead-handoff-error" role="alert">
                  <strong>{publicLeadHandoff.error}</strong>
                  <p>
                    We could not confirm whether the protected request finished.
                    It is safe to retry. TLink will reuse the same customer, job
                    and quote if the first request reached the server.
                  </p>
                  {publicLeadHandoff.requestReference && (
                    <small>Request {publicLeadHandoff.requestReference}</small>
                  )}
                </div>
              ) : (
                <div className="dashboard-lead-handoff-status" role="status" aria-live="polite">
                  <strong>
                    {publicLeadHandoff.phase === "success"
                      ? `${publicLeadHandoff.workNumber} is ready`
                      : stage.title}
                  </strong>
                  <p>
                    {publicLeadHandoff.phase === "success"
                      ? "Opening the exact job on the Quote tab now."
                      : stage.detail}
                  </p>
                </div>
              )}
              <div className="dashboard-lead-handoff-scope" aria-label="Protected handoff includes">
                <span>Customer and site</span>
                <span>Job and draft quote</span>
                <span>Shared job files</span>
              </div>
              <p id="dashboard-lead-handoff-description" className="dashboard-lead-handoff-note">
                TLink processes these records together. The activity bar completes
                only after the server confirms the editable quote is ready.
              </p>
              {publicLeadHandoff.phase === "error" && (
                <div className="dashboard-lead-handoff-actions">
                  <button
                    type="button"
                    onClick={() => setPublicLeadHandoff(null)}
                  >
                    Back to lead
                  </button>
                  <button
                    ref={publicLeadHandoffRetryButton}
                    type="button"
                    className="primary"
                    onClick={() => void respondToOpportunity(
                      publicLeadHandoff.matchId,
                      "interested",
                    )}
                  >
                    Try again safely
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
      {!authReady || loading ? (
        <section className="dashboard-state-card" aria-live="polite">
          <p>Preparing your TLink dashboard...</p>
        </section>
      ) : !user ? (
        <section className="dashboard-state-card">
          <span>Account required</span>
          <h1>Sign in to open your dashboard</h1>
          <p>
            Use the same Google account or business email used to create the
            trade profile.
          </p>
          <a className="btn" href="/direct-trade/partners">
            Sign in or create an account
          </a>
        </section>
      ) : error ? (
        <section className="dashboard-state-card">
          <span>Dashboard unavailable</span>
          <h1>We could not load this account</h1>
          <p>{error}</p>
          <a className="btn" href="/direct-trade/partners">
            Return to account setup
          </a>
        </section>
      ) : profile?.accountStatus === "closed" ? (
        <section className="dashboard-state-card">
          <span>Account closed</span>
          <h1>This TLink account is closed</h1>
          <p>
            Trade workspace access and editable settings are unavailable.
            Existing operational and compliance records remain retained.
            Restoring access requires a separate authorised administrator
            recovery process.
          </p>
          <button
            className="btn"
            type="button"
            onClick={() => void signOut(firebaseAuth)}
          >
            Sign out
          </button>
        </section>
      ) : !profile || !profileComplete ? (
        <section className="dashboard-state-card">
          <span>Profile required</span>
          <h1>Finish the business profile first</h1>
          <p>
            Add the required business address, service coverage and capabilities
            before using the dashboard.
          </p>
          <a className="btn" href="/direct-trade/partners">
            Complete business profile
          </a>
        </section>
      ) : !profile.entitlements.verified ? (
        <section className="dashboard-state-card">
          <span>Application review required</span>
          <h1>Trade access is locked until approval</h1>
          <p>
            Your profile is saved, but no trade workspace or operational data is
            available until an authorised reviewer approves the current ABN and
            required business evidence.
          </p>
          <div className="trade-signed-in-actions">
            <a className="btn" href="/direct-trade/dashboard/verification">
              Open application status
            </a>
            <a href="/direct-trade/partners">Update business profile</a>
          </div>
          <TradeAccessPanel profile={profile} />
        </section>
      ) : (
        <div
          className={`trade-portal-shell ${isSupplier ? "is-supplier" : "is-installer"}`}
          data-trade-theme={profile.brandThemeKey || DEFAULT_TRADE_BRAND_THEME}
          data-trade-colour-mode={colourMode}
        >
          <header
            className="dashboard-hero"
            style={{
              background: tradeBusinessThemeGradient(profile.brandThemeKey),
            }}
          >
            <div className="trade-portal-brand">
              <TLinkBrand context={isSupplier ? "Wholesaler control centre" : "Installer control centre"} />
            </div>
            <AeaProductLink placement="trade-portal" />
            <TLinkCommandCentre
              user={user}
              partnerType={isSupplier ? "supplier" : "installer"}
              features={{
                businessOperations: hasBusinessOperations,
                marketplace: hasMarketplaceAccess,
                teamAccess: hasTeamAccess,
              }}
              onNavigate={(target) => {
                setCommandTarget(target);
                setWorkspace(target.workspace);
              }}
            />
            {!isSupplier && <TradeJobNotifications user={user} onNavigate={(target) => {
              setCommandTarget(target);
              setWorkspace(target.workspace);
            }} onOpenOpportunity={(matchId) => void openOpportunityNotification(matchId)} />}
            <button
              type="button"
              className="tlink-colour-mode-toggle"
              data-mode={colourMode}
              aria-label="Night mode"
              aria-pressed={colourMode === "night"}
              title={colourMode === "night" ? "Switch to day mode" : "Switch to night mode"}
              onClick={toggleColourMode}
            >
              <span className="tlink-colour-mode-sun" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <circle cx="12" cy="12" r="3.25" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
                </svg>
              </span>
              <span className="tlink-colour-mode-moon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M20.4 15.1A8.7 8.7 0 0 1 8.9 3.6 8.8 8.8 0 1 0 20.4 15.1Z" />
                </svg>
              </span>
            </button>
            <div className="dashboard-account-actions">
              {!isSupplier && <a className="tlink-get-app" href="/direct-trade/field-app"><Image src="/tlink-icon-192.png" alt="" width={25} height={25} /><span>Get the app</span></a>}
              <span className="trade-portal-role">{isSupplier ? "Wholesaler" : "Installer"}</span>
              <div>
                <small>Business account</small>
                <strong title={user.email || ""}>{profile.businessName}</strong>
              </div>
              <button type="button" onClick={() => setWorkspace("account")}>
                Business
              </button>
              <button type="button" onClick={() => void signOut(firebaseAuth)}>
                Sign out
              </button>
            </div>
          </header>

          <div className="trade-portal-intro">
            <span>{isSupplier ? "Wholesale operations" : "Business operations"}</span>
            <h1>{isSupplier ? "Products, orders and supply in one place" : "Your workday, without the clutter"}</h1>
            <p>
              {isSupplier
                ? "Manage the catalogue, trade requests, fulfilment and business settings from one clear workspace."
                : "Manage jobs, customers, schedules, products and protected opportunities from one clear workspace."}
              </p>
            </div>

          {isSupplier ? (
            <>
              <nav className="dashboard-workspace-nav" aria-label="Wholesaler workspace">
                <button type="button" className={workspace === "products" ? "active" : ""} onClick={() => setWorkspace("products")}><b aria-hidden="true">01</b><span>Products</span><small>Catalogue and stock</small></button>
                <button type="button" className={workspace === "work" ? "active" : ""} onClick={() => setWorkspace("work")}><b aria-hidden="true">02</b><span>Work</span><small>Requests and tasks</small></button>
                <button type="button" className={workspace === "orders" ? "active" : ""} onClick={() => setWorkspace("orders")}><b aria-hidden="true">03</b><span>Orders</span><small>Supply and warranties</small></button>
                <button type="button" className={workspace === "import" ? "active" : ""} onClick={() => setWorkspace("import")}><b aria-hidden="true">04</b><span>Import</span><small>Guided data migration</small></button>
                <button type="button" className={workspace === "account" ? "active" : ""} onClick={() => setWorkspace("account")}><b aria-hidden="true">05</b><span>Business</span><small>Profile and verification</small></button>
                <div className="dashboard-rail-note"><strong>Privacy boundary</strong><p>Wholesalers manage products and supply. Household leads and customer contact details never enter this workspace.</p></div>
              </nav>
              {workspace === "work" && <TradeBusinessHub
                user={user}
                partnerType="supplier"
                fullAccess={hasBusinessOperations}
                teamAccess={hasTeamAccess}
                navigationTarget={commandTarget}
              />}
              {workspace === "products" && <SupplierCatalogueWorkspace
                user={user}
                businessName={profile.businessName}
                marketplaceVisible={hasSupplierVisibility}
                canBulkImport={hasBulkImport}
                hasAnalytics={hasSupplierVisibility}
                navigationTarget={commandTarget}
              />}
              {workspace === "orders" && (hasBusinessOperations ? <TradePurchasingWorkspace user={user} partnerType="supplier" navigationTarget={commandTarget} /> : <section className="dashboard-panel dashboard-upgrade-callout"><strong>Verification required</strong><p>Complete business verification to use purchasing, fulfilment milestones and warranty claims.</p><a href="/direct-trade/dashboard/verification">Open verification centre</a></section>)}
              {workspace === "import" && (hasBusinessOperations && hasBulkImport ? <TradeDataImportWorkspace user={user} partnerType="supplier" /> : <section className="dashboard-panel dashboard-upgrade-callout"><strong>Verification required</strong><p>Complete business verification to use guided catalogue imports, duplicate review and rollback.</p><a href="/direct-trade/dashboard/verification">Open verification centre</a></section>)}
              {workspace === "account" && (
                <TradeBusinessSettingsWorkspace
                  user={user}
                  profile={profile}
                  onProfileChange={(changes) =>
                    setProfile((current) =>
                      current ? { ...current, ...changes } : current,
                    )
                  }
                  onAccountClosed={() => {
                    setProfile(null);
                    void signOut(firebaseAuth);
                  }}
                />
              )}
            </>
          ) : (
            <>
              <nav
                className="dashboard-workspace-nav"
                aria-label="TLink installer account"
              >
                <button type="button" aria-current={workspace === "work" && activeWorkView !== "schedule" && activeWorkView !== "leads" ? "page" : undefined} className={workspace === "work" && activeWorkView !== "schedule" && activeWorkView !== "leads" ? "active" : ""} onClick={() => {
                  setCommandTarget({ workspace: "work", kind: "crm-view", id: "today", query: "", nonce: Date.now() });
                  setActiveWorkView("today");
                  setWorkspace("work");
                }}><b aria-hidden="true">01</b><span>Work</span><small>Today and next actions</small></button>
                <div className="dashboard-workspace-shortcuts" aria-label="Work shortcuts">
                  {([['jobs', 'Jobs'], ['customers', 'Customers'], ['pricebook', 'Price book']] as const).map(([view, label]) => <button type="button" key={view} onClick={() => {
                    setCommandTarget({ workspace: "work", kind: "crm-view", id: view, query: "", nonce: Date.now() });
                    setWorkspace("work");
                  }}><span>{label}</span></button>)}
                </div>
                <button type="button" aria-current={workspace === "team" ? "page" : undefined} className={workspace === "team" ? "active" : ""} onClick={() => setWorkspace("team")}><b aria-hidden="true">02</b><span>Team</span><small>People, access and files</small></button>
                <button type="button" aria-current={workspace === "work" && activeWorkView === "schedule" ? "page" : undefined} className={workspace === "work" && activeWorkView === "schedule" ? "active" : ""} onClick={() => {
                  setCommandTarget({ workspace: "work", kind: "crm-view", id: "schedule", query: "", nonce: Date.now() });
                  setActiveWorkView("schedule");
                  setWorkspace("work");
                }}><b aria-hidden="true">03</b><span>Schedule</span><small>Capacity and dispatch</small></button>
                <button type="button" aria-current={workspace === "invoices" ? "page" : undefined} className={workspace === "invoices" ? "active" : ""} onClick={() => setWorkspace("invoices")}><b aria-hidden="true">04</b><span>Invoices</span><small>Prepare drafts and get paid</small></button>
                <button type="button" aria-current={workspace === "follow-ups" ? "page" : undefined} className={workspace === "follow-ups" ? "active" : ""} onClick={() => setWorkspace("follow-ups")}><b aria-hidden="true">05</b><span>Follow-ups</span><small>Consent-aware service preparation</small></button>
                <button type="button" aria-current={workspace === "work" && activeWorkView === "leads" ? "page" : undefined} className={workspace === "work" && activeWorkView === "leads" ? "active" : ""} onClick={() => {
                  setCommandTarget({ workspace: "work", kind: "crm-view", id: "leads", query: "", nonce: Date.now() });
                  setActiveWorkView("leads");
                  setWorkspace("work");
                }}><b aria-hidden="true">06</b><span>Leads{offeredCount ? ` (${offeredCount})` : ""}</span><small>Australian Energy Assessments protected opportunities</small></button>
                <button type="button" aria-current={workspace === "products" ? "page" : undefined} className={workspace === "products" ? "active" : ""} onClick={() => setWorkspace("products")}><b aria-hidden="true">07</b><span>Products</span><small>Approved trade catalogue</small></button>
                <button type="button" aria-current={workspace === "calculator" ? "page" : undefined} className={workspace === "calculator" ? "active" : ""} onClick={() => setWorkspace("calculator")}><b aria-hidden="true">08</b><span>Calculator</span><small>Rebates for quotes and invoices</small></button>
                <button type="button" aria-current={workspace === "account" ? "page" : undefined} className={workspace === "account" ? "active" : ""} onClick={() => setWorkspace("account")}><b aria-hidden="true">09</b><span>Business</span><small>Settings and verification</small></button>
                <div className="dashboard-rail-note"><strong>Privacy boundary</strong><p>Australian Energy Assessments and TLink leads show only consent-released details. Trade-sourced contacts belong in Customers or Jobs.</p></div>
              </nav>

              {workspace === "work" && <TradeBusinessHub
                user={user}
                partnerType="installer"
                fullAccess={hasBusinessOperations}
                teamAccess={hasTeamAccess}
                navigationTarget={commandTarget}
                onOpenSchedule={(weekStart) => {
                  setCommandTarget({
                    workspace: "work",
                    kind: "crm-view",
                    id: "schedule",
                    query: weekStart || "",
                    nonce: Date.now(),
                  });
                  setActiveWorkView("schedule");
                  setWorkspace("work");
                }}
                onWorkViewChange={(nextView) => {
                  setCommandTarget((current) => current?.kind === "crm-view" && current.id !== nextView ? null : current);
                  setActiveWorkView(nextView);
                  setWorkspace("work");
                }}
                onOpenInvoices={() => setWorkspace("invoices")}
                onCloseJobNavigation={() => setCommandTarget((current) => current?.kind === "job"
                  ? { workspace: "work", kind: "crm-view", id: "jobs", query: "", nonce: Date.now() }
                  : current)}
              />}

              {workspace === "team" && (hasBusinessOperations && hasTeamAccess ? (
                <section className="dashboard-panel" aria-labelledby="team-workspace-title">
                  <div className="dashboard-panel-heading">
                    <span>Team</span>
                    <h2 id="team-workspace-title">People, access and member records</h2>
                    <p>Add staff, set practical access, availability, schedule colours and private documents.</p>
                  </div>
                  <TradeTeamSettings user={user} navigationTarget={commandTarget} />
                </section>
              ) : <section className="dashboard-panel dashboard-upgrade-callout"><strong>Verification required</strong><p>The administrator account record must be active and approved before team management is available.</p><a href="/direct-trade/dashboard/verification">Open verification centre</a></section>)}

              {workspace === "invoices" && (hasBusinessOperations ? <TradeInvoiceWorkspace user={user} onOpenJob={(workOrderId) => {
                setCommandTarget({ workspace: "work", kind: "job", id: workOrderId, query: "", jobTab: "invoice", nonce: Date.now() });
                setWorkspace("work");
              }} /> : <section className="dashboard-panel dashboard-upgrade-callout"><strong>Verification required</strong><p>The administrator account record must be active and approved before invoicing is available.</p><a href="/direct-trade/dashboard/verification">Open verification centre</a></section>)}

              {workspace === "follow-ups" && (hasBusinessOperations && hasTeamAccess ? <TradeServiceFollowUpWorkspace user={user} /> : <section className="dashboard-panel dashboard-upgrade-callout"><strong>Verification required</strong><p>The administrator account record must be active and approved before service follow-up preparation is available.</p><a href="/direct-trade/dashboard/verification">Open verification centre</a></section>)}

              {workspace === "calculator" && (hasBusinessOperations ? (
                <TradeRebateCalculatorWorkspace key={user.uid} user={user} />
              ) : (
                <section className="dashboard-panel dashboard-upgrade-callout">
                  <strong>Verification required</strong>
                  <p>An active verified installer account is required to use the rebate calculator.</p>
                  <a href="/direct-trade/dashboard/verification">Open verification centre</a>
                </section>
              ))}

              {workspace === "account" && (
                <TradeBusinessSettingsWorkspace
                  user={user}
                  profile={profile}
                  onProfileChange={(changes) =>
                    setProfile((current) =>
                      current ? { ...current, ...changes } : current,
                    )
                  }
                  onAccountClosed={() => {
                    setProfile(null);
                    void signOut(firebaseAuth);
                  }}
                />
              )}

              {workspace === "work" && activeWorkView === "leads" && <>
                <section
                  id="opportunity-inbox"
                  className="dashboard-panel dashboard-opportunities"
                  aria-labelledby="dashboard-opportunities-title"
                >
                  <div className="dashboard-panel-heading">
                    <span>Australian Energy Assessments and TLink supplied leads</span>
                    <h2 id="dashboard-opportunities-title">
                      Protected leads matched to this business
                    </h2>
                    <p>
                      Public enquiries show each business only the details the household agreed to share. Quick upgrade requests include the postcode, selected services, any written message and full property address. Email, name and phone appear only when selected. Customer account project contact and street details stay protected until the customer chooses this business.
                    </p>
                  </div>
                  {opportunityNavigationStatus && (
                    <p
                      className="dashboard-settings-status dashboard-opportunity-navigation-status"
                      role="status"
                    >
                      {opportunityNavigationStatus}
                    </p>
                  )}
                  {!hasLeadAccess ? (
                    <div className="dashboard-access-locked">
                      <span>Verification required</span>
                      <h3>Opportunity delivery is switched off</h3>
                      <p>
                        Complete business verification to enter automatic and manual
                        opportunity allocation. No payment details are required.
                      </p>
                      <a href="/direct-trade/dashboard/verification">Open verification centre</a>
                    </div>
                  ) : opportunities.length ? (
                    <>
                      {opportunityLoadError && (
                        <div className="dashboard-settings-status dashboard-opportunity-load-warning" role="status">
                          <strong>Some leads may be missing</strong>
                          <p>The full lead inbox could not be loaded. {opportunityLoadError}</p>
                        </div>
                      )}
                      <div className="dashboard-lead-filters" aria-label="Lead filters">
                        <label>
                          <span>Search</span>
                          <input
                            aria-label="Search leads"
                            placeholder="Scope, service or region"
                            value={leadSearch}
                            onChange={(event) => setLeadSearch(event.target.value)}
                          />
                        </label>
                        <label>
                          <span>Status</span>
                          <select value={leadStatusFilter} onChange={(event) => setLeadStatusFilter(event.target.value)}>
                            <option value="">All statuses</option>
                            {["offered", "viewed", "interested", "connected"].map((value) => <option key={value} value={value}>{value === "offered" ? "New" : value.replaceAll("_", " ")}</option>)}
                          </select>
                        </label>
                        <label>
                          <span>Service</span>
                          <select value={leadServiceFilter} onChange={(event) => setLeadServiceFilter(event.target.value)}>
                            <option value="">All services</option>
                            {Object.entries(capabilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                        </label>
                        <label>
                          <span>State</span>
                          <select value={leadStateFilter} onChange={(event) => setLeadStateFilter(event.target.value)}>
                            <option value="">All states</option>
                            {[...new Set(opportunities.map((item) => item.state))].sort().map((value) => <option key={value} value={value}>{value}</option>)}
                          </select>
                        </label>
                        <div>
                          <strong>{visibleLeadOpportunities.length}</strong>
                          <span>matching lead{visibleLeadOpportunities.length === 1 ? "" : "s"}</span>
                          {(leadSearch || leadStatusFilter || leadServiceFilter || leadStateFilter) && (
                            <button type="button" onClick={() => {
                              setLeadSearch("");
                              setLeadStatusFilter("");
                              setLeadServiceFilter("");
                              setLeadStateFilter("");
                            }}>Clear</button>
                          )}
                        </div>
                      </div>
                      {visibleLeadOpportunities.length ? <div className="dashboard-lead-workspace">
                      <nav className="dashboard-lead-list" aria-label="Available leads">
                        {visibleLeadOpportunities.map((opportunity) => {
                          const selected = selectedLeadOpportunity?.matchId === opportunity.matchId;
                          const customerName = opportunity.customerContact?.name.trim()
                            || opportunity.title
                            || "Customer enquiry";
                          return <button
                            key={opportunity.matchId}
                            type="button"
                            className={selected ? "active" : ""}
                            aria-current={selected ? "true" : undefined}
                            aria-controls={`opportunity-${opportunity.matchId}`}
                            onClick={() => setSelectedOpportunityMatchId(opportunity.matchId)}
                          >
                            <span>{opportunity.platformOnly ? "Australian Energy Assessments protected lead" : "Australian Energy Assessments supplied lead"} | {opportunity.matchStatus === "offered" ? "New" : opportunity.matchStatus.replaceAll("_", " ")}</span>
                            <strong>{customerName}</strong>
                            <p>{opportunity.enquiryPack?.summary || opportunity.summary}</p>
                            <small>{opportunityBroadLocation(opportunity)} | {opportunity.timing.replaceAll("_", " ")}</small>
                          </button>;
                        })}
                      </nav>
                      <div className="dashboard-opportunity-list dashboard-lead-preview" aria-live="polite">
                      {visibleLeadOpportunities.map((opportunity) => {
                        const isExpanded = selectedLeadOpportunity?.matchId === opportunity.matchId;
                        const releasedCustomerContact = opportunity.customerContact;
                        const releasedCustomerName =
                          releasedCustomerContact?.name.trim() || "";
                        const customerDisplayName = releasedCustomerName
                          || opportunity.title
                          || "Customer enquiry";
                        const detailId = `opportunity-details-${opportunity.matchId}`;
                        const previewHeadingId = `opportunity-heading-${opportunity.matchId}`;
                        const customerIdentityId =
                          `opportunity-customer-contact-${opportunity.matchId}`;
                        const customerIdentityHeadingId =
                          `opportunity-customer-${opportunity.matchId}`;
                        const services = (
                          opportunity.matchedCategories.length
                            ? opportunity.matchedCategories
                            : opportunity.serviceCategories
                        ).map((item) => capabilityLabels[item] || item);
                        return (
                        <article
                          key={opportunity.matchId}
                          id={`opportunity-${opportunity.matchId}`}
                          tabIndex={-1}
                          hidden={!isExpanded}
                          className={`dashboard-opportunity-card status-${opportunity.matchStatus} expanded${focusedOpportunityMatchId === opportunity.matchId ? " notification-target" : ""}`}
                        >
                          <header>
                            <div className="dashboard-opportunity-heading">
                              <span>
                                {opportunityBroadLocation(opportunity)} | {opportunity.distanceBand}
                              </span>
                              <h3 id={previewHeadingId}>{customerDisplayName}</h3>
                              {releasedCustomerName && (
                                <span className="dashboard-connected-customer-scope">
                                  {opportunity.title}
                                </span>
                              )}
                            </div>
                            <div className="dashboard-opportunity-card-controls">
                              <strong>
                                {opportunity.matchStatus === "offered"
                                  ? "New"
                                  : opportunity.matchStatus.replaceAll("_", " ")}
                              </strong>
                              {(["offered", "viewed"].includes(opportunity.matchStatus)
                                || (opportunity.platformOnly && opportunity.matchStatus === "interested")) && <button
                                type="button"
                                className="dashboard-lead-dismiss"
                                aria-label={`Remove ${customerDisplayName} from this business's leads`}
                                title="Remove from this business only"
                                disabled={opportunityBusy === opportunity.matchId}
                                onClick={() => dismissOpportunity(opportunity)}
                              >
                                <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>
                              </button>}
                            </div>
                          </header>
                          {releasedCustomerContact && (
                            <section
                              id={customerIdentityId}
                              className="dashboard-connected-customer-identity"
                              aria-labelledby={
                                isExpanded
                                  ? customerIdentityHeadingId
                                  : undefined
                              }
                              hidden={!isExpanded}
                            >
                              {isExpanded && (
                                <>
                                  <div className="dashboard-connected-customer-intro">
                                    <span>Customer-authorised contact</span>
                                    <h4 id={customerIdentityHeadingId}>
                                      {customerDisplayName}
                                    </h4>
                                    <p>
                                      {releasedCustomerContact.releaseScope === "all_qualified_trades"
                                        ? "The customer consented to share these details with every verified matching trade on "
                                        : "Contact details were released to this exact installer match on "}
                                      {new Date(
                                        releasedCustomerContact.grantedAt,
                                      ).toLocaleString("en-AU")}
                                      .
                                    </p>
                                  </div>
                                  <dl
                                    className="dashboard-connected-customer-contact-grid"
                                    aria-label={`Contact details for ${customerDisplayName}`}
                                  >
                                    {releasedCustomerContact.phone && <div>
                                      <dt>Phone</dt>
                                      <dd>
                                        <a href={`tel:${releasedCustomerContact.phone}`}>
                                          {releasedCustomerContact.phone}
                                        </a>
                                      </dd>
                                    </div>}
                                    {releasedCustomerContact.email && <div>
                                      <dt>Email</dt>
                                      <dd>
                                        <a href={`mailto:${releasedCustomerContact.email}`}>
                                          {releasedCustomerContact.email}
                                        </a>
                                      </dd>
                                    </div>}
                                    <div>
                                      <dt>{releasedCustomerContact.releaseScope === "all_qualified_trades" ? "Service area" : "Service address"}</dt>
                                      <dd>
                                        {[
                                          releasedCustomerContact.addressLine1,
                                          releasedCustomerContact.addressLine2,
                                          releasedCustomerContact.suburb,
                                          releasedCustomerContact.addressState,
                                          releasedCustomerContact.postcode,
                                        ]
                                          .filter(Boolean)
                                          .join(", ")}
                                      </dd>
                                    </div>
                                    {releasedCustomerContact.message && <div>
                                      <dt>Customer message</dt>
                                      <dd>{releasedCustomerContact.message}</dd>
                                    </div>}
                                  </dl>
                                </>
                              )}
                            </section>
                          )}
                          <div className="dashboard-opportunity-compact-summary">
                            <p>
                              {opportunity.enquiryPack?.summary ||
                                opportunity.summary}
                            </p>
                            <dl>
                              <div>
                                <dt>Work</dt>
                                <dd>{services.join(", ") || "Scope to review"}</dd>
                              </div>
                              <div>
                                <dt>Timing</dt>
                                <dd>{opportunity.timing.replaceAll("_", " ")}</dd>
                              </div>
                              <div>
                                <dt>Shared files</dt>
                                <dd>{opportunity.approvedSharedFileCount}</dd>
                              </div>
                              <div>
                                <dt>Next</dt>
                                <dd>{opportunityNextAction(opportunity)}</dd>
                              </div>
                            </dl>
                          </div>
                          <div
                            id={detailId}
                            className="dashboard-opportunity-details"
                            aria-labelledby={previewHeadingId}
                            hidden={!isExpanded}
                          >
                            {isExpanded && (
                              <>
                          {(!opportunity.platformOnly || !opportunity.enquiryPack) && (
                            <p>{opportunity.summary}</p>
                          )}
                          {opportunity.platformOnly && opportunity.enquiryPack && (
                            <EnquiryPack
                              opportunity={opportunity}
                              photoUrls={evidencePhotoUrls[opportunity.matchId] || {}}
                              photosVisible={Boolean(visibleEvidenceMatches[opportunity.matchId])}
                              photoBusy={evidencePhotoBusy === opportunity.matchId}
                              photoError={evidencePhotoErrors[opportunity.matchId] || ""}
                              downloadBusy={opportunityBusy}
                              planBusy={installerPlanBusy === opportunity.matchId}
                              planError={installerPlanErrors[opportunity.matchId] || ""}
                              onTogglePhotos={() => void toggleOpportunityPhotos(opportunity)}
                              onViewPhoto={openOpportunityPhoto}
                              onDownload={(item) => void downloadOpportunityEvidence(item)}
                              onOpenPlan={() => void openInstallerPlan(opportunity)}
                              onDownloadPlan={() => void downloadInstallerPlan(opportunity)}
                            />
                          )}
                          {!opportunity.platformOnly && opportunity.quotePreparation && (
                            <PublicQuotePreparation
                              opportunity={opportunity}
                              photoUrls={evidencePhotoUrls[opportunity.matchId] || {}}
                              photosVisible={Boolean(visibleEvidenceMatches[opportunity.matchId])}
                              photoBusy={evidencePhotoBusy === opportunity.matchId}
                              photoError={evidencePhotoErrors[opportunity.matchId] || ""}
                              downloadBusy={opportunityBusy}
                              onTogglePhotos={() => void toggleOpportunityPhotos(opportunity)}
                              onViewPhoto={openOpportunityPhoto}
                              onDownload={(item) => void downloadOpportunityEvidence(item)}
                            />
                          )}
                          {opportunity.platformOnly && !opportunity.enquiryPack && Object.keys(opportunity.propertyContext || {}).length > 0 && <dl className="dashboard-property-context"><div><dt>Storeys</dt><dd>{String(opportunity.propertyContext.storeys || "not confirmed").replaceAll("_", " ")}</dd></div><div><dt>Home age</dt><dd>{String(opportunity.propertyContext.ageBand || "not confirmed").replaceAll("_", " ")}</dd></div><div><dt>Floor area</dt><dd>{String(opportunity.propertyContext.floorArea || "not confirmed").replaceAll("_", " ")}</dd></div><div><dt>Roof</dt><dd>{String(opportunity.propertyContext.roofType || "not confirmed").replaceAll("_", " ")}</dd></div><div><dt>Switchboard</dt><dd>{String(opportunity.propertyContext.switchboard || "not confirmed").replaceAll("_", " ")}</dd></div><div><dt>Approval context</dt><dd>{String(opportunity.propertyContext.approvalContext || "none noted").replaceAll("_", " ")}</dd></div><div><dt>Site considerations</dt><dd>{Array.isArray(opportunity.propertyContext.accessConstraints) && opportunity.propertyContext.accessConstraints.length > 0 ? opportunity.propertyContext.accessConstraints.map((item) => String(item).replaceAll("_", " ")).join(", ") : "none noted"}</dd></div></dl>}
                          <div className="dashboard-opportunity-tags">
                            <span>
                              Qualified trade allocation {opportunity.allocationRank}
                            </span>
                            <span>
                              Expires{" "}
                              {new Date(
                                opportunity.expiresAt,
                              ).toLocaleDateString("en-AU")}
                            </span>
                            <span>
                              {opportunity.timing.replaceAll("_", " ")}
                            </span>
                            <span>{opportunity.priority} priority</span>
                            {(opportunity.matchedCategories.length
                              ? opportunity.matchedCategories
                              : opportunity.serviceCategories
                            ).map((item) => (
                              <span key={item}>
                                {capabilityLabels[item] || item}
                              </span>
                            ))}
                          </div>
                          {opportunity.matchStatus === "connected" && !releasedCustomerContact && (
                            <div className="dashboard-contact-allowance">
                              <div>
                                <strong>Platform coordination active</strong>
                                <span>
                                  The household progressed this option, but no active contact release is available. Keep coordination inside the platform.
                                </span>
                              </div>
                            </div>
                          )}
                          {opportunity.platformOnly && ["interested", "connected"].includes(opportunity.matchStatus) && <div id={`lead-quote-${opportunity.matchId}`}><InstallerPlatformQuote matchId={opportunity.matchId} initialQuote={opportunity.quote} onStatus={setOpportunityStatus} /></div>}
                          {opportunity.platformOnly && opportunity.quote?.customerDecision === "accepted" && <>
                            <InstallerArrivalWindows matchId={opportunity.matchId} initialProposal={opportunity.arrivalProposal} onStatus={setOpportunityStatus} />
                            <section className="dashboard-opportunity-conversion" aria-label="Customer contact workflow action"><div><strong>Create the CRM job when you are ready to arrange the work</strong><span>If the customer selected an arrival window, use it when creating the appointment in Work. The proposal itself does not create an appointment.</span></div><button type="button" disabled={opportunityBusy === opportunity.matchId} onClick={() => void convertOpportunity(opportunity.matchId)}>Create job</button></section>
                          </>}
                          {opportunity.platformOnly && opportunity.matchStatus === "connected" && !releasedCustomerContact && opportunity.quote?.customerDecision !== "accepted" && <div className="dashboard-contact-allowance"><div><strong>Waiting for the customer to choose a business</strong><span>Contact details remain protected until the customer chooses to get in touch with this business.</span></div></div>}
                          {(opportunity.matchStatus !== "connected" || !opportunity.platformOnly) && <div className="dashboard-opportunity-actions dashboard-lead-preview-actions">
                            {opportunity.matchStatus === "offered" && <button
                              type="button"
                              disabled={opportunityBusy === opportunity.matchId}
                              onClick={() => void respondToOpportunity(opportunity.matchId, "viewed")}
                            >
                              Save for review
                            </button>}
                            <button
                              type="button"
                              className="primary"
                              disabled={opportunityBusy === opportunity.matchId}
                              onClick={() => {
                                if (!opportunity.platformOnly && ["interested", "connected"].includes(opportunity.matchStatus)) {
                                  void openPublicLeadQuote(opportunity);
                                  return;
                                }
                                if (opportunity.platformOnly && opportunity.matchStatus === "interested") {
                                  const quotePanel = document.getElementById(`lead-quote-${opportunity.matchId}`);
                                  quotePanel?.scrollIntoView({ behavior: "smooth", block: "start" });
                                  quotePanel?.querySelector<HTMLElement>("input, textarea, select, button")?.focus({ preventScroll: true });
                                  return;
                                }
                                void respondToOpportunity(opportunity.matchId, "interested");
                              }}
                            >
                              {opportunity.platformOnly && opportunity.matchStatus === "interested"
                                ? "Edit quote"
                                : !opportunity.platformOnly && ["interested", "connected"].includes(opportunity.matchStatus)
                                  ? "Continue quote"
                                  : "Quote"}
                            </button>
                          </div>}
                          {opportunity.platformOnly && opportunity.matchStatus === "connected" && <div className="dashboard-opportunity-actions dashboard-lead-preview-actions"><button
                            type="button"
                            className="primary"
                            onClick={() => {
                              const quotePanel = document.getElementById(`lead-quote-${opportunity.matchId}`);
                              quotePanel?.scrollIntoView({ behavior: "smooth", block: "start" });
                              quotePanel?.querySelector<HTMLElement>("input, textarea, select, button")?.focus({ preventScroll: true });
                            }}
                          >{opportunity.quote?.customerDecision === "accepted" ? "View quote" : "Edit quote"}</button></div>}
                              </>
                            )}
                          </div>
                        </article>
                        );
                      })}
                    </div></div> : <div className="dashboard-empty-state"><strong>No leads match these filters</strong><p>Clear one or more filters to return to the full opportunity inbox.</p></div>}
                    </>
                  ) : opportunityLoadError ? (
                    <div className="dashboard-empty-state" role="alert">
                      <strong>Leads could not be loaded</strong>
                      <p>{opportunityLoadError}</p>
                    </div>
                  ) : (
                    <div className="dashboard-empty-state">
                      <strong>No opportunities assigned</strong>
                      <p>
                        Matching uses postcode distance, your service radius,
                        verified capability, availability and recent allocation
                        load. No opportunity is opened to every installer.
                      </p>
                    </div>
                  )}
                  {opportunityStatus && (
                    <p className="dashboard-settings-status" role="status">
                      {opportunityStatus}
                    </p>
                  )}
                  <div className="dashboard-profile-summary">
                    <div>
                      <span>Serviceability</span>
                      <strong>
                        {profile.serviceBasePostcode || profile.postcode} ·{" "}
                        {profile.serviceRadiusKm || 50} km radius ·{" "}
                        {profile.serviceStates.join(", ")}
                      </strong>
                    </div>
                    <div>
                      <span>Capabilities</span>
                      <strong>
                        {profile.capabilities
                          .map((item) => capabilityLabels[item] || item)
                          .join(", ")}
                      </strong>
                    </div>
                  </div>
                </section>
              </>}

              {workspace === "products" && (hasMarketplaceAccess ? (
                <InstallerProductMarketplace user={user} navigationTarget={commandTarget} />
              ) : (
                <section className="dashboard-panel dashboard-access-locked-panel">
                  <div className="dashboard-access-locked">
                    <span>Verification required</span>
                    <h2>Wholesale product marketplace</h2>
                    <p>
                      Complete business verification to compare approved equipment,
                      trade pricing, stock, warranties and complete kit dependencies.
                    </p>
                    <a href="/direct-trade/dashboard/verification">Open verification centre</a>
                  </div>
                </section>
              ))}
            </>
          )}

        </div>
      )}
      <SiteFooter>
        Free TLink access does not replace trade licensing, government
        accreditation, scheme approval, insurance, product compliance or
        customer obligations.
      </SiteFooter>
    </main>
  );
}
