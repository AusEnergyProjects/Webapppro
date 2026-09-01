import { RebatesHub } from "@/components/RebatesHub";
import { buildPlatformMetadata } from "@/lib/public-site";

export const metadata = buildPlatformMetadata({
  path: "/rebates",
  title: "Energy Rebates and Assistance | Australian Energy Assessments",
  description: "A location-aware starting point for Australian home energy rebates, certificates, discounts and assistance.",
});

export default function RebatesPage() {
  return <RebatesHub />;
}
