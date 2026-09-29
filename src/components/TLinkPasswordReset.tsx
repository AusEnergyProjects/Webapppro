"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { normalizeTLinkPasswordResetContinue } from "@/lib/tlink-password-reset-continue";
import { requestTLinkPasswordReset, tlinkPasswordResetErrorMessage } from "@/lib/tlink-password-reset-client";
import styles from "./TLinkPasswordReset.module.css";

type ResetStage = "checking" | "ready" | "invalid" | "verification-error" | "complete";

function resetErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
}

function expiredCode(error: unknown): boolean {
  return ["auth/expired-action-code", "auth/invalid-action-code", "auth/user-disabled", "auth/user-not-found"].includes(resetErrorCode(error));
}

function passwordErrorMessage(error: unknown): string {
  switch (resetErrorCode(error)) {
    case "auth/weak-password":
    case "auth/password-does-not-meet-requirements":
      return "Choose a stronger password. Use at least 8 characters and include upper and lower case letters, a number and a symbol.";
    case "auth/network-request-failed":
      return "The connection was interrupted. Check your internet connection and try again.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a few minutes, then try again.";
    default:
      return "Your password could not be updated. Please try again.";
  }
}

function EyeIcon({ visible }: { visible: boolean }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />{visible && <path d="m3 3 18 18" />}</svg>;
}

