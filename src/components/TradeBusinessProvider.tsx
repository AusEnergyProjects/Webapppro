"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onIdTokenChanged, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { disableTradeDeviceNotifications } from "@/lib/trade-device-client";
import { createTradeBusinessFetch, readTradeBusinessSelection, resolveTradeBusinessSelection, saveTradeBusinessSelection, type TradeBusinessChoice } from "@/lib/trade-business-client";
import styles from "./TradeBusinessProvider.module.css";
import { TradeWorkTimeProvider } from "./TradeWorkTimeTracking";

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
  const previousUid = useRef("");
  const identityState = useRef("");

  useEffect(() => onIdTokenChanged(firebaseAuth, next => {
    const nextState = `${next?.uid || ""}:${Boolean(next?.emailVerified)}`;
    if (identityState.current === nextState) return;
    identityState.current = nextState;
    if (previousUid.current && previousUid.current !== next?.uid) saveTradeBusinessSelection(previousUid.current, "");
    previousUid.current = next?.uid || "";
    setUser(next); setAuthReady(true); setSelected(null); setBusinesses([]); setLoading(Boolean(next?.emailVerified)); setError("");
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

  useEffect(() => {
    if (!user?.emailVerified) return;
    let active = true;
    const controller = new AbortController();
    void (async () => {
      const response = await fetch("/api/trade-businesses", { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: "no-store", signal: controller.signal });
      const result = await response.json() as { businesses?: TradeBusinessChoice[]; error?: string };
      if (!response.ok || !Array.isArray(result.businesses)) throw new Error(result.error || "Your businesses could not be loaded.");
      if (!active) return;
      setBusinesses(result.businesses);
      const restored = resolveTradeBusinessSelection(result.businesses, readTradeBusinessSelection(user.uid));
      if (restored) choose(restored);
    })().catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "Your businesses could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [choose, retry, user]);

  if (!authReady || loading) return <section className={styles.state} role="status">Opening your businesses...</section>;
  if (!user?.emailVerified) return children;
  if (error) return <section className={styles.state}><h1>Choose your business</h1><p role="alert">{error}</p><button type="button" onClick={() => { setError(""); setLoading(true); setRetry(value => value + 1); }}>Try again</button></section>;
  // An account without a business still needs the existing registration and
  // invitation screens. No tenant has been selected or implied here.
  if (!businesses.length) return children;
  if (!selected) return <section className={styles.chooser}><span>TLink workspace</span><h1>Which business are you working with?</h1><p>Choose a business to open its jobs, customers and team.</p><div className={styles.choices}>{businesses.map(business => <button type="button" key={business.ownerUid} onClick={() => choose(business, true)}><strong>{business.businessName}</strong><span>{business.role === "owner" ? "Your business" : "Team member"}</span><b aria-hidden="true">→</b></button>)}</div></section>;
  const personalName = selected.role === "owner" ? selected.managerName : selected.displayName;
  const firstName = personalName?.trim().split(/\s+/)[0] || "";
  return <TradeBusinessProvider key={`${user.uid}:${selected.ownerUid}`} business={selected} onAccessLost={refreshAccess} onPersonalNameChange={updatePersonalName}><div className={styles.switcher} data-tlink-business-switcher><div><span>Working with</span><strong>{selected.businessName}</strong><small data-tlink-welcome>{firstName ? `Welcome ${firstName}` : "Welcome"}</small>{switchError && <p role="alert">{switchError}</p>}</div>{businesses.length > 1 && <button type="button" disabled={switching} onClick={() => void switchBusiness()}>{switching ? "Switching..." : "Switch business"}</button>}</div>{children}</TradeBusinessProvider>;
}
