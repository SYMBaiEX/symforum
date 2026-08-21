import { describe, expect, test, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PublisherError, redactSecrets, runPublisher, validateDocument } from "./symbaiex-blog-publisher.mjs";

const valid = { slug: "secure-publishing", title: "Secure publishing", excerpt: "A safe post.", body: "# Safe\n\nA complete body.", tags: ["security"], status: "draft", publishedAt: "2026-08-21T12:00:00.000Z", readingMinutes: 2, featured: false };
const published = { ...valid, status: "published" };

async function input(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "symbaiex-blog-publisher-"));
  const path = join(directory, "post.json");
  await writeFile(path, JSON.stringify({ ...valid, ...overrides }));
  return path;
}
async function imageInput(bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])) {
  const directory = await mkdtemp(join(tmpdir(), "symbaiex-blog-image-"));
  const path = join(directory, "cover.png");
  await writeFile(path, bytes);
  return { path, bytes };
}
function response(status: number, body: unknown) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
function env(): NodeJS.ProcessEnv { return { NODE_ENV: "test", SYMBAIEX_ADMIN_TOKEN: "test-token", SYMBAIEX_BLOG_API_BASE_URL: "http://localhost:3000/api/admin/posts" }; }
function emptyEnv(): NodeJS.ProcessEnv { return { NODE_ENV: "test" }; }

