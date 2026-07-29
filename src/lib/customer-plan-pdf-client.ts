import type {
  CustomerPlanReportView,
} from "./customer-plan-report";

const MAX_REPORT_BYTES = 96_000;
const DOWNLOAD_FORM_REMOVE_DELAY_MS = 1_000;

export function downloadCustomerPlanPdf(
  report: CustomerPlanReportView,
): void {
  const serializedReport = JSON.stringify(report);
  if (
    new TextEncoder().encode(serializedReport).byteLength > MAX_REPORT_BYTES
  ) {
    throw new Error(
      "This plan is too large to download. Remove some custom steps and try again.",
    );
  }
  const form = window.document.createElement("form");
  form.method = "POST";
  form.action = "/api/customer-plan-pdf";
  form.acceptCharset = "UTF-8";
  form.hidden = true;
  form.setAttribute("aria-hidden", "true");
  const input = window.document.createElement("input");
  input.type = "hidden";
  input.name = "report";
  input.value = serializedReport;
  form.append(input);
  window.document.body.append(form);
  try {
    form.submit();
  } catch (error) {
    throw error;
  }
  window.setTimeout(() => form.remove(), DOWNLOAD_FORM_REMOVE_DELAY_MS);
}
