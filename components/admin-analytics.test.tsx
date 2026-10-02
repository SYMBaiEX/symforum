// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  convexQuery: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.convexQuery }),
  useQuery: mocks.useQuery,
}));

import { AdminAnalytics } from "./admin-analytics";

beforeEach(() => {
  vi.clearAllMocks();
});

test("analytics review is an on-demand snapshot, not a live subscription", () => {
  const markup = renderToStaticMarkup(<AdminAnalytics />);

  expect(markup).toContain("On-demand snapshot");
  expect(markup).toContain("Refresh snapshot");
  expect(mocks.useQuery).not.toHaveBeenCalled();
  expect(mocks.convexQuery).not.toHaveBeenCalled();
});
