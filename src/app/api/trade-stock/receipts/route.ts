import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { TradeAccessError } from "@/lib/trade-access-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { requireStockAccess } from "@/lib/trade-stock-server";
import { MAX_RECEIPT_BYTES } from "@/lib/trade-stock-receipts";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/lib/bounded-request-body.mjs";
import { readStockReceipt, receiveStockReceipt, stockReceiptWorkspace, uploadStockReceipt } from "@/lib/trade-stock-receipts-server";

export const runtime = "edge";
function failure(error: unknown) {
  const mfa = mfaErrorResponse(error); if (mfa) return mfa;
  if (error instanceof TradeAccessError) return adminJson({ ok: false, error: error.message }, error.status);
  const code = error instanceof Error ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}` : "";
  if (code.includes("AUTH_REQUIRED")) return adminJson({ ok: false, error: "Sign in to manage stock." }, 401);
  if (["STOCK_ACCESS_REQUIRED", "TEAM_ACCESS_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED", "PROFILE_REQUIRED", "ACCOUNT_INACTIVE", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "ABN_REVIEW_REQUIRED"].some(value => code.includes(value))) return adminJson({ ok: false, error: "Your business access does not allow stock receiving." }, 403);
  if (code.includes("RECEIPT_NOT_FOUND")) return adminJson({ ok: false, error: "Document not found." }, 404);
  if (code.includes("RECEIPT_ALREADY_RECEIVED") || code.includes("trade_stock_receipts.firebase_uid")) return adminJson({ ok: false, error: "This document or supplier reference has already been received. Refresh to check the receipt before adding stock again." }, 409);
  if (code.includes("STOCK_STALE")) return adminJson({ ok: false, error: "Stock changed during your review. Refresh the stock counts, check your quantities and confirm again." }, 409);
  if (["STOCK_NOT_TRACKED", "RECEIPT_PRODUCT_UNAVAILABLE", "RECEIPT_LOCATION_UNAVAILABLE"].some(value => code.includes(value))) return adminJson({ ok: false, error: "A product or location is no longer available for receiving. Refresh and check your selections." }, 409);
  if (code.includes("RECEIPT_DAILY_LIMIT")) return adminJson({ ok: false, error: "You have reached today's 20 document uploads. You can still receive stock manually." }, 429);
  if (code.includes("RECEIPT_TOO_LARGE") || error instanceof RequestBodyTooLargeError) return adminJson({ ok: false, error: "The upload or receipt details are too large." }, 413);
  if (code.includes("RECEIPT_PAGE_LIMIT")) return adminJson({ ok: false, error: "Choose a PDF with 20 pages or fewer." }, 400);
  if (code.includes("RECEIPT_DUPLICATE_PRODUCT")) return adminJson({ ok: false, error: "Combine duplicate products into one quantity before confirming." }, 400);
  if (["RECEIPT_INVALID", "PRODUCT_DOCUMENT", "CHECK constraint failed"].some(value => code.includes(value)) || error instanceof SyntaxError) return adminJson({ ok: false, error: "Check the PDF and received quantities. Choose an unlocked PDF and positive quantities for tracked products." }, 400);
  return adminJson({ ok: false, error: "The result could not be confirmed. Refresh this document to check its status before receiving it again." }, 503);
}
export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request); requireStockAccess(access, true);
    const query = new URL(request.url).searchParams, id = query.get("receiptId") || "";
    if (query.get("download") === "1") {
      const result = await readStockReceipt(access.ownerUid, id);
      return new Response(result.bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="supplier-document.pdf"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" } });
    }
    return adminJson({ ok: true, ...await stockReceiptWorkspace(access.ownerUid, id) });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request); requireStockAccess(access, true);
    if (request.headers.get("content-type")?.split(";")[0] === "application/pdf") {
      if (!request.body || Number(request.headers.get("content-length") || 0) > MAX_RECEIPT_BYTES) throw new Error("RECEIPT_TOO_LARGE");
      const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > MAX_RECEIPT_BYTES) { await reader.cancel(); throw new Error("RECEIPT_TOO_LARGE"); } chunks.push(next.value); } }
      finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return adminJson({ ok: true, ...await uploadStockReceipt(access.ownerUid, access.actorUid, new URL(request.url).searchParams.get("filename"), bytes) });
    }
    if (Number(request.headers.get("content-length") || 0) > 100_000) throw new Error("RECEIPT_INVALID");
    const raw: unknown = JSON.parse(await readBoundedRequestText(request, 100_000));
    await receiveStockReceipt(access.ownerUid, access.actorUid, raw);
    return adminJson({ ok: true, received: true });
  } catch (error) { return failure(error); }
}
