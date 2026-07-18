"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

type PaymentLink = { id: string; workOrderId: string; commercialReference?: string; purpose?: string; provider: string; amountCents: number; paidAmountCents: number; checkoutUrl: string; status: string; paidAt: string; lastEventAt: string; createdAt: string };
type Provider = { provider: string; status: string; configured: boolean };

export function TradePaymentPanel({ user, workOrderId, isProtected, suggestedAmountCents, purpose = "deposit", onOpenIntegrations, onChanged }: { user: User; workOrderId: string; isProtected: boolean; suggestedAmountCents: number; purpose?: "deposit" | "invoice"; onOpenIntegrations?: () => void; onChanged?: () => Promise<void> }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const token = await user.getIdToken();
    const response = await fetch("/api/trade-integrations", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as { providers?: Provider[]; paymentLinks?: PaymentLink[]; error?: string };
    if (!response.ok) throw new Error(result.error || "Payment connections could not be loaded.");
    setProviders(result.providers || []);
    setLinks((result.paymentLinks || []).filter((link) => link.workOrderId === workOrderId && link.purpose === purpose));
  }, [purpose, user, workOrderId]);

  useEffect(() => {
    if (isProtected) return;
    const frame = window.requestAnimationFrame(() => {
      void load().catch((error) => setStatus(error instanceof Error ? error.message : "Payment connections could not be loaded."));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isProtected, load]);

  async function createLink(provider: "stripe" | "square") {
    setBusy(provider); setStatus(`Creating a secure ${provider === "stripe" ? "Stripe" : "Square"} checkout...`);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-payment-links", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ provider, workOrderId, purpose }),
      });
      const result = await response.json().catch(() => ({})) as { paymentLink?: PaymentLink; error?: string };
      if (!response.ok || !result.paymentLink) throw new Error(result.error || "The checkout link could not be created.");
      setLinks((current) => [result.paymentLink as PaymentLink, ...current.filter((link) => link.id !== result.paymentLink?.id)]); setStatus("Secure checkout link created. Copy it into your own customer communication.");
      await onChanged?.();
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
  const paymentRequested = links.length > 0;
  const invoicePayment = purpose === "invoice";
  return <section className="crm-payment-panel">
    <header><div><span>{invoicePayment ? "Invoice payment" : "Deposit request"}</span><h4>Secure provider checkout</h4><p>{invoicePayment ? "Request the full quick invoice total through Stripe or Square." : "Request the agreed deposit through Stripe or Square."} Card data stays with the payment provider.</p></div></header>
    <div className="crm-payment-create"><div><span>{invoicePayment ? "Invoice total" : "Deposit to request"}</span><strong>{new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(suggestedAmountCents / 100)}</strong><small>{paymentRequested ? "The existing provider request stays authoritative." : invoicePayment ? "Locked to the TLink quick invoice." : "Locked to the accepted quote handoff."}</small></div><button type="button" disabled={paymentRequested || Boolean(busy) || suggestedAmountCents < 100} onClick={() => stripeConnected ? void createLink("stripe") : onOpenIntegrations?.()}>{paymentRequested ? "Payment already requested" : busy === "stripe" ? "Creating..." : stripeConnected ? "Request with Stripe" : "Connect Stripe"}</button><button type="button" disabled={paymentRequested || Boolean(busy) || suggestedAmountCents < 100} onClick={() => squareConnected ? void createLink("square") : onOpenIntegrations?.()}>{paymentRequested ? "Payment already requested" : busy === "square" ? "Creating..." : squareConnected ? "Request with Square" : "Connect Square"}</button><button type="button" className="crm-payment-refresh" disabled={Boolean(busy)} onClick={() => void load().then(async () => { setStatus("Payment status refreshed from the verified provider ledger."); await onChanged?.(); }).catch((error) => setStatus(error instanceof Error ? error.message : "Payment status could not be refreshed."))}>Refresh status</button></div>
    {links.length > 0 && <ol>{links.map((link) => <li key={link.id} className={`payment-${link.status}`}><div><span>{link.provider} | {new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(link.amountCents / 100)}</span><strong>{statusLabel[link.status] || "Awaiting provider update"}</strong><small>{link.paidAt ? `Verified ${new Date(link.paidAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}` : `Created ${new Date(link.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}`}</small></div>{link.status !== "paid" && <a href={link.checkoutUrl} target="_blank" rel="noreferrer">Open checkout</a>}</li>)}</ol>}
    {status && <p className="crm-inline-status" role="status">{status}</p>}
  </section>;
}
