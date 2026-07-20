import type { MetadataRoute } from "next";

const SITE_ORIGIN = "https://compare.ausenergyassessments.com";
const routes = [
  "",
  "/plan",
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
  "/rebates",
  "/assessments",
  "/case-studies",
  "/platform",
  "/privacy",
  "/direct-trade",
  "/direct-trade/partners",
  "/direct-trade/integrations",
  "/direct-trade/membership",
  "/direct-trade/membership/terms",
  "/direct-trade/standards",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-07-16T00:00:00.000Z");
  return routes.map((route) => ({
    url: `${SITE_ORIGIN}${route}`,
    lastModified,
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : route === "/plan" ? 0.9 : 0.7,
  }));
}
