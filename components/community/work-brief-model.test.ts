import { describe, expect, test } from "vitest";
import { communityHttpsUrl } from "../../lib/forum-community";
import { appendWorkBrief, deliveryUrlPreview } from "./work-brief-model";
describe("explicit editable work guidance", () => {
  test("actual kind values provide different editable guidance without replacing authored text", () => {
    for (const kind of ["bounty", "research"] as const) {
      const result = appendWorkBrief("Authored text\n保留", kind)!;
      expect(result.startsWith("Authored text\n保留\n\n")).toBe(true);
      expect(result).toContain("Requested deadline (UTC)");
      expect(result).toContain("Acceptance criteria");
      expect(result).toContain("Sources and evidence");
    }
    expect(appendWorkBrief("", "bounty")).toContain(
      "build, fix or contribution",
    );
    expect(appendWorkBrief("", "research")).toContain("Research question");
  });
  test("capacity never truncates existing work", () => {
    expect(appendWorkBrief("x".repeat(5000), "bounty")).toBeNull();
  });
});
describe("local delivery destination preview", () => {
  for (const value of ["", "   "])
    test(`missing input has no destination (${JSON.stringify(value)})`, () =>
      expect(deliveryUrlPreview(value)).toEqual({ state: "empty" }));
  for (const value of [
    "https://example.com/report?secret=not-displayed",
    "https://例え.テスト/deliverable",
    " https://EXAMPLE.com/path ",
    "https://example.com:443/path",
  ])
    test(`uses existing URL validation and actual normalized host (${value})`, () => {
      expect(deliveryUrlPreview(value)).toEqual({
        state: "valid",
        hostname: new URL(communityHttpsUrl(value)).hostname,
      });
    });
  for (const value of [
    "https://",
    "javascript:alert(1)",
    "http://example.com",
    "https://user:password@example.com",
    "https://localhost",
    "https://app.internal",
    "https://127.0.0.1",
    "https://[::1]",
    "https://example.com:8443",
    "https://example.com/" + "x".repeat(1000),
  ])
    test(`unsupported destination stays unavailable (${value.slice(0, 60)})`, () => {
      expect(() => communityHttpsUrl(value)).toThrow();
      expect(deliveryUrlPreview(value)).toEqual({ state: "invalid" });
    });
});
