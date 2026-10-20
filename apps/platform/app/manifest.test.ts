// @vitest-environment node
import { expect, test } from "vitest";
import manifest from "./manifest";

test("the installable app uses explicit Signal Moth PNG icon sizes", () => {
  expect(manifest().icons).toEqual([
    {
      src: "/images/brand/symforum-icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/images/brand/symforum-icon-512.png",
      sizes: "512x512",
      type: "image/png",
    },
  ]);
});

test.each([
  "https://forum.symbaiex.com",
  "https://www.symbaiex.com",
  "https://symbaiex.com",
  "https://preview.vercel.app",
  "http://localhost:3000",
])("the shared manifest launches within its serving origin: %s", (origin) => {
  const result = manifest();
  const manifestUrl = new URL("/manifest.webmanifest", origin);
  const start = new URL(result.start_url!, manifestUrl);
  const scope = new URL(result.scope!, manifestUrl);

  expect(result.start_url).toBe("/");
  expect(start.origin).toBe(origin);
  expect(start.pathname).toBe("/");
  expect(scope.origin).toBe(origin);
  expect(start.pathname.startsWith(scope.pathname)).toBe(true);
  for (const icon of result.icons ?? []) {
    expect(new URL(icon.src, manifestUrl).origin).toBe(origin);
  }
});
