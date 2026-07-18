import { getD1 } from "../../db";

type Row = Record<string, unknown>;

export type QuoteExecutionPacketSnapshot = {
  packetId: string; packetRevision: number; name: string; suggestedCrewSize: number;
  expectedDurationMinutes: number; requiredCapabilities: string[]; taskTitles: string[];
  forms: Array<{ templateKey: string; templateVersion: number }>;
};

function stringList(value: unknown) {
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []; }
  catch { return []; }
}

export async function buildQuoteExecutionSnapshot(ownerUid: string, quoteVersionId: string) {
  const db = getD1();
  const lines = await db.prepare(`SELECT q.job_packet_id, q.job_packet_revision, q.quantity_milli,
      i.expected_duration_minutes, i.required_skill
    FROM trade_crm_quote_items q LEFT JOIN trade_price_book_items i
      ON i.id = q.price_book_item_id AND i.firebase_uid = q.firebase_uid
    WHERE q.firebase_uid = ? AND q.quote_version_id = ? AND q.job_packet_id != ''`)
    .bind(ownerUid, quoteVersionId).all<Row>();
  const packetIds = [...new Set(lines.results.map((line) => String(line.job_packet_id)).filter(Boolean))];
  const packets: QuoteExecutionPacketSnapshot[] = [];
  for (const packetId of packetIds) {
    const packet = await db.prepare(`SELECT p.id, p.name, p.revision, p.suggested_crew_size, t.task_titles
      FROM trade_job_packets p LEFT JOIN trade_crm_job_templates t
        ON t.id = p.job_template_id AND t.firebase_uid = p.firebase_uid
      WHERE p.id = ? AND p.firebase_uid = ?`).bind(packetId, ownerUid).first<Row>();
    if (!packet) throw new Error("JOB_PACKET_UNAVAILABLE");
    const packetLines = lines.results.filter((line) => String(line.job_packet_id) === packetId);
    const quotedRevision = Number(packetLines[0]?.job_packet_revision || 0);
    if (!quotedRevision || quotedRevision !== Number(packet.revision)) throw new Error("JOB_PACKET_UNAVAILABLE");
    const forms = await db.prepare(`SELECT template_key, template_version FROM trade_job_packet_forms
      WHERE packet_id = ? AND firebase_uid = ? ORDER BY position`).bind(packetId, ownerUid).all<Row>();
    const requiredCapabilities = [...new Set(packetLines.map((line) => String(line.required_skill || "").trim()).filter(Boolean))].sort();
    packets.push({ packetId, packetRevision: quotedRevision, name: String(packet.name), suggestedCrewSize: Math.max(1, Number(packet.suggested_crew_size || 1)),
      expectedDurationMinutes: packetLines.reduce((sum, line) => sum + Math.round(Number(line.expected_duration_minutes || 0) * Number(line.quantity_milli || 0) / 1000), 0),
      requiredCapabilities, taskTitles: stringList(packet.task_titles), forms: forms.results.map((form) => ({ templateKey: String(form.template_key), templateVersion: Number(form.template_version) })) });
  }
  const requiredCapabilities = [...new Set(packets.flatMap((packet) => packet.requiredCapabilities))].sort();
  return { sourceKind: packets.length ? "job_packet" : "manual_quote", packets,
    expectedDurationMinutes: packets.reduce((sum, packet) => sum + packet.expectedDurationMinutes, 0),
    suggestedCrewSize: packets.reduce((maximum, packet) => Math.max(maximum, packet.suggestedCrewSize), 1), requiredCapabilities };
}
