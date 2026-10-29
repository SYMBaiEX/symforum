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
import { authSignIn } from "./routes";

beforeEach(() => {
  getSignInUrl.mockClear();
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
