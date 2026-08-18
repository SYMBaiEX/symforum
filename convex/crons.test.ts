/// <reference types="vite/client" />

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("evidence retention cron", () => {
  test("schedules bounded claim revision cleanup", () => {
    const source = readFileSync(new URL("./crons.ts", import.meta.url), "utf8");
    expect(source).toContain('"cleanup expired claim revisions"');
    expect(source).toContain("internal.evidence.cleanupExpiredClaimRevisions");
    expect(source).toContain("{ limit: 100 }");
  });

  test("schedules Web Vitals retention cleanup without a public operator route", () => {
    const source = readFileSync(new URL("./crons.ts", import.meta.url), "utf8");
    expect(source).toContain('"cleanup expired Web Vitals"');
    expect(source).toContain('"webVitals:cleanupExpired"');
  });
});
