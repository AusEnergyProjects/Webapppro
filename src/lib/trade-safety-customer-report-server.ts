import { env } from 'cloudflare:workers';
import { getD1 } from '../../db';
import type { TeamAccess } from './trade-team-server';
import type { ActivityEvidence } from './trade-activity-form-types';
import type { SafetyCustomerReport } from './safety-customer-report';
import { activityHash } from './trade-activity-forms';
import { activityOptionLabel, expandedActivityFields, fieldConditionMet } from './trade-activity-form-flow';
import { verifiedTradeAccountPredicate } from './trade-account-predicates';
import { encryptProtectedPayload, decryptProtectedPayload } from './trade-integration-crypto';
import { newRentalReportSecret, hashRentalReportSecret, splitRentalReportToken } from './trade-rental-report-links';
import { PUBLIC_SITE } from './public-site';
import type { PiesaRecord } from './veu-electrical-assessment';
import type { SafetyCheckRecord } from './job-safety-check';

type Kind='piesa'|'electrical'|'gas';
type Context={ownerUid:string;recordId:string;workOrderId:string;kind:Kind;revision:number;pdfSha256:string};
type Link={id:string;owner_uid:string;work_order_id:string;record_id:string;record_kind:Kind;record_revision:number;pdf_sha256:string;
  crm_customer_id:string;customer_email_sha256:string;token_hash:string;encrypted_token:string;status:string;expires_at:string;created_at:string};
type JobContext={crm_customer_id:string;customer_email:string;business_name:string;business_email:string;business_phone:string;logo_object_key:string;logo_content_type:string};
type Snapshot={record:PiesaRecord|SafetyCheckRecord;pdfObjectKey:string;pdfSha256:string;pdfSize:number};
type Bucket={get(key:string):Promise<{arrayBuffer():Promise<ArrayBuffer>}|null>};
const ENDPOINT='/api/trade-safety-check-report';
const now=()=>new Date().toISOString();
export class SafetyCustomerReportError extends Error {
  readonly status=404;
  constructor(){super('This private report link is unavailable. Ask the inspecting business for help.');}
}
function unavailable():never {throw new SafetyCustomerReportError();}
function bucket():Bucket {
  const candidate:unknown=Reflect.get(env,'EVIDENCE');
  if(!candidate||typeof candidate!=='object'||!('get' in candidate)||typeof candidate.get!=='function')throw new Error('SAFETY_REPORT_STORAGE_UNAVAILABLE');
  return candidate as Bucket;
}
const recordTable=(kind:Kind)=>kind==='piesa'?'trade_veu_electrical_assessments':'trade_safety_checks';
async function retained(context:Context):Promise<Snapshot> {
  if(context.kind==='piesa') {
    const {completedPiesaReportSnapshot}=await import('./trade-veu-electrical-assessment-server');
    return completedPiesaReportSnapshot(context.ownerUid,context.recordId,context.workOrderId,context.revision,context.pdfSha256);
  }
  const {completedSafetyReportSnapshot}=await import('./trade-safety-checks-server');
  const result=await completedSafetyReportSnapshot(context.ownerUid,context.recordId,context.workOrderId,context.revision,context.pdfSha256);
  if(result.record.kind!==context.kind)unavailable();return result;
}
async function jobContext(ownerUid:string,workOrderId:string):Promise<JobContext> {
  const row=await getD1().prepare(`SELECT customer.id crm_customer_id,lower(trim(customer.email)) customer_email,
    account.business_name,account.email business_email,COALESCE(NULLIF(account.document_phone,''),account.phone) business_phone,
    account.logo_object_key,account.logo_content_type FROM trade_work_orders job
    JOIN trade_accounts account ON account.firebase_uid=job.firebase_uid AND account.partner_type='installer' AND ${verifiedTradeAccountPredicate('account')}
    JOIN trade_crm_job_details details ON details.work_order_id=job.id AND details.firebase_uid=job.firebase_uid
    JOIN trade_crm_customers customer ON customer.id=details.crm_customer_id AND customer.firebase_uid=job.firebase_uid AND customer.record_status='active'
    WHERE job.id=? AND job.firebase_uid=? AND job.partner_type='installer' AND job.record_status='active'
      AND job.stage NOT IN ('imported','cancelled') AND job.source_type<>'opportunity' AND details.customer_source IN ('trade_owned','public_lead_released')`)
    .bind(workOrderId,ownerUid).first<JobContext>();
  if(!row)unavailable();return row;
}
function linkContext(link:Link):Context {return {ownerUid:link.owner_uid,recordId:link.record_id,workOrderId:link.work_order_id,
  kind:link.record_kind,revision:link.record_revision,pdfSha256:link.pdf_sha256};}
