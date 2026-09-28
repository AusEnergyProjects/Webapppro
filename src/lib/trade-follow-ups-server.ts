import type { TeamAccess } from "./trade-team-server";
import { DEFAULT_FOLLOW_UP_SETTINGS, DEFAULT_FOLLOW_UP_TEMPLATES, followUpTemplate, followUpSettings,
  renderFollowUp, followUpLocalTime, followUpAppointmentEpoch, followUpTimingHours, type FollowUpTemplate } from "./trade-follow-ups.ts";
import { australianAppointmentTimeZone } from "./customer-appointment-calendar.ts";

type Row = Record<string, unknown>;
export type FollowUpServices = {
  ownerAccess: (ownerUid: string) => Promise<TeamAccess>;
  recipient: (access: TeamAccess, workOrderId: string) => Promise<string>;
  send: (ownerUid: string, actorUid: string, message: { recipient: string; subject: string; body: string; idempotencyKey: string }, beforeSend: () => Promise<void>) => Promise<unknown>;
};
type Context = { recipient: string; recipientName: string; fields: Record<string, string>; invoiceId: string; invoiceDue: string;
  invoiceReady: boolean; appointmentId: string; appointmentStart: string; appointmentEpoch: number | null; timeZone: string; hash: string };
type FrozenContext = { templateKind: FollowUpTemplate["kind"]; appointmentId: string; invoiceId: string; settingsRevision: number; pastAppointment: boolean };
const iso = () => new Date().toISOString();
const text = (v: unknown) => String(v || "");
function invalid(code: string): never { throw new Error(code); }
export async function followUpHash(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
export async function followUpConfiguration(db: D1Database, ownerUid: string) {
  const [stored, overrides] = await Promise.all([
    db.prepare("SELECT * FROM trade_follow_up_settings WHERE owner_uid = ?").bind(ownerUid).first<Row>(),
    db.prepare("SELECT * FROM trade_email_templates WHERE owner_uid = ? ORDER BY name").bind(ownerUid).all<Row>(),
  ]);
  const templates = new Map(DEFAULT_FOLLOW_UP_TEMPLATES.map(t => [t.id, t]));
  for (const row of overrides.results) {
    if (row.archived) templates.delete(text(row.id));
    else templates.set(text(row.id), followUpTemplate(row));
  }
  return { templates: [...templates.values()], settings: stored ? followUpSettings(JSON.parse(text(stored.settings_json))) : { ...DEFAULT_FOLLOW_UP_SETTINGS },
    invoiceEnabledAt: text(stored?.invoice_enabled_at), appointmentEnabledAt: text(stored?.appointment_enabled_at), scanCursor: text(stored?.scan_cursor), revision: Number(stored?.revision || 0) };
}
export async function saveFollowUpTemplate(db: D1Database, ownerUid: string, input: unknown) {
  const t = followUpTemplate(input);
  const config = await followUpConfiguration(db, ownerUid);
  if ((config.settings.invoiceEnabled && config.settings.invoiceTemplateId === t.id && t.kind !== "invoice")
    || (config.settings.appointmentEnabled && config.settings.appointmentTemplateId === t.id && t.kind !== (config.settings.appointmentTiming.direction === "after" ? "appointment_after" : "appointment"))) invalid("FOLLOW_UP_TEMPLATE_IN_USE");
  const count = await db.prepare("SELECT COUNT(*) n FROM trade_email_templates WHERE owner_uid = ? AND archived = 0 AND id <> ?").bind(ownerUid, t.id).first<{ n: number }>();
  if (Number(count?.n) >= 50) invalid("FOLLOW_UP_TEMPLATE_LIMIT");
  await db.batch([db.prepare(`INSERT INTO trade_email_templates (owner_uid,id,name,kind,subject,body,updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(owner_uid,id) DO UPDATE SET name=excluded.name,kind=excluded.kind,subject=excluded.subject,body=excluded.body,archived=0,updated_at=excluded.updated_at`)
    .bind(ownerUid, t.id, t.name, t.kind, t.subject, t.body, iso()),
    db.prepare("UPDATE trade_follow_up_settings SET revision=revision+1,next_scan_at='',scan_cursor='' WHERE owner_uid=?").bind(ownerUid)]);
}
export async function deleteFollowUpTemplate(db: D1Database, ownerUid: string, id: string) {
  const config = await followUpConfiguration(db, ownerUid), t = config.templates.find(item => item.id === id);
  if (!t) invalid("FOLLOW_UP_TEMPLATE_UNAVAILABLE");
  if ((config.settings.invoiceEnabled && config.settings.invoiceTemplateId === id) || (config.settings.appointmentEnabled && config.settings.appointmentTemplateId === id)) invalid("FOLLOW_UP_TEMPLATE_IN_USE");
  await db.prepare(`INSERT INTO trade_email_templates (owner_uid,id,name,kind,subject,body,archived,updated_at) VALUES (?,?,?,?,?,?,1,?)
    ON CONFLICT(owner_uid,id) DO UPDATE SET archived=1,updated_at=excluded.updated_at`).bind(ownerUid, id, t.name, t.kind, t.subject, t.body, iso()).run();
}
export async function saveFollowUpSettings(db: D1Database, ownerUid: string, input: unknown, now = new Date()) {
  const settings = followUpSettings(input), config = await followUpConfiguration(db, ownerUid);
  if (settings.invoiceEnabled && !config.templates.some(t => t.id === settings.invoiceTemplateId && t.kind === "invoice")) invalid("FOLLOW_UP_TEMPLATE_UNAVAILABLE");
  if (settings.appointmentEnabled && !config.templates.some(t => t.id === settings.appointmentTemplateId && t.kind === (settings.appointmentTiming.direction === "after" ? "appointment_after" : "appointment"))) invalid("FOLLOW_UP_TEMPLATE_UNAVAILABLE");
  const since = settings.invoiceEnabled ? config.settings.invoiceEnabled ? config.invoiceEnabledAt : now.toISOString() : "";
  const appointmentSince = settings.appointmentEnabled ? config.settings.appointmentEnabled ? config.appointmentEnabledAt : now.toISOString() : "";
  await db.prepare(`INSERT INTO trade_follow_up_settings (owner_uid,settings_json,invoice_enabled_at,appointment_enabled_at,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(owner_uid) DO UPDATE SET settings_json=excluded.settings_json,invoice_enabled_at=excluded.invoice_enabled_at,
    appointment_enabled_at=excluded.appointment_enabled_at,
    revision=trade_follow_up_settings.revision+1,next_scan_at='',scan_cursor='',updated_at=excluded.updated_at`)
    .bind(ownerUid, JSON.stringify(settings), since, appointmentSince, now.toISOString()).run();
}

export async function followUpContext(db: D1Database, services: FollowUpServices, access: TeamAccess, workOrderId: string,
  kind: FollowUpTemplate["kind"], options: { appointmentId?: string; now?: Date; automatic?: boolean; pastAppointment?: boolean } = {}): Promise<Context> {
  const now = options.now || new Date();
  const recipient = await services.recipient(access, workOrderId);
  const row = await db.prepare(`SELECT w.title,w.work_number,w.stage,w.source_type,d.crm_customer_id,d.invoice_status,d.invoiced_value_cents,d.paid_value_cents,
    d.accepted_disclosure_sha256,d.accepted_disclosure_snapshot,
    c.first_name,c.last_name,c.business_name,c.email,a.business_name trade_name,
    s.address_line_1,s.address_line_2,s.suburb,s.address_state,s.postcode
    FROM trade_work_orders w JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
    JOIN trade_crm_customers c ON c.id=d.crm_customer_id AND c.firebase_uid=w.firebase_uid AND c.record_status='active'
    JOIN trade_accounts a ON a.firebase_uid=w.firebase_uid
    LEFT JOIN trade_crm_service_sites s ON s.id=d.service_site_id AND s.firebase_uid=w.firebase_uid AND s.record_status='active'
    WHERE w.id=? AND w.firebase_uid=? AND w.partner_type='installer' AND w.record_status='active'
    AND w.source_type<>'opportunity' AND d.customer_source IN ('trade_owned','public_lead_released')
    AND (?=1 OR w.assignee_member_id=?)`)
    .bind(workOrderId, access.ownerUid, access.isOwner || access.jobScope === "team" ? 1 : 0, access.memberId).first<Row>();
  if (!row || row.stage === "cancelled") invalid("EMAIL_RECIPIENT_UNAVAILABLE");
  if (row.source_type === "public_lead") {
    const snapshot = text(row.accepted_disclosure_snapshot);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot));
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join("");
    let disclosure: { customer?: { email?: string } };
    try { disclosure = JSON.parse(snapshot); } catch { invalid("EMAIL_RECIPIENT_UNAVAILABLE"); }
    if (hash !== row.accepted_disclosure_sha256 || disclosure?.customer?.email?.trim().toLowerCase() !== recipient.trim().toLowerCase()) invalid("EMAIL_RECIPIENT_UNAVAILABLE");
  }
  const suppressed = await db.prepare(`SELECT 1 FROM trade_crm_quote_deliveries WHERE firebase_uid=? AND crm_customer_id=?
    AND channel='email' AND status IN ('complained','opted_out')
    UNION ALL SELECT 1 FROM trade_crm_quick_invoices WHERE firebase_uid=? AND crm_customer_id=? AND delivery_status IN ('complained','opted_out')
    UNION ALL SELECT 1 FROM trade_crm_photo_request_deliveries WHERE firebase_uid=? AND crm_customer_id=? AND channel='email' AND status IN ('complained','opted_out') LIMIT 1`)
    .bind(access.ownerUid,row.crm_customer_id,access.ownerUid,row.crm_customer_id,access.ownerUid,row.crm_customer_id).first();
  if (suppressed) invalid("FOLLOW_UP_OPTED_OUT");
  const recipientName = text(row.business_name) || [row.first_name,row.last_name].filter(Boolean).join(" ") || "there";
  const fields: Record<string,string> = { customer_name: recipientName, business_name: text(row.trade_name),
    customer_first_name: text(row.first_name) || recipientName,
    job_number: text(row.work_number), job_title: text(row.title), site_address: [row.address_line_1,row.address_line_2,row.suburb,row.address_state,row.postcode].filter(Boolean).join(", ") };
  const zone = australianAppointmentTimeZone(row.address_state);
  let invoiceId = "", invoiceDue = "", invoiceReady = false, appointmentId = "", appointmentStart = "", appointmentEpoch: number | null = null;
  if (kind === "invoice") {
    if (!access.isOwner && !access.canManageInvoices) invalid("EMAIL_ACCESS_REQUIRED");
    const invoices = await db.prepare(`SELECT q.id,q.invoice_number,q.due_at,q.total_cents,q.status,'quick' source,'' commercial_handoff_id,
      json_extract(q.document_snapshot_json,'$.customer.email') invoice_recipient,
      COALESCE((SELECT SUM(total_cents) FROM trade_crm_quick_invoice_credits cr WHERE cr.invoice_id=q.id AND cr.firebase_uid=q.firebase_uid AND cr.status='issued'),0) credits,
      CASE WHEN q.sent_at<>'' AND q.provider_message_id<>'' AND q.delivery_status IN ('provider_accepted','sent','delivered') THEN 1 ELSE 0 END delivered
      FROM trade_crm_quick_invoices q WHERE q.firebase_uid=? AND q.work_order_id=? AND q.crm_customer_id=? AND q.status IN ('issued','part_credited')
      UNION ALL SELECT i.id,i.invoice_number,i.due_at,i.total_cents,i.status,'accepted',i.commercial_handoff_id,
      (SELECT recipient_email FROM trade_crm_accepted_invoice_deliveries e WHERE e.invoice_id=i.id AND e.firebase_uid=i.firebase_uid),0,
      EXISTS(SELECT 1 FROM trade_crm_accepted_invoice_deliveries e WHERE e.invoice_id=i.id AND e.firebase_uid=i.firebase_uid AND e.status='provider_accepted')
      FROM trade_crm_accepted_invoices i
      JOIN trade_crm_quote_acceptances ac ON ac.id=i.acceptance_id AND ac.firebase_uid=i.firebase_uid
        AND ac.result_invoice_id=i.id AND ac.work_order_id=i.work_order_id AND ac.crm_customer_id=i.crm_customer_id
        AND ac.quote_id=i.quote_id AND ac.quote_version_id=i.quote_version_id AND ac.decision='accepted'
      JOIN trade_crm_quote_links link ON link.id=ac.quote_link_id AND link.firebase_uid=i.firebase_uid
        AND link.quote_id=i.quote_id AND link.quote_version_id=i.quote_version_id AND link.work_order_id=i.work_order_id
        AND link.crm_customer_id=i.crm_customer_id AND link.token_issue=ac.token_issue AND link.status='accepted'
      WHERE i.firebase_uid=? AND i.work_order_id=? AND i.crm_customer_id=? AND i.status='issued' AND i.issue_blocker_code=''`)
      .bind(access.ownerUid,workOrderId,row.crm_customer_id,access.ownerUid,workOrderId,row.crm_customer_id).all<Row>();
    const invoice = invoices.results.length === 1 ? invoices.results[0] : null;
    if (invoice && !["paid","void","voided","cancelled","credited","draft","not_started"].includes(text(row.invoice_status))) {
      const accounting = await db.prepare("SELECT * FROM trade_crm_accounting_documents WHERE firebase_uid=? AND work_order_id=? AND document_type='invoice'")
        .bind(access.ownerUid,workOrderId).first<Row>();
      const net = Number(invoice.total_cents)-Number(invoice.credits), paid = Math.max(Number(row.paid_value_cents),Number(accounting?.paid_amount_cents || 0));
      const matches = !accounting || (text(accounting.commercial_handoff_id) === text(invoice.commercial_handoff_id)
        && (invoice.source !== "quick" || accounting.commercial_reference === invoice.invoice_number)
        && Number(accounting.amount_cents) === net && text(accounting.due_at).slice(0,10) === text(invoice.due_at)
        && ["issued","part_paid","overdue"].includes(text(accounting.status)));
      const fresh = !accounting || (!options.automatic || (now.getTime()-Date.parse(text(accounting.last_synced_at)) < 86400000));
      if (Number.isSafeInteger(net) && Number.isSafeInteger(paid) && paid >= 0 && net > paid
        && Number(row.invoiced_value_cents) === net && matches && fresh
        && (!options.automatic || (invoice.delivered && text(invoice.invoice_recipient).trim().toLowerCase() === recipient.trim().toLowerCase()))) {
        invoiceId = text(invoice.id); invoiceDue = text(invoice.due_at); invoiceReady = true;
        fields.invoice_number = text(invoice.invoice_number); fields.invoice_due_date = dateLabel(invoiceDue);
        fields.invoice_amount = new Intl.NumberFormat("en-AU", {style:"currency",currency:"AUD"}).format((net-paid)/100);
      }
    }
  }
  if (kind === "appointment" || kind === "appointment_after") {
    const past=Boolean(options.pastAppointment || kind === "appointment_after");
    const appointment = await db.prepare(`SELECT id,starts_at FROM trade_crm_appointments WHERE firebase_uid=? AND work_order_id=?
      AND (status='scheduled' OR (?=1 AND status='completed'))
      AND (?='' OR id=?) AND (CASE WHEN ?=1 THEN starts_at<=? ELSE starts_at>? END)
      AND (?=1 OR assignee_member_id=?) ORDER BY CASE WHEN ?=1 THEN starts_at END DESC,starts_at LIMIT 1`)
      .bind(access.ownerUid,workOrderId,past?1:0,options.appointmentId || "",options.appointmentId || "",past?1:0,followUpLocalTime(now,zone),followUpLocalTime(now,zone),access.isOwner || access.scheduleScope === "team" ? 1 : 0,access.memberId,past?1:0).first<Row>();
    if (appointment) {
      const epoch = followUpAppointmentEpoch(text(appointment.starts_at),zone);
      if (Number.isFinite(epoch) && (past ? epoch <= now.getTime() : epoch > now.getTime())) {
        appointmentId = text(appointment.id); appointmentStart = text(appointment.starts_at); appointmentEpoch = epoch;
        fields.appointment_date = new Intl.DateTimeFormat("en-AU",{timeZone:zone,weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(epoch);
        fields.appointment_time = new Intl.DateTimeFormat("en-AU",{timeZone:zone,hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(epoch);
      }
    }
  }
  const state = { recipient, recipientName, fields, invoiceId, invoiceDue, invoiceReady, appointmentId, appointmentStart, appointmentEpoch, timeZone:zone };
  return {...state,hash:await followUpHash(state)};
}
function dateLabel(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-").reverse().join("/") : ""; }
export async function previewFollowUp(db: D1Database, services: FollowUpServices, access: TeamAccess, workOrderId: string, templateId: string, options: {appointmentId?: string; now?: Date; automatic?: boolean} = {}) {
  const config = await followUpConfiguration(db,access.ownerUid), template = config.templates.find(t => t.id === templateId);
  if (!template) invalid("FOLLOW_UP_TEMPLATE_UNAVAILABLE");
  const pastAppointment=options.automatic ? config.settings.appointmentTiming.direction === "after" : template.kind === "appointment_after";
  const context = await followUpContext(db,services,access,workOrderId,template.kind,{...options,pastAppointment}), rendered = renderFollowUp(template,context.fields);
  if (template.kind === "invoice" && !context.invoiceReady) rendered.missing.push("An issued unpaid invoice with matching payment records");
  if ((template.kind === "appointment" || template.kind === "appointment_after") && !context.appointmentId) rendered.missing.push(pastAppointment?"A past visit that was not cancelled":"An upcoming appointment");
  return {...rendered,pastAppointment,recipient:context.recipient,recipientName:context.recipientName,contextHash:context.hash,context,template,config};
}
export async function followUpHistory(db: D1Database, ownerUid: string, workOrderId = "") {
  const rows = await db.prepare(`SELECT id,subject,status,error,created_at createdAt FROM trade_follow_up_messages WHERE owner_uid=? AND (?='' OR work_order_id=?) ORDER BY created_at DESC LIMIT 20`)
    .bind(ownerUid,workOrderId,workOrderId).all<Row>();
  return rows.results;
}
export async function queueManualFollowUp(db: D1Database, services: FollowUpServices, access: TeamAccess, input: Record<string,unknown>) {
  const workOrderId = text(input.workOrderId), templateId=text(input.templateId), requestId=text(input.requestId);
  if (!/^[\w-]{16,100}$/.test(requestId) || !/^[\w-]{1,180}$/.test(workOrderId)) invalid("EMAIL_INPUT_INVALID");
  const checked=followUpTemplate({id:templateId,name:"Follow up",kind:"general",subject:input.subject,body:input.body});
  if (/\{[^{}]+\}/.test(checked.subject+checked.body)) invalid("FOLLOW_UP_FIELD_MISSING");
  const eventKey=`manual:${requestId}`;
  const previous=await db.prepare("SELECT * FROM trade_follow_up_messages WHERE owner_uid=? AND event_key=?").bind(access.ownerUid,eventKey).first<Row>();
  if (previous) {
    if (previous.actor_uid!==access.actorUid || previous.work_order_id!==workOrderId || previous.template_id!==templateId
      || previous.subject!==checked.subject || previous.body!==checked.body || previous.context_hash!==input.contextHash) invalid("EMAIL_REQUEST_CONFLICT");
    await services.recipient(access,workOrderId);
    return text(previous.id);
  }
  const draft=await previewFollowUp(db,services,access,workOrderId,templateId);
  if (draft.missing.length) invalid("FOLLOW_UP_FIELD_MISSING");
  if (draft.contextHash!==input.contextHash) invalid("FOLLOW_UP_CONTEXT_CHANGED");
  return insertMessage(db,access,workOrderId,draft,checked,eventKey,false);
}
async function insertMessage(db: D1Database, access: TeamAccess, workOrderId:string, draft: Awaited<ReturnType<typeof previewFollowUp>>, message: {subject:string;body:string}, eventKey:string, automatic:boolean, now=new Date()) {
  const id=crypto.randomUUID(), stamp=now.toISOString();
  const context:FrozenContext={templateKind:draft.template.kind,appointmentId:draft.context.appointmentId,invoiceId:draft.context.invoiceId,settingsRevision:draft.config.revision,pastAppointment:draft.pastAppointment};
  await db.prepare(`INSERT OR IGNORE INTO trade_follow_up_messages (id,owner_uid,actor_uid,work_order_id,template_id,event_key,automatic,context_hash,context_json,
    recipient,subject,body,next_attempt_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id,access.ownerUid,access.actorUid,workOrderId,draft.template.id,eventKey,automatic?1:0,draft.contextHash,JSON.stringify(context),
      draft.recipient,message.subject,message.body,stamp,stamp,stamp).run();
  const saved=await db.prepare("SELECT * FROM trade_follow_up_messages WHERE owner_uid=? AND event_key=?").bind(access.ownerUid,eventKey).first<Row>();
  if (!saved) invalid("FOLLOW_UP_QUEUE_FAILED");
  if (!automatic && (saved.actor_uid!==access.actorUid || saved.work_order_id!==workOrderId || saved.template_id!==draft.template.id
    || saved.subject!==message.subject || saved.body!==message.body || saved.context_hash!==draft.contextHash)) invalid("EMAIL_REQUEST_CONFLICT");
  return text(saved.id);
}

export async function deliverFollowUp(db: D1Database, services: FollowUpServices, id:string, access?:TeamAccess, now=new Date()) {
  let row=await db.prepare("SELECT * FROM trade_follow_up_messages WHERE id=?").bind(id).first<Row>();
  if (!row || (access && row.owner_uid!==access.ownerUid)) invalid("EMAIL_ACCESS_REQUIRED");
  if (["accepted","uncertain","cancelled"].includes(text(row.status))) return text(row.status);
  if (row.status==="sending") return "uncertain";
  if (text(row.next_attempt_at)>now.toISOString()) return "failed";
  const lease=crypto.randomUUID(), stamp=now.toISOString();
  const claim=await db.prepare(`UPDATE trade_follow_up_messages SET status='sending',lease_token=?,lease_expires_at=?,attempts=attempts+1,updated_at=?
    WHERE id=? AND status IN ('queued','failed') AND next_attempt_at<=?`).bind(lease,new Date(now.getTime()+120000).toISOString(),stamp,id,stamp).run();
  if (!claim.meta.changes) return "uncertain";
  row={...row,lease_token:lease};
  let result="failed", message="";
  let transportStarted=false;
  try {
    const frozen:FrozenContext=JSON.parse(text(row.context_json));
    const currentAccess=access || await services.ownerAccess(text(row.owner_uid));
    const validate=async () => {
      const config=await followUpConfiguration(db,text(row.owner_uid));
      if (row.automatic && (config.revision!==frozen.settingsRevision || !(frozen.templateKind==="invoice"?config.settings.invoiceEnabled:config.settings.appointmentEnabled))) invalid("FOLLOW_UP_DISABLED");
      const current=await followUpContext(db,services,currentAccess,text(row.work_order_id),frozen.templateKind,{appointmentId:frozen.appointmentId,now,automatic:Boolean(row.automatic),pastAppointment:frozen.pastAppointment});
      if (current.hash!==row.context_hash || current.recipient!==row.recipient) invalid("FOLLOW_UP_CONTEXT_CHANGED");
    };
    await validate();
    transportStarted=true;
    await services.send(text(row.owner_uid),text(row.actor_uid),{recipient:text(row.recipient),subject:text(row.subject),body:text(row.body),idempotencyKey:`follow-up:${id}`},validate);
    result="accepted";
  } catch(error) {
    const journal=await db.prepare("SELECT status FROM trade_email_submissions WHERE owner_uid=? AND request_key=?").bind(row.owner_uid,`follow-up:${id}`).first<{status:string}>();
    if (journal?.status==="accepted") result="accepted";
    else if (journal?.status==="sending" || journal?.status==="uncertain" || (transportStarted && !journal)) {result="uncertain";message="Check Sent mail before sending another copy.";}
    else if (error instanceof Error && ["FOLLOW_UP_CONTEXT_CHANGED","FOLLOW_UP_DISABLED","EMAIL_RECIPIENT_UNAVAILABLE","FOLLOW_UP_OPTED_OUT","EMAIL_ACCESS_REQUIRED"].includes(error.message)) {result="cancelled";message="Stopped because the booking, balance, access or business settings changed.";}
    else message="Email was not sent. Check your business email connection and try again.";
  }
  const attempts=Number(row.attempts)+1;
  await db.prepare(`UPDATE trade_follow_up_messages SET status=?,error=?,next_attempt_at=?,lease_token='',lease_expires_at='',updated_at=? WHERE id=? AND lease_token=?`)
    .bind(result,message,result==="failed" && attempts<3?new Date(now.getTime()+300000).toISOString():"",iso(),id,lease).run();
  return result;
}

/** One event per invoice or appointment time, shared by the business. No per-job rules. */
export async function scanAutomaticFollowUps(db:D1Database, services:FollowUpServices, now=new Date()) {
  const owners=await db.prepare(`SELECT owner_uid FROM trade_follow_up_settings WHERE next_scan_at<=?
    AND (json_extract(settings_json,'$.invoiceEnabled')=1 OR json_extract(settings_json,'$.appointmentEnabled')=1)
    ORDER BY next_scan_at,owner_uid LIMIT 3`).bind(now.toISOString()).all<{owner_uid:string}>();
  for (const owner of owners.results) {
    // A bounded fair scan prevents a disconnected business blocking other businesses.
    await db.prepare("UPDATE trade_follow_up_settings SET next_scan_at=? WHERE owner_uid=?")
      .bind(new Date(now.getTime()+300000).toISOString(),owner.owner_uid).run();
    let access:TeamAccess;
    try { access=await services.ownerAccess(owner.owner_uid); } catch { continue; }
    const config=await followUpConfiguration(db,owner.owner_uid);
    const from=new Date(now.getTime()-43*86400000).toISOString().slice(0,10);
    const to=new Date(now.getTime()+43*86400000).toISOString().slice(0,10);
    const candidates=await db.prepare(`WITH candidates AS (SELECT id,work_order_id,'invoice' kind,'invoice:'||id event_key,'' starts_at FROM trade_crm_accepted_invoices
      WHERE firebase_uid=? AND status='issued' AND ?=1 AND due_at>=? AND due_at<?
      UNION ALL SELECT id,work_order_id,'invoice','invoice:'||id,'' FROM trade_crm_quick_invoices
      WHERE firebase_uid=? AND status IN ('issued','part_credited') AND ?=1 AND due_at>=? AND due_at<?
      UNION ALL SELECT id,work_order_id,'appointment','appointment:'||id||':'||starts_at,starts_at FROM trade_crm_appointments
      WHERE firebase_uid=? AND status IN ('scheduled','completed') AND ?=1 AND starts_at>? AND starts_at<?)
      SELECT * FROM candidates c WHERE c.event_key>? AND NOT EXISTS
        (SELECT 1 FROM trade_follow_up_messages m WHERE m.owner_uid=? AND m.event_key=c.event_key)
      ORDER BY c.event_key LIMIT 20`)
      .bind(owner.owner_uid,config.settings.invoiceEnabled?1:0,from,to,
        owner.owner_uid,config.settings.invoiceEnabled?1:0,from,to,
        owner.owner_uid,config.settings.appointmentEnabled?1:0,from,to,
        config.scanCursor,owner.owner_uid).all<{id:string;work_order_id:string;kind:string;event_key:string;starts_at:string}>();
    let queued=0;
    let cursor="";
    for (const candidate of candidates.results) {
      if (queued>=8) break;
      cursor=candidate.event_key;
      if (await db.prepare("SELECT 1 FROM trade_follow_up_messages WHERE owner_uid=? AND event_key=?").bind(owner.owner_uid,candidate.event_key).first()) continue;
      const invoice=candidate.kind==="invoice";
      try {
        const draft=await previewFollowUp(db,services,access,candidate.work_order_id,
          invoice?config.settings.invoiceTemplateId:config.settings.appointmentTemplateId,{now,automatic:true,appointmentId:invoice?undefined:candidate.id});
        if (draft.missing.length) continue;
        let eventTime:number, enabledAt:string, offset:number;
        if (invoice) {
          if (draft.context.invoiceId!==candidate.id) continue;
          // A date-only invoice uses 9 am at the service site for predictable reminder timing.
          eventTime=followUpAppointmentEpoch(`${draft.context.invoiceDue}T09:00:00`,draft.context.timeZone);
          offset=followUpTimingHours(config.settings.invoiceTiming);
          enabledAt=config.invoiceEnabledAt;
        } else {
          eventTime=draft.context.appointmentEpoch || NaN;
          offset=followUpTimingHours(config.settings.appointmentTiming);
          enabledAt=config.appointmentEnabledAt;
        }
        const trigger=eventTime+offset*3600000;
        if (!Number.isFinite(trigger) || trigger>now.getTime() || trigger<Date.parse(enabledAt)
          || (offset<0 && eventTime<=now.getTime())) continue;
        // A manual reminder for the same live context already satisfies this event.
        const manual=await db.prepare(`SELECT 1 FROM trade_follow_up_messages WHERE owner_uid=? AND work_order_id=? AND automatic=0
          AND context_hash=? AND status IN ('queued','sending','accepted','uncertain') LIMIT 1`)
          .bind(owner.owner_uid,candidate.work_order_id,draft.contextHash).first();
        if (manual) continue;
        await insertMessage(db,access,candidate.work_order_id,draft,draft,candidate.event_key,true,now); queued++;
      } catch (error) {
        if (!(error instanceof Error) || !["EMAIL_RECIPIENT_UNAVAILABLE","EMAIL_ACCESS_REQUIRED","FOLLOW_UP_OPTED_OUT","FOLLOW_UP_TEMPLATE_UNAVAILABLE"].includes(error.message)) throw error;
      }
    }
    const more=candidates.results.length===20 || queued>=8;
    await db.prepare("UPDATE trade_follow_up_settings SET scan_cursor=? WHERE owner_uid=? AND revision=?")
      .bind(more?cursor:"",owner.owner_uid,config.revision).run();
  }
}
export async function drainFollowUps(db:D1Database, services:FollowUpServices, now=new Date()) {
  const interrupted=await db.prepare("SELECT id,owner_uid FROM trade_follow_up_messages WHERE status='sending' AND lease_expires_at<=? LIMIT 25").bind(now.toISOString()).all<{id:string;owner_uid:string}>();
  for (const row of interrupted.results) {
    const journal=await db.prepare("SELECT status FROM trade_email_submissions WHERE owner_uid=? AND request_key=?").bind(row.owner_uid,`follow-up:${row.id}`).first<{status:string}>();
    const state=journal?.status==="accepted"?"accepted":journal?.status==="sending"||journal?.status==="uncertain"?"uncertain":"failed";
    await db.prepare("UPDATE trade_follow_up_messages SET status=?,error=?,lease_token='',lease_expires_at='',updated_at=? WHERE id=? AND status='sending' AND lease_expires_at<=?")
      .bind(state,state==="uncertain"?"Check Sent mail before sending another copy.":"",now.toISOString(),row.id,now.toISOString()).run();
  }
  const due=await db.prepare(`SELECT id FROM trade_follow_up_messages WHERE automatic=1 AND status IN ('queued','failed') AND next_attempt_at<>''
    AND next_attempt_at<=? AND attempts<3 ORDER BY next_attempt_at LIMIT 20`).bind(now.toISOString()).all<{id:string}>();
  for (const row of due.results) await deliverFollowUp(db,services,row.id,undefined,now);
}
