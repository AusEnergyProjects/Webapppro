import { env } from "cloudflare:workers";
import { getD1 } from "../../db";
import type { TeamAccess } from "./trade-team-server";
import { jobMemberSql } from "./trade-job-collaboration";
import { verifiedTradeAccountPredicate } from "./trade-account-predicates";
import { activityCanonical, activityConditionMet, activityDeclarationText, activityHash, activityMissing,
  activitySigningScope, normaliseActivityAnswers, validateActivityStrokes } from "./trade-activity-forms";
import { expandedActivityFields } from "./trade-activity-form-flow";
import type { ActivityAnswers, ActivityEvidence, ActivitySignature } from "./trade-activity-form-types";
import { createVeuElectricalForm, veuElectricalCompletion, VEU_ELECTRICAL_SIGNER_FIELDS } from "./veu-electrical-safety-form";
import { PiesaError, type PiesaRecord, type PiesaPresentation, type PiesaDelivery, type PiesaDeliveryRole } from "./veu-electrical-assessment";
import { ensurePiesaSchemaGuards } from "./trade-veu-electrical-schema-guards";
import { sendTradeCustomerEmail } from "./trade-email-server";
import { reminderProviderFailureOutcome } from "./service-reminder-delivery";
import { reconcileTradeFormJobProgress } from "./trade-form-job-progress";

type Row = { id:string;work_order_id:string;owner_uid:string;revision:number;status:string;payload:string;payload_sha256:string;
  pdf_object_key:string;pdf_sha256:string;pdf_size_bytes:number;actor_uid:string;created_at:string;updated_at:string;completed_at:string };
type Bucket = { get(key:string):Promise<{arrayBuffer():Promise<ArrayBuffer>}|null>;
  put(key:string,bytes:Uint8Array,options:{httpMetadata:{contentType:string};customMetadata:Record<string,string>}):Promise<unknown>;
  delete(key:string):Promise<void> };
