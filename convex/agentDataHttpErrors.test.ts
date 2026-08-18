import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";

import { normalizeAgentDataHttpError } from "./agentDataHttpErrors";

describe("agent data HTTP error normalization", () => {
  test("preserves stable ConvexError codes without exposing error data", () => {
    const normalized = normalizeAgentDataHttpError(
      new ConvexError({
        code: "INVALID_REQUEST",
        message: "input included a credential",
        secret: "must-not-escape",
      }),
    );

    expect(normalized).toEqual({
      status: 400,
      payload: {
        code: "INVALID_REQUEST",
        error: "Agent data request could not be completed.",
      },
    });
    expect(JSON.stringify(normalized)).not.toContain("credential");
    expect(JSON.stringify(normalized)).not.toContain("must-not-escape");
  });

  test("maps scope and quota codes without exposing structured details", () => {
    expect(
      normalizeAgentDataHttpError(
        new ConvexError({
          code: "AGENT_SCOPE_DENIED",
          message: "scope details",
          scopes: ["private"],
        }),
      ),
    ).toEqual({
      status: 403,
      payload: {
        code: "AGENT_SCOPE_DENIED",
        error: "An active agent identity with the evidence scope is required.",
      },
    });
    expect(
      normalizeAgentDataHttpError(
        new ConvexError({
          code: "AGENT_QUOTA_EXCEEDED",
          message: "quota details",
          retryAfter: 123,
        }),
      ),
    ).toEqual({
      status: 429,
      payload: {
        code: "AGENT_QUOTA_EXCEEDED",
        error: "Agent usage quota or rate limit reached.",
      },
    });
  });

  test("uses a generic code and message for unknown or malformed errors", () => {
    for (const error of [
      new Error("stack and secret must not escape"),
      new ConvexError({ code: "invalid code", message: "secret" }),
      { data: { code: "FAKE_CODE", secret: "secret" } },
    ]) {
      expect(normalizeAgentDataHttpError(error)).toEqual({
        status: 400,
        payload: {
          code: "AGENT_DATA_REQUEST_FAILED",
          error: "Agent data request could not be completed.",
        },
      });
    }
  });

  test("retains legacy status classification for non-Convex errors", () => {
    expect(normalizeAgentDataHttpError(new Error("rate limit reached")).status).toBe(
      429,
    );
    expect(
      normalizeAgentDataHttpError(
        new Error("An active agent identity is required."),
      ).status,
    ).toBe(403);
  });
});
