import { AeaServicesPage } from "@/components/AeaServices";
import { buildApexMetadata } from "@/lib/public-site";

export const metadata = buildApexMetadata({
  path: "/services",
  title: "Rental Safety & Energy Assessment Prices | Australian Energy Assessments",
  description: "Compare smoke and blind, gas, electrical, rental minimum standards, NatHERS and onsite energy assessments. Clear prices, inclusions, reports and two-year bundles.",
});

export default AeaServicesPage;
