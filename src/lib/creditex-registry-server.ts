import { loadCreditexWorkPackGovernanceIdentity, type CreditexWorkPackGovernanceActor } from "./creditex-activity-work-pack-server";
import { listCreditexOutputActions, loadCreditexOutputAction } from "./creditex-output-action-server";
import { creditexCanonicalSha256, creditexRawSha256 } from "./creditex-interchange-preflight";
import { getCreditexCustodyBucket, type CreditexCustodyBucket } from "./creditex-custody-bucket";
import { REGISTRY_SCHEME_KEYS, REGISTRY_SCHEMES, registrySchemeForProgram,
  type RegistryAccount, type RegistryResult, type RegistrySchemeKey, type RegistryStatus, type RegistryWorkspace } from "./creditex-registry";

export class CreditexRegistryError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
export type RegistryActor = CreditexWorkPackGovernanceActor;
export type RegistryOptions = { bucket?: CreditexCustodyBucket; now?: () => string; fetchImpl?: typeof fetch };
type Input = Readonly<Record<string, unknown>>;
type AccountRow = {
  id:string; organisation_id:string; scheme:RegistrySchemeKey; account_reference:string; submitter_reference:string;
  legal_name:string; finance_email:string; results_email:string; activity_scope:string; authority_reference:string;
  authority_expires_on:string; version:number; enabled:number; updated_at:string;
};
type EvidenceRow = { id:string; organisation_id:string; object_key:string; filename:string; content_type:string; byte_length:number; sha256:string };
type ResultRow = { id:string; packet_id:string; account_id:string; external_reference:string; registry_status:RegistryStatus; quantity:string;
  occurred_at:string; evidence_id:string; note:string; recorded_by_uid:string; source:RegistryResult["source"]; review_status:RegistryResult["reviewStatus"]; created_at:string };

function fail(code:string,message:string,status=409):never { throw new CreditexRegistryError(code,status,message); }
function now(options:RegistryOptions={}) { return options.now?.() || new Date().toISOString(); }
function text(value:unknown,label:string,max=240,optional=false):string {
  if(typeof value!=="string" || value.trim().length>max || (!optional&&!value.trim())) fail("REGISTRY_INPUT_INVALID",`Enter ${label}.`,400);
  return value.trim();
}
function strings(value:unknown,label:string,max=1000):string[] {
  if(!Array.isArray(value)||!value.length||value.length>max||value.some(v=>typeof v!=="string"||!v.trim()||v.length>240)) fail("REGISTRY_INPUT_INVALID",`Choose ${label}.`,400);
  const items=value.map(v=>String(v).trim());
  if(new Set(items).size!==items.length) fail("REGISTRY_INPUT_INVALID",`${label} contains duplicates.`,400);
  return items;
}
function date(value:unknown,label:string,optional=false) {
  const result=text(value,label,10,optional);
  if(result && (!/^\d{4}-\d{2}-\d{2}$/.test(result)||!Number.isFinite(Date.parse(result))||new Date(result).toISOString().slice(0,10)!==result)) fail("REGISTRY_DATE_INVALID",`Enter a valid ${label}.`,400);
  return result;
}
function occurred(value:unknown,label:string,options:RegistryOptions={},earliest="") {
  const result=text(value,label,40), parsed=Date.parse(result);
  if(!Number.isFinite(parsed)||parsed>Date.parse(now(options))+300000||(earliest&&parsed<Date.parse(earliest))) fail("REGISTRY_DATE_INVALID",`${label} must be after its claim was prepared and cannot be in the future.`,400);
  return new Date(parsed).toISOString();
}
export function registryMoneyMinor(value:unknown) {
  if(typeof value!=="string"||!/^\d{1,11}(?:\.\d{1,2})?$/.test(value.trim())) fail("REGISTRY_AMOUNT_INVALID","Enter an AUD amount with up to two decimal places.",400);
  const [whole,fraction=""]=value.trim().split(".");
  const amount=Number(whole)*100+Number(fraction.padEnd(2,"0"));
  if(!Number.isSafeInteger(amount)||amount<=0||amount>1_000_000_000_000) fail("REGISTRY_AMOUNT_INVALID","Enter a positive supported AUD amount.",400);
  return amount;
}
function quantity(value:unknown,required=false) {
  const result=text(value??"","certificate quantity",30,!required);
  if(result&&!/^(0|[1-9]\d{0,14})$/.test(result)) fail("REGISTRY_QUANTITY_INVALID","Use a whole certificate quantity.",400);
  if(required&&BigInt(result)<=BigInt(0)) fail("REGISTRY_QUANTITY_INVALID","Registered certificates require a positive quantity.",400);
  return result;
}

