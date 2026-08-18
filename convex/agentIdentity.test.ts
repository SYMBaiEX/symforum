/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  AGENT_MCP_RESOURCE_AUDIENCE,
  LEGACY_AGENT_LOGIN_AUDIENCE,
  bytesToBase64Url,
  sha256Base64Url,
  verifyEd25519Signature,
} from "./agentIdentityCrypto";
import { requireAgentScope } from "./authz";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  return convexTest(schema, modules);
}

async function keyPair() {
  return await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
}

async function publicKeyBase64(key: CryptoKey) {
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.exportKey("raw", key)),
  );
}

async function seedOwner(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Owner",
      username: "owner",
      usernameNormalized: "owner",
      role: "owner",
    });
  });
}

async function seedReader(t: ReturnType<typeof setup>, username: string) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: username,
      username,
      usernameNormalized: username,
      role: "reader",
    });
  });
}

describe("agent identity authentication", () => {
  test("enrollment belongs to the signed-in account and challenge messages verify with the enrolled key", async () => {
    const t = setup();
    const ownerId = await seedOwner(t);
    const pair = await keyPair();
    const publicKey = await publicKeyBase64(pair.publicKey);
    const owner = t.withIdentity({ subject: ownerId });

    await expect(
      t.mutation(api.agentIdentity.enrollAgent, {
        agentId: "suki",
        publicKey,
        scopes: ["forum", "comments"],
      }),
    ).rejects.toThrow(/owner access|sign in/i);

    const enrolled = await owner.mutation(api.agentIdentity.enrollAgent, {
      agentId: "suki",
      publicKey,
      scopes: ["forum", "comments"],
    });
    expect(enrolled).toMatchObject({ agentId: "suki", keyVersion: 1 });

    const challenge = await t.mutation(
      api.agentIdentity.requestLoginChallenge,
      { agentId: "suki", audience: AGENT_MCP_RESOURCE_AUDIENCE },
    );
    expect(challenge.message).toContain("SYMBIEX_AGENT_LOGIN_V1");
    const signature = await crypto.subtle.sign(
      { name: "Ed25519" },
      pair.privateKey,
      new TextEncoder().encode(challenge.message),
    );
    await expect(
      verifyEd25519Signature({
        publicKey,
        signature: bytesToBase64Url(new Uint8Array(signature)),
        message: challenge.message,
      }),
    ).resolves.toBe(true);

    const context = await t.query(internal.agentIdentity.getLoginContext, {
      agentId: "suki",
      challenge: challenge.challenge,
      audience: challenge.audience,
    });
    expect(context).toMatchObject({
      agentId: "suki",
      audience: AGENT_MCP_RESOURCE_AUDIENCE,
      keyVersion: 1,
    });
  });

  test("new challenges bind to an MCP resource with explicit legacy-origin compatibility", async () => {
    const t = setup();
    const ownerId = await seedOwner(t);
    const pair = await keyPair();
    const owner = t.withIdentity({ subject: ownerId });
    const publicKey = await publicKeyBase64(pair.publicKey);
    await owner.mutation(api.agentIdentity.enrollAgent, {
      agentId: "canonical-agent",
      publicKey,
      scopes: ["evidence"],
    });
    await owner.mutation(api.agentIdentity.enrollAgent, {
      agentId: "legacy-agent",
      publicKey,
      scopes: ["evidence"],
    });

    await expect(
      t.mutation(api.agentIdentity.requestLoginChallenge, {
        agentId: "canonical-agent",
        audience: "agent-script",
      }),
    ).rejects.toThrow(/canonical MCP resource/i);
    await expect(
      t.mutation(api.agentIdentity.requestLoginChallenge, {
        agentId: "canonical-agent",
        audience: AGENT_MCP_RESOURCE_AUDIENCE,
      }),
    ).resolves.toMatchObject({ audience: AGENT_MCP_RESOURCE_AUDIENCE });
    await expect(
      t.mutation(api.agentIdentity.requestLoginChallenge, {
        agentId: "legacy-agent",
        audience: LEGACY_AGENT_LOGIN_AUDIENCE,
      }),
    ).resolves.toMatchObject({ audience: LEGACY_AGENT_LOGIN_AUDIENCE });
  });

  test("an account cannot manage another account's agent", async () => {
    const t = setup();
    const firstUserId = await seedReader(t, "first-user");
    const secondUserId = await seedReader(t, "second-user");
    const first = t.withIdentity({ subject: firstUserId });
    const second = t.withIdentity({ subject: secondUserId });
    const pair = await keyPair();
    const enrollment = await first.mutation(api.agentIdentity.enrollAgent, {
      agentId: "first-agent",
      publicKey: await publicKeyBase64(pair.publicKey),
      scopes: ["forum"],
    });

    await expect(
      second.query(api.agentIdentity.getAgentEnrollmentStatus, {
        agentId: enrollment.agentId,
      }),
    ).rejects.toThrow(/account owner/i);
    await expect(
      second.mutation(api.agentIdentity.rotateAgentKey, {
        agentId: enrollment.agentId,
        newPublicKey: await publicKeyBase64((await keyPair()).publicKey),
      }),
    ).rejects.toThrow(/account owner/i);
    await expect(
      second.mutation(api.agentIdentity.revokeAgent, {
        agentId: enrollment.agentId,
      }),
    ).rejects.toThrow(/account owner/i);
  });

  test("the developer console projection only includes the caller's agents and never a public key", async () => {
    const t = setup();
    const firstUserId = await seedReader(t, "console-first");
    const secondUserId = await seedReader(t, "console-second");
    const first = t.withIdentity({ subject: firstUserId });
    const second = t.withIdentity({ subject: secondUserId });
    const firstKey = await publicKeyBase64((await keyPair()).publicKey);
    const secondKey = await publicKeyBase64((await keyPair()).publicKey);
    await first.mutation(api.agentIdentity.enrollAgent, {
      agentId: "first-console-agent",
      publicKey: firstKey,
      scopes: ["forum"],
    });
    await second.mutation(api.agentIdentity.enrollAgent, {
      agentId: "second-console-agent",
      publicKey: secondKey,
      scopes: ["evidence"],
    });

    const result = await first.query(
      api.agentIdentity.listMyAgentConsoleStatus,
      {},
    );
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({
      agentId: "first-console-agent",
      status: "active",
      scopes: ["forum"],
      keyVersion: 1,
      quota: { usedUnits: 0, monthlyLimitUnits: 250 },
    });
    expect(JSON.stringify(result)).not.toContain(firstKey);
    expect(JSON.stringify(result)).not.toContain(secondKey);
    expect(JSON.stringify(result)).not.toContain("second-console-agent");

    await expect(
      t.query(api.agentIdentity.listMyAgentConsoleStatus, {}),
    ).rejects.toThrow(/sign in/i);
  });

  test("invalid, replayed, and expired challenges fail closed", async () => {
    const t = setup();
    const ownerId = await seedOwner(t);
    const pair = await keyPair();
    const publicKey = await publicKeyBase64(pair.publicKey);
    const owner = t.withIdentity({ subject: ownerId });
    await owner.mutation(api.agentIdentity.enrollAgent, {
      agentId: "belle",
      publicKey,
      scopes: ["forum"],
    });
    const challenge = await t.mutation(
      api.agentIdentity.requestLoginChallenge,
      { agentId: "belle", audience: AGENT_MCP_RESOURCE_AUDIENCE },
    );
    await expect(
      verifyEd25519Signature({
        publicKey,
        signature: bytesToBase64Url(new Uint8Array(64)),
        message: `${challenge.message}!`,
      }),
    ).resolves.toBe(false);

    const context = await t.query(internal.agentIdentity.getLoginContext, {
      agentId: "belle",
      challenge: challenge.challenge,
      audience: AGENT_MCP_RESOURCE_AUDIENCE,
    });
    expect(context).not.toBeNull();
    await t.mutation(internal.agentIdentity.consumeLoginChallenge, {
      challengeId: context!.challengeId,
      challengeHash: context!.challengeHash,
      agentId: context!.agentId,
      keyVersion: context!.keyVersion,
    });
    await expect(
      t.mutation(internal.agentIdentity.consumeLoginChallenge, {
        challengeId: context!.challengeId,
        challengeHash: context!.challengeHash,
        agentId: context!.agentId,
        keyVersion: context!.keyVersion,
      }),
    ).rejects.toThrow(/invalid|expired|consumed/i);

    const expiredChallenge = "expired-challenge-for-test";
    await t.run(async (ctx) => {
      await ctx.db.insert("agentLoginChallenges", {
        agentId: "belle",
        challengeHash: await sha256Base64Url(expiredChallenge),
        audience: "test",
        expiresAt: 1,
        createdAt: 1,
      });
    });
    await expect(
      t.query(internal.agentIdentity.getLoginContext, {
        agentId: "belle",
        challenge: expiredChallenge,
        audience: "test",
      }),
    ).resolves.toBeNull();
  });

  test("revoke and rotation invalidate the old key and preserve explicit scopes", async () => {
    const t = setup();
    const ownerId = await seedOwner(t);
    const first = await keyPair();
    const second = await keyPair();
    const owner = t.withIdentity({ subject: ownerId });
    await owner.mutation(api.agentIdentity.enrollAgent, {
      agentSlug: "mara",
      publicKey: await publicKeyBase64(first.publicKey),
      scopes: ["newsletter"],
    });
    await expect(
      owner.mutation(api.agentIdentity.rotateAgentKey, {
        agentId: "mara",
        newPublicKey: await publicKeyBase64(second.publicKey),
      }),
    ).resolves.toMatchObject({ keyVersion: 2, scopes: ["newsletter"] });
    await expect(
      owner.mutation(api.agentIdentity.revokeAgent, { agentId: "mara" }),
    ).resolves.toMatchObject({ agentId: "mara" });
    await expect(
      t.mutation(api.agentIdentity.requestLoginChallenge, {
        agentId: "mara",
        audience: AGENT_MCP_RESOURCE_AUDIENCE,
      }),
    ).rejects.toThrow(/not active/i);
  });

  test("agent scope helpers deny revoked, spoofed, or missing capabilities", async () => {
    const t = setup();
    const ownerId = await seedOwner(t);
    const pair = await keyPair();
    const owner = t.withIdentity({ subject: ownerId });
    const enrollment = await owner.mutation(api.agentIdentity.enrollAgent, {
      agentId: "scope-agent",
      publicKey: await publicKeyBase64(pair.publicKey),
      scopes: ["comments"],
    });
    const user = await t.run((ctx) => ctx.db.get("users", enrollment.userId));
    expect(() => requireAgentScope(user, "comments")).not.toThrow();
    expect(() => requireAgentScope(user, "forum")).toThrow(/forum scope/i);
    const revoked = { ...user!, agentStatus: "revoked" as const };
    expect(() => requireAgentScope(revoked, "comments")).toThrow(
      /active agent/i,
    );
    await expect(
      t.mutation(api.agentIdentity.enrollAgent, {
        agentId: "spoof",
        publicKey: await publicKeyBase64(pair.publicKey),
        scopes: ["comments"],
      }),
    ).rejects.toThrow(/owner access|sign in/i);
  });
});
