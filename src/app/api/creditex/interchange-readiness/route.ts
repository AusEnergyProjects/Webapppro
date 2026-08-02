import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceIdentity,
} from "@/lib/compliance-access-server";
import {
  CREDITEX_INTERCHANGE_PREFLIGHT_CONTRACT,
  CREDITEX_INTERCHANGE_PREFLIGHT_REVIEWED_ON,
  CREDITEX_VEU_INTERCHANGE_DESCRIPTOR,
} from "@/lib/creditex-interchange-preflight";
import {
  CREDITEX_REC_BULK_UPLOAD_CONTRACT,
  CREDITEX_REC_BULK_UPLOAD_DESCRIPTORS,
  CREDITEX_REC_BULK_UPLOAD_REVIEWED_ON,
} from "@/lib/creditex-rec-bulk-upload";
import {
  CREDITEX_TESSA_CSV_CONTRACT,
  CREDITEX_TESSA_CSV_DESCRIPTORS,
  CREDITEX_TESSA_CSV_REVIEWED_ON,
} from "@/lib/creditex-tessa-csv";
import { requireFirebaseIdentity } from "@/lib/firebase-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const TESSA_BLOCK_REASON =
  "The exact official TESSA v1.7 workbook bytes, SHA-256 and an independently reviewed field dictionary are not retained, so parsing, validation and export remain blocked.";
const REC_BLOCK_REASON =
  "The exact official REC Registry header, field dictionary, business rules and reference data are not retained as an approved versioned asset, so functional parsing and export remain blocked.";

const adapters = Object.freeze([
  Object.freeze({
    programCode: "VEU",
    pathway: "authorised_api",
    status: "blocked",
    ...CREDITEX_VEU_INTERCHANGE_DESCRIPTOR,
    blockReason: CREDITEX_VEU_INTERCHANGE_DESCRIPTOR.blockReason,
  }),
  Object.freeze({
    programCode: "ESS",
    pathway: "tessa_csv",
    status: "blocked",
    blockReason: TESSA_BLOCK_REASON,
    ...CREDITEX_TESSA_CSV_DESCRIPTORS.ESS,
  }),
  Object.freeze({
    programCode: "PDRS",
    pathway: "tessa_csv",
    status: "blocked",
    blockReason: TESSA_BLOCK_REASON,
    ...CREDITEX_TESSA_CSV_DESCRIPTORS.PDRS,
  }),
  Object.freeze({
    programCode: "SRES",
    pathway: "rec_registry_bulk_csv",
    status: "blocked",
    blockReason: REC_BLOCK_REASON,
    ...CREDITEX_REC_BULK_UPLOAD_DESCRIPTORS.SGU,
  }),
  Object.freeze({
    programCode: "SRES",
    pathway: "rec_registry_bulk_csv",
    status: "blocked",
    blockReason: REC_BLOCK_REASON,
    ...CREDITEX_REC_BULK_UPLOAD_DESCRIPTORS.SWH_ASHP,
  }),
] as const);

const readiness = Object.freeze({
  contract: "creditex-interchange-readiness/v1",
  reviewedOn: "2026-08-03",
  readOnly: true,
  dryRunOnly: true,
  externalSubmissionEnabled: false,
  sourceContracts: Object.freeze({
    preflight: CREDITEX_INTERCHANGE_PREFLIGHT_CONTRACT,
    tessa: CREDITEX_TESSA_CSV_CONTRACT,
    recRegistry: CREDITEX_REC_BULK_UPLOAD_CONTRACT,
  }),
  sourceReviews: Object.freeze({
    preflight: CREDITEX_INTERCHANGE_PREFLIGHT_REVIEWED_ON,
    tessa: CREDITEX_TESSA_CSV_REVIEWED_ON,
    recRegistry: CREDITEX_REC_BULK_UPLOAD_REVIEWED_ON,
  }),
  counts: Object.freeze({
    adapters: adapters.length,
    ready: 0,
    blocked: adapters.length,
    serializersAvailable: adapters.filter(
      (adapter) => adapter.serializerAvailable,
    ).length,
    externalSubmissionEnabled: adapters.filter(
      (adapter) => adapter.externalSubmissionEnabled,
    ).length,
  }),
  adapters,
});

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
  if (error instanceof ComplianceAccessError) {
    return json(
      { ok: false, code: error.code, error: error.message },
      error.status,
    );
  }
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return json(
      { ok: false, code: "AUTH_REQUIRED", error: "Sign in to continue." },
      401,
    );
  }
  console.error("Creditex interchange readiness request failed", error);
  return json({
    ok: false,
    code: "CREDITEX_INTERCHANGE_READINESS_UNAVAILABLE",
    error: "Interchange readiness is temporarily unavailable. Try again.",
  }, 500);
}

async function requireMember(request: Request, database: D1Database) {
  const identity = await requireFirebaseIdentity(request);
  return requireComplianceIdentity(identity, {
    allowedRoles: ["admin", "case_manager", "reviewer", "auditor"],
  }, database);
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
    await requireMember(request, database);
    return json({ ok: true, readiness });
  } catch (error) {
    return errorResponse(error);
  }
}
