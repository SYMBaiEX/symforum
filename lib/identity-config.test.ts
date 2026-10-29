import { expect, test } from "vitest";
import { isRecoveryEmail, safeIdentityReturnTo } from "./identity-config";
import { publicIdentityKeys } from "./identity-jwks";
test("only local relative return destinations are accepted", () => {
  expect(safeIdentityReturnTo("/account/connections?tab=wallet")).toBe(
    "/account/connections?tab=wallet",
  );
  for (const bad of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\n/evil.example",
    "javascript:alert(1)",
  ])
    expect(safeIdentityReturnTo(bad)).toBe("/");
});
test("internal identity email aliases are never recovery destinations", () => {
  expect(isRecoveryEmail("human@example.com")).toBe(true);
  for (const bad of [
    "key@solana.symbaiex.invalid",
    "name@users.symbaiex.local",
    "bad",
    "a\n@example.com",
  ])
    expect(isRecoveryEmail(bad)).toBe(false);
});
test("combined JWKS projects public fields only and rejects key ID collisions", () => {
  const key = {
    kty: "RSA",
    kid: "one",
    n: "modulus",
    e: "AQAB",
    d: "private",
    p: "private",
    q: "private",
  };
  const result = publicIdentityKeys(
    { keys: [key] },
    { keys: [{ ...key, kid: "two" }] },
  );
  expect(result.keys).toHaveLength(2);
  expect(JSON.stringify(result)).not.toContain("private");
  expect(() =>
    publicIdentityKeys({ keys: [key] }, { keys: [{ ...key, n: "different" }] }),
  ).toThrow(/Conflicting/);
});
