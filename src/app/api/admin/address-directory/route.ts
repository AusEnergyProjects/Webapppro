import { adminJson, sameOrigin } from "@/lib/admin-server";
import { gnafBucket } from "@/lib/gnaf-directory-server";
import { GNAF_MAX_MANIFEST_BYTES, GNAF_MAX_COMPRESSED_BYTES } from "@/lib/gnaf-directory";
import { gnafProvisionAuthorized, GnafProvisionError, readGnafUpload, uploadGnafPart, verifyGnafBatch, activateGnafDirectory } from "@/lib/gnaf-provision";
import { readBoundedJsonRequest } from "@/lib/bounded-json-request";

export const runtime = "edge";
async function allowed(request: Request) {
  return sameOrigin(request) && await gnafProvisionAuthorized(request, process.env);
}
function failure(error: unknown) {
  return adminJson({ ok: false, error: error instanceof GnafProvisionError ? error.message : "Directory input could not be verified." }, error instanceof GnafProvisionError ? error.status : 400);
}
export async function PUT(request: Request) {
  if (!await allowed(request)) return adminJson({ ok: false, error: "Directory maintenance is unavailable." }, 403);
  try {
    const params = new URL(request.url).searchParams, version = params.get("version") || "", part = params.get("part") || "";
    if (version !== process.env.TLINK_GNAF_IMPORT_VERSION) throw new GnafProvisionError("Directory version is not authorised.", 403);
    const bytes = await readGnafUpload(request, part === "manifest.json" ? GNAF_MAX_MANIFEST_BYTES : GNAF_MAX_COMPRESSED_BYTES);
    return adminJson({ ok: true, ...await uploadGnafPart(gnafBucket(), version, part, bytes) });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!await allowed(request)) return adminJson({ ok: false, error: "Directory maintenance is unavailable." }, 403);
  try {
    const body = await readBoundedJsonRequest(request);
    if (!body || typeof body !== "object" || !("version" in body) || body.version !== process.env.TLINK_GNAF_IMPORT_VERSION || typeof body.version !== "string" || !("action" in body)) throw new GnafProvisionError("Invalid directory action.");
    if (body.action === "verify" && "offset" in body && typeof body.offset === "number") return adminJson({ ok: true, ...await verifyGnafBatch(gnafBucket(), body.version, body.offset) });
    if (body.action === "activate") return adminJson({ ok: true, ...await activateGnafDirectory(gnafBucket(), body.version) });
    throw new GnafProvisionError("Invalid directory action.");
  } catch (error) { return failure(error); }
}
