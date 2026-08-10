import type {
  CustomerPlanReportView,
} from "./customer-plan-report";

const MAX_REPORT_BYTES = 96_000;
const DOWNLOAD_URL_REVOKE_DELAY_MS = 1_000;

function responseFileName(response: Response) {
  const disposition = response.headers.get("content-disposition") || "";
  const match = /filename="([a-z0-9-]+\.pdf)"/i.exec(disposition);
  return match?.[1] || "home-energy-plan.pdf";
}

export async function downloadCustomerPlanPdf(
  report: CustomerPlanReportView,
): Promise<void> {
  const serializedReport = JSON.stringify(report);
  if (
    new TextEncoder().encode(serializedReport).byteLength > MAX_REPORT_BYTES
  ) {
    throw new Error(
      "This plan is too large to download. Remove some custom steps and try again.",
    );
  }
  const response = await fetch("/api/customer-plan-pdf", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({ report: serializedReport }),
  });
  if (!response.ok) {
    const message = (await response.text()).trim().slice(0, 240);
    throw new Error(
      message || "The PDF could not be prepared. Please try again.",
    );
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/pdf")) {
    throw new Error(
      "The PDF service returned an invalid document. Please try again.",
    );
  }
  const blob = await response.blob();
  if (blob.size < 1_000) {
    throw new Error(
      "The PDF service returned an incomplete document. Please try again.",
    );
  }
  const objectUrl = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = objectUrl;
  link.download = responseFileName(response);
  link.hidden = true;
  window.document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(
    () => URL.revokeObjectURL(objectUrl),
    DOWNLOAD_URL_REVOKE_DELAY_MS,
  );
}
