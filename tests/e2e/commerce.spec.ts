import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  address,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  blockhash,
  appendTransactionMessageInstruction,
  compileTransaction,
  getBase64EncodedWireTransaction,
  getBase58Decoder,
} from "@solana/kit";
import { createHash } from "node:crypto";
const wallet = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY",
  SOL = "So11111111111111111111111111111111111111112",
  USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
let bundle: string, css: string;
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
  bundle = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/commerce.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production"})},plugins:[{name:"commerce-isolation",setup(build){build.onResolve({filter:/^convex\\/react$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/commerce-convex.ts"}));build.onResolve({filter:/^next\\/navigation$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/identity-navigation.ts"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));process.stdout.write(await result.outputs[0].text()); const css=(await Promise.all(result.outputs.filter(o=>o.path.endsWith(".css")).map(o=>o.text()))).join("\\n");process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(css)+"}));");`,
    ],
    { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 },
  );
});
function prepared() {
  const tx = compileTransaction(
    appendTransactionMessageInstruction(
      {
        programAddress: address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
        data: new TextEncoder().encode("inert UI test"),
      },
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: blockhash("11111111111111111111111111111111"),
          lastValidBlockHeight: 99999n,
        },
        setTransactionMessageFeePayer(
          address(wallet),
          createTransactionMessage({ version: 0 }),
        ),
      ),
    ),
  );
  return {
    wallet,
    transactionBase64: getBase64EncodedWireTransaction(tx),
    transactionVersion: 0,
    lastValidBlockHeight: 99999,
    simulationSlot: 1,
    estimatedNetworkFeeLamports: "5000",
    messageHash: createHash("sha256")
      .update(Uint8Array.from(tx.messageBytes))
      .digest("hex"),
  };
}
async function harness(page: Page, query = "") {
  const requests: string[] = [];
  const now = Date.now();
  const intent = {
    intentId: "intent-fixture",
    wallet,
    threadId: "thread-fixture",
    categorySlug: "crypto",
    treasury: "11111111111111111111111111111111",
    mint: "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump",
    tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    decimals: 6,
    amountRaw: "10000000000",
    treasuryAmountRaw: "5000000000",
    burnAmountRaw: "5000000000",
    reference: USDC,
    checkoutExpiresAt: now + 600000,
    startsAt: now,
    endsAt: now + 86400000,
    status: "checkout",
    signature: null,
    issue: null,
    prepared: false,
  };
  page.on("pageerror", (e) => {
    throw e;
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><output id="wallet-calls">0</output><script src="/fixture.js"></script>`,
      });
    if (url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: bundle });
    const name = url.pathname.replace("/__commerce/", "");
    requests.push(name);
    let result: unknown;
    if (name === "forumTokenDiscovery:search")
      result = Array.from({ length: 30 }, (_, index) => ({
        mint: getBase58Decoder().decode(new Uint8Array(32).fill(index + 2)),
        symbol: `TOKEN${index}`,
        name: `Directory token ${index}`,
        decimals: 6,
        tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        icon: null,
        verified: true,
      }));
    else if (name === "forumCommerce:resolveMint") {
      const input = route.request().postDataJSON();
      result = {
        mint: input.mint,
        symbol: "RESOLVED",
        name: "Verified mint",
        decimals: 6,
        tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      };
    } else if (name === "forumSwaps:quote")
      result = {
        quotes: [
          {
            quoteId: "quote-fixture",
            provider: "jupiter",
            inputMint: SOL,
            outputMint: USDC,
            amountRaw: "10000000",
            swapAmountRaw: "9975000",
            platformFeeRaw: "25000",
            outputAmountRaw: "1000000",
            minimumOutputAmountRaw: "995000",
            priceImpactBps: 1,
            platformFeeBps: 25,
            routeLabels: ["Pool"],
            expiresAt: (await page.evaluate(() => Date.now())) + 120000,
          },
        ],
        failures: [],
        platformFeeBps: 25,
        benefitEligible: false,
        benefitStatus: "verified",
      };
    else if (name === "forumSwaps:prepare")
      result = query.includes("simulatefail")
        ? null
        : { quoteId: "quote-fixture", ...prepared() };
    else if (name === "forumSwaps:confirm")
      result = {
        quoteId: "quote-fixture",
        status: "confirmed",
        signature: getBase58Decoder().decode(new Uint8Array(64).fill(1)),
        issue: null,
      };
    else if (name === "forumPromotions:quotePromotion") result = intent;
    else if (name === "forumPromotions:prepare")
      result = { intentId: intent.intentId, ...prepared() };
    else if (name === "forumPromotions:submitPromotion")
      result = { ...intent, status: "scheduled" };
    else if (
      name.endsWith(":beginWalletRequest") ||
      name.endsWith(":markUnknown")
    )
      result =
        query.includes("beginfail") && name.endsWith(":beginWalletRequest")
          ? null
          : { status: "held" };
    else
      return route.fulfill({
        status: 403,
        body: "Unexpected external request blocked",
      });
    return route.fulfill({
      status: result === null ? 400 : 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto(`http://127.0.0.1:43201/${query}`);
  return requests;
}
async function connect(page: Page) {
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Test Solana Wallet" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function reviewSwap(page: Page) {
  await expect(page.locator(".swap-receive")).toHaveText("1");
  await page.getByRole("button", { name: "Review swap", exact: true }).click();
}
test("comparison -> exact simulated review -> one wallet request -> finalized receipt", async ({
  page,
}) => {
  const requests = await harness(page);
  await connect(page);
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await reviewSwap(page);
  await expect(page.getByText("0.000025 SOL", { exact: true })).toBeVisible();
  expect(requests).not.toContain("forumSwaps:beginWalletRequest");
  await page.screenshot({
    path: "tmp/forum-render-tests/commerce-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Approve in wallet" }).click();
  await expect(
    page.getByText("Swap finalized.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator("#wallet-calls")).toHaveText("1");
  expect(requests.indexOf("forumSwaps:beginWalletRequest")).toBeLessThan(
    requests.indexOf("forumSwaps:confirm"),
  );
});
test("failed simulation never opens a wallet request", async ({ page }) => {
  const requests = await harness(page, "?simulatefail");
  await connect(page);
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await reviewSwap(page);
  await expect(page.getByRole("alert")).toContainText(
    "No wallet request was made",
  );
  await expect(page.locator("#wallet-calls")).toHaveText("0");
  expect(requests).not.toContain("forumSwaps:beginWalletRequest");
});
test("a leading decimal is normalized and automatically quoted exactly once", async ({
  page,
}) => {
  const requests = await harness(page, "?authorized");
  const quoteBodies: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/__commerce/forumSwaps:quote"))
      quoteBodies.push(request.postDataJSON());
  });
  await page.getByLabel("You pay", { exact: true }).fill(".5");
  await expect(page.getByLabel("You pay", { exact: true })).toHaveValue("0.5");
  await expect(
    page.getByRole("button", { name: "Review swap", exact: true }),
  ).toBeEnabled();
  await expect.poll(() => quoteBodies.length).toBe(1);
  expect(quoteBodies[0]).toMatchObject({ amountRaw: "500000000" });
  await page.waitForTimeout(1500);
  expect(quoteBodies).toHaveLength(1);
  expect(requests).not.toContain("forumSwaps:prepare");
  await expect(page.locator("#wallet-calls")).toHaveText("0");
});
test("uncertain wallet request is held and cannot be resent", async ({
  page,
}) => {
  const requests = await harness(page, "?walletfail");
  await connect(page);
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await reviewSwap(page);
  await page.getByRole("button", { name: "Approve in wallet" }).click();
  await expect(page.getByRole("alert")).toContainText("Do not repeat");
  await expect(
    page.getByRole("button", { name: "Wallet request completed" }),
  ).toBeDisabled();
  await expect(page.locator("#wallet-calls")).toHaveText("1");
  expect(requests.filter((r) => r === "forumSwaps:markUnknown")).toHaveLength(
    1,
  );
});
test("server refusal before the wallet boundary does not fabricate an uncertain wallet call", async ({
  page,
}) => {
  const requests = await harness(page, "?beginfail");
  await connect(page);
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await reviewSwap(page);
  await page.getByRole("button", { name: "Approve in wallet" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "No wallet window was opened",
  );
  await expect(page.locator("#wallet-calls")).toHaveText("0");
  expect(requests).not.toContain("forumSwaps:markUnknown");
});
test("promotion needs a separate explicit irreversible-burn consent", async ({
  page,
}) => {
  const requests = await harness(page, "?promotion");
  await connect(page);
  await page.getByRole("button", { name: "Check next available slot" }).click();
  await expect(page.getByText("5,000 SYMF", { exact: true })).toHaveCount(2);
  await page
    .getByRole("button", { name: "Prepare and simulate", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pay and burn in wallet" }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Pay and burn in wallet" }).click();
  await expect(
    page.getByText("Payment finalized. Your promotion is scheduled below."),
  ).toBeVisible();
  await expect(page.locator("#wallet-calls")).toHaveText("1");
  expect(requests).toContain("forumPromotions:beginWalletRequest");
});
test("mobile layout fits the viewport and key navigation links remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await harness(page, "?guest");
  await expect(
    page.getByRole("button", { name: "Sign in to swap" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Manage linked wallets" }),
  ).toHaveAttribute("href", /account\/connections/);
  await expect(
    page.getByRole("link", { name: "About the official SYMF token" }),
  ).toHaveAttribute("href", /symf/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "tmp/forum-render-tests/commerce-mobile.png",
    fullPage: true,
  });
});
test("an already-authorized linked wallet restores without another connection prompt and auto-quotes once", async ({
  page,
}) => {
  const requests = await harness(page, "?authorized");
  await expect(
    page.getByRole("button", { name: "6fHa…RMBY", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect wallet", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("You pay", { exact: true }).fill("1");
  await expect(
    page.getByRole("button", { name: "Compare routes" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Review swap", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".swap-receive")).toHaveText("1");
  expect(requests.filter((r) => r === "forumSwaps:quote")).toHaveLength(1);
  expect(requests).not.toContain("forumSwaps:prepare");
  await page.getByRole("button", { name: "Review swap", exact: true }).click();
  await expect(page.getByRole("region", { name: "Review swap" })).toBeVisible();
  expect(requests).not.toContain("forumSwaps:beginWalletRequest");
});
test("the token modal has a large searchable directory and verifies a selected mint before quoting", async ({
  page,
}) => {
  const requests = await harness(page, "?authorized");
  await page
    .getByRole("button", { name: "Receive token", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: /TOKEN29/ })).toBeVisible();
  await page.screenshot({
    path: "tmp/forum-render-tests/commerce-token-directory.png",
    fullPage: true,
  });
  await dialog.getByRole("textbox", { name: "Search tokens" }).fill("TOKEN29");
  await expect(dialog.getByRole("button", { name: /TOKEN29/ })).toBeVisible();
  await dialog.getByRole("button", { name: /TOKEN29/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Receive token", exact: true }),
  ).toContainText("TOKEN29");
  expect(requests).toContain("forumCommerce:resolveMint");
  expect(requests).not.toContain("forumSwaps:beginWalletRequest");
  await page.screenshot({
    path: "tmp/forum-render-tests/commerce-updated.png",
    fullPage: true,
  });
});
test("a logged-in reader without a linked wallet uses verified account linking instead of a separate payment-only connection", async ({
  page,
}) => {
  const requests = await harness(page, "?unlinked&authorized");
  await expect(
    page.getByRole("button", { name: "Link wallet to trade" }),
  ).toBeVisible();
  await page.getByLabel("You pay", { exact: true }).fill("1");
  await expect(
    page.getByRole("button", {
      name: "Connect your linked wallet",
      exact: true,
    }),
  ).toBeDisabled();
  expect(requests).not.toContain("forumSwaps:quote");
});
test("an expired preview never starts polling or spending more data quota in the background", async ({
  page,
}) => {
  await page.clock.install();
  const requests = await harness(page, "?authorized");
  await page.getByLabel("You pay", { exact: true }).fill("1");
  await page.clock.runFor(1100);
  await expect(
    page.getByRole("button", { name: "Review swap", exact: true }),
  ).toBeEnabled();
  await page.clock.runFor(180000);
  await expect(
    page.getByRole("button", { name: "Review swap", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".swap-receive")).toHaveText("0.00");
  expect(requests.filter((r) => r === "forumSwaps:quote")).toHaveLength(1);
  expect(requests).not.toContain("forumSwaps:prepare");
});
test("a deliberate wallet disconnect is not silently undone by restoration", async ({
  page,
}) => {
  await harness(page, "?authorized");
  await page.getByRole("button", { name: "6fHa…RMBY", exact: true }).click();
  await page
    .getByRole("button", { name: "Disconnect wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Connect wallet", exact: true }),
  ).toBeVisible();
  await page.getByLabel("You pay", { exact: true }).fill("1");
  await expect(
    page.getByRole("button", {
      name: "Connect your linked wallet",
      exact: true,
    }),
  ).toBeDisabled();
});
test("Review swap revalidates an expired quote automatically without a Compare or Refresh button", async ({
  page,
}) => {
  await page.clock.install();
  const requests = await harness(page, "?authorized");
  await page.getByLabel("You pay", { exact: true }).fill("1");
  await page.clock.runFor(1100);
  await expect(page.locator(".swap-receive")).toHaveText("1");
  await page.clock.runFor(180000);
  await expect(page.locator(".swap-receive")).toHaveText("0.00");
  await page.getByRole("button", { name: "Review swap", exact: true }).click();
  await expect(page.getByRole("region", { name: "Review swap" })).toBeVisible();
  expect(requests.filter((r) => r === "forumSwaps:quote")).toHaveLength(2);
  expect(requests.filter((r) => r === "forumSwaps:prepare")).toHaveLength(1);
  expect(requests).not.toContain("forumSwaps:beginWalletRequest");
  await expect(
    page.getByRole("button", { name: /Compare routes|Refresh quote/ }),
  ).toHaveCount(0);
});
test("token page mounts the native SYMF swap beside the chart on desktop and below it on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await harness(page, "?symf&guest");
  const chart = page.getByRole("region", { name: "$SYMF chart" }),
    swap = page.getByRole("complementary", { name: "Swap SYMF" });
  await expect(
    swap.getByRole("button", { name: "Receive token", exact: true }),
  ).toContainText("SYMF");
  const desktopChart = await chart.boundingBox(),
    desktopSwap = await swap.boundingBox();
  expect(desktopSwap!.x).toBeGreaterThan(
    desktopChart!.x + desktopChart!.width - 1,
  );
  await page.screenshot({
    path: "tmp/forum-render-tests/symf-native-swap-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileChart = await chart.boundingBox(),
    mobileSwap = await swap.boundingBox();
  expect(mobileSwap!.y).toBeGreaterThanOrEqual(
    mobileChart!.y + mobileChart!.height,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
