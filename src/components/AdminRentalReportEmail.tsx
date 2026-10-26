"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import styles from "./AdminJobSupportWorkspace.module.css";

type Delivery = { status: string; message: string; reportId: string };
type EmailState = {
  reportId: string; reportNumber: string; recipientEmail: string;
  reportDelivery: Delivery | null; canSend: boolean; message?: string;
};

export function AdminRentalReportEmail({ user, workOrderId }: { user: User; workOrderId: string }) {
  const [state, setState] = useState<EmailState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [checkRequired, setCheckRequired] = useState(false);
  const active = useRef(true);
  const submitting = useRef(false);
  const load = useCallback(async () => {
    const token = await user.getIdToken();
    const response = await fetch(`/api/admin/jobs/rental-report-email?workOrderId=${encodeURIComponent(workOrderId)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    if (response.status === 403 || response.status === 404) {
      if (active.current) setState(null);
      return null;
    }
    const result = await response.json() as EmailState & { ok: boolean; error?: string };
    if (!response.ok || !result.ok) throw new Error(result.error || "Report email status could not be loaded.");
    if (active.current) { setState(result); setCheckRequired(false); }
    return result;
  }, [user, workOrderId]);

  useEffect(() => {
    active.current = true;
    void load().catch(() => { if (active.current) setMessage("Report email status could not be loaded. Refresh to try again."); });
    return () => { active.current = false; };
  }, [load]);

  async function refresh() {
    setBusy(true);
    try { await load(); if (active.current) setMessage(""); }
    catch (error) { if (active.current) setMessage(error instanceof Error ? error.message : "Email status could not be checked."); }
    finally { if (active.current) setBusy(false); }
  }

  async function send() {
    if (!state?.canSend || busy || checkRequired || submitting.current) return;
    submitting.current = true;
    setBusy(true); setCheckRequired(true); setMessage("Sending the saved report...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/admin/jobs/rental-report-email", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ workOrderId, reportId: state.reportId, expectedRecipientEmail: state.recipientEmail }),
      });
      const result = await response.json() as { ok: boolean; reportDelivery?: Delivery; error?: string };
      if (active.current) {
        setMessage(result.reportDelivery?.message || result.error || "Email delivery could not be confirmed. Refresh its status before retrying.");
        const reportDelivery = result.reportDelivery;
        if (reportDelivery) setState(current => current ? { ...current, canSend: false, reportDelivery } : current);
      }
      await load();
    } catch {
      try {
        const latest = await load();
        if (active.current) setMessage(latest?.reportDelivery?.message || "The response was interrupted. Email status has been checked.");
      } catch {
        if (active.current) setMessage("The response was interrupted. Refresh email status before retrying.");
      }
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  }

  if (!state && !message) return null;
  return <section className={styles.notice} aria-label="Admin report email">
    <strong>Report email{state && ` · ${state.reportNumber}`}</strong>
    {state && <p>Recipient: {state.recipientEmail || "No customer email saved"}</p>}
    <p role="status">{message || state?.message || state?.reportDelivery?.message || "Ready to email the saved report."}</p>
    <div className={styles.actions}>
      {state && <button type="button" disabled={busy || checkRequired || !state.canSend} onClick={() => void send()}>
        {busy ? "Checking delivery..." : state.reportDelivery?.status === "accepted" ? "Email accepted for delivery" : "Send saved report email"}
      </button>}
      <button type="button" disabled={busy} onClick={() => void refresh()}>Refresh email status</button>
    </div>
    <small>This admin action uses the business&apos;s report sender and records your admin account.</small>
  </section>;
}
