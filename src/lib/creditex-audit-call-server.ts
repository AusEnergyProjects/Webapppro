
import { getD1 } from "../../db";
import type { ComplianceIdentity } from "./compliance-access-server";
import { loadAuditCallTarget, assertStoredAuditCallTarget, type AuditCallTargetInput, type AuditCallTarget } from "./creditex-audit-call-target-server";
import { getCreditexCustodyBucket, type CreditexCustodyBucket } from "./creditex-custody-bucket";
import { sha256Hex } from "./creditex-official-source-custody-server";
import { resolveAuditCallConfiguration, resolveStoredAuditCallConfiguration } from "./creditex-voice-connection-server";
import { auditProviderRequest, auditCallCommand, createAuditVoiceToken, downloadAuditRecording, verifyAuditCallSignature, providerObject, providerData, AUDIT_CALL_CALLBACK_URL, type AuditCallConfiguration, type ProviderRecord } from "./creditex-audit-call-provider";
import { auditCallIsActive, CREDITEX_AUDIT_CALL_CONSENT_NOTICE, CREDITEX_AUDIT_CALL_CONSENT_VERSION, CREDITEX_AUDIT_CALL_LIMITS,
  type CreditexAuditCall, type CreditexAuditCallStatus, type CreditexAuditCallsResponse, type CreditexAuditRecordingStatus, type CreditexAuditCallPrepareResponse } from "./creditex-audit-calls";

export class CreditexAuditCallError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
type CallRecord = {
  id:string; organisation_id:string; connection_id:string; case_id:string; job_intent_id:string; started_by_uid:string; started_by_member_id:string; started_by_name:string;
  request_id:string; customer_phone:string; caller_id:string; credential_connection_id:string; call_control_application_id:string; telephony_credential_id:string; intent_secret_hash:string;
  status:CreditexAuditCallStatus; expires_at:string; active_until:string; agent_call_control_id:string; agent_call_leg_id:string;
  agent_ended:number; customer_ended:number;
  customer_call_control_id:string; customer_call_leg_id:string; customer_call_session_id:string; consent_stage:string;
  consented_at:string; consent_version:string; consent_notice:string; recording_status:CreditexAuditRecordingStatus; recording_id:string;
  recording_object_key:string; recording_sha256:string; recording_size_bytes:number; duration_seconds:number; recording_attempts:number;
  next_recording_attempt_at:string; recording_lease_token:string; recording_lease_until:string; end_requested:number; saved_at:string; error_code:string; created_at:string; updated_at:string;
};
export type AuditCallOptions = { fetchImpl?: typeof fetch; bucket?: CreditexCustodyBucket };
const activeStatesSql = "('prepared','dialing','ringing','awaiting_consent','in_progress')";
const nowIso = () => new Date().toISOString();
function failure(code:string,message:string,status=409):never { throw new CreditexAuditCallError(code,status,message); }
function publicCall(row:CallRecord):CreditexAuditCall {
  const error = row.recording_status === "unknown" ? "The recording start could not be confirmed. The call was ended."
    : row.recording_status === "failed" ? "The recording has not been saved. Retry the private recording transfer."
    : row.error_code ? "The call could not be completed. Review its status before trying again." : undefined;
  return {id:row.id,status:row.status,recordingStatus:row.recording_status,createdAt:row.created_at,startedByName:row.started_by_name,
    durationSeconds:Number(row.duration_seconds),consentedAt:row.consented_at,savedAt:row.saved_at,...(error?{error}:{})};
}
function auditStatement(db:D1Database,call:CallRecord,event:string,summary:string,actorUid="system:creditex-audit-calls",metadata:Record<string,unknown>={},eventId=crypto.randomUUID(),lease="") {
  return db.prepare(`INSERT OR IGNORE INTO compliance_audit_events
    (id,organisation_id,actor_type,actor_uid,event_type,target_type,target_id,summary,metadata,created_at)
    SELECT ?,?,?,?,?,'creditex_audit_call',?,?,?,? WHERE ?='' OR EXISTS
    (SELECT 1 FROM creditex_audit_calls WHERE id=? AND recording_lease_token=? AND saved_at='')`).bind(eventId,call.organisation_id,actorUid.startsWith("system:")?"platform":"compliance",actorUid,event,call.id,summary,
    JSON.stringify({caseId:call.case_id,jobIntentId:call.job_intent_id,...metadata}),nowIso(),lease,call.id,lease);
}
async function getCall(db:D1Database,id:string) { return db.prepare("SELECT * FROM creditex_audit_calls WHERE id=?").bind(id).first<CallRecord>(); }
function targetInput(call:CallRecord):AuditCallTargetInput { return call.job_intent_id?{jobIntentId:call.job_intent_id}:{caseId:call.case_id}; }
function historySql() { return `organisation_id=? AND ((?<>'' AND case_id=?) OR (?<>'' AND job_intent_id=?) OR (?<>'' AND job_intent_id IN
 (SELECT id FROM trade_work_order_compliance_intents WHERE compliance_case_id=? AND compliance_organisation_id=? AND work_order_id=?)))`; }
