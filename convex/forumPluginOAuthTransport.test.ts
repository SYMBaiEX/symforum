/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { FORUM_USAGE_POLICY } from "../lib/forum-usage-policy";
import agentTest from "@convex-dev/agent/test";
import presenceTest from "@convex-dev/presence/test";
import { api } from "./_generated/api";
import { FORUM_PLUGIN_RESOURCE } from "../lib/forum-plugin-contract";
import {
  WORKOS_AGENT_RESOURCE,
  WORKOS_GRANT_CLAIM,
  WORKOS_PLUGIN_GRANT_CLAIM,
  WORKOS_PLUGIN_KIND_CLAIM,
  WORKOS_PLUGIN_RESOURCE_CLAIM,
} from "../lib/workos-config";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
let signingKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;
let fixtureSequence = 0;
beforeAll(async () => {
  signingKeys = await generateKeyPair("RS256");
  publicJwk = {
    ...(await exportJWK(signingKeys.publicKey)),
    kid: "forum-http-integration",
    alg: "RS256",
    use: "sig",
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function fixture() {
  const issuer = `https://forum-http-${++fixtureSequence}.authkit.app`;
  vi.stubEnv("WORKOS_CONNECT_ENABLED", "true");
  vi.stubEnv("WORKOS_AUTHKIT_ISSUER", issuer);
  const jwksFetch = vi.fn(async (input: unknown) => {
    expect(String(input)).toBe(`${issuer}/oauth2/jwks`);
    // Only a public RSA verification key is served. Signing keys never enter HTTP.
    expect(publicJwk).not.toHaveProperty("d");
    return Response.json({ keys: [publicJwk] });
  });
  vi.stubGlobal("fetch", jwksFetch);
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  agentTest.register(t);
  presenceTest.register(t);
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      username: "oauth-http-owner",
      usernameNormalized: "oauth-http-owner",
      email: "oauth-http-owner@example.test",
      emailVerificationTime: 1,
      forumTrustedAt: 1,
    }),
  );
  const owner = t.withIdentity({ subject: ownerId });
  const { connectionId } = await owner.mutation(
    api.forumPluginAccess.createBrowserConnection,
    {
      actorMode: "human",
      executionMode: "direct",
      capabilities: ["read", "participate"],
    },
  );
  await t.run((ctx) =>
    ctx.db.patch("forumPluginConnections", connectionId, {
      transport: "oauth",
      issuer,
      subject: ownerId,
      status: "active",
    }),
  );
  async function token(overrides: JWTPayload = {}) {
    return new SignJWT({
      iss: issuer,
      sub: ownerId,
      aud: FORUM_PLUGIN_RESOURCE,
      exp: Math.floor(Date.now() / 1000) + 60,
      [WORKOS_PLUGIN_GRANT_CLAIM]: connectionId,
      [WORKOS_PLUGIN_RESOURCE_CLAIM]: FORUM_PLUGIN_RESOURCE,
      [WORKOS_PLUGIN_KIND_CLAIM]: "forum-plugin",
      ...overrides,
    })
      .setProtectedHeader({ alg: "RS256", kid: "forum-http-integration" })
      .sign(signingKeys.privateKey);
  }
  async function call(
    operation: string,
    signed: string,
    args: Record<string, unknown> = {},
  ) {
    return t.fetch("/plugin/forum", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Symbaiex-Forum-OAuth": signed,
      },
      body: JSON.stringify({ operation, args }),
    });
  }
  return { t, owner, ownerId, connectionId, issuer, token, call, jwksFetch };
}
describe("cryptographic forum OAuth HTTP integration", () => {
  test("verifies a real JWKS-signed token and bounds authenticated browsing without monthly charges", async () => {
    const { t, ownerId, token, call, jwksFetch } = await fixture();
    const signed = await token();
    const status = await call("status", signed);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      status: "completed",
      actingAs: { userId: ownerId, isAgent: false },
      data: { policyVersion: 1, capabilities: ["read", "participate"] },
    });
    const first = await call("listCategories", signed);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      status: "completed",
      actingAs: { userId: ownerId },
    });
    const second = await call("listCategories", signed);
    expect(second.status).toBe(200);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
      expect(await ctx.db.query("agentQuotaBudgets").collect()).toHaveLength(0);
      expect(
        await ctx.db.query("agentQuotaUsageCounters").collect(),
      ).toHaveLength(0);
    });
    expect(jwksFetch).toHaveBeenCalledTimes(1);
  });
  test.each(["human", "agent"] as const)(
    "signed %s forum posting and browsing remain available with exhausted evidence budgets",
    async (mode) => {
      const { t, ownerId, connectionId, token, call } = await fixture();
      const now = Date.now();
      const monthKey = new Date(now).toISOString().slice(0, 7);
      await t.run(async (ctx) => {
        const connection = await ctx.db.get(
          "forumPluginConnections",
          connectionId,
        );
        const credential = await ctx.db.get(
          "agentIdentities",
          connection!.credentialAgentIdentityId,
        );
        if (mode === "agent")
          await ctx.db.patch("forumPluginConnections", connectionId, {
            actorMode: "agent",
            actorUserId: credential!.userId,
          });
        await ctx.db.insert("forumCategories", {
          slug: "general",
          name: "General",
          description: "",
          kind: "board",
          status: "active",
          viewAccess: "public",
          threadAccess: "members",
          replyAccess: "members",
          position: 0,
          threadCount: 0,
          postCount: 0,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("agentQuotaBudgets", {
          ownerUserId: ownerId,
          monthKey,
          freeAllowanceUnits: 100,
          hardCapUnits: 1000,
          usedUnits: 1000,
          hardCapMetadataJson: "private-metadata",
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("agentQuotaUsageCounters", {
          ownerUserId: ownerId,
          agentId: credential!.agentId,
          monthKey,
          usedUnits: 250,
          updatedAt: now,
        });
      });
      const signed = await token();
      const response = await call("status", signed);
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.actingAs.isAgent).toBe(mode === "agent");
      expect(result.data.usagePolicy).toEqual(FORUM_USAGE_POLICY);
      expect(result.data).not.toHaveProperty("quota");
      expect(JSON.stringify(result)).not.toContain("private-metadata");
      expect((await call("overview", signed)).status).toBe(200);
      const forumWrite = await t.fetch("/plugin/forum", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Symbaiex-Forum-OAuth": signed,
        },
        body: JSON.stringify({
          operation: "createThread",
          args: {
            categorySlug: "general",
            title: "Posting remains available",
            body: "Forum access is independent of evidence budgets.",
          },
          idempotencyKey: "exhausted-write",
          expectedPolicyVersion: 1,
        }),
      });
      expect(forumWrite.status).toBe(200);
      expect(await forumWrite.json()).toMatchObject({
        status: "completed",
        publicationStatus: "published",
      });
      await t.run(async (ctx) => {
        expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
        expect(
          (await ctx.db.query("agentQuotaBudgets").unique())?.usedUnits,
        ).toBe(1000);
        expect(
          (await ctx.db.query("agentQuotaUsageCounters").unique())?.usedUnits,
        ).toBe(250);
      });
    },
  );
  test("rejects expired, wrong-issuer, wrong-resource, mixed-resource and legacy-grant signed tokens without spending quota", async () => {
    const { t, issuer, token, call } = await fixture();
    const cases: JWTPayload[] = [
      { exp: 1 },
      { iss: "https://other-issuer.authkit.app" },
      { aud: WORKOS_AGENT_RESOURCE },
      { aud: [FORUM_PLUGIN_RESOURCE, WORKOS_AGENT_RESOURCE] },
      { [WORKOS_PLUGIN_RESOURCE_CLAIM]: WORKOS_AGENT_RESOURCE },
      { [WORKOS_GRANT_CLAIM]: "legacy-evidence-grant" },
      { iss: issuer, aud: [FORUM_PLUGIN_RESOURCE] },
    ];
    for (const claims of cases) {
      const response = await call("status", await token(claims));
      expect(response.status, JSON.stringify(claims)).toBe(401);
      expect(await response.json()).toMatchObject({
        code: "PLUGIN_INVALID_TOKEN",
      });
      expect(response.headers.get("www-authenticate")).toContain(
        "/oauth-protected-resource/api/plugin/mcp",
      );
    }
    await t.run(async (ctx) => {
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
    });
  });
  test("rechecks connection revocation after a token has already passed signature verification", async () => {
    const { t, owner, connectionId, token, call } = await fixture();
    const signed = await token();
    expect((await call("status", signed)).status).toBe(200);
    await owner.mutation(api.forumPluginAccess.revokeConnection, {
      connectionId,
    });
    const revoked = await call("listCategories", signed);
    expect(revoked.status).toBe(401);
    expect(await revoked.json()).toMatchObject({
      code: "PLUGIN_AUTH_REQUIRED",
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
    });
  });
  test("rejects signature tampering and standard Authorization header admission", async () => {
    const { t, token, call } = await fixture();
    const signed = await token();
    const segments = signed.split(".");
    segments[2] = (segments[2][0] === "A" ? "B" : "A") + segments[2].slice(1);
    expect((await call("status", segments.join("."))).status).toBe(401);
    const standard = await t.fetch("/plugin/forum", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signed}`,
      },
      body: JSON.stringify({ operation: "status", args: {} }),
    });
    expect(standard.status).toBe(401);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
    });
  });
  test("public Convex controllers never accept server-owned OAuth facade proof", async () => {
    const { t, issuer, ownerId, connectionId } = await fixture();
    const proof = {
      verifiedResource: FORUM_PLUGIN_RESOURCE,
      verifiedOAuthPrincipal: {
        issuer,
        subject: ownerId,
        grantId: connectionId,
      },
    };
    await expect(
      t.mutation(api.forumPlugin.read, {
        operation: "listCategories",
        args: {},
        ...proof,
      } as never),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.forumPlugin.execute, {
        operation: "markAllForumsRead",
        args: {},
        idempotencyKey: "forged-proof",
        expectedPolicyVersion: 1,
        ...proof,
      } as never),
    ).rejects.toThrow();
    const fabricated = t.withIdentity({
      issuer,
      subject: ownerId,
      [WORKOS_PLUGIN_GRANT_CLAIM]: connectionId,
      [WORKOS_PLUGIN_RESOURCE_CLAIM]: FORUM_PLUGIN_RESOURCE,
      [WORKOS_PLUGIN_KIND_CLAIM]: "forum-plugin",
    });
    await expect(
      fabricated.mutation(api.forumPlugin.read, {
        operation: "status",
        args: {},
      }),
    ).rejects.toThrow();
    await t.run(async (ctx) => {
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
    });
  });
});