describe("symbaiex blog publisher", () => {
  test("dry run performs no fetch", async () => {
    const fetchImpl = vi.fn();
    const result = await runPublisher({ args: ["--input", await input()], fetchImpl, env: emptyEnv() });
    expect(result).toMatchObject({ action: "dry-run", status: "draft", summary: { title: valid.title } });
    expect(JSON.stringify(result)).not.toContain(valid.body);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  test("apply requires a token", async () => {
    await expect(runPublisher({ args: ["--input", await input(), "--apply-published"], env: emptyEnv(), platform: "linux" })).rejects.toThrow("admin token is unavailable");
  });
  test("rejects draft mutations before resolving credentials or making a request", async () => {
    const fetchImpl = vi.fn();
    const tokenResolver = vi.fn();
    await expect(runPublisher({ args: ["--input", await input(), "--apply-draft"], env: env(), fetchImpl, tokenResolver })).rejects.toThrow("draft publishing is disabled for symbaiex.com; use --apply-published");
    expect(tokenResolver).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  test("creates after a 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(404, {})).mockResolvedValueOnce(response(201, { post: published }));
    await expect(runPublisher({ args: ["--input", await input(), "--apply-published"], env: env(), fetchImpl })).resolves.toMatchObject({ action: "create", status: 201 });
    expect(fetchImpl.mock.calls.map((call) => call[1].method)).toEqual(["GET", "POST"]);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).status).toBe("published");
  });
  test("uploads a local cover through the admin image API before creating the post", async () => {
    const image = await imageInput();
    const storedUrl = "https://example.convex.cloud/api/storage/cover-1";
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(404, {}))
      .mockResolvedValueOnce(response(200, { url: storedUrl }))
      .mockResolvedValueOnce(response(201, { post: { ...published, imageUrl: storedUrl } }));
    const result = await runPublisher({ args: ["--input", await input(), "--image", image.path, "--apply-published"], env: env(), fetchImpl });
    expect(result).toMatchObject({ action: "create", imageAction: "uploaded" });
    expect(fetchImpl.mock.calls.map((call) => [call[0], call[1].method])).toEqual([
      ["http://localhost:3000/api/admin/posts/secure-publishing", "GET"],
      ["http://localhost:3000/api/admin/upload", "POST"],
      ["http://localhost:3000/api/admin/posts", "POST"],
    ]);
    expect(fetchImpl.mock.calls[1][1].headers["Content-Type"]).toBe("image/png");
    expect(Buffer.from(fetchImpl.mock.calls[1][1].body)).toEqual(image.bytes);
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body).imageUrl).toBe(storedUrl);
  });
  test("reuses an identical Convex cover without another upload", async () => {
    const image = await imageInput();
    const storedUrl = "https://example.convex.cloud/api/storage/cover-1";
    const digest = createHash("sha256").update(image.bytes).digest("base64");
    const existing = { ...published, imageUrl: storedUrl };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, { post: existing }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { "Content-Type": "image/png", Digest: `sha-256=${digest}` } }));
    const result = await runPublisher({ args: ["--input", await input(), "--image", image.path, "--apply-published"], env: env(), fetchImpl });
    expect(result).toMatchObject({ action: "noop", imageAction: "reused" });
    expect(fetchImpl.mock.calls.map((call) => call[1].method)).toEqual(["GET", "HEAD"]);
  });
  test("rejects unsupported local cover bytes before a network request", async () => {
    const image = await imageInput(Buffer.from("not an image"));
    const fetchImpl = vi.fn();
    await expect(runPublisher({ args: ["--input", await input(), "--image", image.path, "--apply-published"], env: env(), fetchImpl })).rejects.toThrow("PNG, JPEG, GIF, or WebP");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  test("uses redirect rejection on every request", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(404, {})).mockResolvedValueOnce(response(201, { post: published }));
    await runPublisher({ args: ["--input", await input(), "--apply-published"], env: env(), fetchImpl });
    expect(fetchImpl.mock.calls.map((call) => call[1].redirect)).toEqual(["error", "error"]);
  });
  test("passes the fixed timeout signal to requests", async () => {
    const controller = new AbortController();
    controller.abort();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetchImpl = vi.fn(async (_url, init) => {
      if (init.signal.aborted) throw new Error("timed out");
      return response(500, {});
    });
    await expect(runPublisher({ args: ["--input", await input(), "--apply-published"], env: env(), fetchImpl })).rejects.toThrow("API GET request failed");
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(fetchImpl.mock.calls[0][1].signal).toBe(controller.signal);
    timeout.mockRestore();
  });
  test("does nothing when a numeric API timestamp normalizes to the input", async () => {
    const normalized = { ...published, publishedAt: Date.parse(valid.publishedAt) };
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { post: normalized }));
    await expect(runPublisher({ args: ["--input", await input(), "--apply-published"], env: env(), fetchImpl })).resolves.toMatchObject({ action: "noop" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  test("does nothing when an ISO API timestamp normalizes to the input", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { post: published }));
    await expect(runPublisher({ args: ["--input", await input(), "--apply-published"], env: env(), fetchImpl })).resolves.toMatchObject({ action: "noop" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  test("treats server-normalized tag casing as a no-op", async () => {
    const mixedCase = { ...published, tags: ["AI Systems", "X"] };
    const normalized = { ...mixedCase, tags: ["ai systems", "x"], publishedAt: Date.parse(valid.publishedAt) };
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { post: normalized }));
    await expect(runPublisher({ args: ["--input", await input(mixedCase), "--apply-published"], env: env(), fetchImpl })).resolves.toMatchObject({ action: "noop" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  test("fails closed when the API returns an invalid timestamp", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { post: { ...published, publishedAt: "sometime tomorrow" } }));
    await expect(runPublisher({ args: ["--input", await input(), "--apply-published"], env: env(), fetchImpl })).rejects.toThrow("publishedAt must be an integer epoch milliseconds value or a strict ISO-8601 timestamp");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  test("refuses a mismatch without update", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { post: { ...published, title: "Different", publishedAt: Date.parse(valid.publishedAt) } }));
    await expect(runPublisher({ args: ["--input", await input(), "--apply-published"], env: env(), fetchImpl })).rejects.toThrow("--update");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  test("patches a mismatch with update", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(200, { post: { ...published, title: "Different", publishedAt: Date.parse(valid.publishedAt) } })).mockResolvedValueOnce(response(200, { post: published }));
    await expect(runPublisher({ args: ["--input", await input(), "--apply-published", "--update"], env: env(), fetchImpl })).resolves.toMatchObject({ action: "update" });
    expect(fetchImpl.mock.calls.map((call) => call[1].method)).toEqual(["GET", "PATCH"]);
  });
  test("every mutation forces published status even when the document says draft", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(404, {})).mockResolvedValueOnce(response(201, { post: published }));
    const result = await runPublisher({ args: ["--input", await input({ status: "draft" }), "--apply-published"], env: env(), fetchImpl });
    expect(result.action).toBe("create");
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).status).toBe("published");
  });
  test("redacts bearer and token values", () => {
    const redacted = redactSecrets("Authorization: Bearer abc-secret SYMBAIEX_ADMIN_TOKEN=xyz https://example.test?token=query-secret");
    expect(redacted).not.toContain("abc-secret");
    expect(redacted).not.toContain("xyz");
    expect(redacted).not.toContain("query-secret");
  });
  test("rejects invalid URL slug body and timestamps", () => {
    expect(() => validateDocument({ ...valid, slug: "Bad_slug" })).toThrow(PublisherError);
    expect(() => validateDocument({ ...valid, imageUrl: "http://example.test/image.png" })).toThrow(PublisherError);
    expect(() => validateDocument({ ...valid, body: "  " })).toThrow(PublisherError);
    expect(() => validateDocument({ ...valid, publishedAt: "next Tuesday afternoon" })).toThrow(PublisherError);
    expect(() => validateDocument({ ...valid, publishedAt: 1_724_243_200_000.5 })).toThrow(PublisherError);
  });
  test("does not retry a failed mutation", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(404, {})).mockResolvedValueOnce(response(500, {}));
    await expect(runPublisher({ args: ["--input", await input(), "--apply-published"], env: env(), fetchImpl })).rejects.toThrow("API POST failed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
