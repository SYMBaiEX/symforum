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
  getBase64Encoder,
} from "@solana/kit";
import { createHash } from "node:crypto";
import { signedSwapFixture } from "../fixtures/signed-swap";
import { inspectSignedSwap } from "../../lib/swap-signed-wire";
const wallet = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY",
  SOL = "So11111111111111111111111111111111111111112",
  USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
let bundle: string, css: string;
test("pinned chart CSS survives a soft navigation while altered CSS remains blocked", async ({
  page,
}) => {
  const source = readFileSync(
    "node_modules/lightweight-charts/dist/lightweight-charts.development.mjs",
    "utf8",
  );
  const chartCss = source.match(/const css = `([^`]+)`;/)![1];
  const hash = createHash("sha256").update(chartCss).digest("base64");
  // Same exact static allowlist as the production proxy, carried by the original document.
  expect(readFileSync("proxy.ts", "utf8")).toContain(`'sha256-${hash}'`);
  await page.route("**/*", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: {
        "content-security-policy": `default-src 'none'; style-src-elem 'sha256-${hash}'; script-src 'none'`,
      },
      body: "<!doctype html><title>Isolated CSP navigation test</title><main>Test document</main>",
    }),
  );
  await page.goto("http://127.0.0.1:43201/");
  const result = await page.evaluate((css) => {
    history.pushState({}, "", "/symf");
    const allowed = document.createElement("style");
    allowed.textContent = css;
    document.head.append(allowed);
    const rejected = document.createElement("style");
    rejected.textContent = css + "body{opacity:0}";
    document.head.append(rejected);
    return { allowed: !!allowed.sheet, rejected: !!rejected.sheet };
  }, chartCss);
  expect(result).toEqual({ allowed: true, rejected: false });
});
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/commerce.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"commerce-isolation",setup(build){build.onResolve({filter:/^convex\\/react$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/commerce-convex.ts"}));build.onResolve({filter:/^next\\/navigation$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/identity-navigation.ts"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));process.stdout.write(await result.outputs[0].text()); const css=(await Promise.all(result.outputs.filter(o=>o.path.endsWith(".css")).map(o=>o.text()))).join("\\n");process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(css)+"}));");`,
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
  const managed = query.includes("managed");
  const feeBps = managed ? 50 : 25;
  const signed = query.includes("signaturefirst")
    ? await signedSwapFixture(query.includes("v1") ? 1 : 0)
    : null;
  const wallet =
    signed?.wallet ?? "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";
  const binding = signed
    ? await inspectSignedSwap(signed.signedTransactionBase64, signed.prepared)
    : null;
  let registered = false,
    relayed = false;
  const requests: string[] = [];
  let quoteCalls = 0;
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
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><output id="wallet-calls">0</output><script>window.__commerceFixtureWallet=${JSON.stringify(wallet)}</script><script src="/fixture.js"></script>`,
      });
    if (url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: bundle });
    const name = url.pathname.replace("/__commerce/", "");
    requests.push(name);
    let result: unknown;
    if (name === "wallet:sign" && signed) {
      expect(route.request().postDataJSON().bytes).toEqual(
        Array.from(
          getBase64Encoder().encode(signed.prepared.transactionBase64),
        ),
      );
      result = {
        wire: query.includes("unsignedresponse")
          ? signed.prepared.transactionBase64
          : signed.signedTransactionBase64,
      };
    } else if (name === "forumSwapSubmission:registerSigned" && signed) {
      expect(route.request().postDataJSON().signedTransactionBase64).toBe(
        signed.signedTransactionBase64,
      );
      registered = !query.includes("registerfail");
      result = registered
        ? { quoteId: "quote-fixture", signature: binding!.signature }
        : null;
    } else if (name === "forumSwapSubmission:cancelUnsubmitted") {
      result = !relayed;
    } else if (name === "forumSwapSubmission:relay" && signed) {
      expect(registered).toBe(true);
      relayed = true;
      await page.evaluate(
        ({ signature, finalized }) =>
          window.dispatchEvent(
            new CustomEvent("commerce:signed-receipt", {
              detail: { signature, finalized },
            }),
          ),
        {
          signature: binding!.signature,
          finalized: !query.includes("relaytimeout"),
        },
      );
      result = query.includes("relaytimeout")
        ? null
        : { quoteId: "quote-fixture", signature: binding!.signature };
    } else if (name === "forumTokenDiscovery:search")
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
    } else if (name === "forumSwapRecovery:ensure")
      result = query.includes("auto")
        ? {
            state: "scheduled",
            reason: "waiting_expiry",
            attempts: 0,
            nextCheckAt: Date.now() + 900000,
          }
        : null;
    else if (name === "forumSwaps:quote") {
      quoteCalls++;
      const input = route.request().postDataJSON();
      const changed = quoteCalls > 1 && query.includes("worsequote");
      result = {
        quotes: [
          {
            quoteId: "quote-fixture",
            provider: "jupiter",
            ...(managed
              ? {
                  execution: "jupiter-managed",
                  fees: {
                    feeMint: input.inputMint,
                    totalFeeBps: feeBps,
                    integratorFeeBps: feeBps,
                    jupiterFeeBps: 0,
                  },
                }
              : {}),
            inputMint: input.inputMint,
            outputMint: input.outputMint,
            amountRaw: input.amountRaw,
            swapAmountRaw: (
              (BigInt(input.amountRaw) * (managed ? 10000n : 9975n)) /
              10000n
            ).toString(),
            platformFeeRaw: (
              (BigInt(input.amountRaw) * BigInt(feeBps)) /
              10000n
            ).toString(),
            outputAmountRaw: changed ? "800000" : "1000000",
            minimumOutputAmountRaw: changed ? "796000" : "995000",
            priceImpactBps: query.includes("highimpact") ? 200 : 1,
            platformFeeBps: feeBps,
            routeLabels: ["Pool"],
            expiresAt: (await page.evaluate(() => Date.now())) + 120000,
          },
        ],
        failures: [],
        platformFeeBps: feeBps,
        benefitEligible: false,
        benefitStatus: "unavailable",
      };
    } else if (name === "forumSwaps:prepare")
      result = query.includes("simulatefail")
        ? null
        : { quoteId: "quote-fixture", ...(signed?.prepared ?? prepared()) };
    else if (name === "forumSwaps:confirm")
      result = query.includes("confirmfail")
        ? null
        : {
            quoteId: "quote-fixture",
            status: "confirmed",
            signature: getBase58Decoder().decode(new Uint8Array(64).fill(1)),
            issue: null,
          };
    else if (name === "forumPromotions:quotePromotion") {
      const input = route.request().postDataJSON();
      const starts = input.selectedStartsAt as number[] | undefined;
      result = starts
        ? {
            ...intent,
            startsAt: starts[0],
            endsAt: starts[starts.length - 1] + 86400000,
            amountRaw: String(BigInt(intent.amountRaw) * BigInt(starts.length)),
            treasuryAmountRaw: String(
              BigInt(intent.treasuryAmountRaw) * BigInt(starts.length),
            ),
            burnAmountRaw: String(
              BigInt(intent.burnAmountRaw) * BigInt(starts.length),
            ),
            slots: starts.map((startsAt) => ({
              lane: 0,
              startsAt,
              endsAt: startsAt + 86400000,
            })),
          }
        : intent;
    } else if (name === "forumPromotions:prepare")
      result = { intentId: intent.intentId, ...prepared() };
    else if (name === "forumPromotions:submitPromotion")
      result = { ...intent, status: "scheduled" };
    else if (
      name.endsWith(":beginWalletRequest") ||
      name.endsWith(":markUnknown")
    ) {
      if (
        query.includes("hidehandoff") &&
        name === "forumSwaps:beginWalletRequest"
      )
        await page.evaluate(() =>
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => "hidden",
          }),
        );
      result =
        query.includes("beginfail") && name.endsWith(":beginWalletRequest")
          ? null
          : { status: "held" };
    } else
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
  await page.getByRole("button", { name: "Swap", exact: true }).click();
}
test("signature-first swap saves the verified signature before one relay and unlocks after finality", async ({
  page,
}) => {
  const requests = await harness(page, "?authorized&signaturefirst");
  await page.getByLabel("You pay", { exact: true }).fill(".01");
  await reviewSwap(page);
  await expect(
    page.getByText("Swap finalized.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New swap", exact: true }),
  ).toBeEnabled();
  expect(requests.indexOf("wallet:sign")).toBeLessThan(
    requests.indexOf("forumSwapSubmission:registerSigned"),
  );
  expect(requests.indexOf("forumSwapSubmission:registerSigned")).toBeLessThan(
    requests.indexOf("forumSwapSubmission:relay"),
  );
  expect(
    requests.filter((r) => r === "forumSwapSubmission:relay"),
  ).toHaveLength(1);
  expect(requests).not.toContain("forumSwaps:beginWalletRequest");
  expect(requests).not.toContain("forumSwaps:confirm");
  await expect(page.locator("#wallet-calls")).toHaveText("1");
  await page.getByRole("button", { name: "New swap", exact: true }).click();
  await expect(page.getByLabel("You pay", { exact: true })).toHaveValue("");
  await expect(page.locator("#wallet-calls")).toHaveText("1");
});
for (const { version, restore } of [
  { version: 0, restore: false },
  { version: 1, restore: true },
])
  test(`sign-only wallet ${restore ? "restores a linked account" : "connects explicitly"} and completes a v${version} swap without a send feature`, async ({
    page,
  }) => {
    const requests = await harness(
      page,
      `?signaturefirst&managed&signonly${restore ? "&authorized" : ""}${version === 1 ? "&v1" : ""}`,
    );
    if (!restore) await connect(page);
    else
      await expect(
        page.getByRole("button", { name: "Connect wallet", exact: true }),
      ).toHaveCount(0);
    await page.getByLabel("You pay", { exact: true }).fill("0.01");
    await reviewSwap(page);
    await expect(
      page.getByText("Swap finalized.", { exact: false }),
    ).toBeVisible();
    for (const operation of [
      "wallet:sign",
      "forumSwapSubmission:registerSigned",
      "forumSwapSubmission:relay",
    ])
      expect(requests.filter((request) => request === operation)).toHaveLength(
        1,
      );
    expect(requests.indexOf("wallet:sign")).toBeLessThan(
      requests.indexOf("forumSwapSubmission:registerSigned"),
    );
    expect(requests.indexOf("forumSwapSubmission:registerSigned")).toBeLessThan(
      requests.indexOf("forumSwapSubmission:relay"),
    );
    expect(requests).not.toContain("forumSwaps:beginWalletRequest");
    expect(requests).not.toContain("forumSwaps:confirm");
    await expect(page.locator("#wallet-calls")).toHaveText("1");
  });
for (const mode of ["", "&promotion"])
  test(`sign-only wallet is excluded from ${mode ? "promotion" : "legacy swap"} sending`, async ({
    page,
  }) => {
    const requests = await harness(page, `?signonly&authorized${mode}`);
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Test Solana Wallet" }),
    ).toHaveCount(0);
    await expect(
      dialog.getByText(
        "Open this page in a Wallet Standard compatible Solana browser.",
      ),
    ).toBeVisible();
    expect(requests).not.toContain("forumSwaps:prepare");
    expect(requests).not.toContain("forumPromotions:prepare");
    await expect(page.locator("#wallet-calls")).toHaveText("0");
  });
for (const mode of [
  "signfail",
  "signfail&signonly",
  "registerfail",
  "unsignedresponse",
  "unsignedresponse&v1",
])
  test(`${mode} is closed before any app submission without send fallback`, async ({
    page,
  }) => {
    const requests = await harness(page, `?authorized&signaturefirst&${mode}`);
    await page.getByLabel("You pay", { exact: true }).fill("0.01");
    await reviewSwap(page);
    await expect(page.getByRole("alert")).toContainText(
      mode !== "registerfail"
        ? "Wallet signing did not complete"
        : "Submission did not start",
    );
    expect(requests).toContain("forumSwapSubmission:cancelUnsubmitted");
    expect(requests).not.toContain("forumSwapSubmission:relay");
    expect(requests).not.toContain("forumSwaps:beginWalletRequest");
    if (mode.startsWith("unsignedresponse")) {
      await expect(page.getByRole("alert")).toContainText(
        "check: signature_missing",
      );
      expect(requests).not.toContain("forumSwapSubmission:registerSigned");
    }
    await expect(page.locator("#wallet-calls")).toHaveText("1");
    await expect(
      page.getByRole("button", { name: "Swap", exact: true }),
    ).toBeEnabled();
  });
test("relay timeout retains a known signature and clickable status without another payment request", async ({
  page,
}) => {
  const requests = await harness(
    page,
    "?authorized&signaturefirst&relaytimeout",
  );
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await reviewSwap(page);
  await expect(page.getByRole("alert")).toContainText(
    "The signature is available",
  );
  const button = page.getByRole("button", { name: "Confirmed · finalizing…" });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(
    page.getByRole("link", { name: "View transaction" }).first(),
  ).toBeVisible();
  await expect(page.locator("#wallet-calls")).toHaveText("1");
  expect(
    requests.filter((r) => r === "forumSwapSubmission:relay"),
  ).toHaveLength(1);
});
test("one Swap click -> simulation -> one wallet approval -> finalized receipt", async ({
  page,
}) => {
  const requests = await harness(page);
  await connect(page);
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await reviewSwap(page);
  await expect(
    page.getByText("Swap finalized.", { exact: false }),
  ).toBeVisible();
  await page.getByText("Transaction details", { exact: true }).click();
  await expect(
    page
      .locator(".commerce-review")
      .getByText("0.000025 SOL (0.25%)", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve in wallet" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "tmp/forum-render-tests/commerce-desktop.png",
    fullPage: true,
  });
  await expect(
    page.getByText("Swap finalized.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator("#wallet-calls")).toHaveText("1");
  expect(requests.indexOf("forumSwaps:beginWalletRequest")).toBeLessThan(
    requests.indexOf("forumSwaps:confirm"),
  );
});
test("managed standard fee disclosure and SDK sign-only completion without holder lookups", async ({
  page,
}) => {
  const requests = await harness(
    page,
    "?authorized&signaturefirst&managed&hideaftersign",
  );
  await page.getByLabel("You pay", { exact: true }).fill(".01");
  await expect(
    page.getByText(/0.5% integrator fee \(Jupiter share included\)/),
  ).toBeVisible();
  await expect(page.locator("#wallet-calls")).toHaveText("0");
  await reviewSwap(page);
  await expect(
    page.getByText("Swap finalized.", { exact: false }),
  ).toBeVisible();
  expect(
    requests.filter((x) => x === "forumSwapSubmission:relay"),
  ).toHaveLength(1);
  expect(requests).not.toContain("forumSwaps:beginWalletRequest");
  expect(requests).not.toContain("forumSwaps:confirm");
  expect(requests).not.toContain("forumCommerce:refreshBenefit");
  await expect(
    page.getByRole("button", { name: "Refresh benefit" }),
  ).toHaveCount(0);
  await expect(page.locator("#wallet-calls")).toHaveText("1");
});
test("managed v1 signs through the real Kit wallet bridge before one signature-first relay", async ({
  page,
}) => {
  const requests = await harness(page, "?authorized&signaturefirst&managed&v1");
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await reviewSwap(page);
  await expect(
    page.getByText("Swap finalized.", { exact: false }),
  ).toBeVisible();
  expect(
    requests.filter((x) => x === "forumSwapSubmission:registerSigned"),
  ).toHaveLength(1);
  expect(
    requests.filter((x) => x === "forumSwapSubmission:relay"),
  ).toHaveLength(1);
  expect(requests).not.toContain("forumSwaps:beginWalletRequest");
  await expect(page.locator("#wallet-calls")).toHaveText("1");
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
test("double clicks still open only one wallet request", async ({ page }) => {
  const requests = await harness(page, "?authorized");
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  const swap = page.getByRole("button", { name: "Swap", exact: true });
  await expect(swap).toBeEnabled();
  await swap.evaluate((element: HTMLButtonElement) => {
    element.click();
    element.click();
  });
  await expect(
    page.getByText("Swap finalized.", { exact: false }),
  ).toBeVisible();
  expect(
    requests.filter((r) => r === "forumSwaps:beginWalletRequest"),
  ).toHaveLength(1);
  expect(requests.filter((r) => r === "forumSwaps:prepare")).toHaveLength(1);
  await expect(page.locator("#wallet-calls")).toHaveText("1");
});
test("an existing hold offers clickable recovery without new buying or quote spend", async ({
  page,
}) => {
  const requests = await harness(page, "?authorized&held");
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await expect(
    page.getByRole("button", { name: "View swap status" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "View swap status" }).click();
  await expect(
    page
      .getByRole("group")
      .filter({ has: page.getByText("Recent operations", { exact: true }) }),
  ).toHaveAttribute("open", "");
  await expect(
    page.getByRole("link", { name: "View wallet transactions" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Receipt signature for held-fixture" }),
  ).toBeVisible();
  await page.waitForTimeout(1500);
  expect(requests).not.toContain("forumSwaps:quote");
  expect(requests).not.toContain("forumSwaps:prepare");
  await expect(page.locator("#wallet-calls")).toHaveText("0");
});
test("a receipt-check error is distinguished from a missing wallet signature", async ({
  page,
}) => {
  const requests = await harness(page, "?authorized&confirmfail");
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await reviewSwap(page);
  await expect(page.getByRole("alert")).toContainText(
    "wallet returned a transaction signature",
  );
  await expect(
    page.getByRole("link", { name: "View transaction" }),
  ).toBeVisible();
  expect(requests.filter((r) => r === "forumSwaps:markUnknown")).toHaveLength(
    1,
  );
  await expect(page.locator("#wallet-calls")).toHaveText("1");
});
test("automatic recovery enrolls once and unlocks a proven expired swap without a new wallet request", async ({
  page,
}) => {
  const requests = await harness(page, "?authorized&held&auto");
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await expect(
    page.getByRole("button", { name: "Waiting for verification" }),
  ).toBeEnabled();
  await expect(
    page.getByText("Checking automatically after the transaction expires.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect
    .poll(() => requests.filter((r) => r === "forumSwapRecovery:ensure").length)
    .toBe(1);
  expect(requests).not.toContain("forumSwaps:quote");
  await page.evaluate(() =>
    window.dispatchEvent(new Event("commerce:resolve-recovery")),
  );
  await expect(
    page.getByRole("button", { name: "Swap", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".swap-receive")).toHaveText("1");
  expect(requests.filter((r) => r === "forumSwapRecovery:ensure")).toHaveLength(
    1,
  );
  expect(requests).not.toContain("forumSwaps:prepare");
  expect(requests).not.toContain("forumSwaps:beginWalletRequest");
  await expect(page.locator("#wallet-calls")).toHaveText("0");
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
    page.getByRole("button", { name: "Swap", exact: true }),
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
  await expect(page.getByRole("alert")).toContainText("Do not repeat");
  await expect(
    page.getByRole("button", { name: "View swap status" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "View swap status" }).click();
  await expect(
    page.getByText("A previous wallet request needs verification.", {
      exact: false,
    }),
  ).toBeVisible();
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
  await expect(page.getByRole("alert")).toContainText(
    "No wallet window was opened",
  );
  await expect(page.locator("#wallet-calls")).toHaveText("0");
  expect(requests).not.toContain("forumSwaps:markUnknown");
});
test("internal wallet errors display safe categories and never replay or expose provider text", async ({
  page,
}) => {
  const requests = await harness(page, "?authorized&walletinternal");
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await reviewSwap(page);
  await expect(page.getByRole("alert")).toContainText(
    "internal sign-and-send error",
  );
  await page.getByText("Safe wallet diagnostic", { exact: true }).click();
  await expect(
    page.getByText(
      "Stage: wallet; wallet phase: request; code: -32603; response: none.",
    ),
  ).toBeVisible();
  expect(warnings.join("\n")).toContain('"code":-32603');
  expect(warnings.join("\n")).not.toContain("private wallet provider body");
  expect(
    requests.filter((r) => r === "forumSwaps:beginWalletRequest"),
  ).toHaveLength(1);
  await expect(page.locator("#wallet-calls")).toHaveText("1");
});
test("hiding the page during admission never opens a wallet prompt or releases its fence", async ({
  page,
}) => {
  const requests = await harness(page, "?authorized&hidehandoff");
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await reviewSwap(page);
  await expect(page.getByRole("alert")).toContainText(
    "No wallet window was opened",
  );
  await expect(page.locator("#wallet-calls")).toHaveText("0");
  expect(
    requests.filter((r) => r === "forumSwaps:beginWalletRequest"),
  ).toHaveLength(1);
  expect(requests).not.toContain("forumSwaps:markUnknown");
});
test("promotion needs a separate explicit irreversible-burn consent", async ({
  page,
}) => {
  const requests = await harness(page, "?promotion");
  await connect(page);
  await page.locator(".promotion-calendar-time-grid input").first().check();
  await page.getByRole("button", { name: "Reserve selected slots" }).click();
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
    page.getByRole("button", { name: "Swap", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".swap-receive")).toHaveText("1");
  expect(requests.filter((r) => r === "forumSwaps:quote")).toHaveLength(1);
  expect(requests).not.toContain("forumSwaps:prepare");
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  await expect(
    page.getByText("Swap finalized.", { exact: false }),
  ).toBeVisible();
  expect(
    requests.filter((r) => r === "forumSwaps:beginWalletRequest"),
  ).toHaveLength(1);
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
    page.getByRole("button", { name: "Swap", exact: true }),
  ).toBeEnabled();
  await page.clock.runFor(180000);
  await expect(
    page.getByRole("button", { name: "Swap", exact: true }),
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
test("Swap refreshes an expired quote and opens the wallet without another review click", async ({
  page,
}) => {
  await page.clock.install();
  const requests = await harness(page, "?authorized");
  await page.getByLabel("You pay", { exact: true }).fill("1");
  await page.clock.runFor(1100);
  await expect(page.locator(".swap-receive")).toHaveText("1");
  await page.clock.runFor(180000);
  await expect(page.locator(".swap-receive")).toHaveText("0.00");
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  await expect(
    page.getByText("Swap finalized.", { exact: false }),
  ).toBeVisible();
  expect(requests.filter((r) => r === "forumSwaps:quote")).toHaveLength(2);
  expect(requests.filter((r) => r === "forumSwaps:prepare")).toHaveLength(1);
  expect(
    requests.filter((r) => r === "forumSwaps:beginWalletRequest"),
  ).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: /Compare routes|Refresh quote/ }),
  ).toHaveCount(0);
});
test("a worse refreshed quote updates the preview but never opens the wallet until a new click", async ({
  page,
}) => {
  await page.clock.install();
  const requests = await harness(page, "?authorized&worsequote");
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await page.clock.runFor(1100);
  await expect(page.locator(".swap-receive")).toHaveText("1");
  await page.clock.runFor(180000);
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  await expect(
    page.getByText("Quote updated:", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".swap-receive")).toHaveText("0.8");
  expect(requests).not.toContain("forumSwaps:prepare");
  expect(requests).not.toContain("forumSwaps:beginWalletRequest");
  await expect(page.locator("#wallet-calls")).toHaveText("0");
});
test("minimum, fee and high impact warning are visible before any wallet request", async ({
  page,
}) => {
  const requests = await harness(page, "?authorized&highimpact");
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await expect(page.locator(".swap-preview")).toContainText("0.995 USDC");
  await expect(page.locator(".swap-preview")).toContainText(
    "0.000025 SOL (0.25%)",
  );
  await expect(page.locator(".swap-preview")).toContainText(
    "High price impact",
  );
  expect(requests).not.toContain("forumSwaps:prepare");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("v0 compatibility invalidates the old preview and is sent in the next fresh quote only", async ({
  page,
}) => {
  const requests = await harness(page, "?authorized");
  const bodies: { supportsV1: boolean }[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("forumSwaps:quote"))
      bodies.push(request.postDataJSON());
  });
  await page
    .getByRole("group")
    .filter({ has: page.getByText("Wallet compatibility", { exact: true }) })
    .locator("summary")
    .click();
  await page
    .getByLabel("Transaction format", { exact: true })
    .selectOption("v0");
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0].supportsV1).toBe(false);
  expect(requests).not.toContain("forumSwaps:beginWalletRequest");
});
test("offline state stops automatic quotes and wallet approvals", async ({
  page,
}) => {
  const requests = await harness(page, "?authorized");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => false,
    });
    window.dispatchEvent(new Event("offline"));
  });
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await expect(
    page.getByRole("button", { name: "Reconnect to swap" }),
  ).toBeDisabled();
  await page.waitForTimeout(1400);
  expect(requests).not.toContain("forumSwaps:quote");
  expect(requests).not.toContain("forumSwaps:beginWalletRequest");
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

test.describe("automatic tokens and the multi-slot promotion calendar", () => {
  test.use({ timezoneId: "America/Chicago", locale: "en-US" });
  for (const state of ["postchecking", "postverified"])
    test(`signed-out post token ${state} needs no verification button or wallet action`, async ({
      page,
    }) => {
      const requests = await harness(page, `?promotion&guest&${state}`);
      if (state === "postchecking")
        await expect(
          page.getByText("Checking this token automatically…", { exact: true }),
        ).toBeVisible();
      else
        await expect(
          page.getByRole("heading", {
            name: "Token mentioned in this post",
            exact: true,
          }),
        ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Verify token for swaps" }),
      ).toHaveCount(0);
      expect(requests).not.toContain("forumCommerce:resolveMint");
      expect(requests).not.toContain("forumSwaps:quote");
      await expect(page.locator("#wallet-calls")).toHaveText("0");
    });

  for (const width of [1280, 390])
    test(`calendar selects two dates and itemizes one checkout at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.clock.install({ time: new Date("2026-10-31T19:20:00Z") });
      const requests = await harness(page, "?promotion&authorized");
      const calendar = page.locator(".promotion-calendar");
      await expect(calendar).toContainText("October 2026");
      await calendar
        .locator(".promotion-calendar-time-grid input")
        .first()
        .check();
      await calendar
        .getByRole("button", { name: "Next month", exact: true })
        .click();
      await calendar
        .getByRole("button", { name: "Monday, November 2", exact: true })
        .click();
      await calendar
        .locator(".promotion-calendar-time-grid input")
        .first()
        .check();
      await expect(calendar).toContainText("2 selected · 20,000 SYMF total");
      expect(requests).not.toContain("forumPromotions:quotePromotion");
      const payload = page.waitForRequest((r) =>
        r.url().includes("/__commerce/forumPromotions:quotePromotion"),
      );
      await calendar
        .getByRole("button", { name: "Reserve selected slots" })
        .click();
      const input = (await payload).postDataJSON();
      expect(input.selectedStartsAt).toHaveLength(2);
      expect(input.expectedCategoryId).toBe("board-fixture");
      expect(
        input.selectedStartsAt[1] - input.selectedStartsAt[0],
      ).toBeGreaterThan(86400000);
      await expect(
        page.getByText("2 selected placements", { exact: true }),
      ).toBeVisible();
      await expect(page.locator(".commerce-review")).toContainText(
        "20,000 SYMF",
      );
      await expect(page.locator("#wallet-calls")).toHaveText("0");
      expect(requests).not.toContain("forumPromotions:prepare");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `tmp/forum-render-tests/promotion-calendar-${width}.png`,
        fullPage: true,
      });
    });
  test("guests can browse times and the repeated DST hour has distinct labels", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-10-31T19:20:00Z") });
    const requests = await harness(page, "?promotion&guest");
    const calendar = page.locator(".promotion-calendar");
    await calendar
      .getByRole("button", { name: "Next month", exact: true })
      .click();
    await calendar
      .getByRole("button", { name: "Sunday, November 1", exact: true })
      .click();
    await expect(
      calendar.getByRole("checkbox", { name: /^1:00 AM CDT/ }),
    ).toHaveCount(1);
    await expect(
      calendar.getByRole("checkbox", { name: /^1:00 AM CST/ }),
    ).toHaveCount(1);
    await calendar.getByRole("checkbox", { name: /^1:00 AM CDT/ }).check();
    await expect(
      calendar.getByRole("checkbox", { name: /^1:00 AM CST/ }),
    ).toBeDisabled();
    await expect(
      calendar.getByRole("button", { name: "Reserve selected slots" }),
    ).toBeDisabled();
    expect(requests).not.toContain("forumPromotions:quotePromotion");
    expect(requests).not.toContain("forumCommerce:resolveMint");
    await expect(
      page.getByRole("button", { name: "Verify token for swaps" }),
    ).toHaveCount(0);
    await page.screenshot({
      path: "tmp/forum-render-tests/promotion-calendar-selection.png",
      fullPage: true,
    });
  });
});
