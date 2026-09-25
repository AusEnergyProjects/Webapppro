import { createHash } from "node:crypto";
import { ensureCreditexJobLifecycleSchemaGuards } from "./creditex-job-lifecycle-schema-guards";
import type { TeamAccess } from "./trade-team-server";
import { jobSyncChangeStatements } from "./trade-team-sync-server";
import { creditexIntentCompletionSnapshotSql, creditexIntentSubmissionSnapshotSql, creditexJobEverCompletedSql } from "./creditex-job-lifecycle-sql";
import { sendServiceReminderProviderMessage, reminderProviderFailureOutcome } from "./service-reminder-delivery";
import { prepareCreditexCorrectionWorkPackStatements } from "./creditex-activity-work-pack-server";
import { prepareFieldCorrectionStatements } from "./trade-activity-forms-server";
import { cancelledJobAppointmentsStatement,reconcileCancelledJobCalendars } from "./trade-job-cancellation-server";

export type JobLifecycleActor =
  | { kind: "trade"; uid: string; access: TeamAccess }
  | { kind: "compliance" | "admin"; uid: string; organisationId: string; role: string };
type Input = Readonly<Record<string, unknown>>;
type ContextRow = { intent_id: string; intent_status: string; organisation_id: string; work_order_id: string; owner_uid: string;
  business_name: string; work_number:string; title:string; stage: string; record_status: string; revision: number; assignee_member_id: string;
  completion_snapshot: string; submission_snapshot: string; ever_completed: number };
type LifecycleEvent = { id: string; action: string; source_snapshot: string; reference: string; amount_minor: number;
  recipient_uid: string; occurred_at: string; actor_uid: string; note: string; created_at: string; request_sha256: string };

export class JobLifecycleError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, message: string, status = 409) { super(message); this.code = code; this.status = status; }
}
const fail = (code: string, message: string, status = 409): never => { throw new JobLifecycleError(code, message, status); };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const clean = (value: unknown, label: string, max = 240) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) return fail("JOB_LIFECYCLE_INPUT", `Enter ${label}.`, 400);
  return value.trim();
};

async function context(db: D1Database, actor: JobLifecycleActor, intentId: string) {
  await ensureCreditexJobLifecycleSchemaGuards(db);
  const row = await db.prepare(`SELECT intent.id intent_id, intent.status intent_status,
      intent.compliance_organisation_id organisation_id, work.id work_order_id, work.firebase_uid owner_uid,
      COALESCE(account.business_name,'Trade business') business_name, work.work_number,work.title,work.stage,work.record_status,
      work.revision,work.assignee_member_id, ${creditexIntentCompletionSnapshotSql()} completion_snapshot,
      ${creditexIntentSubmissionSnapshotSql()} submission_snapshot, ${creditexJobEverCompletedSql()} ever_completed
    FROM trade_work_order_compliance_intents intent JOIN trade_work_orders work
      ON work.id=intent.work_order_id AND work.firebase_uid=intent.installer_uid AND work.partner_type='installer'
    LEFT JOIN trade_accounts account ON account.firebase_uid=work.firebase_uid
    WHERE intent.id=? AND ${actor.kind === "trade" ? "work.firebase_uid=?" : "intent.compliance_organisation_id=?"}`)
    .bind(intentId, actor.kind === "trade" ? actor.access.ownerUid : actor.organisationId).first<ContextRow>();
  if (!row) return fail("JOB_LIFECYCLE_NOT_FOUND", "This activity is not available in your workspace.", 404);
  if (actor.kind === "trade" && (!actor.access.isOwner && (actor.access.jobScope !== "team" && row.assignee_member_id !== actor.access.memberId))) {
    return fail("JOB_LIFECYCLE_NOT_FOUND", "This activity is not assigned to your team access.", 404);
  }
  return row;
}

function completed(snapshot: string) {
  const source = JSON.parse(snapshot) as { records: Array<{ kind: string; status: string; sha256?: string; objectKey?: string; finals?: unknown[] }> };
  return source.records.length > 0 && source.records.every(r => r.kind === "field"
    ? r.status === "submitted_for_creditex_review" && Boolean(r.objectKey) && r.sha256?.length === 64
    : r.status === "completed" && Boolean(r.finals?.length));
}

