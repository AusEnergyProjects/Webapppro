import { getD1 } from "../../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { requireAdminIdentity } from "@/lib/admin-server";
import { councilAccessError, councilJson, councilMemberships } from "@/lib/council-access-server";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    const identity = await requireFirebaseIdentity(request);
    if (!identity.emailVerified) throw new Error("EMAIL_VERIFICATION_REQUIRED");
    const councils = await councilMemberships(getD1(), identity);
    let canProvision = false;
    let adminMfaRequired = false;
    try {
      await requireAdminIdentity(request, ["owner", "admin"]);
      canProvision = true;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      adminMfaRequired = code === "MFA_REQUIRED";
      if (!["ADMIN_REQUIRED", "ADMIN_SUSPENDED", "ROLE_REQUIRED", "MFA_REQUIRED"].includes(code)) throw error;
    }
    return councilJson({ ok: true, councils, canProvision, adminMfaRequired });
  } catch (error) { return councilAccessError(error); }
}
