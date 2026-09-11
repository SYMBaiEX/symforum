"use node";
import { createHmac } from "node:crypto";
import { v } from "convex/values";
import { internalAction, env } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  serviceAuthKeys,
  signServiceJwt,
  verifyServiceJwt,
} from "../lib/agent-service-auth-jwt";
import {
  SERVICE_AUTH_JWT,
  SERVICE_AUTH_CLAIM,
  SERVICE_AUTH_RESOURCE,
  serviceAuthEnabled,
  normalizeServiceAuthEmail,
} from "../lib/agent-service-auth-config";

const failure = (error: string, status = 400) => ({
  status,
  body: JSON.stringify({ error }),
});
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export const dispatch = internalAction({
  args: {
    operation: v.union(
      v.literal("identity"),
      v.literal("claim"),
      v.literal("token"),
      v.literal("revoke"),
      v.literal("jwks"),
    ),
    body: v.string(),
    source: v.string(),
  },
  returns: v.object({ status: v.number(), body: v.string() }),
  handler: async (
    ctx,
    { operation, body, source },
  ): Promise<{ status: number; body: string }> => {
    if (!serviceAuthEnabled(env)) return failure("not_found", 404);
    if (
      !env.AGENT_SERVICE_AUTH_RELAY_SECRET ||
      env.AGENT_SERVICE_AUTH_RELAY_SECRET.length < 32
    )
      return failure("temporarily_unavailable", 503);
    const sourceHash = createHmac("sha256", env.AGENT_SERVICE_AUTH_RELAY_SECRET)
      .update(source)
      .digest("hex");
    if (
      !(await ctx.runMutation(internal.agentServiceAuth.consumeRequest, {
        sourceHash,
      }))
    )
      return failure("rate_limited", 429);
    // Even read-only discovery verifies all key configuration before advertising readiness.
    const keys = serviceAuthKeys(env);
    if (operation === "jwks")
      return { status: 200, body: JSON.stringify(keys.jwks) };
    if (operation === "identity" || operation === "claim") {
      let input: unknown;
      try {
        input = JSON.parse(body);
      } catch {
        return failure("invalid_request");
      }
      if (!isRecord(input)) return failure("invalid_request");
      let answer: string;
      if (operation === "identity") {
        if (input.type === "anonymous") return failure("anonymous_not_enabled");
        if (input.type === "identity_assertion")
          return failure("issuer_not_enabled");
        const email = normalizeServiceAuthEmail(input.login_hint);
        if (
          input.type !== "service_auth" ||
          !email ||
          Object.keys(input).some(
            (key) => !["type", "login_hint"].includes(key),
          )
        )
          return failure("invalid_request");
        answer = await ctx.runMutation(internal.agentServiceAuth.register, {
          email,
          sourceHash,
        });
      } else {
        const email = normalizeServiceAuthEmail(input.email);
        if (
          !email ||
          typeof input.claim_token !== "string" ||
          input.claim_token.length > 100 ||
          Object.keys(input).some(
            (key) => !["email", "claim_token"].includes(key),
          )
        )
          return failure("invalid_request");
        answer = await ctx.runMutation(internal.agentServiceAuth.retryClaim, {
          email,
          claimToken: input.claim_token,
        });
      }
      const parsed = JSON.parse(answer) as {
        status?: number | string;
        error?: string;
      };
      return parsed.error
        ? failure(
            parsed.error,
            typeof parsed.status === "number" ? parsed.status : 400,
          )
        : { status: 200, body: answer };
    }
    const form = new URLSearchParams(body);
    if ([...form.keys()].some((key) => form.getAll(key).length !== 1))
      return failure("invalid_request");
    if (operation === "revoke") {
      const token = form.get("token");
      if (
        !token ||
        [...form.keys()].some(
          (key) => !["token", "token_type_hint"].includes(key),
        )
      )
        return failure("invalid_request");
      let verified;
      try {
        verified = verifyServiceJwt(keys, token, "access", Date.now(), true);
      } catch {
        return { status: 200, body: "" };
      }
      await ctx.runMutation(internal.agentServiceAuth.revokeToken, {
        jti: verified.jti,
        registrationId: verified.registrationId,
      });
      return { status: 200, body: "" };
    }
    const grant = form.get("grant_type");
    if (grant !== SERVICE_AUTH_JWT && grant !== SERVICE_AUTH_CLAIM)
      return failure("unsupported_grant_type");
    if (
      [...form.keys()].some(
        (key) =>
          ![
            "grant_type",
            "resource",
            "scope",
            grant === SERVICE_AUTH_JWT ? "assertion" : "claim_token",
          ].includes(key),
      )
    )
      return failure("invalid_request");
    if (form.has("resource") && form.get("resource") !== SERVICE_AUTH_RESOURCE)
      return failure("invalid_target");
    if (form.has("scope") && form.get("scope") !== "evidence")
      return failure("invalid_scope");
    let issueArgs: {
      claimToken?: string;
      registrationId?: Id<"agentServiceRegistrations">;
      assertionExpiresAt?: number;
    };
    if (grant === SERVICE_AUTH_CLAIM) {
      const claimToken = form.get("claim_token");
      if (!claimToken || claimToken.length > 100)
        return failure("invalid_request");
      issueArgs = { claimToken };
    } else {
      try {
        const verified = verifyServiceJwt(
          keys,
          form.get("assertion") ?? "",
          "assertion",
        );
        // The internal mutation's v.id validator rejects impossible registration IDs.
        issueArgs = {
          registrationId:
            verified.registrationId as Id<"agentServiceRegistrations">,
          assertionExpiresAt: verified.expiresAt,
        };
      } catch {
        return failure("invalid_grant");
      }
    }
    const answer: string = await ctx.runMutation(
      internal.agentServiceAuth.issue,
      issueArgs,
    );
    const issued = JSON.parse(answer) as {
      error?: string;
      status?: number;
      registrationId: string;
      jti: string;
      issuedAt: number;
      expiresAt: number;
      assertionExpiresAt: number;
    };
    if (issued.error) return { status: issued.status ?? 400, body: answer };
    const accessToken = signServiceJwt(keys, issued, "access");
    return {
      status: 200,
      body: JSON.stringify({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: Math.max(
          0,
          Math.floor((issued.expiresAt - Date.now()) / 1000),
        ),
        scope: "evidence",
        ...(grant === SERVICE_AUTH_CLAIM
          ? {
              identity_assertion: signServiceJwt(
                keys,
                { ...issued, expiresAt: issued.assertionExpiresAt },
                "assertion",
              ),
              assertion_expires: new Date(
                Math.floor(issued.assertionExpiresAt / 1000) * 1000,
              ).toISOString(),
            }
          : {}),
      }),
    };
  },
});
