import { getD1 } from "../../../../../db";
import { loadAuditCalls, prepareAuditCall, cancelAuditCall, retryAuditRecording, CreditexAuditCallError } from "@/lib/creditex-audit-call-server";
import { auditCallJson, auditCallError, auditCallMember, assertAuditCallOrigin } from "@/lib/creditex-audit-call-route-server";
export const runtime="edge";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  try {
    const db=getD1(),member=await auditCallMember(request,db),query=new URL(request.url).searchParams;
    return auditCallJson(await loadAuditCalls(db,member,{caseId:query.get("caseId")||undefined,jobIntentId:query.get("jobIntentId")||undefined}));
  } catch(error) { return auditCallError(error); }
}
export async function POST(request:Request) {
  try {
    assertAuditCallOrigin(request);
    const db=getD1(),member=await auditCallMember(request,db);
    const raw=await request.text();
    if(raw.length>5000) throw new CreditexAuditCallError("AUDIT_CALL_REQUEST_INVALID",400,"The call request is too large.");
    let body;
    try { body=JSON.parse(raw); } catch { throw new CreditexAuditCallError("AUDIT_CALL_REQUEST_INVALID",400,"Invalid call request."); }
    if(!body||typeof body!=="object"||Array.isArray(body)) throw new CreditexAuditCallError("AUDIT_CALL_REQUEST_INVALID",400,"Invalid call request.");
    const input={caseId:body.caseId,jobIntentId:body.jobIntentId};
    if(body.action==="prepare") return auditCallJson(await prepareAuditCall(db,member,input,body.requestId));
    if(typeof body.callId!=="string"||body.callId.length>100) throw new CreditexAuditCallError("AUDIT_CALL_REQUEST_INVALID",400,"Choose the call to update.");
    if(body.action==="cancel") await cancelAuditCall(db,member,input,body.callId);
    else if(body.action==="retry_recording") await retryAuditRecording(db,member,input,body.callId);
    else throw new CreditexAuditCallError("AUDIT_CALL_ACTION_INVALID",400,"Choose a supported call action.");
    return auditCallJson({ok:true});
  } catch(error) { return auditCallError(error); }
}
