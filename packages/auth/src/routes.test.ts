import { beforeEach, describe, expect, test, vi } from "vitest";
const { getSignInUrl } = vi.hoisted(() => ({
  getSignInUrl: vi.fn(async () => "https://auth.example.invalid/sign-in"),
}));
vi.mock("@workos-inc/authkit-nextjs", () => ({
  getSignInUrl,
  getSignUpUrl: vi.fn(),
  handleAuth: () => vi.fn(),
  signOut: vi.fn(),
}));
import { authSignIn, authSignUp } from "./routes";

beforeEach(() => {
  getSignInUrl.mockClear();
  vi.stubEnv("NEXT_PUBLIC_WORKOS_ENABLED", "true");
  vi.stubEnv("WORKOS_CLIENT_ID", "client_fixture");
  vi.stubEnv("WORKOS_API_KEY", "fixture");
  vi.stubEnv("WORKOS_COOKIE_PASSWORD", "x".repeat(32));
  vi.stubEnv(
    "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
    "https://forum.example.invalid/callback",
  );
  vi.stubEnv("WORKOS_COOKIE_DOMAIN", "");
});
describe("private sign-in identifiers", () => {
  test.each(["public_handle", "nonexistent_handle", ""])(
    'never looks up or reveals a mailbox for "%s"',
    async (identifier) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const response = await authSignIn(
        new Request(
          `https://forum.example.invalid/api/auth/sign-in?identifier=${identifier}`,
        ),
      );
      expect(response.status).toBe(303);
      expect(getSignInUrl).toHaveBeenCalledWith({
        loginHint: undefined,
        returnTo: "/",
      });
      expect(fetch).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    },
  );
  test("only hints an email entered by the user and rejects an external return path", async () => {
    await authSignIn(
      new Request(
        "https://forum.example.invalid/api/auth/sign-in?identifier=User%40example.com&returnTo=//evil.invalid",
      ),
    );
    expect(getSignInUrl).toHaveBeenCalledWith({
      loginHint: "user@example.com",
      returnTo: "/",
    });
  });
});

describe("inactive WorkOS compatibility entry points", () => {
  test.each(["true", "false"])(
    "native sign-in is used with Better Auth=%s",
    async (enabled) => {
      vi.stubEnv("NEXT_PUBLIC_WORKOS_ENABLED", "false");
      vi.stubEnv("NEXT_PUBLIC_BETTER_AUTH_ENABLED", enabled);
      for (const [handler, mode] of [
        [authSignIn, "signIn"],
        [authSignUp, "signUp"],
      ] as const) {
        const response = await handler(
          new Request(
            "https://forum.example.invalid/api/auth/sign-in?identifier=private_handle&returnTo=//evil.invalid",
          ),
        );
        const destination = new URL(response.headers.get("location")!);
        expect(response.status).toBe(303);
        expect(destination.origin).toBe("https://forum.example.invalid");
        expect(destination.pathname).toBe("/signin");
        expect(destination.searchParams.get("mode")).toBe(mode);
        expect(destination.searchParams.get("redirectTo")).toBe("/");
        expect(destination.searchParams.has("identifier")).toBe(false);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
      }
      expect(getSignInUrl).not.toHaveBeenCalled();
    },
  );
});
