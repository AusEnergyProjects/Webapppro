import {
  createCustomerPlanPdfBytes,
  customerPlanPdfFileName,
} from "@/lib/customer-plan-pdf.mjs";

export const runtime = "edge";

const MAX_BODY_BYTES = 320_000;
const MAX_REPORT_BYTES = 96_000;

function messageResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function requestReport(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    throw new Error("INVALID_CONTENT_TYPE");
  }
  const suppliedLength = Number(request.headers.get("content-length") || 0);
  if (
    Number.isFinite(suppliedLength)
    && suppliedLength > MAX_BODY_BYTES
  ) {
    throw new Error("BODY_TOO_LARGE");
  }
  const source = await request.text();
  if (new TextEncoder().encode(source).byteLength > MAX_BODY_BYTES) {
    throw new Error("BODY_TOO_LARGE");
  }
  const serializedReport = new URLSearchParams(source).get("report") || "";
  if (
    !serializedReport
    || new TextEncoder().encode(serializedReport).byteLength > MAX_REPORT_BYTES
  ) {
    throw new Error("INVALID_REPORT");
  }
  try {
    return JSON.parse(serializedReport) as unknown;
  } catch {
    throw new Error("INVALID_REPORT");
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return messageResponse("The PDF request origin was not accepted.", 403);
  }

  let report: unknown;
  try {
    report = await requestReport(request);
  } catch (error) {
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") {
      return messageResponse("The PDF request was too large.", 413);
    }
    return messageResponse("The PDF request was not valid.", 400);
  }

  try {
    const bytes = await createCustomerPlanPdfBytes(report);
    const fileName = customerPlanPdfFileName(report);
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return messageResponse("The PDF could not be prepared.", 400);
  }
}
