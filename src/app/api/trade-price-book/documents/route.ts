import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { TradeAccessError } from "@/lib/trade-access-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { MAX_PRODUCT_DOCUMENT_BYTES, productDocumentMetadata } from "@/lib/trade-price-book-documents";
import { assertProductDocumentAccess, listPriceBookDocuments, readPriceBookDocument, removePriceBookDocument, uploadPriceBookDocument } from "@/lib/trade-price-book-documents-server";

export const runtime = "edge";
function errorResponse(error: unknown) {
  const mfa = mfaErrorResponse(error);
  if (mfa) return mfa;
  if (error instanceof TradeAccessError) return adminJson({ ok: false, error: error.message }, error.status);
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to use product documents." }, 401);
  if (["PROFILE_REQUIRED", "ACCOUNT_INACTIVE", "INSTALLER_ONLY", "TRADE_ROLE_REQUIRED", "FULL_ACCESS_REQUIRED", "ABN_REVIEW_REQUIRED", "EMAIL_VERIFICATION_REQUIRED", "TEAM_ACCESS_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED", "PRODUCT_DOCUMENT_ACCESS_REQUIRED"].includes(code)) return adminJson({ ok: false, error: "Your team access does not allow this product document action." }, 403);
  if (code === "PRODUCT_DOCUMENT_NOT_FOUND") return adminJson({ ok: false, error: "This product or document is no longer available." }, 404);
  if (code === "PRODUCT_DOCUMENT_PRODUCT_LIMIT") return adminJson({ ok: false, error: "This product already has five PDFs. Remove one before uploading another." }, 409);
  if (code === "PRODUCT_DOCUMENT_FORM_UNSUPPORTED") return adminJson({ ok: false, error: "Flatten or export this PDF first so completed form fields stay visible in the quote." }, 400);
  if (code === "PRODUCT_DOCUMENT_LIMIT") return adminJson({ ok: false, error: "Choose a PDF with no more than 40 pages." }, 400);
  if (code === "PRODUCT_DOCUMENT_TOO_LARGE") return adminJson({ ok: false, error: "Choose a PDF smaller than 8 MB." }, 413);
  if (code === "PRODUCT_DOCUMENT_INVALID") return adminJson({ ok: false, error: "Choose a valid, unlocked PDF document." }, 400);
  return adminJson({ ok: false, error: "The product document could not be saved or loaded. Try again shortly." }, 503);
}
async function pdfBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/pdf" || !request.body) throw new Error("PRODUCT_DOCUMENT_INVALID");
  if (Number(request.headers.get("content-length") || 0) > MAX_PRODUCT_DOCUMENT_BYTES) throw new Error("PRODUCT_DOCUMENT_TOO_LARGE");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_PRODUCT_DOCUMENT_BYTES) { await reader.cancel(); throw new Error("PRODUCT_DOCUMENT_TOO_LARGE"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request), query = new URL(request.url).searchParams;
    assertProductDocumentAccess(access);
    if (query.has("documentId")) {
      const result = await readPriceBookDocument(access, query.get("itemId"), query.get("documentId"));
      return new Response(new Uint8Array(result.bytes).buffer, { headers: {
        "Content-Type": "application/pdf", "Content-Length": String(result.bytes.length),
        "Content-Disposition": `attachment; filename="product-document.pdf"; filename*=UTF-8''${encodeURIComponent(result.document.fileName)}`,
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'",
      } });
    }
    return adminJson({ ok: true, documents: (await listPriceBookDocuments(access, query.get("itemId"))).map(productDocumentMetadata) });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request), query = new URL(request.url).searchParams;
    assertProductDocumentAccess(access, true);
    const document = await uploadPriceBookDocument(access, query.get("itemId"), query.get("filename"), query.get("label"), await pdfBody(request));
    return adminJson({ ok: true, document: productDocumentMetadata(document) }, 201);
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request), query = new URL(request.url).searchParams;
    await removePriceBookDocument(access, query.get("itemId"), query.get("documentId"));
    return adminJson({ ok: true });
  } catch (error) { return errorResponse(error); }
}
