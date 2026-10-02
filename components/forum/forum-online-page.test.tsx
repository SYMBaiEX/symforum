// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pointInTimeQuery: vi.fn(),
  reactiveQuery: vi.fn(),
}));

vi.mock("convex-helpers/react/cache/hooks", () => ({
  useQuery: mocks.reactiveQuery,
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.pointInTimeQuery }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

import { ForumOnlinePage } from "./forum-online-page";
import { forumRefs } from "./forum-refs";

test("online roster uses a foreground snapshot instead of heartbeat subscriptions", () => {
  renderToStaticMarkup(<ForumOnlinePage enabled />);

  expect(mocks.reactiveQuery).not.toHaveBeenCalledWith(
    forumRefs.listOnlineMembers,
    expect.anything(),
  );
  expect(mocks.pointInTimeQuery).not.toHaveBeenCalled();
});
