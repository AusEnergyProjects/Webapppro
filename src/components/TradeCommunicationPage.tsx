"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { disableTradeDeviceNotifications } from "@/lib/trade-notification-client";
import { TradeMessagesWorkspace } from "./TradeMessagesWorkspace";
import { TradeTeamCallProvider } from "./TradeTeamCallProvider";
import { TLinkMark } from "./TLinkChrome";
import styles from "./TradeCommunicationPage.module.css";

type Access = { memberId: string; name: string; businessName: string };
type Session = { access: Access; user: User | null; threadId: string; callId: string };
type HandoffResult = { ok?: boolean; error?: string; access?: Access; threadId?: string; callId?: string };
const safeId = (value: string | null) => value && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/.test(value) ? value : "";

export default function TradeCommunicationPage() {
  const [session,setSession] = useState<Session | null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [signInUrl,setSignInUrl] = useState("/direct-trade/team?workspace=messages");
  const redemption = useRef<Promise<HandoffResult> | null>(null);
  useEffect(() => {
    let active = true, attempt = 0;
    const query = new URLSearchParams(window.location.search);
    const target = {threadId:safeId(query.get("threadId")),callId:safeId(query.get("callId"))};
    let expectedMember = "";
    try { expectedMember = sessionStorage.getItem("tlink-team-handoff") || ""; } catch { /* The initial redemption still works without storage. */ }
    const code = new URLSearchParams(window.location.hash.slice(1)).get("handoff");
    // Strip the one-use code immediately, before any authenticated requests.
    if (window.location.hash) window.history.replaceState(null,"",window.location.pathname + window.location.search);
    const login = new URL("/direct-trade/team",window.location.origin);
    login.searchParams.set("workspace","messages");
    if (target.threadId) login.searchParams.set("threadId",target.threadId);
    if (target.callId) login.searchParams.set("callId",target.callId);
    async function open(user: User | null, redeemed?: Promise<HandoffResult>) {
      const current = ++attempt;
      try {
        const headers: Record<string,string> = user ? {Authorization:`Bearer ${await user.getIdToken()}`} : {"x-tlink-comms-member":expectedMember};
        const result = redeemed ? await redeemed : await fetch("/api/trade-team-handoff", {headers,cache:"no-store",signal:AbortSignal.timeout(15000)}).then(async response => {
          const data: HandoffResult = await response.json();
          if (!response.ok) throw new Error(data.error || "Team messages could not be opened.");
          return data;
        });
        if (!result.ok || !result.access) throw new Error(result.error || "Team messages could not be opened.");
        if (active && attempt === current) {
          setSession({access:result.access,user,threadId:safeId(result.threadId || target.threadId),callId:safeId(result.callId || target.callId)});
          setError("");
        }
      } catch (failure) { if (active && attempt === current) { setSession(null); setError(failure instanceof Error ? failure.message : "Team messages could not be opened."); } }
      finally { if (active && attempt === current) { setSignInUrl(login.pathname + login.search); setLoading(false); } }
    }
    // Native handoffs deliberately keep their own identity if this browser has
    // another Firebase account signed in. No native bearer reaches browser JS.
    if (code && !redemption.current) {
      // Retain the in-flight request across React's effect replay. A one-use
      // link must never be redeemed twice by the same mounted page.
      redemption.current = fetch("/api/trade-team-handoff", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"redeem",code}),cache:"no-store",signal:AbortSignal.timeout(15000)}).then(async response => {
        const result: HandoffResult = await response.json();
        if (!response.ok) throw new Error(result.error || "Team messages could not be opened.");
        try { if (result.access) sessionStorage.setItem("tlink-team-handoff",result.access.memberId); } catch { /* Storage is optional; the session remains in an HttpOnly cookie. */ }
        return result;
      });
    }
    const unsubscribe = redemption.current || expectedMember ? (void open(null,redemption.current || undefined), () => {}) : onAuthStateChanged(firebaseAuth,user => { setSession(null); setLoading(true); void open(user); });
    return () => { active = false; unsubscribe(); };
  },[]);
  const getAuthHeaders = useCallback(async ():Promise<Record<string,string>> => session?.user ? {Authorization:`Bearer ${await session.user.getIdToken()}`} : {"x-tlink-comms-member":session?.access.memberId || ""},[session]);
  async function closeSession() {
    try {
      await disableTradeDeviceNotifications(getAuthHeaders);
      const response = await fetch("/api/trade-team-handoff",{method:"DELETE",headers:await getAuthHeaders(),signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error("Could not close this session. Try again.");
      try { sessionStorage.removeItem("tlink-team-handoff"); } catch { /* The server session has already been closed. */ }
      setSession(null); setError("This Messages session is closed. Open Messages again from the TLink app when you need it.");
    } catch(failure) { setError(failure instanceof Error ? failure.message : "Could not close this session."); }
  }
  return <main className={`${styles.page} trade-portal-shell is-installer`}>
    <header className={styles.brand}><a href="/direct-trade/dashboard"><TLinkMark size={36} /><strong>TLink</strong></a>{session && <div><span>{session.access.businessName}</span>{!session.user && <button type="button" onClick={() => void closeSession()}>Close session</button>}</div>}</header>
    {error && <p className={styles.notice} role="status">{error}</p>}
    {loading ? <p role="status">Opening your team messages...</p> : session ? <TradeTeamCallProvider key={session.access.memberId} user={session.user} getAuthHeaders={getAuthHeaders}>
      <TradeMessagesWorkspace key={session.access.memberId} user={session.user || undefined} getAuthHeaders={getAuthHeaders} initialThreadId={session.threadId} initialCallId={session.callId} teamOnly />
    </TradeTeamCallProvider> : <section className={styles.signin}><h1>Team messages</h1><p>Sign in with your team account, or open Messages from the TLink field app.</p><a href={signInUrl}>Sign in to TLink</a></section>}
  </main>;
}
