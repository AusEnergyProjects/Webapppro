import { parseReceiptConfirmation, type ReceiptConfirmation } from "./trade-stock-receipts.ts";

type Database = Pick<D1Database, "prepare" | "batch">;
/** All receipt lines and the receipt audit commit together; retries cannot receive the same PDF twice. */
export async function confirmStockReceipt(db: Database, ownerUid: string, actorUid: string, raw: unknown) {
  const input: ReceiptConfirmation = parseReceiptConfirmation(raw), payload = JSON.stringify(input);
  const receipt = await db.prepare("SELECT status,confirmation_json FROM trade_stock_receipts WHERE id=? AND firebase_uid=?").bind(input.receiptId, ownerUid).first<{ status: string; confirmation_json: string }>();
  if (!receipt) throw new Error("RECEIPT_NOT_FOUND");
  if (receipt.status === "received") {
    if (JSON.stringify(parseReceiptConfirmation({ ...JSON.parse(receipt.confirmation_json), confirmReceived: true })) !== payload) throw new Error("RECEIPT_ALREADY_RECEIVED");
    return { received: true };
  }
  const now = new Date().toISOString(), confirmationId = crypto.randomUUID();
  const itemDetails = [];
  for (const line of input.lines) {
    const product = await db.prepare("SELECT name,unit_label FROM trade_price_book_items WHERE id=? AND firebase_uid=? AND record_status='active' AND item_type IN ('material','equipment')").bind(line.itemId, ownerUid).first<{ name: string; unit_label: string }>();
    if (!product) throw new Error("RECEIPT_PRODUCT_UNAVAILABLE");
    itemDetails.push({ itemId: line.itemId, name: product.name, unit: product.unit_label });
  }
  const gate = "EXISTS(SELECT 1 FROM trade_stock_receipts WHERE id=? AND firebase_uid=? AND confirmation_id=?)";
  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE trade_stock_receipts SET status='received',confirmation_json=?,confirmation_id=?,supplier=?,reference=?,received_at=?,received_by_uid=? WHERE id=? AND firebase_uid=? AND status='review'`)
      .bind(JSON.stringify({ ...input, itemDetails }), confirmationId, input.supplier, input.reference, now, actorUid, input.receiptId, ownerUid),
    db.prepare(`SELECT CASE WHEN NOT ${gate} OR EXISTS(SELECT 1 FROM trade_stock_locations WHERE id=? AND firebase_uid=?) THEN 1 ELSE json('RECEIPT_LOCATION_UNAVAILABLE') END`)
      .bind(input.receiptId, ownerUid, confirmationId, input.locationId, ownerUid),
  ];
  for (const line of input.lines) {
    const operationId = `receipt:${input.receiptId}:${line.itemId}`, movementId = crypto.randomUUID();
    const operation = { action: "receive", itemId: line.itemId, operationId, expectedRevision: line.expectedRevision, quantityMilli: line.quantityMilli, locationId: input.locationId, note: ["Supplier receipt", input.supplier, input.reference].filter(Boolean).join(" | ").slice(0, 300) };
    statements.push(
      db.prepare(`SELECT CASE WHEN NOT ${gate} OR EXISTS(SELECT 1 FROM trade_price_book_items WHERE id=? AND firebase_uid=? AND record_status='active' AND item_type IN ('material','equipment')) THEN 1 ELSE json('RECEIPT_PRODUCT_UNAVAILABLE') END`).bind(input.receiptId, ownerUid, confirmationId, line.itemId, ownerUid),
      db.prepare(`INSERT INTO trade_stock_operations(id,firebase_uid,operation_id,item_id,action,payload_json,expected_revision,actor_uid,created_at) SELECT ?,?,?,?,'receive',?,?,?,? WHERE ${gate}`)
        .bind(movementId, ownerUid, operationId, line.itemId, JSON.stringify(operation), line.expectedRevision, actorUid, now, input.receiptId, ownerUid, confirmationId),
      db.prepare(`INSERT INTO trade_stock_location_balances(item_id,location_id,firebase_uid,on_hand_milli,updated_at) SELECT ?,?,?,0,? WHERE ${gate} ON CONFLICT(item_id,location_id) DO NOTHING`)
        .bind(line.itemId, input.locationId, ownerUid, now, input.receiptId, ownerUid, confirmationId),
      db.prepare(`UPDATE trade_stock_location_balances SET on_hand_milli=on_hand_milli+?,updated_at=? WHERE item_id=? AND location_id=? AND firebase_uid=? AND ${gate}`)
        .bind(line.quantityMilli, now, line.itemId, input.locationId, ownerUid, input.receiptId, ownerUid, confirmationId),
      db.prepare(`UPDATE trade_stock_items SET on_hand_milli=(SELECT SUM(on_hand_milli) FROM trade_stock_location_balances WHERE item_id=trade_stock_items.item_id AND firebase_uid=trade_stock_items.firebase_uid),revision=revision+1,updated_at=? WHERE item_id=? AND firebase_uid=? AND ${gate}`)
        .bind(now, line.itemId, ownerUid, input.receiptId, ownerUid, confirmationId),
      db.prepare(`INSERT INTO trade_stock_movements(id,item_id,firebase_uid,action,quantity_milli,change_milli,on_hand_milli,work_order_id,requirement_id,note,actor_uid,created_at) SELECT ?,item_id,firebase_uid,'receive',?,?,on_hand_milli,'','',?,?,? FROM trade_stock_items WHERE item_id=? AND firebase_uid=? AND ${gate}`)
        .bind(movementId, line.quantityMilli, line.quantityMilli, operation.note, actorUid, now, line.itemId, ownerUid, input.receiptId, ownerUid, confirmationId),
    );
  }
  await db.batch(statements);
  const saved = await db.prepare("SELECT confirmation_json FROM trade_stock_receipts WHERE id=? AND firebase_uid=? AND status='received'").bind(input.receiptId, ownerUid).first<{ confirmation_json: string }>();
  if (!saved || JSON.stringify(parseReceiptConfirmation({ ...JSON.parse(saved.confirmation_json), confirmReceived: true })) !== payload) throw new Error("RECEIPT_ALREADY_RECEIVED");
  return { received: true };
}
