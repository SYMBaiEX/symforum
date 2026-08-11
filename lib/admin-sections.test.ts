import { describe, expect, test } from "vitest";

import {
  adminSectionHref,
  adminSectionIds,
  isAdminSectionId,
  ownerOnlyAdminSections,
} from "./admin-sections";

describe("admin section routing", () => {
  test("gives every admin tab a stable unique route", () => {
    const routes = adminSectionIds.map(adminSectionHref);

    expect(new Set(routes).size).toBe(adminSectionIds.length);
    expect(adminSectionHref("overview")).toBe("/admin");
    expect(adminSectionHref("telemetry")).toBe("/admin/telemetry");
    expect(adminSectionHref("ai")).toBe("/admin/ai");
    expect(adminSectionHref("api")).toBe("/admin/api");
  });

  test("validates route params and preserves owner-only boundaries", () => {
    expect(isAdminSectionId("telemetry")).toBe(true);
    expect(isAdminSectionId("metrics")).toBe(false);
    expect(ownerOnlyAdminSections).toEqual(
      new Set(["api", "users", "ai", "telemetry"]),
    );
  });
});
