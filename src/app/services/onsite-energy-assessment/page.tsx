import { AeaServiceLandingPage } from "@/components/AeaServices";
import { getAeaService, audPrice, gstInclusiveCents } from "@/lib/aea-services.mjs";
import { buildApexMetadata } from "@/lib/public-site";
const service = getAeaService("onsite-energy-assessment")!;
const price = audPrice(gstInclusiveCents(service.priceExGstCents));
export const metadata = buildApexMetadata({ path: "/services/onsite-energy-assessment", title: service.title + " | Australian Energy Assessments", description: `${price} incl. GST onsite energy assessments in NSW and Victoria. Understand comfort, energy use and upgrade priorities, with practical advice and no rating certificate.` });
export default function Page() { return <AeaServiceLandingPage serviceId="onsite-energy-assessment" />; }
