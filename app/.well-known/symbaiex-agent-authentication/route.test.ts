import { describe, expect, test } from "vitest";

import { GET } from "./route";

describe("SYMBaiEX agent authentication metadata", () => {
  test("describes only the implemented Ed25519 flow", async () => {
    const metadata = await GET().json();

    expect(metadata).toMatchObject({
      protocol: "symbaiex_ed25519_challenge_v1",
      protocol_type: "custom",
      oauth2: {
        supported: false,
        authorization_endpoint: null,
        token_endpoint: null,
        registration_endpoint: null,
      },
      protected_resource: "https://www.symbaiex.com/api/agent/mcp",
      signed_challenge_audience: "https://www.symbaiex.com/api/agent/mcp",
      audience_binding: {
        signed_challenge: true,
        access_token_aud_claim: false,
      },
      endpoints: {
        challenge: "https://www.symbaiex.com/api/agent/auth/challenge",
        sign_in: "https://www.symbaiex.com/api/agent/auth/sign-in",
        refresh: "https://www.symbaiex.com/api/agent/auth/refresh",
      },
    });
  });
});
