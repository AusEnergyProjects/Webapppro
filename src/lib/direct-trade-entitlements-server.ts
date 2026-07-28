import {
  resolveEntitlements,
  type FeatureKey,
  type PartnerType,
} from "./direct-trade-entitlements";
import { tradeAccountProjection } from "./trade-access-server";

export async function accountEntitlements(
  firebaseUid: string,
  partnerType: PartnerType,
) {
  const account = await tradeAccountProjection(firebaseUid);
  return resolveEntitlements(
    partnerType,
    Boolean(account?.approvedAbnAccess && account.partnerType === partnerType),
  );
}

export async function accountHasFeature(
  firebaseUid: string,
  partnerType: PartnerType,
  featureKey: FeatureKey,
) {
  const entitlements = await accountEntitlements(firebaseUid, partnerType);
  return entitlements.features[featureKey] === true;
}
