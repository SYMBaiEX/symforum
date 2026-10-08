import { describe, expect, test } from "vitest";
import {
  assertHumanAuthConfiguration,
  humanAuthConfigurationProblems,
} from "./session-config";

const configured = {
  NEXT_PUBLIC_WORKOS_ENABLED: "true",
  NEXT_PUBLIC_WORKOS_REDIRECT_URI: "https://www.symbaiex.com/callback",
  WORKOS_CLIENT_ID: "client_test",
  WORKOS_API_KEY: "test-key",
  WORKOS_COOKIE_PASSWORD: "test-only-password-at-least-32-characters",
  WORKOS_COOKIE_DOMAIN: ".symbaiex.com",
};

describe("shared human session configuration", () => {
  test("keeps legacy auth independent of WorkOS configuration", () => {
    expect(humanAuthConfigurationProblems({})).toEqual([]);
  });

  test.each([
    "symbaiex.com",
    "www.symbaiex.com",
    "forum.symbaiex.com",
    "blog.symbaiex.com",
    "news.symbaiex.com",
    "newsletter.symbaiex.com",
  ])("requires a shared encrypted cookie on %s", (hostname) => {
    const env = {
      ...configured,
      NEXT_PUBLIC_WORKOS_REDIRECT_URI: `https://${hostname}/callback`,
    };
    expect(humanAuthConfigurationProblems(env)).toEqual([]);
    expect(
      humanAuthConfigurationProblems({ ...env, WORKOS_COOKIE_DOMAIN: "" }),
    ).toContain(
      "WORKOS_COOKIE_DOMAIN must be .symbaiex.com for shared production sessions",
    );
  });

  test.each([
    "http://localhost:3000",
    "http://forum.localhost:3000",
    "http://127.0.0.1:3000",
    "https://preview.vercel.app",
    "https://untrusted.symbaiex.com",
    "https://symbaiex.com.evil.test",
  ])("uses host-only cookies on %s", (origin) => {
    const env = {
      ...configured,
      NEXT_PUBLIC_WORKOS_REDIRECT_URI: `${origin}/callback`,
      WORKOS_COOKIE_DOMAIN: "",
    };
    expect(humanAuthConfigurationProblems(env)).toEqual([]);
    expect(
      humanAuthConfigurationProblems({
        ...env,
        WORKOS_COOKIE_DOMAIN: ".symbaiex.com",
      }),
    ).toContain(
      "WORKOS_COOKIE_DOMAIN must be empty outside trusted symbaiex.com hosts",
    );
  });

  test.each([".com", ".evil.test", ".forum.symbaiex.com"])(
    "rejects incorrect production cookie scope %s",
    (domain) => {
      expect(
        humanAuthConfigurationProblems({
          ...configured,
          WORKOS_COOKIE_DOMAIN: domain,
        }),
      ).not.toEqual([]);
    },
  );

  test("reports missing credentials using names without exposing values", () => {
    expect(() =>
      assertHumanAuthConfiguration({
        ...configured,
        WORKOS_COOKIE_PASSWORD: "secret",
      }),
    ).toThrow("WORKOS_COOKIE_PASSWORD must contain at least 32 characters");
    const missing = humanAuthConfigurationProblems({
      NEXT_PUBLIC_WORKOS_ENABLED: "true",
    });
    expect(missing).toContain("WORKOS_CLIENT_ID is required");
    expect(missing).toContain("WORKOS_API_KEY is required");
    expect(
      missing.some((value) =>
        value.includes("NEXT_PUBLIC_WORKOS_REDIRECT_URI"),
      ),
    ).toBe(true);
  });

  test.each([
    "",
    "javascript:alert(1)",
    "https://user:pass@www.symbaiex.com/callback",
    "https://www.symbaiex.com/callback?next=secret",
    "https://www.symbaiex.com/callback#secret",
    "https://www.symbaiex.com/other",
    "http://www.symbaiex.com/callback",
    "http://preview.vercel.app/callback",
  ])("rejects invalid or insecure callback %s", (callback) => {
    expect(
      humanAuthConfigurationProblems({
        ...configured,
        NEXT_PUBLIC_WORKOS_REDIRECT_URI: callback,
      }),
    ).not.toEqual([]);
  });
});