function historyBindings(member:ComplianceIdentity,target:AuditCallTarget) { return [member.organisationId,target.caseId,target.caseId,target.jobIntentId,target.jobIntentId,target.caseId,target.caseId,member.organisationId,target.workOrderId]; }
async function requiredCall(db:D1Database,member:ComplianceIdentity,input:AuditCallTargetInput,id:string) {
  const target=await loadAuditCallTarget(db,member,input);
  const call=await db.prepare(`SELECT * FROM creditex_audit_calls WHERE id=? AND ${historySql()}`).bind(id,...historyBindings(member,target)).first<CallRecord>();
  if(!call) failure("AUDIT_CALL_NOT_FOUND","The audit call was not found in this audit record.",404);
  return call;
}
async function storedConfiguration(db:D1Database,call:CallRecord) {
  const config=await resolveStoredAuditCallConfiguration(db,{organisationId:call.organisation_id,connectionId:call.connection_id,
    credentialConnectionId:call.credential_connection_id,callControlApplicationId:call.call_control_application_id,callerId:call.caller_id});
  if(!config) failure("AUDIT_CALL_CONFIGURATION_CHANGED","The phone connection for this audit call is unavailable.");
  return config;
}
async function currentTarget(db:D1Database,call:CallRecord) {
  await assertStoredAuditCallTarget(db,{organisationId:call.organisation_id,memberId:call.started_by_member_id,uid:call.started_by_uid,
    caseId:call.case_id,jobIntentId:call.job_intent_id,customerPhone:call.customer_phone});
}
async function expireUnused(db:D1Database) {
  await db.prepare("UPDATE creditex_audit_calls SET status='expired',updated_at=? WHERE status='prepared' AND expires_at<=?").bind(nowIso(),nowIso()).run();
}
export async function loadAuditCalls(db:D1Database,member:ComplianceIdentity,input:AuditCallTargetInput):Promise<CreditexAuditCallsResponse> {
  const target=await loadAuditCallTarget(db,member,input);
  await expireUnused(db);
  const readiness=await resolveAuditCallConfiguration(db,member.organisationId,member.membershipId,{verifyProvider:false});
  const rows=await db.prepare(`SELECT * FROM creditex_audit_calls WHERE ${historySql()} ORDER BY created_at DESC,id DESC LIMIT 50`).bind(...historyBindings(member,target)).all<CallRecord>();
  const active=await db.prepare(`SELECT id FROM creditex_audit_calls WHERE started_by_uid=? AND (status IN ${activeStatesSql} OR end_requested=1) LIMIT 1`).bind(member.uid).first();
  return {ok:true,configured:readiness.configured,unavailableReason:readiness.unavailableReason||target.unavailableReason,customerPhone:target.customerPhone,
    canCall:readiness.configured&&target.canCall&&!active,calls:rows.results.map(publicCall)};
}
export async function prepareAuditCall(db:D1Database,member:ComplianceIdentity,input:AuditCallTargetInput,requestId:unknown,options:AuditCallOptions={}):Promise<CreditexAuditCallPrepareResponse> {
  if(typeof requestId!=="string"||!/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) failure("AUDIT_CALL_REQUEST_INVALID","Refresh the audit call panel before calling.",400);
  const target=await loadAuditCallTarget(db,member,input);
  if(!target.canCall) failure("AUDIT_CALL_PHONE_REQUIRED",target.unavailableReason);
  const readiness=await resolveAuditCallConfiguration(db,member.organisationId,member.membershipId),config=readiness.configuration;
  if(!config||!readiness.configured) failure("AUDIT_CALL_UNCONFIGURED",readiness.unavailableReason||"Creditex must finish its phone account setup before calling.");
  if(!(options.bucket||getCreditexCustodyBucket())) failure("AUDIT_CALL_STORAGE_UNAVAILABLE","Private audit recording storage is unavailable.",503);
  await expireUnused(db);
  const id=crypto.randomUUID(),now=nowIso(),expiresAt=new Date(Date.now()+CREDITEX_AUDIT_CALL_LIMITS.intentSeconds*1000).toISOString();
  const secret=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,"0")).join("");
  const secretHash=await sha256Hex(new TextEncoder().encode(secret));
  const result=await db.prepare(`INSERT OR IGNORE INTO creditex_audit_calls
    (id,organisation_id,connection_id,case_id,job_intent_id,started_by_uid,started_by_member_id,started_by_name,request_id,customer_phone,caller_id,
    credential_connection_id,call_control_application_id,intent_secret_hash,expires_at,active_until,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE
    (SELECT COUNT(*) FROM creditex_audit_calls WHERE organisation_id=? AND created_at>=?)<?
    AND (SELECT COUNT(*) FROM creditex_audit_calls WHERE started_by_uid=? AND created_at>=?)<?
    AND NOT EXISTS(SELECT 1 FROM creditex_audit_calls WHERE started_by_uid=? AND (status IN ${activeStatesSql} OR end_requested=1))
    AND EXISTS(SELECT 1 FROM compliance_users WHERE id=? AND firebase_uid=? AND organisation_id=? AND status='active')
    AND EXISTS(SELECT 1 FROM creditex_voice_connections WHERE id=? AND organisation_id=? AND status='connected')`)
    .bind(id,member.organisationId,config.connectionId,target.caseId,target.jobIntentId,member.uid,member.membershipId,member.displayName||"Creditex staff",requestId,target.customerPhone,config.callerId,
      config.credentialConnectionId,config.callControlApplicationId,secretHash,expiresAt,expiresAt,now,now,
      member.organisationId,`${now.slice(0,10)}T00:00:00.000Z`,CREDITEX_AUDIT_CALL_LIMITS.organisationDaily,
      member.uid,`${now.slice(0,10)}T00:00:00.000Z`,CREDITEX_AUDIT_CALL_LIMITS.operatorDaily,member.uid,member.membershipId,member.uid,member.organisationId,config.connectionId,member.organisationId).run();
  if(!result.meta.changes) failure("AUDIT_CALL_LIMIT","This request was already prepared, or an active call or daily limit prevents another call. Refresh the panel.");
  const call=await getCall(db,id);
  if(!call) failure("AUDIT_CALL_UNAVAILABLE","The audit call could not be reserved.",503);
  await auditStatement(db,call,"audit_call.prepared","Creditex member prepared a customer audit call.",member.uid,{},`${id}:prepared`).run();
  try {
    const voice=await createAuditVoiceToken(config,id,expiresAt,options.fetchImpl||fetch);
    const ready=await db.prepare("UPDATE creditex_audit_calls SET telephony_credential_id=?,updated_at=? WHERE id=? AND status='prepared' AND expires_at>?").bind(voice.credentialId,nowIso(),id,nowIso()).run();
    if(!ready.meta.changes) throw new Error("AUDIT_CALL_EXPIRED");
    return {ok:true,callId:id,token:voice.token,expiresAt,destinationNumber:config.callerId,customHeaders:[{name:"X-Creditex-Call-Intent",value:secret}]};
  } catch {
    await db.prepare("UPDATE creditex_audit_calls SET status='failed',error_code='credential_unavailable',updated_at=? WHERE id=? AND status='prepared'").bind(nowIso(),id).run();
    failure("AUDIT_CALL_PROVIDER_UNAVAILABLE","The phone provider could not prepare a call. Refresh the panel before trying again.",502);
  }
}
async function hangupLeg(config:AuditCallConfiguration,call:CallRecord,controlId:string,fetchImpl:typeof fetch) {
  if(!controlId) return true;
  try { await auditCallCommand(config,controlId,"hangup",{command_id:`${call.id}:end:${controlId}`},fetchImpl); return true; }
  catch { return false; }
}
async function endCall(db:D1Database,call:CallRecord,status:CreditexAuditCallStatus,options:AuditCallOptions={},error="") {
  await db.prepare(`UPDATE creditex_audit_calls SET status=CASE WHEN status IN ${activeStatesSql} THEN ? ELSE status END,end_requested=1,
    recording_status=CASE WHEN recording_status='recording' THEN 'pending' ELSE recording_status END,error_code=CASE WHEN ?<>'' THEN ? ELSE error_code END,updated_at=? WHERE id=?`)
    .bind(status,error,error,nowIso(),call.id).run();
  const current=await getCall(db,call.id);
  if(!current) return false;
  const config=await storedConfiguration(db,current),fetchImpl=options.fetchImpl||fetch;
  const results=await Promise.all([current.agent_ended?true:hangupLeg(config,current,current.agent_call_control_id,fetchImpl),current.customer_ended?true:hangupLeg(config,current,current.customer_call_control_id,fetchImpl)]);
  const unknownDial=current.error_code==="dial_outcome_unknown"&&!current.customer_call_control_id&&current.active_until>nowIso();
  if(results.every(Boolean)&&!unknownDial) await db.prepare("UPDATE creditex_audit_calls SET end_requested=0 WHERE id=? AND agent_call_control_id=? AND customer_call_control_id=?").bind(current.id,current.agent_call_control_id,current.customer_call_control_id).run();
  return results.every(Boolean)&&!unknownDial;
}
export async function cancelAuditCall(db:D1Database,member:ComplianceIdentity,input:AuditCallTargetInput,id:string,options:AuditCallOptions={}) {
  const call=await requiredCall(db,member,input,id);
  if(call.started_by_uid!==member.uid) failure("AUDIT_CALL_ACCESS_REQUIRED","Only the operator who prepared this call can end it.",403);
  if(!await endCall(db,call,"cancelled",options)) failure("AUDIT_CALL_END_PENDING","The call end is still being confirmed. Retry ending the call.",502);
  await auditStatement(db,call,"audit_call.cancelled","Creditex member ended the audit call.",member.uid,{},`${call.id}:cancelled`).run();
}
function state(call:CallRecord,stage:string) { return btoa(JSON.stringify({callId:call.id,stage})); }
function readState(value:unknown) { try { return typeof value==="string"&&value.length<2000?providerObject(JSON.parse(atob(value))):{}; } catch { return {}; } }
function string(value:unknown) { return typeof value==="string"?value:""; }
function safeId(value:unknown) { return typeof value==="string"&&/^[A-Za-z0-9:_=-]{1,300}$/.test(value)?value:""; }
async function bindCustomer(db:D1Database,call:CallRecord,payload:ProviderRecord) {
  const control=safeId(payload.call_control_id),leg=safeId(payload.call_leg_id),session=safeId(payload.call_session_id);
  if(!control||!leg||!session||payload.connection_id!==call.call_control_application_id||payload.to!==call.customer_phone||payload.from!==call.caller_id) failure("AUDIT_CALL_WEBHOOK_INVALID","Invalid customer call binding.",403);
  const changed=await db.prepare(`UPDATE creditex_audit_calls SET customer_call_control_id=?,customer_call_leg_id=?,customer_call_session_id=?
    WHERE id=? AND agent_call_control_id<>'' AND (customer_call_control_id='' OR customer_call_control_id=?) AND (customer_call_leg_id='' OR customer_call_leg_id=?)`)
    .bind(control,leg,session,call.id,control,leg).run();
  if(!changed.meta.changes) failure("AUDIT_CALL_WEBHOOK_INVALID","Invalid customer call binding.",403);
  const fresh=await getCall(db,call.id);
  if(!fresh) failure("AUDIT_CALL_WEBHOOK_INVALID","Invalid call.",403);
  return fresh;
}
async function parkedCall(db:D1Database,call:CallRecord,payload:ProviderRecord,config:AuditCallConfiguration,options:AuditCallOptions) {
  const control=safeId(payload.call_control_id),leg=safeId(payload.call_leg_id),fetchImpl=options.fetchImpl||fetch;
  if(!control||!leg||payload.connection_id!==call.credential_connection_id||payload.state!=="parked"||payload.direction!=="outgoing") failure("AUDIT_CALL_WEBHOOK_INVALID","Invalid parked call.",403);
  if(call.agent_call_control_id===control) return;
  try { await currentTarget(db,call); } catch { await hangupLeg(config,call,control,fetchImpl); await endCall(db,call,"failed",options,"target_changed"); return; }
  const consumed=await db.prepare(`UPDATE creditex_audit_calls SET status='dialing',agent_call_control_id=?,agent_call_leg_id=?,active_until=?,updated_at=?
    WHERE id=? AND status='prepared' AND telephony_credential_id<>'' AND agent_call_control_id='' AND expires_at>?`)
    .bind(control,leg,new Date(Date.now()+(CREDITEX_AUDIT_CALL_LIMITS.callSeconds+120)*1000).toISOString(),nowIso(),call.id,nowIso()).run();
  if(!consumed.meta.changes) { await hangupLeg(config,call,control,fetchImpl); return; }
  const current=await getCall(db,call.id);
  if(!current) return;
  try {
    // Browser destination and From are deliberately excluded from the PSTN request.
    const data=providerData(await auditProviderRequest(config,"/calls",fetchImpl,{connection_id:call.call_control_application_id,to:call.customer_phone,from:call.caller_id,
      timeout_secs:30,time_limit_secs:CREDITEX_AUDIT_CALL_LIMITS.callSeconds,webhook_url:AUDIT_CALL_CALLBACK_URL,webhook_url_method:"POST",
      client_state:state(call,"dial"),command_id:`${call.id}:dial`,bridge_on_answer:false,link_to:control}));
    const bound=await bindCustomer(db,current,{...data,connection_id:call.call_control_application_id,to:call.customer_phone,from:call.caller_id});
    if(!auditCallIsActive(bound.status)) await endCall(db,bound,bound.status,options);
  } catch { await endCall(db,current,"failed",options,"dial_outcome_unknown"); }
}
async function rejectUnboundParkedCall(db:D1Database,request:Request,raw:string,payload:ProviderRecord,options:AuditCallOptions) {
  const control=safeId(payload.call_control_id),connection=safeId(payload.connection_id);
  if(!control||!connection) failure("AUDIT_CALL_WEBHOOK_INVALID","Invalid parked call.",403);
  const binding=await db.prepare(`SELECT c.id connectionId,c.organisation_id organisationId,c.credential_connection_id credentialConnectionId,
    c.call_control_application_id callControlApplicationId,n.phone_number callerId FROM creditex_voice_connections c
    JOIN creditex_voice_numbers n ON n.connection_id=c.id AND n.number_id=c.default_number_id
    WHERE c.credential_connection_id=? LIMIT 1`).bind(connection).first<{
      connectionId:string;organisationId:string;credentialConnectionId:string;callControlApplicationId:string;callerId:string;
    }>();
  const config=binding?await resolveStoredAuditCallConfiguration(db,binding):null;
  if(!config||request.url!==AUDIT_CALL_CALLBACK_URL||!await verifyAuditCallSignature(raw,request.headers.get("telnyx-timestamp")||"",request.headers.get("telnyx-signature-ed25519")||"",config.publicKey)) failure("AUDIT_CALL_WEBHOOK_INVALID","Invalid provider signature.",403);
  // A valid provider callback with no usable intent may only end its own parked leg.
  // It can never reserve, select a customer, or cause a PSTN dial.
  await auditCallCommand(config,control,"hangup",{command_id:`rejected:${await sha256Hex(new TextEncoder().encode(control))}`},options.fetchImpl||fetch);
}
export async function receiveAuditCallWebhook(request:Request,db:D1Database=getD1(),options:AuditCallOptions={}) {
  const raw=await request.text();
  if(raw.length>64000) failure("AUDIT_CALL_WEBHOOK_INVALID","Invalid provider request.",403);
  let envelope:ProviderRecord;
  try { envelope=providerObject(JSON.parse(raw)); } catch { failure("AUDIT_CALL_WEBHOOK_INVALID","Invalid provider request.",403); }
  const event=providerObject(envelope.data),payload=providerObject(event.payload),eventType=string(event.event_type),client=readState(payload.client_state);
  const headers=Array.isArray(payload.custom_headers)?payload.custom_headers.map(providerObject):[];
  const header=headers.find(h=>String(h.name||h.header_name).toLowerCase()==="x-creditex-call-intent");
  const secret=string(header?.value||header?.header_value);
  const parked=eventType==="call.initiated"&&payload.state==="parked";
  let call:CallRecord|null=null;
  if(parked) {
    if(/^[a-f0-9]{64}$/.test(secret)) call=await db.prepare("SELECT * FROM creditex_audit_calls WHERE intent_secret_hash=?").bind(await sha256Hex(new TextEncoder().encode(secret))).first<CallRecord>();
    if(!call) { await rejectUnboundParkedCall(db,request,raw,payload,options); return; }
  } else if(typeof client.callId==="string") call=await getCall(db,client.callId);
  if(!parked&&!call&&safeId(payload.call_leg_id)) call=await db.prepare("SELECT * FROM creditex_audit_calls WHERE customer_call_leg_id=? OR agent_call_leg_id=?")
    .bind(payload.call_leg_id,payload.call_leg_id).first<CallRecord>();
  if(!call) failure("AUDIT_CALL_WEBHOOK_INVALID","Unknown provider call.",403);
  const config=await storedConfiguration(db,call);
  if(request.url!==AUDIT_CALL_CALLBACK_URL||!await verifyAuditCallSignature(raw,request.headers.get("telnyx-timestamp")||"",request.headers.get("telnyx-signature-ed25519")||"",config.publicKey)) failure("AUDIT_CALL_WEBHOOK_INVALID","Invalid provider signature.",403);
  if(eventType==="call.initiated"&&payload.state==="parked") { await parkedCall(db,call,payload,config,options); return; }
  const agent=payload.connection_id===call.credential_connection_id&&payload.call_leg_id===call.agent_call_leg_id&&payload.call_control_id===call.agent_call_control_id;
  if(!agent&&eventType==="call.initiated"&&client.stage==="dial") call=await bindCustomer(db,call,payload);
  const customer=payload.connection_id===call.call_control_application_id&&payload.call_leg_id===call.customer_call_leg_id
    &&(!payload.call_control_id||payload.call_control_id===call.customer_call_control_id)&&payload.call_session_id===call.customer_call_session_id;
  if(!agent&&!customer) failure("AUDIT_CALL_WEBHOOK_INVALID","Invalid provider call binding.",403);
  const fetchImpl=options.fetchImpl||fetch;
  if(eventType==="call.recording.saved"&&customer) {
    if(!call.consented_at||call.recording_status==="none") failure("AUDIT_CALL_WEBHOOK_INVALID","Recording consent was not recorded.",403);
    if(Object.values(providerObject(payload.public_recording_urls)).some(Boolean)) {
      await db.prepare("UPDATE creditex_audit_calls SET recording_status='failed',error_code='public_recording_disabled' WHERE id=? AND saved_at=''").bind(call.id).run();
      return;
    }
    await db.prepare("UPDATE creditex_audit_calls SET recording_status='pending',next_recording_attempt_at='' WHERE id=? AND saved_at='' AND recording_status<>'saving'").bind(call.id).run();
    await ingestAuditRecording(db,call.id,options); return;
  }
  if(eventType==="call.hangup") {
    await db.prepare(agent?"UPDATE creditex_audit_calls SET agent_ended=1 WHERE id=?":"UPDATE creditex_audit_calls SET customer_ended=1 WHERE id=?").bind(call.id).run();
    const cause=string(payload.hangup_cause),status=call.consented_at?"completed":cause==="user_busy"?"busy":["timeout","no_answer"].includes(cause)?"no_answer":"declined";
    await endCall(db,call,status,options); return;
  }
  if(!auditCallIsActive(call.status)) { if(eventType==="call.initiated"||eventType==="call.answered") await endCall(db,call,call.status,options); return; }
  if(!customer) return;
  try {
    if(eventType==="call.answered"&&call.consent_stage==="") {
      const changed=await db.prepare(`UPDATE creditex_audit_calls SET status='awaiting_consent',consent_stage='notice',active_until=?,updated_at=? WHERE id=? AND consent_stage='' AND status IN ${activeStatesSql}`).bind(new Date(Date.now()+90000).toISOString(),nowIso(),call.id).run();
      if(changed.meta.changes) await auditCallCommand(config,call.customer_call_control_id,"speak",{payload:CREDITEX_AUDIT_CALL_CONSENT_NOTICE,payload_type:"text",voice:"female",language:"en-US",service_level:"basic",target_legs:"self",client_state:state(call,"notice"),command_id:`${call.id}:notice`},fetchImpl);
    } else if(eventType==="call.speak.ended"&&client.stage==="notice"&&payload.status==="completed"&&call.consent_stage==="notice") {
      const changed=await db.prepare(`UPDATE creditex_audit_calls SET consent_stage='gather',updated_at=? WHERE id=? AND consent_stage='notice' AND status IN ${activeStatesSql}`).bind(nowIso(),call.id).run();
      if(changed.meta.changes) await auditCallCommand(config,call.customer_call_control_id,"gather",{minimum_digits:1,maximum_digits:1,timeout_millis:15000,initial_timeout_millis:15000,valid_digits:"0123456789*#",terminating_digit:"",gather_id:call.id,client_state:state(call,"gather"),command_id:`${call.id}:gather`},fetchImpl);
    } else if(eventType==="call.gather.ended"&&client.stage==="gather"&&call.consent_stage==="gather") {
      if(payload.digits!=="1"||payload.status!=="valid") { await endCall(db,call,"declined",options); return; }
      await currentTarget(db,call);
      const consentedAt=nowIso();
      const accepted=await db.prepare(`UPDATE creditex_audit_calls SET consent_stage='consented',consented_at=?,consent_version=?,consent_notice=?,recording_status='starting',updated_at=?
        WHERE id=? AND consent_stage='gather' AND recording_status='none' AND status IN ${activeStatesSql}`)
        .bind(consentedAt,CREDITEX_AUDIT_CALL_CONSENT_VERSION,CREDITEX_AUDIT_CALL_CONSENT_NOTICE,consentedAt,call.id).run();
      if(!accepted.meta.changes) return;
      await auditStatement(db,call,"audit_call.recording_consent","Customer pressed 1 after the complete recording notice.",undefined,{noticeVersion:CREDITEX_AUDIT_CALL_CONSENT_VERSION,consentedAt},`${call.id}:consent`).run();
      try {
        await auditCallCommand(config,call.customer_call_control_id,"record_start",{format:"mp3",channels:"dual",recording_track:"both",max_length:CREDITEX_AUDIT_CALL_LIMITS.callSeconds,play_beep:true,transcription:false,timeout_secs:0,client_state:state(call,"recording"),command_id:`${call.id}:record`},fetchImpl);
      } catch {
        await db.prepare("UPDATE creditex_audit_calls SET recording_status='unknown' WHERE id=? AND recording_status='starting'").bind(call.id).run();
        await endCall(db,call,"failed",options,"recording_start_unknown"); return;
      }
      const started=await db.prepare(`UPDATE creditex_audit_calls SET recording_status='recording',updated_at=? WHERE id=? AND recording_status='starting' AND status IN ${activeStatesSql}`).bind(nowIso(),call.id).run();
      if(!started.meta.changes) { await endCall(db,call,"failed",options); return; }
      await auditCallCommand(config,call.agent_call_control_id,"bridge",{call_control_id:call.customer_call_control_id,prevent_double_bridge:true,client_state:state(call,"bridge"),command_id:`${call.id}:bridge`},fetchImpl);
      await db.prepare(`UPDATE creditex_audit_calls SET status='in_progress',active_until=?,updated_at=? WHERE id=? AND recording_status='recording' AND status IN ${activeStatesSql}`).bind(new Date(Date.now()+CREDITEX_AUDIT_CALL_LIMITS.callSeconds*1000).toISOString(),nowIso(),call.id).run();
    } else if(eventType==="call.recording.error") {
      await db.prepare("UPDATE creditex_audit_calls SET recording_status='failed' WHERE id=? AND saved_at=''").bind(call.id).run();
      await endCall(db,call,"failed",options,"recording_provider_failed");
    }
  } catch { await endCall(db,call,"failed",options,"call_command_failed"); }
}

