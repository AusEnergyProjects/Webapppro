import { assertCertificateActivityEligibility, certificateActivityEligibilityPredicate, certificateActivityEligibilityGuardStatement, getCertificateActivityEligibility } from "./trade-training-server.ts";

// Every government programme activity requires its own training, including
// rebates, loans and retailer obligations. Unknown identifiers fail closed.
export function certificateActivityIds(activityTemplateIds: readonly string[]) {
  return [...new Set(activityTemplateIds)];
}

export async function certificateJobActivityIds(db: D1Database, ownerUid: string, workOrderId: string) {
  const rows = await db.prepare(`SELECT activity_template_id FROM trade_work_order_compliance_intents
    WHERE installer_uid = ? AND work_order_id = ? AND status IN ('planned', 'case_linked')`)
    .bind(ownerUid, workOrderId).all<{ activity_template_id: string }>();
  return certificateActivityIds(rows.results.map((row) => row.activity_template_id));
}

export async function assertCertificateJobEligibility(db: D1Database, input: {
  ownerUid: string; actorMemberId: string; assignedMemberId: string; workOrderId: string;
}) {
  const activityTemplateIds = await certificateJobActivityIds(db, input.ownerUid, input.workOrderId);
  if (activityTemplateIds.length) await assertCertificateActivityEligibility(db, { ...input, activityTemplateIds });
}

export async function certificateJobEligibilityPredicate(db: D1Database, input: {
  ownerUid: string; actorMemberId: string; assignedMemberId: string; workOrderId: string;
}) {
  return certificateActivityEligibilityPredicate({ ...input,
    activityTemplateIds: await certificateJobActivityIds(db, input.ownerUid, input.workOrderId) });
}

export async function certificateJobEligibilityGuards(db: D1Database, input: {
  ownerUid: string; actorMemberId: string; assignedMemberId: string; workOrderId: string;
}) {
  const activityTemplateIds = await certificateJobActivityIds(db, input.ownerUid, input.workOrderId);
  return activityTemplateIds.length ? [await certificateActivityEligibilityGuardStatement(db, { ...input, activityTemplateIds })] : [];
}

export async function certificateActivityBlockReason(db: D1Database, input: {
  ownerUid: string; actorMemberId: string; assignedMemberId: string; activityTemplateId: string;
}) {
  const activityTemplateIds = certificateActivityIds([input.activityTemplateId]);
  if (!activityTemplateIds.length) return "";
  const result = await getCertificateActivityEligibility(db, { ...input, activityTemplateIds });
  return result.eligible ? "" : result.reasons.map((reason) => reason.message).join(" ");
}
