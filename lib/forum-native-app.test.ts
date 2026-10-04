import { createHash } from "node:crypto";
import {
  FORUM_PLUGIN_APP_URI,
  FORUM_PLUGIN_TOOLS,
} from "./forum-plugin-catalog";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  FORUM_NATIVE_ROUTES,
  FORUM_NATIVE_APP_CSS,
  FORUM_NATIVE_APP_JS,
} from "./forum-native-app.generated";
import {
  FORUM_PLUGIN_APP_HTML,
  FORUM_PLUGIN_APP_RESOURCE,
} from "./forum-plugin-app";
function pages(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory()
      ? pages(join(path, item.name))
      : item.name === "page.tsx"
        ? [join(path, item.name)]
        : [],
  );
}
describe("automatic native forum parity", () => {
  test("advertises a content-addressed UI revision so client caches cannot pin an older renderer", () => {
    const revision = createHash("sha256")
      .update(readFileSync("lib/forum-native-app.generated.ts"))
      .update(readFileSync("lib/forum-shared-css.generated.ts"))
      .digest("hex")
      .slice(0, 12);
    expect(FORUM_PLUGIN_APP_URI).toBe(`ui://symbaiex/forum-${revision}.html`);
    expect(FORUM_PLUGIN_APP_RESOURCE.uri).toBe(FORUM_PLUGIN_APP_URI);
    expect(
      FORUM_PLUGIN_TOOLS.find((tool) => tool.name === "forum_open")?._meta.ui
        ?.resourceUri,
    ).toBe(FORUM_PLUGIN_APP_URI);
  });
  test("every actual forum route is compiled from its original page module", () => {
    expect(FORUM_NATIVE_ROUTES.map((route) => route.source).sort()).toEqual(
      pages("app/forum").sort(),
    );
    const imports = readFileSync(
      "components/forum/plugin-adapter/routes.generated.ts",
      "utf8",
    );
    for (const route of FORUM_NATIVE_ROUTES)
      expect(imports).toContain(route.source.replace(".tsx", ""));
    expect(FORUM_NATIVE_ROUTES).toHaveLength(26);
  });
  test("ships the native component bundle, canonical CSS and font without a second renderer", () => {
    expect(FORUM_PLUGIN_APP_HTML).toContain(FORUM_NATIVE_APP_JS);
    expect(FORUM_PLUGIN_APP_HTML).toContain(FORUM_NATIVE_APP_CSS);
    expect(FORUM_NATIVE_APP_CSS).toContain("KaTeX_Main");
    expect(FORUM_PLUGIN_APP_HTML).toContain("font/woff2;base64");
    expect(FORUM_PLUGIN_APP_HTML).toContain('charset="utf-8"');
    expect(FORUM_PLUGIN_APP_HTML).not.toContain("<iframe");
    expect(() => new Function(FORUM_NATIVE_APP_JS)).not.toThrow();
    const entry = readFileSync(
      "components/forum/plugin-adapter/entry.tsx",
      "utf8",
    );
    expect(entry).toContain("<ForumSiteShell");
    expect(entry).toContain('from "./routes.generated"');
    expect(readFileSync("components/site-shell.tsx", "utf8")).toContain(
      "forum-site-shell",
    );
  });
  test("retains strict network isolation and allows only forum storage and brand assets", () => {
    expect(FORUM_PLUGIN_APP_RESOURCE._meta.ui.csp.connectDomains).toEqual([]);
    expect(FORUM_PLUGIN_APP_RESOURCE._meta.ui.csp.frameDomains).toEqual([]);
    expect(FORUM_PLUGIN_APP_RESOURCE._meta.ui.csp.resourceDomains).toEqual([
      "https://strong-bee-384.convex.cloud",
      "https://forum.symbaiex.com",
      "https://www.symbaiex.com",
      "https://lh3.googleusercontent.com",
    ]);
  });
});
