import { expect, test } from "vitest";
import {
  FORUM_GENERATION_RUN_MS,
  ForumGenerationBudgetError,
  forumGenerationDeadline,
  forumGenerationStageTimeout,
} from "./forum-generation-budget";

test("one absolute deadline leaves room for review and committing a hold", () => {
  const start = 1_000;
  const deadline = forumGenerationDeadline(start);
  expect(deadline - start).toBe(FORUM_GENERATION_RUN_MS);
  expect(forumGenerationStageTimeout(deadline, 270_000, start)).toBe(270_000);
  expect(
    forumGenerationStageTimeout(deadline - 90_000, 210_000, start + 350_000),
  ).toBe(85_000);
  expect(forumGenerationStageTimeout(deadline, 90_000, start + 440_000)).toBe(
    85_000,
  );
  expect(() =>
    forumGenerationStageTimeout(deadline, 90_000, start + 522_000),
  ).toThrow(ForumGenerationBudgetError);
});
