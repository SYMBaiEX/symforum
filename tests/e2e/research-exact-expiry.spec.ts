import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43236",
  styles = {} as Record<"platform" | "forum", string>;
let script: string;
const start = new Date("2026-10-31T17:10:00.000Z"),
  base = start.getTime() + 1000;
const mintA = "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump",
  mintB = "So11111111111111111111111111111111111111112";
type Patch = {
  mint?: string;
  wallet?: string;
  authenticated?: boolean;
  linked?: boolean;
  mode?: string;
  receiptState?:
    | "quoted"
    | "verifying"
    | "settlement_claimed"
    | "unknown"
    | "fulfilled"
    | "rejected"
    | "expired";
  intentKey?: string;
  expiresAt?: number;
  mounted?: boolean;
  holdReview?: boolean;
};
declare global {
  interface Window {
    __researchExpiry: {
      update(patch: Patch): void;
      reads: { name: string; args: unknown }[];
      actions: { name: string; args: unknown }[];
      forbidden: string[];
      releaseReview(): void;
    };
    __expiryVisibility: {
      set(value: boolean): void;
      pending(): number[];
      ticks: number;
    };
    __expiryAnnouncements: string[];
  }
}
const audits = new WeakMap<Page, { errors: string[]; outbound: string[] }>();
const dialog = (page: Page) =>
  page.getByRole("dialog", {
    name: "Research export · $0.10 USDC",
    exact: true,
  });
const review = (page: Page) =>
  page.getByRole("button", { name: "Review research export", exact: true });
const approve = (page: Page) =>
  page.getByRole("button", {
    name: "Approve $0.10 USDC purchase",
    exact: true,
  });
const expired = (page: Page) =>
  page.getByRole("button", {
    name: "Quote expired · close to refresh",
    exact: true,
  });
