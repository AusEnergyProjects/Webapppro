import type { User } from "firebase/auth";

export function TradePaymentPanel({ isProtected, suggestedAmountCents, purpose = "deposit" }: { user: User; workOrderId: string; isProtected: boolean; suggestedAmountCents: number; purpose?: "deposit" | "invoice"; onOpenIntegrations?: () => void; onChanged?: () => Promise<void> }) {
  if (isProtected) return <div className="crm-payment-boundary"><strong>Payments unavailable on ChatGPT Sites</strong><p>TLink cannot create, request or open a financial transaction while hosted on ChatGPT Sites.</p></div>;
  const invoicePayment = purpose === "invoice";
  return <section className="crm-payment-panel">
    <header><div><span>{invoicePayment ? "Invoice reference" : "Deposit reference"}</span><h4>Payment processing is outside TLink</h4><p>Financial transactions are unavailable while TLink is hosted on ChatGPT Sites. TLink cannot create, request, open or reconcile a checkout here.</p></div></header>
    <div className="crm-payment-create"><div><span>{invoicePayment ? "Invoice reference total" : "Deposit reference total"}</span><strong>{new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(suggestedAmountCents / 100)}</strong><small>Use your own approved process outside TLink if a customer payment is required.</small></div></div>
  </section>;
}
