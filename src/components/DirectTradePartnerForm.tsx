"use client";

/* eslint-disable @next/next/no-img-element */

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
import { Field, SiteFooter } from "./ComparatorChrome";
import { TLinkHeader } from "./TLinkChrome";
import { AUSTRALIAN_STATE_CODES } from "@/lib/australian-postcodes.mjs";
import { ENERGY_SERVICE_OPTIONS } from "@/lib/energy-service-catalogue.mjs";
import {
  AustralianAddressLookup,
  type AustralianAddressSuggestion,
} from "./AustralianAddressLookup";

const states = AUSTRALIAN_STATE_CODES;
const categories = ENERGY_SERVICE_OPTIONS;

type PartnerType = "installer" | "supplier";
type AuthMode = "create" | "signin";

type SavedProfile = {
  businessName?: string;
  abn?: string;
  addressLine1?: string;
  suburb?: string;
  addressState?: string;
  postcode?: string;
  contactName?: string;
  phone?: string;
  partnerType?: PartnerType;
  businessWebsite?: string;
  serviceStates?: string[];
  capabilities?: string[];
  summary?: string;
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
  const [existingPartnerType, setExistingPartnerType] =
    useState<PartnerType | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [abn, setAbn] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [suburb, setSuburb] = useState("");
  const [addressState, setAddressState] = useState("");
  const [postcode, setPostcode] = useState("");
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
      setExistingPartnerType(null);
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
          setAbn(profile.abn || "");
          setAddressLine1(profile.addressLine1 || "");
          setSuburb(profile.suburb || "");
          setAddressState(profile.addressState || "");
          setPostcode(profile.postcode || "");
          setName(profile.contactName || user?.displayName || "");
          setPhone(profile.phone || "");
          const savedPartnerType =
            profile.partnerType === "supplier" ? "supplier" : "installer";
          setPartnerType(savedPartnerType);
          setExistingPartnerType(savedPartnerType);
          setBusinessWebsite(profile.businessWebsite || "");
          setServiceStates(Array.isArray(profile.serviceStates) ? profile.serviceStates : []);
          setSelectedCategories(Array.isArray(profile.capabilities) ? profile.capabilities : []);
          setPartnerNotes(profile.summary || "");
          setConsent(true);
          setProfileSaved(Boolean(
            profile.businessName
            && /^\d{11}$/.test(profile.abn || "")
            && profile.addressLine1
            && profile.suburb
            && profile.addressState
            && /^\d{4}$/.test(profile.postcode || ""),
          ));
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

  function selectBusinessAddress(selection: AustralianAddressSuggestion) {
    setAddressLine1([selection.addressLine2, selection.addressLine1].filter(Boolean).join(", "));
    setSuburb(selection.suburb);
    setAddressState(selection.addressState);
    setPostcode(selection.postcode);
  }

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusType("err");
    if (!businessName.trim()) { setStatus("Enter the business name."); return; }
    if (!/^\d{11}$/.test(abn)) { setStatus("Enter the 11 digit Australian Business Number."); return; }
    if (!addressLine1.trim()) { setStatus("Enter the business street address."); return; }
    if (!suburb.trim()) { setStatus("Enter the business suburb or locality."); return; }
    if (!addressState) { setStatus("Choose the business state or territory."); return; }
    if (!/^\d{4}$/.test(postcode.trim())) { setStatus("Enter a four digit business postcode."); return; }
    if (!serviceStates.length) { setStatus("Choose at least one state or territory served."); return; }
    if (!selectedCategories.length) { setStatus("Choose at least one capability or product category."); return; }
    if (!name.trim()) { setStatus("Enter the contact name."); return; }
    if (phone.replace(/\D/g, "").length < 8) { setStatus("Enter the business contact number."); return; }
    if (!consent) { setStatus("Confirm that we may create and maintain the business profile."); return; }
    if (!user) { setStatus("Sign in before saving the business profile."); return; }

    setSending(true);
    setStatusType("");
    setStatus("Saving your TLink account...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          partnerType,
          businessName: businessName.trim(),
          abn,
          addressLine1: addressLine1.trim(),
          suburb: suburb.trim(),
          addressState,
          postcode: postcode.trim(),
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
      setExistingPartnerType(partnerType);
      setStatusType("ok");
      setStatus(
        "Your business profile has been submitted for review. Protected trade access remains locked until the ABN and required business evidence are approved.",
      );
    } catch (error) {
      setStatusType("err");
      setStatus(error instanceof Error ? error.message : "Your business profile could not be saved. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return <main className="wrap direct-trade-request-page">
    <TLinkHeader active="partners" />
    <header className="direct-trade-request-hero trade-account-hero"><div><span>TLink trade accounts</span><h1>Join TLink and run more of your business in one place</h1><p>Create a free business profile, define where your team works and submit the required details for A$0 access to the trade operating platform.</p><div className="trade-account-hero-links"><a className="direct-trade-hero-link" href="/direct-trade/standards">Read the marketplace and customer standards</a><a className="direct-trade-hero-link" href="/direct-trade/access">See what is included for free</a></div></div><aside><strong>No payment details required</strong><p>Approved trades receive CRM, jobs, scheduling, marketplace, team, field and purchasing tools. Matching follows capability, service coverage and availability.</p><span className="trade-free-access-badge">Core access A$0</span></aside></header>

    {!authReady ? <section className="trade-auth-card trade-auth-loading" aria-live="polite"><span className="trade-auth-loader" aria-hidden="true" /><div><strong>Checking your secure sign-in</strong><p>Loading account options...</p></div></section> : !user ? <section className="trade-auth-card" aria-labelledby="trade-account-title">
      <div className="trade-auth-intro"><span>Step 1</span><h2 id="trade-account-title">Create your free TLink account</h2><p>Use Google for the quickest setup, or create an account with your business email.</p></div>
      <div className="trade-auth-panel">
        <button className="trade-google-button" type="button" onClick={useGoogle} disabled={authBusy}><img aria-hidden="true" alt="" src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" />Continue with Google</button>
        <div className="trade-auth-divider"><span>or use email</span></div>
        <div className="trade-auth-tabs" role="group" aria-label="Email account action"><button type="button" aria-pressed={authMode === "create"} className={authMode === "create" ? "selected" : ""} onClick={() => { setAuthMode("create"); setAuthStatus(""); }}>Create account</button><button type="button" aria-pressed={authMode === "signin"} className={authMode === "signin" ? "selected" : ""} onClick={() => { setAuthMode("signin"); setAuthStatus(""); }}>Sign in</button></div>
        <form className="trade-email-form" onSubmit={useEmail} noValidate>
          {authMode === "create" && <Field label="Your name"><input type="text" value={authName} onChange={(event) => setAuthName(event.target.value)} autoComplete="name" /></Field>}
          <Field label="Business email"><input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} autoComplete="email" /></Field>
          <Field label="Password" hint="Use at least eight characters."><input type="password" minLength={8} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} autoComplete={authMode === "create" ? "new-password" : "current-password"} /></Field>
          <button className="btn trade-account-submit" disabled={authBusy}>{authBusy ? "Please wait..." : authMode === "create" ? "Create free account" : "Sign in"}</button>
          {authMode === "signin" && <button className="trade-reset-link" type="button" onClick={resetPassword} disabled={authBusy}>Reset password</button>}
        </form>
        {authStatus && <p className="trade-auth-status" role="status">{authStatus}</p>}
      </div>
      <aside className="trade-auth-benefits"><strong>Build the profile first</strong><ul><li>National service-area and capability profile</li><li>Installer or wholesaler-specific setup</li><li>No payment details or per-lead charge</li><li>Core workspace access after approval</li></ul></aside>
    </section> : <>
      <section className="trade-signed-in" aria-label="Signed in account"><div><span>{profileSaved ? "Profile submitted" : "Secure account connected"}</span><strong>{user.email}</strong><small>{profileSaved ? "Application status is available while trade access remains locked for review." : "Complete the business profile to begin review."}</small></div><div className="trade-signed-in-actions">{profileSaved && <a href="/direct-trade/dashboard">View application status</a>}<button type="button" onClick={() => void signOut(firebaseAuth)}>Sign out</button></div></section>
      <form className="direct-trade-brief" onSubmit={submitProfile} noValidate>
        <section
          className="direct-trade-form-section"
          aria-labelledby="partner-type-title"
        >
          <div className="direct-trade-form-heading">
            <span>Step 2</span>
            <h2 id="partner-type-title">Set up the business profile</h2>
            <p>
              {existingPartnerType
                ? "The account type was fixed when this business account was created. Other business details can still be updated."
                : "Choose the role that best describes the business. This choice is fixed after the account is created. Protected access remains locked until the ABN and required evidence are reviewed and approved."}
            </p>
          </div>
          <div className="partner-type-grid">
            <label className={partnerType === "installer" ? "selected" : ""}>
              <input
                type="radio"
                name="partner-type"
                checked={partnerType === "installer"}
                disabled={Boolean(existingPartnerType)}
                onChange={() => setPartnerType("installer")}
              />
              <span>
                <strong>Licensed installer</strong>
                <small>
                  Install, commission and support household energy upgrades
                  within your service areas.
                </small>
              </span>
            </label>
            <label className={partnerType === "supplier" ? "selected" : ""}>
              <input
                type="radio"
                name="partner-type"
                checked={partnerType === "supplier"}
                disabled={Boolean(existingPartnerType)}
                onChange={() => setPartnerType("supplier")}
              />
              <span>
                <strong>Product supplier or wholesaler</strong>
                <small>
                  Support qualified trades with suitable products, warranty
                  pathways and technical service.
                </small>
              </span>
            </label>
          </div>
        </section>
        <section className="direct-trade-form-section" aria-labelledby="partner-business-title"><div className="direct-trade-form-heading"><span>Step 3</span><h2 id="partner-business-title">Where is the business based and what do you deliver?</h2><p>A business address is required for account integrity and verification. It remains private unless you later choose to publish or share it.</p></div><div className="direct-trade-field-grid trade-account-fields"><Field label="Business name"><input required type="text" value={businessName} onChange={(event) => setBusinessName(event.target.value)} autoComplete="organization" /></Field><Field label="ABN"><input required type="text" inputMode="numeric" pattern="[0-9]{11}" maxLength={11} value={abn} onChange={(event) => setAbn(event.target.value.replace(/\D/g, "").slice(0, 11))} placeholder="11 digit ABN" /></Field><Field label="Business website" optional="optional"><input type="url" value={businessWebsite} onChange={(event) => setBusinessWebsite(event.target.value)} inputMode="url" placeholder="https://example.com.au" /></Field><AustralianAddressLookup className="f" label="Business street address" required value={addressLine1} onChange={setAddressLine1} onSelect={selectBusinessAddress} /><Field label="Suburb or locality"><input required type="text" value={suburb} onChange={(event) => setSuburb(event.target.value)} autoComplete="address-level2" /></Field><Field label="State or territory"><select required value={addressState} onChange={(event) => setAddressState(event.target.value)} autoComplete="address-level1"><option value="">Choose one</option>{states.map((value) => <option value={value} key={value}>{value}</option>)}</select></Field><Field label="Postcode"><input required type="text" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={postcode} onChange={(event) => setPostcode(event.target.value.replace(/\D/g, "").slice(0, 4))} autoComplete="postal-code" /></Field></div><fieldset className="partner-check-group"><legend>States and territories served</legend><div className="partner-chip-grid">{states.map((value) => <label className={serviceStates.includes(value) ? "selected" : ""} key={value}><input type="checkbox" checked={serviceStates.includes(value)} onChange={() => toggle(value, serviceStates, setServiceStates)} />{value}</label>)}</div></fieldset><fieldset className="partner-check-group"><legend>{partnerType === "installer" ? "Installation capabilities" : "Product categories"}</legend><div className="partner-category-grid">{categories.map(([value, label]) => <label className={selectedCategories.includes(value) ? "selected" : ""} key={value}><input type="checkbox" checked={selectedCategories.includes(value)} onChange={() => toggle(value, selectedCategories, setSelectedCategories)} />{label}</label>)}</div></fieldset><Field label={partnerType === "installer" ? "Capabilities and credential summary" : "Products, warranties and support summary"} optional="optional" hint="Maximum 800 characters. Do not upload or paste licence documents, identity records, customer lists, wholesale price files or confidential contracts."><textarea maxLength={800} rows={5} value={partnerNotes} onChange={(event) => setPartnerNotes(event.target.value)} /></Field></section>
        <section className="direct-trade-form-section" aria-labelledby="partner-contact-title"><div className="direct-trade-form-heading"><span>Step 4</span><h2 id="partner-contact-title">Confirm the account contact</h2><p>This person receives account, profile, verification and suitable-opportunity communication.</p></div><div className="direct-trade-field-grid"><Field label="Contact name"><input required type="text" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></Field><Field label="Account email"><input required type="email" value={user.email || ""} readOnly aria-readonly="true" /></Field><Field label="Business contact number"><input required type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" /></Field></div><label className="direct-trade-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I agree that Australian Energy Assessments, as the operator of TLink, may maintain this private business profile and contact me about account activity, verification and suitable opportunities. Account creation does not replace licensing, accreditation, insurance or scheme requirements.</span></label><button className="btn direct-trade-submit" disabled={sending}>{sending ? "Saving..." : profileSaved ? "Update business profile" : "Submit business profile for review"}</button>{status && <p className={`direct-trade-form-status ${statusType}`} role="status">{status}</p>}</section>
      </form>
    </>}
    <SiteFooter>TLink is operated by Australian Energy Assessments. Creating an account does not replace trade licensing, government accreditation, scheme approval, insurance, product compliance or each participant&apos;s customer obligations.</SiteFooter>
  </main>;
}
