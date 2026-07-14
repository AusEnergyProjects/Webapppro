"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => onAuthStateChanged(firebaseAuth, (nextUser) => {
    setUser(nextUser);
    setAuthReady(true);
    if (!nextUser) setLoading(false);
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
        if (!cancelled) setProfile(result.profile || null);
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

  return <main className="wrap direct-trade-dashboard-page">
    <SiteHeader active="direct-trade-dashboard" />
    {!authReady || loading ? <section className="dashboard-state-card" aria-live="polite"><p>Preparing your Direct Trade dashboard...</p></section> : !user ? <section className="dashboard-state-card"><span>Account required</span><h1>Sign in to open your dashboard</h1><p>Use the same Google account or business email used to create the trade profile.</p><a className="btn" href="/direct-trade/partners">Sign in or create an account</a></section> : error ? <section className="dashboard-state-card"><span>Dashboard unavailable</span><h1>We could not load this account</h1><p>{error}</p><a className="btn" href="/direct-trade/partners">Return to account setup</a></section> : !profile || !profileComplete ? <section className="dashboard-state-card"><span>Profile required</span><h1>Finish the business profile first</h1><p>Add the required business address, service coverage and capabilities before using the dashboard.</p><a className="btn" href="/direct-trade/partners">Complete business profile</a></section> : <>
      <header className="dashboard-hero"><div><span>Direct Trade dashboard</span><h1>{profile.businessName}</h1><p>{isSupplier ? "Wholesaler workspace" : "Trade partner workspace"} for profile readiness, verification, membership and suitable opportunities.</p></div><div className="dashboard-account-actions"><small>Signed in as</small><strong>{user.email}</strong><a href="/direct-trade/partners">Edit profile</a><button type="button" onClick={() => void signOut(firebaseAuth)}>Sign out</button></div></header>

      <section className="dashboard-status-grid" aria-label="Account status"><article><span>Profile</span><strong>Business details saved</strong><small>{profile.addressState} {profile.postcode}</small></article><article><span>Verification</span><strong>{profile.verificationStatus === "approved" ? "Approved" : "Not started"}</strong><small>Evidence will be requested through a controlled review.</small></article><article><span>Membership</span><strong>Plan not selected</strong><small>Stripe billing is not connected yet.</small></article><article><span>Opportunities</span><strong>None assigned yet</strong><small>No per-lead purchase or bidding is required.</small></article></section>

      <div className="dashboard-main-grid">
        <section className="dashboard-panel dashboard-opportunities" aria-labelledby="dashboard-opportunities-title"><div className="dashboard-panel-heading"><span>Opportunity inbox</span><h2 id="dashboard-opportunities-title">Suitable projects will appear here</h2></div><div className="dashboard-empty-state"><strong>No opportunities assigned</strong><p>Future matching will use service coverage, verified capability, availability and the household scope. Membership will not purchase priority placement or individual leads.</p></div><div className="dashboard-profile-summary"><div><span>Coverage</span><strong>{profile.serviceStates.join(", ")}</strong></div><div><span>{isSupplier ? "Product categories" : "Capabilities"}</span><strong>{profile.capabilities.map((item) => capabilityLabels[item] || item).join(", ")}</strong></div></div></section>

        <aside className="dashboard-panel dashboard-readiness" aria-labelledby="dashboard-readiness-title"><div className="dashboard-panel-heading"><span>Account readiness</span><h2 id="dashboard-readiness-title">Next steps</h2></div><ol><li className="complete"><strong>Business profile</strong><small>Address, coverage and capabilities saved</small></li><li><strong>{isSupplier ? "Product and warranty evidence" : "Licence and insurance review"}</strong><small>Secure evidence workflow to be released</small></li><li><strong>Choose membership</strong><small>Available when Stripe billing is connected</small></li><li><strong>Set availability</strong><small>Control when the business can receive matches</small></li></ol></aside>
      </div>

      <section className="dashboard-panel dashboard-membership" aria-labelledby="dashboard-membership-title"><div className="dashboard-panel-heading"><span>Membership preview</span><h2 id="dashboard-membership-title">Simple subscription pricing with no per-lead fees</h2><p>Prices below include GST. Billing is not active and no payment details are being collected yet.</p></div><div className="dashboard-pricing-grid"><article className="recommended"><span>Best value</span><h3>Annual membership</h3><strong>${annualMonthly}<small>/month</small></strong><p>Billed as ${annualTotal.toLocaleString("en-AU")} once each year, including GST.</p><ul><li>Full dashboard and opportunity access after approval</li><li>No individual lead charges</li><li>Referral rewards when billing launches</li></ul><button type="button" disabled>Stripe billing coming next</button></article><article><span>Flexible</span><h3>Month to month</h3><strong>${flexibleMonthly}<small>/month</small></strong><p>Charged monthly, including GST, with no annual commitment.</p><ul><li>The same matching and placement rules</li><li>No individual lead charges</li><li>Manage the plan from the dashboard</li></ul><button type="button" disabled>Stripe billing coming next</button></article></div></section>

      <section className="dashboard-panel dashboard-referral" aria-labelledby="dashboard-referral-title"><div><span>Referral rewards</span><h2 id="dashboard-referral-title">Grow the network by recommending trusted businesses</h2><p>When paid membership launches, every paying member will receive a unique referral code. After a referred business starts a paid plan and its first payment clears, both businesses receive one month of membership credit.</p></div><aside><strong>Planned safeguards</strong><ul><li>One reward for each new referred business</li><li>Credits apply to membership, not cash withdrawals</li><li>Self-referrals, duplicate businesses and misuse can be rejected</li><li>Referral history will be visible in the dashboard</li></ul></aside></section>
    </>}
    <SiteFooter>Direct Trade membership does not replace trade licensing, government accreditation, scheme approval, insurance, product compliance or customer obligations.</SiteFooter>
  </main>;
}
