// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  convexQuery: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.convexQuery }),
  useMutation: () => vi.fn(),
  useQuery: mocks.useQuery,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { AdminDashboard } from "./admin-dashboard";
import { convexRefs } from "@/lib/convex-refs";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useQuery.mockImplementation((reference: unknown) => {
    if (reference === convexRefs.admin.viewer) {
      return {
        user: { _id: "users:owner", _creationTime: 1, role: "owner" },
        isOwner: true,
        canAccessAdmin: true,
        canModerateForum: false,
        canAdminForum: false,
        ownerExists: true,
      };
    }
    if (reference === convexRefs.admin.listPosts) {
      return [];
    }
    return undefined;
  });
});

test("admin posts tab does not subscribe to the cross-table overview query", () => {
  renderToStaticMarkup(<AdminDashboard initialTab="posts" />);

  expect(mocks.useQuery).not.toHaveBeenCalledWith(
    convexRefs.admin.overview,
    expect.anything(),
  );
  expect(mocks.convexQuery).not.toHaveBeenCalled();
});

test("admin overview offers an explicit refresh for its point-in-time snapshot", () => {
  const markup = renderToStaticMarkup(<AdminDashboard initialTab="overview" />);

  expect(markup).toContain("Refresh snapshot");
  expect(mocks.useQuery).not.toHaveBeenCalledWith(
    convexRefs.admin.overview,
    expect.anything(),
  );
  expect(mocks.convexQuery).not.toHaveBeenCalled();
});

test("admin overview labels bounded metrics as samples", () => {
  const markup = renderToStaticMarkup(<AdminDashboard initialTab="overview" />);

  expect(markup).toContain("Roles sample");
  expect(markup).toContain("Recent sample");
  expect(markup).toContain("recent rows sampled");
  expect(markup).toContain("newest events sampled (max 100)");
});
