import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const css = `${FORUM_SHARED_THEME_CSS}\n${readFileSync("styles/forum-shared.css", "utf8")}\nbody{margin:0}`;
let script: string;
test.beforeAll(() => {
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/swap-guidance.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"guidance-isolation",setup(build){build.onResolve({filter:/^convex\\/react$|commerce-wallet$|token-picker$|^@\\/lib\\/commerce-wallet-client$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/swap-guidance-boundary.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));process.stdout.write(await result.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
});
async function operations(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          swapGuidanceOperations: {
            name: string;
            args: Record<string, unknown>;
          }[];
        }
      ).swapGuidanceOperations,
  );
}
async function harness(page: Page, scenario = "") {
  const errors: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:43232" && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (
      url.origin === "http://127.0.0.1:43232" &&
      url.pathname === "/fixture.js"
    )
      return route.fulfill({ contentType: "text/javascript", body: script });
    requests.push(url.href);
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:43232/?${scenario}`);
  await expect(
    page.getByRole("textbox", { name: "You pay", exact: true }),
  ).toBeVisible();
  return async () => {
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
    expect(
      (await operations(page)).every(
        (item) => item.name === "forumSwaps:quote",
      ),
    ).toBe(true);
  };
}
const amount = (page: Page) =>
  page.getByRole("textbox", { name: "You pay", exact: true });
test("partial input stays quiet until blur; invalid amount errors are associated and make no calls", async ({
  page,
}) => {
  const check = await harness(page);
  await expect(amount(page)).toHaveAccessibleDescription(
    /at most 9 decimal places.*never rounded/,
  );
  await amount(page).fill(".");
  await expect(amount(page)).toHaveAttribute("aria-invalid", "false");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await amount(page).blur();
  await expect(amount(page)).toHaveAttribute("aria-invalid", "true");
  await expect(amount(page)).toHaveAccessibleDescription(
    /positive decimal amount/,
  );
  for (const value of ["0", "-1", "1e3", "1,000", "garbage"]) {
    await amount(page).fill(value);
    await amount(page).blur();
    await expect(amount(page)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("alert")).toBeVisible();
  }
  expect(await operations(page)).toEqual([]);
  await check();
});
test("overprecision is rejected without rounding and leading decimal normalization is unchanged", async ({
  page,
}) => {
  const check = await harness(page);
  await amount(page).fill("0.1234567891");
  await amount(page).blur();
  await expect(amount(page)).toHaveValue("0.1234567891");
  await expect(amount(page)).toHaveAccessibleDescription(
    /at most 9 decimal places/,
  );
  await expect(amount(page)).toHaveAttribute("aria-invalid", "true");
  expect(await operations(page)).toEqual([]);
  await amount(page).fill(".5");
  await amount(page).blur();
  await expect(amount(page)).toHaveValue("0.5");
  await expect(amount(page)).toHaveAttribute("aria-invalid", "false");
  await check();
});
test("precision hint follows the pay token without changing a quote or wallet request", async ({
  page,
}) => {
  const check = await harness(page);
  await page
    .getByRole("combobox", { name: "Pay token", exact: true })
    .selectOption("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  await expect(amount(page)).toHaveAccessibleDescription(
    /positive USDC amount with at most 6/,
  );
  await amount(page).fill("0.1234567");
  await amount(page).blur();
  await expect(page.getByRole("alert")).toHaveText(
    "This token supports at most 6 decimal places.",
  );
  expect(await operations(page)).toEqual([]);
  await check();
});
test("missing token precision stays unknown", async ({ page }) => {
  const check = await harness(page, "missing");
  await expect(amount(page)).toHaveAccessibleDescription(
    "Choose a pay token to see its supported decimal precision.",
  );
  await amount(page).fill("1");
  await amount(page).blur();
  expect(await operations(page)).toEqual([]);
  await check();
});
for (const scenario of ["", "unknown-fee"])
  test(`quote fee and slippage help use only existing quote fields (${scenario || "known fee mint"})`, async ({
    page,
  }) => {
    const check = await harness(page, scenario);
    const slippage = page.getByRole("combobox", {
      name: "Slippage limit",
      exact: true,
    });
    await expect(slippage).toHaveValue("50");
    await expect(slippage).toHaveAccessibleDescription(
      /default is 0.5%.*fresh quote/,
    );
    await amount(page).fill("1");
    await expect(
      page.getByLabel("Swap estimate", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/0.5% integrator fee \(Jupiter share included\)/),
    ).toHaveText(
      new RegExp(`collected in ${scenario ? "11111…11111" : "USDC"}`),
    );
    await expect(
      page.locator("dd[aria-describedby]"),
    ).toHaveAccessibleDescription(
      /included in the quote.*their full cost is not known here/,
    );
    await page.getByText("Wallet compatibility", { exact: true }).click();
    await expect(
      page.getByText(/their full cost is not known here/),
    ).toBeVisible();
    await expect(page.getByText("0.995 USDC", { exact: true })).toBeVisible();
    expect((await operations(page))[0].args.slippageBps).toBe(50);
    await slippage.selectOption("100");
    await expect(page.getByLabel("Swap estimate", { exact: true })).toHaveCount(
      0,
    );
    await expect.poll(async () => (await operations(page)).length).toBe(2);
    expect((await operations(page))[1].args.slippageBps).toBe(100);
    await check();
  });

for (const width of [320, 390])
  test(`associated guidance remains readable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const check = await harness(page);
    await amount(page).fill("0.1234567891");
    await amount(page).blur();
    await expect(amount(page)).toHaveAttribute("aria-invalid", "true");
    await page.getByText("Wallet compatibility", { exact: true }).click();
    for (const text of [
      page.getByText(/Extra decimals are rejected, never rounded/),
      page.getByRole("alert"),
      page.getByText(/Slippage limits how much less/),
    ]) {
      await text.scrollIntoViewIfNeeded();
      await expect(text).toBeVisible();
      expect(
        await text.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await operations(page)).toEqual([]);
    await check();
  });
