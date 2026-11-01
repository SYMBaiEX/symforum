import { test, expect, type Page, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";
import fixture from "../fixtures/installation.symbaiex.json";
import { localInstallation } from "../../lib/installation-config";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43276";
const configs = {
  configured: fixture,
  "no-token": { ...fixture, token: localInstallation().token },
  missing: localInstallation(),
  custom: {
    ...fixture,
    name: "Example Community",
    sites: {
      primary: "https://www.example.com",
      forum: "https://forum.example.com",
      blog: "https://blog.example.com",
      news: "https://news.example.com",
      newsletter: "https://newsletter.example.com",
    },
    identity: {
      cookieDomain: "example.com",
      extraOrigins: ["https://example.com"],
    },
    telegram: { ...fixture.telegram, url: "https://t.me/example_forum" },
    x: {
      accounts: { symforum: "example_forum" },
      officialSources: [],
      publisherUserId: "",
    },
    token: {
      ...fixture.token,
      symbol: "DEMO",
      announcementPath: "/forum/crypto/example-token-announcement",
    },
  },
};
let scripts: Record<string, string> = {};
const css: Record<string, string> = {};
const audits = new WeakMap<Page, { errors: string[]; external: string[] }>();
test.beforeAll(() => {
  for (const app of ["platform", "forum"])
    css[app] =
      FORUM_SHARED_THEME_CSS +
      readFileSync("styles/forum-shared.css", "utf8") +
      execFileSync(
        "bun",
        [
          "-e",
          `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./${app === "forum" ? "apps/forum/tailwind.config.ts" : "tailwind.config.ts"}";config.content=["./components/**/*.{ts,tsx}","./packages/forum-ui/src/**/*.{ts,tsx}"];const css=(await Bun.file("apps/${app}/app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
        ],
        { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 },
      );
  const baseline =
    process.env.COMMUNITY_LINKS_BASELINE === "1"
      ? Object.fromEntries(
          ["forum-site-shell", "forum-start-here", "forum-navigation"].map(
            (name) => [
              name,
              execFileSync(
                "git",
                ["show", `f6a469ee:components/forum/${name}.tsx`],
                { encoding: "utf8" },
              ),
            ],
          ),
        )
      : {};
  scripts = JSON.parse(
    execFileSync(
      "bun",
      [
        "-e",
        `const configs=${JSON.stringify(configs)};const baseline=${JSON.stringify(baseline)};const scripts={};for(const [name,config] of Object.entries(configs)){const r=await Bun.build({entrypoints:["tests/e2e/fixtures/community-links.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:JSON.stringify(config)})},plugins:[{name:"community-public-only",setup(build){if(Object.keys(baseline).length)build.onLoad({filter:/forum-(site-shell|start-here|navigation)\\.tsx$/},({path})=>({contents:baseline[path.split('/').at(-1).replace('.tsx','')],loader:"tsx"}));build.onResolve({filter:/^next\\/navigation$|^next\\/link$|^convex\\/react$|^convex-helpers\\/react\\/cache\\/hooks$|ThemeToggle$|site-surface-switcher$|blog-navigation$|newsletter-navigation$|news-navigation$|web-vitals-reporter$|analytics-tracker$|app-error-surface$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/community-links-state.tsx"}));}}]});if(!r.success)throw Error(r.logs.join('\\n'));scripts[name]=await r.outputs[0].text();}process.stdout.write(JSON.stringify(scripts));`,
      ],
      { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 },
    ),
  );
});
async function open(
  page: Page,
  config: keyof typeof configs = "configured",
  options: {
    path?: string;
    app?: string;
    surface?: string;
    native?: boolean;
    session?: string;
  } = {},
) {
  const audit = { errors: [] as string[], external: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === origin &&
      ["/start-here", "/forum/start-here"].includes(url.pathname)
    )
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[options.app ?? "platform"]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({
        contentType: "text/javascript",
        body: scripts[config],
      });
    audit.external.push(url.href);
    return route.abort();
  });
  const params = new URLSearchParams({
    surface: options.surface ?? "forum",
    session: options.session ?? "guest",
    ...(options.native ? { native: "1" } : {}),
  });
  await page.goto(`${origin}${options.path ?? "/start-here"}?${params}`);
  await expect(page.getByRole("contentinfo")).toBeVisible();
}
test.afterEach(async ({ page }) => {
  const audit = audits.get(page);
  if (!audit) return;
  expect(audit.errors).toEqual([]);
  expect(audit.external).toEqual([]);
  expect(
    await page.evaluate(() => window.communityLinkEvidence.forbidden),
  ).toEqual([]);
});
const official = (page: Page) =>
  page.getByRole("navigation", { name: "Official forum links", exact: true });
const personal = (page: Page) =>
  page.getByRole("navigation", {
    name: "Austin Hamilton personal profiles",
    exact: true,
  });
const community = (page: Page) =>
  page.getByRole("region", { name: "Community links", exact: true });
async function links(region: Locator) {
  return region.getByRole("link").evaluateAll((nodes) =>
    nodes.map((node) => ({
      label: node.textContent?.trim(),
      href: node.getAttribute("href"),
      target: node.getAttribute("target"),
      rel: node.getAttribute("rel"),
    })),
  );
}
async function bounded(target: Locator, width: number) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  await target.focus();
  await expect(target).toBeFocused();
}
test("forum footer distinguishes configured official destinations from preserved personal profiles", async ({
  page,
}) => {
  await open(page);
  expect(
    (await links(official(page))).map(({ label, href }) => ({ label, href })),
  ).toEqual([
    { label: "Forum community", href: "https://forum.symbaiex.com/" },
    { label: "Telegram community", href: "https://t.me/symforum" },
    { label: "@symforum on X", href: "https://x.com/symforum" },
    { label: "$SYMF page & chart", href: "https://forum.symbaiex.com/symf" },
  ]);
  expect((await links(personal(page))).map(({ href }) => href)).toEqual([
    "https://github.com/symbaiex",
    "https://linkedin.com/in/austinhamiltonal",
    "https://twitter.com/symbiex",
  ]);
  await expect(
    official(page).getByRole("link", { name: "Twitter", exact: true }),
  ).toHaveCount(0);
  await expect(
    personal(page).getByText("Personal profiles · Austin Hamilton", {
      exact: true,
    }),
  ).toBeVisible();
  for (const link of [
    ...(await links(official(page))),
    ...(await links(personal(page))),
    ...(await links(community(page))),
  ]) {
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(link.href).toMatch(/^https:\/\//);
  }
});
test("configured community links are public and independent of token setup", async ({
  page,
}) => {
  await open(page, "no-token");
  expect((await links(community(page))).map(({ href }) => href)).toEqual([
    "https://forum.symbaiex.com/",
    "https://t.me/symforum",
    "https://x.com/symforum",
  ]);
  await expect(
    page.getByRole("heading", { name: "Looking for $SYMF?", exact: true }),
  ).toHaveCount(0);
  expect((await links(official(page))).map(({ href }) => href)).not.toContain(
    "https://forum.symbaiex.com/symf",
  );
  await expect(
    page.locator('a[href="/symf"],a[href="/forum/symf"]'),
  ).toHaveCount(0);
});
test("missing destinations never become empty anchors or legacy-personal fallbacks", async ({
  page,
}) => {
  await open(page, "missing");
  expect((await links(official(page))).map(({ href }) => href)).toEqual([
    "http://forum.localhost:3000/",
  ]);
  expect((await links(community(page))).map(({ href }) => href)).toEqual([
    "http://forum.localhost:3000/",
  ]);
  await page.getByRole("button", { name: "Forum menu", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Telegram community", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('a[href=""]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(
    personal(page).getByRole("link", { name: "Twitter", exact: true }),
  ).toHaveAttribute("href", "https://twitter.com/symbiex");
});
test("unconfigured existing navigation omits empty Telegram and placeholder token entries", async ({
  page,
}) => {
  await open(page, "missing");
  await page.getByRole("button", { name: "Forum menu", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Telegram community", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "$TOKEN", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('a[href=""]')).toHaveCount(0);
});
for (const path of ["/start-here", "/forum/start-here"])
  test(`alternate configured destinations and token disclosures preserve native/host routing on ${path}`, async ({
    page,
  }) => {
    await open(page, "custom", { path, native: true });
    expect((await links(community(page))).map(({ href }) => href)).toEqual([
      "https://forum.example.com/",
      "https://t.me/example_forum",
      "https://x.com/example_forum",
    ]);
    await expect(
      official(page).getByRole("link", {
        name: "$DEMO page & chart",
        exact: true,
      }),
    ).toHaveAttribute("href", "https://forum.example.com/symf");
    const token = page.getByRole("complementary", {
      name: "Looking for $DEMO?",
      exact: true,
    });
    const prefix = path.startsWith("/forum/") ? "/forum" : "";
    await expect(
      token.getByRole("link", { name: "$DEMO page & chart", exact: true }),
    ).toHaveAttribute("href", `${prefix}/symf`);
    await expect(
      token.getByRole("link", {
        name: "Official $DEMO announcement",
        exact: true,
      }),
    ).toHaveAttribute("href", `${prefix}/crypto/example-token-announcement`);
    await expect(token).toContainText(
      "Older tokens are separate assets and are not interchangeable",
    );
    expect(await page.locator('a[href*="pump.fun/coin/"]').count()).toBe(0);
    await expect(
      page.getByRole("link", { name: "Sign in to join", exact: true }),
    ).toHaveAttribute(
      "href",
      `/signin?redirectTo=${encodeURIComponent(`${prefix}/catch-up#interests`)}`,
    );
  });
for (const surface of ["blog", "news", "newsletter"])
  test(`${surface} footer preserves its established publication and personal identity`, async ({
    page,
  }) => {
    await open(page, "configured", { surface });
    await expect(official(page)).toHaveCount(0);
    await expect(personal(page)).toHaveCount(0);
    const footer = page.getByRole("contentinfo");
    await expect(
      footer.getByRole("link", { name: "Twitter", exact: true }),
    ).toHaveAttribute("href", "https://twitter.com/symbiex");
    await expect(
      footer.getByRole("link", { name: "LinkedIn", exact: true }),
    ).toHaveAttribute("href", "https://linkedin.com/in/austinhamiltonal");
    await expect(
      footer.getByRole("link", { name: "GitHub", exact: true }),
    ).toHaveAttribute("href", "https://github.com/symbaiex");
    await expect(
      footer.getByRole("link", { name: "@symforum on X", exact: true }),
    ).toHaveCount(0);
  });
test("non-forum footer branches and existing navigation/auth hooks and handlers remain source-byte identical", () => {
  function contracts(source: string) {
    const tree = ts.createSourceFile(
      "component.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const result: string[] = [];
    function walk(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        /^(useState|useEffect|useQuery|useConvexAuth|useForumRuntime|usePathname|useSearchParams)$/.test(
          node.expression.getText(tree),
        )
      )
        result.push(node.getText(tree));
      if (
        ts.isJsxAttribute(node) &&
        /^(onClick|onChange|onNavigate)$/.test(node.name.getText(tree))
      )
        result.push(node.getText(tree));
      if (
        ts.isConditionalExpression(node) &&
        /^surface === "(blog|news|newsletter)"$/.test(
          node.condition.getText(tree),
        )
      )
        result.push(node.getText(tree));
      ts.forEachChild(node, walk);
    }
    walk(tree);
    return result;
  }
  for (const name of [
    "forum-site-shell",
    "forum-start-here",
    "forum-navigation",
  ]) {
    const path = `components/forum/${name}.tsx`;
    const before = execFileSync("git", ["show", `f6a469ee:${path}`], {
      encoding: "utf8",
    });
    const after = readFileSync(path, "utf8");
    expect(contracts(after), path).toEqual(contracts(before));
  }
});
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} ${width}px configured community links and existing menu are bounded 44px keyboard targets`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, "custom", { app });
      for (const group of [official(page), personal(page), community(page)]) {
        const box = (await group.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(
          await group.evaluate(
            (node) => node.scrollWidth <= node.clientWidth + 1,
          ),
        ).toBe(true);
        for (const link of await group.getByRole("link").all())
          await bounded(link, width);
      }
      const menu = page.getByRole("button", {
        name: "Forum menu",
        exact: true,
      });
      await menu.scrollIntoViewIfNeeded();
      await menu.focus();
      await page.keyboard.press("Enter");
      const telegram = page.getByRole("menuitem", {
        name: "Telegram community",
        exact: true,
      });
      await bounded(telegram, width);
      await expect(telegram).toHaveAttribute(
        "href",
        "https://t.me/example_forum",
      );
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
      await expect(page.locator('a[href=""]')).toHaveCount(0);
    });
