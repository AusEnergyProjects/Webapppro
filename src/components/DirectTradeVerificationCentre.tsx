"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { SiteFooter, SiteHeader } from "./ComparatorChrome";

type VerificationProfile = {
  businessName: string;
  partnerType: "installer" | "supplier";
  verificationStatus: string;
  addressLine1: string;
  suburb: string;
  addressState: string;
  postcode: string;
};

const installerChecks = [
  { title: "Legal business identity", text: "Confirm the contracting business and private business address." },
  { title: "Trade licence or registration", text: "Check the licence or registration relevant to each regulated work category." },
  { title: "Insurance", text: "Confirm current cover appropriate to the work and service area." },
  { title: "Scheme-specific approval", text: "Check any installer approval required for certificates, rebates or program participation." },
];

const supplierChecks = [
  { title: "Legal business identity", text: "Confirm the supplying business and private business address." },
  { title: "Product compliance evidence", text: "Identify relevant models, certifications and installation conditions." },
  { title: "Warranty pathway", text: "Confirm written warranty terms, claim handling and responsibility after installation." },
  { title: "Australian technical support", text: "Confirm local support, replacement pathways and escalation contacts." },
];

export function DirectTradeVerificationCentre() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<VerificationProfile | null>(null);
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
    async function loadProfile() {
      try {
        const token = await user!.getIdToken();
        const response = await fetch("/api/trade-profile", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "The verification centre could not be loaded.");
        if (!cancelled) setProfile(result.profile || null);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "The verification centre could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadProfile();
    return () => { cancelled = true; };
  }, [user]);

  const checks = profile?.partnerType === "supplier" ? supplierChecks : installerChecks;
  const roleLabel = profile?.partnerType === "supplier" ? "wholesaler" : "trade partner";

  return <main className="wrap direct-trade-verification-page">
    <SiteHeader active="direct-trade-verification" />
    {!authReady || loading ? <section className="dashboard-state-card" aria-live="polite"><p>Preparing the verification centre...</p></section> : !user ? <section className="dashboard-state-card"><span>Account required</span><h1>Sign in to review verification</h1><p>Verification information belongs to the signed-in business account.</p><a className="btn" href="/direct-trade/partners">Sign in or create an account</a></section> : error ? <section className="dashboard-state-card"><span>Verification unavailable</span><h1>We could not load this account</h1><p>{error}</p><a className="btn" href="/direct-trade/dashboard">Return to dashboard</a></section> : !profile ? <section className="dashboard-state-card"><span>Profile required</span><h1>Complete the business profile first</h1><p>The private business address and role determine the correct verification pathway.</p><a className="btn" href="/direct-trade/partners">Complete business profile</a></section> : <>
      <header className="verification-hero"><div><span>Verification centre</span><h1>Prepare {profile.businessName} for review</h1><p>This workspace explains the evidence expected for a {roleLabel}. It does not grant approval, replace an issuing authority or accept sensitive files through an ordinary form.</p></div><aside><span>Current status</span><strong>{profile.verificationStatus === "approved" ? "Approved" : "Not started"}</strong><small>Australian Energy Assessments reviews evidence before activating relevant matching.</small></aside></header>
      <nav className="dashboard-subnav" aria-label="Direct Trade account"><a href="/direct-trade/dashboard">Overview</a><a aria-current="page" href="/direct-trade/dashboard/verification">Verification centre</a><a href="/direct-trade/membership">Membership and referrals</a></nav>
      <section className="verification-summary" aria-label="Business verification summary"><article><span>Business</span><strong>{profile.businessName}</strong><small>{profile.suburb}, {profile.addressState} {profile.postcode}</small></article><article><span>Role pathway</span><strong>{profile.partnerType === "supplier" ? "Supplier or wholesaler" : "Licensed installer"}</strong><small>Evidence requirements change with role and work category.</small></article><article><span>Privacy</span><strong>Private by default</strong><small>The business street address is not published from this profile.</small></article></section>
      <section className="dashboard-panel verification-checklist" aria-labelledby="verification-checklist-title"><div className="dashboard-panel-heading"><span>Evidence pathway</span><h2 id="verification-checklist-title">What the review will confirm</h2><p>Only evidence relevant to the business role and proposed work should be requested.</p></div><div>{checks.map((check, index) => <article key={check.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{check.title}</h3><p>{check.text}</p></div><strong>Not requested</strong></article>)}</div></section>
      <section className="verification-boundary"><div><span>Secure evidence boundary</span><h2>Document upload is not open yet</h2><p>A future release will use private, access-controlled storage with file ownership, review status and expiry reminders. Until that workflow is ready, do not paste or upload licence files, identity records, insurance certificates or confidential product files into general account forms.</p></div><aside><strong>What you can do now</strong><ul><li>Keep the legal business profile accurate</li><li>Review the evidence categories above</li><li>Set availability in the dashboard</li><li>Wait for a controlled verification request</li></ul><a className="btn" href="/direct-trade/dashboard">Return to dashboard</a></aside></section>
    </>}
    <SiteFooter>Verification status is an Australian Energy Assessments marketplace control and does not replace confirmation with the relevant issuing authority.</SiteFooter>
  </main>;
}
