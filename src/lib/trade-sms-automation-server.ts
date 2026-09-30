import { australianAppointmentTimeZone } from "./customer-appointment-calendar.ts";
import { followUpAppointmentEpoch } from "./trade-follow-ups.ts";
import { DEFAULT_SMS_AUTOMATION_RULES, isSmsAutomationKind, parseSmsAutomationRules, renderSmsAutomation, smsAutomationDueAt, type SmsAutomationKind, type SmsAutomationRule } from "./trade-sms-automation.ts";
import type { SmsActor } from "./trade-sms-server";

type SettingsActor = Pick<SmsActor, "ownerUid" | "isOwner">;
type RuleRow = { owner_uid: string; kind: string; enabled: number; delay_hours: number; body: string; review_url: string; revision: number; enabled_at: string; scan_cursor: string };
export type SmsAutomationDispatch = { eventId: string; ruleKind: SmsAutomationKind; ruleRevision: number; appointmentId: string; appointmentStart: string };
export type SmsAutomationServices = {
  ownerAccess: (ownerUid: string) => Promise<SmsActor>;
  send: (actor: SmsActor, customerId: string, body: string, requestId: string, workOrderId: string, purpose: "service" | "marketing", automation: SmsAutomationDispatch) => Promise<{ status: string }>;
};
function owner(actor: SettingsActor) { if (!actor.isOwner) throw new Error("SMS_OWNER_REQUIRED"); }
function ruleFromRow(row: RuleRow): SmsAutomationRule {
  if (!isSmsAutomationKind(row.kind)) throw new Error("SMS_AUTOMATION_INVALID");
  return { kind: row.kind, enabled: row.enabled === 1, delayHours: row.delay_hours, body: row.body, reviewUrl: row.review_url, revision: row.revision, enabledAt: row.enabled_at };
}
export async function readSmsAutomationSettings(actor: SettingsActor, db: D1Database) {
  owner(actor);
  const [rows, counts] = await Promise.all([
    db.prepare("SELECT * FROM trade_sms_automation_rules WHERE owner_uid=?").bind(actor.ownerUid).all<RuleRow>(),
    db.prepare("SELECT status,COUNT(*) total FROM trade_sms_automation_events WHERE owner_uid=? GROUP BY status").bind(actor.ownerUid).all<{ status: string; total: number }>(),
  ]);
  const saved = new Map(rows.results.map(row => [row.kind, ruleFromRow(row)]));
  const summary = { sent: 0, blocked: 0, unknown: 0 };
  for (const item of counts.results) {
    if (item.status === "sent" || item.status === "blocked" || item.status === "unknown") summary[item.status] = Number(item.total);
    if (item.status === "reserved") summary.unknown += Number(item.total);
  }
  return { canManage: true, rules: DEFAULT_SMS_AUTOMATION_RULES.map(rule => saved.get(rule.kind) || { ...rule, revision: 0, enabledAt: "" }), summary };
}
export async function saveSmsAutomationSettings(actor: SettingsActor, input: unknown, db: D1Database, now = new Date()) {
  owner(actor);
  const rules = parseSmsAutomationRules(input);
  const previous = await readSmsAutomationSettings(actor, db);
  if (rules.some(rule => rule.enabled)) {
    const connected = await db.prepare("SELECT 1 FROM trade_sms_connections WHERE firebase_uid=? AND status='connected'").bind(actor.ownerUid).first();
    if (!connected) throw new Error("SMS_CONNECTION_REQUIRED");
  }
  const stamp = now.toISOString();
  await db.batch(rules.map(rule => {
    const before = previous.rules.find(item => item.kind === rule.kind);
    const enabledAt = rule.enabled ? before?.enabled && before.delayHours === rule.delayHours ? before.enabledAt || stamp : stamp : "";
    return db.prepare(`INSERT INTO trade_sms_automation_rules (owner_uid,kind,enabled,delay_hours,body,review_url,revision,enabled_at,updated_at,next_scan_at,scan_cursor)
      VALUES (?,?,?,?,?,?,1,?,?,'','') ON CONFLICT(owner_uid,kind) DO UPDATE SET enabled=excluded.enabled,delay_hours=excluded.delay_hours,
      body=excluded.body,review_url=excluded.review_url,revision=trade_sms_automation_rules.revision+1,enabled_at=excluded.enabled_at,
      updated_at=excluded.updated_at,next_scan_at='',scan_cursor=''`)
      .bind(actor.ownerUid, rule.kind, rule.enabled ? 1 : 0, rule.delayHours, rule.body, rule.reviewUrl, enabledAt, stamp);
  }));
  return readSmsAutomationSettings(actor, db);
}
type Candidate = { id: string; work_order_id: string; customer_id: string; starts_at: string; status: string; completed_at: string; cursor: string;
  work_number: string; title: string; first_name: string; address_state: string };
