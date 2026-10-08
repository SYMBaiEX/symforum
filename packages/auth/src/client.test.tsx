import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { ReactNode } from "react";

const providers = vi.hoisted(() => ({
  legacy: vi.fn(),
  workos: vi.fn(),
  authkit: vi.fn(),
}));

vi.mock("@convex-dev/auth/nextjs", () => ({
  ConvexAuthNextjsProvider: ({ children }: { children: ReactNode }) => {
    providers.legacy();
    return children;
  },
}));
vi.mock("@convex-dev/workos", () => ({
  ConvexProviderWithAuthKit: ({ children }: { children: ReactNode }) => {
    providers.workos();
    return children;
  },
}));
vi.mock("@workos-inc/authkit-nextjs/components", () => ({
  AuthKitProvider: ({ children, ...props }: { children: ReactNode }) => {
    providers.authkit(props);
    return children;
  },
  useAuth: () => ({ user: null }),
  useAccessToken: () => ({ getAccessToken: async () => null }),
}));
vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
  useMutation: () => vi.fn(),
}));
vi.mock("convex-helpers/react/cache/provider", () => ({
  ConvexQueryCacheProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({}),
}));

import { AuthKitConvexProvider } from "./client";

test("disabled WorkOS keeps the existing authenticated Convex provider and auth actions", () => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
  vi.stubEnv("NEXT_PUBLIC_WORKOS_ENABLED", "false");
  expect(
    renderToStaticMarkup(
      <AuthKitConvexProvider>
        <p>Account</p>
      </AuthKitConvexProvider>,
    ),
  ).toContain("Account");
  expect(providers.legacy).toHaveBeenCalledOnce();
  expect(providers.workos).not.toHaveBeenCalled();
  expect(providers.authkit).toHaveBeenCalledWith({
    initialAuth: { user: null },
    onSessionExpired: false,
  });
});

test("enabled WorkOS uses its own session provider", () => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
  vi.stubEnv("NEXT_PUBLIC_WORKOS_ENABLED", "true");
  renderToStaticMarkup(
    <AuthKitConvexProvider>
      <p>Account</p>
    </AuthKitConvexProvider>,
  );
  expect(providers.workos).toHaveBeenCalledOnce();
  expect(providers.legacy).not.toHaveBeenCalled();
  expect(providers.authkit).toHaveBeenCalledWith({});
});
