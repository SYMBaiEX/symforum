import { describe, expect, test } from "vitest";
import {
  assessForumContentFit,
  assessForumStructuredValue,
  validateForumContentCompleteness,
} from "./forum-content-quality";

const codes = (body: string) =>
  validateForumContentCompleteness(body).issues.map((issue) => issue.code);

describe("forum publication completeness", () => {
  test("rejects the audited empty LiquidAI sections and empty callouts", () => {
    const result = validateForumContentCompleteness(`[h2]Action plan[/h2]
[h2]Likely failure modes[/h2]
[h2]Sources[/h2]
[url=https://example.com/release]Original release[/url]
[note]  [/note]`);
    expect(
      result.issues.filter((issue) => issue.code === "empty_section"),
    ).toHaveLength(2);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "empty_callout" }),
    );
  });

  test("rejects a font guide that ends with a bare fifth step", () => {
    expect(
      codes(
        "1. Reproduce with the selected font.\n2. Save the crash log.\n3. Try the default font.\n4. Recheck the original save.\n5.",
      ),
    ).toContain("bare_step");
    expect(codes("Step 5:")).toContain("bare_step");
  });

  test("finds explicit adjacent prerequisite and verifier count mismatches", () => {
    expect(
      codes(
        "Check three verifier properties:\n[list]\n[*]Soundness\n[*]Completeness\n[/list]",
      ),
    ).toContain("declared_count_mismatch");
    expect(
      codes(
        "You need two prerequisites:\n- Install the SDK\n- Set the token\n- Enable the feature",
      ),
    ).toContain("declared_count_mismatch");
    expect(
      validateForumContentCompleteness(
        "Check three verifier properties:\n[list][*]Soundness[*]Completeness[*]Consistency[/list]",
      ).valid,
    ).toBe(true);
  });

  test("counts blank-line-separated and nested lists without false mismatches", () => {
    for (const body of [
      "Check three properties:\n[list][*]Soundness\n\n[*]Completeness\n\n[*]Consistency[/list]",
      "Check two properties:\n[list][*]Soundness[list][*]Reject wrong results[*]Accept correct results[/list][*]Completeness[/list]",
      "Follow two steps:\n1. Install the SDK\n\n2. Run the test\n\nThe outcome is ready to inspect.",
      "[h2][sau412][/h2]\nThe member's post is worth reading.",
    ])
      expect(validateForumContentCompleteness(body).valid, body).toBe(true);
  });

  test("rejects references to missing artifacts and unfinished transitions", () => {
    expect(codes("The comparison table below shows the tradeoff.")).toContain(
      "missing_promised_content",
    );
    expect(
      codes("Run the following command to reproduce the failure."),
    ).toContain("missing_promised_content");
    expect(codes("The fallback:")).toContain("unfinished_transition");
    expect(codes("These two goals are the reason to use canvases.")).toContain(
      "unresolved_pointer",
    );
  });

  test("accepts compact discussion, code, citations, nested headings, and actual artifacts", () => {
    for (const body of [
      "I spotted this in the SDK release notes. Has anyone tried it with their own workflow?",
      "[h2]Setup[/h2]\n[h3]Prerequisites[/h3]\nInstall the SDK.\n[h3]Run[/h3]\n[code]5.\n[note][/note]\narr[3] = 2;[/code]",
      "[h2]Screenshot[/h2]\n[img]https://example.com/error.png[/img]",
      "[sau412] writes about a 3.2 release. The error happens after 5 seconds.",
      "The table below compares these options.\n[decision]A|Test|Keep the current build\nB|Wait|Reproduce the failure first[/decision]",
      "Run the following command: `bun test`",
      "The source tested three target models. It reports two failures. [1]",
      "The first prerequisite is a token. This is one observation, not a numbered list.",
      "I need two things: time and a compiler.",
      "See the table in the linked paper for its reported measurements.",
      "The source table shows the measured values. This is their result, not a table reproduced here.",
    ])
      expect(validateForumContentCompleteness(body).valid, body).toBe(true);
  });
});

