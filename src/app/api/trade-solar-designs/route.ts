import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { TradeAccessError } from "@/lib/trade-access-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { SOLAR_DESIGN_MAX_BYTES } from "@/lib/trade-solar-design";
import { assertSolarDesignAccess, attachSolarDesign, listSolarDesigns, loadSolarDesign, saveSolarDesign } from "@/lib/trade-solar-design-server";

export const runtime = "edge";

function errorResponse(error: unknown) {
  const mfa = mfaErrorResponse(error);
  if (mfa) return mfa;
  if (error instanceof TradeAccessError) return adminJson({ ok: false, code: error.code, error: error.message }, error.status);
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to use saved designs." }, 401);
  if (["PROFILE_REQUIRED", "ACCOUNT_INACTIVE", "INSTALLER_ONLY", "TRADE_ROLE_REQUIRED", "FULL_ACCESS_REQUIRED", "ABN_REVIEW_REQUIRED", "EMAIL_VERIFICATION_REQUIRED", "TEAM_ACCESS_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED", "SOLAR_DESIGN_ACCESS_REQUIRED", "SOLAR_DESIGN_BROWSE_REQUIRED"].includes(code)) {
    return adminJson({ ok: false, code, error: "Your team access does not allow this design action." }, 403);
  }
  if (code === "SOLAR_DESIGN_REVISION_CONFLICT") return adminJson({ ok: false, code, error: "This design changed in another window. Reopen the saved design before editing again." }, 409);
  if (["SOLAR_DESIGN_NOT_FOUND", "SOLAR_DESIGN_CONTEXT_UNAVAILABLE"].includes(code)) return adminJson({ ok: false, code, error: "This design or its customer job is no longer available to your account." }, 404);
  if (code === "SOLAR_DESIGN_INVALID") return adminJson({ ok: false, code, error: "Check the design details and try saving again." }, 400);
  return adminJson({ ok: false, error: "The design could not be saved or loaded. Try again shortly." }, 503);
}

/** A bounded stream prevents an oversized JSON body allocating arbitrary memory before validation. */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const maximum = SOLAR_DESIGN_MAX_BYTES + 2_000;
  if (Number(request.headers.get("content-length") || 0) > maximum || !request.body) throw new Error("SOLAR_DESIGN_INVALID");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new Error("SOLAR_DESIGN_INVALID"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("SOLAR_DESIGN_INVALID"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("SOLAR_DESIGN_INVALID");
  return body as Record<string, unknown>;
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request), url = new URL(request.url);
    assertSolarDesignAccess(access);
    if (url.searchParams.has("resource")) throw new Error("SOLAR_DESIGN_INVALID");
    if (url.searchParams.get("id")) return adminJson({ ok: true, design: await loadSolarDesign(access, url.searchParams.get("id")) });
    return adminJson({ ok: true, ...await listSolarDesigns(access, {
      customerId: url.searchParams.get("customerId"), workOrderId: url.searchParams.get("workOrderId"), offset: Number(url.searchParams.get("offset") || 0), search: url.searchParams.get("search"),
    }) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    assertSolarDesignAccess(access, true);
    const body = await readBody(request);
    if (body.action === "attach") return adminJson({ ok: true, design: await attachSolarDesign(access, body.id, body.expectedRevision, body.workOrderId, body.customerId) });
    if (body.action !== undefined && body.action !== "save") throw new Error("SOLAR_DESIGN_INVALID");
    return adminJson({ ok: true, design: await saveSolarDesign(access, body.design, body.id, body.expectedRevision) });
  } catch (error) { return errorResponse(error); }
}
