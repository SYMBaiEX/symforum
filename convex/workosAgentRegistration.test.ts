/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { getCurrentUser } from "./authz";
import { WORKOS_AGENT_RESOURCE } from "../lib/workos-config";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const issuer = "https://registration-test.authkit.app";
const ownerWorkosUserId = "user_owner-registration-test";
const registrationId = "agent_reg_01ABCDEF12345678";
const ownerTokenIdentifier = "https://api.workos.com/|user_owner-registration-test";

beforeEach(() => {
  vi.stubEnv("WORKOS_AGENT_REGISTRATION_ENABLED", "true");
  vi.stubEnv("WORKOS_CONNECT_ENABLED", "false");
  vi.stubEnv("WORKOS_AUTHKIT_ISSUER", issuer);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      name: "Owner",
      role: "reader",
      email: "owner@example.test",
      emailVerificationTime: 1,
    });
    const agentUserId = await ctx.db.insert("users", {
      name: "Research Agent",
      role: "reader",
      isAgent: true,
      agentStatus: "active",
      agentScopes: ["evidence", "forum"],
      agentSlug: "research-agent",
      agentKeyVersion: 1,
    });
    const agentIdentityId = await ctx.db.insert("agentIdentities", {
      agentId: "research-agent",
      userId: agentUserId,
      ownerUserId: ownerId,
      scopes: ["evidence", "forum"],
      status: "active",
      keyVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    await ctx.db.insert("authIdentityLinks", {
      tokenIdentifier: ownerTokenIdentifier,
      provider: "workos-authkit",
      workosUserId: ownerWorkosUserId,
      userId: ownerId,
      email: "owner@example.test",
      linkedAt: 1,
    });
    return { ownerId, agentUserId, agentIdentityId };
  });
  const owner = t.withIdentity({
    issuer: "https://api.workos.com/",
    subject: ownerWorkosUserId,
    tokenIdentifier: ownerTokenIdentifier,
    email: "owner@example.test",
    emailVerified: true,
  });
  const agent = t.withIdentity({
    issuer,
    subject: registrationId,
    tokenIdentifier: `${issuer}|${registrationId}`,
    aud: WORKOS_AGENT_RESOURCE,
    scope: "evidence",
    act: { sub: ownerWorkosUserId },
  });
  return { t, owner, agent, ...ids };
}

describe("WorkOS Agent Registration identity mapping", () => {
  test("links an owner-claimed registration to the existing local agent identity", async () => {
    const f = await fixture();
    await expect(
      f.owner.mutation(api.agentIdentity.linkMyWorkOSAgentRegistration, {
        registrationId,
        agentId: "research-agent",
      }),
    ).resolves.toEqual({ status: "linked", agentId: "research-agent" });

    const resolved = await f.agent.run(getCurrentUser);
    expect(resolved).toMatchObject({
      _id: f.agentUserId,
      agentSlug: "research-agent",
      role: "reader",
      agentScopes: ["evidence"],
    });
    await expect(
      f.owner.query(api.agentIdentity.listMyWorkOSAgentRegistrations, {}),
    ).resolves.toEqual([
      {
        registrationId,
        agentId: "research-agent",
        status: "active",
        createdAt: expect.any(Number),
        revokedAt: null,
      },
    ]);
  });

  test("rejects a registration used by a different WorkOS actor or resource", async () => {
    const f = await fixture();
    await f.owner.mutation(api.agentIdentity.linkMyWorkOSAgentRegistration, {
      registrationId,
      agentId: "research-agent",
    });

    const wrongActor = f.t.withIdentity({
      issuer,
      subject: registrationId,
      tokenIdentifier: `${issuer}|wrong-actor`,
      aud: WORKOS_AGENT_RESOURCE,
      scope: "evidence",
      act: { sub: "user_someone-else" },
    });
    const wrongAudience = f.t.withIdentity({
      issuer,
      subject: registrationId,
      tokenIdentifier: `${issuer}|wrong-audience`,
      aud: "https://www.symbaiex.com/api/plugin/mcp",
      scope: "evidence",
      act: { sub: ownerWorkosUserId },
    });
    const wrongScope = f.t.withIdentity({
      issuer,
      subject: registrationId,
      tokenIdentifier: `${issuer}|wrong-scope`,
      aud: WORKOS_AGENT_RESOURCE,
      scope: "forum",
      act: { sub: ownerWorkosUserId },
    });

    await expect(wrongActor.run(getCurrentUser)).resolves.toBeNull();
    await expect(wrongAudience.run(getCurrentUser)).resolves.toBeNull();
    await expect(wrongScope.run(getCurrentUser)).resolves.toBeNull();
  });

  test("owner revocation immediately disables the WorkOS registration mapping", async () => {
    const f = await fixture();
    await f.owner.mutation(api.agentIdentity.linkMyWorkOSAgentRegistration, {
      registrationId,
      agentId: "research-agent",
    });
    await f.owner.mutation(api.agentIdentity.revokeMyWorkOSAgentRegistration, {
      registrationId,
    });

    await expect(f.agent.run(getCurrentUser)).resolves.toBeNull();
    await expect(
      f.owner.query(api.agentIdentity.listMyWorkOSAgentRegistrations, {}),
    ).resolves.toMatchObject([{ status: "revoked", registrationId }]);
  });

  test("a user cannot map a registration onto another owner's agent", async () => {
    const f = await fixture();
    const otherOwner = await f.t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Other owner",
        role: "reader",
        email: "other@example.test",
        emailVerificationTime: 1,
      });
      const agentUserId = await ctx.db.insert("users", {
        name: "Other agent",
        isAgent: true,
        agentStatus: "active",
        agentScopes: ["evidence"],
        agentKeyVersion: 1,
      });
      await ctx.db.insert("agentIdentities", {
        agentId: "other-agent",
        userId: agentUserId,
        ownerUserId: userId,
        scopes: ["evidence"],
        status: "active",
        keyVersion: 1,
        createdAt: 1,
        updatedAt: 1,
        publicKey: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      });
      return userId;
    });
    expect(otherOwner).not.toBe(f.ownerId);
    await expect(
      f.owner.mutation(api.agentIdentity.linkMyWorkOSAgentRegistration, {
        registrationId,
        agentId: "other-agent",
      }),
    ).rejects.toThrow(/active evidence agent/i);
  });
});
