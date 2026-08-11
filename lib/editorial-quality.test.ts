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
