// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import { buildDigestBody } from "../convex/belleForumAgent";
import { AgentPublicationQualityError } from "./agent-publication-quality";
import { reviseForumDraft } from "./forum-editorial-revision";

describe("bounded forum editorial revision", () => {
  test("rebuilds a dangling Belle digest and returns only the independently accepted replacement", async () => {
    const reviewer = vi.fn(async (body: string) => {
      if (body.includes("Invented benchmark"))
        throw new AgentPublicationQualityError(
          "Unsupported benchmark in original evidence.",
        );
      return body;
    });
    const rewrite = vi.fn(
      async (_draft: string, feedback: string, revision: number) => {
        expect(feedback).toBeTruthy();
        return revision === 1
          ? "Invented benchmark improved."
          : "The source describes a recovery checkpoint.";
      },
    );
    const accepted = await reviseForumDraft({
      initial: "A recovery checkpoint that",
      maxRevisions: 2,
      revise: rewrite,
      validate: async (summary) =>
        reviewer(
          buildDigestBody({
            date: "2026-10-07",
            opening:
              "Today's desk examines a source-supported recovery change.",
            closing: "",
            requestedBriefs: [{ hnItemId: 1, summary, analysis: "" }],
            stories: [{ hnItemId: 1, rank: 1, title: "Recovery checkpoint" }],
          }),
        ),
    });
    expect(accepted.revision).toBe(2);
    expect(accepted.value).toContain(
      "The source describes a recovery checkpoint.",
    );
    expect(accepted.value).not.toContain("Invented benchmark");
    expect(rewrite).toHaveBeenCalledTimes(2);
    expect(reviewer).toHaveBeenCalledTimes(2);
  });

  test("holds an unsupported draft after two full validation failures", async () => {
    const revise = vi.fn(async () => "Unsupported version 99.");
    const validate = vi.fn(async () => {
      throw new AgentPublicationQualityError(
        "Version 99 does not occur in the original source.",
      );
    });
    await expect(
      reviseForumDraft({
        initial: "Unsupported version 99.",
        maxRevisions: 2,
        revise,
        validate,
      }),
    ).rejects.toThrow("does not occur");
    expect(revise).toHaveBeenCalledTimes(2);
    expect(validate).toHaveBeenCalledTimes(3);
  });

  test("transport failures stop immediately without spending revision calls", async () => {
    const revise = vi.fn(async () => "replacement");
    const failure = new Error("Provider unavailable");
    await expect(
      reviseForumDraft({
        initial: "candidate",
        maxRevisions: 2,
        revise,
        validate: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(revise).not.toHaveBeenCalled();
  });
});
