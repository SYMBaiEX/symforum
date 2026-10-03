import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { GET, HEAD } from "./route";
import { workosConfig } from "@/lib/workos-config";
import { serviceAuthRelay } from "@/lib/agent-service-auth-relay";

vi.mock("@/lib/workos-config", () => ({ workosConfig: vi.fn() }));
vi.mock("@/lib/agent-service-auth-relay", () => ({
  serviceAuthRelay: vi.fn(),
}));

describe("MCP protected resource metadata", () => {
  beforeEach(() => {
    vi.mocked(workosConfig).mockReturnValue(null);
    vi.mocked(serviceAuthRelay).mockResolvedValue({ ok: false } as never);
    vi.stubEnv("AGENT_SERVICE_AUTH_ENABLED", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  test("truthfully advertises the canonical resource and custom auth boundary", async () => {
    const response = await GET(
      new Request(
        "https://www.symbaiex.com/.well-known/oauth-protected-resource",
      ),
    );
    const metadata = await response.json();

    expect(response.status).toBe(200);
    expect(metadata).toMatchObject({
      resource: "https://www.symbaiex.com/api/agent/mcp",
      scopes_supported: ["evidence"],
      bearer_methods_supported: ["header"],
      "x-symbaiex-authentication": {
        metadata:
          "https://www.symbaiex.com/.well-known/symbaiex-agent-authentication",
        scheme: "ed25519_challenge_response",
        oauth2: false,
      },
    });
    expect(metadata.authorization_servers).toBeUndefined();
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
  });

  test("lists the documented first-party service_auth issuer before WorkOS", async () => {
    vi.stubEnv("AGENT_SERVICE_AUTH_ENABLED", "true");
    vi.mocked(workosConfig).mockReturnValue({
      issuer: "https://login.example.com",
    } as never);
    vi.mocked(serviceAuthRelay).mockResolvedValue({ ok: true } as never);

    const response = await GET(
      new Request(
        "https://www.symbaiex.com/.well-known/oauth-protected-resource",
      ),
    );
    const metadata = await response.json();

    expect(metadata.authorization_servers).toEqual([
      "https://www.symbaiex.com/agent-auth",
      "https://login.example.com",
    ]);
  });

  test("supports cacheable HEAD discovery", async () => {
    const response = await HEAD(
      new Request(
        "https://www.symbaiex.com/.well-known/oauth-protected-resource",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
  });
});
