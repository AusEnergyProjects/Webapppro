import type { MetadataRoute } from "next";

const SITE_ORIGIN = "https://compare.ausenergyassessments.com";
// Pages that mirror established apex URLs stay out of this sitemap while they
// canonicalize to the apex during the parallel pre-cutover phase.
const routes = [
  "",
  "/plan",
  "/wattzun",
  "/calculator",
  "/compare",
  "/gas-compare",
  "/guides",
  "/guides/certificate-prices",
  "/guides/solar",
  "/guides/batteries",
  "/guides/heating",
  "/guides/hot-water",
  "/guides/cooking",
  "/guides/ev-charging",
  "/guides/insulation-draught-proofing",
  "/guides/project-preparation",
  "/rebates",
  "/assessments",
  "/home-energy-rating-vs-nathers-vs-scorecard",
  "/case-studies",
  "/platform",
  "/privacy",
  "/direct-trade",
  "/direct-trade/partners",
  "/direct-trade/integrations",
  "/direct-trade/access",
  "/direct-trade/standards",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `${SITE_ORIGIN}${route}`,
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : route === "/assessments" ? 0.95 : route === "/plan" ? 0.9 : 0.7,
  }));
}
