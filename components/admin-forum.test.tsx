// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
vi.mock("convex/react", () => ({
  useQuery: (_reference: unknown, args: unknown) =>
    args === "skip" ? undefined : [],
  useMutation: () => vi.fn(),
  useConvex: () => ({ query: vi.fn() }),
}));
import { AdminForum } from "./admin-forum";

test("forum moderation exposes queue links without board administration", () => {
  const html = renderToStaticMarkup(<AdminForum mode="moderation" />);
  expect(html).toContain('aria-label="Moderation queues"');
  for (const queue of ["threads", "replies", "reports", "history"]) {
    expect(html).toContain(`href="#moderation-${queue}"`);
    expect(html).toContain(`id="moderation-${queue}"`);
  }
  expect(html).not.toContain("New category");
  expect(html).not.toContain("Board organization");
});

test("site board administration retains its existing presentation and controls", () => {
  const html = renderToStaticMarkup(<AdminForum />);
  expect(html).toContain("mt-10 border-y border-row-border py-6");
  expect(html).toContain("New category");
  expect(html).toContain("Preview board changes");
  expect(html).not.toContain('aria-label="Moderation queues"');
});
