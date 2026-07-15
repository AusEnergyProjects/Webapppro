"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

type PaymentLink = { id: string; workOrderId: string; provider: string; amountCents: number; paidAmountCents: number; checkoutUrl: string; status: string; paidAt: string; lastEventAt: string; createdAt: string };
type Provider = { provider: string; status: string; configured: boolean };

export function TradePaymentPanel({ user, workOrderId, isProtected, suggestedAmountCents }: { user: User; workOrderId: string; isProtected: boolean; suggestedAmountCents: number }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [amount, setAmount] = useState((suggestedAmountCents / 100).toFixed(2));
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const token = await user.getIdToken();
    const response = await fetch("/api/trade-integrations", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as { providers?: Provider[]; paymentLinks?: PaymentLink[]; error?: string };
    if (!response.ok) throw new Error(result.error || "Payment connections could not be loaded.");
    setProviders(result.providers || []);
    setLinks((result.paymentLinks || []).filter((link) => link.workOrderId === workOrderId));
  }, [user, workOrderId]);

  useEffect(() => {
    if (isProtected) return;
    const frame = window.requestAnimationFrame(() => {
      void load().catch((error) => setStatus(error instanceof Error ? error.message : "Payment connections could not be loaded."));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isProtected, load]);

  async function createLink(provider: "stripe" | "square") {
    const amountCents = Math.round(Math.max(0, Number(amount || 0)) * 100);
    setBusy(provider); setStatus(`Creating a secure ${provider === "stripe" ? "Stripe" : "Square"} checkout...`);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-payment-links", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ provider, workOrderId, amountCents }),
      });
      const result = await response.json().catch(() => ({})) as { paymentLink?: PaymentLink; error?: string };
      if (!response.ok || !result.paymentLink) throw new Error(result.error || "The checkout link could not be created.");
      setLinks((current) => [result.paymentLink as PaymentLink, ...current]); setStatus("Secure checkout link created. Copy it into your own customer communication.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The checkout link could not be created."); }
    finally { setBusy(""); }
  }

  const statusLabel: Record<string, string> = {
    open: "Awaiting payment",
    processing: "Processing",
    paid: "Paid and reconciled",
    failed: "Payment failed",
    review_required: "Admin review required",
  };

  if (isProtected) return <div className="crm-payment-boundary"><strong>AEA protected payment path</strong><p>Direct payment links are disabled because the installer cannot contact this household. Payment requests will need an AEA-mediated workflow.</p></div>;
  const stripeConnected = providers.some((provider) => provider.provider === "stripe" && provider.status === "connected");
  const squareConnected = providers.some((provider) => provider.provider === "square" && provider.status === "connected");
  return <section className="crm-payment-panel">
    <header><div><span>Online payment request</span><h4>Secure checkout link</h4><p>Create a link only for a direct customer. Card data stays with Stripe or Square.</p></div></header>
    <div className="crm-payment-create"><label><span>Amount to collect</span><input type="number" min="1" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><button type="button" disabled={!stripeConnected || Boolean(busy)} onClick={() => void createLink("stripe")}>{busy === "stripe" ? "Creating..." : stripeConnected ? "Create Stripe link" : "Connect Stripe first"}</button><button type="button" disabled={!squareConnected || Boolean(busy)} onClick={() => void createLink("square")}>{busy === "square" ? "Creating..." : squareConnected ? "Create Square link" : "Connect Square first"}</button><button type="button" className="crm-payment-refresh" disabled={Boolean(busy)} onClick={() => void load().then(() => setStatus("Payment status refreshed from the verified provider ledger.")).catch((error) => setStatus(error instanceof Error ? error.message : "Payment status could not be refreshed."))}>Refresh status</button></div>
    {links.length > 0 && <ol>{links.map((link) => <li key={link.id} className={`payment-${link.status}`}><div><span>{link.provider} | {new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(link.amountCents / 100)}</span><strong>{statusLabel[link.status] || "Awaiting provider update"}</strong><small>{link.paidAt ? `Verified ${new Date(link.paidAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}` : `Created ${new Date(link.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}`}</small></div>{link.status !== "paid" && <a href={link.checkoutUrl} target="_blank" rel="noreferrer">Open checkout</a>}</li>)}</ol>}
    {status && <p className="crm-inline-status" role="status">{status}</p>}
  </section>;
}
