import type { QuoteExecutionPacketSnapshot } from "./trade-quote-execution-server";
import { ensureTradeStockSchemaGuards } from "./trade-stock-schema-guards.ts";

type Row = Record<string, unknown>;
type JobPlanInput = {
  ownerUid: string; workOrderId: string; handoffId: string; quoteVersionId: string; now: string;
  selectedChoiceIds?: string[]; onlyIfTracked?: boolean;
};

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value || "")) as T; } catch { return fallback; }
}
function lineRequirementType(line: Row) {
  const type = String(line.price_book_item_type || "");
  if (["product", "material", "stock", "equipment"].includes(type)) return "material";
  if (type === "form") return "form";
  if (type === "labour") return "labour";
  return "task";
}

// Both acceptance and manual preparation use the issued execution snapshot. Every write
// is gated by the new plan, so a rejected/replayed acceptance cannot leave orphan scope.
export async function buildJobPlanStatements(db: D1Database, input: JobPlanInput): Promise<D1PreparedStatement[]> {
  const { ownerUid, workOrderId, handoffId, quoteVersionId, now } = input;
  if (input.onlyIfTracked) {
    const owned = await db.prepare(`SELECT w.id FROM trade_work_orders w JOIN trade_crm_job_details d
      ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
      WHERE w.id=? AND w.firebase_uid=? AND w.partner_type='installer' AND w.record_status='active'
      AND d.customer_source='trade_owned'`).bind(workOrderId, ownerUid).first();
    if (!owned) return [];
  }
  const existing = await db.prepare("SELECT id FROM trade_crm_job_plans WHERE firebase_uid=? AND commercial_handoff_id=?").bind(ownerUid, handoffId).first();
  if (existing) return [];
  const [acceptance, snapshot, items] = await Promise.all([
    input.selectedChoiceIds ? Promise.resolve({ selected_choice_ids_json: JSON.stringify(input.selectedChoiceIds) }) :
      db.prepare(`SELECT a.selected_choice_ids_json FROM trade_crm_quote_acceptances a JOIN trade_crm_commercial_handovers h
        ON h.acceptance_id=a.id AND h.firebase_uid=a.firebase_uid WHERE h.id=? AND h.firebase_uid=?`).bind(handoffId, ownerUid).first<Row>(),
    db.prepare("SELECT * FROM trade_crm_quote_execution_snapshots WHERE quote_version_id=? AND firebase_uid=?").bind(quoteVersionId, ownerUid).first<Row>(),
    db.prepare("SELECT * FROM trade_crm_quote_items WHERE quote_version_id=? AND firebase_uid=? ORDER BY position").bind(quoteVersionId, ownerUid).all<Row>(),
  ]);
  const choices = parseJson<string[]>(acceptance?.selected_choice_ids_json, []).map(String);
  const selected = items.results.filter((item) => !item.quote_choice_id || choices.includes(String(item.quote_choice_id)));
  if (input.onlyIfTracked) {
    const stock = await db.prepare("SELECT item_id FROM trade_stock_items WHERE firebase_uid=? AND tracked=1").bind(ownerUid).all<Row>();
    const tracked = new Set(stock.results.map((item) => String(item.item_id)));
    if (!selected.some((line) => lineRequirementType(line) === "material" && tracked.has(String(line.price_book_item_id)))) return [];
  }
  await ensureTradeStockSchemaGuards(db);
  const packetSnapshots = parseJson<QuoteExecutionPacketSnapshot[]>(snapshot?.packets_json, []);
  const selectedPacketIds = new Set(selected.map((item) => String(item.job_packet_id || "")).filter(Boolean));
  const packets = packetSnapshots.filter((packet) => selectedPacketIds.has(packet.packetId));
  const planId = crypto.randomUUID(); const sourceKind = packets.length ? "job_packet" : "manual_quote";
  const planGate = "EXISTS(SELECT 1 FROM trade_crm_job_plans WHERE id=? AND firebase_uid=?)";
  const budgetCost = selected.reduce((total, item) => total + Math.round(Number(item.unit_cost_cents_ex_gst || 0) * Number(item.quantity_milli || 1000) / 1000), 0);
  const expectedDuration = packets.reduce((sum, packet) => sum + packet.expectedDurationMinutes, 0);
  const suggestedCrew = packets.reduce((maximum, packet) => Math.max(maximum, packet.suggestedCrewSize), 1);
  const statements = [db.prepare(`INSERT INTO trade_crm_job_plans
    (id,commercial_handoff_id,quote_version_id,work_order_id,firebase_uid,commercial_reference,source_kind,status,
    accepted_subtotal_cents,accepted_tax_cents,accepted_total_cents,budget_cost_cents,budget_margin_cents,
    expected_duration_minutes,suggested_crew_size,deposit_requirement,ready_at,completed_at,created_at,updated_at)
    SELECT ?,h.id,h.quote_version_id,h.work_order_id,h.firebase_uid,h.commercial_reference,?,'planning',
    h.subtotal_cents,h.tax_cents,h.total_cents,?,h.subtotal_cents-?,?,?,'optional','','',?,?
    FROM trade_crm_commercial_handovers h WHERE h.id=? AND h.firebase_uid=? AND h.work_order_id=?
    AND h.quote_version_id=? AND h.status='accepted'
    AND NOT EXISTS(SELECT 1 FROM trade_crm_job_plans WHERE commercial_handoff_id=h.id AND firebase_uid=h.firebase_uid)`)
    .bind(planId, sourceKind, budgetCost, budgetCost, expectedDuration, suggestedCrew, now, now, handoffId, ownerUid, workOrderId, quoteVersionId)];
  let position = 0; let phasePosition = 0;
  const addRequirement = (phaseId: string, type: string, sourceId: string, description: string, quantity: number, unitCost: number, duration: number, capability: string, status: string) => {
    const cost = Math.round(unitCost * quantity / 1000);
    statements.push(db.prepare(`INSERT INTO trade_crm_job_plan_requirements
      (id,job_plan_id,job_plan_phase_id,firebase_uid,position,requirement_type,source_id,description,quantity_milli,unit_cost_cents,total_cost_cents,expected_duration_minutes,required_capability,status,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${planGate}`)
      .bind(crypto.randomUUID(), planId, phaseId, ownerUid, position++, type, sourceId, description, quantity, unitCost, cost, duration, capability, status, now, planId, ownerUid));
  };
  const addPhase = (title: string, description: string, packetId = "", packetRevision = 0, duration = 0) => {
    const phaseId = crypto.randomUUID();
    statements.push(db.prepare(`INSERT INTO trade_crm_job_plan_phases
      (id,job_plan_id,firebase_uid,position,title,customer_description,source_packet_id,source_packet_revision,expected_duration_minutes,status,completed_at,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,'pending','',?,? WHERE ${planGate}`)
      .bind(phaseId, planId, ownerUid, phasePosition++, title, description, packetId, packetRevision, duration, now, now, planId, ownerUid));
    return phaseId;
  };
  for (const packet of packets) {
    const phaseId = addPhase(packet.name, `${packet.taskTitles.length} task${packet.taskTitles.length === 1 ? "" : "s"} from accepted packet revision ${packet.packetRevision}`, packet.packetId, packet.packetRevision, packet.expectedDurationMinutes);
    const capabilities = packet.requiredCapabilities.join(", ");
    packet.taskTitles.forEach((title, index) => addRequirement(phaseId, "task", `${packet.packetId}:task:${index}`, title, 1000, 0, 0, capabilities, "required"));
    packet.forms.forEach((form) => addRequirement(phaseId, "form", `${form.templateKey}:${form.templateVersion}`, `${form.templateKey.replaceAll("_", " ")} v${form.templateVersion}`, 1000, 0, 0, "", "required"));
    const packetLines = selected.filter((line) => line.job_packet_id === packet.packetId);
    packetLines.forEach((line) => addRequirement(phaseId, lineRequirementType(line), String(line.price_book_item_id || line.id), String(line.description), Number(line.quantity_milli), Number(line.unit_cost_cents_ex_gst || 0),
      lineRequirementType(line) === "labour" ? Math.round(packet.expectedDurationMinutes * Number(line.quantity_milli || 1000) / Math.max(1000, packetLines.reduce((sum, item) => sum + Number(item.quantity_milli || 0), 0))) : 0,
      capabilities, lineRequirementType(line) === "form" ? "required" : "confirmed"));
  }
  const manual = selected.filter((line) => !selectedPacketIds.has(String(line.job_packet_id || ""))); const grouped = new Map<string, Row[]>();
  manual.forEach((item) => { const key = String(item.section_heading || "Included work"); grouped.set(key, [...(grouped.get(key) || []), item]); });
  for (const [title, lines] of grouped) {
    const phaseId = addPhase(title, `${lines.length} accepted scope item${lines.length === 1 ? "" : "s"}`);
    lines.forEach((line) => { const type = lineRequirementType(line); addRequirement(phaseId, type, String(line.price_book_item_id || line.id), String(line.description), Number(line.quantity_milli), Number(line.unit_cost_cents_ex_gst || 0), 0, "", ["material", "form"].includes(type) ? "required" : "confirmed"); });
  }
  statements.push(db.prepare(`UPDATE trade_crm_job_plans SET status='completed', completed_at=COALESCE((SELECT MIN(created_at) FROM trade_work_order_events WHERE work_order_id=? AND firebase_uid=? AND event_type='job_completed'),'') WHERE id=? AND firebase_uid=? AND EXISTS(SELECT 1 FROM trade_work_orders WHERE id=? AND firebase_uid=? AND stage='completed')`).bind(workOrderId, ownerUid, planId, ownerUid, workOrderId, ownerUid));
  statements.push(db.prepare(`INSERT INTO trade_work_order_events(id,work_order_id,firebase_uid,event_type,summary,created_at)
    SELECT ?,work_order_id,firebase_uid,'job_plan_prepared','Accepted scope ' || commercial_reference || ' prepared from its immutable execution snapshot.',?
    FROM trade_crm_job_plans WHERE id=? AND firebase_uid=?`).bind(crypto.randomUUID(), now, planId, ownerUid));
  return statements;
}
