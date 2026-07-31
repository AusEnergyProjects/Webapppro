"use client";

/* eslint-disable @next/next/no-img-element */

import { FormEvent, useId, useState } from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { customerEmailVerificationSettings } from "@/lib/firebase-email-actions";
import { Field } from "./ComparatorChrome";

type AuthMode = "create" | "signin";
type AuthStatusTone = "info" | "success" | "error";
type AuthField = "name" | "email" | "password" | null;

function authErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "";
}

function authMessage(error: unknown) {
  const code = authErrorCode(error);
  if (code.includes("email-already-in-use")) return "That email already has an account. Choose Sign in instead.";
  if (code.includes("invalid-credential") || code.includes("wrong-password")) return "The email or password was not recognised.";
  if (code.includes("weak-password")) return "Choose a stronger password with at least eight characters.";
  if (code.includes("popup-closed")) return "Google sign-in was closed before it finished.";
  if (code.includes("popup-blocked")) return "Your browser blocked the Google sign-in window. Allow pop-ups and try again.";
  if (code.includes("too-many-requests")) return "Too many attempts were made. Wait a moment and try again.";
  return "The account action could not be completed. Please try again.";
}

function authErrorField(error: unknown): AuthField {
  const code = authErrorCode(error);
  if (code.includes("email-already-in-use")) return "email";
  if (code.includes("weak-password")) return "password";
  return null;
}

