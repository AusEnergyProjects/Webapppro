"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { SiteFooter } from "./ComparatorChrome";
import { SupplierCatalogueWorkspace } from "./SupplierCatalogueWorkspace";
import { InstallerProductMarketplace } from "./InstallerProductMarketplace";
import { InstallerPlatformQuote } from "./InstallerPlatformQuote";
import { InstallerArrivalWindows } from "./InstallerArrivalWindows";
import { TradeBusinessHub } from "./TradeBusinessHub";
import { TradePurchasingWorkspace } from "./TradePurchasingWorkspace";
import { TradeDataImportWorkspace } from "./TradeDataImportWorkspace";
import { TradeScheduleWorkspace } from "./TradeScheduleWorkspace";
import { TradeInvoiceWorkspace } from "./TradeInvoiceWorkspace";
import { TradeServiceFollowUpWorkspace } from "./TradeServiceFollowUpWorkspace";
import { TLinkBrand, TLinkHeader } from "./TLinkChrome";
import { TLinkCommandCentre, type TLinkCommandTarget } from "./TLinkCommandCentre";
import { TradeJobNotifications } from "./TradeJobNotifications";
import {
  FEATURE_DEFINITIONS,
  type FeatureGrant,
  type FeatureKey,
} from "@/lib/direct-trade-entitlements";

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
  planKey: string;
  billingStatus: string;
  availabilityStatus: "open" | "limited" | "paused";
  serviceBasePostcode: string;
  serviceRadiusKm: number;
  emailOpportunities: boolean;
  emailWeeklySummary: boolean;
  featureGrants: FeatureGrant[];
  entitlements: {
    paidMembership: boolean;
    verified: boolean;
    accessLabel: string;
    features: Record<FeatureKey, boolean>;
    activeGrants: FeatureKey[];
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

const capabilityLabels: Record<string, string> = {
  assessment: "Energy assessment",
  solar: "Rooftop solar",
  battery: "Home batteries",
  "heating-cooling": "Heating and cooling",
  "hot-water": "Hot water",
  "insulation-draughts": "Insulation and draught control",
  "ev-charging": "EV charging",
  electrical: "Electrical services",
  plumbing: "Plumbing services",
  "mounting-hardware": "Mounting and hardware",
  controls: "Energy controls",
  other: "Other energy upgrades",
};

const verifiedTradeFeatures = [
  "Leads and privacy-safe marketplace opportunities",
  "CRM, quotes, scheduling and customer handover",
  "Team, field work, forms and purchasing",
  "Catalogue, product selection and guided imports",
];

function PlanAccessPanel({ profile }: { profile: DashboardProfile }) {
  const role = profile.partnerType;
  const available = FEATURE_DEFINITIONS.filter((feature) =>
    feature.roles.includes(role),
  );
  return (
    <section className="dashboard-plan-access" aria-labelledby="plan-access-title">
      <div className="dashboard-plan-summary">
        <div>
          <span>Current access</span>
          <h2 id="plan-access-title">{profile.entitlements.accessLabel}</h2>
          <p>
            Core trade operations cost A$0. Verification, licensing, insurance
            and role permissions remain mandatory safety controls.
          </p>
        </div>
        <a href="/direct-trade/dashboard/verification">Open verification centre</a>
      </div>
      <div className="dashboard-tier-grid">
        <article>
          <span>Before approval</span>
          <h3>Set up and verify</h3>
          <ul><li>Complete the business profile</li><li>Set service areas and capabilities</li><li>Provide the required verification evidence</li></ul>
          <strong>No card or subscription is required.</strong>
        </article>
        <article className="paid">
          <span>After approval</span>
          <h3>Verified trade workspace</h3>
          <ul>{verifiedTradeFeatures.map((item) => <li key={item}>{item}</li>)}</ul>
          <strong>Unlimited users, leads, jobs and quotes remain A$0.</strong>
        </article>
        <article>
          <span>Permission controlled</span>
          <h3>Specialist controls</h3>
          <ul>
            {available.filter((feature) => feature.tier === "admin").map((feature) => (
              <li key={feature.key} className={profile.entitlements.features[feature.key] ? "enabled" : "locked"}>
                {feature.label}
              </li>
            ))}
          </ul>
          <strong>Administrator grants never change marketplace ranking or lead priority.</strong>
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
  const [leadSearch, setLeadSearch] = useState("");
  const [leadStatusFilter, setLeadStatusFilter] = useState("");
  const [leadServiceFilter, setLeadServiceFilter] = useState("");
  const [leadStateFilter, setLeadStateFilter] = useState("");
  const [workspace, setWorkspace] = useState<DashboardWorkspace>(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("workspace") === "schedule" ? "schedule" : "work");
  const [commandTarget, setCommandTarget] = useState<TLinkCommandTarget | null>(null);

  useEffect(
    () =>
      onAuthStateChanged(firebaseAuth, (nextUser) => {
        setUser(nextUser);
        setAuthReady(true);
        if (!nextUser) {
          setLoading(false);
          setOpportunities([]);
        }
      }),
    [],
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
            if (
              nextProfile.partnerType !== "supplier" &&
              nextProfile.entitlements?.features?.installer_leads
            ) {
              const opportunityResponse = await fetch(
                "/api/trade-opportunities",
                {
                  headers: { Authorization: `Bearer ${token}` },
                  cache: "no-store",
                },
              );
              const opportunityResult = await opportunityResponse
                .json()
                .catch(() => ({}));
              if (opportunityResponse.ok && !cancelled)
                setOpportunities(opportunityResult.opportunities || []);
            } else if (!cancelled) setOpportunities([]);
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
      .filter((item) => !term || `${item.title} ${item.summary} ${item.projectType} ${item.distanceBand}`.toLowerCase().includes(term));
  }, [leadSearch, leadServiceFilter, leadStateFilter, leadStatusFilter, opportunities]);

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

  async function downloadOpportunityEvidence(item: DashboardOpportunity["evidence"][number]) {
    if (!user) return;
    setOpportunityBusy(item.id); setOpportunityStatus("Preparing protected customer evidence...");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/customer-project-evidence?download=${encodeURIComponent(item.id)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || "The project file could not be downloaded."); }
      const url = URL.createObjectURL(await response.blob()); const anchor = window.document.createElement("a");
      anchor.href = url; anchor.download = item.fileName; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setOpportunityStatus("Protected project file download started and access was audited.");
    } catch (error) { setOpportunityStatus(error instanceof Error ? error.message : "The project file could not be downloaded."); }
    finally { setOpportunityBusy(""); }
  }

  return (
    <main className="wrap direct-trade-dashboard-page">
      <TLinkHeader active="dashboard" />
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
      ) : (
        <div className={`trade-portal-shell ${isSupplier ? "is-supplier" : "is-installer"}`}>
          <header className="dashboard-hero">
            <div className="trade-portal-brand">
              <TLinkBrand context={isSupplier ? "Wholesaler control centre" : "Installer control centre"} />
            </div>
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
            }} />}
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
              {workspace === "account" && <PlanAccessPanel profile={profile} />}
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
                hasAnalytics={Boolean(profile.entitlements.features.advanced_analytics)}
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
                <button type="button" className={workspace === "work" ? "active" : ""} onClick={() => setWorkspace("work")}><b aria-hidden="true">01</b><span>Work</span><small>Today, jobs and customers</small></button>
                <button type="button" className={workspace === "schedule" ? "active" : ""} onClick={() => setWorkspace("schedule")}><b aria-hidden="true">02</b><span>Schedule</span><small>Capacity and dispatch</small></button>
                <button type="button" className={workspace === "invoices" ? "active" : ""} onClick={() => setWorkspace("invoices")}><b aria-hidden="true">03</b><span>Invoices</span><small>Prepare drafts and get paid</small></button>
                <button type="button" className={workspace === "follow-ups" ? "active" : ""} onClick={() => setWorkspace("follow-ups")}><b aria-hidden="true">04</b><span>Follow-ups</span><small>Consent-aware service preparation</small></button>
                <button type="button" className={workspace === "leads" ? "active" : ""} onClick={() => setWorkspace("leads")}><b aria-hidden="true">05</b><span>Leads{offeredCount ? ` (${offeredCount})` : ""}</span><small>AEA protected opportunities</small></button>
                <button type="button" className={workspace === "products" ? "active" : ""} onClick={() => setWorkspace("products")}><b aria-hidden="true">06</b><span>Products</span><small>Approved trade catalogue</small></button>
                <button type="button" className={workspace === "account" ? "active" : ""} onClick={() => setWorkspace("account")}><b aria-hidden="true">07</b><span>Business</span><small>Settings and verification</small></button>
                <div className="dashboard-rail-note"><strong>Privacy boundary</strong><p>AEA leads remain protected. Customer contact details only belong here when the customer contacted your business directly.</p></div>
              </nav>

              {workspace === "account" && <PlanAccessPanel profile={profile} />}

              {workspace === "work" && <TradeBusinessHub
                user={user}
                partnerType="installer"
                fullAccess={hasBusinessOperations}
                teamAccess={hasTeamAccess}
                navigationTarget={commandTarget}
              />}

              {workspace === "schedule" && (hasBusinessOperations && hasTeamAccess ? <TradeScheduleWorkspace user={user} onOpenJob={(workOrderId) => {
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
                      Household identity, exact location and contact details
                      stay outside the trade workspace during matching. A
                      customer can later release them to this exact business
                      after shortlisting its option.
                    </p>
                  </div>
                  {!hasLeadAccess ? (
                    <div className="dashboard-paywall-state">
                      <span>Verification required</span>
                      <h3>Opportunity delivery is switched off</h3>
                      <p>
                        Complete business verification to enter automatic and manual
                        opportunity allocation. No card or subscription is required.
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
                      {visibleLeadOpportunities.map((opportunity) => (
                        <article
                          key={opportunity.matchId}
                          className={`dashboard-opportunity-card status-${opportunity.matchStatus}`}
                        >
                          <header>
                            <div>
                              <span>
                                {opportunity.state} region | {opportunity.distanceBand}
                              </span>
                              <h3>{opportunity.title}</h3>
                            </div>
                            <strong>
                              {opportunity.matchStatus === "offered"
                                ? "New"
                                : opportunity.matchStatus.replaceAll("_", " ")}
                            </strong>
                          </header>
                          <p>{opportunity.summary}</p>
                          {opportunity.platformOnly && Object.keys(opportunity.propertyContext || {}).length > 0 && <dl className="dashboard-property-context"><div><dt>Storeys</dt><dd>{String(opportunity.propertyContext.storeys || "not confirmed").replaceAll("_", " ")}</dd></div><div><dt>Home age</dt><dd>{String(opportunity.propertyContext.ageBand || "not confirmed").replaceAll("_", " ")}</dd></div><div><dt>Floor area</dt><dd>{String(opportunity.propertyContext.floorArea || "not confirmed").replaceAll("_", " ")}</dd></div><div><dt>Roof</dt><dd>{String(opportunity.propertyContext.roofType || "not confirmed").replaceAll("_", " ")}</dd></div><div><dt>Switchboard</dt><dd>{String(opportunity.propertyContext.switchboard || "not confirmed").replaceAll("_", " ")}</dd></div><div><dt>Access timing</dt><dd>{String(opportunity.propertyContext.occupancy || "not confirmed").replaceAll("_", " ")}</dd></div></dl>}
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
                          {opportunity.customerContact ? (
                            <div className="dashboard-contact-allowance released">
                              <div>
                                <strong>Customer-authorised contact</strong>
                                <span>
                                  Released to this exact installer match on {new Date(opportunity.customerContact.grantedAt).toLocaleString("en-AU")}.
                                </span>
                              </div>
                              <dl>
                                <div><dt>Customer</dt><dd>{opportunity.customerContact.name}</dd></div>
                                <div><dt>Phone</dt><dd><a href={`tel:${opportunity.customerContact.phone}`}>{opportunity.customerContact.phone}</a></dd></div>
                                <div><dt>Email</dt><dd><a href={`mailto:${opportunity.customerContact.email}`}>{opportunity.customerContact.email}</a></dd></div>
                                <div><dt>Service address</dt><dd>{[opportunity.customerContact.addressLine1, opportunity.customerContact.addressLine2, opportunity.customerContact.suburb, opportunity.customerContact.addressState, opportunity.customerContact.postcode].filter(Boolean).join(", ")}</dd></div>
                              </dl>
                            </div>
                          ) : opportunity.matchStatus === "connected" ? (
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
                          {opportunity.platformOnly && opportunity.evidence.length > 0 && <section className="dashboard-customer-evidence" aria-label="Customer project evidence"><header><div><strong>Customer property evidence</strong><span>All customer-uploaded photos and documents are shared with every verified installer allocated to this enquiry for quoting guidance.</span></div><b>{opportunity.evidence.length}</b></header><div>{opportunity.evidence.map((item) => <article key={item.id}><div><span>{item.contentType === "application/pdf" ? "Project document" : "Quoting photo"}</span><strong>{item.category.replaceAll("-", " ")}</strong><small>{Math.max(1, Math.round(item.sizeBytes / 1024))} KB</small></div><button type="button" disabled={opportunityBusy === item.id} onClick={() => void downloadOpportunityEvidence(item)}>Protected download</button></article>)}</div><small>Every download is authorised against this exact allocated match and recorded. Do not redistribute household evidence outside the enquiry.</small></section>}
                          {opportunity.platformOnly && opportunity.quote?.customerDecision === "accepted" && <>
                            <InstallerArrivalWindows matchId={opportunity.matchId} initialProposal={opportunity.arrivalProposal} onStatus={setOpportunityStatus} />
                            <section className="dashboard-opportunity-conversion" aria-label="Accepted opportunity workflow action"><div><strong>Create the CRM job after customer acceptance</strong><span>If the customer selected an arrival window, use it when creating the appointment in Work. The proposal itself does not create an appointment.</span></div><button type="button" disabled={opportunityBusy === opportunity.matchId} onClick={() => void convertOpportunity(opportunity.matchId)}>Create job</button></section>
                          </>}
                          {opportunity.platformOnly && opportunity.matchStatus === "connected" && opportunity.quote?.customerDecision !== "accepted" && <div className="dashboard-contact-allowance"><div><strong>Waiting for customer acceptance</strong><span>Contact release does not authorise a job, evidence access or an arrival window proposal. The customer must accept this installer for the next step.</span></div></div>}
                        </article>
                      ))}
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
                          : "No card or subscription is required"}
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
                          : "Free accounts are excluded from lead allocation."}
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
                          <strong>Suitable opportunity notices</strong>
                          <small>
                            Email the account contact when a reviewed
                            opportunity is assigned.
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
                <section className="dashboard-panel dashboard-paywall-panel">
                  <div className="dashboard-paywall-state">
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
