import type { MetadataRoute } from "next";
import { PUBLIC_SITE } from "@/lib/public-site";

// This is the canonical post-cutover inventory. The candidate host deliberately
// emits apex URLs so the same sitemap can be submitted without changing every
// entry during the DNS move.
const routes = [
  "",
  "/assessments",
  "/basix-nsw",
  "/book-an-assessment",
  "/blower-door-thermal-imaging",
  "/commercial-and-industrial-assessments",
  "/communities-schools",
  "/faq",
  "/home-energy-rating-for-existing-homes",
  "/minimum-rental-standards",
  "/nathers-for-new-homes",
  "/nathers-whole-of-home",
  "/plan",
  "/wattzun",
  "/calculator",
  "/compare",
  "/gas-compare",
  "/wholesale-electricity",
  "/guides",
  "/guides/certificate-prices",
  "/guides/home-energy-upgrades",
  "/guides/prepare-for-home-energy-assessment",
  "/guides/free-home-energy-assessments",
  "/guides/home-energy-assessment-myths",
  "/guides/ncc-nathers-basix",
  "/guides/green-building-certifications-australia",
  "/guides/solar",
  "/guides/batteries",
  "/guides/heating",
  "/guides/heat-pumps",
  "/guides/hot-water",
  "/guides/cooking",
  "/guides/ev-charging",
  "/guides/insulation-draught-proofing",
  "/guides/project-preparation",
  "/rebates",
  "/rental-assessment/request",
  "/home-energy-rating-vs-nathers-vs-scorecard",
  "/residential-efficiency-scorecard",
  "/case-studies",
  "/platform",
  "/privacy",
  "/team",
  "/trusted-suppliers",
  "/direct-trade",
  "/direct-trade/partners",
  "/direct-trade/integrations",
  "/direct-trade/access",
  "/direct-trade/standards",
] as const;

const lastModifiedByRoute = new Map<(typeof routes)[number], string>([
  ["", "2026-09-03"],
  ["/wholesale-electricity", "2026-09-04"],
  ["/assessments", "2026-09-04"],
  ["/book-an-assessment", "2026-09-03"],
  ["/blower-door-thermal-imaging", "2026-09-04"],
  ["/guides/home-energy-upgrades", "2026-09-04"],
  ["/home-energy-rating-for-existing-homes", "2026-09-03"],
  ["/nathers-for-new-homes", "2026-09-03"],
  ["/guides/prepare-for-home-energy-assessment", "2026-09-03"],
  ["/guides/free-home-energy-assessments", "2026-09-03"],
  ["/guides/ncc-nathers-basix", "2026-09-03"],
]);

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => {
    const lastModified = lastModifiedByRoute.get(route);
    return {
      url: new URL(route || "/", `${PUBLIC_SITE.apexUrl}/`).toString(),
      ...(lastModified ? { lastModified } : {}),
    };
  });
}
