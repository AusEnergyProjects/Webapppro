"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

type Provider = {
  provider: "xero" | "myob" | "stripe" | "square";
  label: string;
  purpose: string;
  configured: boolean;
  callbackUrl: string;
  status: "connected" | "not_connected";
  accountLabel: string;
  connectedAt: string;
  lastSyncAt: string;
  lastError: string;
};

type IntegrationResult = { ok?: boolean; providers?: Provider[]; propertySearchConfigured?: boolean; error?: string };

const providerNotes: Record<Provider["provider"], string> = {
  xero: "Secure the accounting connection now. Job invoice export and payment reconciliation can then use this authorised account without sharing a Xero password.",
  myob: "Authorise the MYOB business connection without giving AEA your MYOB login. The next accounting layer can export approved invoices through this connection.",
  stripe: "Create secure checkout links from a direct customer job. Card details stay with Stripe and never enter this CRM.",
  square: "Create secure Square checkout links from a direct customer job using the connected business location.",
};

export function TradeIntegrationCentre({ user }: { user: User }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [propertyConfigured, setPropertyConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const token = await user.getIdToken();
    const response = await fetch("/api/trade-integrations", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as IntegrationResult;
    if (!response.ok) throw new Error(result.error || "Integrations could not be loaded.");
    setProviders(result.providers || []);
    setPropertyConfigured(Boolean(result.propertySearchConfigured));
  }, [user]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void load().catch((error) => active && setStatus(error instanceof Error ? error.message : "Integrations could not be loaded."))
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
    <div className="crm-page-heading"><div><span>Connected business services</span><h3>Integrations</h3><p>Connect your own accounts through each provider&apos;s secure sign-in. AEA never asks for or stores the provider password.</p></div></div>
    {loading ? <section className="crm-loading"><span /><div><strong>Checking business connections</strong><p>Loading provider readiness...</p></div></section> : <>
      <section className="crm-integration-grid">
        {providers.map((provider) => <article key={provider.provider} className={provider.status === "connected" ? "connected" : ""}>
          <header><div className={`crm-provider-mark ${provider.provider}`}>{provider.label.slice(0, 1)}</div><div><span>{provider.purpose}</span><h4>{provider.label}</h4></div><strong>{provider.status === "connected" ? "Connected" : provider.configured ? "Ready" : "Setup needed"}</strong></header>
          <p>{providerNotes[provider.provider]}</p>
          {provider.status === "connected" && <div className="crm-connected-account"><span>Authorised account</span><strong>{provider.accountLabel || `${provider.label} business`}</strong><small>Tokens are encrypted and isolated to this installer account.</small></div>}
          {!provider.configured && <details><summary>Administrator setup</summary><p>Register the AEA integration with {provider.label}, add the client credentials to Sites, and allow this exact callback URL:</p><code>{provider.callbackUrl}</code></details>}
          <button type="button" disabled={busy === provider.provider || (!provider.configured && provider.status !== "connected")} onClick={() => provider.status === "connected" ? void disconnect(provider) : void connect(provider)}>{busy === provider.provider ? "Working..." : provider.status === "connected" ? `Disconnect ${provider.label}` : `Connect ${provider.label}`}</button>
        </article>)}
      </section>
      <section className="crm-google-service"><div className="crm-provider-mark google">G</div><div><span>Google property tools</span><h4>Address match and satellite view</h4><p>Available only for customers your business already owns. Each search is deliberate to control cost, and AEA protected addresses are blocked on the server.</p></div><strong className={propertyConfigured ? "ready" : "pending"}>{propertyConfigured ? "Ready" : "Setup needed"}</strong></section>
    </>}
    {status && <p className="crm-inline-status" role="status">{status}</p>}
  </div>;
}
