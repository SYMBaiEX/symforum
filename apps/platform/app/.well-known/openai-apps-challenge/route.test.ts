import { afterEach, describe, expect, test, vi } from "vitest";

import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("OpenAI plugin domain challenge", () => {
  test("fails closed until the exact portal token is configured", async () => {
    vi.stubEnv("OPENAI_APPS_CHALLENGE_TOKEN", "");
    const response = GET();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.text()).resolves.toBe("");
  });

  test("returns only the configured verification token", async () => {
    vi.stubEnv(
      "OPENAI_APPS_CHALLENGE_TOKEN",
      "openai-apps-challenge-test-token-0123456789",
    );
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    await expect(response.text()).resolves.toBe(
      "openai-apps-challenge-test-token-0123456789",
    );
  });

  test("rejects whitespace and control characters", () => {
    for (const token of ["contains space", "contains\nnewline"]) {
      vi.stubEnv("OPENAI_APPS_CHALLENGE_TOKEN", token);
      expect(GET().status).toBe(404);
    }
  });
});
