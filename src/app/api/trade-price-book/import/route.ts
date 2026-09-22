import { getD1 } from "../../../../../db";
import { mfaErrorResponse, adminJson, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/lib/bounded-request-body.mjs";
import { PRICE_BOOK_IMPORT_MAX_BODY_BYTES } from "@/lib/trade-price-book-import";
import { importPriceBook, PriceBookImportError } from "@/lib/trade-price-book-import-server";

export const runtime = "edge";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!access.isOwner && !access.canManagePriceBook) return adminJson({ ok: false, error: "Price-book management access is required to import a spreadsheet." }, 403);
    const text = await readBoundedRequestText(request, PRICE_BOOK_IMPORT_MAX_BODY_BYTES);
    let body: unknown;
    try { body = JSON.parse(text); }
    catch { return adminJson({ ok: false, error: "The spreadsheet request could not be read. Upload the file again." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return adminJson({ ok: false, error: "Check the spreadsheet request." }, 400);
    return adminJson(await importPriceBook(getD1(), access.ownerUid, access.actorUid, body as Record<string, unknown>));
  } catch (error) {
    const mfa = mfaErrorResponse(error);
    if (mfa) return mfa;
    if (error instanceof RequestBodyTooLargeError) return adminJson({ ok: false, error: "This upload contains too much data. Use up to 2,000 rows and remove unused columns." }, 413);
    if (error instanceof PriceBookImportError) return adminJson({ ok: false, error: error.message, ...(error.preview ? { preview: error.preview } : {}) }, error.status);
    const code = error instanceof Error ? error.message : "";
    if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
    if (["ACCOUNT_INACTIVE", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "TEAM_ACCESS_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED"].includes(code)) {
      return adminJson({ ok: false, error: "An active verified installer account is required." }, 403);
    }
    return adminJson({ ok: false, error: "The spreadsheet save could not be confirmed. Preview the file again to check the latest items and prices." }, 500);
  }
}
