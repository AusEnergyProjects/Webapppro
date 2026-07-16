import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Australian Energy Assessments",
    short_name: "AEA Energy",
    description: "Private home energy planning, plan comparison and project preparation tools.",
    start_url: "/",
    display: "standalone",
    background_color: "#03192d",
    theme_color: "#03192d",
    icons: [
      { src: "/tlink-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/tlink-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
