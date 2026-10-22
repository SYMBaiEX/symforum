import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

import {
  extractVerifiableTokens,
  forumBodyFactualStatements,
  forumBodyQuestions,
  forumStatementIsQualifiedInference,
  forumQuestionSimilarity,
  isMeaningfullyRelatedForumThread,
  lexicalEvidenceCoverage,
  lexicalSimilarity,
  repairForumAgentMarkup,
  unsupportedVerifiableTokens,
  validateForumAgentMarkup,
} from "./editorial-quality";

describe("editorial quality helpers", () => {
  test("checks factual tokens against the cited source text", () => {
    const source = "Muse supports a 128,000 token context and version 2.4.";
    expect(
      unsupportedVerifiableTokens(
        "Muse supports 128000 tokens in v2.4, not 256000 tokens.",
        source,
      ),
    ).toEqual(["256000 tokens"]);
  });

  test("extracts identifiers, versions, percentages, and quantities", () => {
    expect(
      extractVerifiableTokens(
        "CVE-2026-1234 affects v3.2.1 in 12% of 40 models",
      ),
    ).toEqual(["cve-2026-1234", "v3.2.1", "12%", "40 models"]);
    expect(
      extractVerifiableTokens(
        "This is a two-dollar fix that prevents a two-minute delay.",
      ),
    ).toEqual(["two dollar", "two minute"]);
    expect(
      unsupportedVerifiableTokens(
        "This is a two-dollar fix.",
        "The source only describes a focus fix.",
      ),
    ).toEqual(["two dollar"]);
    expect(
      unsupportedVerifiableTokens(
        "The fix covers CVE-2026-1234.",
        "Advisory CVE-2026-1234 describes the affected versions.",
      ),
    ).toEqual([]);
  });

  test("measures evidence and frame overlap without stop-word inflation", () => {
    expect(
      lexicalEvidenceCoverage(
        "Checkpoint recovery reduces repeated synchronization work",
        "The release adds checkpoint recovery for synchronization jobs.",
      ),
    ).toBeGreaterThan(0.4);
    expect(
      lexicalSimilarity(
        "Operational ownership becomes the new AI moat",
        "AI's new moat is operational ownership",
      ),
    ).toBeGreaterThan(0.5);
  });

  test("accepts complete BBCode evidence blocks and rejects malformed or empty ones", () => {
    expect(
      validateForumAgentMarkup(`[h2]Decision[/h2]
[decision=Deployment fit]
Small team|Adopt|The workflow removes a manual handoff
Regulated team|Pilot|Review the audit trail first
[/decision]`),
    ).toMatchObject({ valid: true, structuredBlockCount: 1 });

    const malformed = validateForumAgentMarkup(`[h2]Decision[/h3]
[table]
[tr][th]Option[/th][th]Verdict[/th][/tr]
[/table]`);
    expect(malformed.valid).toBe(false);
    expect(malformed.feedback.join(" ")).toContain("Balance every [h2]");
    expect(malformed.feedback.join(" ")).toContain(
      "header row and at least one complete data row",
    );
  });

  test("accepts standard table sections and rejects empty or dangling prose", () => {
    expect(
      validateForumAgentMarkup(`[table]
[thead][tr][th]Signal[/th][th]Meaning[/th][/tr][/thead]
[tbody][tr][td]Queue[/td][td]No wait[/td][/tr][/tbody]
[/table]`),
    ).toMatchObject({ valid: true, structuredRowCount: 2 });

    const broken = validateForumAgentMarkup(`[list]
[*]Keep this
[*]
[/list]

Three points:\n1. Modal focus.\n2. Keyboard access.

[table][tr][th]A[/th][th]B[/th][/tr][tr][td]1[/td][td]2[/td][/tr][/table]`);
    expect(broken.valid).toBe(false);
    expect(broken.feedback).toContain("Remove empty list items");
    expect(broken.feedback.join(" ")).toContain("3 points");
  });

  test("keeps short factual claims visible without treating natural ordinal prose as a list", () => {
    expect(forumBodyFactualStatements("The model supports streaming.")).toEqual(
      ["The model supports streaming."],
    );
    expect(
      validateForumAgentMarkup(
        "The first is a prerequisite for the deployment. A token must be present before connecting.",
      ).valid,
    ).toBe(true);
    expect(
      validateForumAgentMarkup("Install the supported SDK.\n5.").valid,
    ).toBe(false);
    expect(
      validateForumAgentMarkup(
        "Three steps:\n1. Download the SDK.\n2. Start the server.",
      ).valid,
    ).toBe(false);
    expect(
      forumStatementIsQualifiedInference(
        "This suggests recovery can become an explicit checkpoint in your operational playbook.",
      ),
    ).toBe(true);
    expect(
      forumStatementIsQualifiedInference("The model supports streaming."),
    ).toBe(false);
  });

  test("repairs omitted table-cell closing tags without changing complete cells", () => {
    const repaired = repairForumAgentMarkup(`[table]
[tr][th]Signal[th]Meaning[/tr]
[tr][td]Checkpoint[/td][td]Resume interrupted work[/tr]
[/table]`);

    expect(repaired).toContain("[tr][th]Signal[/th][th]Meaning[/th][/tr]");
    expect(repaired).toContain(
      "[tr][td]Checkpoint[/td][td]Resume interrupted work[/td][/tr]",
    );
    expect(validateForumAgentMarkup(repaired)).toMatchObject({ valid: true });
  });

  test("removes empty list markers without changing populated items", () => {
    const repaired = repairForumAgentMarkup(`[list]
[*]Inspect the checkpoint
[*]
[li][/li]
[*][/*]
[*]Resume from verified state
[/list]

[table][tr][th]A[/th][th]B[/th][/tr][tr][td]1[/td][td]2[/td][/tr][/table]`);

    expect(repaired).toContain("[*]Inspect the checkpoint");
    expect(repaired).toContain("[*]Resume from verified state");
    expect(repaired).not.toContain("[li][/li]");
    expect(repaired).not.toContain("[*][/*]");
    expect(validateForumAgentMarkup(repaired)).toMatchObject({ valid: true });
  });

  test("closes one unambiguous structured block and its final table row", () => {
    const steps = repairForumAgentMarkup(`[steps=Recovery]
1|Inspect|Read the checkpoint
2|Resume|Continue from verified state`);
    expect(steps).toContain("2|Resume|Continue from verified state\n[/steps]");
    expect(validateForumAgentMarkup(steps)).toMatchObject({ valid: true });

    const table = repairForumAgentMarkup(`[table]
[tr][th]Signal[th]Meaning[/tr]
[tr][td]Checkpoint[td]Resume safely`);
    expect(table).toContain(
      "[tr][td]Checkpoint[/td][td]Resume safely[/td][/tr]\n[/table]",
    );
    expect(validateForumAgentMarkup(table)).toMatchObject({ valid: true });
  });

  test("detects consequential body statements and duplicate closing questions", () => {
    expect(
      forumBodyFactualStatements(
        "Version 2.4 adds checkpoint recovery for interrupted synchronization jobs. Would this help your team?",
      ),
    ).toEqual([
      "Version 2.4 adds checkpoint recovery for interrupted synchronization jobs.",
    ]);
    expect(
      forumQuestionSimilarity(
        "Where would this remove the most operational pain?",
        "Where would it remove the most pain in your operations?",
      ),
    ).toBeGreaterThan(0.5);
    expect(
      forumBodyQuestions(
        "Would this help your team? Where would this help your team most?",
      ),
    ).toHaveLength(2);
  });

  test("evaluates structured evidence row by row instead of one oversized claim", () => {
    const statements = forumBodyFactualStatements(`[decision=Architecture]
Dimension|Relay or tube logic|Parametron logic
Binary representation|Voltage or switch state|AC phase, 180 degrees apart
Speed|Active devices held the speed edge|The device ceiling is 6 MHz
[/decision]

[table]
[thead][tr][th]Signal[/th][th]Meaning[/th][/tr][/thead]
[tbody]
[tr][td]Version 2.4[/td][td]Adds checkpoint recovery for interrupted synchronization jobs[/td][/tr]
[tr][td]Queue[/td][td]Supports interrupted jobs[/td][/tr]
[/tbody]
[/table]`);

    expect(statements).toContain(
      "Binary representation Voltage or switch state AC phase, 180 degrees apart",
    );
    expect(statements).toContain(
      "Speed Active devices held the speed edge The device ceiling is 6 MHz",
    );
    expect(statements).toContain(
      "Version 2.4 Adds checkpoint recovery for interrupted synchronization jobs",
    );
    expect(statements).not.toContain(
      expect.stringContaining(
        "Dimension Relay or tube logic Parametron logic Binary",
      ),
    );
  });

  test("only relates threads with multiple specific shared concepts", () => {
    expect(
      isMeaningfullyRelatedForumThread(
        "Copilot SDK for Java production readiness",
        "Java Copilot SDK annotation processor failure modes",
      ),
    ).toBe(true);
    expect(
      isMeaningfullyRelatedForumThread(
        "Copilot SDK for Java production readiness",
        "GitHub enterprise app installation permissions",
      ),
    ).toBe(false);
  });
  test("allows short natural posts without a table or closing question", () => {
    expect(
      validateForumAgentMarkup(
        "A small discovery: the SDK exposes the retry count in its trace. I linked the changelog so others can check it.",
      ),
    ).toMatchObject({ valid: true, structuredBlockCount: 0 });
  });

  test("rejects incomplete additional rows even when other rows are complete", () => {
    const table = validateForumAgentMarkup(
      "[table][tr][th]Task[/th][th]Result[/th][/tr][tr][td]Build[/td][td]Passed[/td][/tr][tr][td]Test[/td][td][/td][/tr][/table]",
    );
    expect(table.valid).toBe(false);
    expect(table.feedback).toContain(
      "Complete every table row and remove empty cells",
    );
    const steps = validateForumAgentMarkup(
      "[steps]1|Install|Use the SDK\n2|Run|Check the result\n3||[/steps]",
    );
    expect(steps.valid).toBe(false);
    expect(steps.feedback).toContain(
      "Complete every [steps] row and remove empty columns",
    );
  });
  test("rejects invented paired markup while preserving code and literal citations", () => {
    for (const body of [
      "[p]A useful paragraph.[/p]",
      "[P]Another paragraph.[/P]",
      "[sourcecard=Evidence]A source[/sourcecard]",
      "[unknown]A prose wrapper[/unknown]",
    ]) {
      const result = validateForumAgentMarkup(body);
      expect(result.valid, body).toBe(false);
      expect(result.feedback.join(" ")).toContain("unsupported paired");
    }
    for (const body of [
      "[sau412] reported this in the forum. Reference [3] is useful.",
      "Array indexes include foo[3] and release labels [v2.4].",
      "[code][p]An example of invalid markup[/p][/code]",
      "A literal [inlinecode][unknown]value[/unknown][/inlinecode] example.",
      "`[unknown]sample[/unknown]` is a literal code example.",
      "A lone [sourcecard] reference is ordinary text.",
    ]) {
      expect(validateForumAgentMarkup(body).valid, body).toBe(true);
    }
  });

  test("allows every paired tag supported by the actual forum renderer", () => {
    const rendererSource = readFileSync(
      new URL("../components/forum/forum-bbcode-model.ts", import.meta.url),
      "utf8",
    );
    const tagsSource = rendererSource.match(
      /const SUPPORTED_TAGS = new Set\(\[([\s\S]*?)\]\);/,
    )?.[1];
    expect(tagsSource).toBeDefined();
    const tags = [...tagsSource!.matchAll(/"([a-z*]+)"/g)].map(
      (match) => match[1]!,
    );
    expect(tags).toContain("math");
    expect(tags).toContain("sourcecards");
    for (const tag of tags) {
      const result = validateForumAgentMarkup(
        `[${tag}]Example contents[/${tag}]`,
      );
      // Some blocks need specific rows or parent containers. This assertion
      // covers the renderer vocabulary, rather than declaring all shapes valid.
      expect(
        result.feedback.some((item) => item.includes("unsupported paired")),
        tag,
      ).toBe(false);
    }
  });
  test("inline code is literal but its own delimiters must balance", () => {
    expect(validateForumAgentMarkup("Use [inlinecode][unknown]example[/unknown][/inlinecode] as literal text.").valid).toBe(true);
    for (const body of [
      "Use [inlinecode]a value without a closing delimiter.",
      "Use a value without an opening delimiter.[/inlinecode]",
    ]) {
      expect(validateForumAgentMarkup(body).valid, body).toBe(false);
    }
    expect(validateForumAgentMarkup("[unknown]This is not literal code.[/unknown]").valid).toBe(false);
  });
  test("author-created source headings cannot conceal unfinished draft content", () => {
    for (const tag of ["b", "h2"]) {
      const body = `A useful introduction.\n[${tag}]Sources and further reading[/${tag}]\n[url=https://example.com]A real source[/url]\n5.`;
      const result = validateForumAgentMarkup(body);
      expect(result.valid).toBe(false);
      expect(result.feedback).toContain(
        "Complete or remove bare numbered steps",
      );
    }
    const body =
      "A useful introduction.\n[b]Sources and further reading[/b]\n[note][/note]";
    expect(validateForumAgentMarkup(body).valid).toBe(false);
  });

  test("only the explicitly trusted last footer is excluded from authored-body checks", () => {
    const footer =
      "\n\n[b]Sources and further reading[/b]\n[list][*][url=https://example.com]Source[/url][/list]";
    const emptyFinalSection = "A useful introduction.\n[h2]Failure modes[/h2]";
    expect(
      validateForumAgentMarkup(emptyFinalSection + footer, {
        trustedSourceFooter: true,
      }).feedback,
    ).toContain("Complete or remove the empty section: Failure modes");
    const forgedEarlierFooter = "A useful introduction." + footer + "\n5.";
    const finalized = forgedEarlierFooter + footer;
    expect(
      validateForumAgentMarkup(finalized, { trustedSourceFooter: true })
        .feedback,
    ).toContain("Complete or remove bare numbered steps");
    expect(validateForumAgentMarkup(finalized).valid).toBe(false);
  });
});
