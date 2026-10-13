"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  browserPopupRedirectResolver, createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged,
  reload, sendEmailVerification, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile, type User,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { requestTLinkPasswordReset, tlinkPasswordResetErrorMessage } from "@/lib/tlink-password-reset-client";
import { FirebaseMfaChallenge, useFirebaseMfaChallenge } from "./FirebaseMfa";
import { TLinkMark } from "./TLinkChrome";
import { teamAuthErrorCode, teamAuthErrorMessage } from "./trade-team-auth-errors";
import styles from "./CreditexInvitationSetup.module.css";

type Invitation = { email: string; displayName: string; workspaceName: string; expiresAt: string };
type LoadingState = "loading" | "ready" | "unavailable" | "error";
type Notice = { text: string; error: boolean };

function invitationDetails(value: unknown): Invitation | null {
  if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== true || !("invitation" in value)) return null;
  const invitation = value.invitation;
  if (!invitation || typeof invitation !== "object"
    || !("email" in invitation) || typeof invitation.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitation.email)
    || !("displayName" in invitation) || typeof invitation.displayName !== "string"
    || !("workspaceName" in invitation) || typeof invitation.workspaceName !== "string"
    || !("expiresAt" in invitation) || typeof invitation.expiresAt !== "string" || !Number.isFinite(Date.parse(invitation.expiresAt))) return null;
  return { email: invitation.email.trim().toLowerCase(), displayName: invitation.displayName, workspaceName: invitation.workspaceName, expiresAt: invitation.expiresAt };
}

function invitedAccount(account: User | null, invitation: Invitation | null): boolean {
  return Boolean(account?.email && invitation && account.email.trim().toLowerCase() === invitation.email);
}

