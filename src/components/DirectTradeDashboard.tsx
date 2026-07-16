"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { SiteFooter, SiteHeader } from "./ComparatorChrome";
import { SupplierCatalogueWorkspace } from "./SupplierCatalogueWorkspace";
import { InstallerProductMarketplace } from "./InstallerProductMarketplace";
import { InstallerPlatformQuote } from "./InstallerPlatformQuote";
import { TradeBusinessHub } from "./TradeBusinessHub";
import { TradePurchasingWorkspace } from "./TradePurchasingWorkspace";
import { TradeDataImportWorkspace } from "./TradeDataImportWorkspace";
import {
  directTradeCheckoutUrl,
  directTradePortalLink,
} from "@/lib/direct-trade-billing";
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
  opportunityStatus: string;
  platformOnly: boolean;
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

type ReferralData = {
  eligible: boolean;
  billingStatus: string;
  code: string;
  link: string;
  stats: {
    joined: number;
    awaitingPayment: number;
    rewarded: number;
    earnedMonths: number;
  };
  referrals: Array<{
    id: string;
    businessName: string;
    status: string;
    statusLabel: string;
    registeredAt: string;
    firstPaidAt: string;
    rewardedAt: string;
  }>;
  receivedReferral: null | {
    status: string;
    statusLabel: string;
    registeredAt: string;
    firstPaidAt: string;
    rewardedAt: string;
  };
};

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

const freeAccountFeatures = [
  "Create and edit the complete business profile",
  "Set service areas, capabilities and contact preferences",
  "Upload verification evidence and track review progress",
  "Manage up to five privacy-safe internal work records",
  "Access billing, account settings and membership options",
];

