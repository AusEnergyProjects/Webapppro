import {
  CustomerPlanPdfFontError,
  loadCustomerPlanPdfFonts,
} from "@/lib/customer-plan-pdf-fonts";
import {
  isPublicPlanUpgradeInterest,
} from "@/lib/public-plan-enquiry.mjs";

export const runtime = "edge";

const MAX_BODY_BYTES = 320_000;
const MAX_REPORT_BYTES = 96_000;
const MAX_PUBLIC_PLAN_BYTES = 48_000;

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

function pdfFailureCode(error: unknown) {
  if (error instanceof CustomerPlanPdfFontError) return "font_invalid";
  const message = error instanceof Error ? error.message : "";
  if (/embedded .* font/i.test(message)) return "font_invalid";
  return "generation_failed";
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

type PdfRequestSource =
  | { kind: "report"; value: unknown }
  | { kind: "publicPlan"; value: unknown };

async function requestPdfSource(request: Request): Promise<PdfRequestSource> {
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
  const params = new URLSearchParams(source);
  const serializedReport = params.get("report") || "";
  const serializedPublicPlan = params.get("publicPlan") || "";
  if (Boolean(serializedReport) === Boolean(serializedPublicPlan)) {
    throw new Error("INVALID_REPORT");
  }
  const serialized = serializedPublicPlan || serializedReport;
  const maximum = serializedPublicPlan
    ? MAX_PUBLIC_PLAN_BYTES
    : MAX_REPORT_BYTES;
  if (new TextEncoder().encode(serialized).byteLength > maximum) {
    throw new Error("INVALID_REPORT");
  }
  try {
    return {
      kind: serializedPublicPlan ? "publicPlan" : "report",
      value: JSON.parse(serialized) as unknown,
    };
  } catch {
    throw new Error("INVALID_REPORT");
  }
}

function canonicalPublicPlanInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_REPORT");
  }
  const source = value as Record<string, unknown>;
  if (
    !source.snapshot
    || typeof source.snapshot !== "object"
    || Array.isArray(source.snapshot)
  ) {
    throw new Error("INVALID_REPORT");
  }
  const projectCategories = Array.isArray(source.projectCategories)
    ? source.projectCategories
      .filter((category): category is string =>
        typeof category === "string" && isPublicPlanUpgradeInterest(category))
      .slice(0, 12)
    : [];
  return {
    snapshot: source.snapshot as Record<string, unknown>,
    name: typeof source.name === "string" ? source.name : "",
    postcode: typeof source.postcode === "string" ? source.postcode : "",
    projectCategories,
    preparedAt: typeof source.preparedAt === "string"
      ? source.preparedAt
      : new Date().toISOString(),
  };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return messageResponse("The PDF request origin was not accepted.", 403);
  }

  let pdfSource: PdfRequestSource;
  try {
    pdfSource = await requestPdfSource(request);
  } catch (error) {
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") {
      return messageResponse("The PDF request was too large.", 413);
    }
    return messageResponse("The PDF request was not valid.", 400);
  }

  let CustomerPlanPdfUnsupportedTextError:
    | (typeof import("@/lib/customer-plan-pdf.mjs"))["CustomerPlanPdfUnsupportedTextError"]
    | undefined;
  try {
    const customerPlanPdf = await import("@/lib/customer-plan-pdf.mjs");
    CustomerPlanPdfUnsupportedTextError =
      customerPlanPdf.CustomerPlanPdfUnsupportedTextError;
    const fonts = await loadCustomerPlanPdfFonts();
    let report;
    let bytes;
    if (pdfSource.kind === "publicPlan") {
      const { createPublicPlanCustomerPdfBundle } = await import(
        "@/lib/public-plan-customer-pdf.mjs"
      );
      ({ report, bytes } = await createPublicPlanCustomerPdfBundle(
        canonicalPublicPlanInput(pdfSource.value),
        fonts,
      ));
    } else {
      report = pdfSource.value;
      bytes = await customerPlanPdf.createCustomerPlanPdfBytes(report, fonts);
    }
    const fileName = customerPlanPdf.customerPlanPdfFileName(report);
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
    if (
      CustomerPlanPdfUnsupportedTextError
      && error instanceof CustomerPlanPdfUnsupportedTextError
    ) {
      return messageResponse(
        "The PDF cannot display some characters in this plan yet. Email the plan instead, or replace the unsupported text before downloading.",
        422,
      );
    }
    const failureCode = pdfFailureCode(error);
    console.error("customer_plan_pdf_generation_failed", {
      code: failureCode,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return messageResponse(
      failureCode.startsWith("font_")
        ? "The PDF service could not load its document fonts. Please try again."
        : "The PDF could not be prepared. Please try again.",
      failureCode.startsWith("font_") ? 503 : 500,
    );
  }
}
