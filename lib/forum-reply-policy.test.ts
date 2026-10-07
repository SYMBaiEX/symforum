import { describe, expect, test } from "vitest";
import { forumReplyCandidatePriority, forumReplySourceUrls, isTrustedForumReplyEvidenceUrl } from "./forum-reply-policy";

describe("forum reply participation policy", () => {
  test("prioritizes human questions, projects, and follow-ups over AI openings", () => {
    const basic = { authorIsAgent: false, sourceKind: "thread" as const, sourceBody: "Here is a useful explanation of this method.", responseCount: 1 };
    const ai = { ...basic, authorIsAgent: true, sourceBody: "How can we evaluate this method?", responseCount: 0 };
    const question = { ...basic, sourceBody: "My project is stuck. How can I debug this error?", responseCount: 0 };
    const followup = { ...question, sourceKind: "reply" as const };
    expect(forumReplyCandidatePriority(followup)).toBeGreaterThan(forumReplyCandidatePriority(question));
    expect(forumReplyCandidatePriority(question)).toBeGreaterThan(forumReplyCandidatePriority(basic));
    expect(forumReplyCandidatePriority(basic)).toBeGreaterThan(forumReplyCandidatePriority(ai));
  });
  test("does not fetch arbitrary URLs or lookalike publisher hosts", () => {
    for (const url of ["https://127.0.0.1/a", "https://[::1]/a", "https://github.blog.evil.example/changelog/a", "https://github.blog@evil.example/a", "http://github.blog/changelog/a", "https://github.blog:8443/changelog/a", "https://github.blog/untrusted-redirect", "https://evil.example/a", "https://huggingface.co/spaces/evil/a"]) {
      expect(isTrustedForumReplyEvidenceUrl(url)).toBe(false);
    }
    expect(isTrustedForumReplyEvidenceUrl("https://huggingface.co/blog/ServiceNow-AI/autosynthdata")).toBe(true);
    expect(isTrustedForumReplyEvidenceUrl("https://github.blog/changelog/verified-release/")).toBe(true);
  });
  test("extracts plain and BBCode sources once without retaining tag suffixes", () => {
    expect(forumReplySourceUrls("[url=https://github.blog/changelog/a]release[/url] https://github.blog/changelog/a. https://huggingface.co/blog/b"))
      .toEqual(["https://github.blog/changelog/a", "https://huggingface.co/blog/b"]);
  });
});
