/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { bytesToBase64Url, sha256Base64Url } from "./agentIdentityCrypto";
import { agentJoinMessage } from "./agentJoin";

const modules = import.meta.glob("./**/*.ts");
function setup() {
  const t = convexTest(schema, modules);
  registerLimiter(t);
  return t;
}
type Test = ReturnType<typeof setup>;
beforeEach(() => {
  vi.stubEnv("CONVEX_SITE_URL", "https://strong-bee-384.convex.site");
  vi.stubEnv("AGENT_SELF_JOIN_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());
async function registration(t: Test) {
  const key = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const publicKey = bytesToBase64Url(
    new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey)),
  );
  const sourceHash = await sha256Base64Url("isolated-source");
  const issued = await t.mutation(internal.agentJoin.begin, {
    publicKey,
    sourceHash,
  });
  if (issued.status !== "ready") throw new Error("Expected challenge");
  expect(issued.message).toBe(
    agentJoinMessage(issued.nonce, publicKey, issued.expiresAt),
  );
  const signature = bytesToBase64Url(
    new Uint8Array(
      await crypto.subtle.sign(
        "Ed25519",
        key.privateKey,
        new TextEncoder().encode(issued.message),
      ),
    ),
  );
  return {
    publicKey,
    sourceHash,
    nonce: issued.nonce,
    signature,
    name: "Outside researcher",
    description: "A labelled test agent",
  };
}
test("self registration is key-proven, labelled and unable to publish before a verified owner claims it", async () => {
  const t = setup(),
    args = await registration(t);
  const result = await t.mutation(internal.agentJoin.register, args);
  expect(result.status).toBe("pending_owner_claim");
  const pending = await t.run((ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_usernameNormalized", (q) =>
        q.eq("usernameNormalized", result.agentId),
      )
      .unique(),
  );
  expect(pending).toMatchObject({
    isAgent: true,
    role: "reader",
    agentStatus: "revoked",
    agentScopes: [],
  });
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Owner",
      role: "reader",
      emailVerificationTime: 1,
    }),
  );
  const human = t.withIdentity({
    issuer: "https://strong-bee-384.convex.site",
    subject: owner + "|session",
  });
  expect(
    await human.mutation(api.agentJoin.claim, {
      claimToken: result.claimToken,
    }),
  ).toMatchObject({ status: "claimed", agentId: result.agentId });
  expect(await t.run((ctx) => ctx.db.get("users", pending!._id))).toMatchObject(
    { agentStatus: "active", agentScopes: ["forum"], role: "reader" },
  );
  const identity = await t.run((ctx) =>
    ctx.db
      .query("agentIdentities")
      .withIndex("by_agentId", (q) => q.eq("agentId", result.agentId))
      .unique(),
  );
  expect(identity).toMatchObject({
    ownerUserId: owner,
    publicKey: args.publicKey,
    scopes: ["forum"],
    credentialKind: "ed25519",
  });
  await expect(
    human.mutation(api.agentJoin.claim, { claimToken: result.claimToken }),
  ).rejects.toThrow(/Invalid or expired/);
});
test("a proof cannot be replayed, moved to another source or used to register twice", async () => {
  const t = setup(),
    args = await registration(t);
  await expect(
    t.mutation(internal.agentJoin.register, {
      ...args,
      sourceHash: await sha256Base64Url("other"),
    }),
  ).rejects.toThrow(/proof/);
  await t.mutation(internal.agentJoin.register, args);
  await expect(t.mutation(internal.agentJoin.register, args)).rejects.toThrow(
    /proof/,
  );
});
test("unverified people and AI accounts cannot claim another agent", async () => {
  const t = setup(),
    args = await registration(t),
    result = await t.mutation(internal.agentJoin.register, args);
  for (const profile of [
    { name: "Unverified" },
    { name: "Agent", isAgent: true, emailVerificationTime: 1 },
  ]) {
    const id = await t.run((ctx) => ctx.db.insert("users", profile));
    await expect(
      t
        .withIdentity({
          issuer: "https://strong-bee-384.convex.site",
          subject: id + "|session",
        })
        .mutation(api.agentJoin.claim, { claimToken: result.claimToken }),
    ).rejects.toThrow(/verified human/);
  }
});
test("expired proofs and disabled registration do not create accounts", async () => {
  const t = setup(),
    args = await registration(t);
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("agentJoinChallenges")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .unique();
    await ctx.db.patch("agentJoinChallenges", row!._id, {
      expiresAt: Date.now() - 1,
    });
  });
  await expect(t.mutation(internal.agentJoin.register, args)).rejects.toThrow(
    /proof/,
  );
  vi.stubEnv("AGENT_SELF_JOIN_ENABLED", "false");
  await expect(
    t.mutation(internal.agentJoin.begin, {
      publicKey: args.publicKey,
      sourceHash: args.sourceHash,
    }),
  ).rejects.toThrow(/not enabled/);
});
