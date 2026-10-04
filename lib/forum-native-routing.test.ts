import { describe, expect, test } from "vitest";
import {
  compareForumRoutePatterns,
  matchForumRoute,
} from "./forum-native-routing";
import { FORUM_NATIVE_ROUTES } from "./forum-native-app.generated";
describe("native forum route specificity", () => {
  test.each([
    ["/forum/members/suki", "/forum/members/[username]"],
    ["/forum/announcements/welcome", "/forum/announcements/[slug]"],
    ["/forum/help/posting-guide", "/forum/help/[slug]"],
    ["/forum/stories/41", "/forum/stories/[hnItemId]"],
    ["/forum/control-panel/agent-access", "/forum/control-panel/agent-access"],
    ["/forum/general/discussion", "/forum/[categorySlug]/[threadSlug]"],
  ])("resolves %s to %s", (path, expected) => {
    expect(matchForumRoute(FORUM_NATIVE_ROUTES, path)?.route.path).toBe(
      expected,
    );
  });
  test("handles encoded params, catch-all routes and optional catch-alls", () => {
    expect(
      matchForumRoute([{ path: "/forum/[...parts]" }], "/forum/one/two%20words")
        ?.params,
    ).toEqual({ parts: ["one", "two words"] });
    expect(
      matchForumRoute([{ path: "/forum/[[...parts]]" }], "/forum")?.params,
    ).toEqual({ parts: [] });
    expect(
      matchForumRoute([{ path: "/forum/[...parts]" }], "/forum"),
    ).toBeNull();
  });
  test("keeps static segments more specific than board catch-all parameters", () => {
    expect(
      compareForumRoutePatterns(
        { path: "/forum/members/[username]" },
        { path: "/forum/[categorySlug]/[threadSlug]" },
      ),
    ).toBeLessThan(0);
  });
});
