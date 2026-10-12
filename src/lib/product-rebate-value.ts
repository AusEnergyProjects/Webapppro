import type { CertificatePriceDataset } from "./certificate-prices.ts";
import { certificateQuoteEstimate } from "./certificate-quote-estimate.ts";
import type { ProductCertificateValue } from "./product-rebate-check.ts";

const SOURCE_URL = "https://www.demandmanager.com.au/certificate-prices/";
const unavailable = (note: string): ProductCertificateValue => ({
  status: "unavailable", grossValueCents: null, unitPriceCents: null,
  tradedOn: null, checkedAt: null, sourceUrl: SOURCE_URL,
  estimatedValueCents: null, registrationFeeCents: null, allowancePercent: null,
  allowanceCents: null, feeSourceUrl: null, feeCheckedOn: null, estimateAsOf: null, note,
});

/** A dated market example; never substitutes a provider's customer discount. */
export function productCertificateValue(dataset: CertificatePriceDataset | null, code: "STC" | "VEEC", quantity: number, activityCode: string, now: Date): ProductCertificateValue {
  if (!dataset) return unavailable("Certificate counts are available, but a market value could not be confirmed.");
  const latest = dataset.certificates.find(series => series.code === code)?.latest;
  if (!latest || !Number.isSafeInteger(quantity) || quantity < 0 || !Number.isSafeInteger(latest.priceCents) || latest.priceCents <= 0
      || !/^\d{4}-\d{2}-\d{2}$/.test(latest.tradedOn) || !Number.isFinite(Date.parse(latest.tradedOn))
      || new Date(latest.tradedOn).toISOString().slice(0, 10) !== latest.tradedOn
      || !Number.isFinite(Date.parse(dataset.source.lastCheckedAt)) || !Number.isFinite(Date.parse(dataset.asOf))
      || Date.parse(latest.tradedOn) > now.getTime() || Date.parse(dataset.source.lastCheckedAt) > now.getTime() || Date.parse(dataset.asOf) > now.getTime()) {
    return unavailable("The dated certificate market reference is missing or invalid. No dollar value has been assumed.");
  }
  const grossValueCents = quantity * latest.priceCents;
  if (!Number.isSafeInteger(grossValueCents)) return unavailable("The certificate market value is outside the supported range.");
  const asOf = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const estimate = dataset.source.status === "current"
    ? certificateQuoteEstimate({ code, activityCode, certificateCount: quantity, grossValueCents, asOf }) : null;
  const net = estimate?.status === "estimated" ? estimate : null;
  return {
    status: dataset.source.status, grossValueCents, unitPriceCents: latest.priceCents,
    tradedOn: latest.tradedOn, checkedAt: dataset.source.lastCheckedAt, sourceUrl: SOURCE_URL,
    estimatedValueCents: net?.estimatedValueCents ?? null,
    registrationFeeCents: net?.registrationFeeCents ?? null,
    allowancePercent: net?.allowancePercent ?? null, allowanceCents: net?.allowanceCents ?? null,
    feeSourceUrl: net ? code === "STC" ? "https://cer.gov.au/document/renewable-energy-target-cost-recovery-implementation-statement-fy2024-25" : net.registrationFee.officialUrl : null,
    feeCheckedOn: net?.registrationFee.checkedOn ?? null,
    estimateAsOf: net?.asOf ?? null,
    note: dataset.source.status === "stale"
      ? "This is an older reported market reference. A current value after fees is not confirmed."
      : net ? `The estimate subtracts the published registration fee and an assumed 10% compliance and provider allowance. Actual provider fees and your discount may differ. GST on fees has not been calculated.${code === "STC" ? " The STC fee example assumes the provider's account exceeds 250 certificates; no individual-job exemption is assumed." : ""}`
        : "Gross market reference only. Registration fees and a current value after fees could not be confirmed.",
  };
}
