import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TLink by Australian Energy Assessments",
    short_name: "TLink",
    description: "The TLink trade workspace for approved installers and suppliers.",
    start_url: "/direct-trade/dashboard",
    scope: "/direct-trade/",
    display: "standalone",
    background_color: "#03192d",
    theme_color: "#03192d",
    icons: [
      { src: "/tlink-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/tlink-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
