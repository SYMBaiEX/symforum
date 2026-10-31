import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
let script: string, css: string;
const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
test.beforeAll(() => {
  css =
    readFileSync("styles/forum-shared.css", "utf8") +
    execFileSync(
      "bun",
      [
        "-e",
        `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("apps/platform/app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/community-project-search.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"local-project-search",setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/community-project-search-mocks.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
});
async function harness(page: Page, scenario = "") {
  const errors: string[] = [],
    unexpected: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === "http://127.0.0.1:43228" &&
      url.pathname === "/community"
    )
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (
      url.origin === "http://127.0.0.1:43228" &&
      url.pathname === "/fixture.js"
    )
      return route.fulfill({ contentType: "text/javascript", body: script });
    unexpected.push(url.pathname);
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:43228/community?${scenario}`);
  await expect(
    page.getByRole("heading", { name: "Project hubs", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { projectSearchSubscriptions: string[] })
            .projectSearchSubscriptions.length,
      ),
    )
    .toBe(1);
  const initial = await reads(page);
  return async () => {
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
    expect(await reads(page)).toEqual(initial);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { projectSearchOperations: string[] })
            .projectSearchOperations,
      ),
    ).toEqual([]);
  };
}
async function reads(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { projectSearchSubscriptions: string[] })
        .projectSearchSubscriptions,
  );
}
const input = (page: Page) =>
  page.getByRole("textbox", { name: "Search loaded projects", exact: true });
test("searches only the24loaded hubs and public fields with truthful local counts", async ({
  page,
}) => {
  const check = await harness(page);
  await expect(page.getByText(/recent sample of up to 24 hubs/)).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(24);
  for (const term of ["nOvA", "NOVA_BUILDER", "PROTOCOL RESEARCHER"]) {
    await input(page).fill(term);
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /1 of 24 loaded projects match/ }),
    ).toBeVisible();
  }
  await input(page).fill("does-not-exist");
  await expect(
    page.getByRole("heading", { name: "No loaded projects match" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Other projects may exist outside this recent sample/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(input(page)).toBeFocused();
  await expect(input(page)).toHaveValue("");
  await expect(page.getByRole("article")).toHaveCount(24);
  await check();
});
test("mint search preserves case-sensitive exact identity and original terminal links", async ({
  page,
}) => {
  const check = await harness(page);
  await input(page).fill(mint);
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article").locator("code")).toHaveText(mint);
  const href = await page
    .getByRole("link", { name: "Market & discussion" })
    .getAttribute("href");
  expect(new URL(href!).searchParams.get("mint")).toBe(mint);
  await input(page).fill(mint.toLowerCase());
  await expect(page.getByRole("article")).toHaveCount(0);
  await check();
});
test("loading and trulyempty coverage never masquerade as filtered search results", async ({
  page,
}) => {
  let check = await harness(page, "loading");
  await expect(input(page)).toBeDisabled();
  await expect(page.getByText("Loading project hubs…")).toBeVisible();
  await expect(page.getByText(/0 of 0 loaded/)).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("project-search:loaded")),
  );
  await expect(input(page)).toBeEnabled();
  await expect(page.getByRole("article")).toHaveCount(24);
  await check();
  check = await harness(page, "empty");
  await input(page).fill("anything");
  await expect(
    page.getByRole("heading", { name: "The next project starts here." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No loaded projects match" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("0 of 0 loaded projects match this search."),
  ).toBeVisible();
  await check();
});
test("livepublicupdates re-filter locally without changingsearch orquerysubscription", async ({
  page,
}) => {
  const check = await harness(page);
  await input(page).fill("Remotely updated");
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("project-search:update")),
  );
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(input(page)).toHaveValue("Remotely updated");
  await check();
});
test("exactmint scoped directory retains its scope and does not implyglobalcoverage", async ({
  page,
}) => {
  const check = await harness(page, `mint=${mint}`);
  await expect(
    page.getByText(
      "A hub for this exact mint, with up to 12 public affiliations.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await input(page).fill("Alpha");
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  expect((await reads(page))[0]).toContain(mint);
  await check();
});
for (const width of [320, 390])
  for (const dark of [false, true])
    for (const compact of [false, true])
      test(`search fits${width}px ${dark ? "dark" : "light"} ${compact ? "compact" : "standalone"}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        const check = await harness(
          page,
          `${dark ? "dark&" : ""}${compact ? "compact" : ""}`,
        );
        await input(page).fill("日本語");
        await expect(page.getByRole("article")).toHaveCount(1);
        expect(
          await input(page).evaluate((element) =>
            parseFloat(getComputedStyle(element).fontSize),
          ),
        ).toBeGreaterThanOrEqual(16);
        for (const control of [
          input(page),
          page.getByRole("button", { name: "Clear search", exact: true }),
        ]) {
          const box = await control.boundingBox();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
          expect(box!.height).toBeGreaterThanOrEqual(44);
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        await page
          .getByRole("button", { name: "Clear search", exact: true })
          .focus();
        await page.keyboard.press("Enter");
        await expect(input(page)).toBeFocused();
        await expect(page.getByRole("article")).toHaveCount(24);
        await check();
      });
