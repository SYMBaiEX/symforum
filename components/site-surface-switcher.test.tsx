// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import {
  resolveSiteSurfaceForumHref,
  SiteSurfaceSwitcher,
} from "./site-surface-switcher";

test.each(["www.symbaiex.com", "symbaiex.com"])(
  "the Blog switcher opens the canonical forum from %s",
  (hostname) => {
    expect(resolveSiteSurfaceForumHref("/forum", hostname)).toBe(
      "https://forum.symbaiex.com/",
    );
  },
);

test.each([
  ["/forum", "localhost"],
  ["/", "forum.symbaiex.com"],
  ["/forum", "preview.vercel.app"],
  ["https://forum.symbaiex.com/", "www.symbaiex.com"],
])(
  "preview and already resolved links retain their host routing (%s, %s)",
  (href, hostname) => {
    expect(resolveSiteSurfaceForumHref(href, hostname)).toBe(href);
  },
);

test("the whole wordmark and arrow form one named menu trigger without navigating", () => {
  const html = renderToStaticMarkup(
    <SiteSurfaceSwitcher
      activeSurface="forum"
      blogHref="https://www.symbaiex.com/"
      forumHref="/"
    />,
  );
  expect(html).toContain('aria-label="SYMBaiEX site switcher"');
  expect(html).toContain('aria-haspopup="menu"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain("lucide-chevron-down");
  expect(html).not.toContain("<a");
});
