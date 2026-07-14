"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { Field, SiteFooter, SiteHeader } from "./ComparatorChrome";

const states = ["ACT", "NSW", "NT", "Qld", "SA", "Tas", "Vic", "WA"];
const categories = [
  ["assessment", "Energy assessment"],
  ["solar", "Rooftop solar"],
  ["battery", "Home batteries"],
  ["heating-cooling", "Heating and cooling"],
  ["hot-water", "Hot water"],
  ["insulation-draughts", "Insulation and draught control"],
  ["ev-charging", "EV charging"],
  ["other", "Other energy upgrades"],
] as const;

type PartnerType = "installer" | "supplier";
type AuthMode = "create" | "signin";

type SavedProfile = {
  businessName?: string;
  contactName?: string;
  phone?: string;
  partnerType?: PartnerType;
  businessWebsite?: string;
  serviceStates?: string[];
  capabilities?: string[];
  summary?: string;
  freeLeadsRemaining?: number;
};

function authMessage(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code.includes("email-already-in-use")) return "That email already has an account. Choose Sign in instead.";
  if (code.includes("invalid-credential") || code.includes("wrong-password")) return "The email or password was not recognised.";
  if (code.includes("weak-password")) return "Choose a stronger password with at least eight characters.";
  if (code.includes("popup-closed")) return "Google sign-in was closed before it finished.";
  if (code.includes("popup-blocked")) return "Your browser blocked the Google sign-in window. Allow pop-ups and try again.";
  if (code.includes("too-many-requests")) return "Too many attempts were made. Wait a moment and try again.";
  return "The account action could not be completed. Please try again.";
}

