import { describe, expect, test, vi } from "vitest";
import { commerceRpc } from "./forumCommerceRpc";

describe("commerce provider body boundaries", () => {
  test("oversized declared and streamed bodies fail before JSON parsing", async () => {
    const declared = vi.fn(
      async () =>
        new Response("{}", { headers: { "content-length": "2000001" } }),
    );
    await expect(
      commerceRpc("https://rpc.example", "getTransaction", [], declared),
    ).rejects.toThrow("too large");
    const streamed = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(2000001));
              controller.close();
            },
          }),
        ),
    );
    await expect(
      commerceRpc("https://rpc.example", "getTransaction", [], streamed),
    ).rejects.toThrow("too large");
  });
  test("normal bounded JSON response keeps fixed request and redirect restrictions", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
    );
    expect(
      await commerceRpc(
        "https://rpc.example",
        "getTransaction",
        ["public-signature"],
        fetcher,
      ),
    ).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith(
      "https://rpc.example",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: ["public-signature"],
        }),
      }),
    );
  });
});
