import { assertCertificateActivityEligibility, certificateActivityEligibilityPredicate, certificateActivityEligibilityGuardStatement, getCertificateActivityEligibility, CreditexComplianceError } from "./trade-training-server.ts";

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

async function certificateJobServiceState(db: D1Database, ownerUid: string, workOrderId: string) {
  const rows = await db.prepare(`SELECT DISTINCT site_jurisdiction FROM trade_work_order_compliance_intents
    WHERE installer_uid=? AND work_order_id=? AND status IN ('planned', 'case_linked')`)
    .bind(ownerUid, workOrderId).all<{ site_jurisdiction: string }>();
  const states = rows.results.map(row => row.site_jurisdiction);
  if (states.length !== 1 || !['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'].includes(states[0])) {
    throw new CreditexComplianceError('JOB_SERVICE_REGION_REQUIRED', 'Set a valid service site state for this certificate booking.', 409);
  }
  return states[0];
}

export async function assertCertificateJobEligibility(db: D1Database, input: {
  ownerUid: string; actorMemberId: string; assignedMemberId: string; workOrderId: string;
}) {
  const activityTemplateIds = await certificateJobActivityIds(db, input.ownerUid, input.workOrderId);
  if (activityTemplateIds.length) await assertCertificateActivityEligibility(db, { ...input, activityTemplateIds,
    serviceState: await certificateJobServiceState(db, input.ownerUid, input.workOrderId) });
}

export async function certificateJobEligibilityPredicate(db: D1Database, input: {
  ownerUid: string; actorMemberId: string; assignedMemberId: string; workOrderId: string;
}) {
  const activityTemplateIds = await certificateJobActivityIds(db, input.ownerUid, input.workOrderId);
  return certificateActivityEligibilityPredicate({ ...input, activityTemplateIds,
    ...(activityTemplateIds.length ? { serviceState: await certificateJobServiceState(db, input.ownerUid, input.workOrderId) } : {}) });
}

export async function certificateJobEligibilityGuards(db: D1Database, input: {
  ownerUid: string; actorMemberId: string; assignedMemberId: string; workOrderId: string;
}) {
  const activityTemplateIds = await certificateJobActivityIds(db, input.ownerUid, input.workOrderId);
  return activityTemplateIds.length ? [await certificateActivityEligibilityGuardStatement(db, { ...input, activityTemplateIds,
    serviceState: await certificateJobServiceState(db, input.ownerUid, input.workOrderId) })] : [];
}

export async function certificateActivityBlockReason(db: D1Database, input: {
  ownerUid: string; actorMemberId: string; assignedMemberId: string; activityTemplateId: string;
}) {
  const activityTemplateIds = certificateActivityIds([input.activityTemplateId]);
  if (!activityTemplateIds.length) return "";
  const result = await getCertificateActivityEligibility(db, { ...input, activityTemplateIds });
  return result.eligible ? "" : result.reasons.map((reason) => reason.message).join(" ");
}
