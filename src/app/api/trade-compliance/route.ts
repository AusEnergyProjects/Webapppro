import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import {
  AUSTRALIAN_SITE_JURISDICTIONS,
  ComplianceDomainError,
  listInstallerSelectableActivities,
} from "@/lib/creditex-compliance-server";
import { ensureCreditexSchemaGuards } from "@/lib/creditex-schema-guards";
import {
  requireVerifiedTradeAccess,
  TradeAccessError,
} from "@/lib/trade-access-server";

export const runtime = "edge";

const ACTIVITY_PAGE_SIZE = 200;

function errorResponse(error: unknown) {
  if (error instanceof TradeAccessError) {
    return adminJson({ ok: false, code: error.code, error: error.message }, error.status);
  }
  if (error instanceof ComplianceDomainError) {
    return adminJson({ ok: false, code: error.code, error: error.message }, error.status);
  }
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  }
  console.error("Installer compliance catalogue failure", error);
  return adminJson({ ok: false, error: "The approved compliance activity catalogue could not be loaded." }, 500);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) {
    return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  try {
    await requireVerifiedTradeAccess(request, { partnerTypes: ["installer"] });
    const database = getD1();
    await ensureCreditexSchemaGuards(database);
    const url = new URL(request.url);
    const jurisdiction = cleanAdminText(url.searchParams.get("jurisdiction"), 20).toUpperCase();
    const onDate = String(url.searchParams.get("onDate") || "").trim();
    if (!AUSTRALIAN_SITE_JURISDICTIONS.includes(jurisdiction as typeof AUSTRALIAN_SITE_JURISDICTIONS[number])) {
      throw new ComplianceDomainError("INVALID_SITE_JURISDICTION", 400, "Choose the Australian job jurisdiction before selecting an activity.");
    }
    if (!onDate) {
      throw new ComplianceDomainError("ACTIVITY_DATE_REQUIRED", 400, "Choose the planned installation date before selecting an activity.");
    }
    const afterActivityId = String(url.searchParams.get("afterActivityId") || "").trim();
    const page = await listInstallerSelectableActivities(database, {
      serviceCategory: cleanAdminText(url.searchParams.get("serviceCategory"), 60),
      jurisdiction,
      onDate,
      limit: ACTIVITY_PAGE_SIZE + 1,
      afterActivityId,
    });
    const hasNext = page.length > ACTIVITY_PAGE_SIZE;
    const activities = page.slice(0, ACTIVITY_PAGE_SIZE);
    return adminJson({
      ok: true,
      activities: activities.map((activity) => ({
        id: activity.id,
        organisationName: activity.organisationName,
        programName: activity.programName,
        programCode: activity.programCode,
        schemeKind: activity.schemeKind,
        jurisdiction: activity.jurisdiction,
        activityKey: activity.activityKey,
        version: activity.version,
        title: activity.title,
        serviceCategory: activity.serviceCategory,
        registryActivityCode: activity.registryActivityCode,
        specificationPart: activity.specificationPart,
        productCategory: activity.productCategory,
        scenarioCode: activity.scenarioCode,
        scenario: activity.scenario,
        effectiveFrom: activity.effectiveFrom,
        effectiveTo: activity.effectiveTo,
        officialSourceUrl: activity.officialSourceUrl,
        officialSourceTitle: activity.officialSourceTitle,
        officialSourceVersion: activity.officialSourceVersion,
        calculationApprovalState: activity.calculationApprovalState,
      })),
      pagination: {
        pageSize: ACTIVITY_PAGE_SIZE,
        hasNext,
        nextCursor: hasNext ? activities.at(-1)?.id || "" : "",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
