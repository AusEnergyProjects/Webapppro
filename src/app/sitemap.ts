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
];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `${PUBLIC_SITE.apexUrl}${route}`,
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : route === "/assessments" ? 0.95 : route === "/plan" ? 0.9 : 0.7,
  }));
}
