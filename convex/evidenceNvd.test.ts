import { describe, expect, test } from "vitest";
import {
  NVD_TERMS_URL,
  buildNvdUrl,
  nvdFailureCheckpoint,
  nvdInProgressCheckpoint,
  nextNvdCursor,
  nvdRequestHeaders,
  nvdSuccessCheckpoint,
  parseCursor,
  parseNvdPage,
  parseNvdChangeHistory,
  parseNvdCves,
  nvdPostVersionWork,
  nvdRetryCursor,
  NvdPaginationError,
  readBoundedNvdResponse,
  retryAfterMs,
  totalResults,
} from "./evidenceNvd";

function cvePage(
  totalResults: number,
  count = 1,
  startIndex = 0,
  resultsPerPage = count,
) {
  return {
    totalResults,
    startIndex,
    resultsPerPage,
    vulnerabilities: Array.from({ length: count }, (_, index) => ({
      cve: {
        id: `CVE-2026-${String(10_000 + index)}`,
        descriptions: [{ lang: "en", value: `Description ${index}` }],
        published: "2026-08-01T00:00:00.000Z",
        lastModified: "2026-08-02T00:00:00.000Z",
      },
    })),
  };
}

describe("NVD evidence adapters", () => {
  test("uses a bounded recent incremental window and safely resumes pages", () => {
    const now = Date.UTC(2026, 7, 18, 12);
    const initial = nextNvdCursor(null, now);
    expect(initial.windowEnd).toBe(now);
    expect(now - initial.windowStart).toBeLessThanOrEqual(
      2.25 * 60 * 60 * 1_000,
    );
    expect(initial.startIndex).toBe(0);
    expect(initial.pageSize).toBe(25);
    const resumed = nextNvdCursor(
      {
        cursor: JSON.stringify({
          windowStart: 1,
          windowEnd: 2,
          startIndex: 100,
        }),
        lastSucceededAt: 99,
        ingestionEnabled: true,
        status: "active",
      },
      now,
    );
    expect(resumed).toMatchObject({
      windowStart: 1,
      windowEnd: 2,
      startIndex: 100,
      pageSize: 25,
      failureCount: 0,
    });
    expect(
      parseCursor(
        JSON.stringify({
          windowStart: 0,
          windowEnd: 121 * 24 * 60 * 60 * 1_000,
          startIndex: 0,
        }),
      ),
    ).toBeNull();
  });

  test("builds NVD-only URLs with bounds and overlap-safe timestamps", () => {
    const url = new URL(
      buildNvdUrl("cves", {
        windowStart: 0,
        windowEnd: 1_000,
        startIndex: 100,
      }),
    );
    expect(url.hostname).toBe("services.nvd.nist.gov");
    expect(url.searchParams.get("resultsPerPage")).toBe("25");
    expect(url.searchParams.get("startIndex")).toBe("100");
    expect(url.searchParams.get("lastModStartDate")).toBe(
      new Date(0).toISOString(),
    );
    expect(
      new URL(
        buildNvdUrl("history", {
          windowStart: 0,
          windowEnd: 1_000,
          startIndex: 0,
        }),
      ).searchParams.get("changeEndDate"),
    ).toBe(new Date(1_000).toISOString());
  });

  test("sends a configured key only to NVD as a header and never embeds it in the URL", () => {
    expect(
      nvdRequestHeaders(
        "https://services.nvd.nist.gov/rest/json/cves/2.0",
        "key-value",
      ),
    ).toMatchObject({ apiKey: "key-value" });
    expect(
      nvdRequestHeaders("https://example.com/rest/json/cves/2.0", "key-value"),
    ).not.toHaveProperty("apiKey");
    expect(
      buildNvdUrl("cves", { windowStart: 0, windowEnd: 1_000, startIndex: 0 }),
    ).not.toContain("key-value");
  });

  test("stores only bounded CVE metadata rather than raw vulnerability payloads", () => {
    const huge = "x".repeat(8_000);
    const documents = parseNvdCves({
      vulnerabilities: [
        {
          cve: {
            id: "CVE-2026-12345",
            descriptions: [{ lang: "en", value: huge }],
            published: "2026-08-01T00:00:00.000",
            lastModified: "2026-08-02T00:00:00.000",
            vulnStatus: "Analyzed",
            configurations: huge,
          },
        },
      ],
    });
    expect(documents).toHaveLength(1);
    expect(documents[0]?.excerpt).toHaveLength(700);
    expect(JSON.stringify(documents[0]?.metadata)).not.toContain(huge);
    expect(documents[0]?.metadata.attribution).toContain(
      "National Vulnerability Database",
    );
  });

  test("uses the NVD event UUID as an idempotent immutable change key", () => {
    const event = {
      cveChanges: [
        {
          change: {
            cveId: "CVE-2026-12345",
            cveChangeId: "3bb4b592-95fd-4efc-9b93-b5af7b96ad59",
            eventName: "CVE Modified",
            created: "2026-08-02T00:00:00.000",
            details: [{ action: "Changed" }],
          },
        },
      ],
    };
    const [first] = parseNvdChangeHistory(event);
    const [second] = parseNvdChangeHistory(event);
    expect(first?.externalKey).toBe(
      "nvd-change:3bb4b592-95fd-4efc-9b93-b5af7b96ad59",
    );
    expect(second?.externalKey).toBe(first?.externalKey);
    expect(
      parseNvdChangeHistory({
        cveChanges: [
          { change: { cveId: "CVE-2026-12345", cveChangeId: "not-a-uuid" } },
        ],
      }),
    ).toEqual([]);
  });

  test("treats malformed payloads, excessive windows, and response counts safely", () => {
    expect(parseNvdCves({ vulnerabilities: "invalid" })).toEqual([]);
    expect(parseNvdChangeHistory({ cveChanges: "invalid" })).toEqual([]);
    expect(totalResults({ totalResults: -1 })).toBeNull();
    expect(totalResults({})).toBeNull();
    expect(totalResults({ totalResults: 101 })).toBe(101);
  });

  test("replays a current page after a crash or partial document mutation", () => {
    const cursor = {
      windowStart: 10,
      windowEnd: 20,
      startIndex: 100,
      pageSize: 25,
      failureCount: 0,
    };
    const inProgress = nvdInProgressCheckpoint(cursor, 9, 30);
    expect(parseCursor(inProgress.cursor)).toEqual(cursor);
    expect(inProgress.lastSucceededAt).toBe(9);
    expect(inProgress.lastErrorAt).toBe(0);

    const checkpoint = nvdFailureCheckpoint(
      cursor,
      9,
      30,
      "document mutation failed",
    );
    expect(parseCursor(checkpoint.cursor)).toEqual(cursor);
    expect(checkpoint.lastSucceededAt).toBe(9);
    expect(checkpoint.lastErrorAt).toBe(30);

    const finalCheckpoint = nvdSuccessCheckpoint(null, 30);
    expect(finalCheckpoint.cursor).toBe("");
    expect(finalCheckpoint.lastSucceededAt).toBe(30);
  });

  test("validates page metadata before allowing a cursor to advance", () => {
    const cursor = {
      windowStart: 0,
      windowEnd: 1_000,
      startIndex: 0,
      pageSize: 25,
    };
    const next = parseNvdPage("cves", cursor, cvePage(26, 25, 0, 25));
    expect(next.documents).toHaveLength(25);
    expect(parseCursor(next.nextCursor ?? "")).toMatchObject({
      startIndex: 25,
      pageSize: 25,
      failureCount: 0,
    });

    expect(() => parseNvdPage("cves", cursor, cvePage(26, 24, 0, 25))).toThrow(
      "malformed pagination metadata",
    );
    expect(() =>
      parseNvdPage("cves", cursor, {
        totalResults: 1,
        startIndex: 0,
        resultsPerPage: 25,
        vulnerabilities: [],
      }),
    ).toThrow("malformed pagination metadata");
    expect(() =>
      parseNvdPage("cves", cursor, {
        ...cvePage(1),
        resultsPerPage: 26,
      }),
    ).toThrow("malformed pagination metadata");
    expect(() =>
      parseNvdPage("cves", cursor, {
        ...cvePage(1),
        startIndex: 1,
      }),
    ).toThrow("malformed pagination metadata");
  });

  test("returns typed bounded diagnostics and retries malformed pages without advancing", () => {
    const cursor = {
      windowStart: 0,
      windowEnd: 1_000,
      startIndex: 25,
      pageSize: 25,
      failureCount: 0,
    };
    let error: unknown;
    try {
      parseNvdPage("cves", cursor, cvePage(50, 24, 25, 25));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(NvdPaginationError);
    expect((error as NvdPaginationError).diagnostic).toEqual({
      code: "metadata",
      cursorStartIndex: 25,
      totalResults: 50,
      resultsPerPage: 25,
      itemCount: 24,
    });
    expect(nvdRetryCursor(cursor, error as Error, 1_000)).toMatchObject({
      startIndex: 25,
      pageSize: 12,
      failureCount: 1,
    });
  });

  test("accepts only the official empty-window shape and bounded final pages", () => {
    const cursor = {
      windowStart: 0,
      windowEnd: 1_000,
      startIndex: 0,
      pageSize: 25,
    };
    expect(
      parseNvdPage("cves", cursor, {
        totalResults: 0,
        startIndex: 0,
        resultsPerPage: 0,
        vulnerabilities: [],
      }),
    ).toEqual({ documents: [], nextCursor: null });

    const finalPage = parseNvdPage(
      "cves",
      { ...cursor, startIndex: 25 },
      cvePage(42, 17, 25, 17),
    );
    expect(finalPage.documents).toHaveLength(17);
    expect(finalPage.nextCursor).toBeNull();

    expect(() =>
      parseNvdPage("cves", cursor, {
        totalResults: 1,
        startIndex: 0,
        resultsPerPage: 0,
        vulnerabilities: [],
      }),
    ).toThrow("incomplete pagination page");
    expect(() =>
      parseNvdPage(
        "cves",
        { ...cursor, startIndex: 1 },
        {
          totalResults: 0,
          startIndex: 1,
          resultsPerPage: 0,
          vulnerabilities: [],
        },
      ),
    ).toThrow("malformed pagination metadata");
  });

  test("does not discard malformed records while completing a page", () => {
    const cursor = {
      windowStart: 0,
      windowEnd: 1_000,
      startIndex: 0,
      pageSize: 25,
    };
    expect(() =>
      parseNvdPage("cves", cursor, {
        totalResults: 1,
        startIndex: 0,
        resultsPerPage: 1,
        vulnerabilities: [{ cve: { id: "not-a-cve" } }],
      }),
    ).toThrow("invalid document in a pagination page");
  });

  test("replays dependent mutations after an interrupted version write", () => {
    const firstAttempt = nvdPostVersionWork("cves", false);
    const replay = nvdPostVersionWork("cves", true);
    expect(firstAttempt).toMatchObject({
      writeCveClaim: true,
      enqueueDocumentEvent: true,
    });
    expect(replay).toMatchObject({
      writeCveClaim: true,
      enqueueDocumentEvent: true,
      replayingCommittedVersion: true,
    });
    expect(nvdPostVersionWork("history", true).writeCveClaim).toBe(false);
  });

  test("uses bounded Retry-After backoff and retains terms attribution", () => {
    expect(retryAfterMs("2", 0)).toBe(2_000);
    expect(retryAfterMs("invalid", 0)).toBe(60_000);
    expect(
      retryAfterMs(new Date(9_999_999_999).toUTCString(), 0),
    ).toBeLessThanOrEqual(60 * 60 * 1_000);
    expect(NVD_TERMS_URL).toBe("https://nvd.nist.gov/general/terms-of-use");
  });

  test("shrinks expensive pages and exponentially backs off repeated failures", () => {
    const cursor = {
      windowStart: 0,
      windowEnd: 1_000,
      startIndex: 0,
      pageSize: 25,
      failureCount: 0,
    };
    const first = nvdRetryCursor(
      cursor,
      { name: "NvdResponseTooLargeError" },
      1_000,
    );
    expect(first).toMatchObject({
      pageSize: 12,
      failureCount: 1,
      retryNotBefore: 1_000 + 10 * 60 * 1_000,
    });
    const second = nvdRetryCursor(
      first,
      { name: "NvdRequestTimeoutError" },
      first.retryNotBefore!,
    );
    expect(second.pageSize).toBe(6);
    expect(second.failureCount).toBe(2);
    expect(second.retryNotBefore! - first.retryNotBefore!).toBe(
      20 * 60 * 1_000,
    );
    const serviceFailure = nvdRetryCursor(
      cursor,
      { name: "Error", retryAfter: 30 * 60 * 1_000 },
      1_000,
    );
    expect(serviceFailure.pageSize).toBe(25);
    expect(serviceFailure.retryNotBefore).toBe(1_000 + 30 * 60 * 1_000);
  });

  test("rejects oversized NVD bodies before buffering beyond the limit", async () => {
    const oversized = new Response("x", {
      headers: { "content-length": String(2 * 1024 * 1024 + 1) },
    });
    await expect(readBoundedNvdResponse(oversized)).rejects.toMatchObject({
      name: "NvdResponseTooLargeError",
    });

    const chunk = new Uint8Array(1024 * 1024 + 1);
    const streamed = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.close();
        },
      }),
    );
    await expect(readBoundedNvdResponse(streamed)).rejects.toMatchObject({
      name: "NvdResponseTooLargeError",
    });
  });
});