export function TLinkPasswordReset() {
  const [stage, setStage] = useState<ResetStage>("checking");
  const [code, setCode] = useState("");
  const [continuePath, setContinuePath] = useState("/direct-trade/team");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestAccepted, setRequestAccepted] = useState(false);
  const [verificationAttempt, setVerificationAttempt] = useState(0);
  const confirmationRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const actionCode = params.get("oobCode") || "";
    const destination = normalizeTLinkPasswordResetContinue(params.get("continuePath"));
    async function checkLink() {
      setContinuePath(destination);
      setError("");
      setStage("checking");
      if (!actionCode || actionCode.length > 2048) { setStage("invalid"); return; }
      try {
        const accountEmail = await verifyPasswordResetCode(firebaseAuth, actionCode);
        if (active) { setCode(actionCode); setEmail(accountEmail); setStage("ready"); }
      } catch (failure) {
        if (active) {
          setStage(expiredCode(failure) ? "invalid" : "verification-error");
          if (!expiredCode(failure)) setError(resetErrorCode(failure) === "auth/network-request-failed" ? "Check your internet connection, then try opening the link again." : "We could not check this reset link. Please try again.");
        }
      }
    }
    void checkLink();
    return () => { active = false; };
  }, [verificationAttempt]);

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || stage !== "ready") return;
    if (password !== confirmation) {
      setMismatch(true); setError("Your passwords do not match. Enter the same password in both fields."); confirmationRef.current?.focus(); return;
    }
    if (password.length < 8) { setError("Use at least 8 characters for your new password."); return; }
    setBusy(true); setError(""); setMismatch(false);
    try {
      await confirmPasswordReset(firebaseAuth, code, password);
      setPassword(""); setConfirmation(""); setShowPassword(false); setShowConfirmation(false); setCode("");
      window.history.replaceState(window.history.state, "", window.location.pathname);
      setStage("complete");
    } catch (failure) {
      if (expiredCode(failure)) { setPassword(""); setConfirmation(""); setCode(""); setStage("invalid"); }
      else setError(passwordErrorMessage(failure));
    } finally { setBusy(false); }
  }

  async function requestNewLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      await requestTLinkPasswordReset(email, continuePath);
      setRequestAccepted(true);
    } catch (failure) { setError(tlinkPasswordResetErrorMessage(failure)); }
    finally { setBusy(false); }
  }

  const heading = stage === "complete" ? "Password updated" : stage === "invalid" ? "Get a new reset link" : stage === "verification-error" ? "Check your reset link" : "Reset your password";

  return <main id="site-content" className={styles.page}>
    <div className={styles.shell}>
      <div className={styles.brand} aria-label="TLink">
        <Image src="/tlink-icon-192.png" width={48} height={48} alt="" priority />
        <span>TLink</span>
      </div>
      <section className={styles.card} aria-labelledby="reset-heading" aria-busy={busy || stage === "checking"}>
        <div className={styles.symbol} aria-hidden="true">
          {stage === "complete" ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 4 4L19 6" /></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></svg>}
        </div>
        <p className={styles.eyebrow}>YOUR TLINK ACCOUNT</p>
        <h1 id="reset-heading">{heading}</h1>
        {stage === "checking" && <p className={styles.description} role="status">Checking your secure reset link...</p>}
        {stage === "ready" && <>
          <p className={styles.description}>Choose a new password to get back to work.</p>
          <p className={styles.account}>{email}</p>
          <form className={styles.form} onSubmit={savePassword}>
            <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
            <label htmlFor="tlink-new-password">New password</label>
            <div className={styles.passwordControl}>
              <input id="tlink-new-password" name="new-password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required value={password} disabled={busy} aria-describedby="reset-password-hint" onChange={event => { setPassword(event.target.value); setMismatch(false); setError(""); }} />
              <button type="button" className={styles.visibility} aria-label={showPassword ? "Hide new password" : "Show new password"} aria-pressed={showPassword} aria-controls="tlink-new-password" onClick={() => setShowPassword(current => !current)}><EyeIcon visible={showPassword} /></button>
            </div>
            <small id="reset-password-hint" className={styles.hint}>Use at least 8 characters.</small>
            <label htmlFor="tlink-confirm-password">Confirm new password</label>
            <div className={styles.passwordControl}>
              <input id="tlink-confirm-password" name="confirm-password" ref={confirmationRef} type={showConfirmation ? "text" : "password"} autoComplete="new-password" minLength={8} required value={confirmation} disabled={busy} aria-invalid={mismatch} aria-describedby={mismatch ? "reset-error" : undefined} onChange={event => { setConfirmation(event.target.value); setMismatch(false); setError(""); }} />
              <button type="button" className={styles.visibility} aria-label={showConfirmation ? "Hide confirmed password" : "Show confirmed password"} aria-pressed={showConfirmation} aria-controls="tlink-confirm-password" onClick={() => setShowConfirmation(current => !current)}><EyeIcon visible={showConfirmation} /></button>
            </div>
            {error && <p id="reset-error" className={styles.error} role="alert">{error}</p>}
            <button className={styles.primary} type="submit" disabled={busy}>{busy ? "Saving your password..." : "Save new password"}<span aria-hidden="true">→</span></button>
          </form>
        </>}
        {stage === "invalid" && <>
          <p className={styles.description}>This reset link has expired or has already been used. Enter your account email and we’ll help you start again.</p>
          {requestAccepted ? <p className={styles.notice} role="status">Request accepted. If this email has a login, check Inbox and Spam for “Reset your TLink password” from TLink.</p> : <form className={styles.form} onSubmit={requestNewLink}>
            <label htmlFor="tlink-reset-email">Account email</label>
            <input id="tlink-reset-email" type="email" name="email" autoComplete="email" required maxLength={254} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} />
            {error && <p className={styles.error} role="alert">{error}</p>}
            <button className={styles.primary} type="submit" disabled={busy}>{busy ? "Requesting your link..." : "Send a new reset link"}<span aria-hidden="true">→</span></button>
          </form>}
        </>}
        {stage === "verification-error" && <>
          <p className={styles.description} role="alert">{error}</p>
          <button className={styles.primary} type="button" onClick={() => setVerificationAttempt(current => current + 1)}>Try again<span aria-hidden="true">→</span></button>
        </>}
        {stage === "complete" && <>
          <p className={styles.description}>Your password has been updated. Sign in with your new password to continue.</p>
          <a className={styles.primary} href={continuePath}>Continue to sign in<span aria-hidden="true">→</span></a>
        </>}
        <p className={styles.support}>Need a hand? <a href="mailto:info@ausenergyassessments.com">Contact the TLink team</a></p>
      </section>
      <p className={styles.footer}>TLink by Australian Energy Assessments</p>
    </div>
  </main>;
}
