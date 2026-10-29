import { expect, test } from "vitest";
import {
  identityHandleBase,
  identityHandleCandidate,
} from "./identity-handles";

test("Telegram defaults to its verified username and wallets to an address block", () => {
  expect(
    identityHandleBase("telegram", "123", "abc123def456", "@SYMBiEX"),
  ).toBe("symbiex");
  expect(
    identityHandleBase(
      "solana",
      "7xKp9abbbbbbbbbbbbbbbbbbbbbbbbbbbR3mQ",
      "abc123def456",
    ),
  ).toBe("7xkp9a-r3mq");
});
test("missing or invalid Telegram usernames do not expose the Telegram subject", () => {
  for (const name of [
    undefined,
    "",
    "a",
    "_invalid",
    "bad/name",
    "a".repeat(33),
  ]) {
    expect(
      identityHandleBase("telegram", "123456789", "abc123def456", name),
    ).toBe("telegram-abc123def4");
  }
});
test("collision fallbacks remain bounded valid editable handles", () => {
  const base = "x".repeat(32);
  for (let attempt = 0; attempt < 5; attempt++) {
    const handle = identityHandleCandidate(base, "abc123def456", attempt);
    expect(handle).toMatch(/^[a-z0-9][a-z0-9_-]{2,31}$/);
    expect(handle.length).toBeLessThanOrEqual(32);
  }
});