function payoutStatusGuardSql(snapshot:string,organisation:string) {
  return `json_array_length(${snapshot})>0 AND NOT EXISTS (SELECT 1 FROM json_each(${snapshot}) item
    WHERE NOT EXISTS(SELECT 1 FROM compliance_output_action_events e WHERE e.organisation_id=${organisation}
      AND e.packet_id=json_extract(item.value,'$.id') AND e.to_status='submitted')
    OR COALESCE((SELECT e.to_status FROM compliance_output_action_events e WHERE e.organisation_id=${organisation}
      AND e.packet_id=json_extract(item.value,'$.id') ORDER BY e.sequence DESC LIMIT 1),'') IN ('rejected','reconciliation_required')
    OR COALESCE((SELECT r.registry_status FROM creditex_registry_results r
      LEFT JOIN creditex_registry_result_reviews review ON review.organisation_id=r.organisation_id AND review.result_id=r.id
      WHERE r.organisation_id=${organisation} AND r.packet_id=json_extract(item.value,'$.id')
        AND (review.decision='approved' OR r.source='rec_public_register')
      ORDER BY r.occurred_at DESC,r.created_at DESC,r.id DESC LIMIT 1),'')='rejected')`;
}

async function submitted(db: D1Database, row: ContextRow) {
  const packets = JSON.parse(row.submission_snapshot) as Array<{ id: string }>;
  if (!packets.length) return false;
  const result = await db.prepare(`SELECT COUNT(*) count FROM json_each(?) item
    WHERE EXISTS (SELECT 1 FROM compliance_output_action_events e WHERE e.organisation_id=?
      AND e.packet_id=json_extract(item.value,'$.id') AND e.to_status='submitted')
      AND COALESCE((SELECT e.to_status FROM compliance_output_action_events e
        WHERE e.organisation_id=? AND e.packet_id=json_extract(item.value,'$.id') ORDER BY e.sequence DESC LIMIT 1),'')
        NOT IN ('rejected','reconciliation_required')
      AND COALESCE((SELECT result.registry_status FROM creditex_registry_results result
        LEFT JOIN creditex_registry_result_reviews review ON review.organisation_id=result.organisation_id AND review.result_id=result.id
        WHERE result.organisation_id=? AND result.packet_id=json_extract(item.value,'$.id')
          AND (review.decision='approved' OR result.source='rec_public_register')
        ORDER BY result.occurred_at DESC,result.created_at DESC,result.id DESC LIMIT 1),'')<>'rejected'`)
    .bind(row.submission_snapshot,row.organisation_id,row.organisation_id,row.organisation_id).first<{count:number}>();
  return Number(result?.count) === packets.length;
}

function permissions(actor: JobLifecycleActor) {
  if (actor.kind === "trade") {
    const manager = !actor.access.fieldSessionId && (actor.access.isOwner || (actor.access.canManageJobs && actor.access.canManageFieldEvidence&&actor.access.canViewFieldEvidence));
    return { review: manager, correction:manager, payout: false, cancel: manager, bin: false };
  }
  return { review: false, correction:["owner","admin","case_manager","reviewer","auditor"].includes(actor.role), payout: ["owner","admin"].includes(actor.role),
    cancel: ["owner","admin","case_manager"].includes(actor.role), bin: ["owner","admin","case_manager"].includes(actor.role) };
}

