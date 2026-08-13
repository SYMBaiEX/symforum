import { afterEach, describe, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  getIndexNowAuditSnapshot,
  normalizeIndexNowUrls,
  notifyIndexNow,
  resetIndexNowAuditForTests,
} from "./indexnow";

const originalKey = process.env.INDEXNOW_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  resetIndexNowAuditForTests();
  if (originalKey === undefined) delete process.env.INDEXNOW_KEY;
  else process.env.INDEXNOW_KEY = originalKey;
});

describe("IndexNow publishing", () => {
  test("accepts only deduplicated HTTPS URLs on the public site hosts", () => {
    expect(
      normalizeIndexNowUrls([
        "https://www.symbaiex.com/blog/hello",
        "https://www.symbaiex.com/blog/hello",
        "http://www.symbaiex.com/blog/insecure",
        "https://evil.example/blog/hello",
        "https://www.symbaiex.com/blog/hello?draft=true",
      ]),
    ).toEqual(["https://www.symbaiex.com/blog/hello"]);
  });

  test("fails closed when no key is configured", async () => {
    delete process.env.INDEXNOW_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await notifyIndexNow(["https://www.symbaiex.com/blog/hello"]);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("submits a bounded payload and never includes the key in logs", async () => {
    process.env.INDEXNOW_KEY = "test-key_123";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => {});

    await notifyIndexNow([
      "https://www.symbaiex.com/blog/hello",
      "https://www.symbaiex.com/blog/hello",
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      host: "www.symbaiex.com",
      key: "test-key_123",
      keyLocation: "https://www.symbaiex.com/indexnow-test-key_123.txt",
      urlList: ["https://www.symbaiex.com/blog/hello"],
    });
    expect(warnMock.mock.calls.flat().join(" ")).not.toContain("test-key_123");
  });

  test("retries transient failures and captures the final result in audit", async () => {
    process.env.INDEXNOW_KEY = "test-key_123";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await notifyIndexNow(["https://www.symbaiex.com/blog/retry"], {
      context: {
        source: "post",
        action: "update",
        resourceId: "retry",
      },
    });

    const audit = getIndexNowAuditSnapshot();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(audit.at(-1)).toMatchObject({
      status: "succeeded",
      attempts: 2,
      source: "post",
      action: "update",
      resourceId: "retry",
    });
  });

  test("skips duplicate calls in the idempotency window", async () => {
    process.env.INDEXNOW_KEY = "test-key_123";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await notifyIndexNow(["https://www.symbaiex.com/blog/dup"], {
      context: {
        source: "post",
        action: "update",
        resourceId: "dup",
      },
    });
    await notifyIndexNow(["https://www.symbaiex.com/blog/dup"], {
      context: {
        source: "post",
        action: "update",
        resourceId: "dup",
      },
    });

    const audit = getIndexNowAuditSnapshot().filter((record) =>
      record.status !== "queued",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(audit.at(-1)).toMatchObject({
      status: "skipped",
      source: "post",
      action: "update",
      resourceId: "dup",
      attempts: 0,
      urlCount: 1,
    });
  });
});
