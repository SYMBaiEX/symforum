import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
let script: string;
const mint = "11111111111111111111111111111111";
const css = readFileSync("styles/forum-shared.css", "utf8");
test.beforeAll(() => {
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/community-navigation.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"community-nav",setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/community-navigation-mocks.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
});
async function harness(page: Page, path = "/community") {
  const errors: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === "http://127.0.0.1:43226" &&
      ["/community", "/forum/community", "/trade"].includes(url.pathname)
    )
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (
      url.origin === "http://127.0.0.1:43226" &&
      url.pathname === "/fixture.js"
    )
      return route.fulfill({ contentType: "text/javascript", body: script });
    requests.push(url.pathname);
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:43226${path}`);
  return () => {
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
  };
}
const nav = (page: Page) =>
  page.getByRole("navigation", { name: "Community utilities", exact: true });
async function privateQueries(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as { communityNavigationQueries: string[] }
    ).communityNavigationQueries.filter(
      (x) => x === "forumCommunity:listPayments",
    ),
  );
}
for (const width of [320, 1440])
  test(`sections update URL and restore through Back and refresh at${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    const check = await harness(page, `/community?mint=${mint}`);
    await nav(page)
      .getByRole("button", { name: "Project hubs", exact: true })
      .click();
    expect(await privateQueries(page)).toEqual([]);
    await nav(page)
      .getByRole("button", { name: "Bounties & research", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`mint=${mint}&section=work`));
    await nav(page)
      .getByRole("button", { name: "Your receipts", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your community payments" }),
    ).toBeVisible();
    await page.goBack();
    await expect(
      nav(page).getByRole("button", {
        name: "Bounties & research",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(
      nav(page).getByRole("button", {
        name: "Bounties & research",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(await privateQueries(page)).toEqual([]);
    await nav(page)
      .getByRole("button", { name: "Tips & profile", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      nav(page).getByRole("button", { name: "Tips & profile", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    check();
  });
test("guest receipt deep-link preserves section and mint in first-party sign-in return", async ({
  page,
}) => {
  const check = await harness(
    page,
    `/community?guest&mint=${mint}&section=receipts`,
  );
  await expect(
    page.getByRole("heading", { name: "Sign in to view your receipts" }),
  ).toBeVisible();
  const href = await page
    .getByRole("link", { name: "Sign in", exact: true })
    .getAttribute("href");
  expect(new URL(href!, page.url()).searchParams.get("redirectTo")).toBe(
    `/community?mint=${mint}&section=receipts`,
  );
  expect(await privateQueries(page)).toEqual([]);
  await nav(page)
    .getByRole("button", { name: "Project hubs", exact: true })
    .click();
  await nav(page)
    .getByRole("button", { name: "Your receipts", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sign in to view your receipts" }),
  ).toBeVisible();
  expect(await privateQueries(page)).toEqual([]);
  check();
});
for (const query of [
  "section=receipts&section=work",
  `mint=${mint}&mint=${mint}&section=receipts`,
  "section=javascript%3Aalert(1)",
  "mint=invalid&section=receipts",
])
  test(`malformed navigation stays on safe public directory:${query}`, async ({
    page,
  }) => {
    const check = await harness(page, `/community?${query}`);
    await expect(
      page.getByText(/This community link contains invalid options/),
    ).toBeVisible();
    await expect(
      nav(page).getByRole("button", { name: "Project hubs", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(await privateQueries(page)).toEqual([]);
    check();
  });
test("compact terminal section changes retain exact mint and terminal path", async ({
  page,
}) => {
  const check = await harness(page, `/trade?mint=${mint}`);
  await nav(page)
    .getByRole("button", { name: "Bounties & research", exact: true })
    .click();
  await expect(page).toHaveURL(
    `http://127.0.0.1:43226/trade?mint=${mint}&section=work`,
  );
  check();
});
test("native host handoff preserves safe section and mint without wallet or private queries", async ({
  page,
}) => {
  const check = await harness(
    page,
    `/community?native&mint=${mint}&section=receipts`,
  );
  const href = await page
    .getByRole("link", { name: "Open community" })
    .getAttribute("href");
  expect(new URL(href!).pathname).toBe("/community");
  expect(new URL(href!).searchParams.get("section")).toBe("receipts");
  expect(new URL(href!).searchParams.get("mint")).toBe(mint);
  expect(await privateQueries(page)).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Fixture wallet" }),
  ).toHaveCount(0);
  check();
});
