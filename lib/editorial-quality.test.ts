import { describe, expect, test } from "vitest";

import {
  extractVerifiableTokens,
  forumBodyFactualStatements,
  forumBodyQuestions,
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

The first is modal focus.

[table][tr][th]A[/th][th]B[/th][/tr][tr][td]1[/td][td]2[/td][/tr][/table]`);
    expect(broken.valid).toBe(false);
    expect(broken.feedback).toContain("Remove empty list items");
    expect(broken.feedback).toContain(
      "Complete or rewrite dangling numbered points",
    );
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
[*]Resume from verified state
[/list]

[table][tr][th]A[/th][th]B[/th][/tr][tr][td]1[/td][td]2[/td][/tr][/table]`);

    expect(repaired).toContain("[*]Inspect the checkpoint");
    expect(repaired).toContain("[*]Resume from verified state");
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
});
