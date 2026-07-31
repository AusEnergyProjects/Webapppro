"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { SiteFooter } from "./ComparatorChrome";
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

const SupplierCatalogueWorkspace = dynamic(() => import("./SupplierCatalogueWorkspace").then((module) => module.SupplierCatalogueWorkspace));
const InstallerProductMarketplace = dynamic(() => import("./InstallerProductMarketplace").then((module) => module.InstallerProductMarketplace));
const InstallerPlatformQuote = dynamic(() => import("./InstallerPlatformQuote").then((module) => module.InstallerPlatformQuote));
const InstallerArrivalWindows = dynamic(() => import("./InstallerArrivalWindows").then((module) => module.InstallerArrivalWindows));
const TradePurchasingWorkspace = dynamic(() => import("./TradePurchasingWorkspace").then((module) => module.TradePurchasingWorkspace));
const TradeDataImportWorkspace = dynamic(() => import("./TradeDataImportWorkspace").then((module) => module.TradeDataImportWorkspace));
const TradeScheduleWorkspace = dynamic(() => import("./TradeScheduleWorkspace").then((module) => module.TradeScheduleWorkspace));
const TradeInvoiceWorkspace = dynamic(() => import("./TradeInvoiceWorkspace").then((module) => module.TradeInvoiceWorkspace));
const TradeServiceFollowUpWorkspace = dynamic(() => import("./TradeServiceFollowUpWorkspace").then((module) => module.TradeServiceFollowUpWorkspace));

type DashboardProfile = {
  businessName: string;
  partnerType: "installer" | "supplier";
  addressLine1: string;
  suburb: string;
  addressState: string;
  postcode: string;
  serviceStates: string[];
  capabilities: string[];
  accountStatus: string;
  verificationStatus: string;
  availabilityStatus: "open" | "limited" | "paused";
  serviceBasePostcode: string;
  serviceRadiusKm: number;
  emailOpportunities: boolean;
  emailWeeklySummary: boolean;
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
  };
  evidence: Array<{ id: string; category: string; fileName: string; contentType: string; sizeBytes: number; createdAt: string; sharingScope: "allocated-installers" }>;
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
type DashboardWorkspace = "work" | "schedule" | "invoices" | "follow-ups" | "leads" | "products" | "orders" | "import" | "account";
const dashboardWorkspaces = new Set<DashboardWorkspace>([
  "work",
  "schedule",
  "invoices",
  "follow-ups",
  "leads",
  "products",
  "orders",
  "import",
  "account",
]);

function dashboardWorkspaceFromSearch(search: string): DashboardWorkspace {
  const requested = new URLSearchParams(search).get("workspace");
  return dashboardWorkspaces.has(requested as DashboardWorkspace)
    ? requested as DashboardWorkspace
    : "work";
}

const opportunityMatchIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function opportunityMatchFromSearch(search: string) {
  const requested = new URLSearchParams(search).get("matchId") || "";
  return opportunityMatchIdPattern.test(requested) ? requested : "";
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
  assessment: "Energy assessment",
  solar: "Rooftop solar",
  battery: "Home batteries",
  "heating-cooling": "Heating and cooling",
  "hot-water": "Hot water",
  "draught-proofing": "Draught-proofing",
  insulation: "Insulation",
  glazing: "Glazing",
  "window-coverings": "Blinds, shutters and external shading",
  "ev-charging": "EV charging",
  electrical: "Electrical services",
  plumbing: "Plumbing services",
  "mounting-hardware": "Mounting and hardware",
  controls: "Energy controls",
  other: "Other energy upgrades",
};

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
                {photoUrls[item.id] && (
                  // Authenticated evidence is exposed as a short-lived object URL.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoUrls[item.id]}
                    alt={`Customer-shared ${item.category.replaceAll("-", " ")} photo`}
                  />
                )}
                {!photoUrls[item.id] && (
                  <div className="dashboard-enquiry-thumbnail-unavailable">
                    Preview unavailable. The protected download may still be
                    available.
                  </div>
                )}
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
        Suburb, postcode and state are shown for service-area planning.
        Customer identity, contact details, street and unit address, private
        notes, room details and evidence filenames remain withheld.
      </small>
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
  const [availabilityStatus, setAvailabilityStatus] = useState<
    "open" | "limited" | "paused"
  >("paused");
  const [emailOpportunities, setEmailOpportunities] = useState(true);
  const [emailWeeklySummary, setEmailWeeklySummary] = useState(true);
  const [serviceBasePostcode, setServiceBasePostcode] = useState("");
  const [serviceRadiusKm, setServiceRadiusKm] = useState(50);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState("");
  const [opportunities, setOpportunities] = useState<DashboardOpportunity[]>(
    [],
  );
  const [opportunityBusy, setOpportunityBusy] = useState("");
  const [opportunityStatus, setOpportunityStatus] = useState("");
  const [opportunityNavigationStatus, setOpportunityNavigationStatus] =
    useState("");
  const [leadSearch, setLeadSearch] = useState("");
  const [leadStatusFilter, setLeadStatusFilter] = useState("");
  const [leadServiceFilter, setLeadServiceFilter] = useState("");
  const [leadStateFilter, setLeadStateFilter] = useState("");
  const [focusedOpportunityMatchId, setFocusedOpportunityMatchId] = useState("");
  const [expandedOpportunityMatchIds, setExpandedOpportunityMatchIds] =
    useState<Set<string>>(() => new Set());
  const [workspace, setWorkspace] = useState<DashboardWorkspace>(() =>
    typeof window === "undefined"
      ? "work"
      : dashboardWorkspaceFromSearch(window.location.search)
  );
  const [scheduleWeekStart, setScheduleWeekStart] = useState("");
  const [commandTarget, setCommandTarget] = useState<TLinkCommandTarget | null>(null);
  const [visibleEvidenceMatches, setVisibleEvidenceMatches] = useState<Record<string, boolean>>({});
  const [evidencePhotoUrls, setEvidencePhotoUrls] = useState<Record<string, Record<string, string>>>({});
  const [evidencePhotoBusy, setEvidencePhotoBusy] = useState("");
  const [evidencePhotoErrors, setEvidencePhotoErrors] = useState<Record<string, string>>({});
  const [installerPlanBusy, setInstallerPlanBusy] = useState("");
  const [installerPlanErrors, setInstallerPlanErrors] = useState<Record<string, string>>({});
  const [installerPlanPreview, setInstallerPlanPreview] = useState<CustomerPlanReportView | null>(null);
  const evidenceObjectUrls = useRef(new Set<string>());
  const protectedIdentityUid = useRef<string | null>(null);
  const protectedIdentityRevision = useRef(0);
  const initialOpportunityMatchId = useRef(
    typeof window === "undefined"
      ? ""
      : opportunityMatchFromSearch(window.location.search),
  );

  const revokeEvidenceObjectUrl = useCallback((url: string) => {
    if (!evidenceObjectUrls.current.delete(url)) return;
    URL.revokeObjectURL(url);
  }, []);

  const revokeAllEvidenceObjectUrls = useCallback(() => {
    for (const url of evidenceObjectUrls.current) URL.revokeObjectURL(url);
    evidenceObjectUrls.current.clear();
  }, []);

  const clearProtectedInstallerState = useCallback(() => {
    revokeAllEvidenceObjectUrls();
    setInstallerPlanPreview(null);
    setInstallerPlanBusy("");
    setInstallerPlanErrors({});
    setVisibleEvidenceMatches({});
    setEvidencePhotoUrls({});
    setEvidencePhotoBusy("");
    setEvidencePhotoErrors({});
    setExpandedOpportunityMatchIds(new Set());
    setFocusedOpportunityMatchId("");
  }, [revokeAllEvidenceObjectUrls]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const returned = readIntegrationReturn(window.location.search);
      if (!returned) return;
      if (isCalendarIntegration(returned.provider)) {
        setWorkspace("schedule");
        return;
      }
      setWorkspace("work");
      setCommandTarget({ workspace: "work", kind: "crm-view", id: "integrations", query: "", nonce: Date.now() });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(
    () => () => revokeAllEvidenceObjectUrls(),
    [revokeAllEvidenceObjectUrls],
  );

  useEffect(
    () =>
      onAuthStateChanged(firebaseAuth, (nextUser) => {
        const nextUid = nextUser?.uid || null;
        if (protectedIdentityUid.current !== nextUid) {
          protectedIdentityUid.current = nextUid;
          protectedIdentityRevision.current += 1;
          clearProtectedInstallerState();
        }
        setUser(nextUser);
        setAuthReady(true);
        if (!nextUser) {
          setLoading(false);
          setOpportunities([]);
        }
      }),
    [clearProtectedInstallerState],
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
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
        if (!cancelled) {
          const nextProfile = result.profile as DashboardProfile | null;
          setProfile(nextProfile);
          if (nextProfile) {
            setAvailabilityStatus(
              ["open", "limited"].includes(nextProfile.availabilityStatus)
                ? nextProfile.availabilityStatus
                : "paused",
            );
            setEmailOpportunities(nextProfile.emailOpportunities !== false);
            setEmailWeeklySummary(nextProfile.emailWeeklySummary !== false);
            setServiceBasePostcode(
              nextProfile.serviceBasePostcode || nextProfile.postcode,
            );
            setServiceRadiusKm(Number(nextProfile.serviceRadiusKm || 50));
            if (nextProfile.partnerType === "supplier" || !nextProfile.entitlements?.features?.installer_leads) setOpportunities([]);
          }
        }
      } catch (loadError) {
        if (!cancelled)
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The dashboard could not be loaded.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || !profile || profile.partnerType === "supplier" || !profile.entitlements?.features?.installer_leads) return;
    const controller = new AbortController();
    let active = true;
    void user.getIdToken().then((token) => fetch("/api/trade-opportunities", {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
    })).then(async (response) => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Leads could not be loaded.");
      if (active) setOpportunities(result.opportunities || []);
    }).catch((loadError) => {
      if (active && !controller.signal.aborted) setOpportunityStatus(loadError instanceof Error ? loadError.message : "Leads could not be loaded.");
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
  const interestedCount = opportunities.filter(
    (item) => item.matchStatus === "interested",
  ).length;
  const visibleLeadOpportunities = useMemo(() => {
    const term = leadSearch.trim().toLowerCase();
    return opportunities
      .filter((item) => !leadStatusFilter || item.matchStatus === leadStatusFilter)
      .filter((item) => !leadStateFilter || item.state === leadStateFilter)
      .filter((item) => !leadServiceFilter || (item.matchedCategories.length ? item.matchedCategories : item.serviceCategories).includes(leadServiceFilter))
      .filter((item) => !term || `${item.title} ${item.summary} ${item.projectType} ${item.suburb} ${item.postcode} ${item.state} ${item.distanceBand}`.toLowerCase().includes(term));
  }, [leadSearch, leadServiceFilter, leadStateFilter, leadStatusFilter, opportunities]);

  const openOpportunityNotification = useCallback(async (matchId: string) => {
    setLeadSearch("");
    setLeadStatusFilter("");
    setLeadServiceFilter("");
    setLeadStateFilter("");
    setFocusedOpportunityMatchId(matchId);
    setExpandedOpportunityMatchIds((current) => {
      if (current.has(matchId)) return current;
      const next = new Set(current);
      next.add(matchId);
      return next;
    });
    setWorkspace("leads");
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
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/trade-opportunities?matchId=${encodeURIComponent(matchId)}`,
        {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        },
      );
      const result = await response.json().catch(() => ({}));
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
      setOpportunityNavigationStatus(
        openError instanceof Error
          ? openError.message
          : "The lead could not be refreshed.",
      );
    }
  }, [user]);

  useEffect(() => {
    if (!user || !initialOpportunityMatchId.current) return;
    const matchId = initialOpportunityMatchId.current;
    initialOpportunityMatchId.current = "";
    void openOpportunityNotification(matchId);
  }, [openOpportunityNotification, user]);

  useEffect(() => {
    if (workspace !== "leads" || !focusedOpportunityMatchId) return;
    if (!opportunities.some((item) => item.matchId === focusedOpportunityMatchId)) return;
    if (!expandedOpportunityMatchIds.has(focusedOpportunityMatchId)) {
      setExpandedOpportunityMatchIds((current) => {
        const next = new Set(current);
        next.add(focusedOpportunityMatchId);
        return next;
      });
      return;
    }
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
    expandedOpportunityMatchIds,
    focusedOpportunityMatchId,
    opportunities,
    workspace,
  ]);

  const toggleOpportunityExpanded = useCallback((matchId: string) => {
    setExpandedOpportunityMatchIds((current) => {
      const next = new Set(current);
      if (next.has(matchId)) {
        next.delete(matchId);
      } else {
        next.add(matchId);
      }
      return next;
    });
  }, []);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !profile) return;
    setSettingsBusy(true);
    setSettingsStatus("Saving dashboard preferences...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          availabilityStatus,
          serviceBasePostcode,
          serviceRadiusKm,
          emailOpportunities,
          emailWeeklySummary,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok)
        throw new Error(
          result.error || "The dashboard preferences could not be saved.",
        );
      setProfile({
        ...profile,
        availabilityStatus,
        serviceBasePostcode,
        serviceRadiusKm,
        emailOpportunities,
        emailWeeklySummary,
      });
      setSettingsStatus(
        "Preferences saved. Future allocation will use the service-base postcode, radius, verified capability and recent opportunity load.",
      );
    } catch (settingsError) {
      setSettingsStatus(
        settingsError instanceof Error
          ? settingsError.message
          : "The dashboard preferences could not be saved.",
      );
    } finally {
      setSettingsBusy(false);
    }
  }

  async function respondToOpportunity(
    matchId: string,
    status: "viewed" | "interested" | "declined",
  ) {
    if (!user) return;
    setOpportunityBusy(matchId);
    setOpportunityStatus(
      status === "interested"
        ? "Sending your expression of interest..."
        : "Updating the opportunity...",
    );
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-opportunities", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ matchId, status }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok)
        throw new Error(
          result.error || "The opportunity response could not be saved.",
        );
      setOpportunities((current) =>
        current.map((item) =>
          item.matchId === matchId
            ? {
                ...item,
                matchStatus: status,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      );
      setOpportunityStatus(
        status === "interested"
          ? "Interest recorded. You can now prepare a structured platform response when the project supports it."
          : status === "declined"
            ? "Opportunity declined. This will help improve future matching."
            : "Opportunity marked as reviewed.",
      );
    } catch (responseError) {
      setOpportunityStatus(
        responseError instanceof Error
          ? responseError.message
          : "The opportunity response could not be saved.",
      );
    } finally {
      setOpportunityBusy("");
    }
  }

  async function convertOpportunity(matchId: string) {
    if (!user) return;
    setOpportunityBusy(matchId);
    setOpportunityStatus("Creating the CRM job...");
    try {
      const token = await user.getIdToken();
      const workResponse = await fetch("/api/trade-work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: "create_work_order",
          sourceType: "opportunity",
          sourceReference: matchId,
        }),
      });
      const workResult = await workResponse.json().catch(() => ({}));
      if (!workResponse.ok || !workResult.ok) {
        throw new Error(workResult.error || "The marketplace opportunity could not be converted.");
      }
      setWorkspace("work");
      setOpportunityStatus(workResult.createdAppointmentId
        ? `${workResult.workNumber} is ready in Work and the customer-selected window is now an unassigned CRM appointment for dispatch review.`
        : `${workResult.workNumber} is ready in Work.`);
    } catch (conversionError) {
      setOpportunityStatus(
        conversionError instanceof Error
          ? conversionError.message
          : "The marketplace opportunity could not be converted.",
      );
    } finally {
      setOpportunityBusy("");
    }
  }

  async function toggleOpportunityPhotos(opportunity: DashboardOpportunity) {
    const activeUser = user;
    if (!activeUser || protectedIdentityUid.current !== activeUser.uid) return;
    const identityUid = activeUser.uid;
    const identityRevision = protectedIdentityRevision.current;
    const identityIsCurrent = () =>
      protectedIdentityUid.current === identityUid &&
      protectedIdentityRevision.current === identityRevision;
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

    setEvidencePhotoBusy(opportunity.matchId);
    setEvidencePhotoErrors((current) => ({
      ...current,
      [opportunity.matchId]: "",
    }));
    const createdUrls: string[] = [];
    try {
      const token = await activeUser.getIdToken();
      const nextUrls: Record<string, string> = { ...(existing || {}) };
      const missingPhotos = photos.filter((item) => !nextUrls[item.id]);
      const results = await Promise.allSettled(missingPhotos.map(async (item) => {
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
            result.error || "The shared photo could not be opened.",
          );
        }
        const url = URL.createObjectURL(await response.blob());
        evidenceObjectUrls.current.add(url);
        return { id: item.id, url };
      }));
      let failed = 0;
      for (const result of results) {
        if (result.status === "rejected") {
          failed += 1;
          continue;
        }
        createdUrls.push(result.value.url);
        nextUrls[result.value.id] = result.value.url;
      }
      if (!identityIsCurrent()) {
        for (const url of createdUrls) revokeEvidenceObjectUrl(url);
        return;
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
      if (!identityIsCurrent()) return;
      setEvidencePhotoErrors((current) => ({
        ...current,
        [opportunity.matchId]: previewError instanceof Error
          ? previewError.message
          : "The shared photos could not be opened.",
      }));
    } finally {
      if (identityIsCurrent()) setEvidencePhotoBusy("");
    }
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
        downloadCustomerPlanPdf(report);
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
      const response = await fetch(`/api/customer-project-evidence?download=${encodeURIComponent(item.id)}`, {
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
        <div className={`trade-portal-shell ${isSupplier ? "is-supplier" : "is-installer"}`}>
          <header className="dashboard-hero">
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
            <div className="dashboard-account-actions">
              <span className="trade-portal-role">{isSupplier ? "Wholesaler" : "Installer"}</span>
              <div>
                <small>Business account</small>
                <strong title={user.email || ""}>{profile.businessName}</strong>
              </div>
              <a href="/direct-trade/partners">Profile</a>
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
              {workspace === "account" && <TradeAccessPanel profile={profile} />}
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
              {workspace === "account" && <section className="dashboard-panel dashboard-account-home"><div className="dashboard-panel-heading"><span>Business account</span><h2>Profile and verification</h2><p>Core trade operations cost A$0 after verification.</p></div><div className="dashboard-account-links"><a href="/direct-trade/partners"><strong>Edit business profile</strong><span>Contact, service areas and capabilities</span></a><a href="/direct-trade/dashboard/verification"><strong>Verification centre</strong><span>Evidence, licences and review status</span></a></div></section>}
            </>
          ) : (
            <>
              <nav
                className="dashboard-workspace-nav"
                aria-label="TLink installer account"
              >
                <button type="button" className={workspace === "work" ? "active" : ""} onClick={() => {
                  setCommandTarget({ workspace: "work", kind: "crm-view", id: "today", query: "", nonce: Date.now() });
                  setWorkspace("work");
                }}><b aria-hidden="true">01</b><span>Work</span><small>Today and next actions</small></button>
                <div className="dashboard-workspace-shortcuts" aria-label="Work shortcuts">
                  {([['jobs', 'Jobs'], ['customers', 'Customers'], ['pricebook', 'Price book']] as const).map(([view, label]) => <button type="button" key={view} onClick={() => {
                    setCommandTarget({ workspace: "work", kind: "crm-view", id: view, query: "", nonce: Date.now() });
                    setWorkspace("work");
                  }}><span>{label}</span></button>)}
                </div>
                <button type="button" className={workspace === "schedule" ? "active" : ""} onClick={() => { setScheduleWeekStart(""); setWorkspace("schedule"); }}><b aria-hidden="true">02</b><span>Schedule</span><small>Capacity and dispatch</small></button>
                <button type="button" className={workspace === "invoices" ? "active" : ""} onClick={() => setWorkspace("invoices")}><b aria-hidden="true">03</b><span>Invoices</span><small>Prepare drafts and get paid</small></button>
                <button type="button" className={workspace === "follow-ups" ? "active" : ""} onClick={() => setWorkspace("follow-ups")}><b aria-hidden="true">04</b><span>Follow-ups</span><small>Consent-aware service preparation</small></button>
                <button type="button" className={workspace === "leads" ? "active" : ""} onClick={() => setWorkspace("leads")}><b aria-hidden="true">05</b><span>Leads{offeredCount ? ` (${offeredCount})` : ""}</span><small>AEA protected opportunities</small></button>
                <button type="button" className={workspace === "products" ? "active" : ""} onClick={() => setWorkspace("products")}><b aria-hidden="true">06</b><span>Products</span><small>Approved trade catalogue</small></button>
                <button type="button" className={workspace === "account" ? "active" : ""} onClick={() => setWorkspace("account")}><b aria-hidden="true">07</b><span>Business</span><small>Settings and verification</small></button>
                <div className="dashboard-rail-note"><strong>Privacy boundary</strong><p>AEA leads remain protected. Customer contact details only belong here when the customer contacted your business directly.</p></div>
              </nav>

              {workspace === "account" && <TradeAccessPanel profile={profile} />}

              {workspace === "work" && <TradeBusinessHub
                user={user}
                partnerType="installer"
                fullAccess={hasBusinessOperations}
                teamAccess={hasTeamAccess}
                navigationTarget={commandTarget}
                onOpenSchedule={(weekStart) => { setScheduleWeekStart(weekStart || ""); setWorkspace("schedule"); }}
                onOpenInvoices={() => setWorkspace("invoices")}
              />}

              {workspace === "schedule" && (hasBusinessOperations && hasTeamAccess ? <TradeScheduleWorkspace user={user} initialWeekStart={scheduleWeekStart} onOpenJob={(workOrderId) => {
                setCommandTarget({ workspace: "work", kind: "job", id: workOrderId, query: "", jobTab: "summary", nonce: Date.now() });
                setWorkspace("work");
              }} /> : <section className="dashboard-panel dashboard-upgrade-callout"><strong>Verification required</strong><p>The administrator account record must be active and approved before team scheduling is available.</p><a href="/direct-trade/dashboard/verification">Open verification centre</a></section>)}

              {workspace === "invoices" && (hasBusinessOperations ? <TradeInvoiceWorkspace user={user} onOpenJob={(workOrderId) => {
                setCommandTarget({ workspace: "work", kind: "job", id: workOrderId, query: "", jobTab: "invoice", nonce: Date.now() });
                setWorkspace("work");
              }} /> : <section className="dashboard-panel dashboard-upgrade-callout"><strong>Verification required</strong><p>The administrator account record must be active and approved before invoicing is available.</p><a href="/direct-trade/dashboard/verification">Open verification centre</a></section>)}

              {workspace === "follow-ups" && (hasBusinessOperations && hasTeamAccess ? <TradeServiceFollowUpWorkspace user={user} /> : <section className="dashboard-panel dashboard-upgrade-callout"><strong>Verification required</strong><p>The administrator account record must be active and approved before service follow-up preparation is available.</p><a href="/direct-trade/dashboard/verification">Open verification centre</a></section>)}

              {workspace === "account" && <section
                className="dashboard-status-grid"
                aria-label="Account status"
              >
                <article>
                  <span>Profile</span>
                  <strong>Business details saved</strong>
                  <small>
                    {profile.addressState} {profile.postcode}
                  </small>
                </article>
                <article>
                  <span>Verification</span>
                  <strong>
                    {profile.verificationStatus === "approved"
                      ? "Approved"
                      : profile.verificationStatus === "under_review"
                        ? "Under review"
                        : profile.verificationStatus === "needs_information"
                          ? "More information needed"
                          : "Not started"}
                  </strong>
                  <small>
                    <a href="/direct-trade/dashboard/verification">
                      Review the evidence pathway
                    </a>
                  </small>
                </article>
                <article>
                  <span>Opportunity inbox</span>
                  <strong>
                    {!hasLeadAccess
                      ? "Verification required"
                      : offeredCount
                      ? `${offeredCount} awaiting response`
                      : "Nothing awaiting response"}
                  </strong>
                  <small>
                    {!hasLeadAccess
                      ? "No leads can be allocated until verification is approved."
                      : interestedCount
                      ? `${interestedCount} expression${interestedCount === 1 ? "" : "s"} of interest active`
                      : "Matching follows coverage and capability."}
                  </small>
                </article>
                <article>
                  <span>Availability</span>
                  <strong>
                    {availabilityStatus === "open"
                      ? "Open to suitable work"
                      : availabilityStatus === "limited"
                        ? "Limited capacity"
                        : "Paused"}
                  </strong>
                  <small>No per-lead purchase or bidding is required.</small>
                </article>
              </section>}

              {workspace === "leads" && <div className="dashboard-main-grid">
                <section
                  id="opportunity-inbox"
                  className="dashboard-panel dashboard-opportunities"
                  aria-labelledby="dashboard-opportunities-title"
                >
                  <div className="dashboard-panel-heading">
                    <span>Opportunity inbox</span>
                    <h2 id="dashboard-opportunities-title">
                      Privacy-safe scopes matched to this business
                    </h2>
                    <p>
                      At most six eligible installers ever see a scope.
                      Household identity, street and unit address, and contact
                      details stay outside the trade workspace during matching. A
                      customer can later release them to this exact business
                      after choosing to get in touch.
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
                            {["offered", "viewed", "interested", "declined", "connected", "closed"].map((value) => <option key={value} value={value}>{value === "offered" ? "New" : value.replaceAll("_", " ")}</option>)}
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
                      {visibleLeadOpportunities.length ? <div className="dashboard-opportunity-list">
                      {visibleLeadOpportunities.map((opportunity) => {
                        const isExpanded = expandedOpportunityMatchIds.has(
                          opportunity.matchId,
                        );
                        const releasedCustomerContact =
                          opportunity.matchStatus === "connected"
                            ? opportunity.customerContact
                            : null;
                        const detailId = `opportunity-details-${opportunity.matchId}`;
                        const toggleId = `opportunity-toggle-${opportunity.matchId}`;
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
                          className={`dashboard-opportunity-card status-${opportunity.matchStatus}${isExpanded ? " expanded" : " collapsed"}${focusedOpportunityMatchId === opportunity.matchId ? " notification-target" : ""}`}
                        >
                          <header>
                            <div className="dashboard-opportunity-heading">
                              <span>
                                {opportunityBroadLocation(opportunity)} | {opportunity.distanceBand}
                              </span>
                              <h3>
                                {releasedCustomerContact
                                  ? releasedCustomerContact.name
                                  : opportunity.title}
                              </h3>
                              {releasedCustomerContact && (
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
                              <button
                                id={toggleId}
                                type="button"
                                aria-expanded={isExpanded}
                                aria-controls={
                                  releasedCustomerContact
                                    ? `${customerIdentityId} ${detailId}`
                                    : detailId
                                }
                                onClick={() =>
                                  toggleOpportunityExpanded(opportunity.matchId)
                                }
                              >
                                {isExpanded ? "Collapse lead" : "Expand lead"}
                              </button>
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
                                      {releasedCustomerContact.name}
                                    </h4>
                                    <p>
                                      Contact details were released to this exact
                                      installer match on{" "}
                                      {new Date(
                                        releasedCustomerContact.grantedAt,
                                      ).toLocaleString("en-AU")}
                                      .
                                    </p>
                                  </div>
                                  <dl
                                    className="dashboard-connected-customer-contact-grid"
                                    aria-label={`Contact details for ${releasedCustomerContact.name}`}
                                  >
                                    <div>
                                      <dt>Phone</dt>
                                      <dd>
                                        <a href={`tel:${releasedCustomerContact.phone}`}>
                                          {releasedCustomerContact.phone}
                                        </a>
                                      </dd>
                                    </div>
                                    <div>
                                      <dt>Email</dt>
                                      <dd>
                                        <a href={`mailto:${releasedCustomerContact.email}`}>
                                          {releasedCustomerContact.email}
                                        </a>
                                      </dd>
                                    </div>
                                    <div>
                                      <dt>Service address</dt>
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
                            aria-labelledby={toggleId}
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
                              onDownload={(item) => void downloadOpportunityEvidence(item)}
                              onOpenPlan={() => void openInstallerPlan(opportunity)}
                              onDownloadPlan={() => void downloadInstallerPlan(opportunity)}
                            />
                          )}
                          {opportunity.platformOnly && !opportunity.enquiryPack && Object.keys(opportunity.propertyContext || {}).length > 0 && <dl className="dashboard-property-context"><div><dt>Storeys</dt><dd>{String(opportunity.propertyContext.storeys || "not confirmed").replaceAll("_", " ")}</dd></div><div><dt>Home age</dt><dd>{String(opportunity.propertyContext.ageBand || "not confirmed").replaceAll("_", " ")}</dd></div><div><dt>Floor area</dt><dd>{String(opportunity.propertyContext.floorArea || "not confirmed").replaceAll("_", " ")}</dd></div><div><dt>Roof</dt><dd>{String(opportunity.propertyContext.roofType || "not confirmed").replaceAll("_", " ")}</dd></div><div><dt>Switchboard</dt><dd>{String(opportunity.propertyContext.switchboard || "not confirmed").replaceAll("_", " ")}</dd></div><div><dt>Approval context</dt><dd>{String(opportunity.propertyContext.approvalContext || "none noted").replaceAll("_", " ")}</dd></div><div><dt>Site considerations</dt><dd>{Array.isArray(opportunity.propertyContext.accessConstraints) && opportunity.propertyContext.accessConstraints.length > 0 ? opportunity.propertyContext.accessConstraints.map((item) => String(item).replaceAll("_", " ")).join(", ") : "none noted"}</dd></div></dl>}
                          <div className="dashboard-opportunity-tags">
                            <span>
                              Allocation {opportunity.allocationRank} of 6
                              maximum
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
                          {releasedCustomerContact ? null : opportunity.matchStatus === "connected" ? (
                            <div className="dashboard-contact-allowance">
                              <div>
                                <strong>Platform coordination active</strong>
                                <span>
                                  The household progressed this option, but no active contact release is available. Keep coordination inside the platform.
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="dashboard-opportunity-actions">
                              <button
                                type="button"
                                className="primary"
                                disabled={
                                  opportunityBusy === opportunity.matchId ||
                                  opportunity.matchStatus === "interested"
                                }
                                onClick={() =>
                                  void respondToOpportunity(
                                    opportunity.matchId,
                                    "interested",
                                  )
                                }
                              >
                                {opportunity.matchStatus === "interested"
                                  ? "Interest recorded"
                                  : "I’m interested"}
                              </button>
                              <button
                                type="button"
                                disabled={
                                  opportunityBusy === opportunity.matchId ||
                                  opportunity.matchStatus === "declined"
                                }
                                onClick={() =>
                                  void respondToOpportunity(
                                    opportunity.matchId,
                                    "declined",
                                  )
                                }
                              >
                                {opportunity.matchStatus === "declined"
                                  ? "Declined"
                                  : "Not suitable"}
                              </button>
                              {opportunity.matchStatus === "offered" && (
                                <button
                                  type="button"
                                  disabled={
                                    opportunityBusy === opportunity.matchId
                                  }
                                  onClick={() =>
                                    void respondToOpportunity(
                                      opportunity.matchId,
                                      "viewed",
                                    )
                                  }
                                >
                                  Save for review
                                </button>
                              )}
                            </div>
                          )}
                          {opportunity.platformOnly && ["interested", "connected"].includes(opportunity.matchStatus) && <InstallerPlatformQuote matchId={opportunity.matchId} initialQuote={opportunity.quote} onStatus={setOpportunityStatus} />}
                          {!opportunity.platformOnly && ["interested", "connected"].includes(opportunity.matchStatus) && (
                            <section className="dashboard-opportunity-conversion" aria-label="Opportunity workflow actions">
                              <div>
                                <strong>Move this scope into your trade workflow</strong>
                                <span>The CRM keeps the opportunity reference, service region and protected privacy boundary.</span>
                              </div>
                              <button type="button" disabled={opportunityBusy === opportunity.matchId} onClick={() => void convertOpportunity(opportunity.matchId)}>Create job</button>
                            </section>
                          )}
                          {opportunity.platformOnly && opportunity.quote?.customerDecision === "accepted" && <>
                            <InstallerArrivalWindows matchId={opportunity.matchId} initialProposal={opportunity.arrivalProposal} onStatus={setOpportunityStatus} />
                            <section className="dashboard-opportunity-conversion" aria-label="Customer contact workflow action"><div><strong>Create the CRM job when you are ready to arrange the work</strong><span>If the customer selected an arrival window, use it when creating the appointment in Work. The proposal itself does not create an appointment.</span></div><button type="button" disabled={opportunityBusy === opportunity.matchId} onClick={() => void convertOpportunity(opportunity.matchId)}>Create job</button></section>
                          </>}
                          {opportunity.platformOnly && opportunity.matchStatus === "connected" && !releasedCustomerContact && opportunity.quote?.customerDecision !== "accepted" && <div className="dashboard-contact-allowance"><div><strong>Waiting for the customer to choose a business</strong><span>Contact details remain protected until the customer chooses to get in touch with this business.</span></div></div>}
                              </>
                            )}
                          </div>
                        </article>
                        );
                      })}
                    </div> : <div className="dashboard-empty-state"><strong>No leads match these filters</strong><p>Clear one or more filters to return to the full opportunity inbox.</p></div>}
                    </>
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
                        {serviceBasePostcode} · {serviceRadiusKm} km radius ·{" "}
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

                <aside
                  className="dashboard-panel dashboard-readiness"
                  aria-labelledby="dashboard-readiness-title"
                >
                  <div className="dashboard-panel-heading">
                    <span>Account readiness</span>
                    <h2 id="dashboard-readiness-title">Next steps</h2>
                  </div>
                  <ol>
                    <li className="complete">
                      <strong>Business profile</strong>
                      <small>Address, coverage and capabilities saved</small>
                    </li>
                    <li>
                      <strong>
                        {isSupplier
                          ? "Product and warranty evidence"
                          : "Licence and insurance review"}
                      </strong>
                      <small>Review the secure verification pathway</small>
                    </li>
                    <li>
                      <strong>
                        {profile.entitlements.verified
                          ? "Trade workspace active"
                          : "Verification required"}
                      </strong>
                      <small>
                        {profile.entitlements.verified
                          ? "Core trade operations are available at A$0"
                          : "Approval is required before protected tools open"}
                      </small>
                    </li>
                    <li
                      className={
                        availabilityStatus === "paused" ? "" : "complete"
                      }
                    >
                      <strong>Set availability</strong>
                      <small>
                        {availabilityStatus === "paused"
                          ? "Choose a capacity preference below"
                          : "Capacity preference saved"}
                      </small>
                    </li>
                  </ol>
                </aside>
              </div>}

              {workspace === "account" && <section
                className="dashboard-panel dashboard-activity"
                aria-labelledby="dashboard-activity-title"
              >
                <div className="dashboard-panel-heading">
                  <span>Account activity</span>
                  <h2 id="dashboard-activity-title">
                    A clear record of what is moving
                  </h2>
                  <p>
                    Opportunity responses and readiness changes remain visible
                    so the business can follow its own progress.
                  </p>
                </div>
                <div className="dashboard-activity-grid">
                  <article>
                    <strong>Business profile ready</strong>
                    <span>
                      {profile.addressState} {profile.postcode} ·{" "}
                      {profile.serviceStates.length} service area
                      {profile.serviceStates.length === 1 ? "" : "s"}
                    </span>
                  </article>
                  <article>
                    <strong>
                      Verification{" "}
                      {profile.verificationStatus.replaceAll("_", " ")}
                    </strong>
                    <span>
                      {profile.verificationStatus === "approved"
                        ? "Evidence review completed"
                        : "Open the verification centre to review the next requirement"}
                    </span>
                  </article>
                  {opportunities.slice(0, 4).map((item) => (
                    <article key={item.matchId}>
                      <strong>{item.title}</strong>
                      <span>
                        {item.matchStatus.replaceAll("_", " ")} · updated{" "}
                        {new Date(item.updatedAt).toLocaleDateString("en-AU")}
                      </span>
                    </article>
                  ))}
                  {!opportunities.length && (
                    <article>
                      <strong>
                        {hasLeadAccess
                          ? "Opportunity matching ready"
                          : "Opportunity matching locked"}
                      </strong>
                      <span>
                        {hasLeadAccess
                          ? "No assignments have been made to this account yet."
                          : "Accounts awaiting approval are excluded from lead allocation."}
                      </span>
                    </article>
                  )}
                </div>
              </section>}

              {workspace === "account" && <section
                className="dashboard-panel dashboard-settings"
                aria-labelledby="dashboard-settings-title"
              >
                <div className="dashboard-panel-heading">
                  <span>Matching preferences</span>
                  <h2 id="dashboard-settings-title">
                    Set serviceability, capacity and account emails
                  </h2>
                  <p>
                    Distance uses postcode centroids rather than a precise
                    street location. The 10 km proximity band and recent
                    allocation load help nearby installers receive a fairer
                    share.
                  </p>
                </div>
                <form onSubmit={saveSettings}>
                  <fieldset>
                    <legend>Serviceability from the business base</legend>
                    <div className="dashboard-serviceability-fields">
                      <label>
                        <span>Service-base postcode</span>
                        <input
                          required
                          inputMode="numeric"
                          maxLength={4}
                          value={serviceBasePostcode}
                          onChange={(event) =>
                            setServiceBasePostcode(
                              event.target.value.replace(/\D/g, "").slice(0, 4),
                            )
                          }
                        />
                      </label>
                      <label>
                        <span>Maximum travel radius</span>
                        <div>
                          <input
                            type="range"
                            min="10"
                            max="1000"
                            step="10"
                            value={serviceRadiusKm}
                            onChange={(event) =>
                              setServiceRadiusKm(Number(event.target.value))
                            }
                          />
                          <strong>{serviceRadiusKm} km</strong>
                        </div>
                      </label>
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend>Current availability</legend>
                    <div className="dashboard-choice-grid">
                      <label
                        className={
                          availabilityStatus === "open" ? "selected" : ""
                        }
                      >
                        <input
                          type="radio"
                          name="availability"
                          value="open"
                          checked={availabilityStatus === "open"}
                          onChange={() => setAvailabilityStatus("open")}
                        />
                        <span>
                          <strong>Open to suitable work</strong>
                          <small>
                            Include the business in verified matching.
                          </small>
                        </span>
                      </label>
                      <label
                        className={
                          availabilityStatus === "limited" ? "selected" : ""
                        }
                      >
                        <input
                          type="radio"
                          name="availability"
                          value="limited"
                          checked={availabilityStatus === "limited"}
                          onChange={() => setAvailabilityStatus("limited")}
                        />
                        <span>
                          <strong>Limited capacity</strong>
                          <small>
                            Stay eligible with a fair-allocation capacity
                            adjustment.
                          </small>
                        </span>
                      </label>
                      <label
                        className={
                          availabilityStatus === "paused" ? "selected" : ""
                        }
                      >
                        <input
                          type="radio"
                          name="availability"
                          value="paused"
                          checked={availabilityStatus === "paused"}
                          onChange={() => setAvailabilityStatus("paused")}
                        />
                        <span>
                          <strong>Paused</strong>
                          <small>
                            Do not include the business in matching.
                          </small>
                        </span>
                      </label>
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend>Email preferences</legend>
                    <div className="dashboard-notification-list">
                      <label>
                        <input
                          type="checkbox"
                          checked={emailOpportunities}
                          onChange={(event) =>
                            setEmailOpportunities(event.target.checked)
                          }
                        />
                        <span>
                          <strong>Opportunity and customer response emails</strong>
                          <small>
                            Email the account contact when a reviewed
                            opportunity is assigned or a customer accepts a quote.
                          </small>
                        </span>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={emailWeeklySummary}
                          onChange={(event) =>
                            setEmailWeeklySummary(event.target.checked)
                          }
                        />
                        <span>
                          <strong>Weekly account summary</strong>
                          <small>
                            Receive one concise update covering readiness and
                            account activity.
                          </small>
                        </span>
                      </label>
                    </div>
                  </fieldset>
                  <button className="btn" disabled={settingsBusy}>
                    {settingsBusy ? "Saving..." : "Save dashboard preferences"}
                  </button>
                  {settingsStatus && (
                    <p className="dashboard-settings-status" role="status">
                      {settingsStatus}
                    </p>
                  )}
                </form>
              </section>}

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