type Mutation = "save"|"attest_initial"|"sign"|"upload"|"complete";
export type PiesaMutationReceipt = { recordId:string;operation:Mutation;baseRevision:number;resultRevision:number;requestSha256:string;recordSha256:string;actorUid:string };
const API = "/api/trade-veu-electrical-assessments";
const stamp = () => new Date().toISOString();
const email = (value:unknown) => typeof value === "string" && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim()) ? value.trim().toLowerCase() : "";
const object = (value:unknown):value is Record<string,unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value:unknown):value is string => typeof value === "string";
function fail(code:string,message:string,status=409):never { throw new PiesaError(status,code,message); }
function bucket():Bucket {
  const candidate:unknown = Reflect.get(env,"EVIDENCE");
  if (!object(candidate) || typeof candidate.get !== "function" || typeof candidate.put !== "function" || typeof candidate.delete !== "function") fail("PIESA_STORAGE_UNAVAILABLE","The secure file store is unavailable.",503);
  // The Cloudflare binding is an external typed interface, validated above.
  return candidate as Bucket;
}
function identifier(value:unknown):string {
  if (!text(value) || !/^[A-Za-z0-9:_-]{1,180}$/.test(value)) fail("PIESA_INPUT_INVALID","Choose this assessment from its job.",400);
  return value;
}
function requestKey(value?:string) { return value === undefined ? crypto.randomUUID() : identifier(value); }
function expected(record:PiesaRecord,revision:unknown) {
  if (!Number.isSafeInteger(revision) || revision !== record.revision) fail("PIESA_REVISION_CONFLICT","This assessment changed. Refresh it before saving.");
  if (record.status !== "draft") fail("PIESA_COMPLETE_LOCKED","This completed assessment is locked.");
}
function currentAccess(access:TeamAccess,write:boolean) {
  const account=`EXISTS(SELECT 1 FROM trade_accounts a WHERE a.firebase_uid=w.firebase_uid AND a.partner_type='installer' AND ${verifiedTradeAccountPredicate("a")})`;
  if(access.isOwner) return {sql:`${account} AND ?=w.firebase_uid`,values:[access.actorUid]};
  return {sql:`${account} AND EXISTS(SELECT 1 FROM trade_team_members m WHERE m.id=? AND m.owner_uid=w.firebase_uid AND m.status='active'
    AND m.can_view_field_evidence=1 AND (?=0 OR m.can_manage_field_evidence=1)
    AND (m.member_uid=? OR (?<>'' AND ?='field-member:'||m.id AND EXISTS(SELECT 1 FROM trade_field_sessions s
      WHERE s.id=? AND s.owner_uid=m.owner_uid AND s.team_member_id=m.id AND s.status='active' AND s.expires_at>?)))
    AND ((m.job_scope='team' AND NOT EXISTS(SELECT 1 FROM trade_crew_members restriction WHERE restriction.owner_uid=m.owner_uid AND restriction.member_id=m.id)) OR ${jobMemberSql("w","m.id")}))`,
    values:[access.memberId,write?1:0,access.actorUid,access.fieldSessionId||"",access.actorUid,access.fieldSessionId||"",stamp()]};
}
async function scope(access:TeamAccess,workOrderId:string,mutate=false,allowClosed=false) {
  if (!(mutate ? access.canManageFieldEvidence : access.canViewFieldEvidence)) fail("PIESA_ACCESS_REQUIRED","Your access does not include this assessment.",403);
  const db=getD1();
  const guard=currentAccess(access,mutate);
  const job=await db.prepare(`SELECT w.id,w.stage,w.revision FROM trade_work_orders w WHERE w.id=? AND w.firebase_uid=?
    AND w.record_status='active' AND w.partner_type='installer' AND ${guard.sql}`)
    .bind(identifier(workOrderId),access.ownerUid,...guard.values).first<{id:string;stage:string;revision:number}>();
  if(!job)fail("PIESA_ACCESS_REQUIRED","Your current business or job access does not include this assessment.",403);
  if (mutate && !allowClosed && ["imported","cancelled","completed"].includes(job.stage)) fail("PIESA_JOB_LOCKED","Start an active job before changing this assessment.");
  return job;
}
function parse(row:Row):PiesaRecord {
  let value:unknown;try{value=JSON.parse(row.payload);}catch{fail("PIESA_INTEGRITY","The saved assessment could not pass its integrity check.");}
  const form=createVeuElectricalForm();
  if (!object(value) || activityHash(row.payload)!==row.payload_sha256 || value.id!==row.id || value.workOrderId!==row.work_order_id
    || value.ownerUid!==row.owner_uid || value.revision!==Number(row.revision) || value.status!==row.status
    || value.completedAt!==row.completed_at || !text(value.recordNumber) || !text(value.createdAt) || !text(value.updatedAt)
    || !text(value.completedAt) || !Number.isSafeInteger(value.revision) || !(value.status==="draft"||value.status==="complete")
    || activityHash(value.form)!==activityHash(form) || value.formSha256!==activityHash(form) || !object(value.answers)
    || !Array.isArray(value.evidence) || !Array.isArray(value.signatures) || !object(value.signerDefaults)
    || !text(value.signerDefaults.customer) || !text(value.signerDefaults.technician)) fail("PIESA_INTEGRITY","The saved assessment could not pass its integrity check.");
  const answers=normaliseActivityAnswers(form,value.answers);
  if(activityCanonical(answers)!==activityCanonical(value.answers)) fail("PIESA_INTEGRITY","The saved answers are invalid.");
  const evidence:ActivityEvidence[]=value.evidence.map(item=>{
    if(!object(item)||![item.id,item.fieldKey,item.fileName,item.contentType,item.sha256,item.objectKey,item.capturedAt,item.uploadedAt].every(text)
      ||typeof item.size!=="number"||item.size<5||item.size>8*1024*1024||item.metadataOrigin!=="file_upload"
      ||item.latitude!==null||item.longitude!==null||item.accuracy!==null) fail("PIESA_INTEGRITY","The saved attachments are invalid.");
    return {id:String(item.id),fieldKey:String(item.fieldKey),fileName:String(item.fileName),contentType:String(item.contentType),size:item.size,
      sha256:String(item.sha256),objectKey:String(item.objectKey),capturedAt:String(item.capturedAt),uploadedAt:String(item.uploadedAt),metadataOrigin:"file_upload",latitude:null,longitude:null,accuracy:null};
  });
  const signatures:ActivitySignature[]=value.signatures.map(item=>{
    if(!object(item)||![item.id,item.declarationKey,item.signerName,item.declarationText,item.declarationSha256,item.scopeSha256,item.signedAt,item.actorUid].every(text)
      ||!(item.role==="customer"||item.role==="technician"||item.role==="other")||!(item.phase==="before"||item.phase==="after")) fail("PIESA_INTEGRITY","The saved signatures are invalid.");
    return {id:String(item.id),declarationKey:String(item.declarationKey),signerName:String(item.signerName),declarationText:String(item.declarationText),
      declarationSha256:String(item.declarationSha256),scopeSha256:String(item.scopeSha256),signedAt:String(item.signedAt),actorUid:String(item.actorUid),
      role:item.role,phase:item.phase,strokes:validateActivityStrokes(item.strokes)};
  });
  const attestation=value.initialAttestation;
  let initialAttestation:PiesaRecord["initialAttestation"];
  if(attestation!==undefined){
    if(!object(attestation)||!text(attestation.actorUid)||!attestation.actorUid||!text(attestation.confirmedAt)||!Number.isFinite(Date.parse(attestation.confirmedAt))||!text(attestation.scopeSha256)||!/^[a-f0-9]{64}$/.test(attestation.scopeSha256))fail("PIESA_INTEGRITY","The initial declaration audit is invalid.");
    initialAttestation={actorUid:attestation.actorUid,confirmedAt:attestation.confirmedAt,scopeSha256:attestation.scopeSha256};
  }
  return {id:row.id,ownerUid:row.owner_uid,workOrderId:row.work_order_id,recordNumber:value.recordNumber,revision:Number(row.revision),status:value.status,
    form,formSha256:activityHash(form),answers,evidence,signatures,signerDefaults:{customer:value.signerDefaults.customer,technician:value.signerDefaults.technician},
    ...(initialAttestation?{initialAttestation}:{}),
    createdAt:value.createdAt,updatedAt:value.updatedAt,completedAt:value.completedAt};
}
async function stored(access:TeamAccess,id:string,mutate=false) {
  const row=await getD1().prepare("SELECT * FROM trade_veu_electrical_assessments WHERE id=? AND owner_uid=?").bind(identifier(id),access.ownerUid).first<Row>();
  if(!row) fail("PIESA_NOT_FOUND","This assessment was not found in your business.",404);
  await scope(access,row.work_order_id,mutate);
  return {row,record:parse(row)};
}
export async function readPiesaRecord(access:TeamAccess,id:string) {return (await stored(access,id)).record;}
export async function listPiesaRecords(access:TeamAccess,workOrderId:string) {
  await scope(access,workOrderId);
  const rows=await getD1().prepare("SELECT * FROM trade_veu_electrical_assessments WHERE work_order_id=? AND owner_uid=? ORDER BY created_at").bind(workOrderId,access.ownerUid).all<Row>();
  return Promise.all(rows.results.map(row=>piesaPresentation(access,parse(row))));
}
async function recipients(ownerUid:string,workOrderId:string) {
  const row=await getD1().prepare(`SELECT a.email business_email,c.email customer_email,d.customer_source,w.source_type
    FROM trade_work_orders w JOIN trade_accounts a ON a.firebase_uid=w.firebase_uid
    LEFT JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
    LEFT JOIN trade_crm_customers c ON c.id=d.crm_customer_id AND c.firebase_uid=w.firebase_uid AND c.record_status='active'
    WHERE w.id=? AND w.firebase_uid=? AND w.record_status='active' AND w.partner_type='installer'`)
    .bind(workOrderId,ownerUid).first<{business_email:string;customer_email:string;customer_source:string;source_type:string}>();
  return {business:email(row?.business_email),customer:row && row.source_type!=="opportunity" && ["trade_owned","public_lead_released"].includes(row.customer_source)?email(row.customer_email):""};
}
async function piesaProfileDefaults(access:TeamAccess,workOrderId:string) {
  const db=getD1(),guard=currentAccess(access,false);
  const context=await db.prepare(`SELECT w.work_number,c.first_name,c.last_name,
      site.address_line_1,site.address_line_2,site.suburb,site.address_state,site.postcode,
      account.business_name,COALESCE(NULLIF(account.document_phone,''),account.phone) business_phone
    FROM trade_work_orders w JOIN trade_accounts account ON account.firebase_uid=w.firebase_uid
    LEFT JOIN trade_crm_job_details details ON details.work_order_id=w.id AND details.firebase_uid=w.firebase_uid
      AND w.source_type<>'opportunity' AND details.customer_source IN ('trade_owned','public_lead_released')
    LEFT JOIN trade_crm_customers c ON c.id=details.crm_customer_id AND c.firebase_uid=w.firebase_uid AND c.record_status='active'
    LEFT JOIN trade_crm_service_sites site ON site.id=details.service_site_id AND site.firebase_uid=w.firebase_uid
      AND site.customer_id=c.id AND site.record_status='active'
    WHERE w.id=? AND w.firebase_uid=? AND w.partner_type='installer' AND w.record_status='active' AND ${guard.sql}`)
    .bind(workOrderId,access.ownerUid,...guard.values)
    .first<{work_number:string;first_name:string;last_name:string;address_line_1:string;address_line_2:string;suburb:string;
      address_state:string;postcode:string;business_name:string;business_phone:string}>();
  if(!context)fail("PIESA_ACCESS_REQUIRED","Your current business or job access does not include this assessment.",403);
  const now=stamp();
  // A saved individual identity is editable; a licence additionally needs its
  // current supporting credential. Neither is a finding about this property.
  const technician=await db.prepare(`SELECT member.first_name,member.last_name,credential.credential_number
    FROM trade_team_members member LEFT JOIN trade_team_member_credentials credential
      ON credential.team_member_id=member.id AND credential.owner_uid=member.owner_uid
      AND credential.rental_gate='licensed_electrician' AND credential.credential_type IN ('licence','registration')
      AND credential.status='active' AND trim(credential.credential_number)<>'' AND credential.jurisdiction IN ('VIC','NATIONAL')
      AND credential.expires_at<>'' AND date(credential.expires_at)>=date(?)
      AND EXISTS(SELECT 1 FROM trade_team_member_files file WHERE file.id=credential.file_id
        AND file.owner_uid=member.owner_uid AND file.team_member_id=member.id AND file.status='active'
        AND file.expires_at<>'' AND date(file.expires_at)>=date(?))
    WHERE member.id=? AND member.owner_uid=? AND member.status='active'
      AND trim(member.first_name)<>'' AND trim(member.last_name)<>''
      AND (member.member_uid=? OR (?<>'' AND ?='field-member:'||member.id AND EXISTS(SELECT 1 FROM trade_field_sessions session
        WHERE session.id=? AND session.owner_uid=member.owner_uid AND session.team_member_id=member.id AND session.status='active' AND session.expires_at>?)))
    ORDER BY credential.updated_at DESC,credential.id DESC LIMIT 1`)
    .bind(now,now,access.memberId,access.ownerUid,access.actorUid,access.fieldSessionId||"",access.actorUid,access.fieldSessionId||"",now)
    .first<{first_name:string;last_name:string;credential_number:string|null}>();
  const answers:ActivityAnswers={};
  const add=(key:string,value:string)=>{if(value.trim())answers[key]=value.trim();};
  add("job_reference",context.work_number||"");
  add("property_address",[context.address_line_1,context.address_line_2,context.suburb,context.address_state,context.postcode].filter(Boolean).join(", "));
  add("owner_name",[context.first_name,context.last_name].filter(Boolean).join(" "));
  if(technician){
    add("initial_electrician_name",[technician.first_name,technician.last_name].map(value=>value.trim()).join(" "));
    add("initial_electrician_licence",technician.credential_number||"");
  }
  return {answers,businessContactSuggestion:{name:(context.business_name||"").trim(),phone:(context.business_phone||"").trim()}};
}
function blankPiesaDefaults(record:PiesaRecord,defaults:ActivityAnswers):ActivityAnswers {
  if(record.status!=="draft"||record.signatures.length||record.initialAttestation)return {};
  return Object.fromEntries(Object.entries(defaults).filter(([key])=>{
    const value=record.answers[key];
    // Keep a manually entered electrician and licence together. Another user's
    // otherwise valid profile must never supply the missing half of that pair.
    const otherKey=key==="initial_electrician_name"?"initial_electrician_licence":key==="initial_electrician_licence"?"initial_electrician_name":"";
    if(otherKey&&String(record.answers[otherKey]||"").trim()
      &&String(record.answers[otherKey]).trim().toLocaleLowerCase("en-AU")!==String(defaults[otherKey]||"").trim().toLocaleLowerCase("en-AU"))return false;
    return value===undefined||typeof value==="string"&&!value.trim();
  }));
}
export async function startPiesaRecord(access:TeamAccess,workOrderId:string) {
  const job=await scope(access,workOrderId,true),db=getD1();await ensurePiesaSchemaGuards(db);
  const existing=await db.prepare("SELECT * FROM trade_veu_electrical_assessments WHERE work_order_id=? AND owner_uid=?").bind(workOrderId,access.ownerUid).first<Row>();
  if(existing)return parse(existing);
  const defaults=await piesaProfileDefaults(access,workOrderId),form=createVeuElectricalForm(),now=stamp(),id=crypto.randomUUID();
  const record:PiesaRecord={id,workOrderId,ownerUid:access.ownerUid,recordNumber:`PIESA-${id.slice(0,8).toUpperCase()}`,revision:1,status:"draft",form,formSha256:activityHash(form),
    answers:defaults.answers,evidence:[],signatures:[],signerDefaults:{customer:String(defaults.answers.owner_name||""),technician:String(defaults.answers.initial_electrician_name||"")},createdAt:now,updatedAt:now,completedAt:""};
  const payload=activityCanonical(record);
  await scope(access,workOrderId,true);
  const guard=currentAccess(access,true);
  await db.prepare(`INSERT OR IGNORE INTO trade_veu_electrical_assessments(id,work_order_id,owner_uid,revision,status,payload,payload_sha256,actor_uid,created_at,updated_at)
    SELECT ?,?,?,1,'draft',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM trade_work_orders w WHERE w.id=? AND w.firebase_uid=? AND w.revision=? AND w.record_status='active' AND w.stage NOT IN ('imported','cancelled','completed') AND ${guard.sql})`)
    .bind(id,workOrderId,access.ownerUid,payload,activityHash(payload),access.actorUid,now,now,workOrderId,access.ownerUid,job.revision,...guard.values).run();
  const saved=await db.prepare("SELECT * FROM trade_veu_electrical_assessments WHERE work_order_id=? AND owner_uid=?").bind(workOrderId,access.ownerUid).first<Row>();
  if(!saved)fail("PIESA_REVISION_CONFLICT","This job changed. Open the assessment again.");
  return parse(saved);
}
type MutationSnapshotRow = Row & { current_write_access:number; mutation_key:string|null; mutation_actor_uid:string|null;
  mutation_operation:Mutation|null; mutation_base_revision:number|null; mutation_result_revision:number|null;
  mutation_request_sha256:string|null; mutation_record_sha256:string|null };
