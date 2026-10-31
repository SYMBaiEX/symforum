import { expect, test, vi } from "vitest";
import {
  communityHref,
  communityRoute,
  communityRouteFromRecord,
  communitySignInHref,
  COMMUNITY_SECTIONS,
} from "./community-navigation";
const mint = "11111111111111111111111111111111";
for (const section of COMMUNITY_SECTIONS)
  test(`allowlisted ${section} section roundtrips with exact mint`, () => {
    const route = communityRouteFromRecord({ section, mint });
    expect(route).toEqual({ section, mint, invalid: false });
    expect(
      communityRoute(new URLSearchParams(communityHref(route).split("?")[1])),
    ).toEqual(route);
  });
for (const params of [
  { section: ["work", "receipts"] },
  { mint: [mint, mint] },
  { section: "" },
  { section: "javascript:alert(1)" },
  { mint: "not-a-mint" },
  { invalid: "1" },
])
  test(`invalid or duplicate community intent is non-actionable ${JSON.stringify(params)}`, () => {
    expect(communityRouteFromRecord(params)).toEqual({
      section: "projects",
      invalid: true,
    });
    expect(
      communityHref(communityRouteFromRecord(params), "/forum/community"),
    ).toBe("/forum/community?invalid=1");
  });
test("sign-in return is a fixed first-party community route with validated intent", () => {
  const href = communitySignInHref(
    communityRouteFromRecord({
      section: "receipts",
      mint,
      redirectTo: "https://evil.example",
    }),
  );
  expect(
    new URL(href, "https://example.com").searchParams.get("redirectTo"),
  ).toBe(`/community?mint=${mint}&section=receipts`);
});
test("canonical redirect awaits params and preserves only allowlisted options", async () => {
  const redirect = vi.fn((href: string) => {
    throw new Error(href);
  });
  vi.doMock("next/navigation", () => ({ redirect }));
  const { default: page } = await import("../apps/platform/app/community/page");
  await expect(
    page({
      searchParams: Promise.resolve({
        section: "receipts",
        mint,
        redirectTo: "https://evil.example",
        unknown: "secret",
      }),
    }),
  ).rejects.toThrow(`/forum/community?mint=${mint}&section=receipts`);
  expect(redirect).toHaveBeenCalledOnce();
  await expect(
    page({
      searchParams: Promise.resolve({ section: ["receipts", "work"], mint }),
    }),
  ).rejects.toThrow("/forum/community?invalid=1");
  await expect(
    page({
      searchParams: Promise.resolve({
        section: "receipts",
        mint: [mint, mint],
      }),
    }),
  ).rejects.toThrow("/forum/community?invalid=1");
  vi.doUnmock("next/navigation");
});
