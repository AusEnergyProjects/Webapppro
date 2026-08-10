"use client";

import { useRef, useState } from "react";
import { downloadCustomerPlanPdf } from "@/lib/customer-plan-pdf-client";
import type { CustomerPlanReportView } from "@/lib/customer-plan-report";

const DOWNLOAD_GUARD_MS = 1_500;

export function DownloadCustomerPlanPdfButton({
  report,
}: {
  report: CustomerPlanReportView;
}) {
  const downloadingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const download = async () => {
    if (downloadingRef.current) return;
    downloadingRef.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await downloadCustomerPlanPdf(report);
      setStatus("Your PDF download has started.");
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "The PDF could not be prepared.",
      );
      downloadingRef.current = false;
      setBusy(false);
      return;
    }
    window.setTimeout(() => {
      downloadingRef.current = false;
      setBusy(false);
    }, DOWNLOAD_GUARD_MS);
  };

  return (
    <>
      <button type="button" disabled={busy} onClick={download}>
        {busy ? "Starting download..." : "Download PDF"}
      </button>
      {error && <span role="alert">{error}</span>}
      {status && <span role="status">{status}</span>}
    </>
  );
}
