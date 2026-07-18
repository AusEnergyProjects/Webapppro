import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { requireInstallerOperations } from "@/lib/trade-integrations-server";

export const runtime = "edge";
type Row = Record<string, unknown>;

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["PROFILE_REQUIRED", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "ACCOUNT_INACTIVE"].includes(code)) return adminJson({ ok: false, error: "Job readiness is not available to this account." }, 403);
  if (code === "JOB_NOT_FOUND") return adminJson({ ok: false, error: "Job record not found." }, 404);
  if (code === "NOT_READY") return adminJson({ ok: false, error: "Clear the remaining readiness items first." }, 409);
  return adminJson({ ok: false, error: "Job readiness could not be updated." }, 500);
}

async function ownedJob(uid: string, workOrderId: string) {
  const row = await getD1().prepare(`SELECT w.id, w.assignee_member_id, w.stage, d.customer_source
    FROM trade_work_orders w JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    WHERE w.id = ? AND w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'`)
    .bind(workOrderId, uid).first<Row>();
  if (!row || row.customer_source !== "trade_owned") throw new Error("JOB_NOT_FOUND");
  return row;
}

async function payload(uid: string, workOrderId: string) {
  const db = getD1(); const job = await ownedJob(uid, workOrderId);
  const handoff = await db.prepare(`SELECT * FROM trade_crm_commercial_handovers WHERE firebase_uid = ? AND work_order_id = ? ORDER BY accepted_at DESC LIMIT 1`).bind(uid, workOrderId).first<Row>();
  if (!handoff) return { handoff: false, plan: null, phases: [], requirements: [], readiness: null };
  const plan = await db.prepare(`SELECT * FROM trade_crm_job_plans WHERE firebase_uid = ? AND commercial_handoff_id = ?`).bind(uid, handoff.id).first<Row>();
  if (!plan) return { handoff: true, plan: null, phases: [], requirements: [], readiness: null };
  const [phases, requirements, member, deposit] = await Promise.all([
    db.prepare(`SELECT * FROM trade_crm_job_plan_phases WHERE firebase_uid = ? AND job_plan_id = ? ORDER BY position`).bind(uid, plan.id).all<Row>(),
    db.prepare(`SELECT * FROM trade_crm_job_plan_requirements WHERE firebase_uid = ? AND job_plan_id = ? ORDER BY position`).bind(uid, plan.id).all<Row>(),
    job.assignee_member_id ? db.prepare(`SELECT status, display_name FROM trade_team_members WHERE id = ? AND owner_uid = ?`).bind(job.assignee_member_id, uid).first<Row>() : Promise.resolve(null),
    db.prepare(`SELECT status FROM trade_crm_payment_links WHERE firebase_uid = ? AND commercial_handoff_id = ? AND status = 'paid' LIMIT 1`).bind(uid, handoff.id).first<Row>(),
  ]);
  const materials = requirements.results.filter((row) => row.requirement_type === "material");
  const checks = {
    scope: phases.results.length > 0 && requirements.results.length > 0,
    forms: requirements.results.filter((row) => row.requirement_type === "form").every((row) => row.status !== "required"),
    people: Boolean(member && member.status === "active"),
    materials: materials.every((row) => row.status !== "required"),
    deposit: plan.deposit_requirement !== "required" || Boolean(deposit),
  };
  return {
    handoff: true,
    plan: { id: plan.id, status: plan.status, sourceKind: plan.source_kind, commercialReference: plan.commercial_reference,
      acceptedTotalCents: Number(plan.accepted_total_cents), budgetCostCents: Number(plan.budget_cost_cents), budgetMarginCents: Number(plan.budget_margin_cents),
      expectedDurationMinutes: Number(plan.expected_duration_minutes), suggestedCrewSize: Number(plan.suggested_crew_size), depositRequirement: plan.deposit_requirement },
    phases: phases.results.map((row) => ({ id: row.id, title: row.title, customerDescription: row.customer_description, expectedDurationMinutes: Number(row.expected_duration_minutes) })),
    requirements: requirements.results.map((row) => ({ id: row.id, phaseId: row.job_plan_phase_id, type: row.requirement_type, description: row.description, status: row.status, totalCostCents: Number(row.total_cost_cents) })),
    readiness: { ...checks, ready: Object.values(checks).every(Boolean), assignedTo: member?.display_name || "" },
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try { const identity = await requireInstallerOperations(request); const workOrderId = cleanAdminText(new URL(request.url).searchParams.get("workOrderId"), 180); return adminJson({ ok: true, ...(await payload(identity.uid, workOrderId)) }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request); const body = await request.json() as Row;
    const workOrderId = cleanAdminText(body.workOrderId, 180); const action = cleanAdminText(body.action, 30); await ownedJob(identity.uid, workOrderId);
    const db = getD1(); const now = new Date().toISOString();
    if (action === "prepare") {
      const handoff = await db.prepare(`SELECT * FROM trade_crm_commercial_handovers WHERE firebase_uid = ? AND work_order_id = ? ORDER BY accepted_at DESC LIMIT 1`).bind(identity.uid, workOrderId).first<Row>();
      if (!handoff) return adminJson({ ok: false, error: "Accept a quote before preparing the job." }, 409);
      const existing = await db.prepare(`SELECT id FROM trade_crm_job_plans WHERE firebase_uid = ? AND commercial_handoff_id = ?`).bind(identity.uid, handoff.id).first<Row>();
      if (!existing) {
        const acceptance = await db.prepare(`SELECT selected_choice_ids_json FROM trade_crm_quote_acceptances WHERE id = ? AND firebase_uid = ?`).bind(handoff.acceptance_id, identity.uid).first<Row>();
        let choices: string[] = []; try { const value = JSON.parse(String(acceptance?.selected_choice_ids_json || "[]")); if (Array.isArray(value)) choices = value.map(String); } catch { choices = []; }
        const items = await db.prepare(`SELECT * FROM trade_crm_quote_items WHERE quote_version_id = ? AND firebase_uid = ? ORDER BY position`).bind(handoff.quote_version_id, identity.uid).all<Row>();
        const selected = items.results.filter((item) => !item.quote_choice_id || choices.includes(String(item.quote_choice_id)));
        const grouped = new Map<string, Row[]>(); selected.forEach((item) => { const key = String(item.section_heading || "Included work"); grouped.set(key, [...(grouped.get(key) || []), item]); });
        const planId = crypto.randomUUID(); const sourceKind = selected.some((item) => item.job_packet_id) ? "job_packet" : "manual_quote";
        const budgetCost = selected.reduce((total, item) => total + Math.round(Number(item.unit_cost_cents_ex_gst || 0) * Number(item.quantity_milli || 1000) / 1000), 0);
        const statements = [db.prepare(`INSERT INTO trade_crm_job_plans (id, commercial_handoff_id, quote_version_id, work_order_id, firebase_uid, commercial_reference, source_kind, status, accepted_subtotal_cents, accepted_tax_cents, accepted_total_cents, budget_cost_cents, budget_margin_cents, expected_duration_minutes, suggested_crew_size, deposit_requirement, ready_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'planning', ?, ?, ?, ?, ?, 0, 1, 'optional', '', ?, ?)`)
          .bind(planId, handoff.id, handoff.quote_version_id, workOrderId, identity.uid, handoff.commercial_reference, sourceKind, handoff.subtotal_cents, handoff.tax_cents, handoff.total_cents, budgetCost, Number(handoff.subtotal_cents) - budgetCost, now, now)];
        let position = 0; [...grouped.entries()].forEach(([title, lines], phaseIndex) => { const phaseId = crypto.randomUUID(); statements.push(db.prepare(`INSERT INTO trade_crm_job_plan_phases (id, job_plan_id, firebase_uid, position, title, customer_description, source_packet_id, source_packet_revision, expected_duration_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
          .bind(phaseId, planId, identity.uid, phaseIndex, title, `${lines.length} accepted scope item${lines.length === 1 ? "" : "s"}`, String(lines.find((line) => line.job_packet_id)?.job_packet_id || ""), Number(lines.find((line) => line.job_packet_revision)?.job_packet_revision || 0), now));
          lines.forEach((line) => { const type = line.price_book_item_type === "product" ? "material" : line.price_book_item_type === "form" ? "form" : "task"; const cost = Math.round(Number(line.unit_cost_cents_ex_gst || 0) * Number(line.quantity_milli || 1000) / 1000); statements.push(db.prepare(`INSERT INTO trade_crm_job_plan_requirements (id, job_plan_id, job_plan_phase_id, firebase_uid, position, requirement_type, source_id, description, quantity_milli, unit_cost_cents, total_cost_cents, expected_duration_minutes, required_capability, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?)`)
            .bind(crypto.randomUUID(), planId, phaseId, identity.uid, position++, type, String(line.price_book_item_id || line.id), String(line.description), Number(line.quantity_milli), Number(line.unit_cost_cents_ex_gst || 0), cost, type === "material" || type === "form" ? "required" : "confirmed", now)); }); });
        statements.push(db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at) VALUES (?, ?, ?, 'job_plan_prepared', ?, ?)`).bind(crypto.randomUUID(), workOrderId, identity.uid, `Accepted scope ${String(handoff.commercial_reference)} prepared as a ready-to-run job plan.`, now));
        await db.batch(statements);
      }
    } else if (action === "requirement") {
      const requirementId = cleanAdminText(body.requirementId, 180); const status = ["required", "confirmed", "not_needed"].includes(String(body.status)) ? String(body.status) : "required";
      await db.prepare(`UPDATE trade_crm_job_plan_requirements SET status = ? WHERE id = ? AND firebase_uid = ? AND job_plan_id IN (SELECT id FROM trade_crm_job_plans WHERE work_order_id = ? AND firebase_uid = ?)`).bind(status, requirementId, identity.uid, workOrderId, identity.uid).run();
    } else if (action === "deposit") {
      const requirement = ["optional", "required", "waived"].includes(String(body.requirement)) ? String(body.requirement) : "optional";
      await db.prepare(`UPDATE trade_crm_job_plans SET deposit_requirement = ?, updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?`).bind(requirement, now, workOrderId, identity.uid).run();
    } else if (action === "ready") {
      const current = await payload(identity.uid, workOrderId); if (!current.readiness?.ready) throw new Error("NOT_READY");
      await db.batch([db.prepare(`UPDATE trade_crm_job_plans SET status = 'ready', ready_at = ?, updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?`).bind(now, now, workOrderId, identity.uid), db.prepare(`UPDATE trade_work_orders SET stage = 'ready', updated_at = ? WHERE id = ? AND firebase_uid = ?`).bind(now, workOrderId, identity.uid), db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at) VALUES (?, ?, ?, 'job_ready', 'Job is ready to schedule and dispatch.', ?)`).bind(crypto.randomUUID(), workOrderId, identity.uid, now)]);
    } else return adminJson({ ok: false, error: "Unknown job readiness action." }, 400);
    return adminJson({ ok: true, ...(await payload(identity.uid, workOrderId)) });
  } catch (error) { return errorResponse(error); }
}
