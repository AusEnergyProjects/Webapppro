import { nextTlinkJobNumber } from "./trade-job-number-server";
import { jobSyncChangeStatements } from "./trade-team-sync-server";
import { publishedTradeFormTemplatesFor } from "./trade-form-templates-server";

const serviceLabels: Record<string, string> = {
  annual_service: "Annual service",
  filter_check: "Filter and airflow check",
  safety_inspection: "Safety inspection",
  performance_review: "Performance review",
  warranty_check: "Warranty check",
  firmware_monitoring: "Firmware and monitoring review",
};

function storedTasks(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? [...new Set(parsed.map((item) => String(item).trim()).filter(Boolean))].slice(0, 24) : [];
  } catch { return []; }
}

function defaultTasks(serviceType: string) {
  return ["Confirm the asset and service scope", "Complete the scheduled inspection or service", "Record technical findings and evidence", "Confirm the next action and due date",
    ...(serviceType === "safety_inspection" ? ["Escalate any unsafe condition before leaving the site"] : [])];
}

type GenerateOptions = { ownerUid?: string; sourceWorkOrderId?: string; today?: string; limit?: number };

export async function generateDueServiceJobs(db: D1Database, options: GenerateOptions = {}) {
  const today = options.today || new Date().toISOString().slice(0, 10);
  const limit = Math.max(1, Math.min(200, options.limit || 100));
  const conditions = ["p.status = 'active'", "p.auto_create_enabled = 1", "date(p.next_due_at, '-' || p.job_lead_days || ' day') <= date(?)"];
  const bindings: unknown[] = [today];
  if (options.ownerUid) { conditions.push("p.firebase_uid = ?"); bindings.push(options.ownerUid); }
  if (options.sourceWorkOrderId) { conditions.push("p.work_order_id = ?"); bindings.push(options.sourceWorkOrderId); }
  bindings.push(limit);
  const rows = await db.prepare(`SELECT p.id plan_id, p.firebase_uid, p.work_order_id source_work_order_id,
      p.service_type, p.next_due_at, p.job_template_id, a.brand, a.model_number,
      w.service_category, w.site_area, w.source_type original_source_type,
      d.crm_customer_id, d.customer_source, d.customer_reference,
      t.title template_title, t.priority template_priority, t.description template_description, t.task_titles
    FROM trade_asset_service_plans p
    JOIN trade_installed_assets a ON a.id = p.asset_id AND a.record_status = 'active'
    JOIN trade_work_orders w ON w.id = p.work_order_id AND w.firebase_uid = p.firebase_uid AND w.record_status = 'active'
    LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    LEFT JOIN trade_crm_job_templates t ON t.id = p.job_template_id AND t.firebase_uid = p.firebase_uid AND t.record_status = 'active'
    WHERE ${conditions.join(" AND ")}
    ORDER BY p.next_due_at, p.updated_at LIMIT ?`).bind(...bindings).all<Record<string, unknown>>();

  let created = 0;
  const generated: Array<{ workOrderId: string; workNumber: string; dueAt: string }> = [];
  for (const row of rows.results) {
    await db.prepare(`DELETE FROM trade_service_job_generations
      WHERE service_plan_id = ? AND due_at = ? AND generated_work_order_id = ''
        AND datetime(created_at) < datetime('now', '-30 minutes')`)
      .bind(row.plan_id, row.next_due_at).run();
    const reservationId = crypto.randomUUID();
    const reserved = await db.prepare(`INSERT OR IGNORE INTO trade_service_job_generations
      (id, service_plan_id, source_work_order_id, generated_work_order_id, firebase_uid, due_at, created_at)
      VALUES (?, ?, ?, '', ?, ?, ?)
      RETURNING id`).bind(reservationId, row.plan_id, row.source_work_order_id, row.firebase_uid, row.next_due_at,
      new Date().toISOString()).all<Record<string, unknown>>();
    if (!reserved.results.length) continue;
    try {
      const now = new Date().toISOString();
      const workOrderId = crypto.randomUUID();
      const workNumber = await nextTlinkJobNumber(db, now);
      const label = serviceLabels[String(row.service_type)] || "Scheduled service";
      const title = String(row.template_title || "").trim() || `${label}: ${String(row.brand)} ${String(row.model_number)}`;
      const tasks = storedTasks(row.task_titles);
      const taskTitles = tasks.length ? tasks : defaultTasks(String(row.service_type));
      const protectedJob = row.original_source_type === "opportunity" || row.customer_source === "platform_private";
      const customerSource = protectedJob ? "platform_private" : String(row.customer_source || "internal");
      const customerId = protectedJob ? "" : String(row.crm_customer_id || "");
      const serviceForm = (await publishedTradeFormTemplatesFor(String(row.service_category || "other"), db))
        .filter((template) => template.key === "service-visit-support")
        .sort((left, right) => right.version - left.version)[0];
      await db.batch([
        db.prepare(`INSERT INTO trade_work_orders
          (id, firebase_uid, partner_type, work_type, source_type, source_reference, work_number, title,
           service_category, site_area, stage, priority, scheduled_start, scheduled_end, assignee_label,
           record_status, created_at, updated_at)
          VALUES (?, ?, 'installer', 'job', 'recurring_service', ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, '', 'active', ?, ?)`)
          .bind(workOrderId, row.firebase_uid, row.plan_id, workNumber, title, row.service_category || "other",
            row.site_area || "", row.template_priority || "standard", row.next_due_at, row.next_due_at, now, now),
        db.prepare(`INSERT INTO trade_crm_job_details
          (id, work_order_id, firebase_uid, crm_customer_id, customer_source, pipeline_stage, description,
           customer_reference, next_action, tags, estimated_value_cents, quoted_value_cents, invoiced_value_cents,
           paid_value_cents, quote_status, invoice_status, payment_due_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, 'Complete scheduled service and record the next due date.',
            '["recurring-service"]', 0, 0, 0, 0, 'not_started', 'not_started', '', ?, ?)`)
          .bind(crypto.randomUUID(), workOrderId, row.firebase_uid, customerId, customerSource,
            row.template_description || `${label} for ${String(row.brand)} ${String(row.model_number)}.`,
            protectedJob ? String(row.customer_reference || row.plan_id) : "", now, now),
        ...taskTitles.map((task, index) => db.prepare(`INSERT INTO trade_work_order_tasks
          (id, work_order_id, firebase_uid, title, due_at, status, completed_at, revision, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'pending', '', 1, ?, ?, ?)`)
          .bind(crypto.randomUUID(), workOrderId, row.firebase_uid, task, row.next_due_at, index, now, now)),
        ...(serviceForm ? [db.prepare(`INSERT INTO trade_job_forms
          (id, work_order_id, firebase_uid, template_key, template_version, template_name, jurisdiction,
           template_snapshot, answers, status, revision, completed_by_uid, completed_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'draft', 1, '', '', ?, ?)`)
          .bind(crypto.randomUUID(), workOrderId, row.firebase_uid, serviceForm.key, serviceForm.version,
            serviceForm.name, serviceForm.jurisdiction, JSON.stringify(serviceForm), now, now)] : []),
        db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
          VALUES (?, ?, ?, 'recurring_job_created', ?, ?)`)
          .bind(crypto.randomUUID(), workOrderId, row.firebase_uid, `${workNumber} created from an asset service schedule.`, now),
        db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
          VALUES (?, ?, ?, 'recurring_job_generated', ?, ?)`)
          .bind(crypto.randomUUID(), row.source_work_order_id, row.firebase_uid, `${workNumber} created for the ${String(row.next_due_at)} service due date.`, now),
        db.prepare(`UPDATE trade_service_job_generations SET generated_work_order_id = ? WHERE id = ?`)
          .bind(workOrderId, reservationId),
        db.prepare(`UPDATE trade_asset_service_plans SET last_generated_due_at = ?, last_generated_work_order_id = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ?`).bind(row.next_due_at, workOrderId, now, row.plan_id, row.firebase_uid),
        ...jobSyncChangeStatements(db, { ownerUid: String(row.firebase_uid), workOrderId, revision: 1, changedAt: now }),
      ]);
      created += 1;
      generated.push({ workOrderId, workNumber, dueAt: String(row.next_due_at) });
    } catch (error) {
      await db.prepare("DELETE FROM trade_service_job_generations WHERE id = ? AND generated_work_order_id = ''")
        .bind(reservationId).run().catch(() => undefined);
      throw error;
    }
  }
  return { created, generated, checked: rows.results.length };
}
