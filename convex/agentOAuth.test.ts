/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { getCurrentUser } from "./authz";
import { WORKOS_GRANT_CLAIM } from "../lib/workos-config";

const mocks = vi.hoisted(() => ({ complete: vi.fn(), getUser: vi.fn() }));
vi.mock("@workos-inc/node", () => ({
  WorkOS: class {
    connect = { completeOAuth2: mocks.complete };
    userManagement = { getUserByExternalId: mocks.getUser };
  },
}));
const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const issuer = "https://oauth-test.authkit.app";
const externalAuthId = "01J3X4Y5Z6A7B8C9D0E1F2G3H4";
beforeEach(() => {
  vi.stubEnv("WORKOS_CONNECT_ENABLED", "true");
  vi.stubEnv("WORKOS_AUTHKIT_ISSUER", issuer);
  vi.stubEnv("WORKOS_API_KEY", "test-only-not-a-credential");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

async function fixture() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      role: "owner",
      email: "owner@example.test",
    });
    const otherId = await ctx.db.insert("users", {
      role: "reader",
      email: "other@example.test",
    });
    const agentUserId = await ctx.db.insert("users", {
      role: "admin",
      isAgent: true,
      agentStatus: "active",
      agentScopes: ["evidence", "forum"],
      agentSlug: "oauth-agent",
      agentKeyVersion: 1,
    });
    const agentIdentityId = await ctx.db.insert("agentIdentities", {
      agentId: "oauth-agent",
      userId: agentUserId,
      ownerUserId: ownerId,
      publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      scopes: ["evidence", "forum"],
      status: "active",
      keyVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    return { ownerId, otherId, agentUserId, agentIdentityId };
  });
  const owner = t.withIdentity({ subject: ids.ownerId });
  const other = t.withIdentity({ subject: ids.otherId });
  return { t, owner, other, ...ids };
}

async function activeFixture() {
  const f = await fixture();
  const prepared = await f.owner.mutation(
    internal.agentOAuth.prepareConnection,
    { agentId: "oauth-agent", externalAuthId },
  );
  await f.owner.mutation(internal.agentOAuth.finishConnection, {
    grantId: prepared.grantId,
    subject: "user_test_subject",
  });
  const claims = {
    issuer,
    subject: "user_test_subject",
    [WORKOS_GRANT_CLAIM]: prepared.grantId,
  };
  return {
    ...f,
    grantId: prepared.grantId,
    claims,
    oauth: f.t.withIdentity(claims),
  };
}

