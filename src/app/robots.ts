import type { MetadataRoute } from "next";

const SITE_ORIGIN = "https://compare.ausenergyassessments.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/operations/", "/account", "/plan/print", "/compare/electricity-next", "/quote-review/", "/trade-photo/"],
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
