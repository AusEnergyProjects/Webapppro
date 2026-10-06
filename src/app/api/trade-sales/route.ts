import { getD1 } from '../../../../db';
import { adminJson, mfaErrorResponse, sameOrigin } from '@/lib/admin-server';
import { requireInstallerTeamAccess } from '@/lib/trade-team-server';
import { TradeBusinessContextError } from '@/lib/trade-business-context-server';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { SalesError } from '@/lib/trade-sales';
import { listSales, loadSalesConfig, saveSalesStages, updateSales } from '@/lib/trade-sales-server';

function failure(error: unknown) {
  const mfa=mfaErrorResponse(error); if(mfa) return mfa;
  if(error instanceof SalesError) return adminJson({ok:false,error:error.message,code:error.code},error.status);
  if(error instanceof BoundedJsonRequestError) return adminJson({ok:false,error:error.message},error.status);
  if(error instanceof TradeBusinessContextError) return adminJson({ok:false,error:error.publicMessage,code:error.code},error.status);
  if(error instanceof SyntaxError) return adminJson({ok:false,error:'Check the sales details.'},400);
  if(error instanceof Error && /^(AUTH_REQUIRED|EMAIL_VERIFICATION_REQUIRED|TEAM_ACCESS_RECORD_REQUIRED|ABN_REVIEW_REQUIRED)$/.test(error.message))
    return adminJson({ok:false,error:'Sales access could not be verified.'},error.message==='AUTH_REQUIRED'?401:403);
  return adminJson({ok:false,error:'The sales request could not be completed.'},500);
}
export async function GET(request: Request) {
  if(!sameOrigin(request)) return adminJson({ok:false,error:'Request origin was not accepted.'},403);
  try {
    const access=await requireInstallerTeamAccess(request),db=getD1(),params=new URL(request.url).searchParams;
    const mode=params.get('mode')||'list';
    if(mode!=='config'&&mode!=='list') throw new SalesError('Choose sales configuration or a sales list.');
    return adminJson({ok:true,...(mode==='config'?await loadSalesConfig(db,access):await listSales(db,access,params))});
  } catch(error) {return failure(error);}
}
export async function PATCH(request: Request) {
  if(!sameOrigin(request)) return adminJson({ok:false,error:'Request origin was not accepted.'},403);
  try {
    const access=await requireInstallerTeamAccess(request),db=getD1(),body:unknown=await readBoundedJsonRequest(request);
    if(!body||typeof body!=='object'||Array.isArray(body)||!('action' in body)) throw new SalesError('Choose a sales action.');
    if(body.action==='save_stages') return adminJson({ok:true,settings:await saveSalesStages(db,access,body)});
    if(body.action==='update') return adminJson({ok:true,item:await updateSales(db,access,body)});
    throw new SalesError('Choose a supported sales action.');
  } catch(error) {return failure(error);}
}
