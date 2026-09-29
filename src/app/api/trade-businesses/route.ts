import { adminJson, mfaErrorResponse } from "@/lib/admin-server";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { listTradeBusinesses, TradeBusinessContextError } from "@/lib/trade-business-context-server";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    const businesses = await listTradeBusinesses(await requireFirebaseIdentity(request));
    return adminJson({ ok: true, businesses, requiresSelection: businesses.length > 1 });
  } catch (error) {
    if (error instanceof TradeBusinessContextError) {
      return adminJson({ ok: false, code: error.code, error: error.publicMessage }, error.status);
    }
    const mfa = mfaErrorResponse(error);
    if (mfa) return mfa;
    if (error instanceof Error && error.message === "AUTH_REQUIRED") {
      return adminJson({ ok: false, code: "AUTH_REQUIRED", error: "Sign in to choose your business." }, 401);
    }
    return adminJson({ ok: false, error: "Your businesses could not be loaded. Please try again." }, 503);
  }
}
