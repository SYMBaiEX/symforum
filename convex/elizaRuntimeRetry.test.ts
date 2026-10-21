// @vitest-environment node
import { describe, expect, test } from "vitest";
import { ElizaRuntimeTransportError } from "../lib/eliza-runtime-transport";
import { isRetryableError } from "./sukiForumAgent";
import { isRetryableSukiReplyError } from "./sukiForumReplyAgent";
import { isRetryableBelleError } from "./belleForumAgent";

describe("live worker scheduled retry boundary", () => {
  test.each([
    isRetryableError,
    isRetryableSukiReplyError,
    isRetryableBelleError,
  ])(
    "does not automatically schedule a new call after any transport-fatal failure",
    (retryable) => {
      const uncertain = new ElizaRuntimeTransportError("outcome_unknown", true);
      expect(retryable(uncertain)).toBe(false);
      expect(retryable(new Error("SDK wrapper", { cause: uncertain }))).toBe(
        false,
      );
      expect(retryable(new AggregateError([uncertain], "SDK retries"))).toBe(
        false,
      );
      expect(
        retryable(new ElizaRuntimeTransportError("operation_unavailable")),
      ).toBe(false);
      expect(retryable(new Error("legacy transient provider failure"))).toBe(
        true,
      );
    },
  );
});
