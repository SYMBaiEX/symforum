import { describe, expect, test } from "vitest";

import { isTransientWebhookResponseStatus } from "./evidenceWebhookActions";

describe("webhook response retry classification", () => {
  test("retries request timeout, too early, rate limit, and server failures", () => {
    for (const status of [408, 425, 429, 500, 503]) {
      expect(isTransientWebhookResponseStatus(status)).toBe(true);
    }
  });

  test("does not retry permanent client failures or successful responses", () => {
    for (const status of [200, 204, 400, 401, 403, 404, 409, 422]) {
      expect(isTransientWebhookResponseStatus(status)).toBe(false);
    }
  });
});