export function CreditexInvitationSetup({ invitationId, onComplete }: {
  invitationId: string;
  onComplete: () => void | Promise<void>;
}) {
  const id = useId();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>("loading");
  const [attempt, setAttempt] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authDelayed, setAuthDelayed] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [mode, setMode] = useState<"create" | "signin">("create");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>({ text: "", error: false });
  const lifetime = useRef({ active: false, invitationId });
  const operation = useRef(0);
  const actionPending = useRef(false);
  const completedAccount = useRef("");
  const automaticEntry = useRef("");
  const { resolver, captureMfaError, clearMfaChallenge } = useFirebaseMfaChallenge();

  const clearPasswords = useCallback(() => {
    setPassword(""); setShowPassword(false);
  }, []);

  useEffect(() => {
    const current = { active: true, invitationId };
    const operationState = operation;
    const pendingState = actionPending;
    lifetime.current = current;
    const deadline = window.setTimeout(() => {
      if (current.active) setAuthDelayed(true);
    }, 10_000);
    const unsubscribe = onAuthStateChanged(firebaseAuth, next => {
      if (!current.active) return;
      window.clearTimeout(deadline);
      setUser(next); setEmailVerified(Boolean(next?.emailVerified)); setAuthReady(true); setAuthDelayed(false);
      clearPasswords();
    }, () => {
      if (current.active) { window.clearTimeout(deadline); setAuthDelayed(true); }
    });
    return () => {
      current.active = false; operationState.current++; pendingState.current = false;
      window.clearTimeout(deadline); unsubscribe();
    };
  }, [invitationId, clearPasswords]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let deadline: number | undefined;
    const start = window.setTimeout(() => {
      if (!active) return;
      setInvitation(null); setLoadingState("loading"); setNotice({ text: "", error: false });
      setBusy(false); actionPending.current = false; operation.current++; clearPasswords();
      deadline = window.setTimeout(() => {
        if (!active) return;
        controller.abort(); setLoadingState("error");
        setNotice({ text: "We could not open your invitation. Check your connection and try again.", error: true });
      }, 10_000);
      void (async () => {
        const response = await fetch(`/api/creditex/invitation?invite=${encodeURIComponent(invitationId)}`, {
          cache: "no-store", credentials: "omit", signal: controller.signal,
        });
        if (!active || controller.signal.aborted) return;
        if (response.status === 404 || response.status === 410) {
          setLoadingState("unavailable");
          setNotice({ text: "This invitation is no longer available. Ask your administrator for a new invitation.", error: true });
          return;
        }
        if (!response.ok) throw new Error("INVITATION_CONNECTION");
        const details = invitationDetails(await response.json());
        if (!active || controller.signal.aborted) return;
        if (!details) throw new Error("INVITATION_RESPONSE");
        setInvitation(details); setLoadingState("ready");
      })().catch(() => {
        if (active && !controller.signal.aborted) {
          setLoadingState("error");
          setNotice({ text: "We could not open your invitation. Check your connection and try again.", error: true });
        }
      }).finally(() => { if (deadline !== undefined) window.clearTimeout(deadline); });
    }, 0);
    return () => { active = false; controller.abort(); window.clearTimeout(start); if (deadline !== undefined) window.clearTimeout(deadline); };
  }, [invitationId, attempt, clearPasswords]);

  const stillActive = useCallback((ticket: number): boolean => {
    return lifetime.current.active && lifetime.current.invitationId === invitationId && operation.current === ticket;
  }, [invitationId]);

  const startAction = useCallback((message: string, keepNotice = false): number | null => {
    if (actionPending.current || loadingState !== "ready" || !invitation || !lifetime.current.active) return null;
    actionPending.current = true;
    const ticket = ++operation.current;
    setBusy(true); if (!keepNotice) setNotice({ text: message, error: false });
    return ticket;
  }, [loadingState, invitation]);

  const finishAction = useCallback((ticket: number) => {
    if (!stillActive(ticket)) return;
    actionPending.current = false; setBusy(false);
  }, [stillActive]);

  function verificationSettings() {
    const target = new URL("/creditex/compliance", window.location.origin);
    target.searchParams.set("invite", invitationId);
    return { url: target.toString() };
  }

  const verifyAccount = useCallback(async (account: User, ticket: number, automatic = false) => {
    if (!stillActive(ticket) || !invitedAccount(account, invitation) || firebaseAuth.currentUser?.uid !== account.uid) return;
    const accountKey = `${invitationId}:${account.uid}`;
    automaticEntry.current = accountKey;
    await reload(account);
    if (!stillActive(ticket) || firebaseAuth.currentUser?.uid !== account.uid || !invitedAccount(account, invitation)) return;
    setUser(account); setEmailVerified(account.emailVerified);
    if (!account.emailVerified) {
      if (!automatic) setNotice({ text: "Open the verification email and click its link once. Creditex will open when you return here.", error: false });
      return;
    }
    await account.getIdToken(true);
    if (!stillActive(ticket) || firebaseAuth.currentUser?.uid !== account.uid || !account.emailVerified || !invitedAccount(account, invitation)) return;
    if (completedAccount.current === accountKey) return;
    completedAccount.current = accountKey;
    try { await onComplete(); }
    catch (error) { if (completedAccount.current === accountKey) completedAccount.current = ""; throw error; }
  }, [stillActive, invitation, invitationId, onComplete]);

  async function sendVerification(account: User, ticket: number) {
    if (!stillActive(ticket) || !invitedAccount(account, invitation) || firebaseAuth.currentUser?.uid !== account.uid) return;
    try {
      await sendEmailVerification(account, verificationSettings());
      if (stillActive(ticket)) setNotice({ text: `We requested a verification email for ${invitation?.email}. Check Inbox and Spam, then click the link once.`, error: false });
    } catch (error) {
      if (stillActive(ticket)) setNotice({ text: `Your account is saved, but the verification email could not be sent. ${teamAuthErrorMessage(error)} Use Resend verification email to try again.`, error: true });
    }
  }

  async function emailAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invitation || user || firebaseAuth.currentUser || !authReady || actionPending.current) return;
    if (mode === "create" && password.length < 8) {
      setNotice({ text: "Use at least 8 characters for your new password.", error: true }); return;
    }
    const ticket = startAction(mode === "create" ? "Creating your TLink account..." : "Signing in...");
    if (ticket === null) return;
    try {
      const credential = mode === "create"
        ? await createUserWithEmailAndPassword(firebaseAuth, invitation.email, password)
        : await signInWithEmailAndPassword(firebaseAuth, invitation.email, password);
      if (!stillActive(ticket)) return;
      clearPasswords();
      setUser(credential.user); setEmailVerified(credential.user.emailVerified);
      if (!invitedAccount(credential.user, invitation)) {
        setNotice({ text: "Use the invited email address to open this workspace.", error: true }); return;
      }
      automaticEntry.current = `${invitationId}:${credential.user.uid}`;
      if (mode === "create") {
        if (!credential.user.displayName && invitation.displayName) {
          try { await updateProfile(credential.user, { displayName: invitation.displayName }); }
          catch { /* The invited membership supplies the name. Email verification must still be available. */ }
        }
        await sendVerification(credential.user, ticket);
      } else await verifyAccount(credential.user, ticket);
    } catch (error) {
      if (!stillActive(ticket)) return;
      if (teamAuthErrorCode(error) === "auth/email-already-in-use") {
        setMode("signin");
        setNotice({ text: "This email already has a TLink account. The new password you entered was not saved. Sign in with your existing password, continue with Google, or request a password reset below.", error: false });
      } else if (!captureMfaError(error)) setNotice({ text: teamAuthErrorMessage(error), error: true });
    } finally {
      if (stillActive(ticket)) clearPasswords();
      finishAction(ticket);
    }
  }

  async function google() {
    if (user || firebaseAuth.currentUser || !authReady) return;
    const ticket = startAction("Opening Google sign-in...");
    if (ticket === null) return;
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account", login_hint: invitation?.email || "" });
      const credential = await signInWithPopup(firebaseAuth, provider, browserPopupRedirectResolver);
      if (!stillActive(ticket)) return;
      clearPasswords(); setUser(credential.user); setEmailVerified(credential.user.emailVerified);
      if (!invitedAccount(credential.user, invitation)) {
        setNotice({ text: "Google signed in with a different email. Switch account and choose the email on this invitation.", error: true }); return;
      }
      await verifyAccount(credential.user, ticket);
    } catch (error) {
      if (stillActive(ticket) && !captureMfaError(error)) setNotice({ text: teamAuthErrorMessage(error), error: true });
    } finally { if (stillActive(ticket)) clearPasswords(); finishAction(ticket); }
  }

  const continueToWorkspace = useCallback(async (automatic = false) => {
    const account = firebaseAuth.currentUser;
    if (!account || !invitedAccount(account, invitation)) return;
    if (completedAccount.current === `${invitationId}:${account.uid}`) return;
    const ticket = startAction("Checking your account...", automatic);
    if (ticket === null) return;
    try { await verifyAccount(account, ticket, automatic); }
    catch (error) { if (stillActive(ticket)) setNotice({ text: teamAuthErrorMessage(error), error: true }); }
    finally { finishAction(ticket); }
  }, [invitation, invitationId, startAction, verifyAccount, stillActive, finishAction]);

  useEffect(() => {
    if (loadingState !== "ready" || !authReady || resolver || !invitedAccount(user, invitation)) return;
    let active = true;
    const check = () => {
      if (active && document.visibilityState === "visible") void continueToWorkspace(true);
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    const accountKey = `${invitationId}:${user?.uid}`;
    if (user && automaticEntry.current !== accountKey) {
      automaticEntry.current = accountKey; void Promise.resolve().then(check);
    }
    return () => {
      active = false; window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check);
    };
  }, [loadingState, authReady, resolver, user, invitation, invitationId, continueToWorkspace]);

  async function resendVerification() {
    const account = firebaseAuth.currentUser;
    if (!account || !invitedAccount(account, invitation)) return;
    const ticket = startAction("Requesting your verification email...");
    if (ticket === null) return;
    try { await sendVerification(account, ticket); }
    finally { finishAction(ticket); }
  }

  async function resetPassword() {
    if (!invitation) return;
    const ticket = startAction("Requesting your password reset...");
    if (ticket === null) return;
    try {
      await requestTLinkPasswordReset(invitation.email, "/creditex/compliance");
      if (stillActive(ticket)) setNotice({ text: "Request accepted. If this email has a login, check Inbox and Spam for Reset your TLink password. After setting your password, return to this invitation to sign in.", error: false });
    } catch (error) { if (stillActive(ticket)) setNotice({ text: tlinkPasswordResetErrorMessage(error), error: true }); }
    finally { finishAction(ticket); }
  }

  async function switchAccount() {
    const ticket = startAction("Signing out of this account...");
    if (ticket === null) return;
    try {
      await signOut(firebaseAuth);
      if (stillActive(ticket)) { clearPasswords(); setUser(null); setEmailVerified(false); setNotice({ text: "", error: false }); }
    } catch (error) { if (stillActive(ticket)) setNotice({ text: teamAuthErrorMessage(error), error: true }); }
    finally { finishAction(ticket); }
  }

  const matches = invitedAccount(user, invitation);
  return <main className={styles.shell}>
    <div className={styles.brand}><TLinkMark size={44} /><div><strong>TLink</strong><span>Creditex team invitation</span></div></div>
    <section className={styles.card} aria-labelledby={`${id}-title`} aria-busy={busy || loadingState === "loading"}>
      <span className={styles.eyebrow}>Your invitation</span>
      <h1 id={`${id}-title`}>{loadingState === "unavailable" ? "Ask for a new invitation" : "You've been invited"}</h1>
      {loadingState === "loading" ? <p role="status">Opening your invitation...</p>
        : loadingState === "error" || loadingState === "unavailable" ? <>
          <p role="alert" className={styles.notice}>{notice.text}</p>
          {loadingState === "error" && <button type="button" className={styles.primary} onClick={() => setAttempt(current => current + 1)}>Try again</button>}
          <a className={styles.link} href="/creditex/compliance">Already joined? Sign in to Creditex</a>
        </> : invitation && <>
          <p className={styles.intro}>{invitation.displayName ? `${invitation.displayName}, join` : "Join"} {invitation.workspaceName} on TLink.</p>
          {!authReady ? <><p role="status">{authDelayed ? "Sign-in is taking longer than expected. Check your connection and try again." : "Checking your sign-in..."}</p>{authDelayed && <button type="button" className={styles.primary} onClick={() => window.location.reload()}>Try again</button>}</>
            : resolver ? <FirebaseMfaChallenge resolver={resolver} onCancel={() => { clearMfaChallenge(); setNotice({ text: "Sign-in was cancelled. Try again when you are ready.", error: false }); }} onComplete={async () => { clearMfaChallenge(); await continueToWorkspace(); }} />
              : user && !matches ? <div className={styles.accountState}>
                <h2>Use your invited email</h2><p>This invitation is for <strong>{invitation.email}</strong>. You are signed in as <strong>{user.email || "another account"}</strong>.</p>
                <button type="button" className={styles.primary} disabled={busy} onClick={() => void switchAccount()}>Switch account</button>
              </div> : user ? <div className={styles.accountState}>
                <h2>{emailVerified ? "Your account is ready" : "Check your email"}</h2>
                <p>{emailVerified ? <>You are signed in as <strong>{invitation.email}</strong>. Opening {invitation.workspaceName}...</> : <>You are signed in as <strong>{invitation.email}</strong>. Click the link in your verification email once. Creditex will open automatically when you return here.</>}</p>
                <button type="button" className={styles.primary} disabled={busy} onClick={() => void continueToWorkspace()}>{busy ? "Please wait..." : emailVerified ? "Continue to Creditex" : "I've verified my email"}</button>
                {!emailVerified && <button type="button" className={styles.secondary} disabled={busy} onClick={() => void resendVerification()}>Resend verification email</button>}
                <button type="button" className={styles.link} disabled={busy} onClick={() => void switchAccount()}>Use another account</button>
              </div> : <>
                <div className={styles.modeChoice} role="group" aria-label="Account choice">
                  <button type="button" aria-pressed={mode === "create"} disabled={busy} onClick={() => { clearPasswords(); setNotice({ text: "", error: false }); setMode("create"); }}>Create account</button>
                  <button type="button" aria-pressed={mode === "signin"} disabled={busy} onClick={() => { clearPasswords(); setNotice({ text: "", error: false }); setMode("signin"); }}>Sign in</button>
                </div>
                <form className={styles.form} onSubmit={emailAuth}>
                  <label htmlFor={`${id}-email`}>Email</label>
                  <input id={`${id}-email`} type="email" autoComplete="email" value={invitation.email} readOnly />
                  <label htmlFor={`${id}-password`}>{mode === "create" ? "Choose your password" : "Password"}</label>
                  <div className={styles.passwordControl}>
                    <input id={`${id}-password`} type={showPassword ? "text" : "password"} autoComplete={mode === "create" ? "new-password" : "current-password"} minLength={mode === "create" ? 8 : undefined} required value={password} disabled={busy} onChange={event => setPassword(event.target.value)} />
                    <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} aria-controls={`${id}-password`} disabled={busy} onClick={() => setShowPassword(current => !current)}>{showPassword ? "Hide" : "Show"}</button>
                  </div>
                  {mode === "create" && <small>Use at least 8 characters. Your account signs in automatically.</small>}
                  <button type="submit" className={styles.primary} disabled={busy}>{busy ? "Please wait..." : mode === "create" ? "Create account" : "Sign in"}</button>
                  {mode === "signin" && <button type="button" className={styles.link} disabled={busy} onClick={() => void resetPassword()}>Forgot password?</button>}
                </form>
                <div className={styles.divider}><span>or</span></div>
                <button type="button" className={styles.google} disabled={busy} onClick={() => void google()}><span aria-hidden="true">G</span>Continue with Google</button>
              </>}
          {notice.text && <p className={`${styles.notice} ${notice.error ? styles.error : ""}`} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
          {!user && <p className={styles.footer}>New account? We will email a verification link. Click it once, then return here to open Creditex.</p>}
        </>}
    </section>
    <Link className={styles.home} href="/">Australian Energy Assessments</Link>
  </main>;
}
