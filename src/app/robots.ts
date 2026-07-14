import type { MetadataRoute } from "next";

const SITE_ORIGIN = "https://aea-energy-comparison.info294029.chatgpt.site";

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
