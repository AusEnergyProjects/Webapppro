import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { photoRequestProofOverview } from "@/lib/photo-request-review-server";
import type { PhotoRequirement } from "@/lib/trade-photo-requests";
import { jobStock, stockActualStatements } from "@/lib/trade-stock-server";
import { buildJobPlanStatements } from "@/lib/trade-job-plan-server";
import { requireInstallerOperations } from "@/lib/trade-integrations-server";

export const runtime = "edge";
type Row = Record<string, unknown>;
const COMPLETE = new Set(["completed", "not_needed"]);

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const stockCode = `${code} ${error instanceof Error && error.cause instanceof Error ? error.cause.message : ""}`;
  if (stockCode.includes("STOCK_SHORTAGE")) return adminJson({ ok: false, error: "There is not enough physical stock at the selected location. Choose another location or receive stock there first." }, 409);
  if (stockCode.includes("STOCK_REFRESH_REQUIRED")) return adminJson({ok:false,error:"Stock tracking was updated. Refresh this page before making another change."},409);
  if (stockCode.includes("STOCK_STALE")) return adminJson({ok:false,error:"Stock changed while this was open. Refresh the job and try again."},409);
  if (stockCode.includes("STOCK_TRACKING_PAUSED")) return adminJson({ok:false,error:"Turn stock tracking back on for this product before correcting its previous stock usage."},409);
  if (stockCode.includes("STOCK_LOCATION_REQUIRED") || stockCode.includes("STOCK_INVALID_LOCATION")) return adminJson({ok:false,error:"Choose where the stock was used from. Location quantities must add up to the recorded usage."},400);
  if (stockCode.includes("STOCK_REQUIREMENT_UNAVAILABLE")) return adminJson({ ok: false, error: "This job's materials changed or the job was cancelled. Refresh the job before recording stock usage." }, 409);
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["PROFILE_REQUIRED", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "ACCOUNT_INACTIVE"].includes(code)) return adminJson({ ok: false, error: "Job readiness is not available to this account." }, 403);
  if (code === "JOB_NOT_FOUND") return adminJson({ ok: false, error: "Job record not found." }, 404);
  if (code === "NOT_READY") return adminJson({ ok: false, error: "Clear the remaining readiness items first." }, 409);
  if (code === "NOT_READY_TO_WORK") return adminJson({ ok: false, error: "Mark the job ready before recording work." }, 409);
  if (code === "NOT_COMPLETE") return adminJson({ ok: false, error: "Complete the remaining scope, forms, materials and proof first." }, 409);
  if (code === "INVALID_ACTUAL") return adminJson({ ok: false, error: "Enter valid actual time, quantity and cost values." }, 400);
  return adminJson({ ok: false, error: "Job readiness could not be updated." }, 500);
}

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value || "")) as T; } catch { return fallback; }
}

async function ownedJob(uid: string, workOrderId: string) {
  const row = await getD1().prepare(`SELECT w.id, w.assignee_member_id, w.stage, d.customer_source
    FROM trade_work_orders w JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    WHERE w.id = ? AND w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'`)
    .bind(workOrderId, uid).first<Row>();
  if (!row || row.customer_source !== "trade_owned") throw new Error("JOB_NOT_FOUND");
  return row;
}

async function proofCheck(uid: string, workOrderId: string) {
  const request = await getD1().prepare(`SELECT id, revision, requirements, status FROM trade_crm_photo_requests
    WHERE firebase_uid = ? AND work_order_id = ? LIMIT 1`).bind(uid, workOrderId).first<Row>();
  if (!request || request.status === "revoked") return { required: false, ready: true };
  const requirements = parseJson<PhotoRequirement[]>(request.requirements, []);
  const proof = await photoRequestProofOverview({ ownerUid: uid, workOrderId, requestId: String(request.id), requestRevision: Number(request.revision), requirements });
  return { required: true, ready: proof.proofReady };
}

function requirementDone(row: Row) { return COMPLETE.has(String(row.status)); }

