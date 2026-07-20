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
      const result = await response.json().catch(() => ({})) as { paymentLink?: PaymentLink; resumed?: boolean; error?: string };
      if (!response.ok || !result.paymentLink) throw new Error(result.error || "The checkout link could not be created.");
      setLinks((current) => [result.paymentLink as PaymentLink, ...current.filter((link) => link.id !== result.paymentLink?.id)]);
      setStatus(result.resumed ? "Secure checkout setup finished." : "Secure checkout link created. Copy it into your own customer communication.");
      await onChanged?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "The checkout link could not be created.";
      await load().catch(() => null);
      setStatus(message);
    }
    finally { setBusy(""); }
  }

  const statusLabel: Record<string, string> = {
    open: "Awaiting payment",
    processing: "Processing",
    paid: "Paid and reconciled",
    creating: "Checkout setup interrupted",
    failed: "Payment failed",
    superseded: "Replaced after failure",
    review_required: "Admin review required",
  };

  if (isProtected) return <div className="crm-payment-boundary"><strong>AEA protected payment path</strong><p>Direct payment links are disabled because the installer cannot contact this household. Payment requests will need an AEA-mediated workflow.</p></div>;
  const stripeConnected = providers.some((provider) => provider.provider === "stripe" && provider.status === "connected");
  const squareConnected = providers.some((provider) => provider.provider === "square" && provider.status === "connected");
  const current = links[0];
  const blockingLink = links.find((link) => ["open", "processing", "review_required", "paid"].includes(link.status));
  const interruptedLink = links.find((link) => link.status === "creating");
  const paymentRequested = Boolean(blockingLink);
  const interruptedProvider = interruptedLink?.provider || "";
  const invoicePayment = purpose === "invoice";
  const providerButton = (provider: "stripe" | "square", connected: boolean) => {
    const label = provider === "stripe" ? "Stripe" : "Square";
    const requestLabel = provider === "stripe" ? "Request with Stripe" : "Request with Square";
    const otherSetupInProgress = Boolean(interruptedProvider && interruptedProvider !== provider);
    const disabled = paymentRequested || otherSetupInProgress || Boolean(busy) || suggestedAmountCents < 100;
    const text = paymentRequested
      ? blockingLink?.status === "paid" ? "Payment received" : blockingLink?.status === "review_required" ? "Review payment first" : "Payment already requested"
      : otherSetupInProgress ? "Other checkout in progress"
        : busy === provider ? "Creating..."
          : !connected ? `Connect ${label}`
            : interruptedProvider === provider ? `Finish ${label} checkout`
              : current && ["failed", "superseded"].includes(current.status) ? `Replace with ${label}` : requestLabel;
    return <button type="button" disabled={disabled} onClick={() => connected ? void createLink(provider) : onOpenIntegrations?.()}>{text}</button>;
  };
  return <section className="crm-payment-panel">
    <header><div><span>{invoicePayment ? "Invoice payment" : "Deposit request"}</span><h4>Secure provider checkout</h4><p>{invoicePayment ? "Request the full quick invoice total through Stripe or Square." : "Request the agreed deposit through Stripe or Square."} Card data stays with the payment provider.</p></div></header>
    <div className="crm-payment-create"><div><span>{invoicePayment ? "Invoice total" : "Deposit to request"}</span><strong>{new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(suggestedAmountCents / 100)}</strong><small>{paymentRequested ? "The existing provider request stays authoritative." : interruptedProvider ? "Finish the interrupted checkout with the same provider." : current && ["failed", "superseded"].includes(current.status) ? "The failed checkout will be closed before its replacement is issued." : invoicePayment ? "Locked to the TLink quick invoice." : "Locked to the accepted quote handoff."}</small></div>{providerButton("stripe", stripeConnected)}{providerButton("square", squareConnected)}<button type="button" className="crm-payment-refresh" disabled={Boolean(busy)} onClick={() => void load().then(async () => { setStatus("Payment status refreshed from the verified provider ledger."); await onChanged?.(); }).catch((error) => setStatus(error instanceof Error ? error.message : "Payment status could not be refreshed."))}>Refresh status</button></div>
    {links.length > 0 && <ol>{links.map((link) => <li key={link.id} className={`payment-${link.status}`}><div><span>{link.provider} | {new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(link.amountCents / 100)}</span><strong>{statusLabel[link.status] || "Awaiting provider update"}</strong><small>{link.paidAt ? `Verified ${new Date(link.paidAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}` : `Created ${new Date(link.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}`}</small></div>{link.checkoutUrl && ["open", "processing"].includes(link.status) && <a href={link.checkoutUrl} target="_blank" rel="noreferrer">Open checkout</a>}</li>)}</ol>}
    {status && <p className="crm-inline-status" role="status">{status}</p>}
  </section>;
}