export async function registryCapabilities(db:D1Database,actor:RegistryActor) {
  const identity=await loadCreditexWorkPackGovernanceIdentity(db,actor);
  if(!identity.access.canRead) fail("REGISTRY_ACCESS_DENIED","Registry access is unavailable.",403);
  return {
    canManageAccounts:identity.access.canAuthor && (actor.actorKind==="admin"?["owner","admin"].includes(identity.role):identity.role==="admin"),
    canOperate:identity.access.canAuthor,
    canReview:identity.access.canReview,
  };
}
async function permit(db:D1Database,actor:RegistryActor,capability:keyof Awaited<ReturnType<typeof registryCapabilities>>) {
  if(!(await registryCapabilities(db,actor))[capability]) fail("REGISTRY_PERMISSION_DENIED","Your role cannot make this registry change.",403);
}
function audit(db:D1Database,actor:RegistryActor,event:string,target:string,metadata:Input={},whenChanged=false) {
  return db.prepare(`INSERT INTO compliance_audit_events (id,organisation_id,actor_type,actor_uid,event_type,target_type,target_id,summary,metadata,created_at)
    SELECT ?,?,?,?,?,'registry_operation',?,?,?,? ${whenChanged?"WHERE changes()=1":""}`).bind(crypto.randomUUID(),actor.organisationId,actor.actorKind==="admin"?"platform":"compliance",actor.actorUid,event,target,
      "Registry operation recorded.",JSON.stringify({...metadata,actorKind:actor.actorKind}),new Date().toISOString());
}
function projectAccount(row:AccountRow):RegistryAccount {
  return {id:row.id,scheme:row.scheme,accountReference:row.account_reference,submitterReference:row.submitter_reference,legalName:row.legal_name,
    financeEmail:row.finance_email,resultsEmail:row.results_email,activityScope:JSON.parse(row.activity_scope),authorityReference:row.authority_reference,
    authorityExpiresOn:row.authority_expires_on,version:row.version,enabled:Boolean(row.enabled),updatedAt:row.updated_at};
}
export async function requireRegistryAccount(db:D1Database,actor:RegistryActor,id:unknown,active=false,options:RegistryOptions={}) {
  const row=await db.prepare("SELECT * FROM creditex_registry_accounts WHERE organisation_id=? AND id=?").bind(actor.organisationId,text(id,"claiming account")).first<AccountRow>();
  if(!row) fail("REGISTRY_ACCOUNT_NOT_FOUND","The claiming account was not found.",404);
  if(active&&(!row.enabled||(row.authority_expires_on&&row.authority_expires_on<now(options).slice(0,10)))) fail("REGISTRY_ACCOUNT_INACTIVE","Update the account's authority before preparing another submission.");
  return projectAccount(row);
}

export async function saveRegistryAccount(db:D1Database,actor:RegistryActor,input:Input,options:RegistryOptions={}) {
  await permit(db,actor,"canManageAccounts");
  const scheme=input.scheme;
  if(typeof scheme!=="string"||!REGISTRY_SCHEME_KEYS.some(key=>key===scheme)) fail("REGISTRY_SCHEME_INVALID","Choose a supported scheme.",400);
  const reference=text(input.accountReference,"registry account reference",100),legalName=text(input.legalName,"registered legal entity name",250);
  const financeEmail=text(input.financeEmail,"finance email",254).toLowerCase(),resultsEmail=text(input.resultsEmail,"results email",254).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(financeEmail)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resultsEmail)) fail("REGISTRY_EMAIL_INVALID","Enter valid finance and results email addresses.",400);
  const scope=strings(input.activityScope,"authorised activity identifiers",100);
  const authority=text(input.authorityReference,"authority or accreditation reference",1000),expires=date(input.authorityExpiresOn??"","authority expiry",true);
  const submitter=text(input.submitterReference??"","submitting account reference",100,true),timestamp=now(options);
  if(scheme==="stc"&&!/^\d{1,19}$/.test(reference)) fail("REGISTRY_ACCOUNT_INVALID","Enter the numeric REC owner account ID used for certificate holdings.",400);
  if(input.id) {
    const prior=await requireRegistryAccount(db,actor,input.id);
    if(prior.scheme!==scheme||prior.accountReference!==reference||prior.legalName!==legalName) fail("REGISTRY_IDENTITY_IMMUTABLE","Create another claiming account when its legal entity, scheme or registry identity changes.");
    if(input.expectedVersion!==prior.version) fail("REGISTRY_ACCOUNT_CHANGED","The account changed. Refresh it before saving.");
    const results=await db.batch([
      db.prepare(`UPDATE creditex_registry_accounts SET submitter_reference=?,finance_email=?,results_email=?,activity_scope=?,authority_reference=?,authority_expires_on=?,version=version+1,updated_at=?
        WHERE organisation_id=? AND id=? AND version=? AND enabled=1`).bind(submitter,financeEmail,resultsEmail,JSON.stringify(scope),authority,expires,timestamp,actor.organisationId,prior.id,prior.version),
      audit(db,actor,"registry_account_updated",prior.id,{},true),
    ]);
    if(!results[0].meta.changes) fail("REGISTRY_ACCOUNT_CHANGED","The account changed or is disabled. Refresh before saving.");
    return prior.id;
  }
  const prior=await db.prepare("SELECT id FROM creditex_registry_accounts WHERE organisation_id=? AND scheme=? AND account_reference=?").bind(actor.organisationId,scheme,reference).first<{id:string}>();
  if(prior) fail("REGISTRY_ACCOUNT_EXISTS","This registry account is already saved. Open it to update its details.");
  const id=crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO creditex_registry_accounts (id,organisation_id,scheme,account_reference,submitter_reference,legal_name,finance_email,results_email,activity_scope,authority_reference,authority_expires_on,created_by_uid,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,actor.organisationId,scheme,reference,submitter,legalName,financeEmail,resultsEmail,JSON.stringify(scope),authority,expires,actor.actorUid,timestamp,timestamp),
    audit(db,actor,"registry_account_created",id,{scheme}),
  ]);
  return id;
}

