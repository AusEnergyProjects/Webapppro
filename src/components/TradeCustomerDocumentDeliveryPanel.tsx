"use client";

import { useState } from "react";
import type { User } from "firebase/auth";
import registerStyles from "./InstallerCrmJobRegister.module.css";

export type CustomerDocumentDelivery = {
  deliveryId: string;
  appointmentId: string;
  status: string;
  providerStatus: string;
  canRetry: boolean;
  documentIds: string[];
  acceptedAt: string;
  sentAt: string;
  deliveredAt: string;
  failedAt: string;
  lastError: string;
  updatedAt: string;
};

export type CustomerDocumentSendResult = {
  requested: boolean;
  status: "not_required" | "provider_accepted" | "failed" | "unavailable";
  canRetry: boolean;
  message: string;
  acceptedAt: string;
  documentIds: string[];
  documentSha256Set: string[];
};

export function TradeCustomerDocumentDeliveryPanel({
  delivery,
  jobId,
  onReload,
  user,
}: {
  delivery?: CustomerDocumentDelivery | null;
  jobId: string;
  onReload: () => Promise<void>;
  user: User;
}) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const accepted = delivery ? ["provider_accepted", "sent", "delivered"].includes(delivery.status) : false;
  const blocked = delivery ? !accepted && !delivery.canRetry : false;

  async function resend() {
    setSending(true);
    setMessage("Sending the required customer documents...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-crm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "resend_activity_customer_documents", workOrderId: jobId }),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; customerDocuments?: CustomerDocumentSendResult; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Customer documents could not be sent.");
      setMessage(result.customerDocuments?.message || "Customer document delivery was updated.");
      await onReload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer documents could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return <section className={registerStyles.detailSection} aria-labelledby={`customer-documents-${jobId}`}>
    <div className={registerStyles.detailHeading}><div><span>Booking documents</span><h4 id={`customer-documents-${jobId}`}>Customer document delivery</h4></div><strong>{delivery ? delivery.status.replaceAll("_", " ") : "Needs attention"}</strong></div>
    <p>{delivery
      ? accepted
        ? `${delivery.documentIds.length} required document${delivery.documentIds.length === 1 ? " was" : "s were"} accepted by the email provider${delivery.deliveredAt ? " and confirmed delivered" : ""}.`
        : blocked
          ? delivery.providerStatus === "reconciliation_required"
            ? delivery.lastError || "An administrator must reconcile this delivery before another send can start."
            : "The customer email reported a complaint or suppression. Update the customer email before sending the required documents again."
          : delivery.lastError || "The required document pack must be sent successfully before customer declaration or signing."
      : "No successful delivery is recorded for the required customer document pack."}</p>
    {!accepted && delivery?.canRetry !== false && <button type="button" className="btn" disabled={sending} onClick={() => void resend()}>{sending ? "Sending..." : "Send required documents again"}</button>}
    {message && <p className="crm-status" role="status">{message}</p>}
  </section>;
}
