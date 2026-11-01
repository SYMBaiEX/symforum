import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

let bundle: string;
const styles: Record<string, string> = {};
test.beforeAll(() => {
  for (const app of ["platform", "forum"]) {
    styles[app] =
      readFileSync("styles/forum-shared.css", "utf8") +
      execFileSync(
        "bun",
        [
          "-e",
          `
      import postcss from "postcss"; import tailwind from "tailwindcss"; import config from "./tailwind.config.ts";
      const css=(await Bun.file("apps/${app}/app/globals.css").text()).replace(/^@import.*$/gm, "");
      process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);
    `,
        ],
        { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
      );
  }
  bundle = execFileSync(
    "bun",
    [
      "-e",
      `
    const result=await Bun.build({entrypoints:["tests/e2e/fixtures/wallet-capability-guidance.tsx"],target:"browser",format:"iife",minify:true,
      define:{"process.env":JSON.stringify({NODE_ENV:"production"})},
      plugins:[{name:"denied-convex",setup(build){build.onResolve({filter:/^convex\\/react$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/wallet-capability-guidance-state.tsx"}));}}]});
    if(!result.success)throw new Error(result.logs.join("\\n"));process.stdout.write(await result.outputs[0].text());
  `,
    ],
    { encoding: "utf8", maxBuffer: 6 * 1024 * 1024 },
  );
});

async function open(page: Page, query: string, app = "platform") {
  const requests: string[] = [];
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:43216" && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (
      url.origin === "http://127.0.0.1:43216" &&
      url.pathname === "/fixture.js"
    )
      return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (
      url.origin === "http://127.0.0.1:43216" &&
      url.pathname === "/images/brand/symforum-icon-64.png"
    )
      return route.fulfill({
        contentType: "image/png",
        body: readFileSync("public/images/brand/symforum-icon-64.png"),
      });
    requests.push(url.pathname);
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:43216/?orderinput&${query}`);
  return requests;
}
async function calls(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __capabilityCalls: string[] }).__capabilityCalls,
  );
}

test("message-only discovery explains why commerce has no selectable wallet", async ({
  page,
}) => {
  const requests = await open(page, "only=message");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Your linked wallet" });
  await expect(dialog).toContainText(
    "1 detected wallet does not expose transaction signing",
  );
  await expect(
    dialog.getByRole("button", { name: "Fixture message" }),
  ).toHaveCount(0);
  expect(await calls(page)).toEqual([]);
  expect(requests).toEqual([]);
});

for (const only of ["sign", "send", "transaction"]) {
  test(`transaction-only ${only} wallet cannot sign in and stays inert`, async ({
    page,
  }) => {
    const requests = await open(page, `signin&only=${only}`);
    await page
      .getByRole("button", { name: "Solana wallet", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
    await expect(dialog).toContainText(
      "1 detected wallet does not expose Sign In with Solana",
    );
    await expect(dialog).toContainText(
      "Transaction signing alone cannot sign you in",
    );
    await expect(
      dialog.getByRole("button", { name: `Fixture ${only}` }),
    ).toHaveCount(0);
    expect(await calls(page)).toEqual([]);
    expect(requests).toEqual([]);
  });
}

for (const only of ["hidden", "noconnect"]) {
  test(`upstream-hidden ${only} wallet is not diagnosed or counted`, async ({
    page,
  }) => {
    const requests = await open(page, `signin&only=${only}`);
    await page
      .getByRole("button", { name: "Solana wallet", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
    await expect(dialog).toContainText(
      "No compatible wallet found for sign-in among the wallets exposed to this page",
    );
    await expect(dialog).toContainText(
      "does not tell us whether another wallet is installed or locked",
    );
    await expect(dialog).not.toContainText("detected wallet");
    await expect(dialog).not.toContainText(`Fixture ${only}`);
    expect(await calls(page)).toEqual([]);
    expect(requests).toEqual([]);
  });
}

test("sign-in/message-only choices remain explicit while transaction-only wallets are excluded", async ({
  page,
}) => {
  const requests = await open(page, "signin");
  await page
    .getByRole("button", { name: "Solana wallet", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
  await expect(
    dialog.getByRole("button", { name: /Fixture message Installed/ }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /Fixture siws Installed/ }),
  ).toBeVisible();
  await expect(dialog).toContainText(
    "3 detected wallets do not expose Sign In with Solana",
  );
  for (const kind of ["sign", "send", "transaction", "hidden", "noconnect"])
    await expect(
      dialog.getByRole("button", { name: `Fixture ${kind}`, exact: true }),
    ).toHaveCount(0);
  expect(await calls(page)).toEqual([]);
  expect(requests).toEqual([]);
});

for (const send of [false, true]) {
  test(`commerce chooser preserves ${send ? "send" : "sign"} lane and explains excluded capabilities`, async ({
    page,
  }) => {
    const requests = await open(page, send ? "sendlane" : "");
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Your linked wallet" });
    const feature = send
      ? "solana:signAndSendTransaction"
      : "solana:signTransaction";
    await expect(dialog).toContainText(feature);
    await expect(dialog).toContainText("3 detected wallets do not expose");
    await expect(
      dialog.getByRole("button", {
        name: `Fixture ${send ? "send" : "sign"}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Fixture transaction", exact: true }),
    ).toBeVisible();
    for (const kind of ["message", "siws", send ? "sign" : "send"])
      await expect(
        dialog.getByRole("button", { name: `Fixture ${kind}`, exact: true }),
      ).toHaveCount(0);
    expect(await calls(page)).toEqual([]);
    expect(requests).toEqual([]);
  });
}

