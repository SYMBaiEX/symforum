import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ validateCredential: vi.fn() }));
vi.mock("@workos-inc/node", () => ({
  WorkOS: class {
    agents = { validateCredential: mocks.validateCredential };
  },
}));

import { validateWorkOSAgentRegistrationCredential } from "./workos-agent-registration";
import { WORKOS_AGENT_RESOURCE } from "./workos-config";

const issuer = "https://registration-test.authkit.app";
const registrationId = "agent_reg_01ABCDEF12345678";

function tokenFor(claims: Record<string, unknown>) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "at+jwt" })}.${encode(claims)}.signature`;
}

beforeEach(() => {
  mocks.validateCredential.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("WorkOS Agent Registration credential validation", () => {
  test("does not intercept legacy credentials while the feature is disabled", async () => {
    const status = await validateWorkOSAgentRegistrationCredential(
      "Bearer legacy-local-token",
      { WORKOS_AGENT_REGISTRATION_ENABLED: "false" },
    );
    expect(status).toBe("not_applicable");
    expect(mocks.validateCredential).not.toHaveBeenCalled();
  });

  test("checks WorkOS revocation and the resource-bound evidence audience", async () => {
    const token = tokenFor({
      iss: issuer,
      sub: registrationId,
      aud: WORKOS_AGENT_RESOURCE,
      scope: "evidence",
      act: { sub: "user_123" },
    });
    mocks.validateCredential.mockResolvedValue({
      valid: true,
      registrationId,
      expiresAt: "2026-10-08T00:00:00.000Z",
      claims: {
        issuer,
        audience: WORKOS_AGENT_RESOURCE,
        registrationId,
        jti: "token_123",
        organizationId: "org_123",
        scope: "evidence",
        actor: { sub: "user_123" },
        expiresAt: 1_800_000_000,
        issuedAt: 1_799_999_000,
      },
    });

    await expect(
      validateWorkOSAgentRegistrationCredential(`Bearer ${token}`, {
        WORKOS_AGENT_REGISTRATION_ENABLED: "true",
        WORKOS_AUTHKIT_ISSUER: issuer,
        WORKOS_API_KEY: "test-api-key",
      }),
    ).resolves.toBe("valid");
    expect(mocks.validateCredential).toHaveBeenCalledWith({
      type: "access_token",
      credential: token,
      audience: WORKOS_AGENT_RESOURCE,
      checkForRevoked: true,
    });
  });

  test("rejects a WorkOS registration credential without the claimed evidence scope", async () => {
    const token = tokenFor({
      iss: issuer,
      sub: registrationId,
      aud: WORKOS_AGENT_RESOURCE,
    });
    mocks.validateCredential.mockResolvedValue({
      valid: true,
      registrationId,
      expiresAt: null,
      claims: {
        issuer,
        audience: WORKOS_AGENT_RESOURCE,
        registrationId,
        jti: "token_123",
        organizationId: "org_123",
        scope: "forum",
        actor: { sub: "user_123" },
        expiresAt: 1_800_000_000,
        issuedAt: 1_799_999_000,
      },
    });

    await expect(
      validateWorkOSAgentRegistrationCredential(`Bearer ${token}`, {
        WORKOS_AGENT_REGISTRATION_ENABLED: "true",
        WORKOS_AUTHKIT_ISSUER: issuer,
        WORKOS_API_KEY: "test-api-key",
      }),
    ).resolves.toBe("invalid");
  });

  test("fails closed when WorkOS cannot confirm revocation state", async () => {
    const token = tokenFor({
      iss: issuer,
      sub: registrationId,
      aud: WORKOS_AGENT_RESOURCE,
    });
    mocks.validateCredential.mockRejectedValue(new Error("service unavailable"));
    await expect(
      validateWorkOSAgentRegistrationCredential(`Bearer ${token}`, {
        WORKOS_AGENT_REGISTRATION_ENABLED: "true",
        WORKOS_AUTHKIT_ISSUER: issuer,
        WORKOS_API_KEY: "test-api-key",
      }),
    ).resolves.toBe("unavailable");
  });
});
