"use client";

import { useRef, useState } from "react";
import { downloadCustomerPlanPdf } from "@/lib/customer-plan-pdf-client";
import type { CustomerPlanReportView } from "@/lib/customer-plan-report";

export function DownloadCustomerPlanPdfButton({
  report,
}: {
  report: CustomerPlanReportView;
}) {
  const downloadingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const download = async () => {
    if (downloadingRef.current) return;
    downloadingRef.current = true;
    setBusy(true);
    setError("");
    try {
      await downloadCustomerPlanPdf(report);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "The PDF could not be prepared.",
      );
    } finally {
      downloadingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" disabled={busy} onClick={() => void download()}>
        {busy ? "Preparing PDF..." : "Download PDF"}
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