test.beforeAll(() => {
  for (const app of ["platform", "forum"] as const)
    styles[app] =
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/research-exact-expiry.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"research-expiry-only",setup(build){build.onResolve({filter:/^convex\\/react$|commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/research-exact-expiry-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 9 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  query = "",
  app: "platform" | "forum" = "platform",
) {
  const audit = { errors: [] as string[], outbound: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(base));
  await page.addInitScript(() => {
    let visible = true;
    const pending = new Map<number, number>(),
      set = window.setTimeout.bind(window),
      clear = window.clearTimeout.bind(window);
    const fixture = {
      set(value: boolean) {
        visible = value;
        document.dispatchEvent(new Event("visibilitychange"));
      },
      pending: () => [...pending.values()],
      ticks: 0,
    };
    window.__expiryVisibility = fixture;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (visible ? "visible" : "hidden"),
    });
    Object.defineProperty(window, "setTimeout", {
      configurable: true,
      value: (callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        const tracked = typeof delay === "number" && delay > 0 && delay <= 1000;
        const id = set(() => {
          pending.delete(id);
          if (tracked) fixture.ticks++;
          if (typeof callback === "function") callback(...args);
          else throw new Error("String timer denied");
        }, delay);
        if (tracked) pending.set(id, delay!);
        return id;
      },
    });
    Object.defineProperty(window, "clearTimeout", {
      configurable: true,
      value: (id?: number) => {
        if (id !== undefined) pending.delete(id);
        clear(id);
      },
    });
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    audit.outbound.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/?${query}`);
  await expect(
    page.getByRole("heading", { name: "Token research export", exact: true }),
  ).toBeVisible();
}
async function patch(page: Page, value: Patch) {
  await page.evaluate((value) => window.__researchExpiry.update(value), value);
}
const actions = (page: Page) =>
  page.evaluate(() => window.__researchExpiry.actions);
const configReads = (page: Page) =>
  page.evaluate(() =>
    window.__researchExpiry.reads.filter(
      (read) => read.name === "forumResearch:getConfig",
    ),
  );
test.afterEach(async ({ page }) => {
  expect(audits.get(page)?.errors).toEqual([]);
  expect(audits.get(page)?.outbound).toEqual([]);
  expect(await page.evaluate(() => window.__researchExpiry.forbidden)).toEqual(
    [],
  );
  expect(
    (await actions(page)).every(
      (action) => action.name === "forumResearchActions:quote",
    ),
  ).toBe(true);
});
test("the exact bound deadline disables review at expiry, not at the next minute bucket", async ({
  page,
}) => {
  await harness(page);
  await review(page).click();
  await expect(approve(page)).toBeEnabled();
  await page.clock.runFor(24999);
  await expect(approve(page)).toBeEnabled();
  await page.clock.runFor(1);
  await expect(expired(page)).toBeDisabled();
  await page.clock.runFor(1);
  await expect(expired(page)).toBeDisabled();
  expect((await actions(page)).length).toBe(1);
  expect(await configReads(page)).toEqual([
    { name: "forumResearch:getConfig", args: { now: start.getTime() } },
  ]);
});
const expiryRegion = (page: Page) =>
  dialog(page).getByRole("region", { name: "Quote expiry", exact: true });
async function watchAnnouncements(page: Page) {
  await expiryRegion(page)
    .getByRole("status")
    .evaluate((node) => {
      window.__expiryAnnouncements = [];
      new MutationObserver(() => {
        if (node.textContent?.trim())
          window.__expiryAnnouncements.push(node.textContent.trim());
      }).observe(node, { childList: true, characterData: true, subtree: true });
    });
}
test("countdown uses original full UTC expiry and announces only one expiry transition", async ({
  page,
}) => {
  await harness(page);
  await review(page).click();
  const deadline = new Date(base + 25000).toISOString();
  await expect(expiryRegion(page).locator("time")).toHaveAttribute(
    "datetime",
    deadline,
  );
  await expect(expiryRegion(page).locator("time")).toHaveText(
    `${deadline} (UTC)`,
  );
  await expect(
    expiryRegion(page).getByText("Quote expires in 25 seconds.", {
      exact: true,
    }),
  ).toHaveAttribute("aria-live", "off");
  await watchAnnouncements(page);
  await page.clock.runFor(5000);
  await expect(
    expiryRegion(page).getByText("Quote expires in 20 seconds.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__expiryAnnouncements)).toEqual([]);
  await page.clock.runFor(20000);
  await expect(expired(page)).toBeDisabled();
  await expect(expiryRegion(page).getByRole("status")).toHaveText(
    "Quote expired. Close this review to request a fresh quote. Nothing is retried automatically.",
  );
  expect(await page.evaluate(() => window.__expiryAnnouncements)).toHaveLength(
    1,
  );
  const ticks = await page.evaluate(() => window.__expiryVisibility.ticks);
  expect(
    await page.evaluate(() => window.__expiryVisibility.pending()),
  ).toEqual([]);
  await page.clock.runFor(65000);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
  });
  expect(await page.evaluate(() => window.__expiryVisibility.ticks)).toBe(
    ticks,
  );
  expect(await page.evaluate(() => window.__expiryAnnouncements)).toHaveLength(
    1,
  );
  await expect(expiryRegion(page).locator("time")).toHaveAttribute(
    "datetime",
    deadline,
  );
  expect((await actions(page)).length).toBe(1);
});
test("display ticks keep the original minute-bucket config query arguments and cadence", async ({
  page,
}) => {
  await harness(page);
  await patch(page, { expiresAt: base + 90000 });
  await review(page).click();
  await page.clock.runFor(59000);
  expect(await configReads(page)).toEqual([
    { name: "forumResearch:getConfig", args: { now: start.getTime() } },
  ]);
  await page.clock.runFor(1000);
  expect(await configReads(page)).toEqual([
    { name: "forumResearch:getConfig", args: { now: start.getTime() } },
    { name: "forumResearch:getConfig", args: { now: start.getTime() + 60000 } },
  ]);
  await page.clock.runFor(30000);
  await expect(expired(page)).toBeDisabled();
  expect(await configReads(page)).toHaveLength(2);
  expect(await actions(page)).toEqual([
    {
      name: "forumResearchActions:quote",
      args: {
        wallet: "11111111111111111111111111111111",
        mint: mintA,
        idempotencyKey: expect.any(String),
      },
    },
  ]);
});
test("hidden review stops display timers and catches up to actual time once on foreground return", async ({
  page,
}) => {
  await harness(page);
  await review(page).click();
  await watchAnnouncements(page);
  await page.clock.runFor(2000);
  await page.evaluate(() => window.__expiryVisibility.set(false));
  expect(
    await page.evaluate(() => window.__expiryVisibility.pending()),
  ).toEqual([]);
  const ticks = await page.evaluate(() => window.__expiryVisibility.ticks);
  await page.clock.fastForward(30000);
  expect(await page.evaluate(() => window.__expiryVisibility.ticks)).toBe(
    ticks,
  );
  expect(await page.evaluate(() => window.__expiryAnnouncements)).toEqual([]);
  await page.evaluate(() => window.__expiryVisibility.set(true));
  await expect(expired(page)).toBeDisabled();
  expect(await page.evaluate(() => window.__expiryAnnouncements)).toHaveLength(
    1,
  );
  expect(
    await page.evaluate(() => window.__expiryVisibility.pending()),
  ).toEqual([]);
  expect((await actions(page)).length).toBe(1);
});
for (const event of ["focus", "pageshow"])
  test(`${event} resamples actual Date.now without renewing the server deadline`, async ({
    page,
  }) => {
    await harness(page);
    await review(page).click();
    await page.clock.setSystemTime(new Date(base + 26000));
    await page.evaluate(
      (event) => window.dispatchEvent(new Event(event)),
      event,
    );
    await expect(expired(page)).toBeDisabled();
    await expect(expiryRegion(page).locator("time")).toHaveAttribute(
      "datetime",
      new Date(base + 25000).toISOString(),
    );
    expect(
      await page.evaluate(() => window.__expiryVisibility.pending()),
    ).toEqual([]);
    expect((await actions(page)).length).toBe(1);
  });
test("close and unmount stop the presentation clock without another quote or late announcement", async ({
  page,
}) => {
  await harness(page);
  await review(page).click();
  await page.clock.runFor(1000);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await page.clock.runFor(250);
  expect(
    await page.evaluate(() => window.__expiryVisibility.pending()),
  ).toEqual([]);
  const ticks = await page.evaluate(() => window.__expiryVisibility.ticks);
  await page.clock.runFor(30000);
  expect(await page.evaluate(() => window.__expiryVisibility.ticks)).toBe(
    ticks,
  );
  expect((await actions(page)).length).toBe(1);
  await patch(page, { intentKey: "b".repeat(64), expiresAt: base + 70000 });
  await review(page).click();
  await expect(approve(page)).toBeEnabled();
  await patch(page, { mounted: false });
  await expect(dialog(page)).toBeHidden();
  expect(
    await page.evaluate(() => window.__expiryVisibility.pending()),
  ).toEqual([]);
  await page.clock.runFor(40000);
  expect((await actions(page)).length).toBe(2);
});
for (const receiptState of [
  "unknown",
  "verifying",
  "settlement_claimed",
  "fulfilled",
  "rejected",
  "expired",
] as const)
  test(`${receiptState} protocol state stops the quoted clock without changing existing receipt handling`, async ({
    page,
  }) => {
    await harness(page);
    await review(page).click();
    await patch(page, { receiptState });
    await expect(expiryRegion(page)).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__expiryVisibility.pending()),
    ).toEqual([]);
    const ticks = await page.evaluate(() => window.__expiryVisibility.ticks);
    await page.clock.runFor(30000);
    expect(await page.evaluate(() => window.__expiryVisibility.ticks)).toBe(
      ticks,
    );
    expect((await actions(page)).length).toBe(1);
    if (["unknown", "verifying", "settlement_claimed"].includes(receiptState))
      await expect(
        dialog(page).getByText(
          /Settlement is being verified. This request cannot be paid again/,
        ),
      ).toBeVisible();
    if (receiptState === "fulfilled")
      await expect(
        dialog(page).getByRole("link", {
          name: "Open verified report and receipt",
          exact: true,
        }),
      ).toHaveAttribute("href", `/api/research/token/${"a".repeat(64)}`);
  });
test("intent A→B→A metadata keeps each original deadline and old timers cannot expire the newer intent", async ({
  page,
}) => {
  await harness(page);
  await review(page).click();
  await page.clock.runFor(1000);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await patch(page, { intentKey: "b".repeat(64), expiresAt: base + 45000 });
  await review(page).click();
  await page.clock.runFor(25000);
  await expect(approve(page)).toBeEnabled();
  await expect(expiryRegion(page).locator("time")).toHaveAttribute(
    "datetime",
    new Date(base + 45000).toISOString(),
  );
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await patch(page, { intentKey: "a".repeat(64) });
  await review(page).click();
  await expect(expired(page)).toBeDisabled();
  await expect(expiryRegion(page).locator("time")).toHaveAttribute(
    "datetime",
    new Date(base + 25000).toISOString(),
  );
  expect(
    await page.evaluate(() => window.__expiryVisibility.pending()),
  ).toEqual([]);
  expect((await actions(page)).length).toBe(3);
});
test("existing mint remount and ABA clear the old review without a quote or timer replay", async ({
  page,
}) => {
  await harness(page);
  await review(page).click();
  await patch(page, { mint: mintB });
  await expect(dialog(page)).toBeHidden();
  expect(
    await page.evaluate(() => window.__expiryVisibility.pending()),
  ).toEqual([]);
  await patch(page, { mint: mintA });
  await expect(dialog(page)).toBeHidden();
  await page.clock.runFor(30000);
  expect((await actions(page)).length).toBe(1);
  expect(
    await page.evaluate(() => window.__expiryVisibility.pending()),
  ).toEqual([]);
});
test("wallet ABA does not renew the existing intent or add a new payer-binding policy", async ({
  page,
}) => {
  await harness(page);
  await review(page).click();
  await page.clock.runFor(10000);
  await patch(page, { wallet: "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY" });
  await page.clock.runFor(10000);
  await patch(page, { wallet: "11111111111111111111111111111111" });
  await page.clock.runFor(5000);
  await expect(expired(page)).toBeDisabled();
  await expect(expiryRegion(page).locator("time")).toHaveAttribute(
    "datetime",
    new Date(base + 25000).toISOString(),
  );
  expect((await actions(page)).length).toBe(1);
});
test("signed-out query boundary stops the display clock without changing the saved intent lifetime on return", async ({
  page,
}) => {
  await harness(page);
  await review(page).click();
  await page.clock.runFor(2000);
  await patch(page, { authenticated: false });
  await expect(expiryRegion(page)).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__expiryVisibility.pending()),
  ).toEqual([]);
  await page.clock.runFor(30000);
  await patch(page, { authenticated: true });
  await expect(expired(page)).toBeDisabled();
  expect((await actions(page)).length).toBe(1);
});
for (const query of [
  "guest",
  "unlinked",
  "mode=loading",
  "mode=setup",
  "mode=exhausted",
])
  test(`${query} keeps the existing readiness/identity boundary and creates no display clock or quote`, async ({
    page,
  }) => {
    await harness(page, query);
    await expect(expiryRegion(page)).toHaveCount(0);
    await page.clock.runFor(3000);
    expect(await actions(page)).toEqual([]);
    expect(
      await page.evaluate(() => window.__expiryVisibility.pending()),
    ).toEqual([]);
    if (query.startsWith("mode=")) await expect(review(page)).toBeDisabled();
  });
test("reserved quoted intent keeps the exact expiry when public readiness closes", async ({
  page,
}) => {
  await harness(page);
  await review(page).click();
  await patch(page, { mode: "exhausted" });
  await expect(approve(page)).toBeEnabled();
  await page.clock.runFor(25000);
  await expect(expired(page)).toBeDisabled();
  expect((await actions(page)).length).toBe(1);
});
test("closing and reopening through a busy inert review cannot renew the same intent after its original deadline", async ({
  page,
}) => {
  await harness(page);
  await review(page).click();
  const original = await expiryRegion(page)
    .locator("time")
    .getAttribute("datetime");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await page.clock.runFor(1);
  await patch(page, { holdReview: true, expiresAt: base + 120000 });
  await review(page).click();
  await expect(
    page.getByRole("button", { name: "Preparing…", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => window.__expiryVisibility.pending()),
  ).toEqual([]);
  await page.clock.runFor(30000);
  await page.evaluate(() => window.__researchExpiry.releaseReview());
  await expect(expired(page)).toBeDisabled();
  await expect(expiryRegion(page).locator("time")).toHaveAttribute(
    "datetime",
    original!,
  );
  await expect(expiryRegion(page).getByRole("status")).toContainText(
    "Quote expired.",
  );
  expect((await actions(page)).length).toBe(2);
  expect(
    await page.evaluate(() => window.__expiryVisibility.pending()),
  ).toEqual([]);
});
for (const unavailable of ["unlinked", "disabled"])
  test(`closing review focuses its visible section when the original trigger is ${unavailable}`, async ({
    page,
  }) => {
    await harness(page);
    await review(page).click();
    await dialog(page).evaluate((node) =>
      Promise.all(
        node
          .getAnimations({ subtree: true })
          .filter(
            (animation) =>
              animation.effect?.getTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
    await patch(
      page,
      unavailable === "unlinked" ? { linked: false } : { mode: "exhausted" },
    );
    const scrollTop = await page
      .locator("main")
      .evaluate((node) => node.scrollTop);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await page.clock.runFor(1);
    await expect(
      page.getByRole("region", { name: "Token research export", exact: true }),
    ).toBeFocused();
    expect(await page.locator("main").evaluate((node) => node.scrollTop)).toBe(
      scrollTop,
    );
    expect((await actions(page)).length).toBe(1);
  });
test("closing or unmounting an unavailable surface does not steal focus into hidden or detached content", async ({
  page,
}) => {
  await harness(page);
  await review(page).click();
  const surface = page.locator(
    'section[aria-labelledby="research-purchase-heading"]',
  );
  await surface.evaluate((node) => {
    (node as HTMLElement).style.visibility = "hidden";
  });
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await page.clock.runFor(1);
  await expect(surface).not.toBeFocused();
  expect(
    await surface.evaluate((node) => node.contains(document.activeElement)),
  ).toBe(false);
  await surface.evaluate((node) => {
    (node as HTMLElement).style.visibility = "visible";
  });
  await patch(page, { intentKey: "b".repeat(64), expiresAt: base + 50000 });
  await review(page).click();
  await patch(page, { mounted: false });
  await expect(dialog(page)).toBeHidden();
  await page.clock.runFor(1);
  const outside = page.getByRole("button", {
    name: "Outside research fixture",
    exact: true,
  });
  await outside.focus();
  await page.clock.runFor(50000);
  await expect(outside).toBeFocused();
  expect(
    await page.evaluate(() => window.__expiryVisibility.pending()),
  ).toEqual([]);
});
for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390])
    test(`${app} ${width}px exact expiry remains readable and keyboard reachable in the actual dialog scrollport`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 568 });
      await harness(page, "", app);
      await review(page).focus();
      await page.keyboard.press("Enter");
      await expect(dialog(page)).toBeVisible();
      await dialog(page).evaluate((node) =>
        Promise.all(
          node
            .getAnimations({ subtree: true })
            .filter(
              (animation) =>
                animation.effect?.getTiming().iterations !== Infinity,
            )
            .map((animation) => animation.finished.catch(() => {})),
        ),
      );
      await approve(page).focus();
      await expect(approve(page)).toBeFocused();
      expect(
        (await approve(page).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
      for (const node of [
        dialog(page),
        expiryRegion(page),
        expiryRegion(page).locator("time"),
        approve(page),
      ]) {
        await node.scrollIntoViewIfNeeded();
        const box = (await node.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(
          await node.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
      }
      const close = dialog(page).getByRole("button", {
        name: "Close",
        exact: true,
      });
      await page.keyboard.press("Tab");
      await expect(close).toBeFocused();
      const closeBounds = (await close.boundingBox())!;
      const closePort = (await dialog(page).boundingBox())!;
      expect(closeBounds.width).toBeGreaterThanOrEqual(44);
      expect(closeBounds.height).toBeGreaterThanOrEqual(44);
      expect(closeBounds.x).toBeGreaterThanOrEqual(closePort.x);
      expect(closeBounds.x + closeBounds.width).toBeLessThanOrEqual(
        closePort.x + closePort.width,
      );
      expect(closeBounds.y).toBeGreaterThanOrEqual(closePort.y);
      expect(closeBounds.y + closeBounds.height).toBeLessThanOrEqual(
        closePort.y + closePort.height,
      );
      await page.clock.runFor(25000);
      await expect(expired(page)).toBeDisabled();
      await expired(page).scrollIntoViewIfNeeded();
      const bounds = (await expired(page).boundingBox())!,
        port = (await dialog(page).boundingBox())!;
      expect(bounds.y).toBeGreaterThanOrEqual(port.y - 1);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(
        port.y + port.height + 1,
      );
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toBeHidden();
      await page.clock.runFor(1);
      await expect(review(page)).toBeFocused();
      expect((await actions(page)).length).toBe(1);
    });
