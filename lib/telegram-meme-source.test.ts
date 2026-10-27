// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { readMemeSource } from "./telegram-meme-source";
import { memegenUrl } from "./telegram-meme-library";
afterEach(() => vi.unstubAllGlobals());
test("public source fetch blocks arbitrary hosts, credentials, ports and redirects", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  for (const url of [
    "http://api.memegen.link/templates/",
    "https://evil.example/",
    "https://api.memegen.link.evil.example/",
    "https://x:y@api.memegen.link/templates/",
    "https://api.memegen.link:8443/templates/",
  ])
    await expect(readMemeSource(url)).rejects.toThrow(
      "unapproved_media_source",
    );
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValue(new Response("valid"));
  await expect(
    readMemeSource("https://api.imgflip.com/get_memes"),
  ).resolves.toHaveLength(5);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error" });
});
test("oversized headers or chunked bodies are stopped before unbounded buffering", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("hello", { headers: { "content-length": "500" } }),
    ),
  );
  await expect(
    readMemeSource("https://api.memegen.link/templates/", 4),
  ).rejects.toThrow("media_too_large");
  const cancel = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(3));
              c.enqueue(new Uint8Array(3));
            },
            cancel,
          }),
        ),
    ),
  );
  await expect(
    readMemeSource("https://api.memegen.link/templates/", 4),
  ).rejects.toThrow("media_too_large");
  expect(cancel).toHaveBeenCalledOnce();
});
test("provider outages fail locally and meme URLs contain only encoded captions", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("unavailable", { status: 503 })),
  );
  await expect(
    readMemeSource("https://api.memegen.link/templates/"),
  ).rejects.toThrow("media_http_503");
  const url = new URL(memegenUrl("bongo", "a/b ?#", "no redirects", true));
  expect(url.hostname).toBe("api.memegen.link");
  expect(url.searchParams.get("style")).toBe("animated");
  expect(url.hash).toBe("");
  expect(() => memegenUrl("../evil", "x", "y")).toThrow();
});
