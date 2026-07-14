"use client";

import { FormEvent, useEffect, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { SiteFooter, SiteHeader } from "./ComparatorChrome";

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
  emailOpportunities: boolean;
  emailWeeklySummary: boolean;
};

type DashboardOpportunity = {
  matchId: string;
  matchStatus: "offered" | "viewed" | "interested" | "declined" | "closed";
  partnerNote: string;
  matchedAt: string;
  updatedAt: string;
  id: string;
  title: string;
  projectType: string;
  postcode: string;
  state: string;
  serviceCategories: string[];
  priority: string;
  timing: string;
  summary: string;
  opportunityStatus: string;
};

const capabilityLabels: Record<string, string> = {
  assessment: "Energy assessment",
  solar: "Rooftop solar",
  battery: "Home batteries",
  "heating-cooling": "Heating and cooling",
  "hot-water": "Hot water",
  "insulation-draughts": "Insulation and draught control",
  "ev-charging": "EV charging",
  other: "Other energy upgrades",
};

export function DirectTradeDashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<DashboardProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [availabilityStatus, setAvailabilityStatus] = useState<"open" | "limited" | "paused">("paused");
  const [emailOpportunities, setEmailOpportunities] = useState(true);
  const [emailWeeklySummary, setEmailWeeklySummary] = useState(true);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState("");
  const [opportunities, setOpportunities] = useState<DashboardOpportunity[]>([]);
  const [opportunityBusy, setOpportunityBusy] = useState("");
  const [opportunityStatus, setOpportunityStatus] = useState("");

  useEffect(() => onAuthStateChanged(firebaseAuth, (nextUser) => {
    setUser(nextUser);
    setAuthReady(true);
    if (!nextUser) { setLoading(false); setOpportunities([]); }
  }), []);

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
        if (!response.ok) throw new Error(result.error || "The dashboard could not be loaded.");
        if (!cancelled) {
          const nextProfile = result.profile as DashboardProfile | null;
          setProfile(nextProfile);
          if (nextProfile) {
            setAvailabilityStatus(["open", "limited"].includes(nextProfile.availabilityStatus) ? nextProfile.availabilityStatus : "paused");
            setEmailOpportunities(nextProfile.emailOpportunities !== false);
            setEmailWeeklySummary(nextProfile.emailWeeklySummary !== false);
            const opportunityResponse = await fetch("/api/trade-opportunities", {
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
            });
            const opportunityResult = await opportunityResponse.json().catch(() => ({}));
            if (opportunityResponse.ok && !cancelled) setOpportunities(opportunityResult.opportunities || []);
          }
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "The dashboard could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadDashboard();
    return () => { cancelled = true; };
  }, [user]);

  const isSupplier = profile?.partnerType === "supplier";
  const annualMonthly = isSupplier ? 199 : 99;
  const flexibleMonthly = isSupplier ? 399 : 199;
  const annualTotal = annualMonthly * 12;
  const profileComplete = Boolean(
    profile?.businessName
    && profile.addressLine1
    && profile.suburb
    && profile.addressState
    && /^\d{4}$/.test(profile.postcode),
  );
  const offeredCount = opportunities.filter((item) => ["offered", "viewed"].includes(item.matchStatus)).length;
  const interestedCount = opportunities.filter((item) => item.matchStatus === "interested").length;

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !profile) return;
    setSettingsBusy(true);
    setSettingsStatus("Saving dashboard preferences...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ availabilityStatus, emailOpportunities, emailWeeklySummary }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "The dashboard preferences could not be saved.");
      setProfile({ ...profile, availabilityStatus, emailOpportunities, emailWeeklySummary });
      setSettingsStatus("Preferences saved. Matching remains inactive until verification and paid membership launch.");
    } catch (settingsError) {
      setSettingsStatus(settingsError instanceof Error ? settingsError.message : "The dashboard preferences could not be saved.");
    } finally {
      setSettingsBusy(false);
    }
  }

  async function respondToOpportunity(matchId: string, status: "viewed" | "interested" | "declined") {
    if (!user) return;
    setOpportunityBusy(matchId);
    setOpportunityStatus(status === "interested" ? "Sending your expression of interest..." : "Updating the opportunity...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-opportunities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ matchId, status }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "The opportunity response could not be saved.");
      setOpportunities((current) => current.map((item) => item.matchId === matchId ? { ...item, matchStatus: status, updatedAt: new Date().toISOString() } : item));
      setOpportunityStatus(status === "interested" ? "Interest recorded. The operations team can now coordinate the next privacy-safe handover step." : status === "declined" ? "Opportunity declined. This will help improve future matching." : "Opportunity marked as reviewed.");
    } catch (responseError) {
      setOpportunityStatus(responseError instanceof Error ? responseError.message : "The opportunity response could not be saved.");
    } finally { setOpportunityBusy(""); }
  }

  return <main className="wrap direct-trade-dashboard-page">
    <SiteHeader active="direct-trade-dashboard" />
    {!authReady || loading ? <section className="dashboard-state-card" aria-live="polite"><p>Preparing your Direct Trade dashboard...</p></section> : !user ? <section className="dashboard-state-card"><span>Account required</span><h1>Sign in to open your dashboard</h1><p>Use the same Google account or business email used to create the trade profile.</p><a className="btn" href="/direct-trade/partners">Sign in or create an account</a></section> : error ? <section className="dashboard-state-card"><span>Dashboard unavailable</span><h1>We could not load this account</h1><p>{error}</p><a className="btn" href="/direct-trade/partners">Return to account setup</a></section> : !profile || !profileComplete ? <section className="dashboard-state-card"><span>Profile required</span><h1>Finish the business profile first</h1><p>Add the required business address, service coverage and capabilities before using the dashboard.</p><a className="btn" href="/direct-trade/partners">Complete business profile</a></section> : <>
      <header className="dashboard-hero"><div><span>Direct Trade dashboard</span><h1>{profile.businessName}</h1><p>{isSupplier ? "Wholesaler workspace" : "Trade partner workspace"} for profile readiness, verification, membership and suitable opportunities.</p></div><div className="dashboard-account-actions"><small>Signed in as</small><strong>{user.email}</strong><a href="/direct-trade/partners">Edit profile</a><button type="button" onClick={() => void signOut(firebaseAuth)}>Sign out</button></div></header>

      <nav className="dashboard-subnav" aria-label="Direct Trade account"><a aria-current="page" href="/direct-trade/dashboard">Overview</a><a href="#opportunity-inbox">Opportunity inbox {offeredCount ? `(${offeredCount})` : ""}</a><a href="/direct-trade/dashboard/verification">Verification centre</a><a href="/direct-trade/membership">Membership and referrals</a></nav>

      <section className="dashboard-status-grid" aria-label="Account status"><article><span>Profile</span><strong>Business details saved</strong><small>{profile.addressState} {profile.postcode}</small></article><article><span>Verification</span><strong>{profile.verificationStatus === "approved" ? "Approved" : profile.verificationStatus === "under_review" ? "Under review" : profile.verificationStatus === "needs_information" ? "More information needed" : "Not started"}</strong><small><a href="/direct-trade/dashboard/verification">Review the evidence pathway</a></small></article><article><span>Opportunity inbox</span><strong>{offeredCount ? `${offeredCount} awaiting response` : "Nothing awaiting response"}</strong><small>{interestedCount ? `${interestedCount} expression${interestedCount === 1 ? "" : "s"} of interest active` : "Matching follows coverage and capability."}</small></article><article><span>Availability</span><strong>{availabilityStatus === "open" ? "Open to suitable work" : availabilityStatus === "limited" ? "Limited capacity" : "Paused"}</strong><small>No per-lead purchase or bidding is required.</small></article></section>

      <div className="dashboard-main-grid">
        <section id="opportunity-inbox" className="dashboard-panel dashboard-opportunities" aria-labelledby="dashboard-opportunities-title"><div className="dashboard-panel-heading"><span>Opportunity inbox</span><h2 id="dashboard-opportunities-title">Privacy-safe scopes matched to this business</h2><p>Review the project region, timing and required capability before expressing interest. Household identity and street address are not exposed at this stage.</p></div>{opportunities.length ? <div className="dashboard-opportunity-list">{opportunities.map((opportunity) => <article key={opportunity.matchId} className={`dashboard-opportunity-card status-${opportunity.matchStatus}`}><header><div><span>{opportunity.state} {opportunity.postcode || "region withheld"}</span><h3>{opportunity.title}</h3></div><strong>{opportunity.matchStatus === "offered" ? "New" : opportunity.matchStatus.replaceAll("_", " ")}</strong></header><p>{opportunity.summary}</p><div className="dashboard-opportunity-tags"><span>{opportunity.projectType}</span><span>{opportunity.timing.replaceAll("_", " ")}</span><span>{opportunity.priority} priority</span>{opportunity.serviceCategories.map((item) => <span key={item}>{capabilityLabels[item] || item}</span>)}</div>{opportunity.opportunityStatus === "closed" ? <small className="dashboard-opportunity-closed">This opportunity has closed.</small> : <div className="dashboard-opportunity-actions"><button type="button" className="primary" disabled={opportunityBusy === opportunity.matchId || opportunity.matchStatus === "interested"} onClick={() => void respondToOpportunity(opportunity.matchId, "interested")}>{opportunity.matchStatus === "interested" ? "Interest recorded" : "I’m interested"}</button><button type="button" disabled={opportunityBusy === opportunity.matchId || opportunity.matchStatus === "declined"} onClick={() => void respondToOpportunity(opportunity.matchId, "declined")}>{opportunity.matchStatus === "declined" ? "Declined" : "Not suitable"}</button>{opportunity.matchStatus === "offered" && <button type="button" disabled={opportunityBusy === opportunity.matchId} onClick={() => void respondToOpportunity(opportunity.matchId, "viewed")}>Save for review</button>}</div>}</article>)}</div> : <div className="dashboard-empty-state"><strong>No opportunities assigned</strong><p>Matching uses service coverage, verified capability, availability and the household scope. Membership does not purchase priority placement or individual leads.</p></div>}{opportunityStatus && <p className="dashboard-settings-status" role="status">{opportunityStatus}</p>}<div className="dashboard-profile-summary"><div><span>Coverage</span><strong>{profile.serviceStates.join(", ")}</strong></div><div><span>{isSupplier ? "Product categories" : "Capabilities"}</span><strong>{profile.capabilities.map((item) => capabilityLabels[item] || item).join(", ")}</strong></div></div></section>

        <aside className="dashboard-panel dashboard-readiness" aria-labelledby="dashboard-readiness-title"><div className="dashboard-panel-heading"><span>Account readiness</span><h2 id="dashboard-readiness-title">Next steps</h2></div><ol><li className="complete"><strong>Business profile</strong><small>Address, coverage and capabilities saved</small></li><li><strong>{isSupplier ? "Product and warranty evidence" : "Licence and insurance review"}</strong><small>Review the secure verification pathway</small></li><li><strong>Choose membership</strong><small>Available when Stripe billing is connected</small></li><li className={availabilityStatus === "paused" ? "" : "complete"}><strong>Set availability</strong><small>{availabilityStatus === "paused" ? "Choose a capacity preference below" : "Capacity preference saved"}</small></li></ol></aside>
      </div>

      <section className="dashboard-panel dashboard-activity" aria-labelledby="dashboard-activity-title"><div className="dashboard-panel-heading"><span>Account activity</span><h2 id="dashboard-activity-title">A clear record of what is moving</h2><p>Opportunity responses and readiness changes remain visible so the business can follow its own progress.</p></div><div className="dashboard-activity-grid"><article><strong>Business profile ready</strong><span>{profile.addressState} {profile.postcode} · {profile.serviceStates.length} service area{profile.serviceStates.length === 1 ? "" : "s"}</span></article><article><strong>Verification {profile.verificationStatus.replaceAll("_", " ")}</strong><span>{profile.verificationStatus === "approved" ? "Evidence review completed" : "Open the verification centre to review the next requirement"}</span></article>{opportunities.slice(0, 4).map((item) => <article key={item.matchId}><strong>{item.title}</strong><span>{item.matchStatus.replaceAll("_", " ")} · updated {new Date(item.updatedAt).toLocaleDateString("en-AU")}</span></article>)}{!opportunities.length && <article><strong>Opportunity matching ready</strong><span>No assignments have been made to this account yet.</span></article>}</div></section>

      <section className="dashboard-panel dashboard-settings" aria-labelledby="dashboard-settings-title"><div className="dashboard-panel-heading"><span>Matching preferences</span><h2 id="dashboard-settings-title">Set capacity and account emails</h2><p>These preferences are saved to the business account. They do not activate matching before verification and membership are ready.</p></div><form onSubmit={saveSettings}><fieldset><legend>Current availability</legend><div className="dashboard-choice-grid"><label className={availabilityStatus === "open" ? "selected" : ""}><input type="radio" name="availability" value="open" checked={availabilityStatus === "open"} onChange={() => setAvailabilityStatus("open")} /><span><strong>Open to suitable work</strong><small>Include the business when matching becomes active.</small></span></label><label className={availabilityStatus === "limited" ? "selected" : ""}><input type="radio" name="availability" value="limited" checked={availabilityStatus === "limited"} onChange={() => setAvailabilityStatus("limited")} /><span><strong>Limited capacity</strong><small>Keep the profile ready but treat capacity as constrained.</small></span></label><label className={availabilityStatus === "paused" ? "selected" : ""}><input type="radio" name="availability" value="paused" checked={availabilityStatus === "paused"} onChange={() => setAvailabilityStatus("paused")} /><span><strong>Paused</strong><small>Do not include the business in future matching.</small></span></label></div></fieldset><fieldset><legend>Email preferences</legend><div className="dashboard-notification-list"><label><input type="checkbox" checked={emailOpportunities} onChange={(event) => setEmailOpportunities(event.target.checked)} /><span><strong>Suitable opportunity notices</strong><small>Email the account contact when a reviewed opportunity is assigned.</small></span></label><label><input type="checkbox" checked={emailWeeklySummary} onChange={(event) => setEmailWeeklySummary(event.target.checked)} /><span><strong>Weekly account summary</strong><small>Receive one concise update covering readiness and account activity.</small></span></label></div></fieldset><button className="btn" disabled={settingsBusy}>{settingsBusy ? "Saving..." : "Save dashboard preferences"}</button>{settingsStatus && <p className="dashboard-settings-status" role="status">{settingsStatus}</p>}</form></section>

      <section className="dashboard-panel dashboard-membership" aria-labelledby="dashboard-membership-title"><div className="dashboard-panel-heading"><span>Membership preview</span><h2 id="dashboard-membership-title">Simple subscription pricing with no per-lead fees</h2><p>Prices below include GST. Billing is not active and no payment details are being collected yet.</p></div><div className="dashboard-pricing-grid"><article className="recommended"><span>Best value</span><h3>Annual membership</h3><strong>${annualMonthly}<small>/month</small></strong><p>Billed as ${annualTotal.toLocaleString("en-AU")} once each year, including GST.</p><ul><li>Full dashboard and opportunity access after approval</li><li>No individual lead charges</li><li>Referral rewards when billing launches</li></ul><button type="button" disabled>Stripe billing coming next</button></article><article><span>Flexible</span><h3>Month to month</h3><strong>${flexibleMonthly}<small>/month</small></strong><p>Charged monthly, including GST, with no annual commitment.</p><ul><li>The same matching and placement rules</li><li>No individual lead charges</li><li>Manage the plan from the dashboard</li></ul><button type="button" disabled>Stripe billing coming next</button></article></div></section>

      <section className="dashboard-panel dashboard-referral" aria-labelledby="dashboard-referral-title"><div><span>Referral rewards</span><h2 id="dashboard-referral-title">Grow the network by recommending trusted businesses</h2><p>When paid membership launches, every paying member will receive a unique referral code. After a referred business starts a paid plan and its first payment clears, both businesses receive one month of membership credit.</p></div><aside><strong>Planned safeguards</strong><ul><li>One reward for each new referred business</li><li>Credits apply to membership, not cash withdrawals</li><li>Self-referrals, duplicate businesses and misuse can be rejected</li><li>Referral history will be visible in the dashboard</li></ul></aside></section>
    </>}
    <SiteFooter>Direct Trade membership does not replace trade licensing, government accreditation, scheme approval, insurance, product compliance or customer obligations.</SiteFooter>
  </main>;
}
