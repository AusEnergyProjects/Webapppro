"use client";

import { useTradeBusinessFetch } from "./TradeBusinessProvider";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import styles from "./TradeEmailSettings.module.css";

export type TradeEmailConnection = {
  provider: "google" | "microsoft";
  email: string;
  displayName: string;
  status: "connected" | "reconnect_required" | "disconnected";
  lastTestAt: string;
  lastError: string;
};

type EmailSettingsResponse = {
  ok: boolean;
  providers: Array<{ id: "google" | "microsoft"; label: string; available: boolean }>;
  connection: TradeEmailConnection | null;
  error?: string;
};

export const TRADE_EMAIL_SETTINGS_HREF = "/direct-trade/dashboard?workspace=account#business-settings-email";

export function TradeEmailSettings({ user }: { user: User }) {
  const fetch = useTradeBusinessFetch();
  const [settings, setSettings] = useState<EmailSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [testUncertain, setTestUncertain] = useState(false);
  const testRequestId = useRef("");
  const actionPending = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const token = await user.getIdToken();
    const response = await fetch("/api/trade-email", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal });
    const result = await response.json() as EmailSettingsResponse;
    if (!response.ok || !result.ok) throw new Error(result.error || "Your email connection could not be loaded.");
    return result;
  }, [fetch, user]);

  useEffect(() => {
    const controller = new AbortController();
    const returnStatus = new URLSearchParams(window.location.search).get("email_connection");
    void load(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setSettings(result);
      if (returnStatus === "connected" && result.connection?.status === "connected") setMessage("Connected. Your team can now send from this address.");
      else if (returnStatus === "cancelled") setMessage("Connection cancelled. Choose an email provider when you are ready.");
      else if (returnStatus === "failed") setError("The email connection could not be completed. Please connect again.");
      if (returnStatus) {
        const url = new URL(window.location.href);
        url.searchParams.delete("email_connection");
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
        document.getElementById("business-settings-email")?.scrollIntoView({ block: "start" });
      }
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Your email connection could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load]);

  async function action(kind: "connect" | "test" | "disconnect", provider?: "google" | "microsoft") {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy(kind === "connect" ? provider || "connect" : kind);
    setMessage(""); setError("");
    let testStarted = false;
    try {
      const token = await user.getIdToken();
      if (kind === "test" && !testRequestId.current) testRequestId.current = crypto.randomUUID();
      testStarted = kind === "test";
      const response = await fetch("/api/trade-email", {
        method: kind === "disconnect" ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: kind === "disconnect" ? undefined : JSON.stringify(kind === "connect"
          ? { action: "connect", provider } : { action: "test", requestId: testRequestId.current }),
      });
      const result = await response.json() as { ok?: boolean; authorizationUrl?: string; status?: string; error?: string };
      if (result.status === "uncertain") {
        setTestUncertain(true);
        setError("The test email result is not confirmed. Check your mailbox or check the same test again.");
        return;
      }
      if (!response.ok || !result.ok) {
        if (kind === "test" && (result.status === "failed" || response.status < 500)) testStarted = false;
        throw new Error(result.error || "The email request could not be completed.");
      }
      if (kind === "connect") {
        const url = new URL(result.authorizationUrl || "");
        const expectedHost = provider === "google" ? "accounts.google.com" : "login.microsoftonline.com";
        if (url.protocol !== "https:" || url.hostname !== expectedHost) throw new Error("A secure connection link was not returned. Please try again.");
        window.location.assign(url.toString());
        return;
      }
      if (kind === "test" && result.status !== "accepted") throw new Error("The test email result is not confirmed.");
      if (kind === "test") { testStarted = false; setTestUncertain(false); testRequestId.current = ""; }
      setMessage(kind === "test" ? "Test email accepted. Check your connected mailbox." : "Disconnected. Customer emails from this address are paused until you reconnect.");
      setSettings(await load());
    } catch (reason) {
      if (testStarted) setTestUncertain(true);
      setError(reason instanceof Error ? reason.message : "The email request could not be completed.");
    } finally { actionPending.current = false; setBusy(""); }
  }

  const connection = settings?.connection;
  const connected = connection?.status === "connected";
  return <div id="business-settings-email" className={styles.settings} role="group" aria-labelledby="business-settings-email-title" aria-busy={loading || Boolean(busy)}>
    <div className={styles.label}>
      <h4 id="business-settings-email-title">Outgoing email</h4>
      <p>Use one business email for your team’s customer emails, quotes and invoices.</p>
    </div>
    <div className={styles.controls}>
      {loading ? <p role="status">Loading your email connection...</p> : settings ? <>
        {connection && <>
          <div className={styles.connection}>
            <strong className={styles.address}>{connection.email}</strong>
            <span className={connected ? styles.ready : styles.paused}>{connected ? "Connected" : connection.status === "reconnect_required" ? "Reconnect needed" : "Disconnected"}</span>
          </div>
          {connection.lastError && !connected && <p role="status">{connection.lastError}</p>}
          {connected && <div className={styles.actions}>
            <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => void action("test")}>{busy === "test" ? "Checking..." : testUncertain ? "Check test result" : "Test"}</button>
            <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => void action("disconnect")}>{busy === "disconnect" ? "Disconnecting..." : "Disconnect"}</button>
          </div>}
          {connection.lastTestAt && <small>Last test accepted {new Date(connection.lastTestAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</small>}
        </>}
        {!connected && <>
          <div className={styles.providers}>{settings.providers.map(provider => <button type="button" key={provider.id} disabled={!provider.available || Boolean(busy)} onClick={() => void action("connect", provider.id)}>
            {busy === provider.id ? "Opening sign-in..." : `Connect ${provider.label}`}
          </button>)}</div>
          {!settings.providers.some(provider => provider.available) && <p role="status">Email connection is currently unavailable. Please try again later.</p>}
        </>}
      </> : <button type="button" className="btn" onClick={() => { setLoading(true); setError(""); void load().then(setSettings).catch(reason => setError(reason instanceof Error ? reason.message : "Could not load email settings.")).finally(() => setLoading(false)); }}>Try again</button>}
      {message && <p className={styles.notice} role="status">{message}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  </div>;
}
