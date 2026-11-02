import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
import installation from "../fixtures/installation.symbaiex.json";

const origin = "http://127.0.0.1:43381";
let script: string;
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
  script = execFileSync(
    "bun",
    [
      "-e",
      `const r=await Bun.build({entrypoints:["tests/e2e/fixtures/symf-project-discussions.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"readonly-discussions",setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|^next\\/link$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/symf-project-discussions-state.tsx"}));}}]});if(!r.success)throw Error(r.logs.join("\\n"));for(const f of r.outputs){if(f.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await f.text())+"}));");else process.stdout.write(await f.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 },
  );
});
async function open(
  page: Page,
  options: {
    scenario?: string;
    app?: string;
    theme?: string;
    path?: string;
  } = {},
) {
  const audit = { errors: [] as string[], external: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === origin &&
      ["/community", "/forum/community"].includes(url.pathname)
    )
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[options.app ?? "platform"]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    audit.external.push(url.href);
    return route.abort();
  });
  const query = new URLSearchParams({
    scenario: options.scenario ?? "populated",
    theme: options.theme ?? "light",
  });
  await page.goto(`${origin}${options.path ?? "/community"}?${query}`);
  await expect(
    page.getByRole("heading", {
      name: "Related forum discussions",
      exact: true,
    }),
  ).toBeVisible();
}
test.afterEach(async ({ page }) => {
  const audit = audits.get(page);
  if (!audit) return;
  expect(audit.external).toEqual([]);
  expect(audit.errors).toEqual([]);
  expect(
    await page.evaluate(() => window.symfDiscussionEvidence.forbidden),
  ).toEqual([]);
  const reads = await page.evaluate(() => window.symfDiscussionEvidence.reads);
  expect(reads.length).toBeGreaterThan(0);
  for (const read of reads)
    expect(read).toEqual({
      name: "forum:search",
      args: {
        query: "SYMF",
        categorySlug: "crypto-pumpfun",
        resultType: "threads",
        page: 1,
        pageSize: 6,
      },
    });
});
const section = (page: Page) =>
  page.getByRole("region", { name: "Related forum discussions", exact: true });
test("known announcement is distinct from bounded text mentions and links use the current first-party host", async ({
  page,
}) => {
  await open(page);
  await expect(section(page)).toContainText(
    "not verified mint associations or a complete discussion history",
  );
  await expect(
    page.getByRole("link", { name: /Read the SYMF token announcement/ }),
  ).toHaveAttribute(
    "href",
    installation.token.announcementPath.replace(/^\/forum/, ""),
  );
  await expect(
    page.getByRole("link", { name: "Search discussions", exact: true }),
  ).toHaveAttribute("href", "/search?q=SYMF&board=crypto-pumpfun&type=threads");
  await expect(section(page).getByRole("listitem")).toHaveCount(2);
  await expect(section(page)).toContainText("0 replies");
  await expect(section(page)).toContainText("Locked");
  await expect(section(page)).toContainText(
    "2 additional discussions shown from one search page (up to 6 results)",
  );
  for (const link of await section(page).getByRole("link").all()) {
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
  }
});
test("legacy platform route uses the existing ForumLink prefix and exact canonical thread paths", async ({
  page,
}) => {
  await open(page, { path: "/forum/community" });
  await expect(
    page.getByRole("link", { name: /Read the SYMF token announcement/ }),
  ).toHaveAttribute("href", installation.token.announcementPath);
  await expect(
    page.getByRole("link", { name: /SYMF discussion 1/ }),
  ).toHaveAttribute("href", "/forum/crypto-pumpfun/symf-discussion-1");
});
test("loading is distinct from empty and later updates use the same bounded read contract", async ({
  page,
}) => {
  await open(page, { scenario: "loading" });
  await expect(section(page)).toContainText("Loading related discussions…");
  await expect(section(page).getByRole("listitem")).toHaveCount(0);
  await page.evaluate(() => window.symfDiscussionEvidence.setScenario("empty"));
  await expect(section(page)).toContainText(
    "No additional discussions are shown in this search page",
  );
  await page.evaluate(() =>
    window.symfDiscussionEvidence.setScenario("populated"),
  );
  await expect(section(page).getByRole("listitem")).toHaveCount(2);
});
test("deduplicates the explicit announcement, bounds displayed mentions and never renders nonpublic statuses", async ({
  page,
}) => {
  await open(page, { scenario: "duplicates" });
  await expect(section(page).getByRole("listitem")).toHaveCount(6);
  await expect(section(page)).not.toContainText("Duplicate announcement");
  await expect(section(page)).not.toContainText(
    "Private pending draft must not render",
  );
  await expect(section(page)).toContainText(
    "More matches may be available in forum search",
  );
});
test("query failure leaves the known announcement and safe search reachable without raw errors", async ({
  page,
}) => {
  await open(page, { scenario: "error" });
  await expect(section(page)).toContainText(
    "Related forum discussions is temporarily unavailable",
  );
  await expect(section(page)).not.toContainText("PRIVATE PROVIDER BODY");
  await expect(
    page.getByRole("link", { name: /Read the SYMF token announcement/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Search discussions", exact: true }),
  ).toBeVisible();
});
for (const app of ["platform", "forum"])
  for (const theme of ["light", "dark"])
    for (const width of [320, 390, 1280])
      test(`${app} ${theme} ${width}px long text stays intrinsically bounded with keyboard-ready targets`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 844 });
        await open(page, { app, theme, scenario: "unsafe" });
        const bounds = await section(page).evaluate((node) => ({
          width: node.clientWidth,
          scroll: node.scrollWidth,
          x: node.getBoundingClientRect().x,
          right: node.getBoundingClientRect().right,
        }));
        expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(width);
        for (const link of await section(page).getByRole("link").all()) {
          const href = (await link.getAttribute("href"))!;
          expect(new URL(href, origin).origin).toBe(origin);
          expect(href).not.toMatch(/^\/\//);
          await link.scrollIntoViewIfNeeded();
          const box = (await link.boundingBox())!;
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
          await link.focus();
          await expect(link).toBeFocused();
        }
      });