async function mutationSnapshot(access:TeamAccess,id:string,key:string,expectedMutation:{operation:Mutation;baseRevision:number;requestSha256?:string}) {
  const guard=currentAccess(access,true);
  // The receipt, record and live write authority must describe the same database snapshot.
  // Closed jobs may recover an exact receipt; only commit() can change an open draft.
  const row=await getD1().prepare(`SELECT a.*,EXISTS(SELECT 1 FROM trade_work_orders w WHERE w.id=a.work_order_id AND w.firebase_uid=a.owner_uid
      AND w.record_status='active' AND w.partner_type='installer' AND ${guard.sql}) AS current_write_access,
      m.request_key AS mutation_key,m.actor_uid AS mutation_actor_uid,m.operation AS mutation_operation,
      m.base_revision AS mutation_base_revision,m.result_revision AS mutation_result_revision,
      m.request_sha256 AS mutation_request_sha256,m.record_sha256 AS mutation_record_sha256
    FROM trade_veu_electrical_assessments a LEFT JOIN trade_veu_electrical_mutations m
      ON m.record_id=a.id AND m.owner_uid=a.owner_uid AND m.request_key=? WHERE a.id=? AND a.owner_uid=?`)
    .bind(...guard.values,identifier(key),identifier(id),access.ownerUid).first<MutationSnapshotRow>();
  if(!row)fail("PIESA_NOT_FOUND","This assessment was not found in your business.",404);
  if(!access.canViewFieldEvidence||!access.canManageFieldEvidence||!row.current_write_access)
    fail("PIESA_ACCESS_REQUIRED","Your current business or job access does not include this assessment.",403);
  const record=parse(row);
  if(row.mutation_key===null)return {record,receipt:null};
  if(row.mutation_actor_uid!==access.actorUid||row.mutation_operation!==expectedMutation.operation||row.mutation_base_revision!==expectedMutation.baseRevision
    ||expectedMutation.requestSha256 && expectedMutation.requestSha256!==row.mutation_request_sha256||record.revision!==row.mutation_result_revision||row.payload_sha256!==row.mutation_record_sha256)
    fail("PIESA_REQUEST_CONFLICT","This request or the assessment changed. Refresh its saved result.");
  if(row.mutation_request_sha256===null)fail("PIESA_REQUEST_CONFLICT","This request or the assessment changed. Refresh its saved result.");
  const receipt:PiesaMutationReceipt={recordId:id,operation:row.mutation_operation,baseRevision:row.mutation_base_revision,resultRevision:row.mutation_result_revision,
    requestSha256:row.mutation_request_sha256,recordSha256:row.mutation_record_sha256,actorUid:row.mutation_actor_uid};
  return {record,receipt};
}
export async function readPiesaMutationReceipt(access:TeamAccess,id:string,key:string,expectedMutation:{operation:Mutation;baseRevision:number;requestSha256?:string}) {
  return (await mutationSnapshot(access,id,key,expectedMutation)).receipt;
}
async function replay(access:TeamAccess,id:string,key:string,operation:Mutation,base:number,hash:string) {
  const saved=await mutationSnapshot(access,id,key,{operation,baseRevision:base,requestSha256:hash});
  return saved.receipt?saved.record:null;
}
async function commit(access:TeamAccess,previous:PiesaRecord,next:PiesaRecord,operation:Mutation,key:string,requestHash:string,
  pdf?:{key:string;hash:string;size:number},deliverTo?:Awaited<ReturnType<typeof recipients>>) {
  const db=getD1();await ensurePiesaSchemaGuards(db);await scope(access,previous.workOrderId,true);
  next={...next,revision:previous.revision+1,updatedAt:operation==="complete"?next.updatedAt:stamp()};const payload=activityCanonical(next),hash=activityHash(payload);
  const guard=currentAccess(access,true);
  const update=db.prepare(`UPDATE trade_veu_electrical_assessments SET revision=?,status=?,payload=?,payload_sha256=?,actor_uid=?,updated_at=?,completed_at=?,pdf_object_key=?,pdf_sha256=?,pdf_size_bytes=?
    WHERE id=? AND owner_uid=? AND revision=? AND status='draft' AND EXISTS(SELECT 1 FROM trade_work_orders w WHERE w.id=work_order_id AND w.firebase_uid=owner_uid
      AND w.record_status='active' AND w.stage NOT IN ('imported','cancelled','completed') AND ${guard.sql})`).bind(next.revision,next.status,payload,hash,access.actorUid,next.updatedAt,next.completedAt,pdf?.key||"",pdf?.hash||"",pdf?.size||0,previous.id,access.ownerUid,previous.revision,...guard.values);
  const statements=[update,db.prepare(`INSERT OR IGNORE INTO trade_veu_electrical_mutations(record_id,owner_uid,request_key,actor_uid,operation,base_revision,result_revision,request_sha256,record_sha256,created_at)
    SELECT id,owner_uid,?,?,?,?,?,?,?,? FROM trade_veu_electrical_assessments WHERE id=? AND owner_uid=? AND revision=? AND payload_sha256=? AND actor_uid=?`)
    .bind(key,access.actorUid,operation,previous.revision,next.revision,requestHash,hash,next.updatedAt,previous.id,access.ownerUid,next.revision,hash,access.actorUid)];
  if(deliverTo) for(const role of ["customer","business"] as const) statements.push(db.prepare(`INSERT OR IGNORE INTO trade_veu_electrical_deliveries(record_id,owner_uid,recipient_role,recipient_email,status,error_code,updated_at)
    SELECT id,owner_uid,?,?,?,?,? FROM trade_veu_electrical_assessments WHERE id=? AND owner_uid=? AND status='complete' AND payload_sha256=?`)
    .bind(role,deliverTo[role],deliverTo[role]?"queued":"blocked",deliverTo[role]?"":"RECIPIENT_MISSING",next.updatedAt,previous.id,access.ownerUid,hash));
  try{await db.batch(statements);}catch(error){
    const recovered=await replay(access,previous.id,key,operation,previous.revision,requestHash);if(recovered)return recovered;throw error;
  }
  const recovered=await replay(access,previous.id,key,operation,previous.revision,requestHash);
  if(!recovered)fail("PIESA_REVISION_CONFLICT","This assessment changed elsewhere. Refresh before saving.");
  return recovered;
}
function signedScope(previous:PiesaRecord,next:PiesaRecord) {
  for(const signature of previous.signatures) if(activitySigningScope(previous,signature.phase)!==activitySigningScope(next,signature.phase)) fail("PIESA_SIGNED_SCOPE_LOCKED","These details have been signed and cannot be changed.");
}
export function piesaMutationRequestHash(record:PiesaRecord,baseRevision:number,operation:"save"|"complete",answers?:unknown) {
  return operation==="save"?activityHash({operation,baseRevision,answers:normaliseActivityAnswers(record.form,answers)}):activityHash({operation,baseRevision});
}
export async function savePiesaAnswers(access:TeamAccess,id:string,baseRevision:number,raw:unknown,keyInput?:string):Promise<PiesaRecord> {
  const key=requestKey(keyInput),previous=await readPiesaRecord(access,id),answers=normaliseActivityAnswers(previous.form,raw);
  const requestHash=activityHash({operation:"save",baseRevision,answers}),duplicate=await replay(access,id,key,"save",baseRevision,requestHash);if(duplicate)return duplicate;
  expected(previous,baseRevision);
  const next={...previous,answers};
  if(answers.initial_correct===true && previous.answers.initial_correct!==true) fail("PIESA_INITIAL_ATTESTATION_REQUIRED","Review and confirm the initial assessment declaration in its own control.",400);
  const beforeChanged=activitySigningScope(previous,"before")!==activitySigningScope(next,"before");
  if(beforeChanged){delete next.initialAttestation;if(previous.answers.initial_correct===true)next.answers={...answers,initial_correct:false};}
  signedScope(previous,next);
  return commit(access,previous,next,"save",key,requestHash);
}
export async function attestPiesaInitial(access:TeamAccess,id:string,baseRevision:number,scopeSha256:string,accepted:unknown,keyInput?:string) {
  const key=requestKey(keyInput),hash=activityHash({operation:"attest_initial",baseRevision,scopeSha256,accepted}),duplicate=await replay(access,id,key,"attest_initial",baseRevision,hash);if(duplicate)return duplicate;
  const previous=await readPiesaRecord(access,id);expected(previous,baseRevision);
  if(accepted!==true||scopeSha256!==activitySigningScope(previous,"before")) fail("PIESA_SIGNING_SCOPE_CHANGED","Review the current initial assessment before confirming it.");
  if(previous.answers.initial_correct===true&&previous.initialAttestation?.scopeSha256===scopeSha256)fail("PIESA_ALREADY_ATTESTED","The current initial assessment declaration has already been recorded.");
  const next:PiesaRecord={...previous,answers:{...previous.answers,initial_correct:true}};
  if(activityMissing(next,"before",false).length)fail("PIESA_INITIAL_INCOMPLETE","Complete the initial assessment answers and attachments first.");
  next.initialAttestation={actorUid:access.actorUid,confirmedAt:stamp(),scopeSha256:activitySigningScope(next,"before")};
  signedScope(previous,next);return commit(access,previous,next,"attest_initial",key,hash);
}
export async function signPiesaDeclaration(access:TeamAccess,id:string,baseRevision:number,input:{declarationKey:string;signerName:string;strokes:unknown;scopeSha256:string;accepted:unknown},keyInput?:string) {
  const key=requestKey(keyInput),hash=activityHash({operation:"sign",baseRevision,...input}),duplicate=await replay(access,id,key,"sign",baseRevision,hash);if(duplicate)return duplicate;
  const previous=await readPiesaRecord(access,id);expected(previous,baseRevision);
  const declaration=previous.form.declarations.find(item=>item.key===input.declarationKey);
  if(!declaration||!activityConditionMet(declaration.condition,previous.answers,previous.form)||input.accepted!==true) fail("PIESA_DECLARATION_INVALID","Review this assessment's current declaration before signing.",400);
  if(input.scopeSha256!==activitySigningScope(previous,declaration.phase))fail("PIESA_SIGNING_SCOPE_CHANGED","The assessment changed. Review it before signing again.");
  if(previous.signatures.some(item=>item.declarationKey===declaration.key))fail("PIESA_ALREADY_SIGNED","This declaration already has its recorded signature.");
  if(veuElectricalCompletion(previous).missing.some(item=>item.kind!=="signature"))fail("PIESA_SIGNING_NOT_READY","Complete the assessment answers, attachments and initial declaration, and resolve its outcome before signing.");
  const field=Object.entries(VEU_ELECTRICAL_SIGNER_FIELDS).find(([key])=>key===declaration.key)?.[1];
  const name=input.signerName?.trim();
  if(!field||!name||name.length>180||name!==String(previous.answers[field]||"").trim())fail("PIESA_SIGNER_MISMATCH","Use the name recorded for this declaration's actual signer.",400);
  const declarationText=activityDeclarationText(declaration,previous.answers),signature:ActivitySignature={id:crypto.randomUUID(),declarationKey:declaration.key,signerName:name,
    role:declaration.role,phase:declaration.phase,declarationText,declarationSha256:activityHash(declarationText),scopeSha256:input.scopeSha256,signedAt:stamp(),actorUid:access.actorUid,strokes:validateActivityStrokes(input.strokes)};
  return commit(access,previous,{...previous,signatures:[...previous.signatures,signature]},"sign",key,hash);
}
export async function readPiesaEvidence(access:TeamAccess,id:string,evidenceId:string) {
  const record=await readPiesaRecord(access,id),item=record.evidence.find(item=>item.id===evidenceId);
  if(!item||!item.objectKey.startsWith(`piesa/${access.ownerUid}/${id}/evidence/`))fail("PIESA_EVIDENCE_NOT_FOUND","This attachment was not found.",404);
  const object=await bucket().get(item.objectKey);if(!object)fail("PIESA_EVIDENCE_UNAVAILABLE","This attachment is unavailable.",503);
  const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.length!==item.size||activityHash(bytes)!==item.sha256)fail("PIESA_EVIDENCE_INTEGRITY","This attachment failed its integrity check.");
  return {bytes,contentType:item.contentType,fileName:item.fileName};
}
export async function uploadPiesaEvidence(access:TeamAccess,id:string,baseRevision:number,fieldKey:string,file:File,keyInput?:string) {
  const previous=await readPiesaRecord(access,id);
  const field=expandedActivityFields(previous.form,previous.answers).find(item=>item.key===fieldKey);
  if(!field||!["photo","document"].includes(field.type)||file.size<5||file.size>8*1024*1024)fail("PIESA_FILE_INVALID","Choose a required PDF, JPEG or PNG attachment up to 8 MB.",400);
  const bytes=new Uint8Array(await file.arrayBuffer()),signature=new TextDecoder().decode(bytes.slice(0,5));
  const contentType=signature==="%PDF-"?"application/pdf":bytes[0]===0xff&&bytes[1]===0xd8?"image/jpeg":bytes[0]===0x89&&bytes[1]===0x50?"image/png":"";
  if(!contentType||field.type==="photo"&&contentType==="application/pdf")fail("PIESA_FILE_INVALID","Use the actual supported document or image format.",400);
  const {validateActivityEvidenceBytes}=await import("./trade-activity-forms-pdf");await validateActivityEvidenceBytes(bytes,contentType);
  const key=requestKey(keyInput),hash=activityHash({operation:"upload",baseRevision,fieldKey,sha256:activityHash(bytes)}),duplicate=await replay(access,id,key,"upload",baseRevision,hash);if(duplicate)return duplicate;
  expected(previous,baseRevision);
  if(previous.evidence.length>=12)fail("PIESA_FILE_INVALID","This assessment already has its maximum 12 attachments.",400);
  const eid=crypto.randomUUID(),now=stamp(),objectKey=`piesa/${access.ownerUid}/${id}/evidence/${eid}/${activityHash(bytes)}`;
  const item:ActivityEvidence={id:eid,fieldKey,fileName:file.name.replace(/[\r\n\x00-\x1f]/g,"").slice(0,180)||"Assessment attachment",contentType,size:bytes.length,sha256:activityHash(bytes),objectKey,
    capturedAt:"",uploadedAt:now,latitude:null,longitude:null,accuracy:null,metadataOrigin:"file_upload"};
  const next={...previous,evidence:[...previous.evidence,item]};
  if(activitySigningScope(previous,"before")!==activitySigningScope(next,"before")){delete next.initialAttestation;if(previous.answers.initial_correct===true)next.answers={...next.answers,initial_correct:false};}
  signedScope(previous,next);
  await scope(access,previous.workOrderId,true);await bucket().put(objectKey,bytes,{httpMetadata:{contentType},customMetadata:{sha256:item.sha256,assessmentId:id}});
  return commit(access,previous,next,"upload",key,hash);
}
export async function completePiesaRecord(access:TeamAccess,id:string,baseRevision:number,keyInput?:string):Promise<PiesaRecord> {
  const key=requestKey(keyInput),hash=activityHash({operation:"complete",baseRevision}),duplicate=await replay(access,id,key,"complete",baseRevision,hash);
  if(duplicate){await reconcileTradeFormJobProgress(access,duplicate.workOrderId,{afterSave:true});await retryPiesaDelivery(access,id);return duplicate;}
  const previous=await readPiesaRecord(access,id);expected(previous,baseRevision);
  const completion=veuElectricalCompletion(previous);if(!completion.ready)fail("PIESA_INCOMPLETE",`Complete the required assessment items: ${completion.missing.map(item=>item.label).join("; ")}`);
  await scope(access,previous.workOrderId,true);
  const assets=new Map<string,Uint8Array>();for(const item of previous.evidence)assets.set(item.id,(await readPiesaEvidence(access,id,item.id)).bytes);
  const now=stamp(),next:PiesaRecord={...previous,status:"complete",completedAt:now,revision:previous.revision+1,updatedAt:now};
  const [{renderVeuElectricalSafetyPdf},{loadCustomerPlanPdfFonts}]=await Promise.all([import("./veu-electrical-safety-pdf"),import("./customer-plan-pdf-fonts")]);
  const bytes=await renderVeuElectricalSafetyPdf(next,assets,await loadCustomerPlanPdfFonts());
  if(bytes.length<5||bytes.length>12*1024*1024||new TextDecoder().decode(bytes.slice(0,5))!=="%PDF-")fail("PIESA_PDF_INVALID","The completed PDF could not be prepared.");
  const pdfHash=activityHash(bytes),pdfKey=`piesa/${access.ownerUid}/${id}/completed/${next.revision}/${pdfHash}.pdf`;
  await bucket().put(pdfKey,bytes,{httpMetadata:{contentType:"application/pdf"},customMetadata:{sha256:pdfHash,assessmentId:id,revision:String(next.revision),retention:"immutable-completed-assessment"}});
  const contacts=await recipients(access.ownerUid,previous.workOrderId);
  const saved=await commit(access,previous,next,"complete",key,hash,{key:pdfKey,hash:pdfHash,size:bytes.length},contacts);
  await reconcileTradeFormJobProgress(access,saved.workOrderId,{afterSave:true});
  await retryPiesaDelivery(access,id);return saved;
}
export async function readPiesaPdf(access:TeamAccess,id:string) {
  const {row,record}=await stored(access,id);
  if(record.status!=="complete"||!row.pdf_object_key.startsWith(`piesa/${access.ownerUid}/${id}/completed/`))fail("PIESA_PDF_NOT_READY","Complete the assessment before opening its final PDF.");
  const object=await bucket().get(row.pdf_object_key);if(!object)fail("PIESA_PDF_UNAVAILABLE","The saved PDF is unavailable. The completed record is retained.",503);
  const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.length!==row.pdf_size_bytes||activityHash(bytes)!==row.pdf_sha256)fail("PIESA_PDF_INTEGRITY","The saved PDF failed its integrity check.");
  return {bytes,contentType:"application/pdf",fileName:`${record.recordNumber}.pdf`};
}
type DeliveryRow={recipient_role:PiesaDeliveryRole;recipient_email:string;status:PiesaDelivery["status"];error_code:string;lease_token:string;lease_expires_at:string;accepted_at:string};
const deliveryKey=(id:string,role:PiesaDeliveryRole)=>`piesa:${id}:${role}:v1`;
async function deliveryRows(access:TeamAccess,id:string) {return (await getD1().prepare("SELECT * FROM trade_veu_electrical_deliveries WHERE record_id=? AND owner_uid=? ORDER BY recipient_role").bind(id,access.ownerUid).all<DeliveryRow>()).results;}
function deliveryMessage(row:DeliveryRow) {
  if(row.status==="accepted")return "The email was accepted by the delivery provider.";
  if(row.status==="reconciliation_required")return "Delivery is uncertain. Check the outgoing mailbox before sending again.";
  if(row.status==="blocked")return row.error_code==="RECIPIENT_MISSING"?"Add a valid email address to the job customer or business profile, then retry delivery.":"The recipient or business access changed. Review the saved contact details before delivery.";
  if(row.status==="failed")return "The completed PDF is saved. Email delivery failed and can be retried.";
  return row.status==="sending"?"The email is being sent.":"The completed PDF is queued for email.";
}
export async function piesaPresentation(access:TeamAccess,record:PiesaRecord):Promise<PiesaPresentation> {
  await scope(access,record.workOrderId);const {ownerUid,evidence,...publicRecord}=record;void ownerUid;
  const completion=veuElectricalCompletion(record);
  const editable=access.canManageFieldEvidence&&record.status==="draft"&&!record.signatures.length&&!record.initialAttestation;
  const defaults=editable?await piesaProfileDefaults(access,record.workOrderId):null;
  if(defaults)await scope(access,record.workOrderId);
  const prefillAnswers=defaults?blankPiesaDefaults(record,defaults.answers):{};
  return {...publicRecord,evidence:evidence.map(({objectKey,previewObjectKey,...item})=>{void objectKey;void previewObjectKey;return item;}),missing:completion.missing,ready:completion.ready,
    prefillAnswers,
    ...(defaults?{businessContactSuggestion:defaults.businessContactSuggestion,
      signerDefaults:{customer:String(record.answers.owner_name||prefillAnswers.owner_name||""),technician:String(record.answers.initial_electrician_name||prefillAnswers.initial_electrician_name||"")}}:{}),
    signingScopes:{before:activitySigningScope(record,"before"),after:activitySigningScope(record,"after")},signerFields:VEU_ELECTRICAL_SIGNER_FIELDS,reportUrl:record.status==="complete"?`${API}?recordId=${encodeURIComponent(record.id)}&view=pdf`:"",
    delivery:(await deliveryRows(access,record.id)).map(row=>({role:row.recipient_role,status:row.status,message:deliveryMessage(row),acceptedAt:row.accepted_at}))};
}
export async function retryPiesaDelivery(access:TeamAccess,id:string) {
  const {record}=await stored(access,id);await scope(access,record.workOrderId,true,true);
  if(record.status!=="complete")fail("PIESA_PDF_NOT_READY","Complete the assessment first.");
  const db=getD1();const pdf=await readPiesaPdf(access,id);
  let binary="";for(let i=0;i<pdf.bytes.length;i+=8192)binary+=String.fromCharCode(...pdf.bytes.subarray(i,i+8192));
  for(const row of await deliveryRows(access,id)) {
    if(row.status==="accepted"||row.status==="reconciliation_required")continue;
    const now=stamp(),key=deliveryKey(id,row.recipient_role);
    const proof=await db.prepare("SELECT status,provider,provider_message_id FROM trade_email_submissions WHERE owner_uid=? AND request_key=?").bind(access.ownerUid,key).first<{status:string;provider:string;provider_message_id:string}>();
    if(proof?.status==="accepted") {await db.prepare("UPDATE trade_veu_electrical_deliveries SET status='accepted',provider=?,provider_message_id=?,accepted_at=?,lease_token='',lease_expires_at='',updated_at=? WHERE record_id=? AND owner_uid=? AND recipient_role=?")
      .bind(proof.provider,proof.provider_message_id,now,now,id,access.ownerUid,row.recipient_role).run();continue;}
    if(proof && ["sending","uncertain"].includes(proof.status)) {await db.prepare("UPDATE trade_veu_electrical_deliveries SET status='reconciliation_required',error_code='EMAIL_SEND_UNCERTAIN',updated_at=? WHERE record_id=? AND owner_uid=? AND recipient_role=?")
      .bind(now,id,access.ownerUid,row.recipient_role).run();continue;}
    if(row.status==="sending"&&row.lease_expires_at>now)continue;
    const contacts=await recipients(access.ownerUid,record.workOrderId),target=contacts[row.recipient_role];
    if(!target||row.recipient_email&&row.recipient_email!==target) {await db.prepare("UPDATE trade_veu_electrical_deliveries SET status='blocked',error_code=?,updated_at=? WHERE record_id=? AND owner_uid=? AND recipient_role=?")
      .bind(!target?"RECIPIENT_MISSING":"RECIPIENT_CHANGED",now,id,access.ownerUid,row.recipient_role).run();continue;}
    const lease=crypto.randomUUID(),expires=new Date(Date.now()+120000).toISOString();
    const claimed=await db.prepare(`UPDATE trade_veu_electrical_deliveries SET status='sending',recipient_email=?,lease_token=?,lease_expires_at=?,error_code='',updated_at=?
      WHERE record_id=? AND owner_uid=? AND recipient_role=? AND status NOT IN ('accepted','reconciliation_required') AND (status<>'sending' OR lease_expires_at<=?)`)
      .bind(target,lease,expires,now,id,access.ownerUid,row.recipient_role,now).run();if(!claimed.meta.changes)continue;
    let transport=false;
    try {
      const beforeSend=async()=>{
        await scope(access,record.workOrderId,true,true);
        const fresh=await recipients(access.ownerUid,record.workOrderId);if(fresh[row.recipient_role]!==target)fail("PIESA_RECIPIENT_CHANGED","The report recipient changed.");
        const held=await db.prepare("SELECT 1 FROM trade_veu_electrical_deliveries WHERE record_id=? AND owner_uid=? AND recipient_role=? AND status='sending' AND lease_token=? AND lease_expires_at>?")
          .bind(id,access.ownerUid,row.recipient_role,lease,stamp()).first();if(!held)fail("PIESA_DELIVERY_CHANGED","This delivery changed elsewhere.");
      };
      await beforeSend();transport=true;
      const sent=await sendTradeCustomerEmail(access.ownerUid,access.actorUid,{channel:"email",recipient:target,
        subject:`${record.recordNumber} | Pre-installation electrical safety assessment`,
        body:`The completed pre-installation electrical safety assessment ${record.recordNumber} is attached. Read the recorded outcome, conditions and required controls in the assessment before arranging insulation work. Keep this document with the job records.`,
        attachments:[{filename:pdf.fileName,content:btoa(binary),contentType:"application/pdf"}],idempotencyKey:key,callbackUrl:"",messageType:"piesa_completed_assessment"},{db,beforeSend});
      await db.prepare("UPDATE trade_veu_electrical_deliveries SET status='accepted',provider=?,provider_message_id=?,accepted_at=?,lease_token='',lease_expires_at='',updated_at=? WHERE record_id=? AND owner_uid=? AND recipient_role=? AND lease_token=?")
        .bind(sent.provider,sent.providerMessageId,stamp(),stamp(),id,access.ownerUid,row.recipient_role,lease).run();
    } catch(error) {
      const journal=await db.prepare("SELECT status,provider,provider_message_id FROM trade_email_submissions WHERE owner_uid=? AND request_key=?").bind(access.ownerUid,key).first<{status:string;provider:string;provider_message_id:string}>();
      if(journal?.status==="accepted"){
        await db.prepare("UPDATE trade_veu_electrical_deliveries SET status='accepted',provider=?,provider_message_id=?,accepted_at=?,lease_token='',lease_expires_at='',updated_at=? WHERE record_id=? AND owner_uid=? AND recipient_role=? AND lease_token=?")
          .bind(journal.provider,journal.provider_message_id,stamp(),stamp(),id,access.ownerUid,row.recipient_role,lease).run();continue;
      }
      const uncertain=journal?.status==="sending"||journal?.status==="uncertain"||reminderProviderFailureOutcome(error)==="indeterminate"||transport&&!journal;
      const blocked=error instanceof PiesaError&&["PIESA_ACCESS_REQUIRED","PIESA_RECIPIENT_CHANGED"].includes(error.code);
      await db.prepare("UPDATE trade_veu_electrical_deliveries SET status=?,error_code=?,lease_token='',lease_expires_at='',updated_at=? WHERE record_id=? AND owner_uid=? AND recipient_role=? AND lease_token=?")
        .bind(uncertain?"reconciliation_required":blocked?"blocked":"failed",blocked?"RECIPIENT_CHANGED":"EMAIL_DELIVERY_FAILED",stamp(),id,access.ownerUid,row.recipient_role,lease).run();
    }
  }
  return piesaPresentation(access,await readPiesaRecord(access,id));
}
