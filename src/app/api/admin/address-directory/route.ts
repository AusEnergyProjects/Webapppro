import { adminJson, sameOrigin } from "@/lib/admin-server";
import { gnafBucket } from "@/lib/gnaf-directory-server";
import { GNAF_MAX_MANIFEST_BYTES, GNAF_MAX_COMPRESSED_BYTES } from "@/lib/gnaf-directory";
import { gnafProvisionAuthorized, GnafProvisionError, readGnafUpload, uploadGnafPart, verifyGnafBatch, activateGnafDirectory } from "@/lib/gnaf-provision";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";

export const runtime = "edge";
async function allowed(request: Request) {
  return sameOrigin(request) && await gnafProvisionAuthorized(request, process.env);
}
type FailureContext = { operation: "upload" | "action" | "verify" | "activate"; part?: string; offset?: number };
function failure(error: unknown, context: FailureContext) {
  const known = error instanceof GnafProvisionError || error instanceof BoundedJsonRequestError;
  const status = known ? error.status : 503;
  const category = status === 400 ? "invalid_input" : status === 403 ? "unauthorised" : status === 409 ? "conflict"
    : status === 413 ? "payload_too_large" : "backend_failure";
  const response = adminJson({ ok: false, error: known ? error.message : "Directory storage is temporarily unavailable.", category, ...context }, status);
  response.headers.set("X-TLink-Directory-Error", category);
  return response;
}
export async function PUT(request: Request) {
  if (!await allowed(request)) return adminJson({ ok: false, error: "Directory maintenance is unavailable." }, 403);
  const context: FailureContext = { operation: "upload" };
  try {
    const params = new URL(request.url).searchParams, version = params.get("version") || "", part = params.get("part") || "";
    if (part === "manifest.json" || /^\d{4}\/[0-3]\.json\.gz$/.test(part)) context.part = part;
    if (version !== process.env.TLINK_GNAF_IMPORT_VERSION) throw new GnafProvisionError("Directory version is not authorised.", 403);
    const bytes = await readGnafUpload(request, part === "manifest.json" ? GNAF_MAX_MANIFEST_BYTES : GNAF_MAX_COMPRESSED_BYTES);
    return adminJson({ ok: true, ...await uploadGnafPart(gnafBucket(), version, part, bytes) });
  } catch (error) { return failure(error, context); }
}
export async function POST(request: Request) {
  if (!await allowed(request)) return adminJson({ ok: false, error: "Directory maintenance is unavailable." }, 403);
  const context: FailureContext = { operation: "action" };
  try {
    const body = await readBoundedJsonRequest(request);
    if (!body || typeof body !== "object" || !("version" in body) || body.version !== process.env.TLINK_GNAF_IMPORT_VERSION || typeof body.version !== "string" || !("action" in body)) throw new GnafProvisionError("Invalid directory action.");
    if (body.action === "verify" && "offset" in body && typeof body.offset === "number") {
      context.operation = "verify";
      if (Number.isSafeInteger(body.offset) && body.offset >= 0) context.offset = body.offset;
      return adminJson({ ok: true, ...await verifyGnafBatch(gnafBucket(), body.version, body.offset) });
    }
    if (body.action === "activate") {
      context.operation = "activate";
      return adminJson({ ok: true, ...await activateGnafDirectory(gnafBucket(), body.version) });
    }
    throw new GnafProvisionError("Invalid directory action.");
  } catch (error) { return failure(error, context); }
}
