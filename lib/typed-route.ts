import type { Route } from "next";

/** Narrow a validated application path to Next's generated route type. */
export function asRoute(href: string): Route {
  return href as Route;
}