const DEFINITE_BLOCKS = new Set(["SMS_CONSENT_REQUIRED", "SMS_MARKETING_CONSENT_REQUIRED", "SMS_OPTED_OUT", "SMS_MOBILE_REQUIRED", "SMS_CUSTOMER_REQUIRED",
  "SMS_JOB_ACCESS_REQUIRED", "SMS_CONNECTION_REQUIRED", "SMS_PHONE_CONFLICT", "SMS_LIMIT_OR_PERMISSION_CHANGED", "SMS_CREDIT_REQUIRED", "SMS_INSUFFICIENT_CREDIT",
  "SMS_AUTOMATION_CHANGED", "SMS_AUTOMATION_INVALID", "SMS_AUTOMATION_DISABLED", "SMS_BODY_INVALID"]);

/** Bounded keyset scan. Every reserved occurrence is single-use, including uncertain sends. */
export async function scanSmsAutomations(db: D1Database, services: SmsAutomationServices, now = new Date()) {
  const stamp = now.toISOString();
  // Interrupted reservations never blindly retry a charge or a provider request.
  await db.prepare("UPDATE trade_sms_automation_events SET status='unknown',reason='SMS_SEND_INTERRUPTED',updated_at=? WHERE status='reserved' AND updated_at<?")
    .bind(stamp, new Date(now.getTime() - 300000).toISOString()).run();
  const rules = await db.prepare("SELECT * FROM trade_sms_automation_rules WHERE enabled=1 AND next_scan_at<=? ORDER BY next_scan_at,owner_uid,kind LIMIT 6")
    .bind(stamp).all<RuleRow>();
  for (const stored of rules.results) {
    await db.prepare("UPDATE trade_sms_automation_rules SET next_scan_at=? WHERE owner_uid=? AND kind=? AND revision=?")
      .bind(new Date(now.getTime() + 60000).toISOString(), stored.owner_uid, stored.kind, stored.revision).run();
    let actor: SmsActor;
    try { actor = await services.ownerAccess(stored.owner_uid); } catch { continue; }
    const rule = ruleFromRow(stored);
    const from = new Date(now.getTime() - 44 * 86400000).toISOString().slice(0, 10);
    const to = new Date(now.getTime() + 44 * 86400000).toISOString().slice(0, 10);
    const candidates = await db.prepare(`SELECT ap.id,ap.work_order_id,ap.starts_at,ap.status,ap.completed_at,ap.starts_at||':'||ap.id cursor,
      d.crm_customer_id customer_id,w.work_number,w.title,c.first_name,s.address_state
      FROM trade_crm_appointments ap JOIN trade_work_orders w ON w.id=ap.work_order_id AND w.firebase_uid=ap.firebase_uid
      JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
      JOIN trade_crm_customers c ON c.id=d.crm_customer_id AND c.firebase_uid=w.firebase_uid AND c.record_status='active'
      JOIN trade_crm_service_sites s ON s.id=d.service_site_id AND s.firebase_uid=w.firebase_uid AND s.record_status='active'
      WHERE ap.firebase_uid=? AND w.partner_type='installer' AND w.record_status='active' AND w.stage<>'cancelled'
      AND w.source_type<>'opportunity' AND d.customer_source IN ('trade_owned','public_lead_released')
      AND ap.status=? AND (?=1 OR ap.completed_at<>'') AND ap.starts_at>=? AND ap.starts_at<? AND ap.starts_at||':'||ap.id>?
      AND NOT EXISTS(SELECT 1 FROM trade_dataforce_sources source
        WHERE source.firebase_uid=ap.firebase_uid AND source.work_order_id=ap.work_order_id
        AND ap.id=source.work_order_id||':visit')
      AND NOT EXISTS(SELECT 1 FROM trade_csv_import_sources source
        WHERE source.firebase_uid=ap.firebase_uid AND source.work_order_id=ap.work_order_id AND source.entity_type='job'
        AND ap.id=source.work_order_id||':visit')
      AND NOT EXISTS(SELECT 1 FROM trade_sms_automation_events e WHERE e.owner_uid=ap.firebase_uid AND e.rule_kind=? AND e.appointment_id=ap.id AND e.appointment_start=ap.starts_at)
      ORDER BY ap.starts_at,ap.id LIMIT 40`)
      .bind(stored.owner_uid, rule.kind === "appointment_reminder" ? "scheduled" : "completed", rule.kind === "appointment_reminder" ? 1 : 0,
        from, to, stored.scan_cursor, rule.kind).all<Candidate>();
    let cursor = "", dispatched = 0;
    for (const candidate of candidates.results) {
      if (dispatched >= 8) break;
      cursor = candidate.cursor;
      // Do not guess a service site's state. All supported Australian zones are explicit.
      if (!["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"].includes(candidate.address_state)) continue;
      const timeZone = australianAppointmentTimeZone(candidate.address_state);
      const epoch = followUpAppointmentEpoch(candidate.starts_at, timeZone);
      const due = smsAutomationDueAt(rule.kind, candidate.starts_at, timeZone, rule.delayHours);
      if (!Number.isFinite(epoch) || !Number.isFinite(due) || due > now.getTime() || due < Date.parse(stored.enabled_at)
        || due < now.getTime() - 86400000 || (rule.kind === "appointment_reminder" && epoch <= now.getTime())) continue;
      if (rule.kind !== "appointment_reminder" && (!Number.isFinite(Date.parse(candidate.completed_at)) || Date.parse(candidate.completed_at) > now.getTime() || epoch > now.getTime())) continue;
      const rendered = renderSmsAutomation(rule, { customer_first_name: candidate.first_name || "there", job_number: candidate.work_number, job_title: candidate.title,
        appointment_date: new Intl.DateTimeFormat("en-AU", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(epoch),
        appointment_time: new Intl.DateTimeFormat("en-AU", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(epoch) });
      const eventId = crypto.randomUUID();
      const eventKey = JSON.stringify([stored.owner_uid, rule.kind, candidate.id, candidate.starts_at]);
      const claim = await db.prepare(`INSERT OR IGNORE INTO trade_sms_automation_events
        (id,owner_uid,rule_kind,rule_revision,work_order_id,customer_id,appointment_id,appointment_start,event_key,due_at,status,reason,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,'reserved','',?,? WHERE EXISTS(SELECT 1 FROM trade_sms_automation_rules WHERE owner_uid=? AND kind=? AND enabled=1 AND revision=?)`)
        .bind(eventId, stored.owner_uid, rule.kind, stored.revision, candidate.work_order_id, candidate.customer_id, candidate.id, candidate.starts_at,
          eventKey, new Date(due).toISOString(), stamp, stamp, stored.owner_uid, rule.kind, stored.revision).run();
      if (!claim.meta.changes) continue;
      dispatched++;
      let status = "blocked", reason = rendered.missing.length ? "SMS_AUTOMATION_FIELDS_MISSING" : "";
      if (!rendered.missing.length) {
        try {
          const result = await services.send(actor, candidate.customer_id, rendered.body, `sms-auto-${eventId}`, candidate.work_order_id,
            rule.kind === "review_request" ? "marketing" : "service", { eventId, ruleKind: rule.kind, ruleRevision: stored.revision, appointmentId: candidate.id, appointmentStart: candidate.starts_at });
          status = ["accepted", "queued", "sending", "sent", "delivered"].includes(result.status) ? "sent" : result.status === "failed" ? "blocked" : "unknown";
          if (status !== "sent") reason = status === "blocked" ? "SMS_DELIVERY_FAILED" : "SMS_DELIVERY_UNCONFIRMED";
        } catch (error) {
          const code = error instanceof Error ? error.message : "";
          status = DEFINITE_BLOCKS.has(code) ? "blocked" : "unknown";
          reason = DEFINITE_BLOCKS.has(code) ? code : "SMS_DELIVERY_UNCONFIRMED";
        }
      }
      await db.prepare("UPDATE trade_sms_automation_events SET status=?,reason=?,updated_at=? WHERE id=? AND owner_uid=? AND status='reserved'")
        .bind(status, reason, stamp, eventId, stored.owner_uid).run();
    }
    await db.prepare("UPDATE trade_sms_automation_rules SET scan_cursor=? WHERE owner_uid=? AND kind=? AND revision=?")
      .bind(candidates.results.length === 40 || dispatched >= 8 ? cursor : "", stored.owner_uid, rule.kind, stored.revision).run();
  }
}
