import { getD1 } from "../../db";
import { ensureTradeStockSchemaGuards } from "./trade-stock-schema-guards";
import type { TeamAccess } from "./trade-team-server";
import { normaliseStockMutation, type JobStockSummary, type StockHistoryEntry, type StockItem, type StockMutation } from "./trade-stock";

type Row = Record<string, unknown>;
const ITEM_PROJECTION = `p.id item_id,p.item_code,p.name,p.item_type,p.unit_label,p.record_status,
  COALESCE(s.tracked,0) tracked,COALESCE(s.on_hand_milli,0) on_hand_milli,
  COALESCE(s.low_stock_milli,0) low_stock_milli,COALESCE(s.revision,0) revision,
  COALESCE((SELECT SUM(r.quantity_milli) FROM trade_stock_active_reservations r WHERE r.item_id=p.id AND r.firebase_uid=p.firebase_uid),0) reserved_milli`;

export function requireStockAccess(access: TeamAccess, manage = false) {
  if (!access.isOwner && (!access.canViewPriceBook || (manage && !access.canManagePriceBook))) throw new Error("STOCK_ACCESS_REQUIRED");
}
function item(row: Row): StockItem {
  const onHandMilli = Number(row.on_hand_milli); const reservedMilli = Number(row.reserved_milli);
  return { itemId: String(row.item_id), itemCode: String(row.item_code), name: String(row.name), itemType: String(row.item_type),
    unitLabel: String(row.unit_label), recordStatus: String(row.record_status), tracked: Boolean(row.tracked), onHandMilli, reservedMilli,
    availableMilli: onHandMilli - reservedMilli, lowStockMilli: Number(row.low_stock_milli), revision: Number(row.revision) };
}
export async function listStock(ownerUid: string): Promise<StockItem[]> {
  const rows = await getD1().prepare(`SELECT ${ITEM_PROJECTION} FROM trade_price_book_items p
    LEFT JOIN trade_stock_items s ON s.item_id=p.id AND s.firebase_uid=p.firebase_uid
    WHERE p.firebase_uid=? AND p.item_type IN ('material','equipment') AND (p.record_status='active' OR s.tracked=1)
    ORDER BY p.name COLLATE NOCASE,p.id LIMIT 5000`).bind(ownerUid).all<Row>();
  return rows.results.map(item);
}
export async function stockItem(ownerUid: string, itemId: string): Promise<StockItem> {
  const row = await getD1().prepare(`SELECT ${ITEM_PROJECTION} FROM trade_price_book_items p
    LEFT JOIN trade_stock_items s ON s.item_id=p.id AND s.firebase_uid=p.firebase_uid
    WHERE p.id=? AND p.firebase_uid=? AND p.item_type IN ('material','equipment')`).bind(itemId, ownerUid).first<Row>();
  if (!row) throw new Error("STOCK_ITEM_NOT_FOUND");
  return item(row);
}
export async function stockDetail(ownerUid: string, itemId: string) {
  const product = await stockItem(ownerUid, itemId);
  const rows = await getD1().prepare(`SELECT id,action,quantity_milli,change_milli,on_hand_milli,note,work_order_id,created_at
    FROM trade_stock_movements WHERE item_id=? AND firebase_uid=? ORDER BY created_at DESC,rowid DESC LIMIT 50`).bind(itemId, ownerUid).all<Row>();
  const history: StockHistoryEntry[] = rows.results.map((row) => ({ id: String(row.id), action: String(row.action), quantityMilli: Number(row.quantity_milli),
    changeMilli: Number(row.change_milli), onHandMilli: Number(row.on_hand_milli), note: String(row.note), workOrderId: String(row.work_order_id), createdAt: String(row.created_at) }));
  return { item: product, history };
}

export async function requireOwnedStockJob(ownerUid: string, workOrderId: string) {
  const row = await getD1().prepare(`SELECT w.id,w.stage FROM trade_work_orders w
    JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
    WHERE w.id=? AND w.firebase_uid=? AND w.partner_type='installer' AND w.record_status='active' AND d.customer_source='trade_owned'`)
    .bind(workOrderId, ownerUid).first<Row>();
  if (!row) throw new Error("JOB_NOT_FOUND");
  return row;
}

