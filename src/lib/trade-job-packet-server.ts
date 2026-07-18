import { getD1 } from "../../db";
import { calculateJobPacketSummary, type PacketPriceItem } from "./trade-job-packet";
import { priceBookQuoteLineType } from "./trade-price-book";

type Row = Record<string, unknown>;

function list(value: unknown) {
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
}

function packetPriceItem(row: Row): PacketPriceItem {
  return { id: String(row.price_book_item_id), itemCode: String(row.item_code), name: String(row.item_name),
    itemType: String(row.item_type), unitLabel: String(row.unit_label), supplierCostCentsExGst: Number(row.supplier_cost_cents_ex_gst),
    sellPriceCentsExGst: Number(row.sell_price_cents_ex_gst), taxCode: String(row.tax_code) as "gst" | "none",
    expectedDurationMinutes: Number(row.expected_duration_minutes), requiredSkill: String(row.required_skill) };
}

export async function jobPacketLibrary(ownerUid: string) {
  const db = getD1();
  const [packets, items, forms, members] = await Promise.all([
    db.prepare(`SELECT p.*, t.name job_template_name, t.task_titles
      FROM trade_job_packets p LEFT JOIN trade_crm_job_templates t ON t.id = p.job_template_id
        AND t.firebase_uid = p.firebase_uid AND t.record_status = 'active'
      WHERE p.firebase_uid = ? ORDER BY p.record_status = 'archived', p.name COLLATE NOCASE LIMIT 200`).bind(ownerUid).all<Row>(),
    db.prepare(`SELECT l.*, i.item_code, i.name item_name, i.item_type, i.unit_label, i.supplier_cost_cents_ex_gst,
        i.sell_price_cents_ex_gst, i.tax_code, i.expected_duration_minutes, i.required_skill, i.record_status item_status
      FROM trade_job_packet_items l LEFT JOIN trade_price_book_items i ON i.id = l.price_book_item_id AND i.firebase_uid = l.firebase_uid
      WHERE l.firebase_uid = ? ORDER BY l.packet_id, l.position`).bind(ownerUid).all<Row>(),
    db.prepare(`SELECT packet_id, template_key, template_version FROM trade_job_packet_forms
      WHERE firebase_uid = ? ORDER BY packet_id, position`).bind(ownerUid).all<Row>(),
    db.prepare(`SELECT COUNT(*) active_count FROM trade_team_members WHERE owner_uid = ? AND status = 'active'`).bind(ownerUid).first<Row>(),
  ]);
  const activeCrewCount = 1 + Number(members?.active_count || 0);
  return packets.results.map((packet) => {
    const packetItems = items.results.filter((item) => item.packet_id === packet.id);
    const available = new Map<string, PacketPriceItem>();
    for (const row of packetItems) if (row.item_status === "active") { const item = packetPriceItem(row); available.set(item.id, item); }
    const unavailableItemCount = packetItems.length - available.size;
    const lines = packetItems.filter((row) => row.item_status === "active").map((row) => {
      const item = available.get(String(row.price_book_item_id))!;
      return { id: String(row.id), priceBookItemId: item.id, name: item.name, itemCode: item.itemCode,
        itemType: item.itemType, lineType: priceBookQuoteLineType(item.itemType as Parameters<typeof priceBookQuoteLineType>[0]),
        unitLabel: item.unitLabel, quantityMilli: Number(row.quantity_milli), sellPriceCentsExGst: item.sellPriceCentsExGst,
        taxCode: item.taxCode };
    });
    const summary = calculateJobPacketSummary(lines, available); const suggestedCrewSize = Number(packet.suggested_crew_size);
    const recordStatus = String(packet.record_status);
    return { id: String(packet.id), packetCode: String(packet.packet_code), name: String(packet.name), recordStatus,
      serviceCategory: String(packet.service_category), revision: Number(packet.revision), suggestedCrewSize,
      jobTemplateId: String(packet.job_template_id), jobTemplateName: String(packet.job_template_name || ""),
      taskCount: list(packet.task_titles).length, formCount: forms.results.filter((form) => form.packet_id === packet.id).length,
      activeCrewCount, crewReady: activeCrewCount >= suggestedCrewSize, unavailableItemCount,
      canApply: recordStatus === "active" && lines.length > 0 && unavailableItemCount === 0, lines,
      forms: forms.results.filter((form) => form.packet_id === packet.id).map((form) => ({ templateKey: String(form.template_key), templateVersion: Number(form.template_version) })), summary };
  });
}

export async function jobPacketsForQuote(ownerUid: string) {
  return (await jobPacketLibrary(ownerUid)).filter((packet) => packet.recordStatus === "active");
}

export async function resolveJobPacketQuoteLines(ownerUid: string, rawLines: unknown) {
  if (!Array.isArray(rawLines)) return { lines: rawLines, references: [] as (null | { packetId: string; packetRevision: number; packetLineId: string })[] };
  const lineIds = rawLines.map((line) => line && typeof line === "object" ? String((line as Row).jobPacketLineId || "") : "").filter(Boolean);
  if (!lineIds.length) return { lines: rawLines, references: rawLines.map(() => null) };
  if (new Set(lineIds).size !== lineIds.length) throw new Error("JOB_PACKET_DUPLICATE_LINE");
  const rows = await getD1().prepare(`SELECT l.id, l.price_book_item_id, p.id packet_id, p.revision
    FROM trade_job_packet_items l JOIN trade_job_packets p ON p.id = l.packet_id AND p.firebase_uid = l.firebase_uid
    JOIN trade_price_book_items i ON i.id = l.price_book_item_id AND i.firebase_uid = l.firebase_uid
    WHERE l.firebase_uid = ? AND p.record_status = 'active' AND i.record_status = 'active'
      AND l.id IN (${lineIds.map(() => "?").join(",")})`).bind(ownerUid, ...lineIds).all<Row>();
  const byId = new Map(rows.results.map((row) => [String(row.id), row]));
  if (byId.size !== lineIds.length) throw new Error("JOB_PACKET_UNAVAILABLE");
  const references = rawLines.map((line) => {
    if (!line || typeof line !== "object") return null; const record = line as Row;
    const lineId = String(record.jobPacketLineId || ""); if (!lineId) return null; const row = byId.get(lineId);
    if (!row || String(record.priceBookItemId || "") !== String(row.price_book_item_id)
      || String(record.jobPacketId || "") !== String(row.packet_id)) throw new Error("JOB_PACKET_UNAVAILABLE");
    return { packetId: String(row.packet_id), packetRevision: Number(row.revision), packetLineId: lineId };
  });
  return { lines: rawLines, references };
}
