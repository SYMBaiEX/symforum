/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { getCurrentUser } from "./authz";
import {
  resolvePluginPrincipal,
  withVerifiedPluginOAuth,
} from "./forumPluginPrincipal";
import {
  FORUM_PLUGIN_RESOURCE,
  type ForumPluginCapability,
} from "../lib/forum-plugin-contract";
import {
  WORKOS_PLUGIN_GRANT_CLAIM,
  WORKOS_PLUGIN_RESOURCE_CLAIM,
  WORKOS_PLUGIN_KIND_CLAIM,
  WORKOS_GRANT_CLAIM,
  WORKOS_AGENT_RESOURCE,
} from "../lib/workos-config";
import type { Id } from "./_generated/dataModel";
const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const issuer = "https://plugin-tests.authkit.app";
const ref = <
  T extends "query" | "mutation" | "action",
  A extends Record<string, unknown>,
  R,
>(
  kind: T,
  name: string,
) => makeFunctionReference<T, A, R>(name);
const create = ref<
  "mutation",
  {
    actorMode: "human" | "agent";
    agentId?: string;
    capabilities: ForumPluginCapability[];
    executionMode: "direct" | "review";
  },
  { connectionId: Id<"forumPluginConnections"> }
>("mutation", "forumPluginAccess:createBrowserConnection");
const update = ref<
  "mutation",
  {
    connectionId: Id<"forumPluginConnections">;
    actorMode?: "human" | "agent";
    capabilities?: Array<"read" | "messages">;
    executionMode?: "direct" | "review";
  },
  null
>("mutation", "forumPluginAccess:updateConnection");
const revoke = ref<
  "mutation",
  { connectionId: Id<"forumPluginConnections"> },
  null
>("mutation", "forumPluginAccess:revokeConnection");
const list = ref<"query", {}, unknown[]>(
  "query",
  "forumPluginAccess:listMyConnections",
);
const prepare = ref<
  "mutation",
  {
    externalAuthId: string;
    actorMode: "human" | "agent";
    agentId?: string;
    capabilities: ["read"];
    executionMode: "direct";
  },
  {
    grantId: Id<"forumPluginConnections">;
    ownerId: Id<"users">;
    email: string;
    actorLabel: string;
  }
>("mutation", "forumPluginAccess:prepareConnection");
const finish = ref<
  "mutation",
  { grantId: Id<"forumPluginConnections">; subject?: string },
  boolean
>("mutation", "forumPluginAccess:finishConnection");
const complete = ref<
  "action",
  {
    externalAuthId: string;
    actorMode: "human" | "agent";
    capabilities: ["read"];
    executionMode: "direct";
  },
  { redirectUri: string }
