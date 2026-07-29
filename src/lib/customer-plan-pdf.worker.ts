/// <reference lib="webworker" />

import regularFontUrl from "dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url";
import boldFontUrl from "dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url";
import {
  createCustomerPlanPdfBytes,
  customerPlanPdfFileName,
} from "./customer-plan-pdf.mjs";
import type {
  CustomerPlanPdfWorkerRequest,
  CustomerPlanPdfWorkerResponse,
} from "./customer-plan-report";

const workerScope =
  globalThis as unknown as DedicatedWorkerGlobalScope;
let fontBytesPromise: Promise<{
  regularFontBytes: ArrayBuffer;
  boldFontBytes: ArrayBuffer;
}> | null = null;

function fetchFont(url: string): Promise<ArrayBuffer> {
  return fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error("The PDF typeface could not be loaded.");
    }
    return response.arrayBuffer();
  });
}

function loadFontBytes() {
  fontBytesPromise ??= Promise.all([
    fetchFont(regularFontUrl),
    fetchFont(boldFontUrl),
  ]).then(([regularFontBytes, boldFontBytes]) => ({
    regularFontBytes,
    boldFontBytes,
  }));
  return fontBytesPromise;
}

workerScope.addEventListener(
  "message",
  async (event: MessageEvent<CustomerPlanPdfWorkerRequest>) => {
    const { id, report } = event.data;
    try {
      const fontBytes = await loadFontBytes();
      const generated = await createCustomerPlanPdfBytes(report, fontBytes);
      const bytes = new ArrayBuffer(generated.byteLength);
      new Uint8Array(bytes).set(generated);
      const response: CustomerPlanPdfWorkerResponse = {
        id,
        ok: true,
        bytes,
        fileName: customerPlanPdfFileName(report),
      };
      workerScope.postMessage(response, [bytes]);
    } catch (error) {
      const response: CustomerPlanPdfWorkerResponse = {
        id,
        ok: false,
        error: error instanceof Error
          ? error.message
          : "The PDF could not be prepared.",
      };
      workerScope.postMessage(response);
    }
  },
);
