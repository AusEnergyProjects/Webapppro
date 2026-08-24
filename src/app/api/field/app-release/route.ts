import { adminJson, cleanAdminText } from "@/lib/admin-server";
import { mobileAppPolicy, MOBILE_PLATFORMS } from "@/lib/trade-mobile-server";

export const runtime = "edge";

export async function GET(request: Request) {
  const platform = cleanAdminText(new URL(request.url).searchParams.get("platform"), 20);
  const selected = MOBILE_PLATFORMS.has(platform) ? platform : "android";
  return adminJson({ ok: true, policy: mobileAppPolicy(selected) });
}
