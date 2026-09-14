import { AeaServiceLandingPage } from "@/components/AeaServices";
import { getAeaService, audPrice, gstInclusiveCents } from "@/lib/aea-services.mjs";
import { buildApexMetadata } from "@/lib/public-site";
const service = getAeaService("smoke-alarm-blind-safety")!;
const price = audPrice(gstInclusiveCents(service.priceExGstCents));
export const metadata = buildApexMetadata({ path: "/services/smoke-alarm-blind-safety", title: service.title + " | Australian Energy Assessments", description: `${price} incl. GST annual smoke alarm and blind safety checks in Victoria. Batteries, standard replacement alarms, cord anchors, labels and fault callouts included.` });
export default function Page() { return <AeaServiceLandingPage serviceId="smoke-alarm-blind-safety" />; }
