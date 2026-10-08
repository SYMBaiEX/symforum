"use client";

import type { ReactNode } from "react";
import {
  CONVEX_QUERY_CACHE_EXPIRATION_MS,
  CONVEX_QUERY_CACHE_MAX_IDLE_ENTRIES,
} from "@symbaiex/auth/query-cache";

export {
  CONVEX_QUERY_CACHE_EXPIRATION_MS,
  CONVEX_QUERY_CACHE_MAX_IDLE_ENTRIES,
};

export function AuthKitConvexProvider({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}

export default AuthKitConvexProvider;
