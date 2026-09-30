import { getD1 } from "../../../../../db";
import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { requireVerifiedTradeAccess, TradeAccessError } from "@/lib/trade-access-server";
import { commitTradeDataforceImport, DATAFORCE_IMPORT_MAX_BYTES, exportTradeDataforceSource,
  getTradeDataforceImport, previewTradeDataforceImport, TradeDataforceImportError } from "@/lib/trade-dataforce-import-server";

export const runtime = "edge";

function failure(error: unknown) {
  const mfa = mfaErrorResponse(error);
  if (mfa) return mfa;
  if (error instanceof TradeAccessError || error instanceof TradeDataforceImportError) return adminJson({ ok: false, error: error.message }, error.status);
  if (error instanceof Error && error.message === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to import business records." }, 401);
  return adminJson({ ok: false, error: "The import request could not finish. Saved progress is retained; open the batch and resume." }, 500);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireVerifiedTradeAccess(request, { partnerTypes: ["installer"] });
    const url = new URL(request.url);
    const batchId = (url.searchParams.get("batchId") || "").slice(0, 180);
    if (url.searchParams.get("format") === "source") {
      const source = await exportTradeDataforceSource(getD1(), access.identity.uid, batchId);
      return new Response(source.csv, { headers: { "Content-Type": "text/csv;charset=utf-8", "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="dataforce-source.csv"; filename*=UTF-8''${encodeURIComponent(source.fileName)}` } });
    }
    return adminJson({ ok: true, ...await getTradeDataforceImport(getD1(), access.identity.uid, batchId,
      Number(url.searchParams.get("offset") || 0), Number(url.searchParams.get("limit") || 100)) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireVerifiedTradeAccess(request, { partnerTypes: ["installer"] });
    if (Number(request.headers.get("Content-Length")) > DATAFORCE_IMPORT_MAX_BYTES * 2) return adminJson({ ok: false, error: "Choose a Dataforce CSV no larger than 10 MB." }, 413);
    let body: unknown;
    try { body = await request.json(); } catch { return adminJson({ ok: false, error: "Invalid import request." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return adminJson({ ok: false, error: "Invalid import request." }, 400);
    if (!("action" in body)) return adminJson({ ok: false, error: "Choose preview or commit." }, 400);
    if (body.action === "preview") {
      if (!("csvText" in body) || typeof body.csvText !== "string") return adminJson({ ok: false, error: "Choose a Dataforce CSV file." }, 400);
      return adminJson({ ok: true, ...await previewTradeDataforceImport(getD1(), access.identity.uid, body.csvText,
        "fileName" in body ? body.fileName : "dataforce-jobs.csv", "serviceCategoryMappings" in body ? body.serviceCategoryMappings : {}) }, 201);
    }
    if (body.action === "commit" && "batchId" in body && typeof body.batchId === "string") {
      return adminJson({ ok: true, ...await commitTradeDataforceImport(getD1(), access.identity.uid, body.batchId.slice(0, 180)) });
    }
    return adminJson({ ok: false, error: "Choose preview or commit." }, 400);
  } catch (error) { return failure(error); }
}
