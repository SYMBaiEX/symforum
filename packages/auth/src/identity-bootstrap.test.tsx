// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  path: "/signin",
  auth: { isLoading: true, isAuthenticated: false },
  data: null as null | { user: { id: string } },
}));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => state.auth,
  useMutation: () => vi.fn(),
}));
vi.mock("./identity-client", () => ({
  identityClient: { useSession: () => ({ data: state.data }) },
}));
import { IdentityBootstrap } from "./identity-bootstrap";

beforeEach(() => {
  state.path = "/signin";
  state.auth = { isLoading: true, isAuthenticated: false };
  state.data = null;
});

function render() {
  return renderToStaticMarkup(
    <IdentityBootstrap>
      <p>Active sign-in form</p>
    </IdentityBootstrap>,
  );
}

test("guest session refresh does not remove the public sign-in form", () => {
  expect(render()).toContain("Active sign-in form");
});
test("public sign-in remains mounted during authenticated identity bootstrap", () => {
  state.auth = { isLoading: false, isAuthenticated: true };
  state.data = { user: { id: "fixture-user" } };
  expect(render()).toContain("Active sign-in form");
});
test.each(["/account/connections", "/signin-private"])(
  "%s still waits for verified auth",
  (path) => {
    state.path = path;
    expect(render()).toContain("Verifying your account");
    expect(render()).not.toContain("Active sign-in form");
  },
);
test("protected page still waits for identity bootstrap after session recognition", () => {
  state.path = "/account/connections";
  state.auth = { isLoading: false, isAuthenticated: true };
  state.data = { user: { id: "fixture-user" } };
  expect(render()).toContain("Verifying your account");
  expect(render()).not.toContain("Active sign-in form");
});
