import { afterEach, describe, expect, test } from "vitest";

import { GET } from "./route";

const originalPublicJwk = process.env.WEB_BOT_AUTH_PUBLIC_JWK;
const originalPrivateJwk = process.env.WEB_BOT_AUTH_PRIVATE_JWK;

afterEach(() => {
  if (originalPublicJwk === undefined)
    delete process.env.WEB_BOT_AUTH_PUBLIC_JWK;
  else process.env.WEB_BOT_AUTH_PUBLIC_JWK = originalPublicJwk;
  if (originalPrivateJwk === undefined)
    delete process.env.WEB_BOT_AUTH_PRIVATE_JWK;
  else process.env.WEB_BOT_AUTH_PRIVATE_JWK = originalPrivateJwk;
});

describe("Web Bot Auth key directory", () => {
  test("fails closed when no operator key is configured", async () => {
    delete process.env.WEB_BOT_AUTH_PUBLIC_JWK;
    delete process.env.WEB_BOT_AUTH_PRIVATE_JWK;

    const response = await GET(
      new Request(
        "https://www.symbaiex.com/.well-known/http-message-signatures-directory",
      ),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("publishes only the public Ed25519 JWK and signs the directory", async () => {
    process.env.WEB_BOT_AUTH_PUBLIC_JWK = JSON.stringify({
      kty: "OKP",
      crv: "Ed25519",
      x: "JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs",
    });
    process.env.WEB_BOT_AUTH_PRIVATE_JWK = JSON.stringify({
      kty: "OKP",
      crv: "Ed25519",
      x: "JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs",
      d: "n4Ni-HpISpVObnQMW0wOhCKROaIKqKtW_2ZYb2p9KcU",
    });

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

    const body = (await response.json()) as {
      keys: Array<Record<string, unknown>>;
    };
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]).toMatchObject({
      kty: "OKP",
      crv: "Ed25519",
      x: "JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs",
    });
    expect(body.keys[0]).not.toHaveProperty("d");
  });
});
