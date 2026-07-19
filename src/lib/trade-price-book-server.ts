import { getD1 } from "../../db";
import { priceBookQuoteLineType, type PriceBookItemType } from "./trade-price-book";

type Row = Record<string, unknown>;

export type PriceBookQuoteItem = {
  id: string;
  itemCode: string;
  name: string;
  description: string;
  itemType: PriceBookItemType;
  lineType: "product" | "labour" | "adjustment";
  unitLabel: string;
  unitCostCentsExGst: number;
  sellPriceCentsExGst: number;
  taxCode: "gst" | "none";
  markupBasisPoints: number;
  marginBasisPoints: number;
};

function quoteItem(row: Row): PriceBookQuoteItem {
  const itemType = String(row.item_type) as PriceBookItemType;
  return {
    id: String(row.id),
    itemCode: String(row.item_code),
    name: String(row.name),
    description: String(row.description || ""),
    itemType,
    lineType: priceBookQuoteLineType(itemType),
    unitLabel: String(row.unit_label),
    unitCostCentsExGst: Number(row.supplier_cost_cents_ex_gst),
    sellPriceCentsExGst: Number(row.sell_price_cents_ex_gst),
    taxCode: String(row.tax_code) as "gst" | "none",
    markupBasisPoints: Number(row.markup_basis_points),
    marginBasisPoints: Number(row.margin_basis_points),
  };
}

export async function priceBookItemsForQuote(ownerUid: string) {
  const rows = await getD1().prepare(`SELECT id, item_code, name, description, item_type, unit_label, supplier_cost_cents_ex_gst,
      sell_price_cents_ex_gst, tax_code, markup_basis_points, margin_basis_points
    FROM trade_price_book_items WHERE firebase_uid = ? AND record_status = 'active'
    ORDER BY name COLLATE NOCASE, item_code LIMIT 500`).bind(ownerUid).all<Row>();
  return rows.results.map(quoteItem);
}

export async function resolvePriceBookQuoteLines(ownerUid: string, rawLines: unknown) {
  if (!Array.isArray(rawLines)) return { lines: rawLines, references: [] as (PriceBookQuoteItem | null)[] };
  const ids = [...new Set(rawLines.map((line) => line && typeof line === "object" ? String((line as Row).priceBookItemId || "") : "").filter(Boolean))];
  if (!ids.length) return { lines: rawLines, references: rawLines.map(() => null) };
  const rows = await getD1().prepare(`SELECT id, item_code, name, description, item_type, unit_label, supplier_cost_cents_ex_gst,
      sell_price_cents_ex_gst, tax_code, markup_basis_points, margin_basis_points
    FROM trade_price_book_items WHERE firebase_uid = ? AND record_status = 'active'
      AND id IN (${ids.map(() => "?").join(",")})`).bind(ownerUid, ...ids).all<Row>();
  const byId = new Map(rows.results.map((row) => [String(row.id), quoteItem(row)]));
  if (byId.size !== ids.length) throw new Error("PRICE_BOOK_ITEM_UNAVAILABLE");
  const references = rawLines.map((line) => {
    if (!line || typeof line !== "object") return null;
    const id = String((line as Row).priceBookItemId || "");
    return id ? byId.get(id) || null : null;
  });
  const lines = rawLines.map((line, index) => {
    const reference = references[index];
    if (!reference || !line || typeof line !== "object") return line;
    return {
      ...(line as Row),
      lineType: reference.lineType,
      description: reference.description || reference.name,
      unitPrice: (reference.sellPriceCentsExGst / 100).toFixed(2),
      taxCode: reference.taxCode,
    };
  });
  return { lines, references };
}
