"use client";

import { asRoute } from "@/lib/typed-route";

import { isForumHostname } from "@/components/forum/forum-host-url";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

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

      if (shouldPrefetchPrimaryRoutes(window.location.hostname)) {
        for (const href of warmRoutes) {
          router.prefetch(asRoute(href));
        }
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

export function shouldPrefetchPrimaryRoutes(hostname: string) {
  return !isForumHostname(hostname);
}
