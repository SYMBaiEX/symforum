import { afterEach, describe, expect, test } from "vitest";
import { helpers, jwkToKeyID } from "web-bot-auth";

import { GET } from "./route";

const publicJwk = {
  kty: "OKP" as const,
  crv: "Ed25519" as const,
  x: "7mLQPiMq2EO4p1pl7rpy8eR2HShaUL8KDWFUwNbOrXY",
};
const privateJwk = {
  ...publicJwk,
  d: "i6jtc6padO7vebfTOtMQeXjYxn0WFtBk6cI4hoh4l_E",
};
const originalPublicJwk = process.env.WEB_BOT_AUTH_PUBLIC_JWK;
const originalPrivateJwk = process.env.WEB_BOT_AUTH_PRIVATE_JWK;
const originalKeyset = process.env.WEB_BOT_AUTH_PUBLIC_JWK_SET;

function setEnvironment(keyset?: string) {
  process.env.WEB_BOT_AUTH_PUBLIC_JWK = JSON.stringify(publicJwk);
  process.env.WEB_BOT_AUTH_PRIVATE_JWK = JSON.stringify(privateJwk);
  if (keyset === undefined) delete process.env.WEB_BOT_AUTH_PUBLIC_JWK_SET;
  else process.env.WEB_BOT_AUTH_PUBLIC_JWK_SET = keyset;
}

afterEach(() => {
  if (originalPublicJwk === undefined) delete process.env.WEB_BOT_AUTH_PUBLIC_JWK;
  else process.env.WEB_BOT_AUTH_PUBLIC_JWK = originalPublicJwk;
  if (originalPrivateJwk === undefined) delete process.env.WEB_BOT_AUTH_PRIVATE_JWK;
  else process.env.WEB_BOT_AUTH_PRIVATE_JWK = originalPrivateJwk;
  if (originalKeyset === undefined) delete process.env.WEB_BOT_AUTH_PUBLIC_JWK_SET;
  else process.env.WEB_BOT_AUTH_PUBLIC_JWK_SET = originalKeyset;
});

describe("Web Bot Auth key directory", () => {
  test("fails closed when no operator key is configured", async () => {
    delete process.env.WEB_BOT_AUTH_PUBLIC_JWK;
    delete process.env.WEB_BOT_AUTH_PRIVATE_JWK;
    delete process.env.WEB_BOT_AUTH_PUBLIC_JWK_SET;

    const response = await GET(
      new Request(
        "https://www.symbaiex.com/.well-known/http-message-signatures-directory",
      ),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("continues serving the configured legacy single public key", async () => {
    setEnvironment();

    const response = await GET(
      new Request(
        "https://www.symbaiex.com/.well-known/http-message-signatures-directory",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/http-message-signatures-directory+json",
    );
    expect(response.headers.get("signature")).toMatch(/^binding0=/);
    expect(response.headers.get("signature-input")).toContain(
      'binding0=("@authority";req)',
    );
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=86400, s-maxage=86400",
    );
    const body = (await response.json()) as {
      keys: Array<Record<string, unknown>>;
    };
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]).toMatchObject(publicJwk);
    expect(body.keys[0]).not.toHaveProperty("d");
  });

  test("fails closed for a malformed multi-key configuration", async () => {
    setEnvironment("{");

    const response = await GET(
      new Request(
        "https://www.symbaiex.com/.well-known/http-message-signatures-directory",
      ),
    );

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Web Bot Auth is not configured.\n");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("bounds the directory cache by an active keyset expiry", async () => {
    const kid = await jwkToKeyID(
      publicJwk,
      helpers.WEBCRYPTO_SHA256,
      helpers.BASE64URL_DECODE,
    );
    const now = Date.now();
    setEnvironment(
      JSON.stringify({
        current: {
          ...publicJwk,
          kid,
          notBefore: now - 1_000,
          notAfter: now + 3_000,
        },
      }),
    );

    const response = await GET(
      new Request(
        "https://www.symbaiex.com/.well-known/http-message-signatures-directory",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(
      /^public, max-age=[0-3], s-maxage=[0-3]$/,
    );
  });
});