test("explicit commerce selection opens one inert connect; pending focus cannot repeat it", async ({
  page,
}) => {
  const requests = await open(page, "only=sign&deferconnect");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  const choice = page.getByRole("button", {
    name: "Fixture sign",
    exact: true,
  });
  await choice.focus();
  await page.keyboard.press("Enter");
  await expect(choice).toBeDisabled();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
  });
  await page.keyboard.press("Enter");
  expect(await calls(page)).toEqual(["connect:sign:true"]);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("capability-fixture:release")),
  );
  await expect(page.getByRole("alert")).toContainText("could not connect");
  expect(await calls(page)).toEqual(["connect:sign:true"]);
  expect(requests).toEqual([]);
});

test("message-only selection with no exposed account does not prepare or sign", async ({
  page,
}) => {
  const requests = await open(page, "signin&only=message");
  await page
    .getByRole("button", { name: "Solana wallet", exact: true })
    .click();
  await page.getByRole("button", { name: /Fixture message Installed/ }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(await calls(page)).toEqual(["connect:message:true"]);
  expect(requests).toEqual([]);
});

for (const [query, label, disabled] of [
  ["guest", "Sign in with wallet", false],
  ["unlinked", "Link wallet to trade", false],
  ["authloading", "Sign in with wallet", true],
  ["sessionloading", "Connect wallet", true],
] as const) {
  test(`${query} state preserves the original commerce gate`, async ({
    page,
  }) => {
    const requests = await open(page, query);
    const button = page.getByRole("button", { name: label, exact: true });
    if (disabled) await expect(button).toBeDisabled();
    else {
      await button.click();
      await expect(
        page.getByRole("dialog", {
          name: query === "unlinked" ? "Link a wallet" : "Connect a wallet",
        }),
      ).toBeVisible();
    }
    expect(await calls(page)).toEqual([]);
    expect(requests).toEqual([]);
  });
}

for (const send of [false, true]) {
  test(`swap ${send ? "send" : "sign"} capability mismatch is distinct from version mismatch`, async ({
    page,
  }) => {
    const requests = await open(
      page,
      `swap&connected&select=${send ? "sign" : "send"}${send ? "&sendlane" : ""}`,
    );
    const swap = page.getByRole("region", { name: "Token swap" });
    await expect(
      swap.getByRole("status").filter({ hasText: "The connected account" }),
    ).toContainText(
      `does not expose ${send ? "solana:signAndSendTransaction" : "solana:signTransaction"}`,
    );
    await expect(
      swap.getByRole("button", {
        name: /Wallet cannot (sign|send) this format/,
      }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "1111…1111", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "The connected account does not expose",
    );
    expect(await calls(page)).toEqual([]);
    expect(requests).toEqual([]);
  });
}

test("wallet-level capability is not promised for every exposed account", async ({
  page,
}) => {
  const requests = await open(
    page,
    "swap&connected&select=sign&accountmissing",
  );
  await expect(
    page.getByRole("status").filter({ hasText: "The connected account" }),
  ).toContainText("does not expose solana:signTransaction");
  await page.getByRole("button", { name: "1111…1111", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Wallet-level support does not guarantee support for every account",
  );
  expect(await calls(page)).toEqual([]);
  expect(requests).toEqual([]);
});

for (const send of [false, true]) {
  test(`unsupported version keeps ${send ? "send" : "sign"} format choice explicit and does not retry`, async ({
    page,
  }) => {
    const requests = await open(
      page,
      `swap&connected&select=transaction&versionmismatch${send ? "&sendlane" : ""}`,
    );
    await expect(
      page.getByRole("status").filter({ hasText: "The connected account" }),
    ).toContainText("does not support the selected transaction format");
    await page.getByText("Wallet compatibility", { exact: true }).click();
    await expect(
      page.getByText(/Automatic checks the connected account’s/),
    ).toContainText(
      send
        ? "transaction signing and sending capability"
        : "transaction signing capability",
    );
    await page.getByLabel("Transaction format").selectOption("v0");
    await expect(
      page.getByRole("button", {
        name: /Wallet cannot (sign|send) this format/,
      }),
    ).toBeDisabled();
    await expect(
      page.getByRole("status").filter({ hasText: "The connected account" }),
    ).toContainText("never retries an existing payment");
    expect(await calls(page)).toEqual([]);
    expect(requests).toEqual([]);
  });
}

test("held outcome retains the original recovery gate and one-shot admission without retry", async ({
  page,
}) => {
  const requests = await open(
    page,
    "swap&held&connected&select=sign&versionmismatch",
  );
  await expect(
    page.getByRole("button", { name: "1111…1111", exact: true }),
  ).toBeEnabled();
  await page.getByText("Wallet compatibility", { exact: true }).click();
  await expect(page.getByLabel("Transaction format")).toBeEnabled();
  await page.getByLabel("Transaction format").selectOption("v0");
  await expect(
    page.getByRole("button", { name: "View swap status", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(await calls(page)).toEqual(["mutation:forumSwapRecovery:ensure"]);
  await expect(
    page.getByRole("status").filter({ hasText: "The connected account" }),
  ).toContainText("A held outcome must be verified first");
  expect(requests).toEqual([]);
});

for (const app of ["platform", "forum"]) {
  for (const width of [320, 390, 1280]) {
    test(`${app} swap capability guidance stays bounded at ${width}px without a new read or wallet request`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.emulateMedia({
        reducedMotion: "reduce",
        forcedColors: width === 390 ? "active" : "none",
      });
      const requests = await open(page, "swap&connected&select=send", app);
      const note = page
        .getByRole("status")
        .filter({ hasText: "The connected account" });
      await expect(note).toContainText(
        "does not expose solana:signTransaction",
      );
      const box = await note.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      expect(
        await note.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      const reads = await page.evaluate(
        () =>
          (window as unknown as { __terminalFixtureQueries: string[] })
            .__terminalFixtureQueries.length,
      );
      await page.evaluate(() => {
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("pageshow"));
      });
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { __terminalFixtureQueries: string[] })
              .__terminalFixtureQueries.length,
        ),
      ).toBe(reads);
      expect(await calls(page)).toEqual([]);
      expect(requests).toEqual([]);
    });
  }
  for (const width of [320, 390, 1280]) {
    for (const surface of ["signin", "commerce"]) {
      test(`${app} ${surface} guidance at ${width}px has bounded text, 44px targets and keyboard focus`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 720 });
        await page.emulateMedia({
          reducedMotion: "reduce",
          forcedColors: width === 390 ? "active" : "none",
          colorScheme: width === 1280 ? "dark" : "light",
        });
        const requests = await open(
          page,
          surface === "signin" ? "signin" : "",
          app,
        );
        if (width === 1280)
          await page.evaluate(() =>
            document.documentElement.classList.add("dark"),
          );
        const trigger = page.getByRole("button", {
          name: surface === "signin" ? "Solana wallet" : "Connect wallet",
          exact: true,
        });
        await expect(trigger).toBeEnabled();
        const target = await trigger.evaluate((element) => ({
          height: element.getBoundingClientRect().height,
          minHeight: getComputedStyle(element).minHeight,
          rootFont: getComputedStyle(document.documentElement).fontSize,
          transform: getComputedStyle(element).transform,
        }));
        await expect
          .poll(async () => (await trigger.boundingBox())?.height, {
            message: JSON.stringify(target),
          })
          .toBeGreaterThanOrEqual(44);
        await trigger.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText("detected wallets do not expose");
        const geometry = await dialog.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
            client: element.clientWidth,
            scroll: element.scrollWidth,
          };
        });
        expect(geometry.left).toBeGreaterThanOrEqual(0);
        expect(geometry.right).toBeLessThanOrEqual(width);
        expect(geometry.top).toBeGreaterThanOrEqual(0);
        expect(geometry.bottom).toBeLessThanOrEqual(720);
        expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
        for (const control of await dialog.getByRole("button").all()) {
          const box = await control.boundingBox();
          expect(box?.width).toBeGreaterThanOrEqual(44);
          expect(box?.height).toBeGreaterThanOrEqual(44);
        }
        await page.keyboard.press("Tab");
        expect(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        ).toBe(true);
        const focus = await page.locator(":focus").evaluate((element) => {
          const css = getComputedStyle(element);
          return { outline: css.outlineStyle, shadow: css.boxShadow };
        });
        expect(focus.outline !== "none" || focus.shadow !== "none").toBe(true);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await trigger.click();
        if (width === 320 || width === 1280)
          await page.screenshot({
            path: testInfo.outputPath(`${app}-${surface}-${width}.png`),
          });
        expect(await calls(page)).toEqual([]);
        expect(requests).toEqual([]);
      });
    }
  }
}

test("desktop connected wallet trigger and Disconnect retain 44px targets", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const requests = await open(page, "connected&select=sign");
  const trigger = page.getByRole("button", { name: "1111…1111", exact: true });
  await expect(trigger).toBeVisible();
  expect((await trigger.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await trigger.click();
  await expect
    .poll(
      async () =>
        (
          await page
            .getByRole("button", { name: "Disconnect wallet", exact: true })
            .boundingBox()
        )?.height,
    )
    .toBeGreaterThanOrEqual(44);
  expect(await calls(page)).toEqual([]);
  expect(requests).toEqual([]);
});
