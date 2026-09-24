import { readBoundedJsonRequest, BoundedJsonRequestError } from "@/lib/bounded-json-request";
import { ComplianceAccessError } from "@/lib/compliance-access-server";
import { CreditexActivityWorkPackServerError } from "@/lib/creditex-activity-work-pack-server";
import { CreditexOutputActionError } from "@/lib/creditex-output-action-server";
import { CreditexRegistryError, loadRegistryWorkspace, saveRegistryAccount, disableRegistryAccount,
  attachRegistryAccount, storeRegistryEvidence, downloadRegistryEvidence, registryOnboardingRequest,
  recordRegistryInvoice, recordRegistryPayment, recordRegistryResult, reviewRegistryResult,
  listRegistryUnresolvedMatches,
  type RegistryActor } from "@/lib/creditex-registry-server";
import { registryExportTemplate, prepareRegistryExport, reviewRegistryExport, downloadRegistryExport, previewRegistryExport, listRegistryExports } from "@/lib/creditex-registry-exports";
import { listRegistryFormats } from "@/lib/creditex-registry-formats";
import { syncRecRegistry } from "@/lib/creditex-registry-rec";
import { GOVERNMENT_ACTIVITY_TEMPLATES } from "@/lib/australian-government-program-catalogue";
import { registrySchemeForProgram } from "@/lib/creditex-registry";

export function registryJson(body:object,status=200) {
  return Response.json(body,{status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
export function registryError(error:unknown):Response|null {
  if(error instanceof CreditexRegistryError||error instanceof CreditexOutputActionError||error instanceof CreditexActivityWorkPackServerError||error instanceof ComplianceAccessError||error instanceof BoundedJsonRequestError)
    return registryJson({ok:false,code:"code" in error?error.code:undefined,error:error instanceof BoundedJsonRequestError&&error.status===413?"The registry request is too large.":error.message},error.status);
  return null;
}
function fileResponse(body:string,filename:string,type:string) {
  return new Response(body,{headers:{"Content-Type":type,"Content-Disposition":`attachment; filename="${filename}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
async function evidenceFile(request:Request) {
  if(!request.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new CreditexRegistryError("REGISTRY_UPLOAD_INVALID",400,"Choose an evidence file.");
  const reader=request.body?.getReader();
  if(!reader) throw new CreditexRegistryError("REGISTRY_UPLOAD_INVALID",400,"Choose an evidence file.");
  const chunks:Uint8Array[]=[];let size=0;
  try {
    for(;;) {
      const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>5*1024*1024+65536) {await reader.cancel();throw new CreditexRegistryError("REGISTRY_UPLOAD_SIZE",413,"Choose one evidence file up to 5 MB.");}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let data:FormData;
  try {data=await new Response(bytes,{headers:{"Content-Type":request.headers.get("content-type")!}}).formData();}
  catch {throw new CreditexRegistryError("REGISTRY_UPLOAD_INVALID",400,"The file upload could not be read.");}
  const file=data.get("file");
  if(!(file instanceof File)||[...data.values()].length!==1) throw new CreditexRegistryError("REGISTRY_UPLOAD_INVALID",400,"Upload one evidence file.");
  return file;
}
export async function handleRegistryRequest(request:Request,db:D1Database,actor:RegistryActor) {
  const url=new URL(request.url),query=url.searchParams;
  let sync:Awaited<ReturnType<typeof syncRecRegistry>>|undefined;
  if(request.method==="GET") {
    if(query.get("preview")==="export") return registryJson({ok:true,...await previewRegistryExport(db,actor,query.get("exportId"))});
    if(query.get("download")==="evidence") return downloadRegistryEvidence(db,actor,query.get("evidenceId"));
    if(query.get("download")==="onboarding") return fileResponse(await registryOnboardingRequest(db,actor,query.get("accountId")),"registry-connection-request.txt","text/plain; charset=utf-8");
    if(query.get("download")==="template") return fileResponse(await registryExportTemplate(db,actor,{accountId:query.get("accountId"),formatKey:query.get("formatKey"),packetIds:(query.get("packetIds")||"").split(",")}),"registry-template-to-complete.csv","text/csv; charset=utf-8");
    if(query.get("download")==="export") return downloadRegistryExport(db,actor,query.get("exportId"));
  } else if(request.method==="POST") {
    if(query.get("upload")==="evidence") return registryJson({ok:true,evidenceId:await storeRegistryEvidence(db,actor,await evidenceFile(request))});
    const value=await readBoundedJsonRequest(request,4*1024*1024);
    if(!value||typeof value!=="object"||Array.isArray(value)) throw new CreditexRegistryError("REGISTRY_INPUT_INVALID",400,"Send a valid registry action.");
    const input=value as Record<string,unknown>;
    switch(input.action) {
      case "download_template":return fileResponse(await registryExportTemplate(db,actor,input),"registry-template-to-complete.csv","text/csv; charset=utf-8");
      case "save_account":await saveRegistryAccount(db,actor,input);break;
      case "disable_account":await disableRegistryAccount(db,actor,input);break;
      case "attach_account":await attachRegistryAccount(db,actor,input);break;
      case "record_invoice":await recordRegistryInvoice(db,actor,input);break;
      case "record_payment":await recordRegistryPayment(db,actor,input);break;
      case "record_result":await recordRegistryResult(db,actor,input);break;
      case "review_result":await reviewRegistryResult(db,actor,input);break;
      case "sync_rec":sync=await syncRecRegistry(db,actor,{accountId:input.accountId,date:input.date});break;
      case "prepare_export":await prepareRegistryExport(db,actor,input);break;
      case "review_export":await reviewRegistryExport(db,actor,input);break;
      default:throw new CreditexRegistryError("REGISTRY_ACTION_INVALID",400,"Choose a supported registry action.");
    }
  } else return registryJson({ok:false,error:"Method not allowed."},405);
  const [workspace,exports,unresolvedMatches]=await Promise.all([loadRegistryWorkspace(db,actor),listRegistryExports(db,actor),listRegistryUnresolvedMatches(db,actor)]);
  const formats=listRegistryFormats().map(({key,label,scheme,headers,maximumRecords,referenceField,version})=>({key,label,scheme,headers,maximumRecords,referenceField,version}));
  const activityOptions=GOVERNMENT_ACTIVITY_TEMPLATES.flatMap(activity=>{
    const scheme=registrySchemeForProgram(activity.programCode);
    return scheme?[{activityTemplateId:activity.templateId,scheme,title:activity.title}]:[];
  });
  return registryJson({ok:true,...workspace,exports,formats,activityOptions,unresolvedMatches,sync});
}
