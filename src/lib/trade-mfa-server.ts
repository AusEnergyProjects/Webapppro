import { getD1 } from "../../db";
import { requireSecondFactor } from "./firebase-mfa";
import type { FirebaseIdentity } from "./firebase-server";
import { writeMyobSecurityEvent } from "./myob-security-audit";

// Keep protecting copied invoice balances after a MYOB connection is removed.
export const MYOB_MFA_REQUIRED_SQL = `SELECT 1 AS required WHERE
  EXISTS (SELECT 1 FROM trade_crm_integrations WHERE firebase_uid = ? AND provider = 'myob')
  OR EXISTS (SELECT 1 FROM trade_crm_accounting_documents WHERE firebase_uid = ? AND provider = 'myob')`;

export async function requireTradeMyobSecondFactor(identity: FirebaseIdentity | undefined, ownerUid: string, actorUid = identity?.uid || "field-session") {
  if (identity?.secondFactor === "totp" || identity?.secondFactor === "phone") return;
  const db = getD1();
  const required = await db.prepare(MYOB_MFA_REQUIRED_SQL).bind(ownerUid, ownerUid).first();
  if (required) {
    await writeMyobSecurityEvent(db, { actorUid, ownerUid, action: "access.denied", resourceId: "trade-workspace", outcome: "denied" });
    requireSecondFactor(identity);
  }
}
