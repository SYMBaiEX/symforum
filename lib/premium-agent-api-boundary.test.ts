import { afterEach, describe, expect, test, vi } from "vitest";
import {
  PREMIUM_AGENT_API_HOST,
  configuredPremiumAgentApiHost,
  premiumAgentApiHeaders,
  premiumAgentApiState,
  premiumAgentApiUnavailable,
  premiumPaymentRequired,
} from "./premium-agent-api-boundary";

const request = (headers: HeadersInit = {}) =>
  new Request(`https://${PREMIUM_AGENT_API_HOST}/v1/universal-search?q=test`, {
    headers: { host: PREMIUM_AGENT_API_HOST, ...headers },
  });

describe("premium agent API boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("fails closed by default and does not advertise an unconfigured host", () => {
    expect(premiumAgentApiState(request())).toBe("disabled");
    const response = premiumAgentApiUnavailable(request());
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("requires the exact configured hostname even when the feature is enabled", () => {
    vi.stubEnv("PREMIUM_AGENT_API_ENABLED", "true");
    expect(premiumAgentApiState(request())).toBe("host-unconfigured");
    vi.stubEnv("PREMIUM_AGENT_API_HOST", "api.symbaiex.com");
    expect(configuredPremiumAgentApiHost()).toBeNull();
    expect(premiumAgentApiState(request())).toBe("host-unconfigured");
    vi.stubEnv("PREMIUM_AGENT_API_HOST", PREMIUM_AGENT_API_HOST);
    expect(
      premiumAgentApiState(
        new Request(`https://www.symbaiex.com/v1/status`, {
          headers: { host: "www.symbaiex.com" },
        }),
      ),
    ).toBe("wrong-host");
  });

  test("binds URL, Host, forwarding host, and browser Origin to the exact host", () => {
    vi.stubEnv("PREMIUM_AGENT_API_ENABLED", "true");
    vi.stubEnv("PREMIUM_AGENT_API_HOST", PREMIUM_AGENT_API_HOST);
    expect(
      premiumAgentApiState(
        request({
          "x-forwarded-host": PREMIUM_AGENT_API_HOST,
          origin: `https://${PREMIUM_AGENT_API_HOST}`,
        }),
      ),
    ).toBe("ready");
    expect(
      premiumAgentApiState(request({ "x-forwarded-host": "www.symbaiex.com" })),
    ).toBe("wrong-host");
    expect(premiumAgentApiState(request({ origin: "https://www.symbaiex.com" }))).toBe(
      "origin-not-allowed",
    );
    const headers = premiumAgentApiHeaders(
      request({ origin: `https://${PREMIUM_AGENT_API_HOST}` }),
    );
    expect(headers.get("access-control-allow-origin")).toBe(
      `https://${PREMIUM_AGENT_API_HOST}`,
    );
    expect(headers.get("x-frame-options")).toBe("DENY");
  });

  test("keeps payment-required metadata truthful, structured, and dormant", async () => {
    vi.stubEnv("PREMIUM_AGENT_API_ENABLED", "true");
    vi.stubEnv("PREMIUM_AGENT_API_HOST", PREMIUM_AGENT_API_HOST);
    const response = premiumPaymentRequired(request());
    expect(response.status).toBe(402);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    await expect(response.json()).resolves.toMatchObject({
      status: 402,
      title: "Payment Required",
    });
  });
});
