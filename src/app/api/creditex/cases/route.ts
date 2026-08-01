import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
import {
  COMPLIANCE_CASE_STATUSES,
  COMPLIANCE_EVIDENCE_STATUSES,
  ComplianceDomainError,
} from "@/lib/creditex-compliance-server";
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetAfter,
  type KeysetDirection,
} from "@/lib/keyset-pagination";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const OPEN_CASE_STATUSES = [
  "draft",
  "ready_for_submission",
  "submitted",
  "in_review",
  "changes_requested",
] as const;
const PAGE_SIZES = new Set([25, 50, 100]);
type CaseSortTerm = {
  expression: string;
  direction: KeysetDirection;
  rowKey: string;
};
const CASE_SORT: { orderBy: string; terms: CaseSortTerm[] } = {
  orderBy: "compliance_case.updated_at DESC, compliance_case.id DESC",
  terms: [
    {
      expression: "compliance_case.updated_at",
      direction: "desc",
      rowKey: "updated_at",
    },
    {
      expression: "compliance_case.id",
      direction: "desc",
      rowKey: "id",
    },
  ],
};

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function errorResponse(error: unknown) {
  if (error instanceof ComplianceAccessError || error instanceof ComplianceDomainError) {
    return json({ ok: false, code: error.code, error: error.message }, error.status);
  }
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return json({ ok: false, code: "AUTH_REQUIRED", error: "Sign in to continue." }, 401);
  }
  console.error("Creditex compliance case queue failed", error);
  return json({
    ok: false,
    code: "COMPLIANCE_CASE_QUEUE_UNAVAILABLE",
    error: "The compliance case queue could not be loaded. Try again.",
  }, 500);
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function object(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) {
    return json({
      ok: false,
      code: "ORIGIN_REJECTED",
      error: "Request origin was not accepted.",
    }, 403);
  }
  try {
    const database = getD1();
    const member = await requireComplianceAccess(request, {
      allowedRoles: ["admin", "case_manager", "reviewer", "auditor"],
    }, database);
    const url = new URL(request.url);
    const status = text(url.searchParams.get("status")) || "open";
    const evidenceStatus = text(url.searchParams.get("evidenceStatus"));
    if (
      status !== "open"
      && status !== "all"
      && !COMPLIANCE_CASE_STATUSES.includes(
        status as (typeof COMPLIANCE_CASE_STATUSES)[number],
      )
    ) {
      throw new ComplianceDomainError(
        "INVALID_CASE_STATUS",
        400,
        "Choose open cases, all cases, or an exact workflow status.",
      );
    }
    if (
      evidenceStatus
      && !COMPLIANCE_EVIDENCE_STATUSES.includes(
        evidenceStatus as (typeof COMPLIANCE_EVIDENCE_STATUSES)[number],
      )
    ) {
      throw new ComplianceDomainError(
        "INVALID_EVIDENCE_STATUS",
        400,
        "The compliance evidence status is invalid.",
      );
    }
    const requestedPageSize = Number(url.searchParams.get("pageSize") || 50);
    const pageSize = PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 50;
    const cursorInput = text(url.searchParams.get("cursor")).slice(0, 2_000);
    const cursorScope = [
      "creditex-cases",
      "updated-desc",
      status,
      evidenceStatus || "all-evidence",
      pageSize,
    ].join(":");
    let cursor;
    try {
      cursor = decodeKeysetCursor(
        cursorInput,
        cursorScope,
        CASE_SORT.terms.length,
      );
    } catch {
      throw new ComplianceDomainError(
        "INVALID_CASE_CURSOR",
        400,
        "This case page link has expired. Start again from the first page.",
      );
    }

    const conditions = ["compliance_case.organisation_id = ?"];
    const bindings: unknown[] = [member.organisationId];
    if (status === "open") {
      conditions.push(
        `compliance_case.status IN (${OPEN_CASE_STATUSES.map(() => "?").join(", ")})`,
      );
      bindings.push(...OPEN_CASE_STATUSES);
    } else if (status !== "all") {
      conditions.push("compliance_case.status = ?");
      bindings.push(status);
    }
    if (evidenceStatus) {
      conditions.push("compliance_case.evidence_status = ?");
      bindings.push(evidenceStatus);
    }
    if (cursor) {
      const after = keysetAfter(CASE_SORT.terms, cursor);
      conditions.push(`(${after.sql})`);
      bindings.push(...after.bindings);
    }
    const result = await database.prepare(`SELECT
        compliance_case.id,
        compliance_case.case_number,
        work.work_number,
        COALESCE(account.business_name, '') installer_business,
        compliance_case.activity_date,
        compliance_case.site_jurisdiction,
        compliance_case.activity_snapshot,
        compliance_case.status,
        compliance_case.evidence_status,
        compliance_case.created_at,
        compliance_case.updated_at
      FROM compliance_cases compliance_case
      JOIN trade_work_orders work
        ON work.id = compliance_case.work_order_id
        AND work.firebase_uid = compliance_case.installer_uid
      LEFT JOIN trade_accounts account
        ON account.firebase_uid = compliance_case.installer_uid
      WHERE ${conditions.join(" AND ")}
      ORDER BY ${CASE_SORT.orderBy}
      LIMIT ?`)
      .bind(...bindings, pageSize + 1)
      .all<Record<string, unknown>>();
    const hasNext = result.results.length > pageSize;
    const cases = result.results.slice(0, pageSize);
    const nextCursor = hasNext && cases.length
      ? encodeKeysetCursor(
          cursorScope,
          CASE_SORT.terms.map((term) => text(cases.at(-1)?.[term.rowKey])),
        )
      : "";

    return json({
      ok: true,
      cases: cases.map((item) => {
        const activity = object(item.activity_snapshot);
        return {
          caseId: text(item.id),
          caseNumber: text(item.case_number),
          jobNumber: text(item.work_number),
          installerBusiness:
            text(item.installer_business) || "Installer record unavailable",
          jurisdiction: text(item.site_jurisdiction),
          activityDate: text(item.activity_date),
          activity: {
            programName: text(activity.programName),
            activityKey: text(activity.activityKey),
            registryActivityCode: text(activity.registryActivityCode),
            title: text(activity.title),
            version: number(activity.version),
            specificationPart: text(activity.specificationPart),
            productCategory: text(activity.productCategory),
            scenarioCode: text(activity.scenarioCode),
            scenario: text(activity.scenario),
            effectiveFrom: text(activity.effectiveFrom),
            effectiveTo: text(activity.effectiveTo),
            officialSourceVersion: text(activity.officialSourceVersion),
          },
          evidenceStatus: text(item.evidence_status),
          workflowStatus: text(item.status),
          createdAt: text(item.created_at),
          updatedAt: text(item.updated_at),
        };
      }),
      pagination: {
        pageSize,
        hasNext,
        nextCursor,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
