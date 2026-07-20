"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
  clearIntegrationReturnFromAddress,
  integrationProviderLabel,
  isCalendarIntegration,
  readIntegrationReturn,
  type IntegrationReturnProvider,
} from "@/lib/trade-integration-return";

type Provider = {
  provider: IntegrationReturnProvider;
  label: string;
  purpose: string;
  configured: boolean;
  status: "connected" | "not_connected";
  accountLabel: string;
  connectedAt: string;
  lastSyncAt: string;
  lastError: string;
};

type IntegrationResult = { ok?: boolean; providers?: Provider[]; error?: string };

const providerNotes: Record<Provider["provider"], string> = {
  xero: "Export a direct-customer job as a draft Xero invoice, then refresh its total and payment status without sharing a Xero password.",
  myob: "Export a direct-customer job as a draft MYOB service invoice, then refresh its total and payment status without giving AEA your MYOB login.",
  quickbooks: "Create a draft QuickBooks Online invoice from the exact accepted quote, then refresh its status without making QuickBooks the source of truth.",
  stripe: "Create secure checkout links from a direct customer job. Card details stay with Stripe and never enter this CRM.",
  square: "Create secure Square checkout links from a direct customer job using the connected business location.",
  google_calendar: "Mirror TLink appointments to Google Calendar. TLink stays authoritative and protected customer details are withheld.",
  microsoft_calendar: "Mirror TLink appointments to Outlook. TLink stays authoritative and protected customer details are withheld.",
};

export function TradeIntegrationCentre({ user }: { user: User }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const token = await user.getIdToken();
    const response = await fetch("/api/trade-integrations", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as IntegrationResult;
    if (!response.ok) throw new Error(result.error || "Integrations could not be loaded.");
    const nextProviders = result.providers || [];
    setProviders(nextProviders);
    return nextProviders;
  }, [user]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void load().then((nextProviders) => {
        if (!active) return;
        const returned = readIntegrationReturn(window.location.search);
        if (!returned || isCalendarIntegration(returned.provider)) return;
        const label = integrationProviderLabel(returned.provider);
        if (returned.status === "cancelled") setStatus(`${label} connection cancelled. Nothing was changed.`);
        else if (returned.status === "failed") setStatus(`${label} could not be connected. Try again or contact TLink support.`);
        else if (nextProviders.some((provider) => provider.provider === returned.provider && provider.status === "connected")) {
          setStatus(`${label} is connected to this TLink business.`);
        } else setStatus(`${label} returned to TLink, but the connection could not be verified. Try connecting again.`);
        clearIntegrationReturnFromAddress();
      }).catch((error) => active && setStatus(error instanceof Error ? error.message : "Integrations could not be loaded."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [load]);

  async function connect(provider: Provider) {
    setBusy(provider.provider); setStatus(`Opening ${provider.label} secure authorisation...`);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-integrations", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ provider: provider.provider }),
      });
      const result = await response.json().catch(() => ({})) as { authorizationUrl?: string; error?: string };
      if (!response.ok || !result.authorizationUrl) throw new Error(result.error || "The secure connection could not be started.");
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The secure connection could not be started."); setBusy("");
    }
  }

  async function disconnect(provider: Provider) {
    if (!window.confirm(`Disconnect ${provider.label} from this installer workspace?`)) return;
    setBusy(provider.provider); setStatus(`Disconnecting ${provider.label}...`);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-integrations", {
        method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ provider: provider.provider }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "The provider could not be disconnected.");
      await load(); setStatus(`${provider.label} disconnected.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "The provider could not be disconnected."); }
    finally { setBusy(""); }
  }

  return <div className="crm-integrations">
    <div className="crm-page-heading"><div><span>Connected business services</span><h3>Integrations</h3><p>Each installer business connects its own accounts through the provider&apos;s secure sign-in. TLink never asks for or stores the provider password.</p></div></div>
    {status && <p className="crm-inline-status" role="status">{status}</p>}
    {loading ? <section className="crm-loading"><span /><div><strong>Checking business connections</strong><p>Loading provider readiness...</p></div></section> : <>
      <section className="crm-integration-grid">
        {providers.map((provider) => <article key={provider.provider} className={provider.status === "connected" ? "connected" : ""}>
          <header><div className={`crm-provider-mark ${provider.provider}`}>{provider.label.slice(0, 1)}</div><div><span>{provider.purpose}</span><h4>{provider.label}</h4></div><strong>{provider.status === "connected" ? "Connected" : provider.configured ? "Available to connect" : "TLink setup in progress"}</strong></header>
          <p>{providerNotes[provider.provider]}</p>
          {provider.status === "connected" && <div className="crm-connected-account"><span>Authorised account</span><strong>{provider.accountLabel || `${provider.label} business`}</strong><small>Tokens are encrypted and isolated to this installer account.</small></div>}
          {!provider.configured && provider.status !== "connected" && <p className="crm-integration-setup-note">TLink is completing the secure provider registration. Once available, press Connect and sign in to your own {provider.label} account.</p>}
          <button type="button" disabled={Boolean(busy) || (!provider.configured && provider.status !== "connected")} onClick={() => provider.status === "connected" ? void disconnect(provider) : void connect(provider)}>{busy === provider.provider ? "Working..." : provider.status === "connected" ? `Disconnect ${provider.label}` : provider.configured ? `Connect ${provider.label}` : "TLink setup in progress"}</button>
        </article>)}
      </section>
    </>}
  </div>;
}
