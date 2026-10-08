"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onIdTokenChanged, reload, sendEmailVerification, signOut, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { disableTradeDeviceNotifications } from "@/lib/trade-device-client";
import { createTradeBusinessFetch, readTradeBusinessSelection, resolveTradeBusinessSelection, saveTradeBusinessSelection, type TradeBusinessChoice } from "@/lib/trade-business-client";
import styles from "./TradeBusinessProvider.module.css";
import { TradeWorkTimeProvider } from "./TradeWorkTimeTracking";
import { TLinkWorkspaceBar } from "./TLinkWorkspaceBar";

type BusinessContext = { business: TradeBusinessChoice; request: typeof fetch; updatePersonalName?: (name: string) => void };
const Context = createContext<BusinessContext | null>(null);
const unscopedFetch: typeof fetch = (input, init) => fetch(input, init);

export function useTradeBusinessFetch(): typeof fetch { return useContext(Context)?.request || unscopedFetch; }
export function useTradeBusiness(): TradeBusinessChoice | null { return useContext(Context)?.business || null; }
export function useTradePersonalNameUpdate() { return useContext(Context)?.updatePersonalName; }

export function TradeBusinessProvider({ business, children, onAccessLost, onPersonalNameChange }: { business: TradeBusinessChoice; children: ReactNode; onAccessLost?: () => void; onPersonalNameChange?: (name: string) => void }) {
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const reportAccessLost = useCallback(() => { if (active.current) onAccessLost?.(); }, [onAccessLost]);
  const request = useCallback<typeof fetch>((input, init) => createTradeBusinessFetch(business.ownerUid, window.location.origin, fetch, reportAccessLost)(input, init), [business.ownerUid, reportAccessLost]);
  const value = useMemo(() => ({ business, request, updatePersonalName: onPersonalNameChange }), [business, request, onPersonalNameChange]);
  return <Context.Provider value={value}><TradeWorkTimeProvider ownerUid={business.ownerUid} request={request}>{children}</TradeWorkTimeProvider></Context.Provider>;
}

