import { getD1 } from "../../../../../db";
import {
  hasManualFieldAssignment,
  requireManualFieldMember,
} from "@/lib/creditex-manual-field-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) {
    return json({
      ok: false,
      code: "ORIGIN_REJECTED",
      error: "Request origin was not accepted.",
    }, 403);
  }
  const modes: Array<"trade_team" | "creditex_manual"> = [];
  let displayName = "";
  let businessName = "";
  let fieldUsername = "";
  let tradeError: unknown;
  let manualError: unknown;
  try {
    const trade = await requireInstallerTeamAccess(request);
    modes.push("trade_team");
    displayName = trade.displayName;
    businessName = trade.businessName;
    fieldUsername = trade.fieldUsername || "";
  } catch (error) {
    tradeError = error;
  }
  try {
    const database = getD1();
    const member = await requireManualFieldMember(request, database);
    if (await hasManualFieldAssignment(database, member)) {
      modes.push("creditex_manual");
      if (!displayName) displayName = member.displayName;
      if (!businessName) {
        businessName = member.organisationTradingName
          || member.organisationLegalName;
      }
    }
  } catch (error) {
    manualError = error;
  }
  if (modes.length) {
    return json({
      ok: true,
      mode: modes[0],
      modes,
      displayName,
      businessName,
      fieldUsername,
      ...(modes.includes("creditex_manual")
        ? { recordMode: "synthetic_test" }
        : {}),
    });
  }
  const unauthenticated = [tradeError, manualError].every((error) =>
    error instanceof Error && error.message === "AUTH_REQUIRED"
  );
  if (unauthenticated) {
    return json({
      ok: false,
      code: "AUTH_REQUIRED",
      error: "Sign in to continue.",
    }, 401);
  }
  return json({
    ok: false,
    code: "FIELD_ACCESS_REQUIRED",
    error:
      "No active installer-team or assigned compliance manual-test access was found.",
  }, 403);
}