describe("WorkOS owner-approved agent authorization", () => {
  test("serves the existing evidence HTTP entrypoint and challenges revoked grants", async () => {
    const f = await activeFixture();
    const request = () => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "status",
        input: {},
        idempotencyKey: "oauth-http-check",
        requestFingerprint: "oauth-http-status",
      }),
    });
    const allowed = await f.oauth.fetch("/agent/v1", request());
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ status: "available" });
    await f.owner.mutation(api.agentOAuth.revokeConnection, {
      grantId: f.grantId,
    });
    const denied = await f.oauth.fetch("/agent/v1", request());
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toContain(
      'error="invalid_token"',
    );
    expect(denied.headers.get("www-authenticate")).toContain(
      'scope="openid offline_access"',
    );
  });
  test("maps only to the selected evidence agent, never owner/admin or forum permissions", async () => {
    const f = await activeFixture();
    const user = await f.oauth.run(getCurrentUser);
    expect(user).toMatchObject({
      _id: f.agentUserId,
      role: "reader",
      isAgent: true,
      agentScopes: ["evidence"],
    });
    await expect(f.oauth.query(api.admin.overview, {})).rejects.toThrow(
      /administrator access/i,
    );
    await expect(
      f.oauth.query(api.agentOAuth.listMyConnections, {}),
    ).rejects.toThrow(/human account/i);
    await expect(f.owner.run(getCurrentUser)).resolves.toMatchObject({
      _id: f.ownerId,
      role: "owner",
    });
  });

  test("rejects unbound, wrong-owner, wrong-subject, and wrong-issuer credentials", async () => {
    const f = await activeFixture();
    for (const claims of [
      { issuer, subject: "user_test_subject" },
      { ...f.claims, subject: "user_other" },
      { ...f.claims, issuer: "https://other.authkit.app" },
      { ...f.claims, subject: f.ownerId },
      { ...f.claims, [WORKOS_GRANT_CLAIM]: f.ownerId },
    ])
      expect(await f.t.withIdentity(claims).run(getCurrentUser)).toBeNull();
    await expect(
      f.other.mutation(api.agentOAuth.revokeConnection, { grantId: f.grantId }),
    ).rejects.toThrow(/not found/i);
    expect(await f.other.query(api.agentOAuth.listMyConnections, {})).toEqual(
      [],
    );
    await f.t.run((ctx) =>
      ctx.db.patch("agentIdentities", f.agentIdentityId, {
        ownerUserId: f.otherId,
      }),
    );
    expect(await f.oauth.run(getCurrentUser)).toBeNull();
  });

  test.each([
    "revocation",
    "key rotation",
    "scope removal",
    "agent disabled",
    "owner deleted",
    "feature disabled",
  ])("denies existing and refreshed tokens after %s", async (reason) => {
    const f = await activeFixture();
    if (reason === "revocation") {
      await f.owner.mutation(api.agentOAuth.revokeConnection, {
        grantId: f.grantId,
      });
      await f.owner.mutation(api.agentOAuth.revokeConnection, {
        grantId: f.grantId,
      });
    } else if (reason === "key rotation")
      await f.t.run((ctx) =>
        ctx.db.patch("agentIdentities", f.agentIdentityId, { keyVersion: 2 }),
      );
    else if (reason === "scope removal")
      await f.t.run((ctx) =>
        ctx.db.patch("users", f.agentUserId, { agentScopes: ["forum"] }),
      );
    else if (reason === "agent disabled")
      await f.t.run((ctx) =>
        ctx.db.patch("users", f.agentUserId, { agentStatus: "revoked" }),
      );
    else if (reason === "owner deleted")
      await f.t.run((ctx) => ctx.db.delete("users", f.ownerId));
    else vi.stubEnv("WORKOS_CONNECT_ENABLED", "false");
    expect(await f.oauth.run(getCurrentUser)).toBeNull();
    await expect(
      f.oauth.mutation(internal.agentQuota.consumeAgentQuota, {
        agentId: "oauth-agent",
        units: 1,
        operation: "evidence.search",
        idempotencyKey: "revoked-request",
      }),
    ).rejects.toThrow(/does not match/i);
  });

  test("charges OAuth requests to the selected agent's existing quota", async () => {
    const f = await activeFixture();
    await expect(
      f.oauth.mutation(internal.agentQuota.consumeAgentQuota, {
        agentId: "oauth-agent",
        units: 1,
        operation: "evidence.search",
        idempotencyKey: "oauth-request",
      }),
    ).resolves.toMatchObject({ accepted: true, agentUsedUnits: 1 });
  });

  test("requires an authenticated human owner, contact email and active evidence identity", async () => {
    const f = await fixture();
    const args = { agentId: "oauth-agent", externalAuthId };
    await expect(
      f.t.mutation(internal.agentOAuth.prepareConnection, args),
    ).rejects.toThrow(/sign in/i);
    await expect(
      f.other.mutation(internal.agentOAuth.prepareConnection, args),
    ).rejects.toThrow(/you own/i);
    await expect(
      f.owner.mutation(internal.agentOAuth.prepareConnection, {
        ...args,
        externalAuthId: "invalid",
      }),
    ).rejects.toThrow(/invalid/i);
    await f.t.run((ctx) =>
      ctx.db.patch("users", f.ownerId, { email: undefined }),
    );
    await expect(
      f.owner.mutation(internal.agentOAuth.prepareConnection, args),
    ).rejects.toThrow(/contact email/i);
    await f.t.run((ctx) =>
      ctx.db.patch("users", f.ownerId, { email: "owner@example.test" }),
    );
    await f.t.run((ctx) =>
      ctx.db.patch("agentIdentities", f.agentIdentityId, { scopes: ["forum"] }),
    );
    await expect(
      f.owner.mutation(internal.agentOAuth.prepareConnection, args),
    ).rejects.toThrow(/evidence/i);
  });

  test("rejects replay and expires incomplete grants", async () => {
    const f = await fixture();
    const args = { agentId: "oauth-agent", externalAuthId };
    const grant = await f.owner.mutation(
      internal.agentOAuth.prepareConnection,
      args,
    );
    await expect(
      f.owner.mutation(internal.agentOAuth.prepareConnection, args),
    ).rejects.toThrow(/already used/i);
    await f.t.run((ctx) =>
      ctx.db.patch("agentOAuthGrants", grant.grantId, {
        createdAt: Date.now() - 11 * 60_000,
      }),
    );
    expect(
      await f.owner.mutation(internal.agentOAuth.finishConnection, {
        grantId: grant.grantId,
        subject: "user_test",
      }),
    ).toBe(false);
    expect(
      await f.t.run((ctx) => ctx.db.get("agentOAuthGrants", grant.grantId)),
    ).toMatchObject({ status: "revoked" });
  });

  test("bounds connection attempts without a permanent lifetime connection cap", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 205; i++)
        await ctx.db.insert("agentOAuthGrants", {
          ownerUserId: f.ownerId,
          agentIdentityId: f.agentIdentityId,
          issuer,
          externalAuthHash: `old-${i}`,
          keyVersion: 1,
          status: "revoked",
          createdAt: 1,
        });
    });
    for (let i = 0; i < 5; i++)
      await f.owner.mutation(internal.agentOAuth.prepareConnection, {
        agentId: "oauth-agent",
        externalAuthId: `${externalAuthId}${i}`,
      });
    await expect(
      f.owner.mutation(internal.agentOAuth.prepareConnection, {
        agentId: "oauth-agent",
        externalAuthId,
      }),
    ).rejects.toThrow(/limit reached/i);
  });

  test("completes through the real SDK boundary and binds the provider subject, not an email", async () => {
    const f = await fixture();
    mocks.complete.mockResolvedValue({
      redirectUri: `${issuer}/oauth2/consent`,
    });
    mocks.getUser.mockResolvedValue({
      id: "user_real_subject",
      externalId: f.ownerId,
    });
    await expect(
      f.owner.action(api.agentOAuthConnect.complete, {
        agentId: "oauth-agent",
        externalAuthId,
      }),
    ).resolves.toEqual({ redirectUri: `${issuer}/oauth2/consent` });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { id: f.ownerId, email: "owner@example.test" },
      }),
    );
    expect(mocks.getUser).toHaveBeenCalledWith(f.ownerId);
    const grants = await f.owner.query(api.agentOAuth.listMyConnections, {});
    expect(grants).toHaveLength(1);
    expect(
      await f.t.run((ctx) => ctx.db.get("agentOAuthGrants", grants[0].id)),
    ).toMatchObject({ subject: "user_real_subject", status: "active" });
  });

  test.each(["redirect", "identity", "provider"])(
    "fails closed with sanitized errors for a bad %s response",
    async (reason) => {
      const f = await fixture();
      mocks.complete.mockResolvedValue({
        redirectUri:
          reason === "redirect"
            ? "https://evil.example/steal"
            : `${issuer}/oauth2/consent`,
      });
      mocks.getUser.mockResolvedValue({
        id: "user_wrong",
        externalId: f.otherId,
      });
      if (reason === "provider")
        mocks.complete.mockRejectedValue(new Error("secret-provider-error"));
      await expect(
        f.owner.action(api.agentOAuthConnect.complete, {
          agentId: "oauth-agent",
          externalAuthId,
        }),
      ).rejects.toThrow(/restart authorization/i);
      expect(await f.owner.query(api.agentOAuth.listMyConnections, {})).toEqual(
        [],
      );
      const grants = await f.t.run((ctx) =>
        ctx.db.query("agentOAuthGrants").collect(),
      );
      expect(grants[0].status).toBe("revoked");
    },
  );
});
