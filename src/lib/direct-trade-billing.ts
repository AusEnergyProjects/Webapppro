export type DirectTradePartnerType = "installer" | "supplier";
export type DirectTradeBillingCadence = "monthly" | "annual";

export const directTradePortalLink = "/api/direct-trade-billing?action=portal";

export function directTradeCheckoutUrl({
  partnerType,
  cadence,
  firebaseUid,
  email,
}: {
  partnerType: DirectTradePartnerType;
  cadence: DirectTradeBillingCadence;
  firebaseUid: string;
  email: string;
}) {
  const search = new URLSearchParams({
    action: "checkout",
    partnerType,
    cadence,
    uid: firebaseUid,
  });
  if (email) search.set("email", email);
  return `/api/direct-trade-billing?${search.toString()}`;
}
