import { expect, test } from "vitest";
import { authKitProviderProps } from "./provider-state";

test("disabled WorkOS auth does not call AuthKit server actions", () => {
  expect(authKitProviderProps(false)).toEqual({
    initialAuth: { user: null },
    onSessionExpired: false,
  });
});

test("enabled WorkOS auth reads the session through the AuthKit proxy", () => {
  expect(authKitProviderProps(true)).toEqual({});
});
