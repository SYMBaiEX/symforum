/// <reference types="vite/client" />
import { generateKeyPairSync } from "node:crypto";
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  getCurrentUser,
  getFirstPartyAuthUserId,
  hasAgentScope,
  hasSiteAdminAccess,
} from "./authz";
import {
  SERVICE_AUTH_CLAIM,
  SERVICE_AUTH_JWT,
  SERVICE_AUTH_ISSUER,
  SERVICE_AUTH_RESOURCE,
  SERVICE_AUTH_TOKEN_ID,
  SERVICE_AUTH_TOKEN_KIND,
} from "../lib/agent-service-auth-config";
import {
  serviceAuthKeys,
  verifyServiceJwt,
} from "../lib/agent-service-auth-jwt";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateJwk = {
  ...pair.privateKey.export({ format: "jwk" }),
  kid: "test-key",
};
const publicJwk = {
  ...pair.publicKey.export({ format: "jwk" }),
  kid: "test-key",
  alg: "RS256",
  use: "sig",
};
beforeEach(() => {
  vi.stubEnv("AGENT_SERVICE_AUTH_ENABLED", "true");
  vi.stubEnv("AGENT_SERVICE_AUTH_PRIVATE_JWK", JSON.stringify(privateJwk));
  vi.stubEnv(
    "AGENT_SERVICE_AUTH_PUBLIC_JWKS",
    JSON.stringify({ keys: [publicJwk] }),
  );
  vi.stubEnv(
    "AGENT_SERVICE_AUTH_RELAY_SECRET",
    "test-relay-secret-with-at-least-thirty-two-characters",
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
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
      email: "other@example.test",
    });
    const agentUserId = await ctx.db.insert("users", {
      role: "admin",
      isAgent: true,
      agentStatus: "active",
      agentScopes: ["evidence", "forum"],
      agentKeyVersion: 1,
    });
    const agentIdentityId = await ctx.db.insert("agentIdentities", {
      agentId: "service-agent",
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
  const dispatch = async (
    operation: "identity" | "claim" | "token" | "revoke" | "jwks",
    body = "",
  ) => {
    const response = await t.action(internal.agentServiceAuthTokens.dispatch, {
      operation,
      body,
      source: "test-source",
    });
    return {
      status: response.status,
      data: response.body ? JSON.parse(response.body) : null,
    };
  };
  const registration = await dispatch(
    "identity",
    JSON.stringify({ type: "service_auth", login_hint: "owner@example.test" }),
  );
  const attemptToken = new URL(
    registration.data.claim.verification_uri,
  ).searchParams.get("claim_attempt_token")!;
  const approve = () =>
    owner.mutation(api.agentServiceAuth.completeClaim, {
      attemptToken,
      userCode: registration.data.claim.user_code,
      agentId: "service-agent",
    });
  const poll = () =>
    dispatch(
      "token",
      new URLSearchParams({
        grant_type: SERVICE_AUTH_CLAIM,
        claim_token: registration.data.claim_token,
      }).toString(),
    );
  const exchange = (assertion: string, extra: Record<string, string> = {}) =>
    dispatch(
      "token",
      new URLSearchParams({
        grant_type: SERVICE_AUTH_JWT,
        assertion,
        ...extra,
      }).toString(),
    );
  return {
    t,
    owner,
    other,
    dispatch,
    registration: registration.data,
    attemptToken,
    approve,
    poll,
    exchange,
    ...ids,
  };
}

async function approved() {
  const f = await fixture();
  expect(await f.approve()).toEqual({ ok: true });
  const tokens = await f.poll();
  expect(tokens.status).toBe(200);
  const verified = verifyServiceJwt(
    serviceAuthKeys(process.env),
    tokens.data.access_token,
    "access",
  );
  const identity = {
    issuer: SERVICE_AUTH_ISSUER,
    subject: verified.registrationId,
    [SERVICE_AUTH_TOKEN_ID]: verified.jti,
    [SERVICE_AUTH_TOKEN_KIND]: "access",
  };
  return {
    ...f,
    tokens: tokens.data,
    verified,
    identity,
    agent: f.t.withIdentity(identity),
  };
}

describe("owner-approved service_auth", () => {
  test("issues no credentials before a human completes the exact bound ceremony", async () => {
    const f = await fixture();
    expect(f.registration.identity_assertion).toBeUndefined();
    expect(f.registration.access_token).toBeUndefined();
    expect((await f.poll()).data.error).toBe("authorization_pending");
    expect((await f.poll()).data.error).toBe("slow_down");
    expect(
      await f.other.query(api.agentServiceAuth.viewClaim, {
        attemptToken: f.attemptToken,
      }),
    ).toBeNull();
    expect(
      (
        await f.other.mutation(api.agentServiceAuth.completeClaim, {
          attemptToken: f.attemptToken,
          userCode: f.registration.claim.user_code,
          agentId: "service-agent",
        })
      ).ok,
    ).toBe(false);
    await expect(
      f.t.mutation(api.agentServiceAuth.completeClaim, {
        attemptToken: f.attemptToken,
        userCode: f.registration.claim.user_code,
        agentId: "service-agent",
      }),
    ).rejects.toThrow(/human owner/);
    const stored = await f.t.run((ctx) =>
      ctx.db.get("agentServiceRegistrations", f.registration.registration_id),
    );
    expect(JSON.stringify(stored)).not.toContain(f.registration.claim_token);
    expect(JSON.stringify(stored)).not.toContain(f.attemptToken);
    expect(JSON.stringify(stored)).not.toContain(
      `"${f.registration.claim.user_code}"`,
    );
  });

  test("binds only to an owned evidence agent and applies evidence-only principal to HTTP", async () => {
    const f = await approved();
    const user = await f.agent.run(getCurrentUser);
    expect(user?._id).toBe(f.agentUserId);
    expect(hasSiteAdminAccess(user)).toBe(false);
    expect(hasAgentScope(user, "forum")).toBe(false);
    expect(hasAgentScope(user, "evidence")).toBe(true);
    expect(await f.agent.run(getFirstPartyAuthUserId)).toBeNull();
    const response = await f.agent.fetch("/agent/v1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "status",
        input: {},
        idempotencyKey: "service-http-test",
        requestFingerprint: "service-http-status",
      }),
    });
    expect(response.status).toBe(200);
    expect(f.tokens.refresh_token).toBeUndefined();
    expect(f.tokens.scope).toBe("evidence");
    expect(
      await f.t
        .withIdentity({ ...f.identity, subject: f.ownerId })
        .run(getCurrentUser),
    ).toBeNull();
    expect(
      await f.t
        .withIdentity({ ...f.identity, [SERVICE_AUTH_TOKEN_KIND]: "assertion" })
        .run(getCurrentUser),
    ).toBeNull();
    expect(
      await f.t
        .withIdentity({ ...f.identity, [SERVICE_AUTH_TOKEN_ID]: "forged" })
        .run(getCurrentUser),
    ).toBeNull();
  });

  test("single credential revoke leaves assertion usable; owner disconnect kills every credential and issuance", async () => {
    const f = await approved();
    expect(
      (
        await f.dispatch(
          "revoke",
          new URLSearchParams({ token: f.tokens.access_token }).toString(),
        )
      ).status,
    ).toBe(200);
    expect((await f.dispatch("revoke", "token=unknown")).status).toBe(200);
    expect(await f.agent.run(getCurrentUser)).toBeNull();
    const refreshed = await f.exchange(f.tokens.identity_assertion, {
      resource: SERVICE_AUTH_RESOURCE,
    });
    expect(refreshed.status).toBe(200);
    await expect(
      f.other.mutation(api.agentServiceAuth.revokeRegistration, {
        registrationId: f.registration.registration_id,
      }),
    ).rejects.toThrow("not found");
    await f.owner.mutation(api.agentServiceAuth.revokeRegistration, {
      registrationId: f.registration.registration_id,
    });
    expect((await f.exchange(f.tokens.identity_assertion)).data.error).toBe(
      "invalid_grant",
    );
    expect(await f.agent.run(getCurrentUser)).toBeNull();
  });

  test.each([
    "owner deleted",
    "agent revoked",
    "key rotated",
    "scope removed",
    "disabled",
  ])("immediate fail-closed authorization: %s", async (change) => {
    const f = await approved();
    if (change === "disabled")
      vi.stubEnv("AGENT_SERVICE_AUTH_ENABLED", "false");
    else
      await f.t.run(async (ctx) => {
        if (change === "owner deleted") await ctx.db.delete("users", f.ownerId);
        if (change === "agent revoked")
          await ctx.db.patch("agentIdentities", f.agentIdentityId, {
            status: "revoked",
          });
        if (change === "key rotated")
          await ctx.db.patch("agentIdentities", f.agentIdentityId, {
            keyVersion: 2,
          });
        if (change === "scope removed")
          await ctx.db.patch("agentIdentities", f.agentIdentityId, {
            scopes: ["forum"],
          });
      });
    expect(await f.agent.run(getCurrentUser)).toBeNull();
    expect((await f.exchange(f.tokens.identity_assertion)).status).toBe(
      change === "disabled" ? 404 : 400,
    );
  });

  test("rejects token substitution, arbitrary scope/resource, malformed and unsupported requests", async () => {
    const f = await approved();
    expect((await f.exchange(f.tokens.access_token)).data.error).toBe(
      "invalid_grant",
    );
    expect(
      (
        await f.exchange(f.tokens.identity_assertion, {
          resource: "https://evil.test",
        })
      ).data.error,
    ).toBe("invalid_target");
    expect(
      (await f.exchange(f.tokens.identity_assertion, { scope: "forum" })).data
        .error,
    ).toBe("invalid_scope");
    expect(
      (await f.dispatch("token", "grant_type=refresh_token")).data.error,
    ).toBe("unsupported_grant_type");
    expect(
      (
        await f.dispatch(
          "token",
          `grant_type=${SERVICE_AUTH_JWT}&assertion=a&assertion=b`,
        )
      ).data.error,
    ).toBe("invalid_request");
    expect(
      (await f.dispatch("identity", '{"type":"anonymous"}')).data.error,
    ).toBe("anonymous_not_enabled");
    expect(
      (await f.dispatch("identity", '{"type":"identity_assertion"}')).data
        .error,
    ).toBe("issuer_not_enabled");
    expect(
      (
        await f.dispatch(
          "identity",
          '{"type":"service_auth","login_hint":"not-email"}',
        )
      ).data.error,
    ).toBe("invalid_request");
  });

  test("locks guessed codes, rotates same-email attempts, and refuses previous URLs", async () => {
    const f = await fixture();
    const wrong =
      f.registration.claim.user_code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++)
      expect(
        (
          await f.owner.mutation(api.agentServiceAuth.completeClaim, {
            attemptToken: f.attemptToken,
            userCode: wrong,
            agentId: "service-agent",
          })
        ).ok,
      ).toBe(false);
    expect((await f.approve()).ok).toBe(false);
    expect((await f.poll()).data.error).toBe("expired_token");
    expect(
      (
        await f.dispatch(
          "claim",
          JSON.stringify({
            claim_token: f.registration.claim_token,
            email: "other@example.test",
          }),
        )
      ).data.error,
    ).toBe("invalid_request");
    const retry = await f.dispatch(
      "claim",
      JSON.stringify({
        claim_token: f.registration.claim_token,
        email: "owner@example.test",
      }),
    );
    expect(retry.status).toBe(200);
    expect(
      await f.owner.query(api.agentServiceAuth.viewClaim, {
        attemptToken: f.attemptToken,
      }),
    ).toBeNull();
    const newAttempt = new URL(
      retry.data.claim_attempt.verification_uri,
    ).searchParams.get("claim_attempt_token")!;
    expect(
      (
        await f.owner.mutation(api.agentServiceAuth.completeClaim, {
          attemptToken: newAttempt,
          userCode: retry.data.claim_attempt.user_code,
          agentId: "service-agent",
        })
      ).ok,
    ).toBe(true);
  });

  test("expired code can restart only inside outer window; approvals cannot extend", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
      ctx.db.patch(
        "agentServiceRegistrations",
        f.registration.registration_id,
        { attemptExpiresAt: 0 },
      ),
    );
    expect((await f.poll()).data.error).toBe("expired_token");
    expect((await f.approve()).ok).toBe(false);
    await f.t.run((ctx) =>
      ctx.db.patch(
        "agentServiceRegistrations",
        f.registration.registration_id,
        { claimExpiresAt: 0 },
      ),
    );
    expect(
      (
        await f.dispatch(
          "claim",
          JSON.stringify({
            claim_token: f.registration.claim_token,
            email: "owner@example.test",
          }),
        )
      ).status,
    ).toBe(410);
    const g = await approved();
    await g.t.run((ctx) =>
      ctx.db.patch(
        "agentServiceRegistrations",
        g.registration.registration_id,
        { approvalExpiresAt: 0 },
      ),
    );
    expect((await g.exchange(g.tokens.identity_assertion)).data.error).toBe(
      "invalid_grant",
    );
    expect(await g.agent.run(getCurrentUser)).toBeNull();
  });

  test("concurrent approval is single-use; owner bulk revoke and expiry sweep are bounded", async () => {
    const f = await fixture();
    const approvals = await Promise.all([f.approve(), f.approve()]);
    expect(approvals.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await f.owner.mutation(api.agentServiceAuth.revokeAllMyRegistrations, {}),
    ).toBe(1);
    expect(
      await f.owner.query(api.agentServiceAuth.listMyRegistrations, {}),
    ).toEqual([]);
    await f.t.run((ctx) =>
      ctx.db.patch(
        "agentServiceRegistrations",
        f.registration.registration_id,
        { cleanupAt: 0 },
      ),
    );
    await f.t.mutation(internal.agentServiceAuth.cleanup, {});
    expect(
      await f.t.run((ctx) =>
        ctx.db.get("agentServiceRegistrations", f.registration.registration_id),
      ),
    ).toBeNull();
  });

  test("durable source rate limit and relay authentication fail closed", async () => {
    const f = await fixture();
    for (let i = 0; i < 4; i++)
      expect(
        (
          await f.dispatch(
            "identity",
            '{"type":"service_auth","login_hint":"owner@example.test"}',
          )
        ).status,
      ).toBe(200);
    expect(
      (
        await f.dispatch(
          "identity",
          '{"type":"service_auth","login_hint":"owner@example.test"}',
        )
      ).status,
    ).toBe(429);
    expect((await f.t.fetch("/agent-service-auth/jwks")).status).toBe(404);
    const valid = await f.t.fetch("/agent-service-auth/jwks", {
      headers: {
        "x-symbaiex-service-auth-relay":
          process.env.AGENT_SERVICE_AUTH_RELAY_SECRET!,
      },
    });
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ keys: [publicJwk] });
  });
});
