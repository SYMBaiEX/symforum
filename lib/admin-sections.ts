export const adminSectionIds = [
  "overview",
  "forum",
  "posts",
  "api",
  "comments",
  "interactions",
  "analytics",
  "users",
  "logs",
  "newsletter",
  "contact",
  "content",
  "ai",
  "telemetry",
] as const;

export type AdminSectionId = (typeof adminSectionIds)[number];

export const ownerOnlyAdminSections = new Set<AdminSectionId>([
  "api",
  "users",
  "ai",
  "telemetry",
]);

export function isAdminSectionId(value: string): value is AdminSectionId {
  return (adminSectionIds as readonly string[]).includes(value);
}

export function adminSectionHref(section: AdminSectionId) {
  return section === "overview" ? "/admin" : `/admin/${section}`;
}
