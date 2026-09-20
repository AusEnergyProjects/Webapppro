"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import styles from "./TradeSms.module.css";

export type TradeSmsConnection = {
  number: string; accountLabel: string; accountType: string; dailyLimit: number; usedSegments: number; status: "connecting" | "connected";
};
type SmsNumber = { sid: string; number: string; label: string };
type SetupResult = {
  ok?: boolean; error?: string; connection?: TradeSmsConnection | null;
  numbers?: SmsNumber[]; accountLabel?: string; accountType?: string;
};

export function TradeSmsConnectionPanel({ user }: { user: User }) {
  const [connection, setConnection] = useState<TradeSmsConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [numbers, setNumbers] = useState<SmsNumber[] | null>(null);
  const [numberSid, setNumberSid] = useState("");
  const [account, setAccount] = useState({ label: "", type: "" });
  const [dailyLimit, setDailyLimit] = useState("100");
  const credentials = useRef({ accountSid: "", authToken: "" });
  const formRef = useRef<HTMLFormElement>(null);

  const request = useCallback(async (method: string, body?: Record<string, unknown>) => {
    const token = await user.getIdToken();
    const response = await fetch("/api/trade-sms", {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal: AbortSignal.timeout(25000),
    });
    const result = await response.json().catch(() => ({})) as SetupResult;
    if (!response.ok || !result.ok) throw new Error(result.error || "The SMS connection could not be checked. Try again.");
    return result;
  }, [user]);

  useEffect(() => {
    let active = true;
    void request("GET").then((result) => { if (active) setConnection(result.connection || null); })
      .catch((error) => { if (active) setStatus(error instanceof Error ? error.message : "SMS could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    const form = formRef.current;
    return () => { active = false; credentials.current = { accountSid: "", authToken: "" }; form?.reset(); };
  }, [request]);

  function resetInspection() {
    credentials.current = { accountSid: "", authToken: "" };
    setNumbers(null); setNumberSid(""); setAccount({ label: "", type: "" }); setStatus("");
  }

  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const nextCredentials = { accountSid: String(data.get("accountSid") || "").trim(), authToken: String(data.get("authToken") || "").trim() };
    setBusy("inspect"); setStatus(""); setNumbers(null);
    try {
      const result = await request("POST", { action: "inspect", ...nextCredentials });
      credentials.current = nextCredentials;
      const available = result.numbers || [];
      setNumbers(available); setNumberSid(available.length === 1 ? available[0].sid : "");
      setAccount({ label: result.accountLabel || "Twilio account", type: result.accountType || "" });
      if (!available.length) setStatus("No eligible SMS number was found. Add an SMS-capable Australian number in Twilio, then check again.");
    } catch (error) {
      credentials.current = { accountSid: "", authToken: "" };
      setStatus(error instanceof Error ? error.message : "The account could not be checked.");
    } finally { setBusy(""); }
  }

  async function connect() {
    if (busy || !numberSid || !credentials.current.authToken) return;
    const limit = Number(dailyLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) { setStatus("Choose a daily limit between 1 and 1,000 SMS segments."); return; }
    setBusy("connect"); setStatus(""); let saved = false;
    try {
      await request("POST", { action: "connect", ...credentials.current, numberSid, dailyLimit: limit });
      saved = true; credentials.current = { accountSid: "", authToken: "" }; formRef.current?.reset(); setNumbers(null);
      const result = await request("GET"); setConnection(result.connection || null);
      setStatus(result.connection?.status === "connected" ? "SMS is connected. Open a customer record to start a conversation." : "The connection was saved. Refresh to check its status.");
    } catch (error) { setStatus(saved ? "The connection was saved, but its status could not refresh. Choose Refresh connection to check it." : error instanceof Error ? error.message : "SMS could not be connected."); }
    finally { setBusy(""); }
  }

  async function refreshConnection() {
    if (busy) return;
    setBusy("refresh"); setStatus("");
    try { const result = await request("GET"); setConnection(result.connection || null); }
    catch (error) { setStatus(error instanceof Error ? error.message : "SMS could not be loaded."); }
    finally { setBusy(""); }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect SMS? Sending and receiving messages in TLink will stop. Your Twilio number and carrier charges remain with Twilio.")) return;
    setBusy("disconnect"); setStatus("");
    try {
      await request("PATCH", { action: "disconnect" }); setConnection(null); resetInspection();
      setStatus("SMS disconnected. Your message history is retained.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "SMS could not be disconnected."); }
    finally { setBusy(""); }
  }

  return <section className={styles.panel} aria-label="SMS connection">
    <header className={styles.heading}><div><span className={styles.eyebrow}>Customer conversations</span><h4>Two-way SMS</h4></div><strong className={styles.badge}>{loading ? "Checking" : connection?.status === "connected" ? "Connected" : connection ? "Routing not confirmed" : "Setup needed"}</strong></header>
    <p>Send service messages and read replies in each customer record. Connect your business&apos;s own Twilio number once.</p>
    {status && <p className={styles.notice} role="status">{status}</p>}
    {loading ? <p>Loading SMS settings...</p> : connection ? <>
      <div className={styles.connection}><strong>{connection.number}</strong><span>{connection.accountLabel}</span><small>{connection.usedSegments} of {connection.dailyLimit} daily SMS segments used</small></div>
      {connection.status !== "connected" && <p className={styles.notice}>SMS routing is not confirmed. Disconnect to finish clearing this setup, then reconnect. Messages cannot be sent until the connection is confirmed.</p>}
      {connection.accountType.toLowerCase() === "trial" && <p className={styles.notice}>Twilio trial account: messages can only go to recipients verified in Twilio, and trial restrictions apply.</p>}
      <p className={styles.hint}>Twilio bills your business directly for its number and usage. Longer messages use multiple SMS segments.</p>
      <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => void disconnect()}>{busy === "disconnect" ? "Disconnecting..." : "Disconnect SMS"}</button>
    </> : <form ref={formRef} className={styles.form} onSubmit={(event) => void inspect(event)}>
      <p className={styles.hint}>Keep your current number by porting it to Twilio, or buy a new SMS-capable Australian number there. Twilio bills you directly; TLink remains free.</p>
      <a href="https://console.twilio.com/" target="_blank" rel="noreferrer">Open Twilio account</a>
      <div className={styles.fields}>
        <label><span>Twilio Account SID</span><input name="accountSid" required pattern="AC[a-fA-F0-9]{32}" maxLength={34} autoComplete="off" spellCheck={false} disabled={Boolean(busy)} onChange={resetInspection} placeholder="AC..." /></label>
        <label><span>Twilio Auth Token</span><input name="authToken" type="password" required autoComplete="off" spellCheck={false} disabled={Boolean(busy)} onChange={resetInspection} /></label>
      </div>
      <p className={styles.hint}>Find these in your Twilio console. The token is encrypted when connected and never shown again in TLink.</p>
      <button type="submit" className={numbers?.length ? styles.secondary : styles.primary} disabled={Boolean(busy)}>{busy === "inspect" ? "Checking numbers..." : numbers ? "Check numbers again" : "Find my numbers"}</button>
      {numbers && numbers.length > 0 && <div className={styles.selection}>
        <strong>{account.label}</strong>
        {account.type.toLowerCase() === "trial" && <p className={styles.notice}>This is a Twilio trial account. Only recipients verified in Twilio can receive your messages.</p>}
        <div className={styles.fields}>
          <label><span>Business SMS number</span><select value={numberSid} onChange={(event) => setNumberSid(event.target.value)} disabled={Boolean(busy)}><option value="" disabled>Choose a number</option>{numbers.map((number) => <option key={number.sid} value={number.sid}>{number.number}{number.label && number.label !== number.number ? ` (${number.label})` : ""}</option>)}</select></label>
          <label><span>Daily SMS segment limit</span><input type="number" min={1} max={1000} step={1} required value={dailyLimit} onChange={(event) => setDailyLimit(event.target.value)} disabled={Boolean(busy)} /></label>
        </div>
        <p className={styles.hint}>Connecting routes this number&apos;s SMS replies into TLink. Numbers already routed to another service cannot be connected.</p>
        <button type="button" className={styles.primary} disabled={Boolean(busy) || !numberSid} onClick={() => void connect()}>{busy === "connect" ? "Connecting..." : "Connect SMS"}</button>
      </div>}
    </form>}
    {!loading && <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => void refreshConnection()}>{busy === "refresh" ? "Refreshing..." : "Refresh connection"}</button>}
  </section>;
}
