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
  return async (additionalPages = 0, allowSubscriptionChanges = false) => {
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
    if (!allowSubscriptionChanges) expect(await reads(page)).toEqual(initial);
    expect(
      await page.evaluate(
        () => window.projectDirectoryFixture.pageRequests.length,
      ),
    ).toBe(additionalPages);
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
test("searches only the12loaded hubs and public fields with truthful local counts", async ({
  page,
}) => {
  const check = await harness(page);
  await expect(
    page.getByText(/Browse project hubs, 12 at a time/),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(12);
  for (const term of ["nOvA", "NOVA_BUILDER", "PROTOCOL RESEARCHER"]) {
    await input(page).fill(term);
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /1 of 12 loaded projects match/ }),
    ).toBeVisible();
  }
  await input(page).fill("does-not-exist");
  await expect(
    page.getByRole("heading", { name: "No loaded projects match" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Other projects may exist outside the loaded pages/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(input(page)).toBeFocused();
  await expect(input(page)).toHaveValue("");
  await expect(page.getByRole("article")).toHaveCount(12);
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
  await expect(page.getByRole("article")).toHaveCount(12);
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
        await expect(page.getByRole("article")).toHaveCount(12);
        await check();
      });
const loadMore = (page: Page) =>
  page.getByRole("button", { name: "Load more project hubs", exact: true });
test("repeated same-turn clicks issue one bounded request", async ({
  page,
}) => {
  const check = await harness(page, "deferred");
  await loadMore(page).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  expect(
    await page.evaluate(
      () => window.projectDirectoryFixture.pageRequests.length,
    ),
  ).toBe(1);
  await page.evaluate(() => window.projectDirectoryFixture.settle(0));
  await expect(page.getByRole("article")).toHaveCount(23);
  await check(1);
});
test("initial split retries from the beginning with a smaller page without claiming exhaustion", async ({
  page,
}) => {
  const check = await harness(page, "initialsplit");
  await expect(page.getByRole("alert")).toContainText("read limit");
  await page
    .getByRole("button", { name: "Retry smaller project page" })
    .click();
  await expect(loadMore(page)).toBeEnabled();
  const request = await page.evaluate(
    () =>
      window.projectDirectoryFixture.pageRequests[0] as {
        paginationOpts: { cursor: string | null; numItems: number };
      },
  );
  expect(request.paginationOpts.cursor).toBeNull();
  expect(request.paginationOpts.numItems).toBe(6);
  await expect(page.getByRole("article")).toHaveCount(12);
  await check(1);
});
test("stable first-page public edits retain loaded pages but replacement identities reset the chain", async ({
  page,
}) => {
  const check = await harness(page);
  await loadMore(page).click();
  await expect(page.getByRole("article")).toHaveCount(23);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("project-search:update")),
  );
  await expect(page.getByRole("article")).toHaveCount(23);
  await page.evaluate(() => window.projectDirectoryFixture.replaceFirstId());
  await expect(page.getByRole("article")).toHaveCount(12);
  await expect(loadMore(page)).toBeEnabled();
  await check(1);
});
test("explicit pages extend beyond24, dedupe and exhaust without automatic draining", async ({
  page,
}) => {
  const check = await harness(page);
  await loadMore(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("article")).toHaveCount(23);
  expect(
    await page.evaluate(
      () => window.projectDirectoryFixture.pageRequests.length,
    ),
  ).toBe(1);
  await loadMore(page).click();
  await expect(page.getByRole("article")).toHaveCount(34);
  await loadMore(page).click();
  await expect(page.getByRole("article")).toHaveCount(45);
  await loadMore(page).click();
  await expect(page.getByRole("article")).toHaveCount(49);
  await expect(
    page.getByText("No more project hubs in this scope."),
  ).toBeVisible();
  await expect(loadMore(page)).toHaveCount(0);
  await check(4);
});
test("search changes during a pending page remain local and filter the late page with the current term", async ({
  page,
}) => {
  const check = await harness(page, "deferred");
  await loadMore(page).click();
  await expect(
    page.getByRole("button", { name: "Loading more project hubs…" }),
  ).toBeDisabled();
  await input(page).fill("Other loaded project 12");
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.evaluate(() => window.projectDirectoryFixture.settle(0));
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(
    page.getByText("1 of 23 loaded projects matches this search."),
  ).toBeVisible();
  await check(1);
});
test("later failure keeps hubs and retries the identical cursor only on click", async ({
  page,
}) => {
  const check = await harness(page);
  await page.evaluate(() => window.projectDirectoryFixture.mode("error"));
  await loadMore(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "Your loaded hubs are kept",
  );
  await expect(page.getByRole("article")).toHaveCount(12);
  await page.evaluate(() => window.projectDirectoryFixture.mode("ok"));
  await page
    .getByRole("button", { name: "Retry loading project hubs" })
    .click();
  await expect(page.getByRole("article")).toHaveCount(23);
  const requests = await page.evaluate(
    () => window.projectDirectoryFixture.pageRequests,
  );
  expect(requests[0]).toEqual(requests[1]);
  await check(2);
});
test("initial failure offers explicit recovery without claiming an empty directory", async ({
  page,
}) => {
  // The initial query throws before its subscription commits, so use a direct local harness setup.
  await harness(page, "empty");
  await page.goto("http://127.0.0.1:43228/community?initialerror");
  await expect(page.getByRole("alert")).toContainText(
    "Project hubs could not load",
  );
  await expect(
    page.getByRole("heading", { name: "The next project starts here." }),
  ).toHaveCount(0);
  await page.evaluate(() => window.projectDirectoryFixture.initialReady());
  await page.getByRole("button", { name: "Retry project directory" }).click();
  await expect(page.getByRole("article")).toHaveCount(12);
  expect(
    await page.evaluate(() => window.projectDirectoryFixture.pageRequests),
  ).toEqual([]);
});
test("split and no-progress results retain rows and never pretend exhaustion", async ({
  page,
}) => {
  const check = await harness(page);
  await page.evaluate(() => window.projectDirectoryFixture.mode("split"));
  await loadMore(page).click();
  await expect(page.getByRole("article")).toHaveCount(12);
  await expect(page.getByRole("alert")).toContainText("read limit");
  await page.evaluate(() => window.projectDirectoryFixture.mode("ok"));
  await page
    .getByRole("button", { name: "Retry smaller project page" })
    .click();
  await expect(page.getByRole("article")).toHaveCount(17);
  expect(
    await page.evaluate(
      () =>
        (
          window.projectDirectoryFixture.pageRequests[1] as {
            paginationOpts: { numItems: number };
          }
        ).paginationOpts.numItems,
    ),
  ).toBe(6);
  await page.evaluate(() => window.projectDirectoryFixture.mode("repeat"));
  await loadMore(page).click();
  await expect(page.getByRole("alert")).toContainText("did not advance");
  await expect(
    page.getByText("No more project hubs in this scope."),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Retry smaller project page" }),
  ).toBeDisabled();
  await check(3);
});
test("empty partial page still needs an explicit next click", async ({
  page,
}) => {
  const check = await harness(page);
  await page.evaluate(() => window.projectDirectoryFixture.mode("empty-page"));
  await loadMore(page).click();
  await expect(page.getByRole("article")).toHaveCount(12);
  await expect(loadMore(page)).toBeEnabled();
  await check(1);
});
for (const change of ["mint", "owner", "cursor"] as const)
  for (const ok of [true, false])
    test(`${change} ABA rejects stale ${ok ? "success" : "error"} without cross-scope state`, async ({
      page,
    }) => {
      const check = await harness(page, "deferred");
      await loadMore(page).click();
      await page.evaluate(
        ({ change, mint }) => {
          const f = window.projectDirectoryFixture;
          if (change === "mint") f.scope(mint);
          else if (change === "owner") f.owner("author-other");
          else f.moveCursor();
        },
        { change, mint },
      );
      if (change === "mint")
        await expect(page.getByRole("article")).toHaveCount(1);
      else await expect(loadMore(page)).toBeEnabled();
      await page.evaluate((change) => {
        const f = window.projectDirectoryFixture;
        if (change === "mint") f.scope();
        else if (change === "owner") f.owner(null);
        else f.moveCursor();
      }, change);
      await expect(page.getByRole("article")).toHaveCount(12);
      await page.evaluate(
        (ok) => window.projectDirectoryFixture.settle(0, ok),
        ok,
      );
      await expect(loadMore(page)).toBeEnabled();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByRole("article")).toHaveCount(12);
      await check(1, change !== "cursor");
    });