export async function loadJobLifecycle(db: D1Database, actor: JobLifecycleActor, intentId: string) {
  const row = await context(db,actor,clean(intentId,"an activity"));
  const events = await db.prepare(`SELECT id,action,source_snapshot,reference,amount_minor,recipient_uid,occurred_at,actor_uid,note,created_at,request_sha256
    FROM creditex_job_lifecycle_events WHERE organisation_id=? AND work_order_id=? AND owner_uid=?
      AND (intent_id=? OR intent_id='') ORDER BY created_at DESC,id DESC LIMIT 100`)
    .bind(row.organisation_id,row.work_order_id,row.owner_uid,row.intent_id).all<LifecycleEvent>();
  const access = permissions(actor), active = row.record_status === "active" && row.stage !== "cancelled"
    && ["planned","case_linked"].includes(row.intent_status);
  const latestReview = events.results.find(e=>["reviewed","correction_required"].includes(e.action));
  const reviewed = latestReview?.action==="reviewed"&&latestReview.source_snapshot===row.completion_snapshot;
  const paid = events.results.some(e=>e.action==="payout_recorded"&&e.source_snapshot===row.submission_snapshot&&e.recipient_uid===row.owner_uid);
  const correctionRows=access.correction&&["planned","case_linked"].includes(row.intent_status)?await jobReviewRows(db,actor,row.work_order_id):[];
  const notifications=await db.prepare(`SELECT id,status,recipient_email,last_error FROM creditex_job_correction_deliveries d
    WHERE d.work_order_id=? AND d.owner_uid=? AND EXISTS(SELECT 1 FROM creditex_job_lifecycle_events e WHERE e.id=d.event_id AND e.organisation_id=?)
    ORDER BY d.created_at DESC,d.id DESC LIMIT 3`).bind(row.work_order_id,row.owner_uid,row.organisation_id)
    .all<{id:string;status:string;recipient_email:string;last_error:string}>();
  return { intentId: row.intent_id, workOrderId:row.work_order_id, revision:row.revision,
    recipient:row.business_name, recordStatus:row.record_status, stage:row.stage,
    completionSha256:hash(row.completion_snapshot), correctionSourceSha256:hash(reviewIdentity(correctionRows)), reviewed, paid,
    capabilities:{ canReview:access.review&&active&&completed(row.completion_snapshot)&&!reviewed,
      canRecordPayout:access.payout&&active&&!paid&&await submitted(db,row),
      canCancel:access.cancel&&active&&!row.ever_completed,
      canRequestCorrection:access.correction&&active&&correctionRows.length>0&&correctionRows.every(r=>completed(r.completion_snapshot))&&!await everLodged(db,correctionRows),
      canDelete:access.bin&&row.record_status==="active", canRestore:access.bin&&row.record_status==="archived" },
    notifications:notifications.results.map(d=>({id:d.id,status:d.status,recipient:d.recipient_email,error:d.last_error})),
    history:events.results.map(e=>({id:e.id,action:e.action,reference:e.reference,amountMinor:e.amount_minor,
      occurredAt:e.occurred_at,note:e.note,actorUid:e.actor_uid})),
  };
}