/** The caller has already reauthorised the current staff actor and read the completed PDF. */
export async function safetyCustomerReportUrl(access:TeamAccess,record:PiesaRecord|SafetyCheckRecord,kind:Kind,pdfSha256:string) {
  if(record.ownerUid!==access.ownerUid||record.status!=='complete'||'kind' in record&&record.kind!==kind)unavailable();
  const db=getD1(),context=await jobContext(access.ownerUid,record.workOrderId),customerHash=activityHash(context.customer_email||'');
  const existing=await db.prepare('SELECT * FROM trade_safety_report_links WHERE owner_uid=? AND record_kind=? AND record_id=?')
    .bind(access.ownerUid,kind,record.id).first<Link>();
  let link=existing;
  if(!link) {
    const id=crypto.randomUUID(),secret=newRentalReportSecret(),tokenHash=await hashRentalReportSecret(secret);
    const encrypted=await encryptProtectedPayload({kind:'safety_customer_report_link',linkId:id,recordKind:kind,recordId:record.id,secret});
    const createdAt=now(),expiresAt=new Date(Date.now()+60*24*60*60*1000).toISOString();
    await db.prepare(`INSERT OR IGNORE INTO trade_safety_report_links
      (id,owner_uid,work_order_id,record_id,record_kind,record_revision,pdf_sha256,crm_customer_id,customer_email_sha256,token_hash,encrypted_token,status,expires_at,created_by_uid,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,'active',?,?,? WHERE EXISTS(SELECT 1 FROM ${recordTable(kind)} record
        WHERE record.id=? AND record.owner_uid=? AND record.work_order_id=? AND record.revision=? AND record.status='complete'
          AND record.pdf_sha256=? AND record.pdf_size_bytes>4 AND record.pdf_object_key<>'' AND record.completed_at<>'')`)
      .bind(id,access.ownerUid,record.workOrderId,record.id,kind,record.revision,pdfSha256,context.crm_customer_id,customerHash,tokenHash,encrypted,
        expiresAt,access.actorUid,createdAt,record.id,access.ownerUid,record.workOrderId,record.revision,pdfSha256).run();
    link=await db.prepare('SELECT * FROM trade_safety_report_links WHERE owner_uid=? AND record_kind=? AND record_id=?')
      .bind(access.ownerUid,kind,record.id).first<Link>();
  }
  // A business copy can precede adding the customer's missing email. Bind that
  // same customer's first address once, before a customer delivery is accepted
  // or uncertain. Changing an already bound address never inherits this link.
  if(link&&context.customer_email&&link.crm_customer_id===context.crm_customer_id&&link.customer_email_sha256===activityHash('')) {
    const deliveries=kind==='piesa'?'trade_veu_electrical_deliveries':'trade_safety_check_deliveries';
    await db.prepare(`UPDATE trade_safety_report_links SET customer_email_sha256=? WHERE id=? AND owner_uid=? AND status='active'
      AND customer_email_sha256=? AND crm_customer_id=?
      AND EXISTS(SELECT 1 FROM trade_crm_customers customer WHERE customer.id=crm_customer_id AND customer.firebase_uid=owner_uid
        AND customer.record_status='active' AND lower(trim(customer.email))=?)
      AND NOT EXISTS(SELECT 1 FROM ${deliveries} delivery WHERE delivery.record_id=? AND delivery.owner_uid=? AND delivery.recipient_role='customer'
        AND delivery.status IN ('accepted','reconciliation_required'))`)
      .bind(customerHash,link.id,access.ownerUid,activityHash(''),context.crm_customer_id,context.customer_email,record.id,access.ownerUid).run();
    link=await db.prepare('SELECT * FROM trade_safety_report_links WHERE owner_uid=? AND record_kind=? AND record_id=?')
      .bind(access.ownerUid,kind,record.id).first<Link>();
  }
  if(!link||link.status!=='active'||link.expires_at<=now()||link.record_revision!==record.revision||link.pdf_sha256!==pdfSha256
    ||link.crm_customer_id!==context.crm_customer_id||link.customer_email_sha256!==customerHash)unavailable();
  const protectedValue=await decryptProtectedPayload(link.encrypted_token),secret=String(protectedValue.secret||'');
  if(protectedValue.kind!=='safety_customer_report_link'||protectedValue.linkId!==link.id||protectedValue.recordKind!==kind||protectedValue.recordId!==record.id
    ||await hashRentalReportSecret(secret)!==link.token_hash)unavailable();
  const token=`${link.id}.${secret}`;await authorised(token);
  return `${PUBLIC_SITE.apexUrl}/reports/safety/${encodeURIComponent(token)}`;
}
async function authorised(token:string) {
  let parsed:ReturnType<typeof splitRentalReportToken>;
  try {parsed=splitRentalReportToken(token);}catch{unavailable();}
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(parsed.linkId))unavailable();
  const link=await getD1().prepare('SELECT * FROM trade_safety_report_links WHERE id=? AND token_hash=? AND status=\'active\' AND expires_at>?')
    .bind(parsed.linkId,await hashRentalReportSecret(parsed.secret),now()).first<Link>();
  if(!link)unavailable();
  const business=await jobContext(link.owner_uid,link.work_order_id);
  if(business.crm_customer_id!==link.crm_customer_id||activityHash(business.customer_email||'')!==link.customer_email_sha256)unavailable();
  let snapshot:Snapshot;try {snapshot=await retained(linkContext(link));}catch{unavailable();}
  return {link,business,snapshot};
}
export async function assertSafetyCustomerReportUrl(value:string) {
  const url=new URL(value);
  if(url.origin!==PUBLIC_SITE.apexUrl||!url.pathname.startsWith('/reports/safety/'))unavailable();
  await authorised(decodeURIComponent(url.pathname.slice('/reports/safety/'.length)));
}
const allowedEvidence=(kind:Kind,evidence:ActivityEvidence)=>kind!=='piesa'||!/life_support|medical/i.test(evidence.fieldKey);
function url(token:string,view:string,evidenceId?:string) {return `${ENDPOINT}?token=${encodeURIComponent(token)}&view=${view}${evidenceId?`&evidenceId=${encodeURIComponent(evidenceId)}`:''}`;}
export async function safetyCustomerReport(token:string):Promise<SafetyCustomerReport> {
  const {link,business,snapshot}=await authorised(token),record=snapshot.record;
  const sections:SafetyCustomerReport['sections']=[];
  const fields=expandedActivityFields(record.form,record.answers);
  for(const field of fields) {
    if(['photo','document'].includes(field.type)||!fieldConditionMet(field.condition,record.answers,record.form,field.repeatGroup,field.repeatIndex)
      ||link.record_kind==='piesa'&&/life_support|medical|^binding\.|^delivery\./i.test(field.key))continue;
    const value=record.answers[field.key];if(value===undefined||value==='')continue;
    const suffix=field.repeatIndex?`[${field.repeatIndex}]`:'';
    const identity=field.repeatGroup==='appliances'?record.answers[`gas.appliance.description${suffix}`]
      :field.repeatGroup==='circuits'?record.answers[`electrical.rcd.circuit_protected${suffix}`]:'';
    const title=field.repeatGroup?`${field.repeatGroup==='appliances'?'Appliance':field.repeatGroup==='circuits'?'Circuit':'Fault'} ${field.repeatIndex+1}${identity?` · ${identity}`:''}`:field.section;
    let section=sections.find(item=>item.title===title);if(!section){section={title,items:[]};sections.push(section);}
    section.items.push({label:field.label,value:typeof value==='boolean'?value?'Yes':'No':field.type==='select'?activityOptionLabel(String(value),field.optionLabels?.[String(value)]):String(value)});
  }
  const outcomeKey=link.record_kind==='gas'?'gas.outcome':link.record_kind==='piesa'?'assessment_outcome':'';
  const outcomeValue=outcomeKey?String(record.answers[outcomeKey]||''):'';
  const outcomeField=fields.find(field=>field.key===outcomeKey);
  const report:SafetyCustomerReport={kind:link.record_kind,recordNumber:record.recordNumber,title:record.form.title,
    propertyAddress:String(record.answers.property_address||''),inspectionDate:String(record.answers.inspection_date||''),completedAt:record.completedAt,
    inspectorName:String(record.answers.inspector_name||record.answers.initial_electrician_name||''),
    business:{name:business.business_name,email:business.business_email,phone:business.business_phone,
      ...(business.logo_object_key&&['image/png','image/jpeg'].includes(business.logo_content_type)?{logoUrl:url(token,'brand-logo')}:{})},
    ...(outcomeValue?{outcome:{label:activityOptionLabel(outcomeValue,outcomeField?.optionLabels?.[outcomeValue]),
      attention:link.record_kind==='gas'&&outcomeValue==='unsafe'?'urgent':link.record_kind==='gas'&&outcomeValue==='non_compliant'
        ||link.record_kind==='piesa'&&['rectification_required','onsite_isolation'].includes(outcomeValue)?'follow_up':'normal'}}:{}),
    sections,signatures:record.signatures.map(signature=>({name:signature.signerName,title:record.form.declarations.find(item=>item.key===signature.declarationKey)?.title||'Recorded signature',signedAt:signature.signedAt})),
    evidence:record.evidence.filter(evidence=>allowedEvidence(link.record_kind,evidence)).map(evidence=>({id:evidence.id,
      label:fields.find(field=>field.key===evidence.fieldKey)?.label||'Supporting evidence',fileName:evidence.fileName,contentType:evidence.contentType,url:url(token,'evidence',evidence.id)})),pdfUrl:url(token,'pdf')};
  await authorised(token);return report;
}
export async function safetyCustomerReportFile(token:string,view:'pdf'|'evidence'|'brand-logo',evidenceId?:string) {
  const {link,business,snapshot}=await authorised(token);let key:string,size:number|undefined,hash:string|undefined,contentType:string,fileName:string;
  if(view==='pdf') {key=snapshot.pdfObjectKey;size=snapshot.pdfSize;hash=snapshot.pdfSha256;contentType='application/pdf';fileName=`${snapshot.record.recordNumber}.pdf`;
    const prefix=link.record_kind==='piesa'?'piesa':'safety-checks';if(!key.startsWith(`${prefix}/${link.owner_uid}/${link.record_id}/completed/`))unavailable();}
  else if(view==='evidence') {const evidence=snapshot.record.evidence.find(item=>item.id===evidenceId&&allowedEvidence(link.record_kind,item));if(!evidence)unavailable();
    key=evidence.objectKey;size=evidence.size;hash=evidence.sha256;contentType=evidence.contentType;fileName=evidence.fileName;
    const prefix=link.record_kind==='piesa'?'piesa':'safety-checks';if(!key.startsWith(`${prefix}/${link.owner_uid}/${link.record_id}/evidence/`))unavailable();}
  else {key=business.logo_object_key;contentType=business.logo_content_type;fileName='business-logo';if(!key.startsWith(`trade-branding/${link.owner_uid}/logo/`)||!['image/png','image/jpeg'].includes(contentType))unavailable();}
  const object=await bucket().get(key);if(!object)unavailable();const bytes=new Uint8Array(await object.arrayBuffer());
  if(size!==undefined&&bytes.length!==size||hash!==undefined&&activityHash(bytes)!==hash)unavailable();
  if(view==='brand-logo') {
    if(bytes.length<20||bytes.length>4_000_000)unavailable();
    const {validateActivityEvidenceBytes}=await import('./trade-activity-forms-pdf');await validateActivityEvidenceBytes(bytes,contentType);
  }
  await authorised(token);return {bytes,contentType,fileName};
}
export async function revokeSafetyCustomerReportLink(access:TeamAccess,recordId:string,kind:Kind) {
  if(!access.isOwner||access.actorUid!==access.ownerUid||!access.canManageFieldEvidence)unavailable();
  const record=kind==='piesa'?await (await import('./trade-veu-electrical-assessment-server')).readPiesaRecord(access,recordId)
    :await (await import('./trade-safety-checks-server')).readSafetyCheckRecord(access,recordId);
  if(record.status!=='complete'||'kind' in record&&record.kind!==kind)unavailable();
  await jobContext(access.ownerUid,record.workOrderId);
  await getD1().prepare("UPDATE trade_safety_report_links SET status='revoked',revoked_at=? WHERE owner_uid=? AND record_id=? AND record_kind=? AND status='active'")
    .bind(now(),access.ownerUid,recordId,kind).run();
}