async function recordingMetadata(config:AuditCallConfiguration,call:CallRecord,fetchImpl:typeof fetch) {
  let record:ProviderRecord;
  if(call.recording_id) record=providerData(await auditProviderRequest(config,`/recordings/${encodeURIComponent(call.recording_id)}`,fetchImpl));
  else {
    const result=await auditProviderRequest(config,`/recordings?filter[call_leg_id]=${encodeURIComponent(call.customer_call_leg_id)}&page[size]=20`,fetchImpl);
    const records=Array.isArray(result.data)?result.data.map(providerObject):[];
    const matching=records.filter(row=>row.call_leg_id===call.customer_call_leg_id&&row.call_session_id===call.customer_call_session_id&&row.connection_id===call.call_control_application_id);
    if(matching.length!==1||typeof matching[0].id!=="string") throw new Error("AUDIT_CALL_RECORDING_NOT_READY");
    record=providerData(await auditProviderRequest(config,`/recordings/${encodeURIComponent(matching[0].id)}`,fetchImpl));
  }
  if(!safeId(record.id)||record.call_leg_id!==call.customer_call_leg_id||record.call_session_id!==call.customer_call_session_id||record.connection_id!==call.call_control_application_id
    ||record.status!=="completed"||record.channels!=="dual"||record.source!=="call"||record.to!==call.customer_phone||record.from!==call.caller_id
    ||!Number.isFinite(Date.parse(string(record.recording_started_at)))||Date.parse(string(record.recording_started_at))<Date.parse(call.consented_at)-1000
    ||Object.values(providerObject(record.public_recording_urls)).some(Boolean)) throw new Error("AUDIT_CALL_RECORDING_INVALID");
  return record;
}
async function ingestAuditRecording(db:D1Database,callId:string,options:AuditCallOptions) {
  const now=nowIso(),lease=crypto.randomUUID();
  const claimed=await db.prepare(`UPDATE creditex_audit_calls SET recording_status='saving',recording_lease_token=?,recording_lease_until=?,recording_attempts=recording_attempts+1,updated_at=?
    WHERE id=? AND customer_call_leg_id<>'' AND consented_at<>'' AND saved_at='' AND recording_attempts<8 AND next_recording_attempt_at<=?
    AND (recording_status IN ('pending','failed','unknown') OR (recording_status='saving' AND recording_lease_until<?))`)
    .bind(lease,new Date(Date.now()+120000).toISOString(),now,callId,now,now).run();
  if(!claimed.meta.changes) return false;
  const call=await getCall(db,callId);
  if(!call) return false;
  try {
    if(call.error_code==="public_recording_disabled") throw new Error("AUDIT_CALL_RECORDING_PUBLIC");
    const config=await storedConfiguration(db,call),fetchImpl=options.fetchImpl||fetch;
    const record=await recordingMetadata(config,call,fetchImpl),recordingId=String(record.id);
    const bytes=await downloadAuditRecording(providerObject(record.download_urls).mp3,fetchImpl),hash=await sha256Hex(bytes);
    const key=`creditex/audit-calls/${call.organisation_id}/${call.id}/${recordingId}-${hash}.mp3`;
    await (options.bucket||getCreditexCustodyBucket()).put(key,bytes.buffer,{httpMetadata:{contentType:"audio/mpeg"},customMetadata:{sha256:hash,callId:call.id,caseId:call.case_id,jobIntentId:call.job_intent_id,recordingId}});
    const savedAt=nowIso();
    const savedStatement=db.prepare(`UPDATE creditex_audit_calls SET recording_id=?,recording_status='saved',recording_object_key=?,recording_sha256=?,recording_size_bytes=?,duration_seconds=?,
      saved_at=?,error_code='',recording_lease_token='',recording_lease_until='',updated_at=? WHERE id=? AND recording_lease_token=? AND saved_at=''`)
      .bind(recordingId,key,hash,bytes.byteLength,Math.max(0,Math.min(1800,Math.floor(Number(record.duration_millis||0)/1000))),savedAt,savedAt,call.id,lease);
    // D1 batches are transactions: both statements use the same lease guard.
    // Insert the receipt while the lease still exists, then save, or commit neither.
    const results=await db.batch([auditStatement(db,call,"audit_call.recording_saved","Audit call recording was saved to private audit custody.",undefined,{sha256:hash,sizeBytes:bytes.byteLength,recordingId},`${call.id}:saved`,lease),savedStatement]);
    return Boolean(results[1].meta.changes);
  } catch {
    const delay=[60000,300000,1800000,7200000][Math.min(3,Math.max(0,call.recording_attempts-1))];
    await db.prepare(`UPDATE creditex_audit_calls SET recording_status='failed',error_code=CASE WHEN error_code='public_recording_disabled' THEN error_code ELSE 'recording_transfer_failed' END,
      next_recording_attempt_at=?,recording_lease_token='',recording_lease_until='',updated_at=? WHERE id=? AND recording_lease_token=? AND saved_at=''`)
      .bind(new Date(Date.now()+delay).toISOString(),nowIso(),call.id,lease).run();
    return false;
  }
}
export async function processCreditexAuditCallRecordings(db:D1Database=getD1(),options:AuditCallOptions={}) {
  await expireUnused(db);
  const now=nowIso();
  // A worker may end after recording was accepted but before its acknowledgment was saved.
  // End the call and reconcile existing media; never reissue record_start.
  await db.prepare(`UPDATE creditex_audit_calls SET recording_status='unknown',end_requested=1,error_code='recording_start_unknown'
    WHERE recording_status='starting' AND updated_at<?`).bind(new Date(Date.now()-60000).toISOString()).run();
  const ended=await db.prepare(`SELECT * FROM creditex_audit_calls WHERE end_requested=1 OR (status IN ${activeStatesSql} AND active_until<=?) LIMIT 5`).bind(now).all<CallRecord>();
  for(const call of ended.results) { try { await endCall(db,call,auditCallIsActive(call.status)?"expired":call.status,options); } catch { /* Retain end_requested for the next scheduled pass. */ } }
  const rows=await db.prepare(`SELECT id FROM creditex_audit_calls WHERE customer_call_leg_id<>'' AND consented_at<>'' AND saved_at='' AND recording_attempts<8 AND next_recording_attempt_at<=?
    AND (recording_status IN ('pending','failed','unknown') OR (recording_status='saving' AND recording_lease_until<?)) ORDER BY created_at LIMIT 3`).bind(now,now).all<{id:string}>();
  let saved=0;
  for(const row of rows.results) if(await ingestAuditRecording(db,row.id,options)) saved++;
  return {processed:rows.results.length,saved};
}
export async function retryAuditRecording(db:D1Database,member:ComplianceIdentity,input:AuditCallTargetInput,id:string,options:AuditCallOptions={}) {
  const call=await requiredCall(db,member,input,id);
  if(call.recording_status==="saved") return;
  if(!call.consented_at||!call.customer_call_leg_id||!["failed","pending","unknown"].includes(call.recording_status)) failure("AUDIT_CALL_RECORDING_UNCONFIRMED","A consented completed recording is required before retrying its transfer. Recording creation is never retried.");
  await db.prepare("UPDATE creditex_audit_calls SET recording_status='pending',recording_attempts=0,next_recording_attempt_at='' WHERE id=? AND recording_status IN ('failed','pending','unknown')").bind(call.id).run();
  await auditStatement(db,call,"audit_call.recording_retry","Creditex member retried private recording custody.",member.uid).run();
  await ingestAuditRecording(db,call.id,options);
}
export async function readAuditCallAudio(db:D1Database,member:ComplianceIdentity,id:string,options:AuditCallOptions={}) {
  const call=await getCall(db,id);
  if(!call||call.organisation_id!==member.organisationId) failure("AUDIT_CALL_NOT_FOUND","The audit call was not found.",404);
  await loadAuditCallTarget(db,member,targetInput(call));
  if(call.recording_status!=="saved"||!call.recording_object_key) failure("AUDIT_CALL_AUDIO_UNAVAILABLE","This recording has not been saved yet.");
  const object=await (options.bucket||getCreditexCustodyBucket()).get(call.recording_object_key);
  if(!object||Number(object.size||0)>CREDITEX_AUDIT_CALL_LIMITS.maximumRecordingBytes) failure("AUDIT_CALL_AUDIO_UNAVAILABLE","The private recording is unavailable.",404);
  const bytes=new Uint8Array(await object.arrayBuffer());
  if(bytes.byteLength!==call.recording_size_bytes||bytes.byteLength>CREDITEX_AUDIT_CALL_LIMITS.maximumRecordingBytes||await sha256Hex(bytes)!==call.recording_sha256) failure("AUDIT_CALL_AUDIO_INTEGRITY","The stored recording did not pass its integrity check.");
  const receipt=await auditStatement(db,call,"audit_call.recording_played","Authorised Creditex member opened a private audit recording.",member.uid,{accessRole:member.role,sha256:call.recording_sha256,sizeBytes:bytes.byteLength}).run();
  if(!receipt.meta.changes) failure("AUDIT_CALL_AUDIO_UNAVAILABLE","The recording access receipt could not be saved.",503);
  return {bytes,sha256:call.recording_sha256};
}
