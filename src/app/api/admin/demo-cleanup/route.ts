import { getD1 } from "../../../../../db";
import { adminJson, requireAdminIdentity, sameOrigin } from "@/lib/admin-server";
import { ComplianceAccessError, requireComplianceIdentity, type ComplianceIdentity } from "@/lib/compliance-access-server";
import { ensureCreditexPilotSchemaGuards } from "@/lib/creditex-schema-guards";
import { archiveDemoCleanup, DemoCleanupError, previewDemoCleanup, requireRecentDemoCleanupAuthentication } from "@/lib/admin-demo-cleanup-server";

export const runtime = "edge";

function failure(error: unknown) {
  if (error instanceof DemoCleanupError || error instanceof ComplianceAccessError) return adminJson({ ok: false, error: error.message }, error.status);
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["ROLE_REQUIRED", "ADMIN_REQUIRED", "ADMIN_SUSPENDED", "EMAIL_VERIFICATION_REQUIRED"].includes(code)) return adminJson({ ok: false, error: "Active, verified platform owner access is required." }, 403);
  return adminJson({ ok: false, error: "Demo cleanup could not be confirmed. Refresh the preview before continuing." }, 500);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const owner = await requireAdminIdentity(request, ["owner"]);
    return adminJson({ ok: true, preview: await previewDemoCleanup(getD1(), owner) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const owner = await requireAdminIdentity(request, ["owner"]);
    requireRecentDemoCleanupAuthentication(owner);
    const raw = await request.text();
    if (raw.length > 1000) return adminJson({ ok: false, error: "Invalid cleanup request." }, 400);
    const input = JSON.parse(raw) as { digest?: unknown; confirmation?: unknown };
    if (input.confirmation !== "ARCHIVE DEMO DATA") return adminJson({ ok: false, error: "Confirm the reviewed demo archival." }, 400);
    const database = getD1();
    const preview = await previewDemoCleanup(database, owner);
    if (preview.digest !== input.digest) throw new DemoCleanupError("DEMO_PREVIEW_CHANGED", 409, "The demo records changed after preview. Refresh the preview before archiving.");
    const members = new Map<string, ComplianceIdentity>();
    for (const organisationId of preview.pilotOrganisationIds) members.set(organisationId, await requireComplianceIdentity(owner, { allowedRoles: ["admin"], organisationId, claimPendingInvitation: false }, database));
    if (members.size) await ensureCreditexPilotSchemaGuards(database);
    return adminJson({ ok: true, ...await archiveDemoCleanup(database, owner, input.digest, members) });
  } catch (error) { return failure(error); }
}
