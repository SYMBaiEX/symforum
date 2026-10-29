import { createHash } from "node:crypto";
import { Script } from "node:vm";
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
  FORUM_PLUGIN_APP_CSS,
  FORUM_PLUGIN_ASSET_ORIGIN,
  FORUM_PLUGIN_APP_SCRIPT,
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
  test("excludes first-party Next server runtime from the host browser bundle", () => {
    // AuthKit's component entry imports server tracing. A native browser has
    // no Node process, so even syntactically valid JS crashes before mounting.
    expect(FORUM_NATIVE_APP_JS).not.toMatch(
      /process\.env\.(?:NEXT_OTEL_PERFORMANCE_PREFIX|NEXT_RUNTIME|__NEXT_DEV_SERVER)/,
    );
  });
  test("advertises a content-addressed UI revision so client caches cannot pin an older renderer", () => {
    const revision = createHash("sha256")
      .update(readFileSync("lib/forum-native-app.generated.ts"))
      .update(readFileSync("lib/forum-shared-css.generated.ts"))
      .update(readFileSync("lib/forum-plugin-app.ts"))
      .update(readFileSync("lib/forum-plugin-startup.ts"))
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
      pages("apps/forum/app/forum").sort(),
    );
    const imports = readFileSync(
      "components/forum/plugin-adapter/routes.generated.ts",
      "utf8",
    );
    for (const route of FORUM_NATIVE_ROUTES)
      expect(imports).toContain(route.source.replace(".tsx", ""));
    expect(FORUM_NATIVE_ROUTES).toHaveLength(29);
    expect(FORUM_NATIVE_ROUTES).toContainEqual({
      path: "/forum/swap",
      source: "apps/forum/app/forum/swap/page.tsx",
    });
    expect(FORUM_NATIVE_ROUTES).toContainEqual({
      path: "/forum/symf",
      source: "apps/forum/app/forum/symf/page.tsx",
    });
    expect(FORUM_NATIVE_ROUTES).toContainEqual({
      path: "/forum/start-here",
      source: "apps/forum/app/forum/start-here/page.tsx",
    });
  });
  test("can share a document with host lexical bindings without a startup redeclaration error", () => {
    // A classic script's global var collides with a prior host const even if
    // application code has not executed yet. Test the actual emitted bundle.
    const name = FORUM_NATIVE_APP_JS.match(/\bvar ([\w$]+)=/)?.[1];
    expect(name).toBeTruthy();
    expect(
      () =>
        new Script(
          `const ${name} = { hostBootstrap: true };\n${FORUM_NATIVE_APP_JS}`,
        ),
    ).not.toThrow();
  });
  test("keeps MCP HTML small and links the exact native UI assets on an already allowed origin", () => {
    expect(Buffer.byteLength(FORUM_PLUGIN_APP_HTML)).toBeLessThan(10_000);
    expect(FORUM_PLUGIN_APP_HTML).not.toContain(FORUM_NATIVE_APP_JS);
    expect(FORUM_PLUGIN_APP_HTML).toContain(
      `src="${FORUM_PLUGIN_ASSET_ORIGIN}/api/plugin/assets/current/forum.js"`,
    );
    expect(FORUM_PLUGIN_APP_HTML).not.toContain(
      FORUM_PLUGIN_APP_RESOURCE.uri.split("forum-")[1],
    );
    expect(FORUM_PLUGIN_APP_SCRIPT).toContain(FORUM_NATIVE_APP_JS);
    expect(FORUM_PLUGIN_APP_SCRIPT).toContain(
      JSON.stringify(FORUM_PLUGIN_APP_CSS),
    );
    expect(() => new Script(FORUM_PLUGIN_APP_SCRIPT)).not.toThrow();
    expect(FORUM_PLUGIN_APP_RESOURCE._meta.ui.csp.resourceDomains).toContain(
      FORUM_PLUGIN_ASSET_ORIGIN,
    );
    expect(FORUM_PLUGIN_APP_CSS).toContain(FORUM_NATIVE_APP_CSS);
    expect(FORUM_NATIVE_APP_CSS).toContain("KaTeX_Main");
    expect(FORUM_PLUGIN_APP_CSS).toContain("font/woff2;base64");
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
  test("includes component CSS modules under the class names emitted in the native React bundle", () => {
    const jumps = FORUM_NATIVE_APP_JS.match(/jumps:"([^"]+)"/);
    expect(jumps).not.toBeNull();
    expect(FORUM_NATIVE_APP_CSS).toContain(`.${jumps![1]}{`);
    expect(FORUM_NATIVE_APP_CSS).toContain(`.${jumps![1]} a`);
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
