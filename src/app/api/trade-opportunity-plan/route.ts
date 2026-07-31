import { getD1 } from "../../../../db";
import { accountHasFeature } from "@/lib/direct-trade-entitlements-server";
import {
  createInstallerPlanReportView,
} from "@/lib/customer-plan-document.mjs";
import {
  requireVerifiedTradeAccess,
  TradeAccessError,
} from "@/lib/trade-access-server";

export const runtime = "edge";

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function tradeAccessCode(error: unknown) {
  return error instanceof TradeAccessError
    ? error.code
    : error instanceof Error
      ? error.message
      : "";
}

function matchIdFrom(request: Request) {
  const value = new URL(request.url).searchParams.get("matchId")?.trim() || "";
  return /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,179}$/.test(value) ? value : "";
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) {
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  }

  let access: Awaited<ReturnType<typeof requireVerifiedTradeAccess>>;
  try {
    access = await requireVerifiedTradeAccess(request, {
      partnerTypes: ["installer"],
    });
  } catch (error) {
    const code = tradeAccessCode(error);
    if (code === "AUTH_REQUIRED") {
      return json({ ok: false, error: "Sign in to continue." }, 401);
    }
    if (code === "TRADE_ROLE_REQUIRED") {
      return json({
        ok: false,
        error: "Household plans are never available to wholesaler accounts.",
      }, 403);
    }
    if (code === "PROFILE_REQUIRED" || code === "ACCOUNT_INACTIVE") {
      return json({
        ok: false,
        error: "An active verified installer account is required.",
      }, 403);
    }
    return json({
      ok: false,
      error: "Complete trade verification before opening household plans.",
    }, 403);
  }

  if (
    !await accountHasFeature(
      access.identity.uid,
      "installer",
      "installer_leads",
    )
  ) {
    return json({
      ok: false,
      error: "Complete trade verification before opening household plans.",
    }, 403);
  }

  const matchId = matchIdFrom(request);
  if (!matchId) {
    return json({ ok: false, error: "Choose a valid household lead." }, 400);
  }

  const db = getD1();
  const project = await db.prepare(`SELECT
      p.id, p.firebase_uid, p.goal, p.goals, p.pace, p.postcode,
      p.address_state, p.property_type, p.household_situation,
      p.existing_features, p.service_categories, p.budget_range,
      p.property_context, p.advisor_profile, p.plan_snapshot,
      p.completed_plan_items, p.updated_at
    FROM trade_opportunity_matches m
    JOIN trade_opportunities o ON o.id = m.opportunity_id
    JOIN customer_projects p ON p.opportunity_id = o.id
    WHERE m.id = ? AND m.firebase_uid = ?
      AND m.status IN ('offered', 'viewed', 'interested', 'connected')
      AND o.status IN ('open', 'paused')
      AND o.source_reference LIKE 'customer-project:%'
      AND EXISTS (
        SELECT 1 FROM customer_consent_receipts consent
        WHERE consent.project_id = p.id
          AND consent.firebase_uid = p.firebase_uid
          AND consent.purpose = 'anonymized_installer_matching'
          AND consent.withdrawn_at = ''
      )
    LIMIT 1`)
    .bind(matchId, access.identity.uid)
    .first<Record<string, unknown>>();

  if (!project) {
    return json({
      ok: false,
      error: "This household plan is not available to this installer.",
    }, 404);
  }

  const evidence = await db.prepare(`SELECT e.fact_keys, e.sharing_scope
    FROM customer_project_evidence e
    WHERE e.project_id = ? AND e.customer_uid = ?
      AND e.status = 'active'
      AND e.sharing_scope = 'allocated-installers'
      AND EXISTS (
        SELECT 1 FROM customer_consent_receipts consent
        WHERE consent.project_id = e.project_id
          AND consent.firebase_uid = e.customer_uid
          AND consent.purpose = 'installer_evidence_sharing'
          AND consent.withdrawn_at = ''
      )
    ORDER BY e.created_at`)
    .bind(String(project.id), String(project.firebase_uid))
    .all<Record<string, unknown>>();

  return json({
    ok: true,
    report: createInstallerPlanReportView(project, {
      preparedAt: String(project.updated_at || new Date().toISOString()),
      evidence: evidence.results,
    }),
  });
}
