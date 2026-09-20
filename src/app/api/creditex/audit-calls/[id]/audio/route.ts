import { getD1 } from "../../../../../../../db";
import { readAuditCallAudio } from "@/lib/creditex-audit-call-server";
import { auditCallError, auditCallMember } from "@/lib/creditex-audit-call-route-server";
export const runtime="edge";
export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
  try {
    const db=getD1(),member=await auditCallMember(request,db),{id}=await context.params;
    const audio=await readAuditCallAudio(db,member,id);
    return new Response(audio.bytes,{headers:{"Content-Type":"audio/mpeg","Content-Length":String(audio.bytes.byteLength),"Content-Disposition":"inline; filename=creditex-audit-call.mp3",
      "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Audit-Recording-SHA256":audio.sha256}});
  } catch(error) { return auditCallError(error); }
}