async function payload(uid: string, workOrderId: string) {
  const db = getD1(); const job = await ownedJob(uid, workOrderId);
  const handoff = await db.prepare(`SELECT * FROM trade_crm_commercial_handovers WHERE firebase_uid = ? AND work_order_id = ? ORDER BY accepted_at DESC LIMIT 1`).bind(uid, workOrderId).first<Row>();
  if (!handoff) return { handoff: false, plan: null, phases: [], requirements: [], readiness: null, execution: null, completion: null };
  const plan = await db.prepare(`SELECT * FROM trade_crm_job_plans WHERE firebase_uid = ? AND commercial_handoff_id = ?`).bind(uid, handoff.id).first<Row>();
  if (!plan) return { handoff: true, plan: null, phases: [], requirements: [], readiness: null, execution: null, completion: null };
  const [phases, requirements, member, proof] = await Promise.all([
    db.prepare(`SELECT * FROM trade_crm_job_plan_phases WHERE firebase_uid = ? AND job_plan_id = ? ORDER BY position`).bind(uid, plan.id).all<Row>(),
    db.prepare(`SELECT r.*, a.quantity_milli actual_quantity_milli, a.duration_minutes actual_duration_minutes,
        a.id actual_id, a.total_cost_cents actual_total_cost_cents, a.note actual_note
      FROM trade_crm_job_plan_requirements r LEFT JOIN trade_crm_job_actuals a
        ON a.job_plan_requirement_id = r.id AND a.firebase_uid = r.firebase_uid
      WHERE r.firebase_uid = ? AND r.job_plan_id = ? ORDER BY r.position`).bind(uid, plan.id).all<Row>(),
    job.assignee_member_id ? db.prepare(`SELECT status, display_name FROM trade_team_members WHERE id = ? AND owner_uid = ?`).bind(job.assignee_member_id, uid).first<Row>() : Promise.resolve(null),
    proofCheck(uid, workOrderId),
  ]);
  const byType = (type: string) => requirements.results.filter((row) => row.requirement_type === type);
  const materials = byType("material"); const forms = byType("form");
  const scope = requirements.results.filter((row) => !["form", "material"].includes(String(row.requirement_type)));
  const checks = { scope: phases.results.length > 0 && requirements.results.length > 0,
    forms: forms.every((row) => row.status !== "required"), people: Boolean(member && member.status === "active"),
    materials: materials.every((row) => row.status !== "required"), deposit: true };
  const actualCostCents = requirements.results.reduce((sum, row) => sum + Number(row.actual_total_cost_cents || 0), 0);
  const remainingBudgetCents = requirements.results.filter((row) => !requirementDone(row)).reduce((sum, row) => sum + Number(row.total_cost_cents || 0), 0);
  const forecastCostCents = actualCostCents + remainingBudgetCents; const budgetCostCents = Number(plan.budget_cost_cents);
  const varianceCents = budgetCostCents - forecastCostCents; const varianceRatio = budgetCostCents ? varianceCents / budgetCostCents : 0;
  const varianceStatus = varianceRatio < -0.15 ? "over_budget" : varianceRatio < -0.05 ? "attention" : varianceRatio > 0.05 ? "ahead" : "on_budget";
  const phasePayload = phases.results.map((phase) => { const rows = requirements.results.filter((row) => row.job_plan_phase_id === phase.id); const complete = rows.filter(requirementDone).length;
    return { id: String(phase.id), title: String(phase.title), customerDescription: String(phase.customer_description), expectedDurationMinutes: Number(phase.expected_duration_minutes),
      status: rows.length && complete === rows.length ? "completed" : complete ? "in_progress" : "pending", progressPercent: rows.length ? Math.round(complete * 100 / rows.length) : 0 };
  });
  const completionChecks = { scope: scope.every(requirementDone), forms: forms.every(requirementDone), materials: materials.every(requirementDone), proof: proof.ready };
  const completed = plan.status === "completed";
  return {
    handoff: true, stock: await jobStock(uid,workOrderId),
    plan: { id: plan.id, status: plan.status, sourceKind: plan.source_kind, commercialReference: plan.commercial_reference,
      acceptedTotalCents: Number(plan.accepted_total_cents), acceptedSubtotalCents: Number(plan.accepted_subtotal_cents), budgetCostCents,
      budgetMarginCents: Number(plan.budget_margin_cents), expectedDurationMinutes: Number(plan.expected_duration_minutes), suggestedCrewSize: Number(plan.suggested_crew_size),
      depositRequirement: plan.deposit_requirement, completedAt: String(plan.completed_at || "") },
    phases: phasePayload,
    requirements: requirements.results.map((row) => ({ id: String(row.id), phaseId: String(row.job_plan_phase_id), type: String(row.requirement_type),
      description: String(row.description), status: String(row.status), quantityMilli: Number(row.quantity_milli), expectedDurationMinutes: Number(row.expected_duration_minutes),
      requiredCapability: String(row.required_capability || ""), totalCostCents: Number(row.total_cost_cents), actualQuantityMilli: Number(row.actual_quantity_milli || 0),
      actualDurationMinutes: Number(row.actual_duration_minutes || 0), actualCostCents: Number(row.actual_total_cost_cents || 0), actualRecorded: Boolean(row.actual_id), actualNote: String(row.actual_note || "") })),
    readiness: { ...checks, ready: Object.values(checks).every(Boolean), assignedTo: member?.display_name || "" },
    execution: { actualCostCents, forecastCostCents, forecastMarginCents: Number(plan.accepted_subtotal_cents) - forecastCostCents, varianceCents, varianceStatus },
    completion: { ...completionChecks, proofRequired: proof.required, ready: Object.values(completionChecks).every(Boolean) && ["ready", "in_progress", "completed"].includes(String(plan.status)),
      completed, invoiceReady: completed, handoverReady: completed },
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
      const statements = await buildJobPlanStatements(db, { ownerUid: identity.uid, workOrderId,
        handoffId: String(handoff.id), quoteVersionId: String(handoff.quote_version_id), now });
      if (statements.length) await db.batch(statements);
    } else if (action === "requirement") {
      const requirementId = cleanAdminText(body.requirementId, 180); const status = ["required", "confirmed", "not_needed"].includes(String(body.status)) ? String(body.status) : "required";
      await db.prepare(`UPDATE trade_crm_job_plan_requirements SET status = ? WHERE id = ? AND firebase_uid = ? AND job_plan_id IN (SELECT id FROM trade_crm_job_plans WHERE work_order_id = ? AND firebase_uid = ?)`).bind(status, requirementId, identity.uid, workOrderId, identity.uid).run();
    } else if (action === "deposit") {
      const requirement = ["optional", "required", "waived"].includes(String(body.requirement)) ? String(body.requirement) : "optional";
      await db.prepare(`UPDATE trade_crm_job_plans SET deposit_requirement = ?, updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?`).bind(requirement, now, workOrderId, identity.uid).run();
    } else if (action === "ready") {
      const current = await payload(identity.uid, workOrderId); if (!current.readiness?.ready) throw new Error("NOT_READY");
      await db.batch([db.prepare(`UPDATE trade_crm_job_plans SET status = 'ready', ready_at = ?, updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?`).bind(now, now, workOrderId, identity.uid), db.prepare(`UPDATE trade_work_orders SET stage = 'ready', updated_at = ? WHERE id = ? AND firebase_uid = ?`).bind(now, workOrderId, identity.uid), db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at) VALUES (?, ?, ?, 'job_ready', 'Job is ready to schedule and dispatch.', ?)`).bind(crypto.randomUUID(), workOrderId, identity.uid, now)]);
    } else if (action === "actual") {
      const requirementId = cleanAdminText(body.requirementId, 180); const requirement = await db.prepare(`SELECT r.*, p.status plan_status, p.work_order_id FROM trade_crm_job_plan_requirements r JOIN trade_crm_job_plans p ON p.id = r.job_plan_id AND p.firebase_uid = r.firebase_uid WHERE r.id = ? AND r.firebase_uid = ? AND p.work_order_id = ?`).bind(requirementId, identity.uid, workOrderId).first<Row>();
      if (!requirement) throw new Error("JOB_NOT_FOUND"); if (!["ready", "in_progress", "completed"].includes(String(requirement.plan_status))) throw new Error("NOT_READY_TO_WORK");
      if (requirement.status === "not_needed" || (requirement.plan_status === "completed" && requirement.requirement_type === "form")) throw new Error("INVALID_ACTUAL");
      const quantity = body.usePlanned === true ? Number(requirement.quantity_milli) : Math.round(Number(body.quantityMilli || 0));
      const duration = body.usePlanned === true ? Number(requirement.expected_duration_minutes) : Math.round(Number(body.durationMinutes || 0));
      const cost = body.usePlanned === true ? Number(requirement.total_cost_cents) : Math.round(Number(body.totalCostCents || 0));
      if (![quantity, duration, cost].every((value) => Number.isFinite(value) && value >= 0) || quantity > 100000000 || duration > 1000000 || cost > 1000000000) throw new Error("INVALID_ACTUAL");
      const actualType = ["material", "labour"].includes(String(requirement.requirement_type)) ? String(requirement.requirement_type) : "task";
      const stockStatements = actualType === "material" ? await stockActualStatements(identity.uid,requirementId,quantity,body.stockLocations) : [];
      await db.batch([
        ...stockStatements,
        db.prepare(`INSERT INTO trade_work_order_events (id,work_order_id,firebase_uid,event_type,summary,created_at) SELECT ?,?,?,'job_cost_recorded',
          'Cost record for ' || ? || ': previous ' || COALESCE((SELECT json_object('quantityMilli',quantity_milli,'minutes',duration_minutes,'costExGstCents',total_cost_cents) FROM trade_crm_job_actuals WHERE job_plan_requirement_id=? AND firebase_uid=?),'not recorded') || '; saved ' || json_object('quantityMilli',?,'minutes',?,'costExGstCents',?), ?`)
          .bind(crypto.randomUUID(), workOrderId, identity.uid, String(requirement.description), requirementId, identity.uid, quantity, duration, cost, now),
        db.prepare(`INSERT INTO trade_crm_job_actuals (id, job_plan_id, job_plan_phase_id, job_plan_requirement_id, work_order_id, firebase_uid, actual_type, quantity_milli, duration_minutes, total_cost_cents, note, recorded_by_uid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(job_plan_requirement_id) DO UPDATE SET quantity_milli = excluded.quantity_milli, duration_minutes = excluded.duration_minutes, total_cost_cents = excluded.total_cost_cents, note = excluded.note, recorded_by_uid = excluded.recorded_by_uid, updated_at = excluded.updated_at`)
          .bind(crypto.randomUUID(), requirement.job_plan_id, requirement.job_plan_phase_id, requirementId, workOrderId, identity.uid, actualType, quantity, duration, cost, cleanAdminText(body.note, 300), identity.uid, now, now),
        db.prepare(`UPDATE trade_crm_job_plan_requirements SET status = 'completed' WHERE id = ? AND firebase_uid = ?`).bind(requirementId, identity.uid),
        db.prepare(`UPDATE trade_crm_job_plans SET status = 'in_progress', updated_at = ? WHERE id = ? AND firebase_uid = ? AND status = 'ready'`).bind(now, requirement.job_plan_id, identity.uid),
        db.prepare(`UPDATE trade_work_orders SET stage = 'in_progress', updated_at = ? WHERE id = ? AND firebase_uid = ? AND stage = 'ready'`).bind(now, workOrderId, identity.uid),
        db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at) VALUES (?, ?, ?, 'job_actual_recorded', ?, ?)`).bind(crypto.randomUUID(), workOrderId, identity.uid, `Actual work recorded for ${String(requirement.description)}.`, now),
      ]);
    } else if (action === "complete") {
      const current = await payload(identity.uid, workOrderId); if (!current.completion?.ready) throw new Error("NOT_COMPLETE");
      await db.batch([
        db.prepare(`UPDATE trade_crm_job_plans SET status = 'completed', completed_at = ?, updated_at = ? WHERE work_order_id = ? AND firebase_uid = ? AND status IN ('ready','in_progress')`).bind(now, now, workOrderId, identity.uid),
        db.prepare(`UPDATE trade_crm_job_plan_phases SET status = 'completed', completed_at = ?, updated_at = ? WHERE firebase_uid = ? AND job_plan_id IN (SELECT id FROM trade_crm_job_plans WHERE work_order_id = ? AND firebase_uid = ?)`).bind(now, now, identity.uid, workOrderId, identity.uid),
        db.prepare(`UPDATE trade_work_orders SET stage = 'completed', updated_at = ? WHERE id = ? AND firebase_uid = ?`).bind(now, workOrderId, identity.uid),
        db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at) VALUES (?, ?, ?, 'job_completed', 'Required scope, forms, materials and proof cleared. Invoice and handover preparation are ready.', ?)`).bind(crypto.randomUUID(), workOrderId, identity.uid, now),
      ]);
    } else return adminJson({ ok: false, error: "Unknown job readiness action." }, 400);
    return adminJson({ ok: true, ...(await payload(identity.uid, workOrderId)) });
  } catch (error) { return errorResponse(error); }
}