export async function jobStock(ownerUid: string, workOrderId: string): Promise<JobStockSummary> {
  const job = await requireOwnedStockJob(ownerUid, workOrderId);
  const rows = await getD1().prepare(`SELECT r.id requirement_id,r.description,r.quantity_milli,r.status,r.source_id,
    COALESCE(a.quantity_milli,0) used_milli,COALESCE(v.quantity_milli,0) allocated_milli,${ITEM_PROJECTION}
    FROM trade_crm_job_plan_requirements r
    JOIN trade_crm_job_plans j ON j.id=r.job_plan_id AND j.firebase_uid=r.firebase_uid
    JOIN trade_price_book_items p ON p.id=r.source_id AND p.firebase_uid=r.firebase_uid AND p.item_type IN ('material','equipment')
    LEFT JOIN trade_stock_items s ON s.item_id=p.id AND s.firebase_uid=p.firebase_uid
    LEFT JOIN trade_crm_job_actuals a ON a.job_plan_requirement_id=r.id AND a.firebase_uid=r.firebase_uid
    LEFT JOIN trade_stock_active_reservations v ON v.requirement_id=r.id AND v.firebase_uid=r.firebase_uid
    WHERE r.firebase_uid=? AND j.work_order_id=? AND r.requirement_type='material' AND r.status<>'not_needed' AND s.tracked=1
    AND j.commercial_handoff_id=(SELECT h.id FROM trade_crm_commercial_handovers h WHERE h.firebase_uid=j.firebase_uid AND h.work_order_id=j.work_order_id ORDER BY h.accepted_at DESC,h.id DESC LIMIT 1)
    ORDER BY r.position,r.id`).bind(ownerUid, workOrderId).all<Row>();
  const freeByItem = new Map<string, number>();
  const reservedDeficitByItem = new Map<string, number>();
  return { workOrderId, canManage: !["cancelled", "completed"].includes(String(job.stage)), requirements: rows.results.map((row) => {
    const product = item(row); const requiredMilli = Number(row.quantity_milli); const usedMilli = Number(row.used_milli); const reservedMilli = Number(row.allocated_milli);
    const free = freeByItem.get(product.itemId) ?? Math.max(0, product.availableMilli);
    const reservedDeficit = reservedDeficitByItem.get(product.itemId) ?? Math.max(0, -product.availableMilli);
    const outstanding = row.status === "completed" || ["cancelled", "completed"].includes(String(job.stage)) ? 0 : Math.max(0, requiredMilli - usedMilli);
    const remaining = Math.max(0, outstanding - reservedMilli);
    const allocatedShortage = Math.min(outstanding, reservedMilli, reservedDeficit);
    const shortageMilli = Math.max(0, remaining - free) + allocatedShortage;
    freeByItem.set(product.itemId, Math.max(0, free - remaining));
    reservedDeficitByItem.set(product.itemId, reservedDeficit - allocatedShortage);
    return { requirementId: String(row.requirement_id), itemId: product.itemId, description: String(row.description), unitLabel: product.unitLabel,
      requiredMilli, usedMilli, remainingMilli: outstanding, reservedMilli, availableMilli: product.availableMilli, shortageMilli, revision: product.revision, tracked: product.tracked };
  }) };
}

