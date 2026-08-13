import { primarySiteUrl } from "@/lib/site-urls";
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SYMBaiEX",
    short_name: "SYMBaiEX",
    description:
      "A high-contrast personal publication for software engineering, AI systems, and daily research notes.",
    start_url: primarySiteUrl("/"),
    scope: "/",
    display: "standalone",
    background_color: "#050505",
    theme_color: "#050505",
    lang: "en",
    icons: [
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
