import { safetyCustomerReport, safetyCustomerReportFile, SafetyCustomerReportError, revokeSafetyCustomerReportLink } from '@/lib/trade-safety-customer-report-server';
import { requireInstallerTeamAccess } from '@/lib/trade-team-server';
import { sameOrigin, mfaErrorResponse } from '@/lib/admin-server';
import { readBoundedJsonRequest, BoundedJsonRequestError } from '@/lib/bounded-json-request';
export const runtime='edge';
export const dynamic='force-dynamic';
const headers={ 'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
  'X-Robots-Tag':'noindex, nofollow, noarchive','Content-Security-Policy':"default-src 'none'; sandbox" };
function json(value:unknown,status=200) {return Response.json(value,{status,headers});}
export async function GET(request:Request) {
  try {
    const query=new URL(request.url).searchParams,token=query.get('token')||'',view=query.get('view');
    if(token.length>320)throw new SafetyCustomerReportError();
    if(view) {
      if(!['pdf','evidence','brand-logo'].includes(view))throw new SafetyCustomerReportError();
      const file=await safetyCustomerReportFile(token,view==='pdf'?'pdf':view==='evidence'?'evidence':'brand-logo',query.get('evidenceId')||undefined);
      return new Response(new Uint8Array(file.bytes),{headers:{...headers,'Content-Type':file.contentType,
        'Content-Disposition':`${view==='pdf'?'attachment':'inline'}; filename="${file.fileName.replace(/[^a-zA-Z0-9._ -]/g,'_')}"`}});
    }
    return json({ok:true,report:await safetyCustomerReport(token)});
  }catch(error){return json({ok:false,error:error instanceof SafetyCustomerReportError?error.message:'This private report could not be opened. Ask the inspecting business for help.'},error instanceof SafetyCustomerReportError?404:503);}
}
export async function POST(request:Request) {
  if(!sameOrigin(request))return json({ok:false,error:'Request origin was not accepted.'},403);
  try {
    const access=await requireInstallerTeamAccess(request),body=await readBoundedJsonRequest(request,4096);
    if(!body||typeof body!=='object'||Array.isArray(body)||!('action' in body)||body.action!=='revoke'
      ||!('recordId' in body)||typeof body.recordId!=='string'||!('kind' in body)||!['piesa','electrical','gas'].includes(String(body.kind)))
      return json({ok:false,error:'Choose the report to revoke.'},400);
    await revokeSafetyCustomerReportLink(access,body.recordId,body.kind==='piesa'?'piesa':body.kind==='electrical'?'electrical':'gas');
    return json({ok:true});
  }catch(error){const mfa=mfaErrorResponse(error);if(mfa)return mfa;
    return json({ok:false,error:'The report link could not be revoked.'},error instanceof BoundedJsonRequestError?error.status:error instanceof SafetyCustomerReportError?404:403);}
}
