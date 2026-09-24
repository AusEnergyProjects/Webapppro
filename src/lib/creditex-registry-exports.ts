import { analyseCreditexCsv, creditexCanonicalSha256 } from "./creditex-interchange-preflight";
import { listRegistryFormats, serializeRegistryRows, type RegistryFormatDescriptor } from "./creditex-registry-formats";
import { recheckOutputDispatchEvidence } from "./creditex-output-action-server";
import { CreditexRegistryError, registryCapabilities, requireRegistryAccount, requireRegistryClaimBinding,
  persistRegistryEvidence, downloadRegistryEvidence, type RegistryActor, type RegistryOptions } from "./creditex-registry-server";
import { registrySchemeForProgram, type RegistryExport } from "./creditex-registry";

type Input=Readonly<Record<string,unknown>>;
type ExportRow={id:string;account_id:string;format_key:string;packet_ids:string;packet_hashes:string;base_vintage:string;evidence_id:string;
  payload_sha256:string;account_version:number;format_sha256:string;created_by_uid:string;created_at:string;review_status:"pending"|"approved"|"rejected"};
function fail(code:string,message:string,status=409):never {throw new CreditexRegistryError(code,status,message);}
function formatFor(key:unknown) {const format=listRegistryFormats().find(item=>item.key===key);if(!format) fail("REGISTRY_FORMAT_INVALID","Choose an official file format.",400);return format;}
function identifiers(value:unknown):string[] {
  if(!Array.isArray(value)||!value.length||value.length>3000||value.some(item=>typeof item!=="string"||!item||item.length>240)||new Set(value).size!==value.length)
    fail("REGISTRY_EXPORT_CLAIMS","Select distinct reviewed claims.",400);
  return value.map(String).sort();
}
function formatHash(format:RegistryFormatDescriptor) {return creditexCanonicalSha256(format);}
function audit(db:D1Database,actor:RegistryActor,event:string,id:string) {
  return db.prepare(`INSERT INTO compliance_audit_events(id,organisation_id,actor_type,actor_uid,event_type,target_type,target_id,summary,metadata,created_at)
    VALUES(?,?,?,?,?,'registry_export',?,'Official submission file retained or reviewed.','{}',?)`)
    .bind(crypto.randomUUID(),actor.organisationId,actor.actorKind==="admin"?"platform":"compliance",actor.actorUid,event,id,new Date().toISOString());
}
async function context(db:D1Database,actor:RegistryActor,input:Input,options:RegistryOptions={}) {
  const account=await requireRegistryAccount(db,actor,input.accountId,true,options),format=formatFor(input.formatKey),packetIds=identifiers(input.packetIds);
  if(registrySchemeForProgram(format.scheme)!==account.scheme) fail("REGISTRY_EXPORT_SCHEME","The file format does not match the claiming account.");
  if(packetIds.length>format.maximumRecords) fail("REGISTRY_EXPORT_LIMIT",`Select at most ${format.maximumRecords} claims for this format.`,400);
  const packets=[];
  for(const id of packetIds) {
    const packet=await requireRegistryClaimBinding(db,actor,id,account.id);
    if(packet.review?.decision!=="approved"||packet.status!=="prepared"||packet.providerReference) fail("REGISTRY_EXPORT_NOT_READY","Only independently approved claims awaiting lodgement can be exported.");
    if(!account.activityScope.includes(packet.activityTemplateId)||registrySchemeForProgram(packet.programCode)!==account.scheme) fail("REGISTRY_ACTIVITY_NOT_AUTHORISED","The account no longer authorises this claim's activity.");
    const recActivities:Readonly<Record<string,readonly string[]>>={rec_sgu:["sres-pv","sres-wind","sres-hydro"],rec_swh:["sres-swh","sres-ashp"],rec_battery:["sres-bess"]};
    if(account.scheme==="stc"&&!recActivities[format.key]?.includes(packet.activityTemplateId)) fail("REGISTRY_EXPORT_ACTIVITY","Choose the REC file format for this approved activity.");
    await recheckOutputDispatchEvidence(db,actor,packet);
    packets.push(packet);
  }
  return {account,format,packetIds,packetHashes:packets.map(packet=>packet.packetSha256)};
}
export async function registryExportTemplate(db:D1Database,actor:RegistryActor,input:Input,options:RegistryOptions={}) {
  if(!(await registryCapabilities(db,actor)).canOperate) fail("REGISTRY_PERMISSION_DENIED","Your role cannot prepare submission files.",403);
  const {format,packetIds}=await context(db,actor,input,options);
  const cell=(value:string)=>/[",\r\n]/.test(value)?`"${value.replaceAll('"','""')}"`:value;
  return [format.headers,...packetIds.map(id=>format.headers.map(header=>header===format.referenceField?id:""))]
    .map(row=>row.map(cell).join(",")).join("\r\n")+"\r\n";
}
export async function prepareRegistryExport(db:D1Database,actor:RegistryActor,input:Input,options:RegistryOptions={}) {
  if(!(await registryCapabilities(db,actor)).canOperate) fail("REGISTRY_PERMISSION_DENIED","Your role cannot prepare submission files.",403);
  if(typeof input.csv!=="string"||new TextEncoder().encode(input.csv).byteLength>2*1024*1024) fail("REGISTRY_EXPORT_SIZE","Choose a UTF-8 CSV up to 2 MB.",400);
  const current=await context(db,actor,input,options),{format,account,packetIds,packetHashes}=current;
  const baseVintage=typeof input.baseVintage==="string"?input.baseVintage.trim():"";
  if(format.key.startsWith("nsw_")&&!/^(19|20)\d{2}$/.test(baseVintage)) fail("REGISTRY_EXPORT_VINTAGE","Enter the four-digit base vintage selected in TESSA.",400);
  if(!format.key.startsWith("nsw_")&&baseVintage) fail("REGISTRY_EXPORT_VINTAGE","Base vintage is only used for TESSA files.",400);
  const parsed=analyseCreditexCsv(input.csv);
  if(parsed.issues.length||JSON.stringify(parsed.rows[0])!==JSON.stringify(format.headers)||parsed.rows.some(row=>row.length!==format.headers.length))
    fail("REGISTRY_EXPORT_HEADER","Use the exact current official headers and valid CSV structure.",400);
  const rows=parsed.rows.slice(1).map(row=>Object.fromEntries(format.headers.map((header,index)=>[header,row[index]])));
  const references=rows.map(row=>row[format.referenceField]).sort();
  if(JSON.stringify(references)!==JSON.stringify(packetIds)) fail("REGISTRY_EXPORT_REFERENCE","Each selected claim must appear once, using its unchanged reference from the downloaded template.",400);
  const serialized=serializeRegistryRows(format.key,rows);
  if(!serialized.valid||serialized.csv===null||!serialized.sha256) {
    const issue=serialized.issues[0];
    fail("REGISTRY_EXPORT_INVALID",`${issue?.rowNumber?`Row ${issue.rowNumber}: `:""}${issue?.field?`${issue.field}: `:""}${issue?.message||"The file failed validation."}`,400);
  }
  if(format.key==="nsw_esc"&&rows.some(row=>row["Calculation Method"].startsWith("Deemed Energy Savings Method - ")&&row["Implementation Date"].slice(-4)!==baseVintage))
    fail("REGISTRY_EXPORT_VINTAGE","The deemed implementation dates do not match the selected base vintage.",400);
  const schemaHash=formatHash(format),hash=creditexCanonicalSha256({csvSha256:serialized.sha256,accountId:account.id,accountVersion:account.version,baseVintage,packetIds,packetHashes,formatSha256:schemaHash});
  const prior=await db.prepare("SELECT id FROM creditex_registry_exports WHERE organisation_id=? AND account_id=? AND payload_sha256=?").bind(actor.organisationId,account.id,hash).first<{id:string}>();
  if(prior) return prior.id;
  const id=crypto.randomUUID(),bytes=new TextEncoder().encode(serialized.csv);
  const evidenceId=await persistRegistryEvidence(db,actor,{bytes:bytes.buffer,filename:`${format.key}-${id}.csv`,mime:"text/csv; charset=utf-8"},options);
  await db.batch([db.prepare(`INSERT INTO creditex_registry_exports(id,organisation_id,account_id,format_key,base_vintage,packet_ids,packet_hashes,evidence_id,payload_sha256,account_version,format_sha256,created_by_uid,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,actor.organisationId,account.id,format.key,baseVintage,JSON.stringify(packetIds),JSON.stringify(packetHashes),evidenceId,hash,account.version,schemaHash,actor.actorUid,options.now?.()||new Date().toISOString()),audit(db,actor,"registry_export_prepared",id)]);
  return id;
}
async function loadExport(db:D1Database,actor:RegistryActor,id:unknown) {
  if(typeof id!=="string") fail("REGISTRY_EXPORT_NOT_FOUND","The submission file was not found.",404);
  const row=await db.prepare(`SELECT e.*,COALESCE(r.decision,'pending') review_status FROM creditex_registry_exports e
    LEFT JOIN creditex_registry_export_reviews r ON r.organisation_id=e.organisation_id AND r.export_id=e.id WHERE e.organisation_id=? AND e.id=?`)
    .bind(actor.organisationId,id).first<ExportRow>();
  if(!row) fail("REGISTRY_EXPORT_NOT_FOUND","The submission file was not found.",404);
  return row;
}
async function checkExport(db:D1Database,actor:RegistryActor,row:ExportRow,options:RegistryOptions={}) {
  const current=await context(db,actor,{accountId:row.account_id,formatKey:row.format_key,packetIds:JSON.parse(row.packet_ids)},options);
  if(current.account.version!==row.account_version||JSON.stringify(current.packetHashes)!==row.packet_hashes||formatHash(current.format)!==row.format_sha256)
    fail("REGISTRY_EXPORT_CHANGED","The account, claim or official format changed. Prepare a new file for independent review.");
}
export async function reviewRegistryExport(db:D1Database,actor:RegistryActor,input:Input,options:RegistryOptions={}) {
  if(!(await registryCapabilities(db,actor)).canReview) fail("REGISTRY_PERMISSION_DENIED","Your role cannot review submission files.",403);
  const row=await loadExport(db,actor,input.exportId);
  if(row.created_by_uid===actor.actorUid) fail("REGISTRY_INDEPENDENT_REVIEW_REQUIRED","A different authorised reviewer must verify this exact submission file.");
  if(row.review_status!=="pending") fail("REGISTRY_ALREADY_REVIEWED","This exact submission file has already been reviewed.");
  if(input.decision!=="approved"&&input.decision!=="rejected") fail("REGISTRY_REVIEW_INVALID","Choose approve or reject.",400);
  if(typeof input.note!=="string"||!input.note.trim()||input.note.length>2000) fail("REGISTRY_REVIEW_NOTE","Record the review of the exact rows, supporting claims, claiming account and current scheme rules.",400);
  if(input.decision==="approved") await checkExport(db,actor,row,options);
  // Reading verifies the retained bytes before a reviewer can approve them.
  await downloadRegistryEvidence(db,actor,row.evidence_id,options);
  await db.batch([db.prepare("INSERT INTO creditex_registry_export_reviews(organisation_id,export_id,decision,note,reviewed_by_uid,created_at) VALUES(?,?,?,?,?,?)")
    .bind(actor.organisationId,row.id,input.decision,input.note.trim(),actor.actorUid,options.now?.()||new Date().toISOString()),audit(db,actor,"registry_export_reviewed",row.id)]);
}
export async function downloadRegistryExport(db:D1Database,actor:RegistryActor,id:unknown,options:RegistryOptions={}) {
  await registryCapabilities(db,actor);
  const row=await loadExport(db,actor,id);
  if(row.review_status!=="approved")
    fail("REGISTRY_EXPORT_APPROVAL_REQUIRED","Independent approval is required before downloading this file for lodgement.");
  await checkExport(db,actor,row,options);
  return downloadRegistryEvidence(db,actor,row.evidence_id,options);
}
export async function previewRegistryExport(db:D1Database,actor:RegistryActor,id:unknown,options:RegistryOptions={}) {
  await registryCapabilities(db,actor);
  const row=await loadExport(db,actor,id),response=await downloadRegistryEvidence(db,actor,row.evidence_id,options);
  const parsed=analyseCreditexCsv(await response.text());
  if(parsed.issues.length) fail("REGISTRY_EXPORT_INTEGRITY","The retained submission file cannot be parsed.");
  return {headers:parsed.rows[0],rows:parsed.rows.slice(1),reviewStatus:row.review_status};
}
export async function listRegistryExports(db:D1Database,actor:RegistryActor):Promise<RegistryExport[]> {
  const capabilities=await registryCapabilities(db,actor);
  const rows=await db.prepare(`SELECT e.*,COALESCE(r.decision,'pending') review_status FROM creditex_registry_exports e
    LEFT JOIN creditex_registry_export_reviews r ON r.organisation_id=e.organisation_id AND r.export_id=e.id WHERE e.organisation_id=? ORDER BY e.created_at DESC LIMIT 1000`)
    .bind(actor.organisationId).all<ExportRow>();
  return rows.results.map(row=>({id:row.id,accountId:row.account_id,formatKey:row.format_key,baseVintage:row.base_vintage,packetIds:JSON.parse(row.packet_ids),
    createdAt:row.created_at,createdByUid:row.created_by_uid,reviewStatus:row.review_status,canReview:capabilities.canReview&&row.review_status==="pending"&&row.created_by_uid!==actor.actorUid}));
}
