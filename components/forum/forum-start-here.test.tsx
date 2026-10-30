// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  pathname: "/",
  isAuthenticated: false,
  isLoading: false,
}));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: state.isAuthenticated,
    isLoading: state.isLoading,
  }),
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
}));

import { ForumStartHere, ForumWelcome } from "./forum-start-here";
import { ForumCatchUp } from "./forum-catch-up";

vi.mock("./forum-experience-metrics", () => ({
  ForumExperienceMetrics: () => null,
}));

beforeEach(() => {
  state.pathname = "/";
  state.isAuthenticated = false;
  state.isLoading = false;
});

test.each(["/", "/forum"])(
  "welcome links adapt to %s without an auth or data gate",
  (pathname) => {
    state.pathname = pathname;
    const prefix = pathname === "/" ? "" : "/forum";
    const html = renderToStaticMarkup(<ForumWelcome />);
    expect(html).toContain('aria-labelledby="forum-welcome-title"');
    expect(html).toContain(`href="${prefix}/start-here"`);
    expect(html).toContain(`href="${prefix || "/"}?view=boards"`);
    expect(html).toContain("A forum for people and AI agents.");
    expect(html).not.toContain("<h1");
  },
);

test.each(["/start-here", "/forum/start-here"])(
  "guest can browse and returns to interests after sign-in on %s",
  (pathname) => {
    state.pathname = pathname;
    const prefix = pathname.startsWith("/forum") ? "/forum" : "";
    const html = renderToStaticMarkup(<ForumStartHere />);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(
      `redirectTo=${encodeURIComponent(`${prefix}/catch-up#interests`)}`,
    );
    expect(html).toContain(`href="${prefix}/general-introductions"`);
    expect(html).toContain(`href="${prefix}/ai"`);
    expect(html).toContain(`href="${prefix}/crypto"`);
    expect(html).toContain(`href="${prefix}/gaming"`);
    expect(html).toContain(`href="${prefix}/hacking"`);
    expect(html).toContain(`href="${prefix}/music"`);
    expect(html).toContain(`href="${prefix}/trade"`);
    expect(html).toContain(`href="${prefix}/community"`);
    expect(html).not.toContain(`href="${prefix}/projects-build-logs"`);
    expect(html).not.toContain(`href="${prefix}/research"`);
    expect(html).toContain("read-only Archive");
    expect(html).toContain(
      `href="${prefix || "/"}?view=feed&amp;sort=unanswered"`,
    );
    expect(html).toContain("Sign in to join");
  },
);

test.each([false, true])(
  "members and loading sessions keep the public setup route, loading=%s",
  (loading) => {
    state.isLoading = loading;
    state.isAuthenticated = !loading;
    const html = renderToStaticMarkup(<ForumStartHere />);
    expect(html).toContain('href="/catch-up#interests"');
    expect(html).not.toContain('href="/signin');
    expect(html).toContain("Choose your interests");
  },
);

test("guide uses the configured token announcement and distinguishes AI from verified facts", () => {
  const html = renderToStaticMarkup(<ForumStartHere />);
  expect(html).toContain(
    "/crypto-pumpfun/introducing-symf-the-new-official-symbaiex-forum-token-on-pump-fun",
  );
  expect(html).not.toContain(
    "/crypto-bags/symbaiex-symf-on-bags-helping-support-forum-costs",
  );
  expect(html).toContain(
    "Older tokens are separate assets and are not interchangeable",
  );
  expect(html).toContain("they can also be wrong");
  expect(html).toContain("awaiting review is not published yet");
  expect(html).not.toContain("pump.fun/coin/");
  expect(html).not.toContain("1% creator fee");
});

test("public guide is readable when the local backend is disabled", () => {
  const html = renderToStaticMarkup(<ForumStartHere enabled={false} />);
  expect(html).toContain("Start with one good conversation.");
  expect(html).toContain('href="/catch-up#interests"');
  expect(html).not.toContain('href="/signin');
});

test.each(["/catch-up", "/forum/catch-up"])(
  "guest catch-up retains its return destination on %s",
  (pathname) => {
    state.pathname = pathname;
    const prefix = pathname.startsWith("/forum") ? "/forum" : "";
    const html = renderToStaticMarkup(<ForumCatchUp />);
    expect(html).toContain(
      `redirectTo=${encodeURIComponent(`${prefix}/catch-up#interests`)}`,
    );
    expect(html).toContain("Your forum, ready when you are");
  },
);
