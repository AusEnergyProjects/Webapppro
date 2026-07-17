import { getD1 } from "../../db";
import {
  resolveEntitlements,
  type FeatureGrant,
  type FeatureKey,
  type PartnerType,
} from "./direct-trade-entitlements";

export async function accountEntitlements(
  firebaseUid: string,
  partnerType: PartnerType,
  billingStatus: unknown,
) {
  const db = getD1();
  const [grantResult, account] = await Promise.all([
    db.prepare(`SELECT feature_key, status, expires_at, note, updated_at
    FROM trade_account_feature_grants WHERE firebase_uid = ? AND status = 'active'`)
      .bind(firebaseUid).all<Record<string, unknown>>(),
    db.prepare("SELECT verification_status FROM trade_accounts WHERE firebase_uid = ?")
      .bind(firebaseUid).first<Record<string, unknown>>(),
  ]);
  const grants = grantResult.results.map((row: Record<string, unknown>) => ({
    featureKey: row.feature_key,
    status: row.status,
    expiresAt: row.expires_at,
    note: row.note,
    updatedAt: row.updated_at,
  })) as FeatureGrant[];
  return resolveEntitlements(
    partnerType,
    billingStatus,
    grants,
    account?.verification_status === "approved",
  );
}

export async function accountHasFeature(
  firebaseUid: string,
  partnerType: PartnerType,
  billingStatus: unknown,
  featureKey: FeatureKey,
) {
  const entitlements = await accountEntitlements(
    firebaseUid,
    partnerType,
    billingStatus,
  );
  return entitlements.features[featureKey] === true;
}
