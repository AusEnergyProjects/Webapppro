import type { MetadataRoute } from "next";
import { PUBLIC_SITE } from "@/lib/public-site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/operations/", "/account", "/plan/print", "/compare/electricity-next", "/quote-review/", "/trade-photo/"],
    },
    sitemap: `${PUBLIC_SITE.apexUrl}/sitemap.xml`,
  };
}
