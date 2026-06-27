"use client";

import { useEffect } from "react";

const routeImages = [
  "/images/home-banner-dark.webp",
  "/images/home-banner-light.webp",
  "/images/about-symbiex-portrait-dark.webp",
  "/images/about-symbiex-portrait-light.webp",
];

export function RouteImagePreloader() {
  useEffect(() => {
    const preload = () => {
      for (const src of routeImages) {
        const image = new window.Image();
        image.decoding = "async";
        image.src = src;
      }
    };

    const idleCallback = window.requestIdleCallback?.(preload, {
      timeout: 1200,
    });
    if (idleCallback) {
      return () => window.cancelIdleCallback?.(idleCallback);
    }

    const timeout = window.setTimeout(preload, 500);
    return () => window.clearTimeout(timeout);
  }, []);

  return null;
}
