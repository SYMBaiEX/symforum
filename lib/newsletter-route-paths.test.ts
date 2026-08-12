import { describe, expect, test } from "vitest";

import { isStorageRestrictedNewsletterPath } from "./newsletter-route-paths";

describe("storage-restricted newsletter paths", () => {
  test.each([
    "/newsletter/confirm",
    "/newsletter/preferences",
    "/newsletter/unsubscribe",
  ])("matches %s", (pathname) => {
    expect(isStorageRestrictedNewsletterPath(pathname)).toBe(true);
  });

  test.each([null, "/newsletter", "/newsletter/example", "/signin"])(
    "does not match %s",
    (pathname) => {
      expect(isStorageRestrictedNewsletterPath(pathname)).toBe(false);
    },
  );
});
