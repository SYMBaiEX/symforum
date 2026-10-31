import { expect, test } from "vitest";
import { tokenDiscussionLink } from "./token-discussion-link";
import { forumSiteUrl } from "../../lib/site-urls";

test("existing prefixed and standalone discussion paths share one canonical website URL", () => {
  expect(tokenDiscussionLink("/forum/crypto/recorded-discussion#post-2")).toBe(
    forumSiteUrl("/crypto/recorded-discussion#post-2"),
  );
  expect(tokenDiscussionLink("/crypto/recorded-discussion#post-2")).toBe(
    forumSiteUrl("/crypto/recorded-discussion#post-2"),
  );
});
test("sharing never resolves absent, external or host-escaping paths", () => {
  for (const path of [
    null,
    "",
    "https://untrusted.example/thread",
    "//untrusted.example/thread",
    "/\\untrusted.example/thread",
    "/forum/\\evil",
    "/forum/\n/evil",
    "/forum/ /evil",
  ])
    expect(tokenDiscussionLink(path)).toBeNull();
});
