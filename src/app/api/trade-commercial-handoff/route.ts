import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { depositAmountCents } from "@/lib/trade-commercial-handoff";
import {
  assertDirectTradeOwnedJob,
  ensureAcceptedCommercialHandoff,
} from "@/lib/trade-commercial-handoff-server";
import { requireInstallerOperations } from "@/lib/trade-integrations-server";

export const runtime = "edge";
type Row = Record<string, unknown>;

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["PROFILE_REQUIRED", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "ACCOUNT_INACTIVE"].includes(code)) return adminJson({ ok: false, error: "Commercial handoff is not available to this account." }, 403);
  if (code === "DIRECT_CUSTOMER_REQUIRED") return adminJson({ ok: false, error: "This handoff is only available for your own direct customer jobs." }, 403);
  if (code === "INVALID_COMMERCIAL_HANDOFF") return adminJson({ ok: false, error: "The accepted quote could not produce a safe commercial handoff." }, 409);
  return adminJson({ ok: false, error: "The accepted quote handoff could not be loaded." }, 500);
}

function handoffJson(row: Row) {
  let scope: unknown[] = [];
  try { const parsed = JSON.parse(String(row.scope_snapshot_json || "[]")); if (Array.isArray(parsed)) scope = parsed; } catch { scope = []; }
  return {
    id: String(row.id), acceptanceId: String(row.acceptance_id), commercialReference: String(row.commercial_reference), currency: "AUD",
    scope, terms: String(row.terms_snapshot || ""), subtotalCents: Number(row.subtotal_cents), taxCents: Number(row.tax_cents), totalCents: Number(row.total_cents),
    depositKind: String(row.deposit_kind), depositBasisPoints: Number(row.deposit_basis_points), depositFixedCents: Number(row.deposit_fixed_cents),
    depositAmountCents: Number(row.deposit_amount_cents), status: String(row.status), acceptedAt: String(row.accepted_at),
  };
}

async function timeline(firebaseUid: string, handoff: Row) {
  const db = getD1(); const handoffId = String(handoff.id); const events: { type: string; status: string; provider: string; summary: string; occurredAt: string }[] = [
    { type: "accepted", status: "confirmed", provider: "tlink", summary: `Quote accepted for ${String(handoff.commercial_reference)}.`, occurredAt: String(handoff.accepted_at) },
  ];
  const documents = await db.prepare(`SELECT provider, status, external_number, created_at, last_synced_at, last_error FROM trade_crm_accounting_documents
    WHERE firebase_uid = ? AND commercial_handoff_id = ? ORDER BY created_at`).bind(firebaseUid, handoffId).all<Row>();
  for (const row of documents.results) events.push({ type: "accounting", status: String(row.status), provider: String(row.provider),
    summary: row.external_number ? `Accounting draft ${String(row.external_number)} is ready for review.` : row.last_error ? "Accounting draft needs attention." : "Accounting draft is being prepared.",
    occurredAt: String(row.last_synced_at || row.created_at) });
  return events.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request); const workOrderId = cleanAdminText(new URL(request.url).searchParams.get("workOrderId"), 180);
    const database = getD1();
    await assertDirectTradeOwnedJob(database, identity.uid, workOrderId);
    const handoff = await ensureAcceptedCommercialHandoff(database, identity.uid, workOrderId);
    return adminJson({ ok: true, handoff: handoff ? handoffJson(handoff) : null, timeline: handoff ? await timeline(identity.uid, handoff) : [] });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request); const body = await request.json() as Row;
    const database = getD1();
    const workOrderId = cleanAdminText(body.workOrderId, 180);
    await assertDirectTradeOwnedJob(database, identity.uid, workOrderId);
    const handoff = await ensureAcceptedCommercialHandoff(database, identity.uid, workOrderId); if (!handoff) return adminJson({ ok: false, error: "Accept a quote before setting its deposit." }, 409);
    const kind = cleanAdminText(body.depositKind, 20) === "fixed" ? "fixed" : "percentage";
    const value = Number(body.value); const amount = depositAmountCents(Number(handoff.total_cents), kind, value);
    const now = new Date().toISOString();
    await database.prepare(`UPDATE trade_crm_commercial_handovers SET deposit_kind = ?, deposit_basis_points = ?, deposit_fixed_cents = ?,
      deposit_amount_cents = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`)
      .bind(kind, kind === "percentage" ? value : 0, kind === "fixed" ? value : 0, amount, now, handoff.id, identity.uid).run();
    const updated = await ensureAcceptedCommercialHandoff(database, identity.uid, workOrderId);
    return adminJson({ ok: true, handoff: handoffJson(updated!), timeline: await timeline(identity.uid, updated!) });
  } catch (error) { return errorResponse(error); }
}
