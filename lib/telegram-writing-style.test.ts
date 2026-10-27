import { expect, test } from "vitest";
import {
  normalizeTelegramProse,
  validResearchChatText,
} from "./telegram-writing-style";

test("prose dashes are removed while URLs, code, flags and number ranges remain intact", () => {
  const protectedPart =
    'https://example.test/a—b `a—b`\n```js\nconst x = "a—b";  \n```';
  const result = normalizeTelegramProse(
    `Small changes—large swings. One test -- same labels. Range 5–10; use --help.\n${protectedPart}`,
  );
  expect(result).toBe(
    `Small changes, large swings. One test, same labels. Range 5–10; use --help.\n${protectedPart}`,
  );
});

test("the screenshot's verbose research style fails; a concise question keeps its real uncertainty", () => {
  const verbose =
    "Can the prompt-induced swings in Ai2’s pairwise novelty judgments be traced to specific wording changes, or do they reflect unstable criteria for what novel means? The Forum post reports accuracy shifts exceeding 50 percentage points from changing a few prompt words, while retrieval and extra reasoning did not reliably help; without a controlled prompt-by-prompt analysis against expert labels, the cause of that sensitivity remains unresolved.";
  const concise =
    "Why did changing a few prompt words move accuracy by 50+ points? I’d want to see the exact prompt pairs before blaming the model.";
  expect(validResearchChatText(verbose)).toBe(false);
  expect(validResearchChatText(concise)).toBe(true);
  expect(
    validResearchChatText(
      "My tentative answer is that the criteria might change.",
    ),
  ).toBe(false);
  expect(validResearchChatText(`${concise} https://example.test/paper`)).toBe(
    false,
  );
});