function PlanAccessPanel({ profile }: { profile: DashboardProfile }) {
  const role = profile.partnerType;
  const available = FEATURE_DEFINITIONS.filter((feature) =>
    feature.roles.includes(role),
  );
  const includedFree = [
    ...freeAccountFeatures,
    role === "supplier"
      ? "Create and edit draft wholesaler product listings"
      : "Prepare service coverage and availability before upgrading",
  ];
  return (
    <section className="dashboard-plan-access" aria-labelledby="plan-access-title">
      <div className="dashboard-plan-summary">
        <div>
          <span>Current access</span>
          <h2 id="plan-access-title">{profile.entitlements.accessLabel}</h2>
          <p>
            Free accounts can finish setup and become verification-ready. Paid
            access controls commercial visibility, leads and marketplace tools.
          </p>
        </div>
        <a href="#membership">
          {profile.entitlements.paidMembership ? "Manage membership" : "Compare paid access"}
        </a>
      </div>
      <div className="dashboard-tier-grid">
        <article>
          <span>Always included</span>
          <h3>Free account</h3>
          <ul>{includedFree.map((item) => <li key={item}>{item}</li>)}</ul>
          <strong>
            {role === "supplier"
              ? "Draft products remain private until commercial access is active."
              : "No household leads are sent to free installers."}
          </strong>
        </article>
        <article className="paid">
          <span>Commercial access</span>
          <h3>Paid membership</h3>
          <ul>
            {available.filter((feature) => feature.tier === "membership").map((feature) => (
              <li key={feature.key} className={profile.entitlements.features[feature.key] ? "enabled" : "locked"}>
                {feature.label}
              </li>
            ))}
          </ul>
          <strong>
            {role === "supplier"
              ? "Unpaid wholesalers remain invisible in installer product selection."
              : "Only paid or specifically granted installers enter lead matching."}
          </strong>
        </article>
        <article>
          <span>Admin assigned</span>
          <h3>Premium features</h3>
          <ul>
            {available.filter((feature) => feature.tier === "premium").map((feature) => (
              <li key={feature.key} className={profile.entitlements.features[feature.key] ? "enabled" : "locked"}>
                {feature.label}
              </li>
            ))}
          </ul>
          <strong>Premium add-ons can be enabled per account by an administrator.</strong>
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
  const [referrals, setReferrals] = useState<ReferralData | null>(null);
  const [referralBusy, setReferralBusy] = useState(false);
  const [referralStatus, setReferralStatus] = useState("");
  const [workspace, setWorkspace] = useState<"work" | "leads" | "products" | "orders" | "import" | "account">("work");

  useEffect(
    () =>
      onAuthStateChanged(firebaseAuth, (nextUser) => {
        setUser(nextUser);
        setAuthReady(true);
        if (!nextUser) {
          setLoading(false);
          setOpportunities([]);
          setReferrals(null);
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
            const referralResponsePromise = fetch("/api/trade-referrals", {
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
            });
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
            const referralResponse = await referralResponsePromise;
            const referralResult = await referralResponse.json().catch(() => ({}));
            if (referralResponse.ok && !cancelled)
              setReferrals(referralResult.referrals || null);
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
  const annualMonthly = isSupplier ? 199 : 99;
  const flexibleMonthly = isSupplier ? 399 : 199;
  const annualTotal = annualMonthly * 12;
  const annualCheckout =
    user && profile
      ? directTradeCheckoutUrl({
          partnerType: profile.partnerType,
          cadence: "annual",
          firebaseUid: user.uid,
          email: user.email || "",
        })
      : "";
  const monthlyCheckout =
    user && profile
      ? directTradeCheckoutUrl({
          partnerType: profile.partnerType,
          cadence: "monthly",
          firebaseUid: user.uid,
          email: user.email || "",
        })
      : "";
  const billingLabel: Record<string, string> = {
    not_connected: "No membership selected",
    processing: "Payment confirmation in progress",
    trial: "Trial membership active",
    active: "Membership active",
    active_cancels_at_period_end: "Active until the current paid term ends",
    past_due: "Payment action required",
    paused: "Membership paused",
    cancelled: "Membership ended",
  };
  const canStartMembership = Boolean(
    profile &&
      ["not_connected", "cancelled"].includes(profile.billingStatus),
  );
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

  async function generateReferralLink() {
    if (!user) return;
    setReferralBusy(true);
    setReferralStatus("Generating your secure member referral link...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-referrals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok)
        throw new Error(result.error || "The referral link could not be generated.");
      setReferrals(result.referrals);
      setReferralStatus("Your referral link is ready to share.");
    } catch (referralError) {
      setReferralStatus(
        referralError instanceof Error
          ? referralError.message
          : "The referral link could not be generated.",
      );
    } finally {
      setReferralBusy(false);
    }
  }

  async function copyReferralLink() {
    if (!referrals?.link) return;
    try {
      await navigator.clipboard.writeText(referrals.link);
      setReferralStatus("Referral link copied. It is ready to send to a trusted business.");
    } catch {
      setReferralStatus("Copy the referral link from the field below.");
    }
  }

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

  return (
    <main className="wrap direct-trade-dashboard-page">
      <SiteHeader active="direct-trade-dashboard" />
      {!authReady || loading ? (
        <section className="dashboard-state-card" aria-live="polite">
          <p>Preparing your Direct Trade dashboard...</p>
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
              <span className="trade-portal-mark" aria-hidden="true">AEA</span>
              <div>
                <strong>{profile.businessName}</strong>
                <small>
                  {isSupplier ? "Wholesaler control centre" : "Installer control centre"}
                </small>
              </div>
            </div>
            <div className="dashboard-account-actions">
              <span className="trade-portal-role">{isSupplier ? "Wholesaler" : "Installer"}</span>
              <div>
                <small>Signed in as</small>
                <strong>{user.email}</strong>
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

          {(isSupplier ? workspace === "account" : workspace === "account") && <PlanAccessPanel profile={profile} />}

          {isSupplier ? (
            <>
              <nav className="dashboard-workspace-nav" aria-label="Wholesaler workspace">
                <button type="button" className={workspace === "products" ? "active" : ""} onClick={() => setWorkspace("products")}><b aria-hidden="true">01</b><span>Products</span><small>Catalogue and stock</small></button>
                <button type="button" className={workspace === "work" ? "active" : ""} onClick={() => setWorkspace("work")}><b aria-hidden="true">02</b><span>Work</span><small>Requests and tasks</small></button>
                <button type="button" className={workspace === "orders" ? "active" : ""} onClick={() => setWorkspace("orders")}><b aria-hidden="true">03</b><span>Orders</span><small>Supply and warranties</small></button>
                <button type="button" className={workspace === "import" ? "active" : ""} onClick={() => setWorkspace("import")}><b aria-hidden="true">04</b><span>Import</span><small>Guided data migration</small></button>
                <button type="button" className={workspace === "account" ? "active" : ""} onClick={() => setWorkspace("account")}><b aria-hidden="true">05</b><span>Business</span><small>Profile and membership</small></button>
                <div className="dashboard-rail-note"><strong>Privacy boundary</strong><p>Wholesalers manage products and supply. Household leads and customer contact details never enter this workspace.</p></div>
              </nav>
              {workspace === "work" && <TradeBusinessHub
                user={user}
                partnerType="supplier"
                fullAccess={hasBusinessOperations}
                teamAccess={hasTeamAccess}
              />}
              {workspace === "products" && <SupplierCatalogueWorkspace
                user={user}
                businessName={profile.businessName}
                marketplaceVisible={hasSupplierVisibility}
                canBulkImport={hasBulkImport}
                hasAnalytics={Boolean(profile.entitlements.features.advanced_analytics)}
              />}
              {workspace === "orders" && (hasBusinessOperations ? <TradePurchasingWorkspace user={user} partnerType="supplier" /> : <section className="dashboard-panel dashboard-upgrade-callout"><strong>Business purchasing is locked</strong><p>Paid Business Hub access adds purchase orders, fulfilment milestones and warranty claims.</p><a href="#membership">Compare membership</a></section>)}
              {workspace === "import" && (hasBusinessOperations && hasBulkImport ? <TradeDataImportWorkspace user={user} partnerType="supplier" /> : <section className="dashboard-panel dashboard-upgrade-callout"><strong>Guided catalogue migration is locked</strong><p>Paid wholesaler access adds preview, duplicate review and rollback for catalogue imports.</p><a href="#membership">Compare membership</a></section>)}
              {workspace === "account" && <section className="dashboard-panel dashboard-account-home"><div className="dashboard-panel-heading"><span>Business account</span><h2>Profile, verification and membership</h2><p>Keep occasional administration separate from daily work.</p></div><div className="dashboard-account-links"><a href="/direct-trade/partners"><strong>Edit business profile</strong><span>Contact, service areas and capabilities</span></a><a href="/direct-trade/dashboard/verification"><strong>Verification centre</strong><span>Evidence, licences and review status</span></a><a href="/direct-trade/membership"><strong>Membership and referrals</strong><span>Plans, invoices and rewards</span></a></div></section>}
            </>
          ) : (
            <>
              <nav
                className="dashboard-workspace-nav"
                aria-label="Direct Trade account"
              >
                <button type="button" className={workspace === "work" ? "active" : ""} onClick={() => setWorkspace("work")}><b aria-hidden="true">01</b><span>Work</span><small>Today, jobs and customers</small></button>
                <button type="button" className={workspace === "leads" ? "active" : ""} onClick={() => setWorkspace("leads")}><b aria-hidden="true">02</b><span>Leads{offeredCount ? ` (${offeredCount})` : ""}</span><small>AEA protected opportunities</small></button>
                <button type="button" className={workspace === "products" ? "active" : ""} onClick={() => setWorkspace("products")}><b aria-hidden="true">03</b><span>Products</span><small>Approved trade catalogue</small></button>
                <button type="button" className={workspace === "orders" ? "active" : ""} onClick={() => setWorkspace("orders")}><b aria-hidden="true">04</b><span>Orders</span><small>Supply and warranties</small></button>
                <button type="button" className={workspace === "account" ? "active" : ""} onClick={() => setWorkspace("account")}><b aria-hidden="true">05</b><span>Business</span><small>Settings and membership</small></button>
                <div className="dashboard-rail-note"><strong>Privacy boundary</strong><p>AEA leads remain protected. Customer contact details only belong here when the customer contacted your business directly.</p></div>
              </nav>

              {workspace === "work" && <TradeBusinessHub
                user={user}
                partnerType="installer"
                fullAccess={hasBusinessOperations}
                teamAccess={hasTeamAccess}
              />}

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
                      ? "Locked on free account"
                      : offeredCount
                      ? `${offeredCount} awaiting response`
                      : "Nothing awaiting response"}
                  </strong>
                  <small>
                    {!hasLeadAccess
                      ? "No leads can be allocated until access is unlocked."
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
                      stay outside the trade workspace. Respond through the
                      structured platform controls only.
                    </p>
                  </div>
                  {!hasLeadAccess ? (
                    <div className="dashboard-paywall-state">
                      <span>Paid feature</span>
                      <h3>Opportunity delivery is switched off</h3>
                      <p>
                        This free account can complete its profile and verification,
                        but it is excluded from automatic and manual lead allocation.
                        Start membership or ask an administrator to grant Opportunity
                        leads to activate this inbox.
                      </p>
                      <a href="#membership">Unlock opportunity leads</a>
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
                          {opportunity.matchStatus === "connected" ? (
                            <div className="dashboard-contact-allowance">
                              <div>
                                <strong>Platform coordination active</strong>
                                <span>
                                  The household has progressed this option.
                                  Customer contact details remain private.
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
                        {profile.entitlements.paidMembership
                          ? "Membership active"
                          : "Choose membership"}
                      </strong>
                      <small>
                        {billingLabel[profile.billingStatus] ||
                          "Choose a secure Stripe plan below"}
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
                <InstallerProductMarketplace user={user} />
              ) : (
                <section className="dashboard-panel dashboard-paywall-panel">
                  <div className="dashboard-paywall-state">
                    <span>Paid feature</span>
                    <h2>Wholesale product marketplace</h2>
                    <p>
                      Upgrade to compare approved equipment, trade pricing, stock,
                      warranties and complete kit dependencies. Products from unpaid
                      wholesalers never appear in this selection workspace.
                    </p>
                    <a href="#membership">Unlock product selection</a>
                  </div>
                </section>
              ))}
              {workspace === "orders" && (hasBusinessOperations ? <TradePurchasingWorkspace user={user} partnerType="installer" /> : <section className="dashboard-panel dashboard-upgrade-callout"><strong>Business purchasing is locked</strong><p>Paid Business Hub access adds system-numbered purchase orders, fulfilment milestones and warranty claims.</p><a href="#membership">Compare membership</a></section>)}
            </>
          )}

          {workspace === "account" && <section
            className="dashboard-panel dashboard-membership"
            aria-labelledby="dashboard-membership-title"
            id="membership"
          >
            <div className="dashboard-panel-heading">
              <span>Secure membership billing</span>
              <h2 id="dashboard-membership-title">
                Simple subscription pricing with no per-lead fees
              </h2>
              <p>
                Prices include GST. Stripe securely collects payment details,
                issues invoices and keeps subscription controls separate from
                marketplace matching.
              </p>
            </div>
            <div className="dashboard-pricing-grid">
              <article className="recommended">
                <span>Best value</span>
                <h3>Annual membership</h3>
                <strong>
                  ${annualMonthly}
                  <small>/month</small>
                </strong>
                <p>
                  Billed as ${annualTotal.toLocaleString("en-AU")} once each
                  year, including GST. This is a prepaid 12-month term.
                </p>
                <ul>
                  <li>Full role-specific dashboard access after approval</li>
                  <li>
                    {isSupplier
                      ? "Approved products become visible to installer members"
                      : "Suitable opportunity leads and product selection unlock"}
                  </li>
                  <li>No individual lead charges</li>
                  <li>Stop renewal before the next annual charge</li>
                  <li>
                    No early cancellation or refund except where Australian
                    Consumer Law requires it
                  </li>
                </ul>
                {canStartMembership ? (
                  <a className="billing-checkout-link" href={annualCheckout}>
                    Start annual membership with Stripe
                  </a>
                ) : (
                  <span className="billing-checkout-link is-disabled">
                    Manage the current membership below
                  </span>
                )}
              </article>
              <article>
                <span>Flexible</span>
                <h3>Month to month</h3>
                <strong>
                  ${flexibleMonthly}
                  <small>/month</small>
                </strong>
                <p>
                  Charged monthly, including GST. Cancel any time and access
                  continues until the end of the paid monthly billing period.
                </p>
                <ul>
                  <li>The same matching and placement rules</li>
                  <li>
                    {isSupplier
                      ? "Approved products become visible to installer members"
                      : "Suitable opportunity leads and product selection unlock"}
                  </li>
                  <li>No individual lead charges</li>
                  <li>No annual commitment or early cancellation fee</li>
                  <li>Manage invoices and payment details in Stripe</li>
                </ul>
                {canStartMembership ? (
                  <a className="billing-checkout-link" href={monthlyCheckout}>
                    Start monthly membership with Stripe
                  </a>
                ) : (
                  <span className="billing-checkout-link is-disabled">
                    Manage the current membership below
                  </span>
                )}
              </article>
            </div>
            <div className="dashboard-billing-actions">
              <a
                className="btn ghost"
                href={directTradePortalLink}
                rel="noreferrer"
              >
                Manage an existing Stripe membership
              </a>
              <a className="btn ghost" href="/direct-trade/membership/terms">
                Read membership and cancellation terms
              </a>
            </div>
          </section>}

          {workspace === "account" && <section
            className="dashboard-panel dashboard-referral"
            aria-labelledby="dashboard-referral-title"
          >
            <div>
              <span>Live referral rewards</span>
              <h2 id="dashboard-referral-title">
                Give a free month and earn a free month
              </h2>
              <p>
                Active paying members can create one unique link and share it
                with trusted trade or wholesale businesses. After a new
                referred business starts a paid plan and its first payment
                clears, both renewal dates move forward by one full calendar
                month.
              </p>
              {referrals?.eligible ? (
                referrals.link ? (
                  <div className="dashboard-referral-link">
                    <label htmlFor="member-referral-link">Your member link</label>
                    <div>
                      <input
                        id="member-referral-link"
                        value={referrals.link}
                        readOnly
                        aria-readonly="true"
                      />
                      <button type="button" onClick={() => void copyReferralLink()}>
                        Copy link
                      </button>
                    </div>
                    <small>Referral code {referrals.code}</small>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn dashboard-referral-generate"
                    disabled={referralBusy}
                    onClick={() => void generateReferralLink()}
                  >
                    {referralBusy ? "Generating..." : "Generate my referral link"}
                  </button>
                )
              ) : (
                <div className="dashboard-referral-locked">
                  <strong>Available with active paid membership</strong>
                  <p>
                    Start a monthly or annual membership above to unlock your
                    personal referral link.
                  </p>
                </div>
              )}
              {referralStatus && (
                <p className="dashboard-settings-status" role="status">
                  {referralStatus}
                </p>
              )}
            </div>
            <aside>
              <strong>How the free month works</strong>
              <ul>
                <li>Monthly plan: the second month is free</li>
                <li>Annual plan: the next renewal moves out to month 13</li>
                <li>Each additional eligible referral adds another month</li>
                <li>
                  Self-referrals, existing subscribers and duplicate businesses
                  are excluded or reviewed
                </li>
                <li>Rewards are membership time, not cash or lead credits</li>
              </ul>
            </aside>
            {referrals && (
              <div className="dashboard-referral-history">
                <div className="dashboard-referral-metrics" aria-label="Referral summary">
                  <article><span>Businesses joined</span><strong>{referrals.stats.joined}</strong></article>
                  <article><span>Waiting for payment</span><strong>{referrals.stats.awaitingPayment}</strong></article>
                  <article><span>Rewards completed</span><strong>{referrals.stats.rewarded}</strong></article>
                  <article><span>Your free months</span><strong>{referrals.stats.earnedMonths}</strong></article>
                </div>
                {referrals.receivedReferral && (
                  <p className="dashboard-received-referral">
                    <strong>Your signup referral:</strong>{" "}
                    {referrals.receivedReferral.statusLabel}
                  </p>
                )}
                {referrals.referrals.length > 0 && (
                  <div className="dashboard-referral-list">
                    <strong>Referral history</strong>
                    {referrals.referrals.map((item) => (
                      <article key={item.id}>
                        <div><strong>{item.businessName}</strong><small>Joined {new Date(item.registeredAt).toLocaleDateString("en-AU")}</small></div>
                        <span className={`referral-status referral-status-${item.status}`}>{item.statusLabel}</span>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>}
        </div>
      )}
      <SiteFooter>
        Direct Trade membership does not replace trade licensing, government
        accreditation, scheme approval, insurance, product compliance or
        customer obligations.
      </SiteFooter>
    </main>
  );
}
