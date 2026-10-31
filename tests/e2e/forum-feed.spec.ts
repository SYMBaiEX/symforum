import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

let script: string;
test.beforeAll(() => {
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/forum-feed.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"isolated-feed",setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/forum-feed-state.ts"}));build.onResolve({filter:/forum-primitives$|forum-feed-starter$|forum-media-gallery$|app-error-surface$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/forum-feed-leaves.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));process.stdout.write(await result.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
});
async function harness(page: Page, scenario = "") {
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:43224" && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: '<meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script>',
      });
    if (
      url.origin === "http://127.0.0.1:43224" &&
      url.pathname === "/fixture.js"
    )
      return route.fulfill({ contentType: "text/javascript", body: script });
    unexpected.push(url.pathname);
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:43224/?view=feed&scenario=${scenario}`);
  await expect
    .poll(() => page.evaluate(() => Boolean(window.feedFixture)))
    .toBe(true);
  return () => {
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  };
}
async function calls(page: Page, count: number) {
  await expect
    .poll(() => page.evaluate(() => window.feedFixture.count()))
    .toBe(count);
}
async function resolve(
  page: Page,
  index: number,
  prefix: string,
  count = 12,
  done = true,
) {
  await page.evaluate(
    ({ index, prefix, count, done }) =>
      window.feedFixture.resolve(index, prefix, count, done),
    { index, prefix, count, done },
  );
}

test("auth and experience loading never requests privileged feed early", async ({
  page,
}) => {
  const check = await harness(page, "authloading");
  await expect(
    page.getByText("Loading discussions", { exact: true }),
  ).toBeVisible();
  await calls(page, 0);
  await page.evaluate(() => window.feedFixture.update({ isLoading: false }));
  await calls(page, 0);
  await page.evaluate(() =>
    window.feedFixture.update({ experienceReady: true }),
  );
  await calls(page, 1);
  await resolve(page, 0, "Ready");
  await expect(page.getByRole("article")).toHaveCount(12);
  check();
});

test("restored feed shows its healthy first page before a later saved page settles", async ({
  page,
}) => {
  const check = await harness(page, "restored");
  await calls(page, 1);
  await resolve(page, 0, "First", 12, false);
  await calls(page, 2);
  await expect(page.getByRole("article")).toHaveCount(12);
  await page.evaluate(() => window.feedFixture.reject(1));
  await expect(
    page.getByText(
      "Could not update the feed. Your loaded discussions are still here.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(12);
  expect(await page.evaluate(() => window.feedFixture.scrolls)).toEqual([]);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await calls(page, 3);
  expect(await page.evaluate(() => window.feedFixture.cursors())).toEqual([
    null,
    "First-next",
    "First-next",
  ]);
  await resolve(page, 2, "Recovered second page");
  await expect(page.getByRole("article")).toHaveCount(24);
  expect(await page.evaluate(() => window.feedFixture.scrolls)).toEqual([]);
  check();
});

test("initial failure has explicit retry and recovers without navigation", async ({
  page,
}) => {
  const check = await harness(page);
  await calls(page, 1);
  await page.evaluate(() => window.feedFixture.reject(0));
  await expect(page.getByText("Discussions could not load.")).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await calls(page, 2);
  await resolve(page, 1, "Recovered");
  await expect(page.getByRole("article")).toHaveCount(12);
  check();
});

test("successful saved-page restoration scrolls only after the final page", async ({
  page,
}) => {
  const check = await harness(page, "restored");
  await calls(page, 1);
  await resolve(page, 0, "First", 12, false);
  await calls(page, 2);
  await expect(page.getByRole("article")).toHaveCount(12);
  expect(await page.evaluate(() => window.feedFixture.scrolls)).toEqual([]);
  await resolve(page, 1, "Second");
  await expect(page.getByRole("article")).toHaveCount(24);
  await expect
    .poll(() => page.evaluate(() => window.feedFixture.scrolls))
    .toEqual([[{ top: 400, behavior: "instant" }]]);
  await calls(page, 2);
  check();
});

test("empty nonterminal page offers the next page instead of a false terminal empty state", async ({
  page,
}) => {
  const check = await harness(page);
  await calls(page, 1);
  await resolve(page, 0, "Empty", 0, false);
  await expect(
    page.getByRole("heading", { name: "More discussions ahead" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load more discussions" }).click();
  await calls(page, 2);
  await resolve(page, 1, "Later");
  await expect(page.getByRole("article")).toHaveCount(12);
  check();
});

test("late old-identity page cannot repopulate the new account feed", async ({
  page,
}) => {
  const check = await harness(page);
  await calls(page, 1);
  await page.evaluate(() =>
    window.feedFixture.update({ fingerprint: "owner-b" }),
  );
  await calls(page, 2);
  await resolve(page, 1, "New owner");
  await expect(page.getByRole("article")).toHaveCount(12);
  await resolve(page, 0, "Old owner");
  await expect(
    page.getByRole("heading", { name: /Old owner discussion/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /New owner discussion/ }),
  ).toHaveCount(12);
  check();
});

test("manual refresh retains all loaded pages atomically when a later page fails", async ({
  page,
}) => {
  const check = await harness(page);
  await calls(page, 1);
  await resolve(page, 0, "Original", 12, false);
  await page.getByRole("button", { name: "Load more discussions" }).click();
  await calls(page, 2);
  await resolve(page, 1, "Second");
  await expect(page.getByRole("article")).toHaveCount(24);
  await page.getByRole("button", { name: /Refresh/ }).click();
  await calls(page, 3);
  await resolve(page, 2, "Replacement", 12, false);
  await calls(page, 4);
  await page.evaluate(() => window.feedFixture.reject(3));
  await expect(
    page.getByText(
      "Could not update the feed. Your loaded discussions are still here.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(24);
  await expect(
    page.getByRole("heading", { name: /Replacement discussion/ }),
  ).toHaveCount(0);
  check();
});

test("restoration stops on identity change and cannot leak old pages or saved scroll", async ({
  page,
}) => {
  const check = await harness(page, "restored");
  await calls(page, 1);
  await resolve(page, 0, "Old first", 12, false);
  await calls(page, 2);
  await page.evaluate(() =>
    window.feedFixture.update({ fingerprint: "owner-b" }),
  );
  await calls(page, 3);
  await resolve(page, 2, "Current owner");
  await resolve(page, 1, "Old second", 12, false);
  await expect(page.getByRole("article")).toHaveCount(12);
  await expect(
    page.getByRole("heading", { name: /Current owner discussion/ }),
  ).toHaveCount(12);
  await expect(
    page.getByRole("heading", { name: /Old (first|second) discussion/ }),
  ).toHaveCount(0);
  await calls(page, 3);
  expect(await page.evaluate(() => window.feedFixture.scrolls)).toEqual([]);
  check();
});

test("saved display choices do not remove healthy discussions", async ({
  page,
}) => {
  const check = await harness(page);
  await calls(page, 1);
  await resolve(page, 0, "Visible");
  for (const name of ["Card view", "Compact view", "Timeline view"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("article")).toHaveCount(12);
  }
  await calls(page, 1);
  check();
});
