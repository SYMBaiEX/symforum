import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43234",
  css = {} as Record<"platform" | "forum", string>;
let script: string;
declare global {
  interface Window {
    __transparencyWindow: {
      queries: { name: string; args: unknown }[];
      forbidden: string[];
    };
  }
}
const audits = new WeakMap<Page, { errors: string[]; outbound: string[] }>();
test.beforeAll(() => {
  for (const app of ["platform", "forum"] as const)
    css[app] =
      FORUM_SHARED_THEME_CSS +
      readFileSync("styles/forum-shared.css", "utf8") +
      execFileSync(
        "bun",
        [
          "-e",
          `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
        ],
        { cwd: `apps/${app}`, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
      );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/transparency-window.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"transparency-window-only",setup(build){build.onResolve({filter:/^convex\\/react$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/transparency-window-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  query = "count=3",
  app: "platform" | "forum" = "platform",
) {
  const audit = { errors: [] as string[], outbound: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    audit.outbound.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/?${query}`);
  await expect(
    page.getByRole("heading", { name: "Treasury & burns", exact: true }),
  ).toBeVisible();
}
test.afterEach(async ({ page }) => {
  expect(audits.get(page)?.errors).toEqual([]);
  expect(audits.get(page)?.outbound).toEqual([]);
  expect(await page.evaluate(() => window.__transparencyWindow)).toEqual({
    queries: [{ name: "forumTerminalTransparency:getTransparency", args: {} }],
    forbidden: [],
  });
});
for (const complete of [false, true])
  for (const count of [0, 1, 3, 12])
    test(`shown ${count} receipts are a bounded window, independently of historyComplete=${complete}`, async ({
      page,
    }) => {
      await harness(page, `count=${count}${complete ? "&complete" : ""}`);
      await expect(
        page.getByText(
          `Showing ${Math.min(count, 10)} verified receipt ${count === 1 ? "record" : "records"} (up to 10). This display window is separate from the returned totals above.`,
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page.locator("dl dd")).toHaveText(["37", "37", "74", "111"]);
      const links = page.getByRole("link", { name: "Receipt", exact: true });
      await expect(links).toHaveCount(Math.min(count, 10));
      for (let i = 0; i < Math.min(count, 10); i++)
        await expect(links.nth(i)).toHaveAttribute(
          "href",
          `https://solscan.io/tx/inert-verified-signature-${i}`,
        );
      await expect(
        page.getByText(
          complete
            ? "Historical verified receipts are included."
            : "These are verified recorded receipts; historical backfill may be incomplete.",
          { exact: false },
        ),
      ).toBeVisible();
      await expect(
        page.getByText(
          /No pending payments, estimated revenue or unverified swap fees are counted/,
        ),
      ).toBeVisible();
      if (!count) {
        await expect(
          page.getByText("No verified receipt rows are shown in this window.", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByText(/No confirmed promotion receipts are indexed yet/),
        ).toHaveCount(0);
      }
    });
test("loading is unknown rather than zero; returned zero totals remain real zero", async ({
  page,
}) => {
  await harness(page, "loading");
  await expect(
    page.getByText("Loading verified receipt totals…", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("dl")).toHaveCount(0);
  await expect(page.getByText(/^Showing /)).toHaveCount(0);
  await page.goto(`${origin}/?count=0&zero`);
  await expect(page.locator("dl dd")).toHaveText(["0", "0", "0", "0"]);
  await expect(
    page.getByText(/^Showing 0 verified receipt records/),
  ).toBeVisible();
});
for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390])
    test(`${app} ${width}px receipt-window context and 44px links stay keyboard reachable`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 568 });
      await harness(page, "count=12", app);
      const panel = page.getByRole("region", {
          name: "Treasury & burns",
          exact: true,
        }),
        links = panel.getByRole("link");
      for (const link of await links.all())
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      for (const node of [
        panel,
        ...(await links.all()),
        page.getByText(/^Showing 10 verified receipt records/),
      ]) {
        await node.scrollIntoViewIfNeeded();
        const box = (await node.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(
          await node.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
      }
      for (const link of await links.all()) {
        await link.focus();
        await expect(link).toBeFocused();
      }
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "After transparency", exact: true }),
      ).toBeFocused();
    });
