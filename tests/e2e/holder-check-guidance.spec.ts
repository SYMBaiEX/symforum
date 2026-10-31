import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43235",
  css = {} as Record<"platform" | "forum", string>;
let script: string;
declare global {
  interface Window {
    __holderGuidance: {
      queries: { name: string; args: unknown }[];
      operations: string[];
    };
  }
}
const audits = new WeakMap<Page, { errors: string[]; outbound: string[] }>();
const profile = (page: Page) =>
  page.getByRole("region", { name: "Your contributor profile", exact: true });
const helper = (page: Page) =>
  profile(page).getByLabel("Optional holder-check guidance", { exact: true });
const guidance =
  "Checking holder proof requests no wallet payment and uses the existing data allowance. To refresh, explicitly choose Check holder proof.";
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/holder-check-guidance.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"holder-guidance-only",setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/holder-check-guidance-state.tsx"}));build.onLoad({filter:/components\\/community\\/community-hub\\.tsx$/},async args=>({contents:(await Bun.file(args.path).text())+"\\nexport { Support as HolderGuidanceSupport };",loader:"tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 7 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  mode = "absent",
  app: "platform" | "forum" = "platform",
) {
  const audit = { errors: [] as string[], outbound: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  const start = new Date("2026-10-31T14:40:00Z");
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 1000));
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
  await page.goto(`${origin}/?mode=${mode}`);
  await expect(profile(page)).toBeVisible();
}
test.afterEach(async ({ page }) => {
  expect(audits.get(page)?.errors).toEqual([]);
  expect(audits.get(page)?.outbound).toEqual([]);
  expect(await page.evaluate(() => window.__holderGuidance.operations)).toEqual(
    [],
  );
});
for (const mode of ["guest", "loading", "unlinked", "settings-loading"])
  test(`${mode} keeps existing identity/settings boundary and no visible holder helper or action`, async ({
    page,
  }) => {
    await harness(page, mode);
    await expect(helper(page).locator("summary")).toBeHidden();
    const text =
      mode === "guest"
        ? "Sign in and link a community wallet"
        : mode === "loading"
          ? "Checking your community wallet…"
          : mode === "unlinked"
            ? "Select a wallet linked to your account"
            : "Loading your contributor settings…";
    await expect(profile(page).getByText(text, { exact: false })).toBeVisible();
    await expect(
      profile(page).getByRole("button", {
        name: "Check holder proof",
        exact: true,
      }),
    ).toBeHidden();
  });
for (const mode of ["absent", "present", "expired"])
  test(`${mode} original holder state/privacy/discount semantics survive helper open/close without reads or actions`, async ({
    page,
  }) => {
    await harness(page, mode);
    const check = profile(page).getByRole("button", {
      name: "Check holder proof",
      exact: true,
    });
    await expect(check).toBeVisible();
    await expect(check).toBeEnabled();
    const states = await profile(page).locator("p").allTextContents(),
      before = await page.evaluate(() => window.__holderGuidance.queries);
    const summary = helper(page).locator("summary");
    await expect(helper(page)).not.toHaveAttribute("open");
    await summary.click();
    await expect(
      helper(page).getByText(guidance, { exact: true }),
    ).toBeVisible();
    expect(await helper(page).innerText()).not.toMatch(
      /\d|fee waiver|permanent|guaranteed|safety score/i,
    );
    await expect(
      profile(page).getByText(/Balance and wallet stay private/),
    ).toContainText("not an endorsement, swap discount or right to moderate");
    await expect(
      page.getByText(
        /There is no platform tip fee; your wallet displays the network fee/,
      ),
    ).toBeVisible();
    if (mode === "present")
      await expect(
        profile(page).getByText("Holder proof verified", { exact: true }),
      ).toBeVisible();
    else
      await expect(
        profile(page).getByText(
          mode === "expired"
            ? "The last finalized proof did not show an eligible balance, or has expired."
            : "No current verified holder proof.",
          { exact: true },
        ),
      ).toBeVisible();
    if (mode !== "absent")
      await expect(
        profile(page).getByText(
          /Proof is valid for ten minutes; refresh is explicit/,
        ),
      ).toBeVisible();
    await summary.click();
    expect(await profile(page).locator("p").allTextContents()).toEqual(states);
    expect(await page.evaluate(() => window.__holderGuidance.queries)).toEqual(
      before,
    );
  });
for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390])
    test(`${app} ${width}px optional helper is44px keyboard readable in bounded actual support layout`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 568 });
      await harness(page, "present", app);
      const summary = helper(page).locator("summary");
      await summary.focus();
      await expect(summary).toBeFocused();
      expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const before = await page.evaluate(() => window.__holderGuidance.queries);
      await page.keyboard.press("Enter");
      await expect(
        helper(page).getByText(guidance, { exact: true }),
      ).toBeVisible();
      for (const node of [
        profile(page),
        helper(page),
        helper(page).locator("p"),
      ]) {
        await node.scrollIntoViewIfNeeded();
        const box = (await node.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(
          await node.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
      }
      await summary.focus();
      await page.keyboard.press("Tab");
      await expect(
        profile(page).getByRole("button", {
          name: "Check holder proof",
          exact: true,
        }),
      ).toBeFocused();
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(summary).toBeFocused();
      await expect(helper(page).locator("p")).toBeHidden();
      expect(
        await page.evaluate(() => window.__holderGuidance.queries),
      ).toEqual(before);
    });