/** Records a completed business action only. This never transfers funds or lodges certificates. */
export async function mutateJobLifecycle(db:D1Database,actor:JobLifecycleActor,input:Input,options:{now?:()=>string}={}) {
  if(input.action==="correction_required") {
    const row=await context(db,actor,clean(input.intentId,"an activity"));
    await reviewTradeJob(db,actor,{...input,workOrderId:row.work_order_id,expectedSourceSha256:input.expectedCorrectionSourceSha256},options);
    return loadJobLifecycle(db,actor,row.intent_id);
  }
  if(input.action==="retry_notification") {
    const row=await context(db,actor,clean(input.intentId,"an activity"));
    await dispatchJobCorrectionEmail(db,actor,clean(input.deliveryId,"a notification"),{...options,expectedWorkOrderId:row.work_order_id});
    return loadJobLifecycle(db,actor,row.intent_id);
  }
  const intentId=clean(input.intentId,"an activity"),action=clean(input.action,"an action"),requestId=clean(input.requestId,"a request identifier",100);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) return fail("JOB_LIFECYCLE_INPUT","Use a valid request identifier.",400);
  const note=clean(input.note,"a short action note",2000), now=options.now?.()||new Date().toISOString();
  const requestHash=hash(JSON.stringify([intentId,action,input.expectedRevision,input.expectedCompletionSha256||"",input.reference||"",input.amount||"",input.paidOn||"",note]));
  const previous=await db.prepare(`SELECT request_sha256 FROM creditex_job_lifecycle_events WHERE actor_kind=? AND actor_uid=? AND request_id=?`)
    .bind(actor.kind,actor.uid,requestId).first<{request_sha256:string}>();
  if(previous){ if(previous.request_sha256!==requestHash) return fail("JOB_LIFECYCLE_REQUEST_CHANGED","This request already records a different action."); return loadJobLifecycle(db,actor,intentId); }
  const row=await context(db,actor,intentId),p=permissions(actor);
  const allowed=action==="reviewed"?p.review:action==="payout_recorded"?p.payout:action==="cancelled"?p.cancel:["deleted","restored"].includes(action)&&p.bin;
  if(!allowed) return fail("JOB_LIFECYCLE_PERMISSION","Your role cannot perform this job action.",403);
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==row.revision) return fail("JOB_LIFECYCLE_CHANGED","The job changed. Refresh before continuing.");
  if(action==="restored" ? row.record_status!=="archived" : row.record_status!=="active") return fail("JOB_LIFECYCLE_CHANGED","The job visibility changed. Refresh before continuing.");
  if(!["deleted","restored"].includes(action)&&(row.stage==="cancelled"||!["planned","case_linked"].includes(row.intent_status))) return fail("JOB_LIFECYCLE_INACTIVE","This activity is no longer active.");
  let snapshot="{}",reference="",amount=0,occurredAt=now,recipient="",predicate="1=1"; const extra:unknown[]=[];
  if(action==="reviewed") {
    if(!completed(row.completion_snapshot)) return fail("JOB_REVIEW_INCOMPLETE","Finish this activity and its signed forms before business review.");
    if(input.expectedCompletionSha256!==hash(row.completion_snapshot)) return fail("JOB_REVIEW_SOURCE_CHANGED","The completed forms changed. Open the current report before reviewing.");
    snapshot=row.completion_snapshot;
    predicate=`EXISTS (SELECT 1 FROM trade_work_order_compliance_intents intent WHERE intent.id=? AND ${creditexIntentCompletionSnapshotSql()}=?)`;
    extra.push(row.intent_id,snapshot);
  }
  if(action==="payout_recorded") {
    if(!await submitted(db,row)) return fail("JOB_PAYOUT_SUBMISSION_REQUIRED","Record actual lodgement for every current claim before recording this payout.");
    reference=clean(input.reference,"the actual payout reference",180);
    const amountText=clean(input.amount,"the actual AUD payout amount",20);
    if(!/^\d{1,9}(?:\.\d{1,2})?$/.test(amountText)) return fail("JOB_PAYOUT_AMOUNT","Enter a positive AUD amount with up to two decimal places.",400);
    const [whole,fraction=""]=amountText.split('.'); amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
    if(!Number.isSafeInteger(amount)||amount<=0) return fail("JOB_PAYOUT_AMOUNT","Enter a positive payout amount.",400);
    const paidOn=clean(input.paidOn,"the payout date",10);
    const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Sydney",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(now));
    if(!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)||!Number.isFinite(Date.parse(paidOn))||new Date(paidOn).toISOString().slice(0,10)!==paidOn||paidOn>today) return fail("JOB_PAYOUT_DATE","Enter an actual payout date that is not in the future.",400);
    occurredAt=`${paidOn}T00:00:00.000Z`;recipient=row.owner_uid;snapshot=row.submission_snapshot;
    predicate=`EXISTS (SELECT 1 FROM trade_work_order_compliance_intents intent WHERE intent.id=? AND ${creditexIntentSubmissionSnapshotSql()}=?
      AND ${payoutStatusGuardSql(creditexIntentSubmissionSnapshotSql(),"intent.compliance_organisation_id")})`;
    extra.push(row.intent_id,snapshot);
  }
  if(action==="cancelled") {
    if(row.ever_completed) return fail("JOB_CANCEL_COMPLETED","A completed job cannot be cancelled. Use the recoverable bin if it must leave the active list.");
    predicate=`NOT ${creditexJobEverCompletedSql("trade_work_orders")}`;
  }
  const id=crypto.randomUUID(),nextRevision=row.revision+1;
  const status=action==="deleted"?"archived":action==="restored"?"active":row.record_status;
  const stage=action==="cancelled"?"cancelled":row.stage;
  const statements=[db.prepare(`UPDATE trade_work_orders SET record_status=?,stage=?,revision=revision+1,updated_at=?,
    scheduled_start=CASE WHEN ?='cancelled' THEN '' ELSE scheduled_start END,
    scheduled_end=CASE WHEN ?='cancelled' THEN '' ELSE scheduled_end END
    WHERE id=? AND firebase_uid=? AND revision=? AND record_status=? AND stage=? AND (${predicate})`)
    .bind(status,stage,now,action,action,row.work_order_id,row.owner_uid,row.revision,row.record_status,row.stage,...extra),
    db.prepare(`INSERT INTO trade_work_order_events(id,work_order_id,firebase_uid,event_type,summary,created_at)
      VALUES(?,?,?,'lifecycle_action',CASE WHEN changes()=1 THEN ? ELSE NULL END,?)`)
      .bind(crypto.randomUUID(),row.work_order_id,row.owner_uid,`${action}: ${note}`,now),
    db.prepare(`INSERT INTO creditex_job_lifecycle_events(id,organisation_id,work_order_id,owner_uid,intent_id,action,
      source_snapshot,source_sha256,reference,amount_minor,recipient_uid,occurred_at,actor_kind,actor_uid,note,request_id,request_sha256,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,row.organisation_id,row.work_order_id,row.owner_uid,
        ["reviewed","payout_recorded"].includes(action)?row.intent_id:"",action,snapshot,hash(snapshot),reference,amount,recipient,occurredAt,actor.kind,actor.uid,note,requestId,requestHash,now),
    ...jobSyncChangeStatements(db,{ownerUid:row.owner_uid,workOrderId:row.work_order_id,revision:nextRevision,changedAt:now,
      audienceMemberId:row.assignee_member_id,operation:action==="deleted"?"delete":"upsert"})];
  if(action==="cancelled")statements.push(cancelledJobAppointmentsStatement(db,row.owner_uid,row.work_order_id,now));
  try {await db.batch(statements);} catch(error) {
    const message=error instanceof Error?error.message:String(error);
    if(message.includes("UNIQUE constraint failed")||message.includes("trade_work_order_events.summary")) return fail("JOB_LIFECYCLE_CHANGED","This action was already recorded or the job changed. Refresh to see its retained history.");
    throw error;
  }
  const calendarSync=action==="cancelled"?await reconcileCancelledJobCalendars(db,row.owner_uid,row.work_order_id):undefined;
  return {...await loadJobLifecycle(db,actor,intentId),...(calendarSync?{calendarSync}:{})};
}

type Delivery = {id:string;event_id:string;recipient_email:string;subject:string;body:string;status:string;provider_reference:string;
  last_error:string;attempts:number;first_attempt_at:string;last_attempt_at:string};

async function jobReviewRows(db:D1Database,actor:JobLifecycleActor,workOrderId:string) {
  if(!permissions(actor).correction) return fail("JOB_REVIEW_PERMISSION","Authorised review access is required.",403);
  const intents=await db.prepare(`SELECT intent.id FROM trade_work_order_compliance_intents intent
    JOIN trade_work_orders work ON work.id=intent.work_order_id AND work.firebase_uid=intent.installer_uid
    WHERE work.id=? AND ${actor.kind==="trade"?"work.firebase_uid=?":"intent.compliance_organisation_id=?"} AND intent.status IN ('planned','case_linked') ORDER BY intent.id`)
    .bind(workOrderId,actor.kind==="trade"?actor.access.ownerUid:actor.organisationId).all<{id:string}>();
  if(!intents.results.length) return fail("JOB_REVIEW_NOT_FOUND","No active certificate activities are available for this job.",404);
  return Promise.all(intents.results.map(i=>context(db,actor,i.id)));
}

function reviewIdentity(rows:ContextRow[]) {return JSON.stringify(rows.map(r=>({intentId:r.intent_id,source:r.completion_snapshot})));}

function jobLodgementGuardSql(workOrder:string,owner:string) {
  return `EXISTS (SELECT 1 FROM compliance_output_action_packets p JOIN compliance_cases c
    ON c.id=p.compliance_case_id AND c.organisation_id=p.organisation_id
    WHERE c.work_order_id=${workOrder} AND c.installer_uid=${owner} AND (
      EXISTS(SELECT 1 FROM compliance_output_action_events e WHERE e.packet_id=p.id AND e.organisation_id=p.organisation_id
        AND (e.to_status='submitted' OR (e.to_status='reconciliation_required' AND e.sequence=(
          SELECT MAX(latest.sequence) FROM compliance_output_action_events latest WHERE latest.packet_id=p.id AND latest.organisation_id=p.organisation_id))))
      OR EXISTS(SELECT 1 FROM compliance_output_dispatch_intents dispatch WHERE dispatch.packet_id=p.id AND dispatch.organisation_id=p.organisation_id
        AND dispatch.status IN ('dispatching','reserved','uncertain'))))`;
}

async function everLodged(db:D1Database,rows:ContextRow[]) {
  const result=await db.prepare(`SELECT ${jobLodgementGuardSql("?","?")} found`)
    .bind(rows[0].work_order_id,rows[0].owner_uid).first<{found:number}>();
  return Boolean(result?.found);
}

export async function loadTradeJobReview(db:D1Database,actor:JobLifecycleActor,workOrderId:string) {
  const rows=await jobReviewRows(db,actor,clean(workOrderId,"a job"));
  const reviews=await Promise.all(rows.map(row=>loadJobLifecycle(db,actor,row.intent_id)));
  const deliveries=await db.prepare(`SELECT id,status,provider_reference,last_error,recipient_email FROM creditex_job_correction_deliveries
    WHERE work_order_id=? AND owner_uid=? ORDER BY created_at DESC,id DESC LIMIT 5`).bind(workOrderId,rows[0].owner_uid)
    .all<{id:string;status:string;provider_reference:string;last_error:string;recipient_email:string}>();
  const lodged=await everLodged(db,rows), allComplete=rows.every(r=>completed(r.completion_snapshot));
  const active=rows.every(r=>r.record_status==="active"&&r.stage!=="cancelled");
  return {workOrderId,revision:rows[0].revision,sourceSha256:hash(reviewIdentity(rows)),
    canReview:active&&allComplete&&!lodged,reviewed:reviews.every(r=>r.reviewed),
    reason:!active?"Restore an active job before review.":lodged?"Submission has started or needs reconciliation. Resolve it before changing this review.":!allComplete?"The technician must complete all activity forms before review.":"",
    activities:rows.map((r,index)=>({intentId:r.intent_id,complete:completed(r.completion_snapshot),reviewed:reviews[index].reviewed,
      records:(JSON.parse(r.completion_snapshot) as {records:Array<{kind:string;id:string}>}).records})),
    history:reviews.flatMap(r=>r.history).filter((event,index,all)=>all.findIndex(e=>e.id===event.id)===index),
    notifications:deliveries.results.map(d=>({id:d.id,status:d.status,recipient:d.recipient_email,error:d.last_error,reference:d.provider_reference})),
  };
}

/** Durable send claim. Retrying a possibly accepted request always retains its provider idempotency key. */
export async function dispatchJobCorrectionEmail(db:D1Database,actor:JobLifecycleActor,deliveryId:string,
  options:{now?:()=>string;send?:typeof sendServiceReminderProviderMessage;expectedWorkOrderId?:string}={}) {
  if(!permissions(actor).correction) return fail("JOB_REVIEW_PERMISSION","Review access is required.",403);
  await ensureCreditexJobLifecycleSchemaGuards(db);
  const delivery=await db.prepare(`SELECT d.* FROM creditex_job_correction_deliveries d
    JOIN creditex_job_lifecycle_events e ON e.id=d.event_id WHERE d.id=?
    AND ${actor.kind==="trade"?"d.owner_uid=?":"e.organisation_id=?"}`)
    .bind(clean(deliveryId,"a notification"),actor.kind==="trade"?actor.access.ownerUid:actor.organisationId).first<Delivery & {owner_uid:string;work_order_id:string}>();
  if(!delivery) return fail("JOB_NOTIFICATION_NOT_FOUND","This notification is not available.",404);
  if(options.expectedWorkOrderId&&options.expectedWorkOrderId!==delivery.work_order_id)
    return fail("JOB_NOTIFICATION_NOT_FOUND","This notification does not belong to the selected job.",404);
  await jobReviewRows(db,actor,delivery.work_order_id);
  const now=options.now?.()||new Date().toISOString();
  if(delivery.status==="accepted") return;
  if(delivery.first_attempt_at && ["sending","uncertain"].includes(delivery.status)
    && Date.parse(now)-Date.parse(delivery.first_attempt_at)>23*60*60*1000)
    return fail("JOB_NOTIFICATION_RECONCILIATION","The provider result needs checking before this notification can be retried.");
  const claimed=await db.prepare(`UPDATE creditex_job_correction_deliveries SET status='sending',attempts=attempts+1,
    first_attempt_at=CASE WHEN first_attempt_at='' THEN ? ELSE first_attempt_at END,last_attempt_at=?,updated_at=?
    WHERE id=? AND owner_uid=? AND (status IN ('pending','failed','uncertain') OR (status='sending' AND last_attempt_at<?))`)
    .bind(now,now,now,delivery.id,delivery.owner_uid,new Date(Date.parse(now)-90000).toISOString()).run();
  if(!claimed.meta.changes) return;
  try {
    const sent=await (options.send||sendServiceReminderProviderMessage)({channel:"email",recipient:delivery.recipient_email,
      subject:delivery.subject,body:delivery.body,idempotencyKey:`job-correction-${delivery.id}`,callbackUrl:"",messageType:"job_correction"});
    await db.prepare(`UPDATE creditex_job_correction_deliveries SET status='accepted',provider_reference=?,last_error='',updated_at=?
      WHERE id=? AND owner_uid=? AND status='sending' AND last_attempt_at=?`).bind(sent.providerMessageId,now,delivery.id,delivery.owner_uid,now).run();
  } catch(error) {
    const uncertain=reminderProviderFailureOutcome(error)==="indeterminate";
    await db.prepare(`UPDATE creditex_job_correction_deliveries SET status=?,last_error=?,updated_at=?
      WHERE id=? AND owner_uid=? AND status='sending' AND last_attempt_at=?`)
      .bind(uncertain?"uncertain":"failed",uncertain?"Email acceptance could not be confirmed. Retry safely using the same notification.":"Email was not accepted. Check email configuration and retry.",now,delivery.id,delivery.owner_uid,now).run();
  }
}

/** One business decision binds every current activity source in the job, or none of them. */
export async function reviewTradeJob(db:D1Database,actor:JobLifecycleActor,input:Input,
  options:{now?:()=>string;send?:typeof sendServiceReminderProviderMessage}={}) {
  const workOrderId=clean(input.workOrderId,"a job"),action=clean(input.action,"a review outcome");
  if(!["reviewed","correction_required"].includes(action)) return fail("JOB_REVIEW_INPUT","Choose Pass or Correction required.",400);
  if(action==="reviewed"&&!permissions(actor).review) return fail("JOB_REVIEW_PERMISSION","Only the trade business can pass its internal review.",403);
  const requestId=clean(input.requestId,"a request identifier",100);
  if(!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) return fail("JOB_REVIEW_INPUT","Use a valid request identifier.",400);
  const note=action==="correction_required"?clean(input.note,"the correction notes",2000):String(input.note||"").trim().slice(0,2000)||"Business review passed.";
  const rows=await jobReviewRows(db,actor,workOrderId), row=rows[0],now=options.now?.()||new Date().toISOString();
  const requestHash=hash(JSON.stringify([workOrderId,action,input.expectedRevision,input.expectedSourceSha256,note]));
  const previous=await db.prepare(`SELECT id,request_sha256 FROM creditex_job_lifecycle_events WHERE actor_kind=? AND actor_uid=? AND request_id=?`)
    .bind(actor.kind,actor.uid,hash(`${requestId}:${row.intent_id}`)).first<{id:string;request_sha256:string}>();
  if(previous){if(previous.request_sha256!==requestHash) return fail("JOB_REVIEW_REQUEST_CHANGED","This request already records another review.");return loadTradeJobReview(db,actor,workOrderId);}
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==row.revision||input.expectedSourceSha256!==hash(reviewIdentity(rows)))
    return fail("JOB_REVIEW_SOURCE_CHANGED","The job or its files changed. Refresh and review the current files.");
  if(rows.some(r=>r.record_status!=="active"||r.stage==="cancelled"||!completed(r.completion_snapshot)))
    return fail("JOB_REVIEW_INCOMPLETE","Complete all activity forms before business review.");
  if(await everLodged(db,rows)) return fail("JOB_REVIEW_ALREADY_LODGED","Submission has started or needs reconciliation. Resolve it before changing this review.");
  const technician=action==="correction_required"?await db.prepare(`SELECT id,email,display_name FROM trade_team_members
    WHERE id=? AND owner_uid=? AND status='active'`).bind(row.assignee_member_id,row.owner_uid).first<{id:string;email:string;display_name:string}>():null;
  if(action==="correction_required"&&(!technician||!/^\S+@\S+\.\S+$/.test(technician.email)))
    return fail("JOB_CORRECTION_TECHNICIAN_REQUIRED","Assign an active technician with an email address so the correction can be returned to them.");
  const guards=rows.map(()=>`EXISTS (SELECT 1 FROM trade_work_order_compliance_intents intent WHERE intent.id=? AND intent.status IN ('planned','case_linked') AND ${creditexIntentCompletionSnapshotSql()}=?)`).join(" AND ");
  const statements=[db.prepare(`UPDATE trade_work_orders SET stage=?,revision=revision+1,updated_at=?
    WHERE id=? AND firebase_uid=? AND revision=? AND record_status='active' AND stage<>'cancelled'
      AND (SELECT COUNT(*) FROM trade_work_order_compliance_intents i WHERE i.work_order_id=trade_work_orders.id
        AND i.installer_uid=trade_work_orders.firebase_uid AND i.status IN ('planned','case_linked')
        ${actor.kind==="trade"?"":"AND i.compliance_organisation_id=?"})=? AND ${guards}
      AND NOT ${jobLodgementGuardSql("trade_work_orders.id","trade_work_orders.firebase_uid")}`)
      .bind(action==="correction_required"?"in_progress":row.stage,now,workOrderId,row.owner_uid,row.revision,...(actor.kind==="trade"?[]:[actor.organisationId]),rows.length,
        ...rows.flatMap(r=>[r.intent_id,r.completion_snapshot])),
    db.prepare(`INSERT INTO trade_work_order_events(id,work_order_id,firebase_uid,event_type,summary,created_at)
      VALUES(?,?,?,'business_review',CASE WHEN changes()=1 THEN ? ELSE NULL END,?)`)
      .bind(crypto.randomUUID(),workOrderId,row.owner_uid,`${action}: ${note}`,now)];
  const eventIds=rows.map(()=>crypto.randomUUID());
  for(const [index,source] of rows.entries()) {
    statements.push(db.prepare(`INSERT INTO creditex_job_lifecycle_events(id,organisation_id,work_order_id,owner_uid,intent_id,action,
      source_snapshot,source_sha256,occurred_at,actor_kind,actor_uid,note,request_id,request_sha256,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(eventIds[index],source.organisation_id,workOrderId,row.owner_uid,source.intent_id,
      action,source.completion_snapshot,hash(source.completion_snapshot),now,actor.kind,actor.uid,note,hash(`${requestId}:${source.intent_id}`),requestHash,now));
    if(action==="correction_required") {
      const correction={eventId:eventIds[index],organisationId:source.organisation_id,ownerUid:row.owner_uid,
        workOrderId,intentId:source.intent_id,sourceSnapshot:source.completion_snapshot,actorUid:actor.uid,now,note};
      statements.push(...await prepareCreditexCorrectionWorkPackStatements(db,correction),...await prepareFieldCorrectionStatements(db,correction));
      statements.push(db.prepare(`UPDATE compliance_cases SET revision=revision+1,status='in_review',evidence_status='in_progress',updated_at=?
        WHERE organisation_id=? AND compliance_intent_id=? AND installer_uid=? AND work_order_id=? AND status<>'closed'`)
        .bind(now,source.organisation_id,source.intent_id,row.owner_uid,workOrderId));
    } else {
      statements.push(db.prepare(`UPDATE compliance_cases SET status='in_review',evidence_status='complete',updated_at=?
        WHERE organisation_id=? AND compliance_intent_id=? AND installer_uid=? AND work_order_id=?
          AND status IN ('draft','in_review','changes_requested')`)
        .bind(now,source.organisation_id,source.intent_id,row.owner_uid,workOrderId));
    }
  }
  const deliveryId=crypto.randomUUID();
  if(action==="correction_required"&&technician) {
    statements.push(db.prepare(`INSERT INTO trade_crm_job_notes(id,work_order_id,firebase_uid,note_type,body,issue_status,created_at,updated_at)
      VALUES(?,?,?,'issue',?,'open',?,?)`).bind(crypto.randomUUID(),workOrderId,row.owner_uid,`Correction required: ${note}`,now,now),
      db.prepare(`INSERT INTO creditex_job_correction_deliveries(id,event_id,work_order_id,owner_uid,member_id,recipient_email,subject,body,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,'pending',?,?)`).bind(deliveryId,eventIds[0],workOrderId,row.owner_uid,technician.id,technician.email,
        `TLink: corrections required for ${row.work_number}`,`Hi ${technician.display_name||"there"},\n\n${actor.kind==="trade"?"Your business reviewer":"Creditex"} has returned ${row.work_number}${row.title?` (${row.title})`:""} for correction.\n\n${note}\n\nOpen the assigned job in TLink to complete the corrections:\nhttps://ausenergyassessments.com/direct-trade/dashboard?jobId=${encodeURIComponent(workOrderId)}\n\nThe original signed forms are retained alongside your correction copies.`,now,now));
  }
  statements.push(...jobSyncChangeStatements(db,{ownerUid:row.owner_uid,workOrderId,revision:row.revision+1,changedAt:now,
    audienceMemberId:row.assignee_member_id,operation:"upsert"}));
  try{await db.batch(statements);}catch(error){if(error instanceof Error&&/UNIQUE constraint failed|trade_work_order_events.summary/.test(error.message))
    return fail("JOB_REVIEW_SOURCE_CHANGED","The job or review changed. Refresh before continuing.");throw error;}
  if(action==="correction_required") await dispatchJobCorrectionEmail(db,actor,deliveryId,options);
  return loadTradeJobReview(db,actor,workOrderId);
}
