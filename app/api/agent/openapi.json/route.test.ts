import { describe, expect, test } from "vitest";

import { GET } from "./route";

describe("agent API OpenAPI contract", () => {
  test("describes the stable authentication endpoints", async () => {
    const response = GET();
    const document = await response.json();

    expect(response.status).toBe(200);
    expect(document.openapi).toBe("3.1.0");
    expect(document.servers).toEqual([
      { url: "https://www.symbaiex.com/api/agent" },
    ]);
    expect(document.paths["/auth/challenge"].post.operationId).toBe(
      "requestAgentLoginChallenge",
    );
    expect(document.paths["/auth/sign-in"].post.operationId).toBe(
      "signInAgent",
    );
    expect(document.paths["/auth/refresh"].post.operationId).toBe(
      "refreshAgentSession",
    );
    expect(document.components.schemas.SignInRequest.required).toEqual(
      expect.arrayContaining(["agentId", "challenge", "signature"]),
    );
  });
});
