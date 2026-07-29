import type {
  CustomerPlanPdfWorkerRequest,
  CustomerPlanPdfWorkerResponse,
  CustomerPlanReportView,
} from "./customer-plan-report";

const PDF_GENERATION_TIMEOUT_MS = 45_000;
const PDF_URL_REVOKE_DELAY_MS = 30_000;

function generateCustomerPlanPdf(
  report: CustomerPlanReportView,
): Promise<{ bytes: ArrayBuffer; fileName: string }> {
  const worker = new Worker(
    new URL("./customer-plan-pdf.worker.ts", import.meta.url),
    { type: "module", name: "customer-plan-pdf" },
  );
  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      window.clearTimeout(timeout);
      worker.terminate();
      return true;
    };
    const timeout = window.setTimeout(() => {
      if (!finish()) return;
      reject(new Error("The PDF took too long to prepare. Please try again."));
    }, PDF_GENERATION_TIMEOUT_MS);

    worker.addEventListener(
      "message",
      (event: MessageEvent<CustomerPlanPdfWorkerResponse>) => {
        if (event.data.id !== id || !finish()) return;
        if (!event.data.ok) {
          reject(new Error(event.data.error));
          return;
        }
        resolve({
          bytes: event.data.bytes,
          fileName: event.data.fileName,
        });
      },
    );
    worker.addEventListener("error", () => {
      if (!finish()) return;
      reject(new Error("The PDF generator could not be started."));
    });

    const request: CustomerPlanPdfWorkerRequest = { id, report };
    worker.postMessage(request);
  });
}

export async function downloadCustomerPlanPdf(
  report: CustomerPlanReportView,
): Promise<{ fileName: string; sizeBytes: number }> {
  const generated = await generateCustomerPlanPdf(report);
  const blob = new Blob([generated.bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = generated.fileName;
  anchor.rel = "noopener";
  anchor.hidden = true;
  window.document.body.append(anchor);
  try {
    anchor.click();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    anchor.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), PDF_URL_REVOKE_DELAY_MS);
  return { fileName: generated.fileName, sizeBytes: blob.size };
}
