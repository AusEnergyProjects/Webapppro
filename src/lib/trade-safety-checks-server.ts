import { env } from "cloudflare:workers";
import { getD1 } from "../../db";
import type { TeamAccess } from "./trade-team-server";
import { jobMemberSql } from "./trade-job-collaboration";
import { verifiedTradeAccountPredicate } from "./trade-account-predicates";
import { activityCanonical, activityConditionMet, activityDeclarationText, activityHash, activityMissing,
  activitySigningScope, normaliseActivityAnswers, validateActivityStrokes } from "./trade-activity-forms";
import { expandedActivityFields } from "./trade-activity-form-flow";
import type { ActivityEvidence, ActivitySignature } from "./trade-activity-form-types";
import { createOfficialSafetyCheckForm, OFFICIAL_SAFETY_SIGNER_FIELDS } from "./official-safety-check-forms";
import { SafetyCheckError, type SafetyCheckRecord, type SafetyCheckPresentation, type SafetyCheckDelivery, type SafetyCheckKind, type SafetyCheckBranding } from "./job-safety-check";
import { ensureSafetyCheckSchemaGuards } from "./trade-safety-check-schema-guards";
import { currentRentalModuleCredentialSnapshot, rentalModuleProfileAnswers, type RentalCredentialSnapshot } from "./trade-rental-credentials";
import { safetyCheckEmailDraft } from "./safety-check-email";
import { sendTradeCustomerEmail } from "./trade-email-server";
import { reminderProviderFailureOutcome } from "./service-reminder-delivery";
import { reconcileTradeFormJobProgress, type FormJobProgress } from "./trade-form-job-progress";

type Row = { kind:SafetyCheckKind;credential_snapshot:string;id:string;work_order_id:string;owner_uid:string;revision:number;status:string;payload:string;payload_sha256:string;
  pdf_object_key:string;pdf_sha256:string;pdf_size_bytes:number;actor_uid:string;created_at:string;updated_at:string;completed_at:string };
type Bucket = { get(key:string):Promise<{arrayBuffer():Promise<ArrayBuffer>}|null>;
  put(key:string,bytes:Uint8Array,options:{httpMetadata:{contentType:string};customMetadata:Record<string,string>}):Promise<unknown>;
  delete(key:string):Promise<void> };
type Mutation = "save"|"sign"|"upload"|"complete";
export type SafetyCheckMutationReceipt = { recordId:string;operation:Mutation;baseRevision:number;resultRevision:number;requestSha256:string;recordSha256:string;actorUid:string };
const API = "/api/trade-safety-checks";
const VICTORIAN_SERVICE_SITE_SQL=`EXISTS(SELECT 1 FROM trade_crm_job_details details
  JOIN trade_crm_service_sites site ON site.id=details.service_site_id AND site.firebase_uid=details.firebase_uid AND site.record_status='active'
  JOIN trade_crm_customers customer ON customer.id=details.crm_customer_id AND customer.firebase_uid=details.firebase_uid
    AND customer.id=site.customer_id AND customer.record_status='active'
  WHERE details.work_order_id=w.id AND details.firebase_uid=w.firebase_uid AND w.source_type<>'opportunity'
    AND details.customer_source IN ('trade_owned','public_lead_released') AND upper(trim(site.address_state))='VIC')`;
