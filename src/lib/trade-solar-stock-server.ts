import { normaliseQuoteEquipment } from "./trade-quote-equipment.ts";
import { readQuoteSolarStockSnapshot, type QuoteSolarStockSnapshot } from "./trade-solar-stock.ts";

type Row = Record<string, unknown>;

/** Called at issue time, before the existing atomic issue claim is committed. */
export async function buildQuoteSolarStockSnapshot(db: D1Database, ownerUid: string, quoteVersionId: string): Promise<QuoteSolarStockSnapshot> {
  const version = await db.prepare("SELECT equipment_json FROM trade_crm_quote_versions WHERE id=? AND firebase_uid=?")
    .bind(quoteVersionId, ownerUid).first<Row>();
  if (!version) throw new Error("QUOTE_SOLAR_STOCK_SNAPSHOT_INVALID");
  const equipment = normaliseQuoteEquipment(version.equipment_json);
  const choices = equipment.choices.length ? await db.prepare("SELECT id,choice_key FROM trade_crm_quote_choices WHERE quote_version_id=? AND firebase_uid=?")
    .bind(quoteVersionId, ownerUid).all<Row>() : { results: [] };
  const result: QuoteSolarStockSnapshot = { version: 1, components: [], warnings: [] };
  const groups = [{ choiceId: "", items: equipment.common }, ...equipment.choices.map((group) => {
    const choice = choices.results.find((row) => row.choice_key === group.choiceKey);
    if (!choice) throw new Error("QUOTE_SOLAR_STOCK_SNAPSHOT_INVALID");
    return { choiceId: String(choice.id), items: group.items };
  })];
  const productIds = [...new Set(groups.flatMap((group) => group.items.flatMap((item) => item.priceBookItemId ? [item.priceBookItemId] : [])))];
  const products: Row[] = [];
  // Keep each D1 query within its parameter limit for quotes with many optional models.
  for (let offset = 0; offset < productIds.length; offset += 80) {
    const ids = productIds.slice(offset, offset + 80);
    const rows = await db.prepare(`SELECT p.id,p.name,p.item_type,p.unit_label,p.record_status,p.supplier_cost_cents_ex_gst,
      COALESCE(s.tracked,0) tracked FROM trade_price_book_items p LEFT JOIN trade_stock_items s ON s.item_id=p.id AND s.firebase_uid=p.firebase_uid
      WHERE p.firebase_uid=? AND p.id IN (${ids.map(() => "?").join(",")})`).bind(ownerUid, ...ids).all<Row>();
    products.push(...rows.results);
  }
  for (const group of groups) {
    for (const item of group.items) {
      if (!item.priceBookItemId) {
        result.warnings.push({ name: item.name, choiceId: group.choiceId, reason: "unlinked" });
        continue;
      }
      const product = products.find((row) => row.id === item.priceBookItemId);
      if (!product || product.record_status !== "active" || !["material", "equipment"].includes(String(product.item_type)) || product.unit_label !== "each") {
        throw new Error("QUOTE_SOLAR_STOCK_ITEM_UNAVAILABLE");
      }
      result.components.push({ priceBookItemId: item.priceBookItemId, choiceId: group.choiceId, name: item.name,
        quantityMilli: item.quantity * 1000, unitCostCents: Number(product.supplier_cost_cents_ex_gst) });
      if (!product.tracked) result.warnings.push({ name: item.name, choiceId: group.choiceId, reason: "tracking_off" });
    }
  }
  return readQuoteSolarStockSnapshot(result);
}
