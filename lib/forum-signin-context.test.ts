import { expect, test } from "vitest";
import { safeIdentityReturnTo } from "./identity-config";
import { forumSignInHref } from "./forum-signin-context";

const destination = (path: string | null, search = "", hash = "") =>
  new URL(
    forumSignInHref(path, search, hash),
    "https://forum.example",
  ).searchParams.get("redirectTo");

test("retains local feed, search, exact mint, paging and anchor context", () => {
  const query =
    "view=feed&scope=following&authors=humans&sort=new&q=hello+world&mint=So11111111111111111111111111111111111111112&page=3&perPage=50&postPage=2&threadPage=4&replyPage=5&size=24&board=research&type=threads&target=title&author=Alice&days=7&section=work";
  const result = destination("/forum/search", query, "#post-21");
  expect(result).toBe(`/forum/search?${query}#post-21`);
  expect(safeIdentityReturnTo(result)).toBe(result);
  expect(destination("/", "view=community")).toBe("/?view=community");
});

test.each([
  "https://evil.test/path",
  "//evil.test",
  "/\\evil.test",
  "/%2f%2fevil.test",
  "/%5cevil.test",
  "/%252fevil.test",
  "/%00evil",
  "/%0aevil",
  "/%7fevil",
  "/forum/../signin",
  "/forum/%2e%2e/signin",
  "/forum?redirectTo=bad",
  "/signin",
  "/forum/login",
  "/api/identity/callback",
  "/%zz",
])("rejects unsafe or auth return paths: %s", (path) => {
  expect(destination(path)).toBe("/forum");
});

test("accepts ordinary encoded UTF-8 slugs used by member routes", () => {
  expect(destination("/forum/members/%E7%8C%AB", "page=2", "#post-1")).toBe(
    "/forum/members/%E7%8C%AB?page=2#post-1",
  );
});

test("preserves the full permitted 120-character forum query including Unicode", () => {
  const query = "猫".repeat(120);
  expect(
    new URL(
      destination(
        "/forum/search",
        new URLSearchParams({ q: query }).toString(),
      )!,
      "https://safe.invalid",
    ).searchParams.get("q"),
  ).toBe(query);
});

test("drops auth, secrets, unknown and duplicated context parameters", () => {
  expect(
    destination(
      "/forum",
      "view=feed&token=secret&access_token=secret&code=secret&state=secret&signature=secret&session=secret&redirectTo=//evil&returnTo=/bad&callbackURL=/bad&auth=secret&unknown=value&page=1&page=2",
    ),
  ).toBe("/forum?view=feed");
});

test("bounds context and rejects control characters and fragment credentials", () => {
  expect(
    destination(
      null,
      `q=${"x".repeat(257)}&sort=new&q2=ignored`,
      "#access_token=secret",
    ),
  ).toBe("/forum?sort=new");
  expect(
    destination("/forum", "q=hello%0Aworld&sort=new", "#//evil.test"),
  ).toBe("/forum?sort=new");
  expect(destination("/forum", "q=hello%5Cworld", "#post-2")).toBe(
    "/forum#post-2",
  );
});
