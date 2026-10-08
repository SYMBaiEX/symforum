/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

const AUTHKIT_ISSUER = "https://api.workos.com/";
const CONVEX_ISSUER = "https://symbaiex.convex.site";

afterEach(() => vi.unstubAllEnvs());

describe("WorkOS AuthKit identity linking", () => {
  test("requires explicit proof before linking an email to an existing account", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "Existing user",
        email: "existing@example.test",
        emailVerificationTime: 1_800_000_000_000,
        username: "existing-handle",
        usernameNormalized: "existing-handle",
        usernameSource: "chosen",
        role: "reader",
      }),
    );
    const workos = t.withIdentity({
      issuer: AUTHKIT_ISSUER,
      subject: "user_01existingworkosuser",
      tokenIdentifier: `${AUTHKIT_ISSUER}|user_01existingworkosuser`,
      email: "existing@example.test",
      emailVerified: true,
    });

    await expect(
      workos.mutation(api.authKitIdentity.ensureAuthKitIdentity, {}),
    ).resolves.toMatchObject({ status: "link_required" });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("users").collect()).toHaveLength(1);
      expect(await ctx.db.query("authIdentityLinks").collect()).toHaveLength(0);
      expect(await ctx.db.get("users", userId)).toMatchObject({
        usernameNormalized: "existing-handle",
      });
    });
  });

  test("proof-links the WorkOS identity to the existing canonical user id", async () => {
    vi.stubEnv("CONVEX_SITE_URL", CONVEX_ISSUER);
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "Existing user",
        email: "existing@example.test",
        emailVerificationTime: 1_800_000_000_000,
        username: "existing-handle",
        usernameNormalized: "existing-handle",
        usernameSource: "chosen",
        role: "reader",
      }),
    );
    const legacy = t.withIdentity({
      issuer: CONVEX_ISSUER,
      subject: userId,
      tokenIdentifier: `${CONVEX_ISSUER}|${userId}`,
    });
    const { challenge } = await legacy.mutation(
      api.authKitIdentity.beginAuthKitLink,
      { email: "existing@example.test" },
    );
    const workos = t.withIdentity({
      issuer: AUTHKIT_ISSUER,
      subject: "user_01existingworkosuser",
      tokenIdentifier: `${AUTHKIT_ISSUER}|user_01existingworkosuser`,
      email: "existing@example.test",
      emailVerified: true,
    });

    await expect(
      workos.mutation(api.authKitIdentity.completeAuthKitLink, { challenge }),
    ).resolves.toMatchObject({ status: "linked", userId });
    await expect(
      workos.mutation(api.authKitIdentity.ensureAuthKitIdentity, {}),
    ).resolves.toMatchObject({ status: "linked", userId });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("users").collect()).toHaveLength(1);
      expect(await ctx.db.get("users", userId)).toMatchObject({
        usernameNormalized: "existing-handle",
        email: "existing@example.test",
      });
      expect(await ctx.db.query("authIdentityLinks").collect()).toHaveLength(1);
    });
  });

  test("does not create a first-party account without a verified email", async () => {
    const t = convexTest(schema, modules);
    const workos = t.withIdentity({
      issuer: AUTHKIT_ISSUER,
      subject: "user_01unverifiedworkosuser",
      tokenIdentifier: `${AUTHKIT_ISSUER}|user_01unverifiedworkosuser`,
      email: "unverified@example.test",
      emailVerified: false,
    });

    await expect(
      workos.mutation(api.authKitIdentity.ensureAuthKitIdentity, {
        requestedHandle: "new-handle",
      }),
    ).resolves.toMatchObject({ status: "verified_email_required" });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("users").collect()).toHaveLength(0);
    });
  });
});
