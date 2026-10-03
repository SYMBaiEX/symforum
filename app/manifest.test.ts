// @vitest-environment node
import { expect, test } from "vitest";
import manifest from "./manifest";

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
