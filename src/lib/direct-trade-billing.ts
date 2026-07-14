export type DirectTradePartnerType = "installer" | "supplier";
export type DirectTradeBillingCadence = "monthly" | "annual";

export const directTradePaymentLinks: Record<
  DirectTradePartnerType,
  Record<DirectTradeBillingCadence, string>
> = {
  installer: {
    monthly: "https://buy.stripe.com/4gMfZg2LBeNkc3hgyvf3a04",
    annual: "https://buy.stripe.com/dRm14mdqfcFc3wL6XVf3a05",
  },
  supplier: {
    monthly: "https://buy.stripe.com/5kQbJ0gCr5cK4AP3LJf3a06",
    annual: "https://buy.stripe.com/8x29AS5XNax43wLgyvf3a07",
  },
};

export const directTradePortalLink =
  "https://billing.stripe.com/p/login/8x2eVcgCr34C9V93LJf3a00";

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
  const checkout = new URL(directTradePaymentLinks[partnerType][cadence]);
  checkout.searchParams.set("client_reference_id", firebaseUid);
  if (email) checkout.searchParams.set("prefilled_email", email);
  return checkout.toString();
}