>("action", "forumPluginOAuth:complete");
const mocks = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("@workos-inc/node", () => ({
  WorkOS: class {
    connect = { completeOAuth2: mocks.complete };
  },
}));
beforeEach(() => {
  vi.stubEnv("WORKOS_CONNECT_ENABLED", "true");
  vi.stubEnv("WORKOS_AUTHKIT_ISSUER", issuer);
  vi.stubEnv("WORKOS_API_KEY", "test-only");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
async function fixture() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const ids = await t.run(async (ctx) => ({
    ownerId: await ctx.db.insert("users", {
      role: "reader",
      username: "owner",
      email: "owner@example.test",
      emailVerificationTime: 1,
      forumTrustedAt: 1,
    }),
    otherId: await ctx.db.insert("users", {
      role: "reader",
      email: "other@example.test",
      emailVerificationTime: 1,
    }),
  }));
  return {
    t,
    ...ids,
    owner: t.withIdentity({ subject: ids.ownerId }),
    other: t.withIdentity({ subject: ids.otherId }),
  };
}
async function oauthFixture() {
  const f = await fixture();
  const grant = await f.owner.mutation(prepare, {
    externalAuthId: "01J3X4Y5Z6A7B8C9D0E1F2G3H4",
    actorMode: "human",
    capabilities: ["read"],
    executionMode: "direct",
  });
  expect(
    await f.owner.mutation(finish, {
      grantId: grant.grantId,
      subject: f.ownerId,
    }),
  ).toBe(true);
  const claims = {
    issuer,
    subject: f.ownerId,
    aud: FORUM_PLUGIN_RESOURCE,
    [WORKOS_PLUGIN_GRANT_CLAIM]: grant.grantId,
    [WORKOS_PLUGIN_RESOURCE_CLAIM]: FORUM_PLUGIN_RESOURCE,
    [WORKOS_PLUGIN_KIND_CLAIM]: "forum-plugin",
  };
  return { ...f, ...grant, claims, oauth: f.t.withIdentity(claims) };
}
describe("forum plugin connection boundaries", () => {
  test("stored historical or foreign resource strings never grant capabilities", async () => {
    const f = await fixture();
    const { connectionId } = await f.owner.mutation(create, {
      actorMode: "human", capabilities: ["read"], executionMode: "direct",
    });
    expect(await f.owner.run(ctx => resolvePluginPrincipal(ctx, { connectionId }))).not.toBeNull();
    await f.t.run(ctx => ctx.db.patch("forumPluginConnections", connectionId, { resource: "https://other-installation.example/api/plugin/mcp" }));
    expect(await f.owner.run(ctx => resolvePluginPrincipal(ctx, { connectionId }))).toBeNull();
    await f.t.run(ctx => ctx.db.patch("forumPluginConnections", connectionId, { resource: FORUM_PLUGIN_RESOURCE }));
    expect(await f.owner.run(ctx => resolvePluginPrincipal(ctx, { connectionId }))).not.toBeNull();
  });
  test.each(["human", "agent"] as const)(
    "creates an OAuth-only credential in %s mode without copying staff roles or keys",
    async (actorMode) => {
      const f = await fixture();
      await f.t.run((ctx) =>
        ctx.db.patch("users", f.ownerId, { role: "owner", forumRole: "admin" }),
      );
      const { connectionId } = await f.owner.mutation(create, {
        actorMode,
        capabilities: ["read", "participate"],
        executionMode: "direct",
      });
      const principal = await f.owner.run((ctx) =>
        resolvePluginPrincipal(ctx, { connectionId }),
      );
      expect(principal?.credentialAgent).toMatchObject({
        credentialKind: "oauth",
        ownerUserId: f.ownerId,
        scopes: ["forum"],
      });
      expect(principal?.credentialAgent.publicKey).toBeUndefined();
      const credentialUser = await f.t.run((ctx) =>
        ctx.db.get("users", principal!.credentialAgent.userId),
      );
      expect(credentialUser).toMatchObject({ role: "reader", isAgent: true });
      expect(credentialUser?.forumRole).toBeUndefined();
      expect(principal?.actor._id).toBe(
        actorMode === "human" ? f.ownerId : credentialUser?._id,
      );
      const challenge = makeFunctionReference<
        "mutation",
        { agentId: string; audience: string },
        unknown
      >("agentIdentity:requestLoginChallenge");
      await expect(
        f.t.mutation(challenge, {
          agentId: principal!.credentialAgent.agentId,
          audience: WORKOS_AGENT_RESOURCE,
        }),
      ).rejects.toThrow(/not active/i);
    },
  );
  test("cross-owner connection access and policy expansion fail; changes invalidate policy revision", async () => {
    const f = await fixture();
    const { connectionId } = await f.owner.mutation(create, {
      actorMode: "human",
      capabilities: ["read"],
      executionMode: "review",
    });
    expect(
      await f.other.run((ctx) => resolvePluginPrincipal(ctx, { connectionId })),
    ).toBeNull();
    await expect(
      f.other.mutation(update, { connectionId, executionMode: "direct" }),
    ).rejects.toThrow(/not found/i);
    await expect(
      f.owner.mutation(update, {
        connectionId,
        capabilities: ["read", "messages"],
      }),
    ).rejects.toThrow(/renewed consent/i);
    await f.owner.mutation(update, {
      connectionId,
      actorMode: "agent",
      executionMode: "direct",
    });
    expect(
      (
        await f.owner.run((ctx) =>
          resolvePluginPrincipal(ctx, { connectionId }),
        )
      )?.policyVersion,
    ).toBe(2);
    await f.owner.mutation(revoke, { connectionId });
    await f.owner.mutation(revoke, { connectionId });
    expect(
      await f.owner.run((ctx) => resolvePluginPrincipal(ctx, { connectionId })),
    ).toBeNull();
  });
  test("effective staff capabilities follow current roles and board assignments", async () => {
    const f = await fixture();
    await f.t.run((ctx) => ctx.db.patch("users", f.ownerId, { role: "owner" }));
    const { connectionId } = await f.owner.mutation(create, {
      actorMode: "agent",
      capabilities: ["read", "moderate", "administer", "accounts"],
      executionMode: "direct",
    });
    expect(
      (
        await f.owner.run((ctx) =>
          resolvePluginPrincipal(ctx, { connectionId }),
        )
      )?.capabilities,
    ).toEqual(["read", "moderate", "administer", "accounts"]);
    await f.t.run((ctx) =>
      ctx.db.patch("users", f.ownerId, { role: "reader" }),
    );
    expect(
      (
        await f.owner.run((ctx) =>
          resolvePluginPrincipal(ctx, { connectionId }),
        )
      )?.capabilities,
    ).toEqual(["read"]);
    const assignmentId = await f.t.run(async (ctx) => {
      const categoryId = await ctx.db.insert("forumCategories", {
        slug: "test-board",
        name: "Test board",
        description: "Test",
        status: "active",
        position: 0,
        threadCount: 0,
        postCount: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      return await ctx.db.insert("forumCategoryModerators", {
        categoryId,
        userId: f.ownerId,
        assignedBy: f.ownerId,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    expect(
      (
        await f.owner.run((ctx) =>
          resolvePluginPrincipal(ctx, { connectionId }),
        )
      )?.capabilities,
    ).toEqual(["read", "moderate"]);
    await f.t.run((ctx) =>
      ctx.db.delete("forumCategoryModerators", assignmentId),
    );
    expect(
      (
        await f.owner.run((ctx) =>
          resolvePluginPrincipal(ctx, { connectionId }),
        )
      )?.capabilities,
    ).toEqual(["read"]);
  });

  test("requires first-party human consent even when token subject equals owner", async () => {
    const f = await oauthFixture();
    await expect(f.oauth.query(list, {})).rejects.toThrow(/human account/i);
    await expect(
      f.oauth.mutation(update, {
        connectionId: f.grantId,
        executionMode: "review",
      }),
    ).rejects.toThrow(/human account/i);
    await expect(
      f.oauth.mutation(create, {
        actorMode: "human",
        capabilities: ["read"],
        executionMode: "direct",
      }),
    ).rejects.toThrow(/human account/i);
    expect(await f.oauth.run(getCurrentUser)).toBeNull();
    expect(
      (await f.oauth.run((ctx) => resolvePluginPrincipal(ctx)))?.actor._id,
    ).toBe(f.ownerId);
  });
  test("unprojected OAuth audience requires private HTTP resource verification", async () => {
    const f = await oauthFixture();
    const { aud: _aud, ...withoutAudience } = f.claims;
    const token = f.t.withIdentity(withoutAudience);
    expect(await token.run((ctx) => resolvePluginPrincipal(ctx))).toBeNull();
    // A literal argument alone cannot prove a resource; the internal auth context is required.
    expect(
      await token.run((ctx) =>
        resolvePluginPrincipal(ctx, {
          verifiedResource: FORUM_PLUGIN_RESOURCE,
        }),
      ),
    ).toBeNull();
    expect(
      await f.t.run((ctx) =>
        resolvePluginPrincipal(
          withVerifiedPluginOAuth(
            ctx,
            { issuer, subject: f.ownerId, grantId: f.grantId },
            FORUM_PLUGIN_RESOURCE,
          ),
          { verifiedResource: FORUM_PLUGIN_RESOURCE },
        ),
      ),
    ).toMatchObject({ authMode: "oauth", actor: { _id: f.ownerId } });
    // Projected cross-resource credentials remain denied even with the literal proof argument.
    expect(
      await f.t
        .withIdentity({ ...f.claims, aud: WORKOS_AGENT_RESOURCE })
        .run((ctx) =>
          resolvePluginPrincipal(ctx, {
            verifiedResource: FORUM_PLUGIN_RESOURCE,
          }),
        ),
    ).toBeNull();
    expect(
      await f.t.run((ctx) =>
        getCurrentUser(
          withVerifiedPluginOAuth(
            ctx,
            { issuer, subject: f.ownerId, grantId: f.grantId },
            FORUM_PLUGIN_RESOURCE,
          ),
        ),
      ),
    ).toBeNull();
  });

  test("rejects legacy grants, mixed resources, wrong subjects and unbound claims", async () => {
    const f = await oauthFixture();
    for (const claims of [
      { ...f.claims, aud: WORKOS_AGENT_RESOURCE },
      { ...f.claims, aud: [FORUM_PLUGIN_RESOURCE, WORKOS_AGENT_RESOURCE] },
      { ...f.claims, [WORKOS_PLUGIN_RESOURCE_CLAIM]: WORKOS_AGENT_RESOURCE },
      { ...f.claims, [WORKOS_PLUGIN_KIND_CLAIM]: "evidence" },
      { ...f.claims, [WORKOS_GRANT_CLAIM]: f.grantId },
      { ...f.claims, [WORKOS_PLUGIN_GRANT_CLAIM]: f.ownerId },
      { ...f.claims, subject: f.otherId },
      { ...f.claims, issuer: "https://evil.example" },
    ])
      expect(
        await f.t
          .withIdentity(claims)
          .run((ctx) => resolvePluginPrincipal(ctx)),
      ).toBeNull();
    const browserId = (
      await f.owner.mutation(create, {
        actorMode: "human",
        capabilities: ["read"],
        executionMode: "direct",
      })
    ).connectionId;
    expect(
      await f.oauth.run((ctx) =>
        resolvePluginPrincipal(ctx, { connectionId: browserId }),
      ),
    ).toBeNull();
  });
  test.each(["revoked", "rotation", "scope", "profile", "owner", "disabled"])(
    "existing and refreshed OAuth tokens fail after %s",
    async (reason) => {
      const f = await oauthFixture();
      const principal = (await f.oauth.run((ctx) =>
        resolvePluginPrincipal(ctx),
      ))!;
      if (reason === "revoked")
        await f.owner.mutation(revoke, { connectionId: f.grantId });
      if (reason === "rotation")
        await f.t.run((ctx) =>
          ctx.db.patch("agentIdentities", principal.credentialAgent._id, {
            keyVersion: 2,
          }),
        );
      if (reason === "scope")
        await f.t.run((ctx) =>
          ctx.db.patch("agentIdentities", principal.credentialAgent._id, {
            scopes: [],
          }),
        );
      if (reason === "profile")
        await f.t.run((ctx) =>
          ctx.db.patch("users", principal.credentialAgent.userId, {
            agentStatus: "revoked",
          }),
        );
      if (reason === "owner")
        await f.t.run((ctx) => ctx.db.delete("users", f.ownerId));
      if (reason === "disabled") vi.stubEnv("WORKOS_CONNECT_ENABLED", "false");
      expect(
        await f.oauth.run((ctx) => resolvePluginPrincipal(ctx)),
      ).toBeNull();
    },
  );
  test("rejects replay and expired/wrong-subject grants", async () => {
    const f = await fixture();
    const options = {
      externalAuthId: "01J3X4Y5Z6A7B8C9D0E1F2G3H4",
      actorMode: "human" as const,
      capabilities: ["read"] as ["read"],
      executionMode: "direct" as const,
    };
    const { grantId } = await f.owner.mutation(prepare, options);
    await expect(f.owner.mutation(prepare, options)).rejects.toThrow(
      /already used/i,
    );
    expect(
      await f.owner.mutation(finish, { grantId, subject: f.otherId }),
    ).toBe(false);
    const second = await f.owner.mutation(prepare, {
      ...options,
      externalAuthId: options.externalAuthId + "5",
    });
    await f.t.run((ctx) =>
      ctx.db.patch("forumPluginConnections", second.grantId, {
        createdAt: Date.now() - 11 * 60_000,
      }),
    );
    expect(
      await f.owner.mutation(finish, {
        grantId: second.grantId,
        subject: f.ownerId,
      }),
    ).toBe(false);
  });
  test("OAuth completion signs resource, kind and grant; unsafe provider redirects revoke pending grants", async () => {
    const f = await fixture();
    const options = {
      externalAuthId: "01J3X4Y5Z6A7B8C9D0E1F2G3H4",
      actorMode: "human" as const,
      capabilities: ["read"] as ["read"],
      executionMode: "direct" as const,
    };
    mocks.complete.mockResolvedValue({
      redirectUri: issuer + "/oauth2/consent",
    });
    expect(await f.owner.action(complete, options)).toEqual({
      redirectUri: issuer + "/oauth2/consent",
    });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { id: f.ownerId, email: "owner@example.test" },
        userConsentOptions: expect.arrayContaining([
          expect.objectContaining({ claim: WORKOS_PLUGIN_GRANT_CLAIM }),
          expect.objectContaining({ claim: WORKOS_PLUGIN_RESOURCE_CLAIM }),
          expect.objectContaining({ claim: WORKOS_PLUGIN_KIND_CLAIM }),
        ]),
      }),
    );
    mocks.complete.mockResolvedValue({ redirectUri: "https://evil.example" });
    await expect(
      f.owner.action(complete, {
        ...options,
        externalAuthId: options.externalAuthId + "5",
      }),
    ).rejects.toThrow(/restart authorization/i);
    const connections = await f.t.run((ctx) =>
      ctx.db
        .query("forumPluginConnections")
        .withIndex("by_ownerUserId_and_createdAt", (q) =>
          q.eq("ownerUserId", f.ownerId),
        )
        .take(50),
    );
    expect(connections.map((c) => c.status).sort()).toEqual([
      "active",
      "revoked",
    ]);
  });
});