export function TradeBusinessGate({ destination, children }: { destination: "owner" | "member" | "messages"; children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [businesses, setBusinesses] = useState<TradeBusinessChoice[]>([]);
  const [selected, setSelected] = useState<TradeBusinessChoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [verificationSending, setVerificationSending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
  const previousUid = useRef("");
  const identityState = useRef("");
  const identityRevision = useRef(0);

  useEffect(() => onIdTokenChanged(firebaseAuth, next => {
    const nextState = `${next?.uid || ""}:${Boolean(next?.emailVerified)}`;
    if (identityState.current === nextState) return;
    identityState.current = nextState;
    if (previousUid.current !== (next?.uid || "")) identityRevision.current++;
    if (previousUid.current && previousUid.current !== next?.uid) saveTradeBusinessSelection(previousUid.current, "");
    previousUid.current = next?.uid || "";
    setUser(next); setEmailVerified(Boolean(next?.emailVerified)); setAuthReady(true); setSelected(null); setBusinesses([]); setLoading(Boolean(next)); setError("");
    setVerificationSending(false); setSigningOut(false); setAccountMessage("");
  }), []);

  const choose = useCallback((business: TradeBusinessChoice, switching = false) => {
    if (!user?.emailVerified) return;
    saveTradeBusinessSelection(user.uid, business.ownerUid);
    const target = destination === "messages" ? "/direct-trade/messages" : business.role === "owner" ? "/direct-trade/dashboard" : "/direct-trade/team";
    if (destination !== "messages" && business.role !== destination) { window.location.replace(target); return; }
    if (switching) window.history.replaceState({}, "", target);
    setSelected(business);
  }, [destination, user]);

  const refreshAccess = useCallback(() => {
    if (user) saveTradeBusinessSelection(user.uid, "");
    setSelected(null); setBusinesses([]); setLoading(true); setError(""); setRetry(value => value + 1);
  }, [user]);

  const updatePersonalName = useCallback((name: string) => {
    if (!selected) return;
    const matches = (business: TradeBusinessChoice) => business.ownerUid === selected.ownerUid && business.role === selected.role && business.memberId === selected.memberId;
    const update = (business: TradeBusinessChoice) => matches(business) ? { ...business, ...(business.role === "owner" ? { managerName: name } : { displayName: name }) } : business;
    setSelected(current => current ? update(current) : current);
    setBusinesses(current => current.map(update));
  }, [selected]);

  async function switchBusiness() {
    if (!user || !selected || switching) return;
    setSwitching(true); setSwitchError("");
    try {
      const request = createTradeBusinessFetch(selected.ownerUid, window.location.origin, fetch);
      await disableTradeDeviceNotifications(async () => ({ Authorization: `Bearer ${await user.getIdToken()}` }), request);
      saveTradeBusinessSelection(user.uid, "");
      setSelected(null);
    } catch {
      setSwitchError("This device's notifications could not be turned off. Check your connection, then try switching business again.");
    } finally { setSwitching(false); }
  }

  async function leaveAccount() {
    if (!user || signingOut) return;
    const revision = identityRevision.current;
    const identityIsCurrent = () => identityRevision.current === revision && previousUid.current === user.uid;
    setSigningOut(true); setAccountMessage("");
    try {
      if (selected) {
        const request = createTradeBusinessFetch(selected.ownerUid, window.location.origin, fetch);
        await disableTradeDeviceNotifications(async () => ({ Authorization: `Bearer ${await user.getIdToken()}` }), request);
      }
      if (!identityIsCurrent()) return;
      await signOut(firebaseAuth);
    } catch {
      if (identityIsCurrent()) setAccountMessage("Sign out could not be completed. Check your connection and try again.");
    } finally {
      if (identityIsCurrent()) setSigningOut(false);
    }
  }

  async function resendVerification() {
    if (!user || verificationSending) return;
    const revision = identityRevision.current;
    const identityIsCurrent = () => identityRevision.current === revision && previousUid.current === user.uid;
    setVerificationSending(true); setAccountMessage("");
    try {
      await sendEmailVerification(user, { url: window.location.href });
      if (identityIsCurrent()) setAccountMessage("Verification email sent. Check your inbox and junk or spam folder, follow the link, then return here.");
    } catch {
      if (identityIsCurrent()) setAccountMessage("The verification email could not be sent. Check your connection and try again. If you requested several emails, wait a few minutes before retrying.");
    } finally {
      if (identityIsCurrent()) setVerificationSending(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    const authenticatedUser = user;
    let active = true;
    let checking = false;
    let needsVerification = !authenticatedUser.emailVerified;
    const revision = identityRevision.current;
    const controller = new AbortController();
    const identityIsCurrent = () => active && identityRevision.current === revision && previousUid.current === authenticatedUser.uid;
    async function loadBusinesses() {
      if (!identityIsCurrent() || checking) return;
      checking = true;
      try {
        if (needsVerification || retry > 0) await reload(authenticatedUser);
        if (!identityIsCurrent()) return;
        needsVerification = !authenticatedUser.emailVerified;
        setEmailVerified(authenticatedUser.emailVerified);
        if (needsVerification) { setError(""); return; }
        // Account reload can update the SDK flag while the cached JWT still says
        // email_verified=false. This endpoint verifies the JWT, not SDK state.
        const token = await authenticatedUser.getIdToken(true);
        if (!identityIsCurrent()) return;
        const response = await fetch("/api/trade-businesses", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        const result = await response.json() as { businesses?: TradeBusinessChoice[]; code?: string; error?: string };
        if (!identityIsCurrent()) return;
        if (!response.ok && result.code === "EMAIL_VERIFICATION_REQUIRED") {
          needsVerification = true; setEmailVerified(false); setError(""); return;
        }
        if (!response.ok || !Array.isArray(result.businesses)) throw new Error(result.error || "Your businesses could not be loaded.");
        setError(""); setBusinesses(result.businesses);
        const restored = resolveTradeBusinessSelection(result.businesses, readTradeBusinessSelection(authenticatedUser.uid));
        if (restored) choose(restored);
      } catch (failure) {
        if (identityIsCurrent()) setError(failure instanceof Error ? failure.message : "Your businesses could not be loaded.");
      } finally {
        checking = false;
        if (identityIsCurrent()) setLoading(false);
      }
    }
    const checkOnReturn = () => {
      if (needsVerification && document.visibilityState === "visible") void loadBusinesses();
    };
    window.addEventListener("focus", checkOnReturn);
    document.addEventListener("visibilitychange", checkOnReturn);
    void loadBusinesses();
    return () => {
      active = false; controller.abort();
      window.removeEventListener("focus", checkOnReturn);
      document.removeEventListener("visibilitychange", checkOnReturn);
    };
  }, [choose, retry, user]);

  const portalEntry = <TLinkWorkspaceBar current="trade" user={user} organisation="TLink trades" displayName={user?.displayName?.trim().split(/\s+/)[0]} businessContext />;
  const signOutButton = <button type="button" disabled={signingOut} onClick={() => void leaveAccount()}>{signingOut ? "Signing out..." : "Sign out"}</button>;
  if (!authReady || loading) return <>{portalEntry}<section className={styles.state} role="status">Opening your businesses...{user && signOutButton}{accountMessage && <p role="alert">{accountMessage}</p>}</section></>;
  if (!user) return <>{portalEntry}{children}</>;
  if (error) return <>{portalEntry}<section className={styles.state}><h1>Choose your business</h1><p role="alert">{error}</p><button type="button" onClick={() => { setError(""); setLoading(true); setRetry(value => value + 1); }}>Try again</button>{signOutButton}{accountMessage && <p role="alert">{accountMessage}</p>}</section></>;
  if (!emailVerified) return <>{portalEntry}<section className={styles.state}><h1>Confirm your email</h1><p>Check the inbox and junk or spam folder for {user.email}. Follow the verification link, then return here. Your business profile and invitation stay saved.</p><button type="button" onClick={() => { setLoading(true); setRetry(value => value + 1); }}>I&apos;ve verified my email</button><button type="button" disabled={verificationSending} onClick={() => void resendVerification()}>{verificationSending ? "Sending verification email..." : "Resend verification email"}</button>{signOutButton}{accountMessage && <p role="status">{accountMessage}</p>}</section>{children}</>;
  // An account without a business still needs the existing registration and
  // invitation screens. No tenant has been selected or implied here.
  if (!businesses.length) return <>{portalEntry}{children}</>;
  if (!selected) return <>{portalEntry}<section className={styles.chooser}><span>TLink workspace</span><h1>Which business are you working with?</h1><p>Choose a business to open its jobs, customers and team.</p><div className={styles.choices}>{businesses.map(business => <button type="button" key={business.ownerUid} onClick={() => choose(business, true)}><strong>{business.businessName}</strong><span>{business.role === "owner" ? "Your business" : "Team member"}</span><b aria-hidden="true">→</b></button>)}</div>{signOutButton}{accountMessage && <p role="alert">{accountMessage}</p>}</section></>;
  const personalName = selected.role === "owner" ? selected.managerName : selected.displayName;
  const firstName = personalName?.trim().split(/\s+/)[0] || "";
  return <TradeBusinessProvider key={`${user.uid}:${selected.ownerUid}`} business={selected} onAccessLost={refreshAccess} onPersonalNameChange={updatePersonalName}><TLinkWorkspaceBar current="trade" user={user} organisation={selected.businessName} displayName={firstName} error={switchError} businessContext actions={businesses.length > 1 ? <button type="button" disabled={switching} onClick={() => void switchBusiness()}>{switching ? "Switching..." : "Switch business"}</button> : undefined} />{children}</TradeBusinessProvider>;
}
