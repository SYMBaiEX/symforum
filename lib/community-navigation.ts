import { isSolanaAddress } from "./forum-commerce";

export const COMMUNITY_SECTIONS = [
  "projects",
  "work",
  "support",
  "receipts",
] as const;
export type CommunitySection = (typeof COMMUNITY_SECTIONS)[number];
export type CommunityRoute = {
  section: CommunitySection;
  mint?: string;
  invalid: boolean;
};
export function communityRoute(
  params: Pick<URLSearchParams, "getAll">,
): CommunityRoute {
  const sections = params.getAll("section"),
    mints = params.getAll("mint");
  if (
    sections.length > 1 ||
    mints.length > 1 ||
    params.getAll("invalid").length ||
    (sections.length === 1 &&
      !COMMUNITY_SECTIONS.includes(sections[0] as CommunitySection)) ||
    (mints.length === 1 && !isSolanaAddress(mints[0]))
  )
    return { section: "projects", invalid: true };
  return {
    section: (sections[0] ?? "projects") as CommunitySection,
    ...(mints[0] ? { mint: mints[0] } : {}),
    invalid: false,
  };
}
export function communityRouteFromRecord(
  params: Record<string, string | string[] | undefined>,
) {
  const query = new URLSearchParams();
  for (const key of ["section", "mint", "invalid"]) {
    const value = params[key];
    for (const item of value === undefined
      ? []
      : Array.isArray(value)
        ? value
        : [value])
      query.append(key, item);
  }
  return communityRoute(query);
}
export function communityHref(
  route: CommunityRoute,
  path:
    | "/community"
    | "/forum/community"
    | "/trade"
    | "/forum/trade" = "/community",
) {
  const query = new URLSearchParams();
  if (route.invalid) query.set("invalid", "1");
  else {
    if (route.mint) query.set("mint", route.mint);
    query.set("section", route.section);
  }
  return `${path}?${query}`;
}
export function communitySignInHref(route: CommunityRoute) {
  return `/signin?redirectTo=${encodeURIComponent(communityHref(route))}`;
}