export async function disableRegistryAccount(db:D1Database,actor:RegistryActor,input:Input) {
  await permit(db,actor,"canManageAccounts");
  const account=await requireRegistryAccount(db,actor,input.accountId);
  if(input.expectedVersion!==account.version) fail("REGISTRY_ACCOUNT_CHANGED","Refresh the account before disabling it.");
  const results=await db.batch([db.prepare("UPDATE creditex_registry_accounts SET enabled=0,version=version+1,updated_at=? WHERE organisation_id=? AND id=? AND version=? AND enabled=1")
    .bind(now(),actor.organisationId,account.id,account.version),audit(db,actor,"registry_account_disabled",account.id,{},true)]);
  if(!results[0].meta.changes) fail("REGISTRY_ACCOUNT_CHANGED","The account changed or was already disabled.");
}

export async function attachRegistryAccount(db:D1Database,actor:RegistryActor,input:Input,options:RegistryOptions={}) {
  await permit(db,actor,"canOperate");
  const packet=await loadCreditexOutputAction(db,actor.organisationId,text(input.packetId,"claim"));
  if(packet.packetSha256!==input.expectedPacketSha256) fail("REGISTRY_PACKET_CHANGED","Refresh the exact reviewed claim before continuing.");
  if(packet.review?.decision!=="approved") fail("REGISTRY_APPROVAL_REQUIRED","Independently approve the claim before selecting its claiming account.");
  const account=await requireRegistryAccount(db,actor,input.accountId,true,options);
  if(registrySchemeForProgram(packet.programCode)!==account.scheme) fail("REGISTRY_SCHEME_MISMATCH","The claim and claiming account belong to different schemes.");
  if(!account.activityScope.includes(packet.activityTemplateId)) fail("REGISTRY_ACTIVITY_NOT_AUTHORISED","Add this exact activity to the account's authorised activity scope first.");
  const prior=await db.prepare("SELECT account_id,packet_sha256 FROM creditex_registry_claim_accounts WHERE organisation_id=? AND packet_id=?").bind(actor.organisationId,packet.id).first<{account_id:string;packet_sha256:string}>();
  if(prior) {
    if(prior.account_id!==account.id||prior.packet_sha256!==packet.packetSha256) fail("REGISTRY_ACCOUNT_ALREADY_BOUND","This immutable claim is already bound to another account. Review its submission history.");
    return;
  }
  await db.batch([db.prepare("INSERT INTO creditex_registry_claim_accounts (organisation_id,packet_id,account_id,packet_sha256,bound_by_uid,created_at) VALUES (?,?,?,?,?,?)")
    .bind(actor.organisationId,packet.id,account.id,packet.packetSha256,actor.actorUid,now(options)),audit(db,actor,"registry_claim_account_bound",packet.id,{accountId:account.id})]);
}

