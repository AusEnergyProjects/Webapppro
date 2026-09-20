import { receiveAuditCallWebhook } from "@/lib/creditex-audit-call-server";
import { auditCallError } from "@/lib/creditex-audit-call-route-server";
export const runtime="edge";
export const dynamic="force-dynamic";
export async function POST(request:Request) {
  try { await receiveAuditCallWebhook(request); return new Response(null,{status:204}); }
  catch(error) { return auditCallError(error); }
}
