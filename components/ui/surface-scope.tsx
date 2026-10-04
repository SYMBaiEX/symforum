"use client";

import { createContext, useContext } from "react";

/** Carries surface styling into portaled controls without changing other sites. */
export const SurfaceScope = createContext<"default" | "forum">("default");
export const useSurfaceScope = () => useContext(SurfaceScope);
