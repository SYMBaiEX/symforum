import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43306";
const css = {} as Record<"platform" | "forum", string>;
let script: string;
const audits = new WeakMap<Page, { errors: string[]; outbound: string[] }>();
const state = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __providerUsage: {
            state: { calls: string[]; forbidden: string[]; pending: unknown[] };
          };
        }
      ).__providerUsage.state,
  );
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/provider-usage.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production"})},plugins:[{name:"provider-read-mock",setup(build){build.onResolve({filter:/^convex\\/react$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/provider-usage-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  scenario = "",
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
  await page.goto(`${origin}/?scenario=${scenario}`);
  await expect(
    page.getByRole("heading", { name: "Provider usage", exact: true }),
  ).toBeVisible();
}
test.afterEach(async ({ page }) => {
  expect(audits.get(page)?.errors).toEqual([]);
  expect(audits.get(page)?.outbound).toEqual([]);
  expect((await state(page)).forbidden).toEqual([]);
});
test("no automatic reads or polling; explicit refresh preserves a frozen server snapshot", async ({
  page,
}) => {
  await page.clock.install();
  await harness(page);
  expect((await state(page)).calls).toEqual([]);
  await page.clock.fastForward(600000);
  expect((await state(page)).calls).toEqual([]);
  await page
    .getByRole("button", { name: "Refresh snapshot", exact: true })
    .click();
  await expect(
    page
      .getByRole("list", { name: "Known application allowance counters" })
      .getByRole("listitem"),
  ).toHaveCount(6);
  await expect(page.getByRole("status")).toContainText(
    "Nov 1, 2026, 12:00:00 PM UTC",
  );
  await page.clock.fastForward(600000);
  expect((await state(page)).calls).toEqual(["forumProviderUsage:snapshot"]);
  await expect(
    page.getByText("Historical denials are not recorded.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("usage unmeasured here", { exact: true }),
  ).toBeVisible();
});
test("a denied refresh hides the previous snapshot and never exposes the raw failure", async ({
  page,
}) => {
  await harness(page);
  await page
    .getByRole("button", { name: "Refresh snapshot", exact: true })
    .click();
  await expect(page.getByRole("listitem")).toHaveCount(6);
  await page.evaluate(() =>
    (
      window as unknown as { __providerUsage: { setMode(mode: string): void } }
    ).__providerUsage.setMode("error"),
  );
  await page
    .getByRole("button", { name: "Refresh snapshot", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Current administrator access",
  );
  await expect(page.getByRole("listitem")).toHaveCount(0);
  await expect(
    page.getByText("INERT private provider body", { exact: false }),
  ).toHaveCount(0);
  expect((await state(page)).calls).toHaveLength(2);
});
test("double clicks coalesce while pending, and unmounted results cannot populate a replacement panel", async ({
  page,
}) => {
  await harness(page, "deferred");
  const button = page.getByRole("button", {
    name: "Refresh snapshot",
    exact: true,
  });
  await button.dblclick();
  expect((await state(page)).calls).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "Reading snapshot…", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() =>
    (
      window as unknown as { __providerUsage: { unmount(): void } }
    ).__providerUsage.unmount(),
  );
  await expect(page.getByText("Fixture panel removed")).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as {
        __providerUsage: { resolve(): void; mount(): void };
      }
    ).__providerUsage.resolve(),
  );
  await page.evaluate(() =>
    (
      window as unknown as { __providerUsage: { mount(): void } }
    ).__providerUsage.mount(),
  );
  await expect(
    page.getByRole("heading", { name: "Provider usage", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(0);
});
test("partial counter reads stay unknown while missing current rows show only zero recorded reservations", async ({
  page,
}) => {
  await harness(page, "partial");
  await page
    .getByRole("button", { name: "Refresh snapshot", exact: true })
    .click();
  await expect(
    page.getByText("Partial snapshot.", { exact: false }),
  ).toBeVisible();
  const rpc = page
    .getByRole("listitem")
    .filter({
      has: page.getByRole("heading", {
        name: "RPC · shared request guard",
        exact: true,
      }),
    });
  await expect(rpc).toContainText("Unavailable");
  await expect(rpc).toContainText("eligibility is unknown");
  await page.evaluate(() =>
    (
      window as unknown as { __providerUsage: { setMode(mode: string): void } }
    ).__providerUsage.setMode("empty"),
  );
  await page
    .getByRole("button", { name: "Refresh snapshot", exact: true })
    .click();
  await expect(rpc).toContainText("0 / 5 requests");
  await rpc.getByText("Covered ledger window", { exact: true }).click();
  await expect(rpc).toContainText("not zero account usage");
});
for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390])
    test(`${app} ${width}px: direct bounds,44px controls and keyboard disclosure`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await harness(page, "", app);
      await page.keyboard.press("Tab");
      const button = page.getByRole("button", {
        name: "Refresh snapshot",
        exact: true,
      });
      await expect(button).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("listitem")).toHaveCount(6);
      const section = page
        .getByRole("heading", { name: "Provider usage", exact: true })
        .locator("../..");
      for (const element of [
        section,
        ...(await page.getByRole("listitem").all()),
      ]) {
        const box = await element.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      }
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.keyboard.press("Tab");
      const summary = page
        .getByText("Covered ledger window", { exact: true })
        .first();
      await expect(summary).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(
        page
          .getByText("Current and previous fixed buckets conservatively", {
            exact: false,
          })
          .first(),
      ).toBeVisible();
      expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    });
