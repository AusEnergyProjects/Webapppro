import { ComplianceAccessError, requireComplianceAccess } from "./compliance-access-server";
import { CreditexAuditCallError } from "./creditex-audit-call-server";
import { CREDITEX_PARTNER_ORGANISATION_CODE } from "./trade-compliance-intent";

export function auditCallJson(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
export function auditCallError(error: unknown) {
  if (error instanceof CreditexAuditCallError || error instanceof ComplianceAccessError) return auditCallJson({ ok:false,code:error.code,error:error.message },error.status);
  if (error instanceof Error && error.message === "AUTH_REQUIRED") return auditCallJson({ok:false,code:"AUTH_REQUIRED",error:"Sign in to continue."},401);
  return auditCallJson({ok:false,code:"AUDIT_CALL_UNAVAILABLE",error:"The private audit call operation could not be completed."},503);
}
export async function auditCallMember(request:Request,database:D1Database) {
  const member=await requireComplianceAccess(request,{allowedRoles:["admin","case_manager","reviewer","auditor"]},database);
  if(member.organisationCode!==CREDITEX_PARTNER_ORGANISATION_CODE) throw new ComplianceAccessError("CREDITEX_ACCESS_REQUIRED",403,"Creditex access is required.");
  return member;
}
export function assertAuditCallOrigin(request:Request) {
  const origin=request.headers.get("origin");
  if(origin&&origin!==new URL(request.url).origin) throw new CreditexAuditCallError("ORIGIN_DENIED",403,"This request origin is not permitted.");
}
