import { describe, expect, test } from "vitest";

import {
  extractForumMentionUsernames,
  isForumUsername,
  splitForumMentions,
} from "./forum-mentions";

describe("forum mentions", () => {
  test("splits standalone handles while preserving surrounding text", () => {
    expect(splitForumMentions("Ask @SYM-42, then @austin_dev.")).toEqual([
      { kind: "text", value: "Ask " },
      { kind: "mention", value: "@SYM-42", username: "sym-42" },
      { kind: "text", value: ", then " },
      {
        kind: "mention",
        value: "@austin_dev",
        username: "austin_dev",
      },
      { kind: "text", value: "." },
    ]);
  });

  test("does not turn email-like or embedded tokens into mentions", () => {
    expect(
      extractForumMentionUsernames(
        "mail @example.com, foo@austin.dev, @@othertrusted, then @real_user",
      ),
    ).toEqual(["real_user"]);
  });

  test("deduplicates mentions and excludes quoted or coded handles", () => {
    expect(
      extractForumMentionUsernames(
        "@member @MEMBER [quote]@quoted[/quote] [code]@coded[/code] @second",
      ),
    ).toEqual(["member", "second"]);
  });

  test("recognizes the same username shapes accepted by forum auth", () => {
    expect(isForumUsername("sym-123")).toBe(true);
    expect(isForumUsername("austin_dev")).toBe(true);
    expect(isForumUsername("ab")).toBe(false);
    expect(isForumUsername("name.with.dot")).toBe(false);
  });
});
