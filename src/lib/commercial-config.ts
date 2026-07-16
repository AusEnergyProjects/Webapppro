import { env } from "cloudflare:workers";

type CommercialEnvironment = {
  STRIPE_INSTALLER_MONTHLY_URL?: string;
  STRIPE_INSTALLER_ANNUAL_URL?: string;
  STRIPE_SUPPLIER_MONTHLY_URL?: string;
  STRIPE_SUPPLIER_ANNUAL_URL?: string;
  STRIPE_BILLING_PORTAL_URL?: string;
  STRIPE_INSTALLER_MONTHLY_PAYMENT_LINK_ID?: string;
  STRIPE_INSTALLER_ANNUAL_PAYMENT_LINK_ID?: string;
  STRIPE_SUPPLIER_MONTHLY_PAYMENT_LINK_ID?: string;
  STRIPE_SUPPLIER_ANNUAL_PAYMENT_LINK_ID?: string;
};

function values() {
  return env as unknown as CommercialEnvironment;
}

function stripeUrl(name: keyof CommercialEnvironment) {
  const raw = String(values()[name] || "").trim();
  if (!raw) throw new Error(`Missing commercial setting: ${name}`);
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("stripe.com")) {
    throw new Error(`Invalid commercial setting: ${name}`);
  }
  return parsed;
}

export function stripeCheckoutBase(partnerType: "installer" | "supplier", cadence: "monthly" | "annual") {
  const key = `STRIPE_${partnerType.toUpperCase()}_${cadence.toUpperCase()}_URL` as keyof CommercialEnvironment;
  return stripeUrl(key);
}

export function stripeBillingPortalUrl() {
  return stripeUrl("STRIPE_BILLING_PORTAL_URL");
}

export function stripeMembershipPlanByPaymentLink() {
  const configuration: Array<[keyof CommercialEnvironment, string, "installer" | "supplier"]> = [
    ["STRIPE_INSTALLER_MONTHLY_PAYMENT_LINK_ID", "installer_monthly", "installer"],
    ["STRIPE_INSTALLER_ANNUAL_PAYMENT_LINK_ID", "installer_annual", "installer"],
    ["STRIPE_SUPPLIER_MONTHLY_PAYMENT_LINK_ID", "supplier_monthly", "supplier"],
    ["STRIPE_SUPPLIER_ANNUAL_PAYMENT_LINK_ID", "supplier_annual", "supplier"],
  ];
  return Object.fromEntries(configuration.flatMap(([key, planKey, partnerType]) => {
    const paymentLinkId = String(values()[key] || "").trim();
    return paymentLinkId ? [[paymentLinkId, { planKey, partnerType }]] : [];
  })) as Record<string, { planKey: string; partnerType: "installer" | "supplier" }>;
}
