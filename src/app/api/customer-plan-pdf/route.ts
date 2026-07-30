import {
  CustomerPlanPdfUnsupportedTextError,
  createCustomerPlanPdfBytes,
  customerPlanPdfFileName,
} from "@/lib/customer-plan-pdf.mjs";

export const runtime = "edge";

const MAX_BODY_BYTES = 320_000;
const MAX_REPORT_BYTES = 96_000;
const MAX_FONT_BYTES = 500_000;
const PDF_FONT_PATHS = {
  regular: "/fonts/LiberationSans-Regular.ttf",
  bold: "/fonts/LiberationSans-Bold.ttf",
} as const;
const fontCache = new Map<
  string,
  Promise<{ regular: Uint8Array; bold: Uint8Array }>
>();

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

function embeddedPdfFonts(request: Request) {
  const origin = new URL(request.url).origin;
  const cached = fontCache.get(origin);
  if (cached) return cached;
  const loading = Promise.all(
    Object.entries(PDF_FONT_PATHS).map(async ([weight, path]) => {
      const response = await fetch(new URL(path, origin), {
        cache: "force-cache",
      });
      if (!response.ok) {
        throw new Error(`PDF_${weight.toUpperCase()}_FONT_UNAVAILABLE`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < 10_000 || bytes.byteLength > MAX_FONT_BYTES) {
        throw new Error(`PDF_${weight.toUpperCase()}_FONT_INVALID`);
      }
      return [weight, bytes] as const;
    }),
  ).then((entries) => Object.fromEntries(entries) as {
    regular: Uint8Array;
    bold: Uint8Array;
  }).catch((error) => {
    fontCache.delete(origin);
    throw error;
  });
  fontCache.set(origin, loading);
  return loading;
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
    const bytes = await createCustomerPlanPdfBytes(
      report,
      await embeddedPdfFonts(request),
    );
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
  } catch (error) {
    if (error instanceof CustomerPlanPdfUnsupportedTextError) {
      return messageResponse(
        "The PDF cannot display some characters in this plan yet. Email the plan instead, or replace the unsupported text before downloading.",
        422,
      );
    }
    return messageResponse("The PDF could not be prepared.", 400);
  }
}
