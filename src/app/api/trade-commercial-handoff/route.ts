import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { acceptedScopeSnapshot, depositAmountCents } from "@/lib/trade-commercial-handoff";
import { requireInstallerOperations } from "@/lib/trade-integrations-server";

export const runtime = "edge";
type Row = Record<string, unknown>;

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["PROFILE_REQUIRED", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "ACCOUNT_INACTIVE"].includes(code)) return adminJson({ ok: false, error: "Commercial handoff is not available to this account." }, 403);
  if (code === "DIRECT_CUSTOMER_REQUIRED") return adminJson({ ok: false, error: "This handoff is only available for your own direct customer jobs." }, 403);
  if (code === "DEPOSIT_ALREADY_REQUESTED") return adminJson({ ok: false, error: "This deposit amount is locked because a payment request already exists." }, 409);
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

async function directJob(firebaseUid: string, workOrderId: string) {
  const row = await getD1().prepare(`SELECT w.id, w.source_type, d.customer_source FROM trade_work_orders w
    JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    WHERE w.id = ? AND w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'`)
    .bind(workOrderId, firebaseUid).first<Row>();
  if (!row || row.source_type !== "internal" || row.customer_source !== "trade_owned") throw new Error("DIRECT_CUSTOMER_REQUIRED");
}

async function ensureHandoff(firebaseUid: string, workOrderId: string) {
  const db = getD1();
  let handoff = await db.prepare(`SELECT * FROM trade_crm_commercial_handovers WHERE firebase_uid = ? AND work_order_id = ? ORDER BY accepted_at DESC LIMIT 1`)
    .bind(firebaseUid, workOrderId).first<Row>();
  if (handoff) return handoff;
  const acceptance = await db.prepare(`SELECT a.*, v.terms FROM trade_crm_quote_acceptances a
    JOIN trade_crm_quote_versions v ON v.id = a.quote_version_id AND v.firebase_uid = a.firebase_uid
    WHERE a.firebase_uid = ? AND a.work_order_id = ? AND a.decision = 'accepted' ORDER BY a.decided_at DESC LIMIT 1`)
    .bind(firebaseUid, workOrderId).first<Row>();
  if (!acceptance) return null;
  let selectedIds: string[] = [];
  try { const parsed = JSON.parse(String(acceptance.selected_choice_ids_json || "[]")); if (Array.isArray(parsed)) selectedIds = parsed.map(String); } catch { selectedIds = []; }
  const itemRows = await db.prepare(`SELECT * FROM trade_crm_quote_items WHERE quote_version_id = ? AND firebase_uid = ? ORDER BY position`)
    .bind(acceptance.quote_version_id, firebaseUid).all<Row>();
  const scope = acceptedScopeSnapshot(itemRows.results, selectedIds);
  const now = new Date().toISOString(); const totalCents = Number(acceptance.selected_total_cents);
  await db.prepare(`INSERT OR IGNORE INTO trade_crm_commercial_handovers
    (id, acceptance_id, quote_id, quote_version_id, work_order_id, firebase_uid, crm_customer_id, commercial_reference,
     currency, scope_snapshot_json, terms_snapshot, subtotal_cents, tax_cents, total_cents, deposit_kind,
     deposit_basis_points, deposit_fixed_cents, deposit_amount_cents, status, accepted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AUD', ?, ?, ?, ?, ?, 'percentage', 1000, 0, ?, 'accepted', ?, ?, ?)`)
    .bind(crypto.randomUUID(), acceptance.id, acceptance.quote_id, acceptance.quote_version_id, workOrderId, firebaseUid,
      acceptance.crm_customer_id, acceptance.commercial_reference, JSON.stringify(scope), String(acceptance.terms || ""),
      Number(acceptance.selected_subtotal_cents), Number(acceptance.selected_tax_cents), totalCents,
      depositAmountCents(totalCents, "percentage", 1000), acceptance.decided_at, now, now).run();
  handoff = await db.prepare(`SELECT * FROM trade_crm_commercial_handovers WHERE firebase_uid = ? AND work_order_id = ? ORDER BY accepted_at DESC LIMIT 1`)
    .bind(firebaseUid, workOrderId).first<Row>();
  return handoff || null;
}

async function timeline(firebaseUid: string, handoff: Row) {
  const db = getD1(); const handoffId = String(handoff.id); const events: { type: string; status: string; provider: string; summary: string; occurredAt: string }[] = [
    { type: "accepted", status: "confirmed", provider: "tlink", summary: `Quote accepted for ${String(handoff.commercial_reference)}.`, occurredAt: String(handoff.accepted_at) },
  ];
  const payments = await db.prepare(`SELECT provider, status, amount_cents, paid_amount_cents, created_at, last_event_at FROM trade_crm_payment_links
    WHERE firebase_uid = ? AND commercial_handoff_id = ? ORDER BY created_at`).bind(firebaseUid, handoffId).all<Row>();
  for (const row of payments.results) events.push({ type: "deposit", status: String(row.status), provider: String(row.provider),
    summary: row.status === "paid" ? `Provider confirmed the ${new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(row.paid_amount_cents) / 100)} deposit.` : `${new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(row.amount_cents) / 100)} deposit request created.`,
    occurredAt: String(row.last_event_at || row.created_at) });
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
    await directJob(identity.uid, workOrderId); const handoff = await ensureHandoff(identity.uid, workOrderId);
    return adminJson({ ok: true, handoff: handoff ? handoffJson(handoff) : null, timeline: handoff ? await timeline(identity.uid, handoff) : [] });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request); const body = await request.json() as Row;
    const workOrderId = cleanAdminText(body.workOrderId, 180); await directJob(identity.uid, workOrderId);
    const handoff = await ensureHandoff(identity.uid, workOrderId); if (!handoff) return adminJson({ ok: false, error: "Accept a quote before setting its deposit." }, 409);
    const existing = await getD1().prepare(`SELECT id FROM trade_crm_payment_links WHERE firebase_uid = ? AND commercial_handoff_id = ? LIMIT 1`)
      .bind(identity.uid, handoff.id).first();
    if (existing) throw new Error("DEPOSIT_ALREADY_REQUESTED");
    const kind = cleanAdminText(body.depositKind, 20) === "fixed" ? "fixed" : "percentage";
    const value = Number(body.value); const amount = depositAmountCents(Number(handoff.total_cents), kind, value);
    const now = new Date().toISOString();
    await getD1().prepare(`UPDATE trade_crm_commercial_handovers SET deposit_kind = ?, deposit_basis_points = ?, deposit_fixed_cents = ?,
      deposit_amount_cents = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`)
      .bind(kind, kind === "percentage" ? value : 0, kind === "fixed" ? value : 0, amount, now, handoff.id, identity.uid).run();
    const updated = await ensureHandoff(identity.uid, workOrderId);
    return adminJson({ ok: true, handoff: handoffJson(updated!), timeline: await timeline(identity.uid, updated!) });
  } catch (error) { return errorResponse(error); }
}
