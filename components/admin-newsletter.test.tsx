// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(() => undefined),
  fetchQuery: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: mocks.query,
  useMutation: () => vi.fn(),
  useConvex: () => ({ query: mocks.fetchQuery }),
}));

import { AdminNewsletter } from "./admin-newsletter";
import { convexRefs } from "@/lib/convex-refs";

test("keeps editorial analytics as an explicit one-shot snapshot", () => {
  const markup = renderToStaticMarkup(<AdminNewsletter />);

  expect(mocks.query).not.toHaveBeenCalledWith(
    convexRefs.admin.newsletterEditorialAnalytics,
    expect.anything(),
  );
  expect(mocks.fetchQuery).not.toHaveBeenCalled();
  expect(markup).toContain("Load performance snapshot");
  expect(markup).not.toContain("Pause live analytics");
  expect(markup).not.toContain("Quality and reader signal");
});
