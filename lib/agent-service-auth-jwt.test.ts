// @vitest-environment node
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  serviceAuthKeys,
  signServiceJwt,
  verifyServiceJwt,
} from "./agent-service-auth-jwt";
import {
  SERVICE_AUTH_ISSUER,
  SERVICE_AUTH_RESOURCE,
  SERVICE_AUTH_TOKEN_KIND,
} from "./agent-service-auth-config";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateJwk = {
  ...pair.privateKey.export({ format: "jwk" }),
  kid: "test-key",
};
const publicJwk = {
  ...pair.publicKey.export({ format: "jwk" }),
  kid: "test-key",
  alg: "RS256",
  use: "sig",
};
const config = {
  AGENT_SERVICE_AUTH_PRIVATE_JWK: JSON.stringify(privateJwk),
  AGENT_SERVICE_AUTH_PUBLIC_JWKS: JSON.stringify({ keys: [publicJwk] }),
};
const keys = serviceAuthKeys(config);
const now = 1_000_000;
const claims = {
  registrationId: "registration",
  jti: "random-token-id",
  issuedAt: now,
  expiresAt: now + 60_000,
};
function changedToken(
  headerPatch: Record<string, unknown>,
  payloadPatch: Record<string, unknown>,
) {
  const original = signServiceJwt(keys, claims, "assertion").split(".");
  const header = {
    ...JSON.parse(Buffer.from(original[0], "base64url").toString()),
    ...headerPatch,
  };
  const payload = {
    ...JSON.parse(Buffer.from(original[1], "base64url").toString()),
    ...payloadPatch,
  };
  const input = [header, payload]
    .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
    .join(".");
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), createPrivateKey({ key: privateJwk, format: "jwk" })).toString("base64url")}`;
}
describe("dedicated service JWT cryptographic boundary", () => {
  test("assertion and access token have distinct type and audience and reusable assertions", () => {
    const assertion = signServiceJwt(keys, claims, "assertion");
    const access = signServiceJwt(keys, claims, "access");
    expect(verifyServiceJwt(keys, assertion, "assertion", now)).toMatchObject({
      registrationId: "registration",
    });
    expect(
      verifyServiceJwt(keys, assertion, "assertion", now + 1),
    ).toMatchObject({ registrationId: "registration" });
    expect(verifyServiceJwt(keys, access, "access", now)).toMatchObject({
      jti: claims.jti,
    });
    expect(() => verifyServiceJwt(keys, assertion, "access", now)).toThrow();
    expect(() => verifyServiceJwt(keys, access, "assertion", now)).toThrow();
  });
  test.each([
    [{ alg: "none" }, {}],
    [{ alg: "HS256" }, {}],
    [{ kid: "unknown" }, {}],
    [{ typ: "JWT" }, {}],
    [{ crit: ["extension"] }, {}],
    [{}, { iss: "https://unique-evening-77.authkit.app" }],
    [{}, { aud: SERVICE_AUTH_RESOURCE }],
    [{}, { aud: [SERVICE_AUTH_ISSUER] }],
    [{}, { scope: "owner evidence" }],
    [{}, { iat: now / 1000 + 61 }],
    [{}, { exp: now / 1000 }],
    [{}, { [SERVICE_AUTH_TOKEN_KIND]: "access" }],
  ])(
    "rejects signed but incorrect JOSE headers or claims %#",
    (header, payload) => {
      expect(() =>
        verifyServiceJwt(keys, changedToken(header, payload), "assertion", now),
      ).toThrow();
    },
  );
  test("rejects tampering, expired and malformed tokens", () => {
    const assertion = signServiceJwt(keys, claims, "assertion");
    const parts = assertion.split(".");
    parts[2] = `${parts[2][0] === "a" ? "b" : "a"}${parts[2].slice(1)}`;
    expect(() =>
      verifyServiceJwt(keys, parts.join("."), "assertion", now),
    ).toThrow();
    expect(() =>
      verifyServiceJwt(keys, assertion, "assertion", now + 60_001),
    ).toThrow();
    expect(() => verifyServiceJwt(keys, "a.b.c", "assertion", now)).toThrow();
  });
  test("never publishes private fields or signs with an unpublished key", () => {
    expect(() =>
      serviceAuthKeys({
        ...config,
        AGENT_SERVICE_AUTH_PUBLIC_JWKS: JSON.stringify({
          keys: [{ ...publicJwk, d: privateJwk.d }],
        }),
      }),
    ).toThrow();
    expect(() =>
      serviceAuthKeys({
        ...config,
        AGENT_SERVICE_AUTH_PUBLIC_JWKS: JSON.stringify({
          keys: [{ ...publicJwk, kid: "other" }],
        }),
      }),
    ).toThrow();
    expect(keys.jwks).toEqual({ keys: [publicJwk] });
  });
});
