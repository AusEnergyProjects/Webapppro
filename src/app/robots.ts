import type { MetadataRoute } from "next";

const SITE_ORIGIN = "https://compare.ausenergyassessments.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/operations/", "/plan/print", "/compare/electricity-next"],
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