export async function requireRegistryClaimBinding(db:D1Database,actor:RegistryActor,packetId:string,accountId:string) {
  const link=await db.prepare("SELECT packet_sha256 FROM creditex_registry_claim_accounts WHERE organisation_id=? AND packet_id=? AND account_id=?")
    .bind(actor.organisationId,packetId,accountId).first<{packet_sha256:string}>();
  if(!link) fail("REGISTRY_CLAIM_ACCOUNT_REQUIRED","Select the reviewed claim's matching registry account first.");
  const packet=await loadCreditexOutputAction(db,actor.organisationId,packetId);
  if(packet.packetSha256!==link.packet_sha256) fail("REGISTRY_PACKET_CHANGED","The claim does not match its retained account binding.");
  return packet;
}

export async function storeRegistryEvidence(db:D1Database,actor:RegistryActor,file:File,options:RegistryOptions={}) {
  await permit(db,actor,"canOperate");
  if(file.size<=0||file.size>5*1024*1024) fail("REGISTRY_EVIDENCE_SIZE","Choose an evidence file up to 5 MB.",400);
  const extension=file.name.split(".").pop()?.toLowerCase(),mime=extension==="pdf"?"application/pdf":extension==="json"?"application/json":extension==="csv"?"text/csv":extension==="txt"?"text/plain":"";
  if(!mime) fail("REGISTRY_EVIDENCE_TYPE","Use a PDF, CSV, JSON or plain-text evidence file.",400);
  const bytes=await file.arrayBuffer();
  if(mime==="application/pdf"&&new TextDecoder().decode(bytes.slice(0,5))!=="%PDF-") fail("REGISTRY_EVIDENCE_TYPE","The file is not a PDF document.",400);
  if(mime!=="application/pdf") {
    try { const content=new TextDecoder("utf-8",{fatal:true}).decode(bytes); if(mime==="application/json") JSON.parse(content); }
    catch { fail("REGISTRY_EVIDENCE_TYPE","Use a valid UTF-8 text file or valid JSON document.",400); }
  }
  return persistRegistryEvidence(db,actor,{bytes,filename:file.name,mime},options);
}

