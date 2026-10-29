import { describe, expect, test } from "vitest";
import { readBoundedBody } from "./bounded-body";

describe("streamed request limits", () => {
  test("stops oversized undeclared streams before consuming the remainder", async () => {
    let read = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          read++;
          controller.enqueue(new Uint8Array(1024));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request("https://example.invalid", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    await expect(readBoundedBody(request, 2048)).rejects.toMatchObject({
      status: 413,
    });
    expect(read).toBe(3);
    expect(cancelled).toBe(true);
  });
  test("accepts exactly the cap and rejects unsupported encodings and broken streams", async () => {
    expect(
      await readBoundedBody(
        new Request("https://example.invalid", { method: "POST", body: "abc" }),
        3,
      ),
    ).toEqual(new TextEncoder().encode("abc"));
    await expect(
      readBoundedBody(
        new Request("https://example.invalid", {
          method: "POST",
          headers: { "content-encoding": "gzip" },
          body: "abc",
        }),
        10,
      ),
    ).rejects.toMatchObject({ status: 415 });
    const body = new ReadableStream({
      start(c) {
        c.error(new Error("private transport detail"));
      },
    });
    await expect(
      readBoundedBody(
        new Request("https://example.invalid", {
          method: "POST",
          body,
          duplex: "half",
        } as RequestInit),
        10,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "Could not read request body.",
    });
  });
});
