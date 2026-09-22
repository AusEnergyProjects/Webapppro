"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { FirebaseError } from "firebase/app";
import {
  EmailAuthProvider, GoogleAuthProvider, getMultiFactorResolver, multiFactor,
  reauthenticateWithCredential, reauthenticateWithPopup, sendEmailVerification,
  TotpMultiFactorGenerator, type MultiFactorError, type MultiFactorResolver,
  type TotpSecret, type User,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { firebaseSecondFactorClaim } from "@/lib/firebase-mfa";
import styles from "./FirebaseMfa.module.css";

function isMultiFactorError(error: unknown): error is MultiFactorError {
  return error instanceof FirebaseError && error.code === "auth/multi-factor-auth-required";
}

export function useFirebaseMfaChallenge() {
  const [resolver, setResolver] = useState<MultiFactorResolver | null>(null);
  const captureMfaError = useCallback((error: unknown) => {
    if (!isMultiFactorError(error)) return false;
    setResolver(getMultiFactorResolver(firebaseAuth, error));
    return true;
  }, []);
  const clearMfaChallenge = useCallback(() => setResolver(null), []);
  return { resolver, captureMfaError, clearMfaChallenge };
}

function mfaMessage(error: unknown) {
  const code = error instanceof FirebaseError ? error.code : "";
  if (code === "auth/invalid-verification-code") return "That code was not accepted. Enter the current code from your authenticator.";
  if (code === "auth/code-expired" || code === "auth/session-expired") return "This verification expired. Cancel and start again.";
  if (code === "auth/too-many-requests") return "Too many attempts. Wait a moment before trying again.";
  if (code === "auth/requires-recent-login" || code === "auth/invalid-credential") return "Confirm your password or Google account again before continuing.";
  if (code === "auth/unverified-email") return "Verify your email address before adding an authenticator.";
  if (code === "auth/operation-not-allowed" || code === "auth/unsupported-first-factor") return "Authenticator setup is not available for this account yet. Contact support for help.";
  if (code === "auth/popup-closed-by-user") return "Google verification was closed. Try again when you are ready.";
  return "Account verification could not be completed. Try again or contact support.";
}

export function FirebaseMfaChallenge({ resolver, onCancel, onComplete }: {
  resolver: MultiFactorResolver;
  onCancel: () => void;
  onComplete: () => void | Promise<void>;
}) {
  const id = useId();
  const factors = resolver.hints.filter((hint) => hint.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  const [factorUid, setFactorUid] = useState(factors[0]?.uid || "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (busy || !factors.some((factor) => factor.uid === factorUid)) return;
    setBusy(true);
    setStatus("");
    try {
      const credential = await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(factorUid, code));
      setCode("");
      await credential.user.getIdToken(true);
      await onComplete();
    } catch (error) { setCode(""); setStatus(mfaMessage(error)); }
    finally { setBusy(false); }
  }
  return <section className={styles.card} aria-labelledby={`${id}-title`}>
    <span className={styles.eyebrow}>Secure sign-in</span>
    <h2 id={`${id}-title`}>Enter your authenticator code</h2>
    <p>Open your authenticator app and enter the current six-digit code for TLink.</p>
    {factors.length ? <form onSubmit={verify}>
      {factors.length > 1 && <label>Authenticator<select value={factorUid} onChange={(event) => { setFactorUid(event.target.value); setCode(""); }}>{factors.map((factor, index) => <option key={factor.uid} value={factor.uid}>{factor.displayName || `Authenticator ${index + 1}`}</option>)}</select></label>}
      <label htmlFor={`${id}-code`}>Six-digit code</label>
      <input id={`${id}-code`} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required autoFocus />
      <div className={styles.actions}><button type="submit" disabled={busy}>{busy ? "Verifying..." : "Verify and continue"}</button><button type="button" className={styles.secondary} disabled={busy} onClick={onCancel}>Cancel</button></div>
    </form> : <><p role="alert">This account uses an unsupported second factor. Contact support to restore authenticator access.</p><button type="button" onClick={onCancel}>Back to sign-in</button></>}
    {status && <p role="alert" className={styles.status}>{status}</p>}
    <small>Never share your setup key or authentication codes with support.</small>
  </section>;
}

export function FirebaseAccountSecurity({ user, onComplete }: { user: User; onComplete?: () => void | Promise<void> }) {
  const id = useId();
  const { resolver, captureMfaError, clearMfaChallenge } = useFirebaseMfaChallenge();
  const [password, setPassword] = useState("");
  const [secret, setSecret] = useState<TotpSecret | null>(null);
  const [code, setCode] = useState("");
  const [emailVerified, setEmailVerified] = useState(user.emailVerified);
  const [enrolled, setEnrolled] = useState(multiFactor(user).enrolledFactors.length > 0);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const hasPassword = user.providerData.some((provider) => provider.providerId === "password");
  const hasGoogle = user.providerData.some((provider) => provider.providerId === "google.com");

  useEffect(() => {
    let active = true;
    void user.getIdTokenResult().then((token) => {
      if (active) setVerified(Boolean(firebaseSecondFactorClaim(token.claims.firebase)));
    }).catch(() => { if (active) setStatus("Sign in again to check account security."); });
    return () => { active = false; };
  }, [user]);

  async function finishVerification() {
    const activeUser = firebaseAuth.currentUser;
    if (!activeUser || activeUser.uid !== user.uid) throw new Error("The signed-in account changed.");
    const token = await activeUser.getIdTokenResult(true);
    const complete = Boolean(firebaseSecondFactorClaim(token.claims.firebase));
    setVerified(complete);
    if (complete) {
      setStatus("Your authenticator is verified for this sign-in.");
      await onComplete?.();
    } else setStatus("Your authenticator is added. Confirm your account below, then enter its current code to finish.");
  }

  async function start(method: "password" | "google") {
    setBusy(true); setStatus(""); setSecret(null); setCode("");
    try {
      await user.reload();
      setEmailVerified(user.emailVerified);
      if (!user.emailVerified) { setStatus("Verify your email address first, then select Check verification."); return; }
      if (method === "google") {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ login_hint: user.email || "", prompt: "select_account" });
        await reauthenticateWithPopup(user, provider);
      } else await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email || "", password));
      setPassword("");
      if (multiFactor(user).enrolledFactors.length) {
        setEnrolled(true);
        await finishVerification();
      } else {
        const session = await multiFactor(user).getSession();
        setSecret(await TotpMultiFactorGenerator.generateSecret(session));
      }
    } catch (error) {
      setPassword("");
      if (!captureMfaError(error)) setStatus(mfaMessage(error));
    } finally { setBusy(false); }
  }

  async function enroll(event: FormEvent) {
    event.preventDefault();
    if (!secret || busy) return;
    setBusy(true); setStatus("");
    try {
      await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, code), "TLink authenticator");
      setSecret(null); setCode(""); setEnrolled(true);
      await finishVerification();
    } catch (error) { setCode(""); setStatus(mfaMessage(error)); }
    finally { setBusy(false); }
  }

  async function emailAction(send: boolean) {
    setBusy(true);
    try {
      if (send) { await sendEmailVerification(user); setStatus("Verification email sent. Open its link, then return here."); }
      else { await user.reload(); setEmailVerified(user.emailVerified); setStatus(user.emailVerified ? "Email verified. Continue below." : "This email is not verified yet. Open the link in your verification email."); }
    } catch (error) { setStatus(mfaMessage(error)); }
    finally { setBusy(false); }
  }

  if (resolver) return <FirebaseMfaChallenge resolver={resolver} onCancel={clearMfaChallenge} onComplete={async () => { clearMfaChallenge(); await finishVerification(); }} />;
  return <section className={styles.card} aria-labelledby={`${id}-title`}>
    <span className={styles.eyebrow}>Account security</span>
    <h2 id={`${id}-title`}>{verified ? "Authenticator verified" : enrolled ? "Verify your authenticator" : "Protect your account"}</h2>
    <p>{verified ? "This sign-in includes a verified second factor." : "Use an authenticator app to protect administrative access and MYOB financial records. You will also use it when signing in to other TLink workspaces."}</p>
    <p className={styles.account}>{user.email}</p>
    {!emailVerified ? <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void emailAction(true)}>Send verification email</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => void emailAction(false)}>Check verification</button></div> : secret ? <form onSubmit={enroll}>
      <p>In your authenticator app, add an account using a setup key. Choose <strong>Time based</strong>, name it <strong>TLink</strong>, and enter this key.</p>
      <label htmlFor={`${id}-secret`}>Private setup key</label><input id={`${id}-secret`} className={styles.secret} value={secret.secretKey} readOnly autoComplete="off" spellCheck={false} onFocus={(event) => event.target.select()} />
      <small>Keep this key private. It is shown only during setup and is not saved in the browser.</small>
      <label htmlFor={`${id}-enroll-code`}>Code from your authenticator</label><input id={`${id}-enroll-code`} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required />
      <div className={styles.actions}><button type="submit" disabled={busy}>{busy ? "Verifying..." : "Add authenticator"}</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => { setSecret(null); setCode(""); }}>Cancel setup</button></div>
    </form> : !verified && <>
      <p>{enrolled ? "Confirm your account, then enter the code from your authenticator." : "Confirm your account to create your private authenticator setup key."}</p>
      {hasPassword && <form onSubmit={(event) => { event.preventDefault(); void start("password"); }}><label htmlFor={`${id}-password`}>Current password</label><input id={`${id}-password`} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /><button type="submit" disabled={busy}>{busy ? "Please wait..." : enrolled ? "Continue to verification" : "Set up authenticator"}</button></form>}
      {hasGoogle && <button type="button" className={styles.secondary} disabled={busy} onClick={() => void start("google")}>Continue with Google</button>}
      {!hasPassword && !hasGoogle && <p role="alert">Contact support to enable a supported sign-in method for this account.</p>}
    </>}
    {status && <p role="status" className={styles.status}>{status}</p>}
    <small>Lost your authenticator? Contact info@ausenergyassessments.com for identity-verified recovery. Support will never ask for your setup key.</small>
  </section>;
}