export async function persistRegistryEvidence(db:D1Database,actor:RegistryActor,input:{bytes:ArrayBuffer;filename:string;mime:string},options:RegistryOptions={}) {
  const id=crypto.randomUUID(),bucket=options.bucket||getCreditexCustodyBucket(),key=`creditex/registry/${encodeURIComponent(actor.organisationId)}/${id}`;
  const sha=creditexRawSha256(new Uint8Array(input.bytes)),filename=input.filename.replace(/[^a-zA-Z0-9._ -]/g,"_").slice(0,160)||"registry-evidence.txt";
  await bucket.put(key,input.bytes,{httpMetadata:{contentType:input.mime},customMetadata:{organisationId:actor.organisationId,sha256:sha}});
  await db.batch([db.prepare("INSERT INTO creditex_registry_evidence (id,organisation_id,object_key,filename,content_type,byte_length,sha256,created_by_uid,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(id,actor.organisationId,key,filename,input.mime,input.bytes.byteLength,sha,actor.actorUid,now(options)),audit(db,actor,"registry_evidence_retained",id,{sha256:sha,bytes:input.bytes.byteLength})]);
  return id;
}
export async function requireRegistryEvidence(db:D1Database,actor:RegistryActor,id:unknown) {
  const row=await db.prepare("SELECT * FROM creditex_registry_evidence WHERE organisation_id=? AND id=?").bind(actor.organisationId,text(id,"original regulator evidence")).first<EvidenceRow>();
  if(!row) fail("REGISTRY_EVIDENCE_NOT_FOUND","Upload the original evidence for this organisation.",404);
  return row;
}
export async function downloadRegistryEvidence(db:D1Database,actor:RegistryActor,id:unknown,options:RegistryOptions={}) {
  await registryCapabilities(db,actor);
  const row=await requireRegistryEvidence(db,actor,id),object=await (options.bucket||getCreditexCustodyBucket()).get(row.object_key);
  if(!object) fail("REGISTRY_EVIDENCE_MISSING","The retained evidence is unavailable.",503);
  const bytes=await object.arrayBuffer();
  if(bytes.byteLength!==row.byte_length||creditexRawSha256(new Uint8Array(bytes))!==row.sha256) fail("REGISTRY_EVIDENCE_INTEGRITY","The evidence failed its integrity check.",409);
  await audit(db,actor,"registry_evidence_downloaded",row.id).run();
  return new Response(bytes,{headers:{"Content-Type":row.content_type,"Content-Disposition":`attachment; filename="${row.filename}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}

export async function recordRegistryInvoice(db:D1Database,actor:RegistryActor,input:Input,options:RegistryOptions={}) {
  await permit(db,actor,"canOperate");
  const account=await requireRegistryAccount(db,actor,input.accountId),reference=text(input.reference,"regulator invoice reference",180),amount=registryMoneyMinor(input.amount),due=date(input.dueDate,"invoice due date");
  const evidence=await requireRegistryEvidence(db,actor,input.evidenceId),packets=strings(input.packetIds,"claims covered by this invoice").sort();
  for(const packetId of packets) {
    const packet=await requireRegistryClaimBinding(db,actor,packetId,account.id);
    if(packet.status==="prepared"||!packet.providerReference) fail("REGISTRY_LODGEMENT_REQUIRED","Record the actual registry submission reference before its fee invoice.");
  }
  const hash=creditexCanonicalSha256({accountId:account.id,reference,amount,due,evidenceId:evidence.id,packets});
  const existing=await db.prepare("SELECT id,payload_sha256 FROM creditex_registry_invoices WHERE organisation_id=? AND account_id=? AND reference=?").bind(actor.organisationId,account.id,reference).first<{id:string;payload_sha256:string}>();
  if(existing) { if(existing.payload_sha256!==hash) fail("REGISTRY_INVOICE_CONFLICT","This invoice reference already has different retained details."); return existing.id; }
  const id=crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO creditex_registry_invoices (id,organisation_id,account_id,reference,amount_minor,due_date,evidence_id,payload_sha256,created_by_uid,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(id,actor.organisationId,account.id,reference,amount,due,evidence.id,hash,actor.actorUid,now(options)),
    ...packets.map(packetId=>db.prepare("INSERT INTO creditex_registry_invoice_claims (organisation_id,invoice_id,packet_id) VALUES (?,?,?)").bind(actor.organisationId,id,packetId)),
    audit(db,actor,"registry_invoice_recorded",id,{accountId:account.id,amountMinor:amount}),
  ]);
  return id;
}

export async function recordRegistryPayment(db:D1Database,actor:RegistryActor,input:Input,options:RegistryOptions={}) {
  await permit(db,actor,"canOperate");
  const invoiceId=text(input.invoiceId,"fee invoice"),reference=text(input.reference,"payment reference",180),amount=registryMoneyMinor(input.amount),paidAt=occurred(input.paidAt,"Payment date",options);
  const evidence=await requireRegistryEvidence(db,actor,input.evidenceId),hash=creditexCanonicalSha256({invoiceId,reference,amount,paidAt,evidenceId:evidence.id});
  const prior=await db.prepare("SELECT id,payload_sha256 FROM creditex_registry_payments WHERE organisation_id=? AND invoice_id=? AND reference=?").bind(actor.organisationId,invoiceId,reference).first<{id:string;payload_sha256:string}>();
  if(prior) { if(prior.payload_sha256!==hash) fail("REGISTRY_PAYMENT_CONFLICT","This payment reference already has different evidence."); return prior.id; }
  const id=crypto.randomUUID();
  const results=await db.batch([
    db.prepare(`INSERT INTO creditex_registry_payments (id,organisation_id,invoice_id,reference,amount_minor,paid_at,evidence_id,payload_sha256,created_by_uid,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,? FROM creditex_registry_invoices invoice WHERE invoice.organisation_id=? AND invoice.id=? AND invoice.status='active'
      AND ? <= invoice.amount_minor - COALESCE((SELECT SUM(payment.amount_minor) FROM creditex_registry_payments payment WHERE payment.organisation_id=invoice.organisation_id AND payment.invoice_id=invoice.id),0)
      ON CONFLICT(organisation_id,invoice_id,reference) DO NOTHING`)
      .bind(id,actor.organisationId,invoiceId,reference,amount,paidAt,evidence.id,hash,actor.actorUid,now(options),actor.organisationId,invoiceId,amount),
    audit(db,actor,"registry_payment_evidence_recorded",id,{invoiceId,amountMinor:amount},true),
  ]);
  if(!results[0].meta.changes) {
    const retained=await db.prepare("SELECT id,payload_sha256 FROM creditex_registry_payments WHERE organisation_id=? AND invoice_id=? AND reference=?").bind(actor.organisationId,invoiceId,reference).first<{id:string;payload_sha256:string}>();
    if(retained) {if(retained.payload_sha256!==hash) fail("REGISTRY_PAYMENT_CONFLICT","This payment reference already has different evidence.");return retained.id;}
    fail("REGISTRY_PAYMENT_EXCEEDS_BALANCE","The invoice is unavailable, void, or this payment exceeds its remaining balance.");
  }
  return id;
}

export async function recordRegistryResult(db:D1Database,actor:RegistryActor,input:Input,options:RegistryOptions={}) {
  await permit(db,actor,"canOperate");
  const account=await requireRegistryAccount(db,actor,input.accountId),packet=await requireRegistryClaimBinding(db,actor,text(input.packetId,"claim"),account.id);
  if(packet.packetSha256!==input.expectedPacketSha256) fail("REGISTRY_PACKET_CHANGED","Refresh the exact claim before recording its result.");
  if(packet.status==="prepared"||!packet.providerReference) fail("REGISTRY_LODGEMENT_REQUIRED","Record the actual external submission before importing its outcome.");
  const reference=text(input.externalReference,"registry reference",240);
  if(packet.providerReference!==reference) fail("REGISTRY_REFERENCE_MISMATCH","The result reference differs from the claim's recorded external submission.");
  const status=input.registryStatus;
  if(status!=="submitted"&&status!=="assessment"&&status!=="registered"&&status!=="rejected"&&status!=="withdrawn") fail("REGISTRY_STATUS_INVALID","Choose the status shown by the registry.",400);
  if(status==="registered"&&(account.scheme==="reps"||account.scheme==="eeis")) fail("REGISTRY_STATUS_INVALID","This scheme uses retailer reporting. Record its provider acceptance through the reviewed operational output.",400);
  const amount=quantity(input.quantity,status==="registered");
  if(status==="registered"&&amount!==packet.quantity) fail("REGISTRY_QUANTITY_MISMATCH","The registered quantity differs from the approved claim. Record an assessment exception and resolve the quantity before confirming registration.");
  const evidence=await requireRegistryEvidence(db,actor,input.evidenceId),at=occurred(input.occurredAt,"Registry event date",options,packet.preparedAt),note=text(input.note,"result evidence note",2000);
  return insertRegistryResult(db,actor,{packetId:packet.id,accountId:account.id,externalReference:reference,registryStatus:status,quantity:amount,occurredAt:at,evidenceId:evidence.id,note,source:"reviewed_document"},options);
}

export async function insertRegistryResult(db:D1Database,actor:RegistryActor,input:Omit<RegistryResult,"id"|"recordedByUid"|"reviewStatus"|"canReview"|"createdAt">,options:RegistryOptions={}) {
  const fingerprint=creditexCanonicalSha256({...input,evidenceId:undefined}),id=crypto.randomUUID();
  const existing=await db.prepare("SELECT id FROM creditex_registry_results WHERE organisation_id=? AND packet_id=? AND fingerprint=?").bind(actor.organisationId,input.packetId,fingerprint).first<{id:string}>();
  if(existing) return existing.id;
  await db.batch([db.prepare(`INSERT INTO creditex_registry_results (id,organisation_id,packet_id,account_id,external_reference,registry_status,quantity,occurred_at,evidence_id,note,source,fingerprint,recorded_by_uid,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,actor.organisationId,input.packetId,input.accountId,input.externalReference,input.registryStatus,input.quantity,input.occurredAt,input.evidenceId,input.note,input.source,fingerprint,actor.actorUid,now(options)),
    audit(db,actor,"registry_result_retained",id,{packetId:input.packetId,source:input.source})]);
  return id;
}

export async function reviewRegistryResult(db:D1Database,actor:RegistryActor,input:Input,options:RegistryOptions={}) {
  await permit(db,actor,"canReview");
  const id=text(input.resultId,"registry result"),decision=input.decision,note=text(input.note,"independent review note",2000);
  if(decision!=="approved"&&decision!=="rejected") fail("REGISTRY_REVIEW_INVALID","Choose approve or reject.",400);
  const result=await db.prepare("SELECT * FROM creditex_registry_results WHERE organisation_id=? AND id=?").bind(actor.organisationId,id).first<ResultRow>();
  if(!result) fail("REGISTRY_RESULT_NOT_FOUND","The result was not found.",404);
  if(result.source!=="reviewed_document"||result.recorded_by_uid===actor.actorUid) fail("REGISTRY_INDEPENDENT_REVIEW_REQUIRED","A different authorised reviewer must verify the original registry document.");
  const packet=await requireRegistryClaimBinding(db,actor,result.packet_id,result.account_id);
  if(packet.providerReference!==result.external_reference||(result.registry_status==="registered"&&packet.quantity!==result.quantity)) fail("REGISTRY_RESULT_MISMATCH","The result no longer matches the claim's reference and quantity.");
  const prior=await db.prepare("SELECT decision FROM creditex_registry_result_reviews WHERE organisation_id=? AND result_id=?").bind(actor.organisationId,id).first<{decision:string}>();
  if(prior) fail("REGISTRY_ALREADY_REVIEWED","This exact result has already been reviewed.");
  if(decision==="approved") await downloadRegistryEvidence(db,actor,result.evidence_id,options);
  await db.batch([db.prepare(`INSERT INTO creditex_registry_result_reviews (organisation_id,result_id,decision,note,reviewed_by_uid,created_at)
    SELECT ?,?,?,?,?,? FROM creditex_registry_results WHERE organisation_id=? AND id=? AND recorded_by_uid<>? AND source='reviewed_document'`)
    .bind(actor.organisationId,id,decision,note,actor.actorUid,now(options),actor.organisationId,id,actor.actorUid),audit(db,actor,"registry_result_reviewed",id,{decision})]);
}

export async function loadRegistryWorkspace(db:D1Database,actor:RegistryActor):Promise<RegistryWorkspace> {
  const capabilities=await registryCapabilities(db,actor);
  const [accountRows,actions,bindings,invoiceRows,paymentRows,resultRows,syncRows,currentResultRows]=await Promise.all([
    db.prepare("SELECT * FROM creditex_registry_accounts WHERE organisation_id=? ORDER BY scheme,legal_name").bind(actor.organisationId).all<AccountRow>(),
    listCreditexOutputActions(db,actor),
    db.prepare("SELECT packet_id,account_id FROM creditex_registry_claim_accounts WHERE organisation_id=?").bind(actor.organisationId).all<{packet_id:string;account_id:string}>(),
    db.prepare(`SELECT invoice.*, COALESCE((SELECT SUM(amount_minor) FROM creditex_registry_payments p WHERE p.organisation_id=invoice.organisation_id AND p.invoice_id=invoice.id),0) paid_minor,
      COALESCE((SELECT json_group_array(packet_id) FROM creditex_registry_invoice_claims c WHERE c.organisation_id=invoice.organisation_id AND c.invoice_id=invoice.id),'[]') packet_ids
      FROM creditex_registry_invoices invoice WHERE organisation_id=? ORDER BY created_at DESC LIMIT 1000`).bind(actor.organisationId)
      .all<{id:string;account_id:string;reference:string;amount_minor:number;paid_minor:number;due_date:string;evidence_id:string;packet_ids:string;created_at:string;status:"active"|"void"}>(),
    db.prepare("SELECT * FROM creditex_registry_payments WHERE organisation_id=? ORDER BY paid_at DESC LIMIT 2000").bind(actor.organisationId)
      .all<{id:string;invoice_id:string;reference:string;amount_minor:number;paid_at:string;evidence_id:string}>(),
    db.prepare(`SELECT result.*, COALESCE(review.decision,CASE WHEN result.source='rec_public_register' THEN 'approved' ELSE 'pending' END) review_status
      FROM creditex_registry_results result LEFT JOIN creditex_registry_result_reviews review ON review.organisation_id=result.organisation_id AND review.result_id=result.id
      WHERE result.organisation_id=? ORDER BY result.occurred_at DESC,result.created_at DESC,result.id DESC LIMIT 3000`).bind(actor.organisationId).all<ResultRow>(),
    db.prepare("SELECT account_id,MAX(completed_at) completed_at FROM creditex_registry_sync_runs WHERE organisation_id=? AND completed_at<>'' GROUP BY account_id")
      .bind(actor.organisationId).all<{account_id:string;completed_at:string}>(),
    db.prepare(`WITH confirmed AS (
      SELECT result.*, 'approved' review_status, ROW_NUMBER() OVER (PARTITION BY result.packet_id ORDER BY result.occurred_at DESC,result.created_at DESC,result.id DESC) rank
      FROM creditex_registry_results result LEFT JOIN creditex_registry_result_reviews review ON review.organisation_id=result.organisation_id AND review.result_id=result.id
      WHERE result.organisation_id=? AND (review.decision='approved' OR result.source='rec_public_register')
    ) SELECT * FROM confirmed WHERE rank=1`).bind(actor.organisationId).all<ResultRow>(),
  ]);
  const results:RegistryResult[]=resultRows.results.map(row=>({id:row.id,packetId:row.packet_id,accountId:row.account_id,externalReference:row.external_reference,
    registryStatus:row.registry_status,quantity:row.quantity,occurredAt:row.occurred_at,evidenceId:row.evidence_id,note:row.note,recordedByUid:row.recorded_by_uid,
    source:row.source,reviewStatus:row.review_status,canReview:capabilities.canReview&&row.review_status==="pending"&&row.recorded_by_uid!==actor.actorUid,createdAt:row.created_at}));
  const latest=new Map(currentResultRows.results.map(row=>[row.packet_id,row]));
  const accountByPacket=new Map(bindings.results.map(row=>[row.packet_id,row.account_id]));
  const checkedByAccount=new Map(syncRows.results.map(row=>[row.account_id,row.completed_at]));
  const claims:RegistryWorkspace["claims"]=actions.flatMap(action=>{
    const scheme=registrySchemeForProgram(action.programCode);
    if(!scheme) return [];
    const result=latest.get(action.id);
    return [{packetId:action.id,packetSha256:action.packetSha256,scheme,jobReference:action.jobReference,jobLabel:action.jobLabel,customerLabel:action.customerLabel,
      activityTitle:action.activityTitle,quantity:action.quantity,unit:action.unit,status:action.status,approved:action.review?.decision==="approved",canSubmit:action.capabilities.canSubmit,
      providerReference:action.providerReference,accountId:accountByPacket.get(action.id)||"",registryStatus:result?.registry_status||"unconfirmed",registeredQuantity:result?.registry_status==="registered"?result.quantity:"",
      lastCheckedAt:[result?.created_at||"",checkedByAccount.get(accountByPacket.get(action.id)||"")||""].sort().at(-1)||""}];
  });
  return {schemes:REGISTRY_SCHEMES,accounts:accountRows.results.map(projectAccount),claims,results,capabilities,
    invoices:invoiceRows.results.map(row=>({id:row.id,accountId:row.account_id,reference:row.reference,amountMinor:row.amount_minor,paidMinor:row.paid_minor,dueDate:row.due_date,
      evidenceId:row.evidence_id,packetIds:JSON.parse(row.packet_ids),createdAt:row.created_at,status:row.status})),
    payments:paymentRows.results.map(row=>({id:row.id,invoiceId:row.invoice_id,reference:row.reference,amountMinor:row.amount_minor,paidAt:row.paid_at,evidenceId:row.evidence_id}))};
}

export async function registryOnboardingRequest(db:D1Database,actor:RegistryActor,accountId:unknown) {
  await registryCapabilities(db,actor);
  const account=await requireRegistryAccount(db,actor,accountId),scheme=REGISTRY_SCHEMES.find(item=>item.key===account.scheme)!;
  const lines=[`Registry connection request: ${scheme.title}`,"",`Legal entity: ${account.legalName}`,`Claiming account: ${account.accountReference}`,
    `Submitting account: ${account.submitterReference||"To be confirmed"}`,`Activity scope: ${account.activityScope.join(", ")}`,`Finance contact: ${account.financeEmail}`,
    `Results contact: ${account.resultsEmail}`,`Authority reference: ${account.authorityReference}`,"",
    "Please confirm the approved process for TLink to prepare and submit claims for the account above, including the account holder's delegation requirements.",
    "Please provide the current interface specification, supported activities, test access, authentication requirements, submission and response formats, duplicate handling, and fee/status retrieval options.","",
    "The account holder should review and send this request. This downloaded document does not itself grant registry access or submit any claims."];
  if(account.scheme==="veu") lines.splice(2,0,"To: veu@esc.vic.gov.au","Please invite our monitored results contact to MuleSoft Exchange and confirm access to the VEU Registry Experience API. We need separate UAT and production approval.","");
  return lines.join("\n");
}

export async function listRegistryUnresolvedMatches(db:D1Database,actor:RegistryActor) {
  await registryCapabilities(db,actor);
  const rows=await db.prepare(`WITH latest AS (
    SELECT *,ROW_NUMBER() OVER(PARTITION BY packet_id ORDER BY source_date DESC,checked_at DESC) rank
    FROM creditex_registry_sync_matches WHERE organisation_id=?
  ) SELECT packet_id,evidence_id,source_date,checked_at FROM latest WHERE rank=1 AND confirmed=0
    AND NOT EXISTS(SELECT 1 FROM creditex_registry_results r
      JOIN creditex_registry_result_reviews v ON v.organisation_id=r.organisation_id AND v.result_id=r.id AND v.decision='approved'
      WHERE r.organisation_id=latest.organisation_id AND r.packet_id=latest.packet_id AND r.created_at>=latest.checked_at)
    ORDER BY checked_at DESC LIMIT 1000`).bind(actor.organisationId).all<{packet_id:string;evidence_id:string;source_date:string;checked_at:string}>();
  return rows.results.map(row=>({packetId:row.packet_id,evidenceId:row.evidence_id,sourceDate:row.source_date,checkedAt:row.checked_at}));
}
