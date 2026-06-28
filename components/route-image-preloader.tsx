"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const routeImages = [
  "/images/home-banner-dark.webp",
  "/images/home-banner-light.webp",
  "/images/pets/signal-moth.webp",
  "/images/about-symbiex-portrait-dark.webp",
  "/images/about-symbiex-portrait-light.webp",
];

const warmRoutes = [
  "/",
  "/about",
  "/blog",
  "/news",
  "/portfolio",
  "/contact",
  "/profile",
  "/signin",
];

export function RouteImagePreloader() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const preload = () => {
      if (cancelled) {
        return;
      }

      for (const src of routeImages) {
        const image = new window.Image();
        image.decoding = "async";
        image.src = src;
      }

      for (const href of warmRoutes) {
        router.prefetch(href);
      }
    };

    const idleCallback = window.requestIdleCallback?.(preload, {
      timeout: 1200,
    });
    if (idleCallback) {
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(idleCallback);
      };
    }

    const timeout = window.setTimeout(preload, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [router]);

  return null;
}
