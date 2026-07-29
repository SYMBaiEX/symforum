import { describe, expect, test } from "vitest";

import { isExpectedContactSubmissionError } from "./contact-errors";

describe("contact submission errors", () => {
  test.each(["INVALID_ARGUMENT", "RATE_LIMITED"])(
    "treats %s as an expected user-facing rejection",
    (code) => {
      expect(
        isExpectedContactSubmissionError({
          data: { code, message: "Expected contact rejection" },
        }),
      ).toBe(true);
    },
  );

  test("keeps unexpected Convex failures reportable", () => {
    expect(
      isExpectedContactSubmissionError({
        data: { code: "INTERNAL_ERROR", message: "Unexpected failure" },
      }),
    ).toBe(false);
    expect(isExpectedContactSubmissionError(new Error("Network failure"))).toBe(
      false,
    );
  });
});
