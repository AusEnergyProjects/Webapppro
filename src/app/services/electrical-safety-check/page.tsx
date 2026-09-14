import { AeaServiceLandingPage } from "@/components/AeaServices";
import { getAeaService, audPrice, gstInclusiveCents } from "@/lib/aea-services.mjs";
import { buildApexMetadata } from "@/lib/public-site";
const service = getAeaService("electrical-safety-check")!;
const price = audPrice(gstInclusiveCents(service.priceExGstCents));
export const metadata = buildApexMetadata({ path: "/services/electrical-safety-check", title: service.title + " | Australian Energy Assessments", description: `${price} incl. GST rental electrical safety checks in Victoria. Licensed inspection and testing, clear defect records and a downloadable report.` });
export default function Page() { return <AeaServiceLandingPage serviceId="electrical-safety-check" />; }
