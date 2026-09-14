import { AeaServiceLandingPage } from "@/components/AeaServices";
import { getAeaService, audPrice, gstInclusiveCents } from "@/lib/aea-services.mjs";
import { buildApexMetadata } from "@/lib/public-site";
const service = getAeaService("gas-safety-check")!;
const price = audPrice(gstInclusiveCents(service.priceExGstCents));
export const metadata = buildApexMetadata({ path: "/services/gas-safety-check", title: service.title + " | Australian Energy Assessments", description: `${price} incl. GST rental gas safety checks in Victoria. Qualified gasfitter, no additional appliance charge, written findings and a downloadable report.` });
export default function Page() { return <AeaServiceLandingPage serviceId="gas-safety-check" />; }