export async function mutateStock(ownerUid: string, actorUid: string, raw: unknown) {
  const input: StockMutation = normaliseStockMutation(raw); const db = getD1();
  await ensureTradeStockSchemaGuards(db);
  const product = await stockItem(ownerUid, input.itemId); const payloadJson = JSON.stringify(input);
  const previous = await db.prepare("SELECT payload_json FROM trade_stock_operations WHERE firebase_uid=? AND operation_id=?").bind(ownerUid, input.operationId).first<Row>();
  if (previous) {
    if (previous.payload_json !== payloadJson) throw new Error("STOCK_OPERATION_REUSED");
    return input;
  }
  const jobAction = input.action === "reserve" || input.action === "release";
  if (jobAction) {
    await requireOwnedStockJob(ownerUid, input.workOrderId!);
    const requirement = await db.prepare(`SELECT r.id FROM trade_crm_job_plan_requirements r JOIN trade_crm_job_plans p ON p.id=r.job_plan_id AND p.firebase_uid=r.firebase_uid
      WHERE r.id=? AND r.firebase_uid=? AND r.source_id=? AND p.work_order_id=?`).bind(input.requirementId!, ownerUid, input.itemId, input.workOrderId!).first<Row>();
    if (!requirement) throw new Error("STOCK_REQUIREMENT_UNAVAILABLE");
  }
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  // This unique execution ID gates every write. A replay reads its original operation without applying it again.
  const gate = "EXISTS(SELECT 1 FROM trade_stock_operations WHERE id=?)";
  const statements = [db.prepare(`INSERT INTO trade_stock_operations(id,firebase_uid,operation_id,item_id,action,payload_json,expected_revision,actor_uid,created_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(firebase_uid,operation_id) DO NOTHING`).bind(id, ownerUid, input.operationId, input.itemId, input.action, payloadJson, input.expectedRevision, actorUid, now)];
  const quantity = input.quantityMilli ?? 0;
  if (input.action === "enable") {
    statements.push(db.prepare(`INSERT INTO trade_stock_items(item_id,firebase_uid,tracked,on_hand_milli,low_stock_milli,revision,updated_at)
      SELECT ?,?,1,?,?,1,? WHERE ${gate}
      ON CONFLICT(item_id) DO UPDATE SET tracked=1,on_hand_milli=excluded.on_hand_milli,low_stock_milli=excluded.low_stock_milli,revision=trade_stock_items.revision+1,updated_at=excluded.updated_at`)
      .bind(input.itemId, ownerUid, quantity, input.lowStockMilli!, now, id));
  } else {
    if (input.action === "disable") {
      statements.push(db.prepare(`DELETE FROM trade_stock_reservations WHERE item_id=? AND firebase_uid=? AND ${gate}`).bind(input.itemId, ownerUid, id));
      statements.push(db.prepare(`DELETE FROM trade_stock_actual_issues WHERE item_id=? AND firebase_uid=? AND ${gate}`).bind(input.itemId, ownerUid, id));
    }
    if (jobAction) {
      statements.push(db.prepare(`DELETE FROM trade_stock_reservations WHERE requirement_id=? AND item_id=? AND firebase_uid=? AND ${gate}`).bind(input.requirementId!, input.itemId, ownerUid, id));
      if (input.action === "reserve" && quantity > 0) statements.push(db.prepare(`INSERT INTO trade_stock_reservations(requirement_id,item_id,firebase_uid,work_order_id,quantity_milli,updated_at)
        SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(input.requirementId!, input.itemId, ownerUid, input.workOrderId!, quantity, now, id));
    }
    const change = input.action === "receive" ? "on_hand_milli=on_hand_milli+?," : input.action === "count" ? "on_hand_milli=?," : input.action === "configure" ? "low_stock_milli=?," : input.action === "disable" ? "tracked=0," : "";
    const bindings = input.action === "configure" ? [input.lowStockMilli!] : ["receive", "count"].includes(input.action) ? [quantity] : [];
    statements.push(db.prepare(`UPDATE trade_stock_items SET ${change} revision=revision+1,updated_at=? WHERE item_id=? AND firebase_uid=? AND ${gate}`)
      .bind(...bindings, now, input.itemId, ownerUid, id));
  }
  const delta = input.action === "receive" ? quantity : ["enable", "count"].includes(input.action) ? quantity - product.onHandMilli : 0;
  statements.push(db.prepare(`INSERT INTO trade_stock_movements(id,item_id,firebase_uid,action,quantity_milli,change_milli,on_hand_milli,work_order_id,requirement_id,note,actor_uid,created_at)
    SELECT ?,item_id,firebase_uid,?,?,?,on_hand_milli,?,?,?,?,? FROM trade_stock_items WHERE item_id=? AND firebase_uid=? AND ${gate}`)
    .bind(id, input.action, quantity, delta, input.workOrderId || "", input.requirementId || "", input.note || "", actorUid, now, input.itemId, ownerUid, id));
  await db.batch(statements);
  const saved = await db.prepare("SELECT payload_json FROM trade_stock_operations WHERE firebase_uid=? AND operation_id=?").bind(ownerUid, input.operationId).first<Row>();
  if (saved?.payload_json !== payloadJson) throw new Error("STOCK_OPERATION_REUSED");
  return input;
}
