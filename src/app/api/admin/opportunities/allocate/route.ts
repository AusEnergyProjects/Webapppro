import { allocateNearestInstallers } from "@/lib/opportunity-server";
import { adminError, adminJson, cleanAdminText, requireAdminIdentity, sameOrigin, writeAdminAudit } from "@/lib/admin-server";

export const runtime = "edge";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin"]);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid allocation request." }, 400); }
    const opportunityId = cleanAdminText(body.opportunityId, 180);
    if (!opportunityId) return adminJson({ ok: false, error: "Choose an open opportunity." }, 400);
    try {
      const result = await allocateNearestInstallers(opportunityId, admin.uid);
      await writeAdminAudit(admin, "opportunity.allocate", "trade_opportunity", opportunityId,
        `Allocated ${result.allocated.length} eligible installers using proximity and recent allocation load.`,
        { activeCount: result.activeCount, eligibleCount: result.eligibleCount, maximumVisible: 6 });
      return adminJson({ ok: true, ...result });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "OPPORTUNITY_NOT_FOUND") return adminJson({ ok: false, error: "Opportunity not found." }, 404);
      if (code === "OPPORTUNITY_NOT_OPEN") return adminJson({ ok: false, error: "Open the opportunity before allocating installers." }, 409);
      if (code === "POSTCODE_CENTROID_UNAVAILABLE") return adminJson({ ok: false, error: "This postcode does not have a service-distance centroid. Review the location before matching." }, 409);
      throw error;
    }
  } catch (error) { return adminError(error); }
}