export function DirectTradePartnerForm() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("create");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authStatus, setAuthStatus] = useState("");
  const [partnerType, setPartnerType] = useState<PartnerType>("installer");
  const [businessName, setBusinessName] = useState("");
  const [businessWebsite, setBusinessWebsite] = useState("");
  const [serviceStates, setServiceStates] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [partnerNotes, setPartnerNotes] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<"" | "ok" | "err">("");
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => onAuthStateChanged(firebaseAuth, (nextUser) => {
    setUser(nextUser);
    setAuthReady(true);
    if (!nextUser) {
      setProfileLoaded(false);
      setProfileSaved(false);
    }
  }), []);

  useEffect(() => {
    if (!user || profileLoaded) return;
    let cancelled = false;
    async function loadProfile() {
      setName((current) => current || user?.displayName || "");
      setAuthEmail(user?.email || "");
      try {
        const token = await user!.getIdToken();
        const response = await fetch("/api/trade-profile", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const result = await response.json().catch(() => ({}));
        const profile = result.profile as SavedProfile | null;
        if (!cancelled && response.ok && profile) {
          setBusinessName(profile.businessName || "");
          setName(profile.contactName || user?.displayName || "");
          setPhone(profile.phone || "");
          setPartnerType(profile.partnerType === "supplier" ? "supplier" : "installer");
          setBusinessWebsite(profile.businessWebsite || "");
          setServiceStates(Array.isArray(profile.serviceStates) ? profile.serviceStates : []);
          setSelectedCategories(Array.isArray(profile.capabilities) ? profile.capabilities : []);
          setPartnerNotes(profile.summary || "");
          setConsent(true);
          setProfileSaved(true);
        }
      } finally {
        if (!cancelled) setProfileLoaded(true);
      }
    }
    void loadProfile();
    return () => { cancelled = true; };
  }, [profileLoaded, user]);

  function toggle(value: string, current: string[], setCurrent: (values: string[]) => void) {
    setCurrent(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  async function useGoogle() {
    setAuthBusy(true);
    setAuthStatus("Opening secure Google sign-in...");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(firebaseAuth, provider);
      setAuthStatus("Google account connected. Complete the business profile below.");
    } catch (error) {
      setAuthStatus(authMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function useEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = authEmail.trim().toLowerCase();
    if (authMode === "create" && !authName.trim()) { setAuthStatus("Enter your name."); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setAuthStatus("Enter a valid email address."); return; }
    if (authPassword.length < 8) { setAuthStatus("Use a password with at least eight characters."); return; }

    setAuthBusy(true);
    setAuthStatus(authMode === "create" ? "Creating your secure account..." : "Signing in...");
    try {
      if (authMode === "create") {
        const credential = await createUserWithEmailAndPassword(firebaseAuth, email, authPassword);
        await updateProfile(credential.user, { displayName: authName.trim() });
        await sendEmailVerification(credential.user).catch(() => undefined);
        setName(authName.trim());
        setAuthStatus("Account created. We sent an email verification link, and you can complete the business profile now.");
      } else {
        await signInWithEmailAndPassword(firebaseAuth, email, authPassword);
        setAuthStatus("Signed in. You can update the business profile below.");
      }
      setAuthPassword("");
    } catch (error) {
      setAuthStatus(authMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function resetPassword() {
    const email = authEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setAuthStatus("Enter your account email first, then choose Reset password.");
      return;
    }
    setAuthBusy(true);
    try {
      await sendPasswordResetEmail(firebaseAuth, email);
      setAuthStatus("Password reset instructions have been sent.");
    } catch (error) {
      setAuthStatus(authMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusType("err");
    if (!businessName.trim()) { setStatus("Enter the business name."); return; }
    if (!serviceStates.length) { setStatus("Choose at least one state or territory served."); return; }
    if (!selectedCategories.length) { setStatus("Choose at least one capability or product category."); return; }
    if (!name.trim()) { setStatus("Enter the contact name."); return; }
    if (!consent) { setStatus("Confirm that we may create and maintain the business profile."); return; }
    if (!user) { setStatus("Sign in before saving the business profile."); return; }

    setSending(true);
    setStatusType("");
    setStatus("Saving your Direct Trade account...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          partnerType,
          businessName: businessName.trim(),
          businessWebsite: businessWebsite.trim(),
          serviceStates,
          capabilities: selectedCategories,
          summary: partnerNotes,
          contactName: name.trim(),
          phone: phone.trim(),
          consent: true,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "Your business profile could not be saved.");
      setProfileSaved(true);
      setStatusType("ok");
      setStatus("Your account is ready. One matched lead is included so you can try the service before choosing a plan.");
    } catch (error) {
      setStatusType("err");
      setStatus(error instanceof Error ? error.message : "Your business profile could not be saved. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return <main className="wrap direct-trade-request-page">
    <SiteHeader active="direct-trade-partners" />
    <header className="direct-trade-request-hero trade-account-hero"><div><span>Direct Trade accounts</span><h1>Join the network and start serving more homes</h1><p>Create a free account, show where your team works and the upgrades you deliver, then try Direct Trade with one included matched lead. A paid plan is only considered after you have seen the workflow.</p><a className="direct-trade-hero-link" href="/direct-trade/standards">Read the marketplace and customer standards</a></div><aside><strong>Try one lead first</strong><p>Your account starts with one included matched lead. Licence, accreditation and insurance evidence is requested only when it is relevant to matching restricted work.</p><span className="trade-trial-badge">$0 to create an account</span></aside></header>

    {!authReady ? <section className="trade-auth-card" aria-live="polite"><p>Loading secure account options...</p></section> : !user ? <section className="trade-auth-card" aria-labelledby="trade-account-title">
      <div className="trade-auth-intro"><span>Step 1</span><h2 id="trade-account-title">Create your free trade account</h2><p>Use Google for the quickest setup, or create an account with your business email.</p></div>
      <div className="trade-auth-panel">
        <button className="trade-google-button" type="button" onClick={useGoogle} disabled={authBusy}><span aria-hidden="true">G</span>Continue with Google</button>
        <div className="trade-auth-divider"><span>or use email</span></div>
        <div className="trade-auth-tabs" role="tablist" aria-label="Email account action"><button type="button" role="tab" aria-selected={authMode === "create"} className={authMode === "create" ? "selected" : ""} onClick={() => { setAuthMode("create"); setAuthStatus(""); }}>Create account</button><button type="button" role="tab" aria-selected={authMode === "signin"} className={authMode === "signin" ? "selected" : ""} onClick={() => { setAuthMode("signin"); setAuthStatus(""); }}>Sign in</button></div>
        <form className="trade-email-form" onSubmit={useEmail} noValidate>
          {authMode === "create" && <Field label="Your name"><input type="text" value={authName} onChange={(event) => setAuthName(event.target.value)} autoComplete="name" /></Field>}
          <Field label="Business email"><input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} autoComplete="email" /></Field>
          <Field label="Password" hint="Use at least eight characters."><input type="password" minLength={8} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} autoComplete={authMode === "create" ? "new-password" : "current-password"} /></Field>
          <button className="btn trade-account-submit" disabled={authBusy}>{authBusy ? "Please wait..." : authMode === "create" ? "Create free account" : "Sign in"}</button>
          {authMode === "signin" && <button className="trade-reset-link" type="button" onClick={resetPassword} disabled={authBusy}>Reset password</button>}
        </form>
        {authStatus && <p className="trade-auth-status" role="status">{authStatus}</p>}
      </div>
      <aside className="trade-auth-benefits"><strong>Included from day one</strong><ul><li>One matched lead to try the service</li><li>National service-area and capability profile</li><li>No subscription required to create an account</li><li>Dashboard access as the network tools are released</li></ul></aside>
    </section> : <>
      <section className="trade-signed-in" aria-label="Signed in account"><div><span>{profileSaved ? "Account active" : "Secure account connected"}</span><strong>{user.email}</strong><small>{profileSaved ? "One included lead is available." : "Complete the business profile to activate your included lead."}</small></div><button type="button" onClick={() => void signOut(firebaseAuth)}>Sign out</button></section>
      <form className="direct-trade-brief" onSubmit={submitProfile} noValidate>
        <section className="direct-trade-form-section" aria-labelledby="partner-type-title"><div className="direct-trade-form-heading"><span>Step 2</span><h2 id="partner-type-title">Set up the business profile</h2><p>Choose the role that best describes the business. An account can be created immediately, while work-specific evidence can be checked later.</p></div><div className="partner-type-grid"><label className={partnerType === "installer" ? "selected" : ""}><input type="radio" name="partner-type" checked={partnerType === "installer"} onChange={() => setPartnerType("installer")} /><span><strong>Licensed installer</strong><small>Install, commission and support household energy upgrades within your service areas.</small></span></label><label className={partnerType === "supplier" ? "selected" : ""}><input type="radio" name="partner-type" checked={partnerType === "supplier"} onChange={() => setPartnerType("supplier")} /><span><strong>Product supplier or wholesaler</strong><small>Support qualified trades with suitable products, warranty pathways and technical service.</small></span></label></div></section>
        <section className="direct-trade-form-section" aria-labelledby="partner-business-title"><div className="direct-trade-form-heading"><span>Step 3</span><h2 id="partner-business-title">Where do you work and what do you deliver?</h2><p>Keep the first profile practical. Sensitive licence or identity documents are not requested here.</p></div><div className="direct-trade-field-grid trade-account-fields"><Field label="Business name"><input type="text" value={businessName} onChange={(event) => setBusinessName(event.target.value)} autoComplete="organization" /></Field><Field label="Business website" optional="optional"><input type="url" value={businessWebsite} onChange={(event) => setBusinessWebsite(event.target.value)} inputMode="url" placeholder="https://example.com.au" /></Field></div><fieldset className="partner-check-group"><legend>States and territories served</legend><div className="partner-chip-grid">{states.map((value) => <label className={serviceStates.includes(value) ? "selected" : ""} key={value}><input type="checkbox" checked={serviceStates.includes(value)} onChange={() => toggle(value, serviceStates, setServiceStates)} />{value}</label>)}</div></fieldset><fieldset className="partner-check-group"><legend>{partnerType === "installer" ? "Installation capabilities" : "Product categories"}</legend><div className="partner-category-grid">{categories.map(([value, label]) => <label className={selectedCategories.includes(value) ? "selected" : ""} key={value}><input type="checkbox" checked={selectedCategories.includes(value)} onChange={() => toggle(value, selectedCategories, setSelectedCategories)} />{label}</label>)}</div></fieldset><Field label={partnerType === "installer" ? "Capabilities and credential summary" : "Products, warranties and support summary"} optional="optional" hint="Maximum 800 characters. Do not upload or paste licence documents, identity records, customer lists, wholesale price files or confidential contracts."><textarea maxLength={800} rows={5} value={partnerNotes} onChange={(event) => setPartnerNotes(event.target.value)} /></Field></section>
        <section className="direct-trade-form-section" aria-labelledby="partner-contact-title"><div className="direct-trade-form-heading"><span>Step 4</span><h2 id="partner-contact-title">Confirm the account contact</h2><p>This person receives account, profile and relevant lead-service communication.</p></div><div className="direct-trade-field-grid"><Field label="Contact name"><input type="text" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></Field><Field label="Account email"><input type="email" value={user.email || ""} readOnly aria-readonly="true" /></Field><Field label="Phone" optional="optional"><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" /></Field></div><label className="direct-trade-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I agree that Australian Energy Assessments may maintain this business profile and contact me about Direct Trade account activity, relevant lead opportunities and plan options. Account creation does not replace licensing, accreditation, insurance or scheme requirements.</span></label><button className="btn direct-trade-submit" disabled={sending}>{sending ? "Saving..." : profileSaved ? "Update business profile" : "Activate account and included lead"}</button>{status && <p className={`direct-trade-form-status ${statusType}`} role="status">{status}</p>}</section>
      </form>
    </>}
    <SiteFooter>Creating a Direct Trade account does not replace trade licensing, government accreditation, scheme approval, insurance, product compliance or each participant&apos;s customer obligations.</SiteFooter>
  </main>;
}
