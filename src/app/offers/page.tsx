import { AeaOffersPage } from "@/components/AeaServices";
import { AEA_BUNDLE_IDENTITIES } from "@/lib/aea-service-identity.mjs";
import { audPrice, gstInclusiveCents } from "@/lib/aea-services.mjs";
import { buildApexMetadata } from "@/lib/public-site";

const electricalTotal = audPrice(gstInclusiveCents(AEA_BUNDLE_IDENTITIES.electricalSafety.priceExGstCents));
const gasElectricalTotal = audPrice(gstInclusiveCents(AEA_BUNDLE_IDENTITIES.gasElectricalSafety.priceExGstCents));

export const metadata = buildApexMetadata({
  path: "/offers",
  title: "Two-Year Rental Safety Bundles Victoria | Australian Energy Assessments",
  description: `Two-year Victorian rental safety bundles: ${electricalTotal} incl. GST for smoke, blinds and electrical, or ${gasElectricalTotal} with gas. Clear visit counts, reports and FAQs.`,
});

export default AeaOffersPage;
