"use client";

/* eslint-disable @next/next/no-img-element */

import { FormEvent, useState } from "react";
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
import { Field } from "./ComparatorChrome";

type AuthMode = "create" | "signin";

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

export function FirebaseAccountPanel() {
  const [mode, setMode] = useState<AuthMode>("create");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function useGoogle() {
    setBusy(true);
    setStatus("Opening secure Google sign-in...");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(firebaseAuth, provider);
      setStatus("Signed in. Preparing your private dashboard...");
    } catch (error) {
      setStatus(authMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function useEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accountEmail = email.trim().toLowerCase();
    if (mode === "create" && !name.trim()) { setStatus("Enter your name."); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(accountEmail)) { setStatus("Enter a valid email address."); return; }
    if (password.length < 8) { setStatus("Use a password with at least eight characters."); return; }
    setBusy(true);
    setStatus(mode === "create" ? "Creating your private account..." : "Signing in...");
    try {
      if (mode === "create") {
        const credential = await createUserWithEmailAndPassword(firebaseAuth, accountEmail, password);
        await updateProfile(credential.user, { displayName: name.trim() });
        await sendEmailVerification(credential.user).catch(() => undefined);
        setStatus("Account created. We sent a verification link and your free dashboard is ready to set up.");
      } else {
        await signInWithEmailAndPassword(firebaseAuth, accountEmail, password);
        setStatus("Signed in. Preparing your private dashboard...");
      }
      setPassword("");
    } catch (error) {
      setStatus(authMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    const accountEmail = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(accountEmail)) {
      setStatus("Enter your account email first, then choose Reset password.");
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(firebaseAuth, accountEmail);
      setStatus("Password reset instructions have been sent.");
    } catch (error) {
      setStatus(authMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return <section className="customer-auth-card" aria-labelledby="customer-auth-title">
    <div className="customer-auth-intro"><span>Free household account</span><h2 id="customer-auth-title">Keep every home project in one private place</h2><p>Use Google for the quickest setup, or create an account with email. Customer accounts stay free.</p></div>
    <div className="customer-auth-panel">
      <button className="customer-google-button" type="button" onClick={useGoogle} disabled={busy}><img aria-hidden="true" alt="" src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" />Continue with Google</button>
      <div className="customer-auth-divider"><span>or use email</span></div>
      <div className="customer-auth-tabs" role="group" aria-label="Email account action"><button type="button" aria-pressed={mode === "create"} className={mode === "create" ? "selected" : ""} onClick={() => { setMode("create"); setStatus(""); }}>Create account</button><button type="button" aria-pressed={mode === "signin"} className={mode === "signin" ? "selected" : ""} onClick={() => { setMode("signin"); setStatus(""); }}>Sign in</button></div>
      <form className="customer-email-form" onSubmit={useEmail} noValidate>
        {mode === "create" && <Field label="Your name"><input type="text" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></Field>}
        <Field label="Email"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></Field>
        <Field label="Password" hint="Use at least eight characters."><input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "create" ? "new-password" : "current-password"} /></Field>
        <button className="btn customer-auth-submit" disabled={busy}>{busy ? "Please wait..." : mode === "create" ? "Create my free account" : "Sign in"}</button>
        {mode === "signin" && <button className="customer-reset-link" type="button" onClick={resetPassword} disabled={busy}>Reset password</button>}
      </form>
      {status && <p className="customer-auth-status" role="status">{status}</p>}
    </div>
    <aside className="customer-auth-benefits"><strong>Private by default</strong><ul><li>No phone number or street address required</li><li>Create and save multiple home projects</li><li>Installers receive an anonymised scope only</li><li>No direct trade messaging or sales calls</li></ul></aside>
  </section>;
}
