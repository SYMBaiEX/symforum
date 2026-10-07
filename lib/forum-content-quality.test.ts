import { describe, expect, test } from "vitest";
import {
  assessForumContentFit,
  assessForumReadability,
  assessForumStructuredValue,
  validateForumContentCompleteness,
} from "./forum-content-quality";

const codes = (body: string) =>
  validateForumContentCompleteness(body).issues.map((issue) => issue.code);

describe("forum prose readability", () => {
  const releaseParagraphs = [
    "The Orion model release reports higher scores on several coding and reasoning benchmarks, with a smaller gap on instruction following and mixed results on multilingual tasks. The published table lists performance across different sizes, but the headline figures come from a particular prompting setup and do not establish what happens in a production workflow. Some comparisons use different inference budgets, so the ranking alone does not tell us which model is the better choice for a constrained deployment.",
    "For someone already running a local assistant, the useful next step is a small evaluation with representative requests. Keep the current model as the baseline, include a few failures you have actually seen, and record response quality alongside latency and memory use. Check whether the improvement survives your own system prompt and whether the model still follows the tool contract when a request is ambiguous. A benchmark lead would be less useful if routine calls become less reliable.",
    "I would treat this release as a candidate for testing rather than an automatic upgrade. The source provides reported results, but it leaves enough deployment questions open that a short comparison on real tasks could change the decision. The immediate takeaway is to test the claimed gain where it matters to you before spending time migrating the rest of your setup.",
  ];
  const words = (count: number) => Array.from({ length: count }, () => "word").join(" ");

  test("holds a dense model-release wall and accepts the same substance grouped naturally", () => {
    const dense = assessForumReadability(releaseParagraphs.join(" "));
    expect(dense).toMatchObject({ valid: false, formattingOnly: true, paragraphCount: 1 });
    expect(dense.maxParagraphWords).toBeGreaterThan(200);
    expect(dense.issues).toEqual([
      expect.objectContaining({ code: "long_prose_paragraph", paragraph: 1, blocking: true }),
    ]);
    expect(dense.feedback[0]).toContain("natural change of thought");
    expect(assessForumReadability(releaseParagraphs.join("\n\n"))).toMatchObject({
      valid: true, paragraphCount: 3, issues: [],
    });
  });

  test("recommends a split above 100 words and holds only above 120", () => {
    expect(assessForumReadability(words(100)).issues).toEqual([]);
    for (const count of [101, 120]) {
      expect(assessForumReadability(words(count))).toMatchObject({
        valid: true,
        issues: [{ code: "long_prose_paragraph", wordCount: count, blocking: false }],
      });
    }
    expect(assessForumReadability(words(121))).toMatchObject({
      valid: false,
      issues: [{ code: "long_prose_paragraph", wordCount: 121, blocking: true }],
    });
  });

  test("keeps compact discoveries, questions, answers, and source links free of templates", () => {
    for (const body of [
      "A small SDK change worth checking: retries now preserve the request identifier. [url=https://example.com/release]Release notes[/url]",
      "Does anyone have a reproducible case where this model loses a tool call?",
      "Try disabling automatic retries first. That should distinguish a malformed response from a duplicate request.",
      "",
    ]) expect(assessForumReadability(body), body).toMatchObject({ valid: true, issues: [] });
  });

  test("does not treat soft line wraps, style tags, or quotations as paragraph breaks", () => {
    for (const body of [
      `${words(70)}\n${words(70)}`,
      `[b]${words(70)}[/b] [i]${words(70)}[/i]`,
      `[quote]${words(140)}[/quote]`,
      `${words(70)}[br]${words(70)}`,
    ]) expect(assessForumReadability(body), body).toMatchObject({ valid: false, maxParagraphWords: 140 });
  });

  test("preserves real paragraphs and headings without requiring them", () => {
    for (const body of [
      `[p]${words(70)}[/p][p]${words(70)}[/p]`,
      `${words(70)}\n[h2]A separate consideration[/h2]\n${words(70)}`,
      `${words(70)}\n\n${words(70)}`,
      `${words(70)}\n## A separate consideration\n${words(70)}`,
    ]) expect(assessForumReadability(body), body).toMatchObject({ valid: true, issues: [] });
  });

  test("excludes closed code, tables, and math from prose paragraph totals", () => {
    const blocks = [
      `[code=ts]// ${words(150)}\nconst markup = '[list]';[/code]`,
      `\`\`\`ts\n// ${words(150)}\n\`\`\``,
      `~~~text\n${words(150)}\n~~~`,
      `[math]${words(150)}[/math]`,
      `[latex]${words(150)}[/latex]`,
      `$$${words(150)}$$`,
      `\\[${words(150)}\\]`,
      `[table][tr][td]${words(75)}[/td][td]${words(75)}[/td][/tr][/table]`,
      `| Option | Tradeoff |\n| --- | --- |\n| A | ${words(75)} |\n| B | ${words(75)} |`,
      `[decision]A | ${words(75)}\nB | ${words(75)}[/decision]`,
    ];
    for (const block of blocks) {
      expect(assessForumReadability(`A useful example.\n\n${block}\n\nTry it on a small test first.`), block)
        .toMatchObject({ valid: true, paragraphCount: 2, issues: [] });
      expect(assessForumReadability(`${words(140)}\n\n${block}`), block).toMatchObject({ valid: false });
    }
  });

  test("assesses Markdown list entries individually rather than summing the entire list", () => {
    const list = ["-", "*", "1.", "2)"].map((marker) => `${marker} ${words(55)}\n  ${words(15)}`).join("\n");
    expect(assessForumReadability(list)).toMatchObject({ valid: true, paragraphCount: 4, maxParagraphWords: 70 });
    expect(assessForumReadability(`- ${words(140)}`)).toMatchObject({ valid: false });
  });

  test("holds a long BBCode bullet while preserving short and nested bullet lists", () => {
    expect(assessForumReadability(`[list][*]${words(150)}[/list]`)).toMatchObject({
      valid: false,
      issues: [{ code: "long_prose_paragraph", wordCount: 150, blocking: true }],
    });
    const list = `[list]${Array.from({ length: 10 }, () => `[*]${words(25)}`).join("")}[/list]`;
    expect(assessForumReadability(list)).toMatchObject({ valid: true, paragraphCount: 10, maxParagraphWords: 25 });
    expect(assessForumReadability(`[list][*]${words(60)}[list][*]${words(60)}[/list][*]${words(60)}[/list]`))
      .toMatchObject({ valid: true, paragraphCount: 3, maxParagraphWords: 60 });
    expect(assessForumReadability(`[list][*]A code example: [code]${words(150)}[/code][*]A small follow-up[/list]`))
      .toMatchObject({ valid: true, issues: [] });
  });

  test("excludes only an explicitly trusted final source footer", () => {
    const footer = `\n[b]Sources and further reading[/b]\n${Array.from({ length: 3 }, (_, index) => `[url=https://example.com/${index}]${words(60)}[/url]`).join("\n")}`;
    const body = `This compact discovery is worth a small local test.${footer}`;
    expect(assessForumReadability(body)).toMatchObject({ valid: false });
    expect(assessForumReadability(body, { trustedSourceFooter: true })).toMatchObject({
      valid: true, paragraphCount: 1, issues: [],
    });
    const forged = `A short opening.\n[b]Sources and further reading[/b]\n${words(150)}${footer}`;
    expect(assessForumReadability(forged, { trustedSourceFooter: true })).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: "long_prose_paragraph", blocking: true })],
    });
    expect(assessForumReadability(`${words(150)}${footer}`, { trustedSourceFooter: true }))
      .toMatchObject({ valid: false, maxParagraphWords: 150 });
    // Without a newline marker, even a trusted caller cannot hide the body.
    expect(assessForumReadability(`[b]Sources and further reading[/b] ${words(150)}`, { trustedSourceFooter: true }))
      .toMatchObject({ valid: false });
  });

  test("unfinished display markup cannot hide dense prose", () => {
    for (const body of [
      `[code]${words(140)}`,
      `[list][*]${words(140)}`,
      `[table]${words(140)}`,
      `\`\`\`text\n${words(140)}`,
      `$$${words(140)}`,
      `${words(70)} | ${words(70)}`,
    ]) expect(assessForumReadability(body), body).toMatchObject({ valid: false });
  });

  test("holds oversized authored bodies explicitly rather than passing a scanned prefix", () => {
    expect(assessForumReadability("short\n\n" + "x".repeat(64_000))).toMatchObject({
      valid: false,
      issues: [{ code: "readability_scan_limit", blocking: true, paragraph: 0 }],
      paragraphCount: 0,
    });
    expect(assessForumReadability(`A short post.\n[b]Sources and further reading[/b]\n${"x".repeat(64_000)}`, { trustedSourceFooter: true }))
      .toMatchObject({ valid: false, issues: [{ code: "readability_scan_limit", blocking: true }] });
  });
});

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
