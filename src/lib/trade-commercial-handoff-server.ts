import {
  acceptedScopeSnapshot,
  depositAmountCents,
} from "@/lib/trade-commercial-handoff";

export type CommercialHandoffRow = Record<string, unknown>;

export async function assertDirectTradeOwnedJob(
  database: D1Database,
  firebaseUid: string,
  workOrderId: string,
) {
  const row = await database.prepare(`SELECT w.id, w.source_type, d.customer_source
    FROM trade_work_orders w
    JOIN trade_crm_job_details d
      ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    WHERE w.id = ? AND w.firebase_uid = ?
      AND w.partner_type = 'installer' AND w.record_status = 'active'`)
    .bind(workOrderId, firebaseUid)
    .first<CommercialHandoffRow>();
  if (
    !row
    || row.source_type !== "internal"
    || row.customer_source !== "trade_owned"
  ) {
    throw new Error("DIRECT_CUSTOMER_REQUIRED");
  }
  return row;
}

export async function ensureAcceptedCommercialHandoff(
  database: D1Database,
  firebaseUid: string,
  workOrderId: string,
) {
  const acceptance = await database.prepare(`SELECT a.*, v.terms
    FROM trade_crm_quote_acceptances a
    JOIN trade_crm_quote_versions v
      ON v.id = a.quote_version_id AND v.firebase_uid = a.firebase_uid
    WHERE a.firebase_uid = ? AND a.work_order_id = ?
      AND a.decision = 'accepted'
    ORDER BY a.decided_at DESC
    LIMIT 1`)
    .bind(firebaseUid, workOrderId)
    .first<CommercialHandoffRow>();
  if (!acceptance) return null;
  let handoff = await database.prepare(`SELECT *
    FROM trade_crm_commercial_handovers
    WHERE firebase_uid = ? AND work_order_id = ? AND acceptance_id = ?
      AND status = 'accepted'
    LIMIT 1`)
    .bind(firebaseUid, workOrderId, acceptance.id)
    .first<CommercialHandoffRow>();
  if (handoff) return handoff;

  let selectedIds: string[] = [];
  try {
    const parsed = JSON.parse(
      String(acceptance.selected_choice_ids_json || "[]"),
    );
    if (Array.isArray(parsed)) selectedIds = parsed.map(String);
  } catch {
    selectedIds = [];
  }
  const itemRows = await database.prepare(`SELECT *
    FROM trade_crm_quote_items
    WHERE quote_version_id = ? AND firebase_uid = ?
    ORDER BY position`)
    .bind(acceptance.quote_version_id, firebaseUid)
    .all<CommercialHandoffRow>();
  const scope = acceptedScopeSnapshot(itemRows.results, selectedIds);
  const now = new Date().toISOString();
  const totalCents = Number(acceptance.selected_total_cents);

  await database.prepare(`INSERT OR IGNORE INTO trade_crm_commercial_handovers
    (id, acceptance_id, quote_id, quote_version_id, work_order_id,
     firebase_uid, crm_customer_id, commercial_reference, currency,
     scope_snapshot_json, terms_snapshot, subtotal_cents, tax_cents,
     total_cents, deposit_kind, deposit_basis_points, deposit_fixed_cents,
     deposit_amount_cents, status, accepted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AUD', ?, ?, ?, ?, ?, 'percentage',
      1000, 0, ?, 'accepted', ?, ?, ?)`)
    .bind(
      crypto.randomUUID(),
      acceptance.id,
      acceptance.quote_id,
      acceptance.quote_version_id,
      workOrderId,
      firebaseUid,
      acceptance.crm_customer_id,
      acceptance.commercial_reference,
      JSON.stringify(scope),
      String(acceptance.terms || ""),
      Number(acceptance.selected_subtotal_cents),
      Number(acceptance.selected_tax_cents),
      totalCents,
      depositAmountCents(totalCents, "percentage", 1000),
      acceptance.decided_at,
      now,
      now,
    )
    .run();

  handoff = await database.prepare(`SELECT *
    FROM trade_crm_commercial_handovers
    WHERE firebase_uid = ? AND work_order_id = ? AND acceptance_id = ?
      AND status = 'accepted'
    LIMIT 1`)
    .bind(firebaseUid, workOrderId, acceptance.id)
    .first<CommercialHandoffRow>();
  return handoff || null;
}

export async function commercialHandoffScopeSha256(
  handoff: CommercialHandoffRow,
) {
  const snapshot = String(handoff.scope_snapshot_json || "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot);
  } catch {
    throw new Error("INVALID_COMMERCIAL_HANDOFF");
  }
  if (!Array.isArray(parsed) || parsed.length < 1) {
    throw new Error("INVALID_COMMERCIAL_HANDOFF");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(snapshot),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
