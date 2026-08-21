import { describe, expect, test } from "vitest";

import {
  directoryCacheSeconds,
  MAXIMUM_KEY_OVERLAP_MS,
  resolveDirectoryKeys,
} from "./web-bot-auth-directory";

const NOW = 1_800_000_000_000;
const CURRENT_X = "7mLQPiMq2EO4p1pl7rpy8eR2HShaUL8KDWFUwNbOrXY";
const RETIRING_X = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function key(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kty: "OKP",
    crv: "Ed25519",
    x: CURRENT_X,
    kid: "current-thumbprint",
    notBefore: NOW - 60_000,
    notAfter: NOW + 60_000,
    ...overrides,
  };
}

function config(current = key(), retiring?: Record<string, unknown>): string {
  return JSON.stringify({ current, ...(retiring === undefined ? {} : { retiring }) });
}

describe("Web Bot Auth directory keysets", () => {
  test("accepts one valid current public key", () => {
    const result = resolveDirectoryKeys(config(), NOW);

    expect(result).toMatchObject({
      current: { kty: "OKP", crv: "Ed25519", x: CURRENT_X },
      nearestExpiry: NOW + 60_000,
    });
    expect(result?.retiring).toBeUndefined();
  });

  test("publishes one active retiring key during a bounded overlap", () => {
    const result = resolveDirectoryKeys(
      config(
        key({ notAfter: NOW + 120_000 }),
        key({ x: RETIRING_X, kid: "retiring-thumbprint", notBefore: NOW - 60_000 }),
      ),
      NOW,
    );

    expect(result?.retiring).toEqual({
      kty: "OKP",
      crv: "Ed25519",
      x: RETIRING_X,
      kid: "retiring-thumbprint",
      nbf: Math.floor((NOW - 60_000) / 1_000),
      exp: Math.floor((NOW + 60_000) / 1_000),
    });
  });

  test("omits an expired retiring key", () => {
    const result = resolveDirectoryKeys(
      config(
        key({ notBefore: NOW - 180_000, notAfter: NOW + 60_000 }),
        key({
          x: RETIRING_X,
          kid: "retiring-thumbprint",
          notBefore: NOW - 120_000,
          notAfter: NOW - 60_000,
        }),
      ),
      NOW,
    );

    expect(result?.retiring).toBeUndefined();
    expect(result?.nearestExpiry).toBe(NOW + 60_000);
  });

  test("rejects duplicate key ids, private material, malformed values, and oversized config", () => {
    expect(
      resolveDirectoryKeys(config(key(), key({ x: RETIRING_X })), NOW),
    ).toBeNull();
    expect(resolveDirectoryKeys(config(key({ d: "private-material" })), NOW)).toBeNull();
    expect(resolveDirectoryKeys("{", NOW)).toBeNull();
    expect(resolveDirectoryKeys("x".repeat(8_193), NOW)).toBeNull();
  });

  test("rejects overlap windows beyond the operator limit", () => {
    expect(
      resolveDirectoryKeys(
        config(
          key({ notBefore: NOW, notAfter: NOW + MAXIMUM_KEY_OVERLAP_MS + 1 }),
          key({
            x: RETIRING_X,
            kid: "retiring-thumbprint",
            notBefore: NOW,
            notAfter: NOW + MAXIMUM_KEY_OVERLAP_MS + 1,
          }),
        ),
        NOW,
      ),
    ).toBeNull();
  });

  test("bounds cache lifetime by the nearest key expiry", () => {
    expect(directoryCacheSeconds(NOW + 12_345, NOW)).toBe(12);
    expect(directoryCacheSeconds(NOW + 30 * 60 * 60 * 1_000, NOW)).toBe(86_400);
  });
});
