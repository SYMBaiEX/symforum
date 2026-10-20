import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SYMBaiEX",
    short_name: "SYMBaiEX",
    description:
      "A high-contrast personal publication for software engineering, AI systems, and daily research notes.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#050505",
    theme_color: "#050505",
    lang: "en",
    icons: [
      {
        src: "/images/brand/symforum-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/images/brand/symforum-icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