const stamp = () => new Date().toISOString();
const email = (value:unknown) => typeof value === "string" && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim()) ? value.trim().toLowerCase() : "";
const object = (value:unknown):value is Record<string,unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value:unknown):value is string => typeof value === "string";
function fail(code:string,message:string,status=409):never { throw new SafetyCheckError(status,code,message); }
function bucket():Bucket {
  const candidate:unknown = Reflect.get(env,"EVIDENCE");
  if (!object(candidate) || typeof candidate.get !== "function" || typeof candidate.put !== "function" || typeof candidate.delete !== "function") fail("SAFETY_CHECK_STORAGE_UNAVAILABLE","The secure file store is unavailable.",503);
  // The Cloudflare binding is an external typed interface, validated above.
  return candidate as Bucket;
}
function identifier(value:unknown):string {
  if (!text(value) || !/^[A-Za-z0-9:_-]{1,180}$/.test(value)) fail("SAFETY_CHECK_INPUT_INVALID","Choose this assessment from its job.",400);
  return value;
}
function requestKey(value?:string) { return value === undefined ? crypto.randomUUID() : identifier(value); }
function expected(record:SafetyCheckRecord,revision:unknown) {
  if (!Number.isSafeInteger(revision) || revision !== record.revision) fail("SAFETY_CHECK_REVISION_CONFLICT","This assessment changed. Refresh it before saving.");
  if (record.status !== "draft") fail("SAFETY_CHECK_COMPLETE_LOCKED","This completed assessment is locked.");
}
function currentAccess(access:TeamAccess,write:boolean) {
  if (access.supportWorkOrderId) return { sql: "w.id = ? AND w.firebase_uid = ? AND ? = 0", values: [access.supportWorkOrderId, access.ownerUid, write ? 1 : 0] };
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
  if (!(mutate ? access.canManageFieldEvidence : access.canViewFieldEvidence)) fail("SAFETY_CHECK_ACCESS_REQUIRED","Your access does not include this assessment.",403);
  const db=getD1();
  const guard=currentAccess(access,mutate);
  const job=await db.prepare(`SELECT w.id,w.stage,w.revision,${VICTORIAN_SERVICE_SITE_SQL} AS is_victorian_site FROM trade_work_orders w WHERE w.id=? AND w.firebase_uid=?
    AND w.record_status='active' AND w.partner_type='installer' AND ${guard.sql}`)
    .bind(identifier(workOrderId),access.ownerUid,...guard.values).first<{id:string;stage:string;revision:number;is_victorian_site:number}>();
  if(!job)fail("SAFETY_CHECK_ACCESS_REQUIRED","Your current business or job access does not include this assessment.",403);
  if (mutate && !allowClosed && ["imported","cancelled","completed"].includes(job.stage)) fail("SAFETY_CHECK_JOB_LOCKED","Start an active job before changing this assessment.");
  if (mutate && !allowClosed && !job.is_victorian_site) fail("SAFETY_CHECK_JURISDICTION_REQUIRED","The official safety check requires a current Victorian service address and an accessible job customer.",400);
  return job;
}
function parse(row:Row):SafetyCheckRecord {
  let value:unknown;try{value=JSON.parse(row.payload);}catch{fail("SAFETY_CHECK_INTEGRITY","The saved assessment could not pass its integrity check.");}
  const form=createOfficialSafetyCheckForm(row.kind);
  if (!object(value) || activityHash(row.payload)!==row.payload_sha256 || value.id!==row.id || value.workOrderId!==row.work_order_id
    || value.kind!==row.kind || value.ownerUid!==row.owner_uid || value.revision!==Number(row.revision) || value.status!==row.status
    || value.completedAt!==row.completed_at || !text(value.recordNumber) || !text(value.createdAt) || !text(value.updatedAt)
    || !text(value.completedAt) || !Number.isSafeInteger(value.revision) || !(value.status==="draft"||value.status==="complete")
    || activityHash(value.form)!==activityHash(form) || value.formSha256!==activityHash(form) || !object(value.answers)
    || !Array.isArray(value.evidence) || !Array.isArray(value.signatures) || !object(value.signerDefaults)
    || !text(value.signerDefaults.customer) || !text(value.signerDefaults.technician)) fail("SAFETY_CHECK_INTEGRITY","The saved assessment could not pass its integrity check.");
  const answers=normaliseActivityAnswers(form,value.answers);
  if(activityCanonical(answers)!==activityCanonical(value.answers)) fail("SAFETY_CHECK_INTEGRITY","The saved answers are invalid.");
  const evidence:ActivityEvidence[]=value.evidence.map(item=>{
    if(!object(item)||![item.id,item.fieldKey,item.fileName,item.contentType,item.sha256,item.objectKey,item.capturedAt,item.uploadedAt].every(text)
      ||typeof item.size!=="number"||item.size<5||item.size>8*1024*1024||item.metadataOrigin!=="file_upload"
      ||item.latitude!==null||item.longitude!==null||item.accuracy!==null) fail("SAFETY_CHECK_INTEGRITY","The saved attachments are invalid.");
    return {id:String(item.id),fieldKey:String(item.fieldKey),fileName:String(item.fileName),contentType:String(item.contentType),size:item.size,
      sha256:String(item.sha256),objectKey:String(item.objectKey),capturedAt:String(item.capturedAt),uploadedAt:String(item.uploadedAt),metadataOrigin:"file_upload",latitude:null,longitude:null,accuracy:null};
  });
  const signatures:ActivitySignature[]=value.signatures.map(item=>{
    if(!object(item)||![item.id,item.declarationKey,item.signerName,item.declarationText,item.declarationSha256,item.scopeSha256,item.signedAt,item.actorUid].every(text)
      ||!(item.role==="customer"||item.role==="technician"||item.role==="other")||!(item.phase==="before"||item.phase==="after")) fail("SAFETY_CHECK_INTEGRITY","The saved signatures are invalid.");
    return {id:String(item.id),declarationKey:String(item.declarationKey),signerName:String(item.signerName),declarationText:String(item.declarationText),
      declarationSha256:String(item.declarationSha256),scopeSha256:String(item.scopeSha256),signedAt:String(item.signedAt),actorUid:String(item.actorUid),
      role:item.role,phase:item.phase,strokes:validateActivityStrokes(item.strokes)};
  });
  if(value.status==="complete") {
    let credential:unknown;try{credential=JSON.parse(row.credential_snapshot);}catch{fail("SAFETY_CHECK_INTEGRITY","The inspector credential audit is invalid.");}
    const moduleKey=row.kind==="electrical"?"electrical_safety_check":"gas_safety_check",gate=row.kind==="electrical"?"licensed_electrician":"licensed_gasfitter";
    const name=(input:unknown)=>String(input||"").trim().replace(/\s+/g," ").toLocaleLowerCase("en-AU");
    if(!object(credential)||credential.schemaVersion!=="tlink-rental-module-credential-v1"||credential.moduleKey!==moduleKey||credential.gate!==gate
      ||credential.verificationBasis!=="manager_attested_document"||credential.confirmedAt!==value.completedAt||!text(credential.assessorMemberId)||!credential.assessorMemberId
      ||name(credential.assessorName)!==name(answers.inspector_name)||String(credential.credentialNumber||"").trim().toUpperCase()!==String(answers.inspector_licence||"").trim().toUpperCase()
      ||!text(credential.supportingFileSha256)||!/^[a-f0-9]{64}$/.test(credential.supportingFileSha256))fail("SAFETY_CHECK_INTEGRITY","The inspector credential audit is invalid.");
  }
  return {id:row.id,ownerUid:row.owner_uid,workOrderId:row.work_order_id,kind:row.kind,recordNumber:value.recordNumber,revision:Number(row.revision),status:value.status,
    form,formSha256:activityHash(form),answers,evidence,signatures,signerDefaults:{customer:value.signerDefaults.customer,technician:value.signerDefaults.technician},
    createdAt:value.createdAt,updatedAt:value.updatedAt,completedAt:value.completedAt};
}
async function stored(access:TeamAccess,id:string,mutate=false) {
  const row=await getD1().prepare("SELECT * FROM trade_safety_checks WHERE id=? AND owner_uid=?").bind(identifier(id),access.ownerUid).first<Row>();
  if(!row) fail("SAFETY_CHECK_NOT_FOUND","This assessment was not found in your business.",404);
  await scope(access,row.work_order_id,mutate);
  return {row,record:parse(row)};
}
export async function readSafetyCheckRecord(access:TeamAccess,id:string) {return (await stored(access,id)).record;}
/** Internal adapter for the separately authorised, immutable customer-report capability. */
export async function completedSafetyReportSnapshot(ownerUid:string,id:string,workOrderId:string,revision:number,pdfSha256:string) {
  const row=await getD1().prepare("SELECT * FROM trade_safety_checks WHERE id=? AND owner_uid=? AND work_order_id=? AND revision=? AND status='complete' AND pdf_sha256=?")
    .bind(identifier(id),ownerUid,identifier(workOrderId),revision,pdfSha256).first<Row>();
  if(!row)fail("SAFETY_CHECK_NOT_FOUND","This completed safety check was not found.",404);
  const record=parse(row);if(!safetyCheckCompletion(record).ready)fail("SAFETY_CHECK_INTEGRITY","The completed safety check could not pass its integrity check.");
  return {record,pdfObjectKey:row.pdf_object_key,pdfSha256:row.pdf_sha256,pdfSize:row.pdf_size_bytes};
}
export async function listSafetyCheckRecords(access:TeamAccess,workOrderId:string) {
  await scope(access,workOrderId);
  const rows=await getD1().prepare("SELECT * FROM trade_safety_checks WHERE work_order_id=? AND owner_uid=? ORDER BY created_at").bind(workOrderId,access.ownerUid).all<Row>();
  return Promise.all(rows.results.map(row=>safetyCheckPresentation(access,parse(row))));
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
async function branding(ownerUid:string):Promise<SafetyCheckBranding> {
  const account=await getD1().prepare(`SELECT business_name,email,COALESCE(NULLIF(document_phone,''),phone) business_phone
    FROM trade_accounts account WHERE firebase_uid=? AND partner_type='installer'
    AND ${verifiedTradeAccountPredicate("account")}`).bind(ownerUid)
    .first<{business_name:string;email:string;business_phone:string}>();
  if(!account)fail("SAFETY_CHECK_ACCESS_REQUIRED","Active authorised business access is required.",403);
  return {businessName:account.business_name.trim(),businessEmail:email(account.email),businessPhone:account.business_phone||""};
}
async function safetyCheckProfileDefaults(access:TeamAccess,workOrderId:string,kind:SafetyCheckKind) {
  const db=getD1(),guard=currentAccess(access,false);
  const context=await db.prepare(`SELECT w.work_number,c.first_name,c.last_name,
      site.address_line_1,site.address_line_2,site.suburb,site.address_state,site.postcode
    FROM trade_work_orders w
    LEFT JOIN trade_crm_job_details details ON details.work_order_id=w.id AND details.firebase_uid=w.firebase_uid
      AND w.source_type<>'opportunity' AND details.customer_source IN ('trade_owned','public_lead_released')
    LEFT JOIN trade_crm_customers c ON c.id=details.crm_customer_id AND c.firebase_uid=w.firebase_uid AND c.record_status='active'
    LEFT JOIN trade_crm_service_sites site ON site.id=details.service_site_id AND site.firebase_uid=w.firebase_uid
      AND site.customer_id=c.id AND site.record_status='active'
    WHERE w.id=? AND w.firebase_uid=? AND w.partner_type='installer' AND w.record_status='active' AND ${guard.sql}`)
    .bind(workOrderId,access.ownerUid,...guard.values)
    .first<{work_number:string;first_name:string;last_name:string;address_line_1:string;address_line_2:string;suburb:string;address_state:string;postcode:string}>();
  if(!context)fail("SAFETY_CHECK_ACCESS_REQUIRED","Your current business or job access does not include this assessment.",403);
  if(String(context.address_state||"").trim().toUpperCase()!=="VIC")fail("SAFETY_CHECK_JURISDICTION_REQUIRED","The official safety check requires a Victorian service address.",400);
  const profile=await rentalModuleProfileAnswers({db,ownerUid:access.ownerUid,assessorMemberId:access.memberId,
    moduleKey:kind==="electrical"?"electrical_safety_check":"gas_safety_check",requiredCapability:kind==="electrical"?"licensed_electrician":"licensed_gasfitter",checkedAt:stamp()});
  return {context,profile};
}
export async function startSafetyCheckRecord(access:TeamAccess,workOrderId:string,kind:SafetyCheckKind):Promise<SafetyCheckRecord> {
  if(kind!=="electrical"&&kind!=="gas")fail("SAFETY_CHECK_INPUT_INVALID","Choose an electrical or gas safety check.",400);
  const job=await scope(access,workOrderId,true),db=getD1();await ensureSafetyCheckSchemaGuards(db);
  const existing=await db.prepare("SELECT * FROM trade_safety_checks WHERE work_order_id=? AND owner_uid=? AND kind=?").bind(workOrderId,access.ownerUid,kind).first<Row>();
  if(existing)return parse(existing);
  const {context,profile}=await safetyCheckProfileDefaults(access,workOrderId,kind),now=stamp(),id=crypto.randomUUID(),form=createOfficialSafetyCheckForm(kind);
  const workerName=String(profile[kind==="electrical"?"electricianName":"gasfitterName"]||"");
  const licence=String(profile.licenceNumber||"");
  const answers=normaliseActivityAnswers(form,{property_address:[context.address_line_1,context.address_line_2,...(kind==="electrical"?[context.suburb,context.address_state,context.postcode]:[])].filter(Boolean).join(", "),
    inspector_name:workerName,inspector_licence:licence,...(kind==="gas"?{"gas.client_name":[context.first_name,context.last_name].filter(Boolean).join(" "),
      "gas.suburb":context.suburb||"","gas.postcode":context.postcode||""}:{})});
  const record:SafetyCheckRecord={id,ownerUid:access.ownerUid,workOrderId,kind,recordNumber:`${kind==="electrical"?"ESC":"GSC"}-${now.slice(0,10).replaceAll("-","")}-${id.slice(0,8).toUpperCase()}`,
    revision:1,status:"draft",form,formSha256:activityHash(form),answers,evidence:[],signatures:[],signerDefaults:{customer:[context.first_name,context.last_name].filter(Boolean).join(" "),technician:workerName},createdAt:now,updatedAt:now,completedAt:""};
  const payload=activityCanonical(record),guard=currentAccess(access,true);
  await scope(access,workOrderId,true);
  await db.prepare(`INSERT OR IGNORE INTO trade_safety_checks(id,work_order_id,owner_uid,kind,revision,status,payload,payload_sha256,actor_uid,created_at,updated_at)
    SELECT ?,?,?,?,1,'draft',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM trade_work_orders w WHERE w.id=? AND w.firebase_uid=? AND w.revision=?
      AND w.record_status='active' AND w.stage NOT IN ('imported','cancelled','completed') AND ${guard.sql} AND ${VICTORIAN_SERVICE_SITE_SQL})`)
    .bind(id,workOrderId,access.ownerUid,kind,payload,activityHash(payload),access.actorUid,now,now,workOrderId,access.ownerUid,job.revision,...guard.values).run();
  const saved=await db.prepare("SELECT * FROM trade_safety_checks WHERE work_order_id=? AND owner_uid=? AND kind=?").bind(workOrderId,access.ownerUid,kind).first<Row>();
  if(!saved)fail("SAFETY_CHECK_REVISION_CONFLICT","This job changed. Open the safety check again.");
  await scope(access,workOrderId);return parse(saved);
}
export function safetyCheckCompletion(record:SafetyCheckRecord) {
  const missing:SafetyCheckPresentation["missing"]=activityMissing(record);
  const answered=(key:string)=>typeof record.answers[key]==="string"&&String(record.answers[key]).trim().length>0;
  const policy=(key:string,label:string)=>missing.push({key,label,kind:"policy"});
  const inspection=String(record.answers.inspection_date||"");
  const withinYears=(key:string,years:number,label:string)=>{
    const due=String(record.answers[key]||"");if(!inspection||!due)return;
    const start=new Date(`${inspection}T00:00:00Z`),limit=new Date(start);
    limit.setUTCFullYear(start.getUTCFullYear()+years);
    if(limit.getUTCMonth()!==start.getUTCMonth())limit.setUTCDate(0);
    if(due<=inspection||due>limit.toISOString().slice(0,10))policy(key,label);
  };
  withinYears("next_safety_check_due",2,"Next safety check must follow this inspection and be due within 24 months.");
  if(record.kind==="electrical") {
    const excluded=Object.entries(record.answers).some(([key,value])=>/^electrical\.(scope|visual|polarity|earth)\./.test(key)&&value==="not_included");
    if(excluded&&!answered("electrical.scope.limitations"))policy("electrical.scope.limitations","Record the parts excluded from this safety check and their inspection or testing limitations.");
    const defect=Object.entries(record.answers).some(([key,value])=>/^electrical\.rcd\.(push_button_test|time_test)(?:\[\d+\])?$/.test(key)&&value==="fail")
      ||record.answers["electrical.smoke_alarms"]==="no";
    if(defect&&!answered("electrical.observations"))policy("electrical.observations","Record observations and recommended action for the failed safety check results.");
    withinYears("electrical.next_smoke_alarm_check_due",1,"Next smoke alarm check must follow this inspection and be due within 12 months.");
  } else {
    const fields=expandedActivityFields(record.form,record.answers);
    const suffix=(key:string)=>key.match(/\[\d+\]$/)?.[0]||"";
    const faults=fields.filter(field=>/^gas\.fault\.description(?:\[\d+\])?$/.test(field.key));
    const hasFault=faults.some(field=>answered(field.key));
    const hasAction=faults.some(field=>answered(field.key)&&answered(`gas.fault.remedial_action${suffix(field.key)}`));
    if(["non_compliant","unsafe"].includes(String(record.answers["gas.outcome"]))&&!hasAction)
      policy("gas.fault.remedial_action","Record an identified fault and the remedial action required for this non-compliant or unsafe finding.");
    if((record.answers["gas.installation_leakage_test"]==="fail"||record.answers["gas.lpg_components"]==="no")
      &&!answered("gas.installation_comments")&&!hasFault)
      policy("gas.installation_comments","Describe the failed gas installation check in comments or identified faults.");
    const failedAppliances=fields.filter(field=>/^gas\.appliance\.(isolation_valve|electrically_safe|adequate_ventilation|combustible_clearances|as4575_service)(?:\[\d+\])?$/.test(field.key)
      &&record.answers[field.key]==="no");
    for(const suffixValue of new Set(failedAppliances.map(field=>suffix(field.key))))if(!answered(`gas.appliance.comments${suffixValue}`)&&!hasFault)
      policy(`gas.appliance.comments${suffixValue}`,"Describe this appliance's failed check in its comments or identified faults.");
  }
  return {missing,ready:missing.length===0};
}
async function currentSafetyCheckCredential(access:TeamAccess,record:SafetyCheckRecord,confirmedAt:string):Promise<RentalCredentialSnapshot> {
  try {
    return await currentRentalModuleCredentialSnapshot({db:getD1(),ownerUid:access.ownerUid,assessorMemberId:access.memberId,
      moduleKey:record.kind==="electrical"?"electrical_safety_check":"gas_safety_check",
      requiredCapability:record.kind==="electrical"?"licensed_electrician":"licensed_gasfitter",confirmedAt,
      answers:{licenceNumber:record.answers.inspector_licence,[record.kind==="electrical"?"electricianName":"gasfitterName"]:record.answers.inspector_name,
        credentialConfirmed:true,assessorDeclaration:true}});
  } catch(error) {
    if(error instanceof Error&&error.message==="RENTAL_MODULE_CREDENTIAL_REQUIRED")fail("SAFETY_CHECK_CREDENTIAL_REQUIRED","The actual inspector must use their current matching licence and supporting credential from their team profile.",403);
    throw error;
  }
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
    FROM trade_safety_checks a LEFT JOIN trade_safety_check_mutations m
      ON m.record_id=a.id AND m.owner_uid=a.owner_uid AND m.request_key=? WHERE a.id=? AND a.owner_uid=?`)
    .bind(...guard.values,identifier(key),identifier(id),access.ownerUid).first<MutationSnapshotRow>();
  if(!row)fail("SAFETY_CHECK_NOT_FOUND","This assessment was not found in your business.",404);
  if(!access.canViewFieldEvidence||!access.canManageFieldEvidence||!row.current_write_access)
    fail("SAFETY_CHECK_ACCESS_REQUIRED","Your current business or job access does not include this assessment.",403);
  const record=parse(row);
  if(row.mutation_key===null)return {record,receipt:null};
  if(row.mutation_actor_uid!==access.actorUid||row.mutation_operation!==expectedMutation.operation||row.mutation_base_revision!==expectedMutation.baseRevision
    ||expectedMutation.requestSha256 && expectedMutation.requestSha256!==row.mutation_request_sha256||record.revision!==row.mutation_result_revision||row.payload_sha256!==row.mutation_record_sha256)
    fail("SAFETY_CHECK_REQUEST_CONFLICT","This request or the assessment changed. Refresh its saved result.");
  if(row.mutation_request_sha256===null)fail("SAFETY_CHECK_REQUEST_CONFLICT","This request or the assessment changed. Refresh its saved result.");
  const receipt:SafetyCheckMutationReceipt={recordId:id,operation:row.mutation_operation,baseRevision:row.mutation_base_revision,resultRevision:row.mutation_result_revision,
    requestSha256:row.mutation_request_sha256,recordSha256:row.mutation_record_sha256,actorUid:row.mutation_actor_uid};
  return {record,receipt};
}
export async function readSafetyCheckMutationReceipt(access:TeamAccess,id:string,key:string,expectedMutation:{operation:Mutation;baseRevision:number;requestSha256?:string}) {
  return (await mutationSnapshot(access,id,key,expectedMutation)).receipt;
}
async function replay(access:TeamAccess,id:string,key:string,operation:Mutation,base:number,hash:string) {
  const saved=await mutationSnapshot(access,id,key,{operation,baseRevision:base,requestSha256:hash});
  return saved.receipt?saved.record:null;
}
async function commit(access:TeamAccess,previous:SafetyCheckRecord,next:SafetyCheckRecord,operation:Mutation,key:string,requestHash:string,
  pdf?:{key:string;hash:string;size:number},deliverTo?:Awaited<ReturnType<typeof recipients>>,credential?:RentalCredentialSnapshot) {
  const db=getD1();await ensureSafetyCheckSchemaGuards(db);await scope(access,previous.workOrderId,true);
  next={...next,revision:previous.revision+1,updatedAt:operation==="complete"?next.updatedAt:stamp()};const payload=activityCanonical(next),hash=activityHash(payload);
  const guard=currentAccess(access,true);
  const credentialSql=credential?` AND EXISTS(SELECT 1 FROM trade_team_member_credentials credential
    JOIN trade_team_member_files file ON file.id=credential.file_id AND file.owner_uid=credential.owner_uid AND file.team_member_id=credential.team_member_id
    JOIN trade_team_members member ON member.id=credential.team_member_id AND member.owner_uid=credential.owner_uid
    WHERE credential.owner_uid=? AND credential.team_member_id=? AND credential.rental_gate=? AND credential.status='active'
      AND credential.credential_type=? AND credential.name=? AND credential.credential_number=? AND credential.issuer=? AND credential.jurisdiction=?
      AND credential.expires_at=? AND credential.updated_at=? AND credential.expires_at<>'' AND date(credential.expires_at)>=date(?)
      AND file.status='active' AND file.expires_at<>'' AND date(file.expires_at)>=date(?) AND file.sha256=? AND file.updated_at=?
      AND member.status='active' AND COALESCE(NULLIF(trim(trim(member.first_name)||' '||trim(member.last_name)),''),trim(member.display_name))=?)`:"";
  const credentialValues=credential?[access.ownerUid,access.memberId,credential.gate,credential.credentialType,credential.credentialName,credential.credentialNumber,
    credential.issuer,credential.jurisdiction,credential.expiresAt,credential.recordedAt,credential.confirmedAt,credential.confirmedAt,
    credential.supportingFileSha256,credential.supportingFileRecordedAt,credential.assessorName]:[];
  const update=db.prepare(`UPDATE trade_safety_checks SET revision=?,status=?,payload=?,payload_sha256=?,actor_uid=?,updated_at=?,completed_at=?,pdf_object_key=?,pdf_sha256=?,pdf_size_bytes=?,credential_snapshot=?
    WHERE id=? AND owner_uid=? AND revision=? AND status='draft' AND EXISTS(SELECT 1 FROM trade_work_orders w WHERE w.id=work_order_id AND w.firebase_uid=owner_uid
      AND w.record_status='active' AND w.stage NOT IN ('imported','cancelled','completed') AND ${guard.sql} AND ${VICTORIAN_SERVICE_SITE_SQL})${credentialSql}`).bind(next.revision,next.status,payload,hash,access.actorUid,next.updatedAt,next.completedAt,pdf?.key||"",pdf?.hash||"",pdf?.size||0,
        credential?activityCanonical(credential):"{}",previous.id,access.ownerUid,previous.revision,...guard.values,...credentialValues);
  const statements=[update,db.prepare(`INSERT OR IGNORE INTO trade_safety_check_mutations(record_id,owner_uid,request_key,actor_uid,operation,base_revision,result_revision,request_sha256,record_sha256,created_at)
    SELECT id,owner_uid,?,?,?,?,?,?,?,? FROM trade_safety_checks WHERE id=? AND owner_uid=? AND revision=? AND payload_sha256=? AND actor_uid=?`)
    .bind(key,access.actorUid,operation,previous.revision,next.revision,requestHash,hash,next.updatedAt,previous.id,access.ownerUid,next.revision,hash,access.actorUid)];
  if(deliverTo) for(const role of ["customer","business"] as const) statements.push(db.prepare(`INSERT OR IGNORE INTO trade_safety_check_deliveries(record_id,owner_uid,recipient_role,recipient_email,status,error_code,updated_at)
    SELECT id,owner_uid,?,?,?,?,? FROM trade_safety_checks WHERE id=? AND owner_uid=? AND status='complete' AND payload_sha256=?`)
    .bind(role,deliverTo[role],deliverTo[role]?"queued":"blocked",deliverTo[role]?"":"RECIPIENT_MISSING",next.updatedAt,previous.id,access.ownerUid,hash));
  try{await db.batch(statements);}catch(error){
    const recovered=await replay(access,previous.id,key,operation,previous.revision,requestHash);if(recovered)return recovered;throw error;
  }
  const recovered=await replay(access,previous.id,key,operation,previous.revision,requestHash);
  if(!recovered)fail("SAFETY_CHECK_REVISION_CONFLICT","This assessment changed elsewhere. Refresh before saving.");
  return recovered;
}
function signedScope(previous:SafetyCheckRecord,next:SafetyCheckRecord) {
  for(const signature of previous.signatures) if(activitySigningScope(previous,signature.phase)!==activitySigningScope(next,signature.phase)) fail("SAFETY_CHECK_SIGNED_SCOPE_LOCKED","These details have been signed and cannot be changed.");
}
export function safetyCheckMutationRequestHash(record:SafetyCheckRecord,baseRevision:number,operation:"save"|"complete",answers?:unknown) {
  return operation==="save"?activityHash({operation,baseRevision,answers:normaliseActivityAnswers(record.form,answers)}):activityHash({operation,baseRevision});
}
export async function saveSafetyCheckAnswers(access:TeamAccess,id:string,baseRevision:number,raw:unknown,keyInput?:string):Promise<SafetyCheckRecord> {
  const key=requestKey(keyInput),previous=await readSafetyCheckRecord(access,id),answers=normaliseActivityAnswers(previous.form,raw);
  const requestHash=activityHash({operation:"save",baseRevision,answers}),duplicate=await replay(access,id,key,"save",baseRevision,requestHash);if(duplicate)return duplicate;
  expected(previous,baseRevision);
  const next={...previous,answers};
  signedScope(previous,next);
  return commit(access,previous,next,"save",key,requestHash);
}
export async function signSafetyCheckDeclaration(access:TeamAccess,id:string,baseRevision:number,input:{declarationKey:string;signerName:string;strokes:unknown;scopeSha256:string;accepted:unknown},keyInput?:string) {
  const key=requestKey(keyInput),hash=activityHash({operation:"sign",baseRevision,...input}),duplicate=await replay(access,id,key,"sign",baseRevision,hash);if(duplicate)return duplicate;
  const previous=await readSafetyCheckRecord(access,id);expected(previous,baseRevision);
  const declaration=previous.form.declarations.find(item=>item.key===input.declarationKey);
  if(!declaration||!activityConditionMet(declaration.condition,previous.answers,previous.form)||input.accepted!==true) fail("SAFETY_CHECK_DECLARATION_INVALID","Review this assessment's current declaration before signing.",400);
  if(input.scopeSha256!==activitySigningScope(previous,declaration.phase))fail("SAFETY_CHECK_SIGNING_SCOPE_CHANGED","The assessment changed. Review it before signing again.");
  if(previous.signatures.some(item=>item.declarationKey===declaration.key))fail("SAFETY_CHECK_ALREADY_SIGNED","This declaration already has its recorded signature.");
  if(safetyCheckCompletion(previous).missing.some(item=>item.kind!=="signature"))fail("SAFETY_CHECK_SIGNING_NOT_READY","Complete the required safety check answers and attachments before signing.");
  const field=Object.entries(OFFICIAL_SAFETY_SIGNER_FIELDS[previous.kind]).find(([key])=>key===declaration.key)?.[1];
  const name=input.signerName?.trim();
  if(!field||!name||name.length>180||name!==String(previous.answers[field]||"").trim())fail("SAFETY_CHECK_SIGNER_MISMATCH","Use the name recorded for this declaration's actual signer.",400);
  const credential=await currentSafetyCheckCredential(access,previous,stamp());
  const declarationText=activityDeclarationText(declaration,previous.answers),signature:ActivitySignature={id:crypto.randomUUID(),declarationKey:declaration.key,signerName:name,
    role:declaration.role,phase:declaration.phase,declarationText,declarationSha256:activityHash(declarationText),scopeSha256:input.scopeSha256,signedAt:stamp(),actorUid:access.actorUid,strokes:validateActivityStrokes(input.strokes)};
  return commit(access,previous,{...previous,signatures:[...previous.signatures,signature]},"sign",key,hash,undefined,undefined,credential);
}
export async function readSafetyCheckEvidence(access:TeamAccess,id:string,evidenceId:string) {
  const record=await readSafetyCheckRecord(access,id),item=record.evidence.find(item=>item.id===evidenceId);
  if(!item||!item.objectKey.startsWith(`safety-checks/${access.ownerUid}/${id}/evidence/`))fail("SAFETY_CHECK_EVIDENCE_NOT_FOUND","This attachment was not found.",404);
  const object=await bucket().get(item.objectKey);if(!object)fail("SAFETY_CHECK_EVIDENCE_UNAVAILABLE","This attachment is unavailable.",503);
  const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.length!==item.size||activityHash(bytes)!==item.sha256)fail("SAFETY_CHECK_EVIDENCE_INTEGRITY","This attachment failed its integrity check.");
  return {bytes,contentType:item.contentType,fileName:item.fileName};
}
export async function uploadSafetyCheckEvidence(access:TeamAccess,id:string,baseRevision:number,fieldKey:string,file:File,keyInput?:string) {
  const previous=await readSafetyCheckRecord(access,id);
  const field=expandedActivityFields(previous.form,previous.answers).find(item=>item.key===fieldKey);
  if(!field||!["photo","document"].includes(field.type)||file.size<5||file.size>8*1024*1024)fail("SAFETY_CHECK_FILE_INVALID","Choose a required PDF, JPEG or PNG attachment up to 8 MB.",400);
  const bytes=new Uint8Array(await file.arrayBuffer()),signature=new TextDecoder().decode(bytes.slice(0,5));
  const contentType=signature==="%PDF-"?"application/pdf":bytes[0]===0xff&&bytes[1]===0xd8?"image/jpeg":bytes[0]===0x89&&bytes[1]===0x50?"image/png":"";
  if(!contentType||field.type==="photo"&&contentType==="application/pdf"||field.type==="document"&&contentType!=="application/pdf")
    fail("SAFETY_CHECK_FILE_INVALID",field.type==="document"?"Attach the full appliance servicing record as a PDF.":"Use an actual JPEG or PNG photo.",400);
  const perFileLimit=contentType==="application/pdf"?6*1024*1024:2*1024*1024;
  if(bytes.length>perFileLimit)fail("SAFETY_CHECK_FILE_TOO_LARGE",contentType==="application/pdf"?"Choose a PDF up to 6 MB.":"Choose a photo up to 2 MB.",413);
  const {validateActivityEvidenceBytes}=await import("./trade-activity-forms-pdf");await validateActivityEvidenceBytes(bytes,contentType);
  const key=requestKey(keyInput),hash=activityHash({operation:"upload",baseRevision,fieldKey,sha256:activityHash(bytes)}),duplicate=await replay(access,id,key,"upload",baseRevision,hash);if(duplicate)return duplicate;
  expected(previous,baseRevision);
  if(previous.evidence.length>=24)fail("SAFETY_CHECK_FILE_INVALID","This assessment already has its maximum 24 attachments.",400);
  if(previous.evidence.reduce((total,item)=>total+item.size,bytes.length)>12*1024*1024)
    fail("SAFETY_CHECK_FILE_TOO_LARGE","Keep the combined photos and supporting documents within 12 MB so they can be attached to the report email.",413);
  const eid=crypto.randomUUID(),now=stamp(),objectKey=`safety-checks/${access.ownerUid}/${id}/evidence/${eid}/${activityHash(bytes)}`;
  const item:ActivityEvidence={id:eid,fieldKey,fileName:file.name.replace(/[\r\n\x00-\x1f]/g,"").slice(0,180)||"Assessment attachment",contentType,size:bytes.length,sha256:activityHash(bytes),objectKey,
    capturedAt:"",uploadedAt:now,latitude:null,longitude:null,accuracy:null,metadataOrigin:"file_upload"};
  const next={...previous,evidence:[...previous.evidence,item]};
  signedScope(previous,next);
  await scope(access,previous.workOrderId,true);await bucket().put(objectKey,bytes,{httpMetadata:{contentType},customMetadata:{sha256:item.sha256,assessmentId:id}});
  try{return await commit(access,previous,next,"upload",key,hash);}catch(error){
    const retained=await getD1().prepare("SELECT 1 FROM trade_safety_checks assessment,json_each(assessment.payload,'$.evidence') evidence WHERE assessment.id=? AND assessment.owner_uid=? AND json_extract(evidence.value,'$.objectKey')=?")
      .bind(id,access.ownerUid,objectKey).first();
    if(!retained)await bucket().delete(objectKey);throw error;
  }
}
export type SafetyCheckCompletionResult = { record:SafetyCheckRecord; jobProgress:FormJobProgress };
export async function completeSafetyCheckRecordWithProgress(access:TeamAccess,id:string,baseRevision:number,keyInput?:string):Promise<SafetyCheckCompletionResult> {
  const key=requestKey(keyInput),hash=activityHash({operation:"complete",baseRevision}),duplicate=await replay(access,id,key,"complete",baseRevision,hash);
  if(duplicate){const jobProgress=await reconcileTradeFormJobProgress(access,duplicate.workOrderId,{afterSave:true});await retrySafetyCheckDelivery(access,id);return {record:duplicate,jobProgress};}
  const previous=await readSafetyCheckRecord(access,id);expected(previous,baseRevision);
  const completion=safetyCheckCompletion(previous);if(!completion.ready)fail("SAFETY_CHECK_INCOMPLETE",`Complete the required assessment items: ${completion.missing.map(item=>item.label).join("; ")}`);
  await scope(access,previous.workOrderId,true);
  const assets=new Map<string,Uint8Array>();for(const item of previous.evidence)assets.set(item.id,(await readSafetyCheckEvidence(access,id,item.id)).bytes);
  const now=stamp(),next:SafetyCheckRecord={...previous,status:"complete",completedAt:now,revision:previous.revision+1,updatedAt:now};
  const credential=await currentSafetyCheckCredential(access,previous,now);
  const [{renderOfficialSafetyCheckPdf, officialSafetyCheckAssets},{loadCustomerPlanPdfFonts}]=await Promise.all([import("./official-safety-check-pdf"),import("./customer-plan-pdf-fonts")]);
  const officialAssets=await officialSafetyCheckAssets();
  for(const item of previous.evidence)officialAssets.set(item.id,{bytes:assets.get(item.id)!,contentType:item.contentType});
  const bytes=await renderOfficialSafetyCheckPdf(next,officialAssets,await loadCustomerPlanPdfFonts());
  if(bytes.length<5||bytes.length>12*1024*1024||new TextDecoder().decode(bytes.slice(0,5))!=="%PDF-")fail("SAFETY_CHECK_PDF_INVALID","The completed PDF could not be prepared.");
  const pdfHash=activityHash(bytes),pdfKey=`safety-checks/${access.ownerUid}/${id}/completed/${next.revision}/${pdfHash}.pdf`;
  await bucket().put(pdfKey,bytes,{httpMetadata:{contentType:"application/pdf"},customMetadata:{sha256:pdfHash,assessmentId:id,revision:String(next.revision),retention:"immutable-completed-assessment"}});
  let saved:SafetyCheckRecord;
  try {
    const contacts=await recipients(access.ownerUid,previous.workOrderId);
    // Recheck credential authority after rendering and before the immutable write.
    const latestCredential=await currentSafetyCheckCredential(access,previous,now);
    if(activityCanonical(credential)!==activityCanonical(latestCredential))fail("SAFETY_CHECK_CREDENTIAL_CHANGED","The inspector credential changed. Refresh before completing the safety check.");
    saved=await commit(access,previous,next,"complete",key,hash,{key:pdfKey,hash:pdfHash,size:bytes.length},contacts,credential);
  } catch(error) {
    const retained=await getD1().prepare("SELECT 1 FROM trade_safety_checks WHERE id=? AND owner_uid=? AND pdf_object_key=?")
      .bind(id,access.ownerUid,pdfKey).first();
    if(!retained)await bucket().delete(pdfKey);throw error;
  }
  const jobProgress=await reconcileTradeFormJobProgress(access,saved.workOrderId,{afterSave:true});
  await retrySafetyCheckDelivery(access,id);return {record:saved,jobProgress};
}
/** Existing guided-form callers consume the same authoritative completion path. */
export async function completeSafetyCheckRecord(access:TeamAccess,id:string,baseRevision:number,keyInput?:string):Promise<SafetyCheckRecord> {
  return (await completeSafetyCheckRecordWithProgress(access,id,baseRevision,keyInput)).record;
}
/** Reconcile an already completed assessment without rendering or delivering it again. */
export async function recoverSafetyCheckJobProgress(access:TeamAccess,id:string,baseRevision:number):Promise<SafetyCheckCompletionResult> {
  const {record}=await stored(access,id);
  await scope(access,record.workOrderId,true,true);
  if(record.status!=="complete")fail("SAFETY_CHECK_PDF_NOT_READY","Complete the assessment before updating job progress.");
  if(!Number.isSafeInteger(baseRevision)||record.revision!==baseRevision)fail("SAFETY_CHECK_REVISION_CONFLICT","This assessment changed. Refresh it before updating job progress.");
  await readSafetyCheckPdf(access,id);
  const jobProgress=await reconcileTradeFormJobProgress(access,record.workOrderId);
  return {record,jobProgress};
}
export async function readSafetyCheckPdf(access:TeamAccess,id:string) {
  const {row,record}=await stored(access,id);
  if(record.status!=="complete"||!row.pdf_object_key.startsWith(`safety-checks/${access.ownerUid}/${id}/completed/`))fail("SAFETY_CHECK_PDF_NOT_READY","Complete the assessment before opening its final PDF.");
  const object=await bucket().get(row.pdf_object_key);if(!object)fail("SAFETY_CHECK_PDF_UNAVAILABLE","The saved PDF is unavailable. The completed record is retained.",503);
  const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.length!==row.pdf_size_bytes||activityHash(bytes)!==row.pdf_sha256)fail("SAFETY_CHECK_PDF_INTEGRITY","The saved PDF failed its integrity check.");
  return {bytes,contentType:"application/pdf",fileName:`${record.recordNumber}.pdf`};
}
type DeliveryRow={recipient_role:SafetyCheckDelivery["role"];recipient_email:string;status:SafetyCheckDelivery["status"];error_code:string;lease_token:string;lease_expires_at:string;accepted_at:string};
const deliveryKey=(id:string,role:SafetyCheckDelivery["role"])=>`safety-checks:${id}:${role}:v1`;
async function deliveryRows(access:TeamAccess,id:string) {return (await getD1().prepare("SELECT * FROM trade_safety_check_deliveries WHERE record_id=? AND owner_uid=? ORDER BY recipient_role").bind(id,access.ownerUid).all<DeliveryRow>()).results;}
function deliveryMessage(row:DeliveryRow) {
  if(row.status==="accepted")return "The email was accepted by the delivery provider.";
  if(row.status==="reconciliation_required")return "Delivery is uncertain. Check the outgoing mailbox before sending again.";
  if(row.status==="blocked")return row.error_code==="RECIPIENT_MISSING"?"Add a valid email address to the job customer or business profile, then retry delivery.":"The recipient or business access changed. Review the saved contact details before delivery.";
  if(row.status==="failed")return "The completed PDF is saved. Email delivery failed and can be retried.";
  return row.status==="sending"?"The email is being sent.":"The completed PDF is queued for email.";
}
export async function safetyCheckPresentation(access:TeamAccess,record:SafetyCheckRecord,jobProgress?:FormJobProgress):Promise<SafetyCheckPresentation> {
  await scope(access,record.workOrderId);
  const {ownerUid,evidence,...publicRecord}=record;void ownerUid;
  const completion=safetyCheckCompletion(record);
  return {...publicRecord,evidence:evidence.map(({objectKey,previewObjectKey,...item})=>{void objectKey;void previewObjectKey;return item;}),
    missing:completion.missing,ready:completion.ready,signingScopes:{before:activitySigningScope(record,"before"),after:activitySigningScope(record,"after")},
    signerFields:OFFICIAL_SAFETY_SIGNER_FIELDS[record.kind],reportUrl:record.status==="complete"?`${API}?recordId=${encodeURIComponent(record.id)}&view=pdf`:"",
    delivery:(await deliveryRows(access,record.id)).map(row=>({role:row.recipient_role,status:row.status,message:deliveryMessage(row),acceptedAt:row.accepted_at})),
    ...(jobProgress?{jobProgress}:{})};
}
function encoded(bytes:Uint8Array) {
  let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);
}
export async function retrySafetyCheckDelivery(access:TeamAccess,id:string,baseRevision?:number) {
  const {record}=await stored(access,id);await scope(access,record.workOrderId,true,true);
  if(record.status!=="complete")fail("SAFETY_CHECK_PDF_NOT_READY","Complete the assessment first.");
  if(baseRevision!==undefined&&(!Number.isSafeInteger(baseRevision)||baseRevision!==record.revision))fail("SAFETY_CHECK_REVISION_CONFLICT","This assessment changed. Refresh before checking email delivery.");
  const db=getD1(),pdf=await readSafetyCheckPdf(access,id),business=await branding(access.ownerUid);
  const attachments=[{filename:pdf.fileName,content:encoded(pdf.bytes),contentType:"application/pdf"}];
  for(const item of record.evidence) {
    const evidence=await readSafetyCheckEvidence(access,id,item.id);
    attachments.push({filename:evidence.fileName.replace(/[/\\]/g,"_").slice(0,180),content:encoded(evidence.bytes),contentType:evidence.contentType});
  }
  let draft:ReturnType<typeof safetyCheckEmailDraft>|undefined,reportUrl='';
  const brandedDraft=async()=>{
    if(draft)return draft;
    const {safetyCustomerReportUrl}=await import('./trade-safety-customer-report-server');
    reportUrl=await safetyCustomerReportUrl(access,record,record.kind,activityHash(pdf.bytes));
    draft=safetyCheckEmailDraft({businessName:business.businessName,recordNumber:record.recordNumber,title:record.form.title,
    reportUrl,
    propertyAddress:String(record.answers.property_address||""),inspectionDate:String(record.answers.inspection_date||""),inspectorName:String(record.answers.inspector_name||""),
    photoCount:record.evidence.filter(item=>item.contentType.startsWith("image/")).length,supportingDocumentCount:record.evidence.filter(item=>item.contentType==="application/pdf").length,
    businessEmail:business.businessEmail,businessPhone:business.businessPhone,
    outcome:record.kind==="gas"?record.form.fields.find(field=>field.key==="gas.outcome")?.optionLabels?.[String(record.answers["gas.outcome"])]||String(record.answers["gas.outcome"]||""):"",
    ...(record.kind==="gas"&&record.answers["gas.outcome"]==="unsafe"?{attention:"urgent",actionRequired:"Contact the inspecting gasfitter immediately about the recorded unsafe finding and required actions. Read the attached report before using the affected installation."}:
      record.kind==="gas"&&record.answers["gas.outcome"]==="non_compliant"?{attention:"follow_up",actionRequired:"Contact the inspecting gasfitter about the recorded faults and remedial actions in the attached report."}:{})});return draft;
  };
  for(const row of await deliveryRows(access,id)) {
    if(row.status==="accepted"||row.status==="reconciliation_required")continue;
    const now=stamp(),key=deliveryKey(id,row.recipient_role);
    const proof=await db.prepare("SELECT status,provider,provider_message_id FROM trade_email_submissions WHERE owner_uid=? AND request_key=?").bind(access.ownerUid,key).first<{status:string;provider:string;provider_message_id:string}>();
    if(proof?.status==="accepted") {await db.prepare("UPDATE trade_safety_check_deliveries SET status='accepted',provider=?,provider_message_id=?,accepted_at=?,lease_token='',lease_expires_at='',updated_at=? WHERE record_id=? AND owner_uid=? AND recipient_role=?")
      .bind(proof.provider,proof.provider_message_id,now,now,id,access.ownerUid,row.recipient_role).run();continue;}
    if(proof && ["sending","uncertain"].includes(proof.status)) {await db.prepare("UPDATE trade_safety_check_deliveries SET status='reconciliation_required',error_code='EMAIL_SEND_UNCERTAIN',updated_at=? WHERE record_id=? AND owner_uid=? AND recipient_role=?")
      .bind(now,id,access.ownerUid,row.recipient_role).run();continue;}
    if(row.status==="sending"&&row.lease_expires_at>now)continue;
    const contacts=await recipients(access.ownerUid,record.workOrderId),target=contacts[row.recipient_role];
    if(!target||row.recipient_email&&row.recipient_email!==target) {await db.prepare("UPDATE trade_safety_check_deliveries SET status='blocked',error_code=?,updated_at=? WHERE record_id=? AND owner_uid=? AND recipient_role=?")
      .bind(!target?"RECIPIENT_MISSING":"RECIPIENT_CHANGED",now,id,access.ownerUid,row.recipient_role).run();continue;}
    const lease=crypto.randomUUID(),expires=new Date(Date.now()+120000).toISOString();
    const claimed=await db.prepare(`UPDATE trade_safety_check_deliveries SET status='sending',recipient_email=?,lease_token=?,lease_expires_at=?,error_code='',updated_at=?
      WHERE record_id=? AND owner_uid=? AND recipient_role=? AND status NOT IN ('accepted','reconciliation_required') AND (status<>'sending' OR lease_expires_at<=?)`)
      .bind(target,lease,expires,now,id,access.ownerUid,row.recipient_role,now).run();if(!claimed.meta.changes)continue;
    let transport=false;
    try {
      const beforeSend=async()=>{
        await scope(access,record.workOrderId,true,true);
        if(reportUrl)await (await import('./trade-safety-customer-report-server')).assertSafetyCustomerReportUrl(reportUrl);
        const fresh=await recipients(access.ownerUid,record.workOrderId);if(fresh[row.recipient_role]!==target)fail("SAFETY_CHECK_RECIPIENT_CHANGED","The report recipient changed.");
        const held=await db.prepare("SELECT 1 FROM trade_safety_check_deliveries WHERE record_id=? AND owner_uid=? AND recipient_role=? AND status='sending' AND lease_token=? AND lease_expires_at>?")
          .bind(id,access.ownerUid,row.recipient_role,lease,stamp()).first();if(!held)fail("SAFETY_CHECK_DELIVERY_CHANGED","This delivery changed elsewhere.");
      };
      const content=await brandedDraft();await beforeSend();transport=true;
      const sent=await sendTradeCustomerEmail(access.ownerUid,access.actorUid,{channel:"email",recipient:target,
        ...content,attachments,idempotencyKey:key,callbackUrl:"",messageType:"safety_check_completed_assessment"},{db,beforeSend});
      await db.prepare("UPDATE trade_safety_check_deliveries SET status='accepted',provider=?,provider_message_id=?,accepted_at=?,lease_token='',lease_expires_at='',updated_at=? WHERE record_id=? AND owner_uid=? AND recipient_role=? AND lease_token=?")
        .bind(sent.provider,sent.providerMessageId,stamp(),stamp(),id,access.ownerUid,row.recipient_role,lease).run();
    } catch(error) {
      const journal=await db.prepare("SELECT status,provider,provider_message_id FROM trade_email_submissions WHERE owner_uid=? AND request_key=?").bind(access.ownerUid,key).first<{status:string;provider:string;provider_message_id:string}>();
      if(journal?.status==="accepted"){
        await db.prepare("UPDATE trade_safety_check_deliveries SET status='accepted',provider=?,provider_message_id=?,accepted_at=?,lease_token='',lease_expires_at='',updated_at=? WHERE record_id=? AND owner_uid=? AND recipient_role=? AND lease_token=?")
          .bind(journal.provider,journal.provider_message_id,stamp(),stamp(),id,access.ownerUid,row.recipient_role,lease).run();continue;
      }
      const uncertain=journal?.status==="sending"||journal?.status==="uncertain"||reminderProviderFailureOutcome(error)==="indeterminate"||transport&&!journal;
      const blocked=error instanceof SafetyCheckError&&["SAFETY_CHECK_ACCESS_REQUIRED","SAFETY_CHECK_RECIPIENT_CHANGED"].includes(error.code);
      await db.prepare("UPDATE trade_safety_check_deliveries SET status=?,error_code=?,lease_token='',lease_expires_at='',updated_at=? WHERE record_id=? AND owner_uid=? AND recipient_role=? AND lease_token=?")
        .bind(uncertain?"reconciliation_required":blocked?"blocked":"failed",blocked?"RECIPIENT_CHANGED":"EMAIL_DELIVERY_FAILED",stamp(),id,access.ownerUid,row.recipient_role,lease).run();
    }
  }
  return safetyCheckPresentation(access,await readSafetyCheckRecord(access,id));
}