export function FirebaseAccountPanel({
  intent = "account",
}: {
  intent?: "account" | "trade-enquiry";
}) {
  const isTradeEnquiry = intent === "trade-enquiry";
  const idPrefix = useId();
  const emailFormId = `${idPrefix}-email-form`;
  const nameInputId = `${idPrefix}-name`;
  const emailInputId = `${idPrefix}-email`;
  const passwordInputId = `${idPrefix}-password`;
  const passwordHelpId = `${idPrefix}-password-help`;
  const statusId = `${idPrefix}-status`;
  const [mode, setMode] = useState<AuthMode>("create");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<AuthStatusTone>("info");
  const [invalidField, setInvalidField] = useState<AuthField>(null);

  function showStatus(message: string, tone: AuthStatusTone, field: AuthField = null) {
    setStatus(message);
    setStatusTone(tone);
    setInvalidField(field);
  }

  function clearStatus() {
    setStatus("");
    setStatusTone("info");
    setInvalidField(null);
  }

  function fieldErrorDescription(field: Exclude<AuthField, null>) {
    return status && statusTone === "error" && invalidField === field ? statusId : undefined;
  }

  async function useGoogle() {
    setBusy(true);
    showStatus("Opening secure Google sign-in...", "info");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(firebaseAuth, provider);
      showStatus("Signed in. Preparing your private dashboard...", "success");
    } catch (error) {
      showStatus(authMessage(error), "error", authErrorField(error));
    } finally {
      setBusy(false);
    }
  }

  async function useEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accountEmail = email.trim().toLowerCase();
    if (mode === "create" && !name.trim()) { showStatus("Enter your name.", "error", "name"); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(accountEmail)) { showStatus("Enter a valid email address.", "error", "email"); return; }
    if (password.length < 8) { showStatus("Use a password with at least eight characters.", "error", "password"); return; }
    setBusy(true);
    showStatus(mode === "create" ? "Creating your private account..." : "Signing in...", "info");
    try {
      if (mode === "create") {
        const credential = await createUserWithEmailAndPassword(firebaseAuth, accountEmail, password);
        await updateProfile(credential.user, { displayName: name.trim() });
        try {
          await sendEmailVerification(
            credential.user,
            customerEmailVerificationSettings(window.location.origin),
          );
        } catch {
          showStatus(
            "Your account was created, but the verification link could not be sent. Open your dashboard and choose Send verification link.",
            "error",
          );
          setPassword("");
          return;
        }
        showStatus("Account created. We sent a verification link and your free dashboard is ready to set up.", "success");
      } else {
        await signInWithEmailAndPassword(firebaseAuth, accountEmail, password);
        showStatus("Signed in. Preparing your private dashboard...", "success");
      }
      setPassword("");
    } catch (error) {
      showStatus(authMessage(error), "error", authErrorField(error));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    const accountEmail = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(accountEmail)) {
      showStatus("Enter your account email first, then choose Reset password.", "error", "email");
      return;
    }
    setBusy(true);
    showStatus("Sending password reset instructions...", "info");
    try {
      await sendPasswordResetEmail(firebaseAuth, accountEmail);
      showStatus("Password reset instructions have been sent.", "success");
    } catch (error) {
      showStatus(authMessage(error), "error", authErrorField(error));
    } finally {
      setBusy(false);
    }
  }

  return <section className={`customer-auth-card${isTradeEnquiry ? " customer-auth-card-trade-enquiry" : ""}`} aria-labelledby="customer-auth-title">
    <div className="customer-auth-intro">
      <span>{isTradeEnquiry ? "Your plan is ready" : "Free household account"}</span>
      <h2 id="customer-auth-title">{isTradeEnquiry ? "Save your plan, then ask verified trades" : "Keep every home project in one private place"}</h2>
      <p>{isTradeEnquiry ? "Create a free private account or sign in. Your plan choices are already carried across, so you will not need to answer them again." : "Use Google for the quickest setup, or create an account with email. Customer accounts stay free."}</p>
    </div>
    <div className="customer-auth-panel">
      <button className="customer-google-button" type="button" onClick={useGoogle} disabled={busy}><img aria-hidden="true" alt="" src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" />{isTradeEnquiry ? "Continue securely with Google" : "Continue with Google"}</button>
      <div className="customer-auth-divider"><span>or use email</span></div>
      <div className="customer-auth-tabs" role="group" aria-label="Choose an email account action">
        <button type="button" aria-pressed={mode === "create"} aria-controls={emailFormId} className={mode === "create" ? "selected" : ""} onClick={() => { setMode("create"); clearStatus(); }}>Create account</button>
        <button type="button" aria-pressed={mode === "signin"} aria-controls={emailFormId} className={mode === "signin" ? "selected" : ""} onClick={() => { setMode("signin"); clearStatus(); }}>Sign in</button>
      </div>
      <form id={emailFormId} className="customer-email-form" onSubmit={useEmail} noValidate aria-busy={busy}>
        {mode === "create" && <Field label="Your name"><input id={nameInputId} required type="text" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" aria-invalid={invalidField === "name" || undefined} aria-describedby={fieldErrorDescription("name")} /></Field>}
        <Field label="Email"><input id={emailInputId} required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" aria-invalid={invalidField === "email" || undefined} aria-describedby={fieldErrorDescription("email")} /></Field>
        <div className="customer-auth-field">
          <Field label="Password"><input id={passwordInputId} required type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "create" ? "new-password" : "current-password"} aria-invalid={invalidField === "password" || undefined} aria-describedby={[passwordHelpId, fieldErrorDescription("password")].filter(Boolean).join(" ")} /></Field>
          <p className="customer-auth-field-help" id={passwordHelpId}>Use at least eight characters.</p>
        </div>
        <button type="submit" className="btn customer-auth-submit" disabled={busy}>{busy ? "Please wait..." : mode === "create" ? isTradeEnquiry ? "Create account and continue" : "Create my free account" : isTradeEnquiry ? "Sign in and continue" : "Sign in"}</button>
        {mode === "signin" && <button className="customer-reset-link" type="button" onClick={resetPassword} disabled={busy}>Reset password</button>}
      </form>
      {status && <p id={statusId} className={`customer-auth-status ${statusTone}`} role={statusTone === "error" ? "alert" : "status"} aria-atomic="true">{status}</p>}
    </div>
    <aside className="customer-auth-benefits">
      <strong>{isTradeEnquiry ? "Why an account is needed" : "Private by default"}</strong>
      <ul>
        {isTradeEnquiry ? <>
          <li>Your plan stays saved to you and can be updated later</li>
          <li>Verified trades first receive a useful scope, not your identity</li>
          <li>Your phone number and exact address stay hidden during matching</li>
          <li>You choose the business that can contact you</li>
        </> : <>
          <li>No phone number or street address required for planning</li>
          <li>Create and save multiple home projects</li>
          <li>Installers receive an anonymised scope during matching</li>
          <li>You choose any named-installer contact handover</li>
        </>}
      </ul>
    </aside>
  </section>;
}