describe("structured value screen", () => {
  test("does not certify a body-repeat Signal table as added information", () => {
    const body = `Checkpoint recovery resumes interrupted jobs. Audit logging records permission changes.
[table][tr][th]Signal[/th][th]Meaning[/th][/tr]
[tr][td]Signal 1[/td][td]Checkpoint recovery resumes interrupted jobs.[/td][/tr]
[tr][td]Signal 2[/td][td]Audit logging records permission changes.[/td][/tr][/table]`;
    expect(assessForumStructuredValue(body)).toMatchObject({
      blockCount: 1,
      repeatedRowCount: 2,
      informativeRowCount: 0,
      addsInformation: false,
    });
  });

  test("allows meaningful row labels and distinct comparison data", () => {
    expect(
      assessForumStructuredValue(`A rollout needs a test plan.
[table][tr][th]Signal[/th][th]Check[/th][/tr]
[tr][td]Signal 1[/td][td]Compare p95 tail latency before rollout.[/td][/tr]
[tr][td]Permission log[/td][td]Review all role changes in the staging audit trail.[/td][/tr][/table]`),
    ).toMatchObject({
      repeatedRowCount: 0,
      informativeRowCount: 2,
      addsInformation: true,
    });
    expect(
      assessForumStructuredValue("A plain discovery is fine.").addsInformation,
    ).toBe(false);
  });
});

describe("bounded source and board fit", () => {
  const music = {
    title: "Recording the Rolling Stones album",
    text: "The band recorded vocals, guitar, and mixing sessions with the producer.",
    url: "https://music.example/interview",
  };
  test("flags PR-metrics evidence sourced only from a music recording article", () => {
    expect(
      assessForumContentFit({
        title:
          "PR Review Timing: Baseline the New Stage Metric Before You Trust It",
        board: { slug: "ai", name: "AI" },
        sources: [music],
      }),
    ).toMatchObject({ sourceFit: "mismatch", lexicalOnly: true });
  });
  test("flags the Todd Edwards music interview in Gaming Guides", () => {
    const result = assessForumContentFit({
      title: "What Todd Edwards' career reveals about creative access",
      body: "The producer describes his music career and remix work.",
      board: { slug: "gaming-guides", name: "Gaming Guides" },
      sources: [
        {
          title: "Todd Edwards producer interview",
          text: "His music, remix work and album collaborations.",
        },
      ],
    });
    expect(result).toMatchObject({
      sourceFit: "aligned",
      boardFit: "mismatch",
    });
  });
  test("allows software for games, music production tools, and mixed news digests", () => {
    const inputs = [
      {
        title: "A Proton software SDK for Steam games",
        board: { slug: "gaming-guides", name: "Gaming Guides" },
        sources: [
          {
            title: "Proton SDK release",
            text: "This SDK supports Steam games.",
          },
        ],
      },
      {
        title: "Resolume music software adds local vision models",
        board: { slug: "music-production", name: "Music Production" },
        sources: [
          {
            title: "Resolume software release",
            text: "Music tools gain local model inference in the software.",
          },
        ],
      },
      {
        title: "Today's news desk",
        board: { slug: "news", name: "News" },
        sources: [
          music,
          {
            title: "GitHub Copilot metrics",
            text: "Software pull request metrics.",
          },
        ],
      },
    ];
    for (const input of inputs)
      expect(assessForumContentFit(input).issues, input.title).toEqual([]);
  });
  test("returns uncertainty for insufficient evidence instead of inventing accuracy", () => {
    const result = assessForumContentFit({
      title: "Is this worth trying?",
      board: { slug: "research-experiments", name: "Experiments" },
      sources: [{ title: "A new approach", text: "Short abstract." }],
    });
    expect(result).toMatchObject({
      sourceFit: "uncertain",
      boardFit: "uncertain",
      issues: [],
      lexicalOnly: true,
    });
    expect(
      assessForumContentFit({
        title: "What are you building?",
        board: { slug: "general", name: "General" },
        sources: [],
      }),
    ).toMatchObject({
      sourceFit: "not_applicable",
      boardFit: "not_applicable",
    });
  });
});
