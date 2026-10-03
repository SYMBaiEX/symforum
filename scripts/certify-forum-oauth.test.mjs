// @vitest-environment node
import { beforeAll, describe, expect, test, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { createHash } from "node:crypto";
import {
  CLAIMS,
  EVIDENCE_RESOURCE,
  FORUM_RESOURCE,
  CertificationError,
  authorizationUrl,
  certify,
  createConsentListener,
  discover,
  exchangeToken,
  newPkce,
  parseOptions,
  refreshSession,
  registrationBody,
  requestJson,
  safeFailure,
  validateCallback,
  validateDiscovery,
  validateRegistration,
  validateTokens,
  verifyAccessToken,
  verifyForumStatus,
} from "./certify-forum-oauth.mjs";

const ISSUER = "https://unique-evening-77.authkit.app";
const metadata = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oauth2/authorize`,
  token_endpoint: `${ISSUER}/oauth2/token`,
  registration_endpoint: `${ISSUER}/oauth2/register`,
  jwks_uri: `${ISSUER}/oauth2/jwks`,
  grant_types_supported: ["authorization_code", "refresh_token"],
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["S256"],
  scopes_supported: ["openid", "offline_access"],
  token_endpoint_auth_methods_supported: ["none"],
};
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
const owner = "test_owner_123456789";
const grant = "test_forum_grant_123456";
const principal = { subject: owner, grantId: grant };
const forumClaims = {
  [CLAIMS.grant]: grant,
  [CLAIMS.resource]: FORUM_RESOURCE,
  [CLAIMS.kind]: "forum-plugin",
};
const forumStatus = (actor = "human", mode = "direct") => ({
  structuredContent: {
    status: "completed",
    actingAs: {
      userId: actor === "human" ? owner : "actor_123456789",
      isAgent: actor === "agent",
      username: "private-name",
    },
    data: {
      connectionId: grant,
      policyVersion: 1,
      executionMode: mode,
      capabilities: ["read"],
    },
  },
});
let keys;
beforeAll(async () => {
  keys = await generateKeyPair("RS256");
});
const sign = async (claims = forumClaims, aud = FORUM_RESOURCE, sub = owner) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(ISSUER)
    .setAudience(aud)
    .setSubject(sub)
    .setExpirationTime("5m")
    .sign(keys.privateKey);

describe("memory-only forum WorkOS certification", () => {
  test("defaults to a zero-network plan and rejects credential arguments", async () => {
    const fetchImpl = vi.fn();
    const summary = await certify(parseOptions([]), {
      fetchImpl,
      output: vi.fn(),
    });
    expect(summary).toMatchObject({
      mode: "plan",
      checks: [],
      hostVerification: "not_tested",
      forumWrites: "not_tested",
      reverseBoundary: "not_tested",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    for (const flag of [
      "--token",
      "--client-secret",
      "--session",
      "--output",
      "--unknown",
    ])
      expect(() => parseOptions([flag, "secret"])).toThrow(CertificationError);
  });
  test("requires opt-in before consent/revocation, pins origins and rejects ambiguous options", () => {
    for (const args of [
      ["--with-evidence"],
      ["--check-revocation"],
      ["--run", "--discover-only"],
      ["--run", "--run"],
      ["--issuer", "https://evil.example"],
      ["--origin", "https://forum.symbaiex.com"],
      ["--expect-actor", "staff"],
      ["--issuer", "--run"],
    ])
      expect(() => parseOptions(args)).toThrow(CertificationError);
  });
  test("public discovery is GET-only and checks both resource boundaries", async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      expect(options.method).toBeUndefined();
      expect(options.redirect).toBe("error");
      expect(options.credentials).toBe("omit");
      if (url.includes("oauth-authorization-server")) return json(metadata);
      return json({
        resource: url.endsWith("/api/plugin/mcp")
          ? FORUM_RESOURCE
          : EVIDENCE_RESOURCE,
        authorization_servers: [ISSUER],
      });
    });
    expect(
      await discover(parseOptions(["--discover-only"]), fetchImpl),
    ).toEqual(metadata);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  test("rejects provider endpoints outside exact issuer-owned paths", () => {
    expect(validateDiscovery(metadata, ISSUER)).toEqual(metadata);
    for (const endpoint of [
      "https://evil.example/oauth2/token",
      `${ISSUER}/oauth2/token?secret`,
      `https://secret@unique-evening-77.authkit.app/oauth2/token`,
    ])
      expect(() =>
        validateDiscovery({ ...metadata, token_endpoint: endpoint }, ISSUER),
      ).toThrow(CertificationError);
  });
  test("S256 authorization explicitly binds resource, state, callback and scope without verifier", () => {
    const pkce = newPkce();
    expect(pkce.verifier).toMatch(/^[a-zA-Z0-9_-]{43}$/);
    expect(pkce.challenge).toBe(
      createHash("sha256").update(pkce.verifier).digest("base64url"),
    );
    const callback = "http://127.0.0.1:42123/callback";
    const url = new URL(
      authorizationUrl(metadata, "client_test", callback, FORUM_RESOURCE, pkce),
    );
    expect(url.searchParams.get("resource")).toBe(FORUM_RESOURCE);
    expect(url.searchParams.get("scope")).toBe("openid offline_access");
    expect(url.searchParams.get("state")).toBe(pkce.state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.toString()).not.toContain(pkce.verifier);
    expect(url.searchParams.has("client_secret")).toBe(false);
  });
  test("DCR is a public client and requires exact loopback callback and none response", () => {
    const callback = "http://127.0.0.1:42123/callback";
    expect(registrationBody(callback, "forum")).toMatchObject({
      application_type: "native",
      token_endpoint_auth_method: "none",
      redirect_uris: [callback],
      grant_types: ["authorization_code", "refresh_token"],
    });
    expect(
      validateRegistration(
        {
          client_id: "client_123",
          token_endpoint_auth_method: "none",
          redirect_uris: [callback],
        },
        callback,
      ),
    ).toEqual({ clientId: "client_123" });
    for (const bad of [
      "http://localhost:42123/callback",
      "https://evil.example/callback",
      `${callback}?code=secret`,
    ])
      expect(() => registrationBody(bad, "forum")).toThrow(CertificationError);
    for (const extra of [
      { client_secret: "secret" },
      { token_endpoint_auth_method: "client_secret_post" },
      { redirect_uris: ["https://evil.example"] },
    ])
      expect(() =>
        validateRegistration(
          {
            client_id: "client_123",
            token_endpoint_auth_method: "none",
            redirect_uris: [callback],
            ...extra,
          },
          callback,
        ),
      ).toThrow(CertificationError);
  });
  test("bad/duplicate state, code and callback origin are rejected without echoing code", () => {
    const callback = "http://127.0.0.1:42123/callback";
    expect(
      validateCallback(
        "/callback?state=expected&code=secret",
        callback,
        "expected",
      ),
    ).toBe("secret");
    for (const bad of [
      "/callback?state=bad&code=secret",
      "/callback?state=expected&state=bad&code=secret",
      "/callback?state=expected&code=secret&code=secret2",
      "http://evil.example/callback?state=expected&code=secret",
      "/wrong?state=expected&code=secret",
    ])
      expect(() => validateCallback(bad, callback, "expected")).toThrow(
        CertificationError,
      );
    expect(() =>
      validateCallback(
        "/callback?state=expected&error=secret_provider_error",
        callback,
        "expected",
      ),
    ).toThrow(CertificationError);
  });
  test("real loopback listener ignores bad callbacks, consumes one code and rejects retries", async () => {
    const listener = await createConsentListener("state", 2000);
    try {
      expect(
        (await fetch(`${listener.callbackUri}?state=wrong&code=secret`)).status,
      ).toBe(400);
      const response = await fetch(
        `${listener.callbackUri}?state=state&code=secret`,
      );
      expect(response.status).toBe(200);
      expect(await listener.wait()).toBe("secret");
      expect(await response.text()).not.toContain("secret");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(
        (await fetch(`${listener.callbackUri}?state=state&code=secret`)).status,
      ).toBe(409);
    } finally {
      await listener.close();
    }
  });
  test("loopback consent times out and closes without credentials", async () => {
    const listener = await createConsentListener("state", 20);
    try {
      await expect(listener.wait()).rejects.toMatchObject({
        code: "CONSENT_TIMEOUT",
      });
    } finally {
      await listener.close();
    }
  });
  test("actually verifies RS256 signature and resource-bound scalar forum grant", async () => {
    expect(
      await verifyAccessToken(
        await sign(),
        metadata,
        FORUM_RESOURCE,
        { subject: owner },
        keys.publicKey,
      ),
    ).toEqual(principal);
    await expect(
      verifyAccessToken(
        await sign(),
        metadata,
        FORUM_RESOURCE,
        {},
        (await generateKeyPair("RS256")).publicKey,
      ),
    ).rejects.toMatchObject({ code: "JWT_VERIFICATION_FAILED" });
    for (const aud of [EVIDENCE_RESOURCE, [FORUM_RESOURCE, EVIDENCE_RESOURCE]])
      await expect(
        verifyAccessToken(
          await sign(forumClaims, aud),
          metadata,
          FORUM_RESOURCE,
          {},
          keys.publicKey,
        ),
      ).rejects.toBeInstanceOf(CertificationError);
  });
  test("rejects expired JWTs and wrong issuers before accepting a principal", async () => {
    for (const token of [
      await new SignJWT(forumClaims)
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(ISSUER)
        .setAudience(FORUM_RESOURCE)
        .setSubject(owner)
        .setExpirationTime("-1s")
        .sign(keys.privateKey),
      await new SignJWT(forumClaims)
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer("https://wrong.authkit.app")
        .setAudience(FORUM_RESOURCE)
        .setSubject(owner)
        .setExpirationTime("5m")
        .sign(keys.privateKey),
    ])
      await expect(
        verifyAccessToken(token, metadata, FORUM_RESOURCE, {}, keys.publicKey),
      ).rejects.toMatchObject({ code: "JWT_VERIFICATION_FAILED" });
  });
  test("code exchange keeps the code/verifier in a form POST and discards ID tokens", async () => {
    const result = await exchangeToken(
      metadata,
      {
        grant_type: "authorization_code",
        client_id: "public_client",
        code: "private_code",
        code_verifier: "private_verifier",
        redirect_uri: "http://127.0.0.1:42123/callback",
        resource: FORUM_RESOURCE,
      },
      async (url, options) => {
        expect(url).toBe(metadata.token_endpoint);
        expect(url).not.toContain("private_code");
        expect(options.method).toBe("POST");
        expect(options.headers["Content-Type"]).toBe(
          "application/x-www-form-urlencoded",
        );
        expect(new URLSearchParams(options.body).get("code_verifier")).toBe(
          "private_verifier",
        );
        return json({
          token_type: "bearer",
          access_token: "a",
          refresh_token: "r",
          expires_in: 3600,
          id_token: "must_discard",
        });
      },
    );
    expect(result).toEqual({ accessToken: "a", refreshToken: "r" });
  });
  test("rejects missing/mixed/array claims and changed owner or grant on refresh", async () => {
    for (const claims of [
      {},
      { ...forumClaims, [CLAIMS.evidence]: "legacy" },
      { ...forumClaims, [CLAIMS.grant]: [grant] },
      { ...forumClaims, [CLAIMS.kind]: "agent" },
      { ...forumClaims, [CLAIMS.resource]: EVIDENCE_RESOURCE },
    ])
      await expect(
        verifyAccessToken(
          await sign(claims),
          metadata,
          FORUM_RESOURCE,
          {},
          keys.publicKey,
        ),
      ).rejects.toBeInstanceOf(CertificationError);
    await expect(
      verifyAccessToken(
        await sign(forumClaims, FORUM_RESOURCE, "different_owner"),
        metadata,
        FORUM_RESOURCE,
        principal,
        keys.publicKey,
      ),
    ).rejects.toMatchObject({ code: "JWT_SUBJECT_CHANGED" });
    await expect(
      verifyAccessToken(
        await sign({ ...forumClaims, [CLAIMS.grant]: "different_grant" }),
        metadata,
        FORUM_RESOURCE,
        principal,
        keys.publicKey,
      ),
    ).rejects.toMatchObject({ code: "JWT_GRANT_CHANGED" });
  });
  test("evidence proof requires a real independently signed evidence grant", async () => {
    expect(
      await verifyAccessToken(
        await sign({ [CLAIMS.evidence]: "evidence_grant" }, EVIDENCE_RESOURCE),
        metadata,
        EVIDENCE_RESOURCE,
        {},
        keys.publicKey,
      ),
    ).toEqual({ subject: owner, grantId: "evidence_grant" });
    await expect(
      verifyAccessToken(
        await sign(
          { ...forumClaims, [CLAIMS.evidence]: "evidence_grant" },
          EVIDENCE_RESOURCE,
        ),
        metadata,
        EVIDENCE_RESOURCE,
        {},
        keys.publicKey,
      ),
    ).rejects.toMatchObject({ code: "JWT_EVIDENCE_CLAIMS_MISMATCH" });
  });
  test("refresh uses latest token without client secret and keeps replacement only in memory", async () => {
    const fetchImpl = vi.fn(async (_url, options) => {
      const body = new URLSearchParams(options.body);
      expect(body.get("refresh_token")).toBe("latest_refresh_secret");
      expect(body.get("resource")).toBe(FORUM_RESOURCE);
      expect(body.get("client_secret")).toBeNull();
      expect(body.get("scope")).toBeNull();
      return json({
        token_type: "Bearer",
        access_token: "new_access",
        refresh_token: "new_refresh",
        expires_in: 3600,
        id_token: "discard_me",
      });
    });
    expect(
      await refreshSession(
        metadata,
        { refreshToken: "latest_refresh_secret" },
        "client_test",
        FORUM_RESOURCE,
        fetchImpl,
      ),
    ).toEqual({ accessToken: "new_access", refreshToken: "new_refresh" });
    expect(
      validateTokens({
        token_type: "bearer",
        access_token: "a",
        refresh_token: "r",
        expires_in: 1,
        id_token: "secret",
      }),
    ).not.toHaveProperty("id_token");
  });
  test("post-revocation provider failures count as denial only for invalid_grant", async () => {
    const session = { refreshToken: "secret" };
    await expect(
      refreshSession(metadata, session, "client", FORUM_RESOURCE, async () =>
        json({ error: "invalid_grant" }, 400),
      ),
    ).rejects.toMatchObject({ code: "REFRESH_REJECTED" });
    for (const response of [
      json({ error: "server_error" }, 500),
      json({ error: "invalid_client" }, 401),
    ])
      await expect(
        refreshSession(
          metadata,
          session,
          "client",
          FORUM_RESOURCE,
          async () => response,
        ),
      ).rejects.toMatchObject({ code: "REFRESH_HTTP_FAILURE" });
  });
  test("sanitizes provider/network/JSON errors and rejects redirects and oversized responses", async () => {
    const secret = "Bearer sensitive_code_and_token";
    expect(safeFailure(new Error(secret))).toBe("UNEXPECTED_FAILURE");
    await expect(
      requestJson(ISSUER, {}, async () => {
        throw new Error(secret);
      }),
    ).rejects.toMatchObject({ code: "NETWORK_FAILURE" });
    await expect(
      requestJson(ISSUER, {}, async () => json("x".repeat(1024 * 1024))),
    ).rejects.toMatchObject({ code: "OVERSIZED_RESPONSE" });
    await expect(
      requestJson(
        ISSUER,
        {},
        async () =>
          new Response(secret, {
            headers: { "content-type": "application/json" },
          }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_JSON_RESPONSE" });
    expect(
      (
        await requestJson(ISSUER, {}, async (_url, options) => {
          expect(options.redirect).toBe("error");
          return Response.redirect("https://evil.example", 302);
        })
      ).payload,
    ).toBeNull();
  });
  test("checks status against signed grant, acting identity and selected execution mode", () => {
    expect(
      verifyForumStatus(forumStatus("agent", "review"), principal, {
        expectedActor: "agent",
        expectedMode: "review",
      }),
    ).toEqual({ actor: "agent", executionMode: "review", policyVersion: 1 });
    expect(() =>
      verifyForumStatus(
        forumStatus(),
        { ...principal, grantId: "different" },
        {},
      ),
    ).toThrow(CertificationError);
    expect(() =>
      verifyForumStatus(forumStatus(), principal, { expectedActor: "agent" }),
    ).toThrow(CertificationError);
  });
  test("complete live lifecycle reports actual crossed grants and sanitized assertions only", async () => {
    const outputs = [];
    const consents = [];
    let refreshCount = 0,
      disconnected = false;
    const fetchImpl = async (url, options) => {
      if (url.includes("oauth-authorization-server")) return json(metadata);
      if (url.includes("oauth-protected-resource"))
        return json({
          resource: url.endsWith("/api/plugin/mcp")
            ? FORUM_RESOURCE
            : EVIDENCE_RESOURCE,
          authorization_servers: [ISSUER],
        });
      if (url.endsWith("/oauth2/token"))
        return json({
          token_type: "bearer",
          access_token: `forum_access_secret_${++refreshCount}`,
          refresh_token: `refresh_secret_${refreshCount}`,
          expires_in: 3600,
        });
      const body = JSON.parse(options.body);
      const forumEndpoint = url.endsWith("/api/plugin/mcp");
      const forumToken = options.headers.Authorization.includes(
        "forum_access_secret",
      );
      if (forumEndpoint !== forumToken || (disconnected && forumEndpoint))
        return json(null, 401, {
          "www-authenticate": "Bearer error=invalid_token",
        });
      return json({
        jsonrpc: "2.0",
        id: body.id,
        result: forumEndpoint
          ? forumStatus()
          : { content: [{ type: "text", text: "private evidence status" }] },
      });
    };
    const summary = await certify(
      parseOptions(["--run", "--with-evidence", "--check-revocation"]),
      {
        output: (value) => outputs.push(value),
        fetchImpl,
        consentImpl: async (_metadata, _options, resource) => {
          consents.push(resource);
          return {
            clientId: "client_test",
            principal,
            session: {
              accessToken:
                resource === FORUM_RESOURCE
                  ? "forum_access_secret_original"
                  : "evidence_access_secret",
              refreshToken: "refresh_secret_original",
            },
          };
        },
        verifyTokenImpl: vi.fn(async () => principal),
        confirmRevocation: async () => {
          disconnected = true;
        },
      },
    );
    expect(consents).toEqual([FORUM_RESOURCE, EVIDENCE_RESOURCE]);
    expect(summary).toMatchObject({
      reverseBoundary: "passed",
      revocation: "passed",
      hostVerification: "not_tested",
      forumWrites: "not_tested",
    });
    expect(summary.checks.every((entry) => entry.status === "passed")).toBe(
      true,
    );
    const output = JSON.stringify({ summary, outputs });
    for (const secret of [
      "forum_access_secret",
      "evidence_access_secret",
      "refresh_secret",
      "private-name",
      "private evidence status",
      grant,
      owner,
    ])
      expect(output).not.toContain(secret);
  });
});
