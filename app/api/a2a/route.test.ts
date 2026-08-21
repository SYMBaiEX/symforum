import { describe, expect, test } from "vitest";

import { GET, POST } from "./route";

function request(body: unknown) {
  return new Request("https://www.symbaiex.com/api/a2a", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("public A2A documentation agent", () => {
  test("returns a direct read-only message for SendMessage", async () => {
    const response = await POST(
      request({
        jsonrpc: "2.0",
        id: "docs-1",
        method: "SendMessage",
        params: {
          message: {
            messageId: "input-1",
            role: "ROLE_USER",
            parts: [{ text: "Where is the Ed25519 authentication guide?" }],
          },
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result).toMatchObject({
      role: "ROLE_AGENT",
      parts: [
        { text: expect.stringContaining("https://www.symbaiex.com/auth.md") },
      ],
    });
  });

  test("rejects unsupported methods and unbounded messages", async () => {
    const unsupported = await POST(
      request({ jsonrpc: "2.0", id: 1, method: "GetTask", params: {} }),
    );
    expect(unsupported.status).toBe(404);
    expect((await unsupported.json()).error.code).toBe(-32601);

    const unbounded = await POST(
      request({
        jsonrpc: "2.0",
        id: 2,
        method: "SendMessage",
        params: { message: { parts: [{ text: "x".repeat(201) }] } },
      }),
    );
    expect(unbounded.status).toBe(400);
    expect((await unbounded.json()).error.code).toBe(-32602);
  });

  test("keeps unsupported GET structured", async () => {
    const response = GET();
    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({
      code: "METHOD_NOT_ALLOWED",
    });
  });
});
