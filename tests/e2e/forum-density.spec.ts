import { test, expect, type Page, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";

const origin = "http://127.0.0.1:43281";
const css: Record<string, string> = {};
let script: string;
test.beforeAll(() => {
  for (const app of ["platform", "forum"])
    css[app] =
      FORUM_SHARED_THEME_CSS +
      readFileSync("styles/forum-shared.css", "utf8") +
      execFileSync(
        "bun",
        [
          "-e",
          `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
        ],
        { cwd: `apps/${app}`, encoding: "utf8", maxBuffer: 5 * 1024 * 1024 },
      );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/forum-density.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_CONVEX_URL:"https://inert.convex.cloud",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"inert-density",setup(build){build.onLoad({filter:/forum-feed-list[.]tsx$|community-hub[.]tsx$|forum-terminal[.]tsx$/},async({path})=>{let contents=await Bun.file(path).text();const [name,anchor]=path.endsWith("forum-feed-list.tsx")?["feed-controller","  const { isAuthenticated, isLoading } = useConvexAuth();"]:path.endsWith("community-hub.tsx")?["community-controller","  const params = useSearchParams();"]:["terminal-controller","  const client = useCommerceWallet();"];const probe="  useEffect(() => { const e=window.densityEvidence; e.mounts["+JSON.stringify(name)+"]=(e.mounts["+JSON.stringify(name)+"]??0)+1;return()=>{e.unmounts["+JSON.stringify(name)+"]=(e.unmounts["+JSON.stringify(name)+"]??0)+1;}; }, []);\\n";if(!contents.includes(anchor))throw Error("Missing controller probe anchor");return {contents:contents.replace(anchor,probe+anchor),loader:"tsx"};});for(const [filter,file] of [[/^convex\\/react$|^convex-helpers\\/react\\/cache\\/hooks$|^next\\/navigation$|^next\\/link$|ThemeToggle$|site-surface-switcher$|blog-navigation$|newsletter-navigation$|news-navigation$|web-vitals-reporter$|analytics-tracker$|app-error-surface$/,"forum-density-state.tsx"],[/commerce-wallet$/,"terminal-wallet.tsx"],[/^@\\/lib\\/commerce-wallet-client$/,"terminal-wallet-client.ts"],[/forum-primitives$|forum-feed-starter$|forum-media-gallery$/,"forum-feed-leaves.tsx"]])build.onResolve({filter},()=>({path:process.cwd()+"/tests/e2e/fixtures/"+file}));}}]});if(!result.success)throw Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 9 * 1024 * 1024 },
  );
});
type Evidence = {
  mounts: Record<string, number>;
  unmounts: Record<string, number>;
  queries: string[];
  backendReads: string[];
  subscriptions: number;
  mutations: string[];
  forbidden: string[];
  navigation: string[];
};
const evidence = (p: Page) =>
  p.evaluate(
    () => (window as unknown as { densityEvidence: Evidence }).densityEvidence,
  );
async function harness(
  page: Page,
  app = "platform",
  flow = "feed",
  extra = "",
) {
  const errors: string[] = [],
    unexpected: string[] = [],
    requests: string[] = [],
    storage: string[] = [];
  await page.clock.setFixedTime(new Date("2026-11-01T09:00:00Z"));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    const calls: string[] = [];
    Object.assign(window, { densityStorageWrites: calls });
    Storage.prototype.setItem = function (key, value) {
      calls.push(key);
      return set.call(this, key, value);
    };
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      if (
        url.pathname === "/" ||
        url.pathname === "/community" ||
        url.pathname === "/trade"
      )
        return route.fulfill({
          contentType: "text/html",
          body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
        });
      if (url.pathname === "/fixture.js")
        return route.fulfill({ contentType: "text/javascript", body: script });
      if (url.pathname === "/images/brand/symforum-icon-64.png")
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>',
        });
      if (url.pathname.endsWith("/chart")) {
        requests.push(url.href);
        return route.fulfill({
          json: {
            mint: url.pathname.split("/")[3],
            pool: "11111111111111111111111111111111",
            interval: url.searchParams.get("interval"),
            checkedAt: Date.parse("2026-11-01T09:00:00Z"),
            candleSource: "solana-tracker",
            candles: [
              {
                time: Date.parse("2026-11-01T08:45:00Z") / 1000,
                open: 1,
                high: 3,
                low: 0.5,
                close: 2,
                volume: 0,
              },
            ],
          },
        });
      }
    }
    unexpected.push(url.href);
    return route.abort();
  });
  await page.goto(
    `${origin}${flow === "community" ? "/community" : flow === "terminal" ? "/trade" : "/"}?flow=${flow}&orderquote&${extra}`,
  );
  await expect(page.locator(".forum-app-shell")).toBeVisible();
  if (!extra.includes("surface="))
    await expect(page.locator(".forum-app-shell")).toHaveAttribute(
      "data-density",
      "comfortable",
    );
  await expect.poll(async () => Boolean(await evidence(page))).toBe(true);
  return {
    requests,
    errors,
    unexpected,
    check: async () => {
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
      expect((await evidence(page)).forbidden).toEqual([]);
      storage.push(
        ...(await page.evaluate(
          () =>
            (window as unknown as { densityStorageWrites: string[] })
              .densityStorageWrites,
        )),
      );
      expect(storage.filter((key) => /density/i.test(key))).toEqual([]);
    },
  };
}
async function choose(page: Page, value: "Compact" | "Comfortable") {
  const trigger = page.getByRole("button", { name: "Forum menu", exact: true });
  await trigger.click();
  const group = page.getByRole("group", {
    name: "Display density",
    exact: true,
  });
  const choice = group.getByRole("menuitemradio", { name: value, exact: true });
  await choice.scrollIntoViewIfNeeded();
  const box = (await choice.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  await expect(group).toHaveAccessibleDescription(
    /Resets to Comfortable on reload/,
  );
  await choice.focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toBeFocused();
  await expect(page.locator(".forum-app-shell[data-density]")).toHaveAttribute(
    "data-density",
    value.toLowerCase(),
  );
}
async function spacing(locator: Locator) {
  return locator.evaluate((node) => {
    const s = getComputedStyle(node);
    return {
      padding: s.padding,
      gap: s.gap,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      text: node.textContent,
    };
  });
}
async function fixedContent(locator: Locator) {
  return locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const s = getComputedStyle(node);
      const b = node.getBoundingClientRect();
      return {
        tag: node.tagName,
        text: node.textContent,
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        height: Math.round(b.height * 1000) / 1000,
        paddingTop: s.paddingTop,
        paddingBottom: s.paddingBottom,
      };
    }),
  );
}
async function setFixtureDensity(
  page: Page,
  density: "compact" | "comfortable",
) {
  await page.evaluate(
    (detail) =>
      window.dispatchEvent(new CustomEvent("density-fixture:set", { detail })),
    density,
  );
}
async function operations(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as {
      densityEvidence: Evidence;
      __terminalFixtureCalls: string[];
    };
    return {
      queries: [...w.densityEvidence.backendReads],
      calls: [...w.__terminalFixtureCalls],
    };
  });
}
async function settled(locator: Locator) {
  await locator.evaluate(async (node) => {
    await Promise.all(
      node
        .getAnimations({ subtree: true })
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
}
for (const app of ["platform", "forum"])
  for (const width of [320, 390, 1280])
    for (const flow of ["feed", "community", "terminal"])
      test(`${app} ${flow} ${width}: only approved informational spacing changes`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width, height: 844 });
        const audit = await harness(page, app, flow);
        const shell = page.locator(".forum-app-shell");
        let subject: Locator;
        if (flow === "feed") subject = page.getByRole("article").first();
        else if (flow === "community")
          subject = page
            .getByRole("region", { name: "Project hubs", exact: true })
            .locator("section")
            .first();
        else {
          const tab = page.getByRole("tab", { name: "Markets", exact: true });
          if (await tab.isVisible()) await tab.click();
          else
            await page
              .getByRole("button", { name: "Markets", exact: true })
              .click();
          subject = page
            .getByRole("table", { name: "Sampled markets", exact: true })
            .locator("tbody tr")
            .first()
            .locator("td")
            .nth(1);
        }
        await expect(subject).toBeVisible();
        const original = await spacing(subject);
        await shell.evaluate((node) => node.removeAttribute("data-density"));
        expect(await spacing(subject)).toEqual(original);
        await shell.evaluate((node) =>
          node.setAttribute("data-density", "comfortable"),
        );
        const handle = await subject.elementHandle();
        const controlled =
          flow === "terminal"
            ? page
                .getByRole("table", { name: "Sampled markets", exact: true })
                .locator("tbody tr, tbody td, tbody button, tbody a")
            : shell
                .locator("button, input, select, textarea")
                .filter({ visible: true });
        const unchanged = await fixedContent(controlled);
        const before = await evidence(page);
        expect(before.mounts[`${flow}-controller`]).toBe(1);
        const admitted = await operations(page);
        const requests = [...audit.requests];
        const storageBefore = await page.evaluate(
          () =>
            (window as unknown as { densityStorageWrites: string[] })
              .densityStorageWrites,
        );
        const url = page.url();
        await choose(page, "Compact");
        expect(await handle!.evaluate((node) => node.isConnected)).toBe(true);
        const compact = await spacing(subject);
        expect(compact.fontSize).toBe(original.fontSize);
        expect(compact.lineHeight).toBe(original.lineHeight);
        expect(compact.text).toBe(original.text);
        expect(compact.padding).toBe(
          flow === "terminal"
            ? "2px 4px"
            : flow === "community"
              ? "12px"
              : "8px",
        );
        expect(await fixedContent(controlled)).toEqual(unchanged);
        const after = await evidence(page);
        expect(after.mounts).toEqual(before.mounts);
        expect(after.unmounts).toEqual({});
        expect(after.queries).toEqual(before.queries);
        expect(after.subscriptions).toBe(before.subscriptions);
        expect(after.mutations).toEqual(before.mutations);
        expect(await operations(page)).toEqual(admitted);
        expect(audit.requests).toEqual(requests);
        expect(
          await page.evaluate(
            () =>
              (window as unknown as { densityStorageWrites: string[] })
                .densityStorageWrites,
          ),
        ).toEqual(storageBefore);
        expect(page.url()).toBe(url);
        await info.attach("compact-layout", {
          body: await page.screenshot(),
          contentType: "image/png",
        });
        await choose(page, "Comfortable");
        expect(await spacing(subject)).toEqual(original);
        await audit.check();
      });

for (const app of ["platform", "forum"])
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
  ])
    test(`${app} Compact preserves the exact laptop quote and ${viewport.height >= 768 ? 24 : 80}px CTA budget at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const audit = await harness(page, app, "terminal");
      const order = page.getByRole("complementary", {
        name: "Trade selected token",
        exact: true,
      });
      const input = order.getByRole("textbox", {
        name: "You pay",
        exact: true,
      });
      await input.fill("1");
      const receive = order.getByRole("status", {
        name: "You receive",
        exact: true,
      });
      await expect(receive).toHaveText("123.456789");
      const primary = order.getByRole("button", {
        name: "Buy SYMF",
        exact: true,
      });
      await expect(primary).toBeEnabled();
      const amount = await input.elementHandle();
      const chart = page.getByRole("img", {
        name: /SYMF USD candlestick chart/,
      });
      await expect(page.locator("canvas").first()).toBeVisible();
      const canvas = await page.locator("canvas").first().elementHandle();
      const chartBounds = await chart.boundingBox();
      const original = await fixedContent(
        order.locator("input,select,button,[role=status]"),
      );
      const before = await operations(page);
      const mounts = (await evidence(page)).mounts;
      await choose(page, "Compact");
      await expect(input).toHaveValue("1");
      await expect(receive).toHaveText("123.456789");
      await expect(
        order.getByText("Minimum received", { exact: true }),
      ).toBeVisible();
      await expect(
        order.getByText(
          "0.5% integrator fee (Jupiter share included) · collected in SYMF",
          { exact: true },
        ),
      ).toBeVisible();
      expect(await amount!.evaluate((node) => node.isConnected)).toBe(true);
      expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
      expect(await chart.boundingBox()).toEqual(chartBounds);
      expect(
        await fixedContent(order.locator("input,select,button,[role=status]")),
      ).toEqual(original);
      expect((await evidence(page)).mounts).toEqual(mounts);
      expect(await operations(page)).toEqual(before);
      expect(await order.evaluate((node) => node.scrollTop)).toBe(0);
      const rail = (await order.boundingBox())!,
        cta = (await primary.boundingBox())!;
      const budget = viewport.height >= 768 ? 24 : 80;
      const needed = Math.max(0, cta.y + cta.height - rail.y - rail.height);
      expect(needed).toBeLessThanOrEqual(budget);
      await order.evaluate(
        (node, distance) =>
          node.scrollBy({ top: distance, behavior: "instant" }),
        needed,
      );
      expect(
        await order.evaluate((node) => node.scrollTop),
      ).toBeLessThanOrEqual(budget);
      expect(
        await primary.evaluate((node) => {
          const b = node.getBoundingClientRect();
          const hit = document.elementFromPoint(
            b.x + b.width / 2,
            b.y + b.height / 2,
          );
          return hit === node || (hit !== null && node.contains(hit));
        }),
      ).toBe(true);
      expect(
        before.calls.filter((name) => name === "action:forumSwaps:quote"),
      ).toHaveLength(1);
      expect(
        before.calls.filter((name) =>
          /execute|settle|send|pay|simulate/i.test(name),
        ),
      ).toEqual([]);
      await audit.check();
    });

for (const app of ["platform", "forum"])
  for (const width of [320, 1280])
    test(`${app} ${width}: spacing density preserves all three existing Feed display modes`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const audit = await harness(page, app);
      const article = page.getByRole("article").first();
      await expect(article).toBeVisible();
      for (const mode of ["timeline", "compact", "cards"] as const) {
        if (width >= 640) {
          await page
            .getByRole("button", {
              name:
                mode === "timeline"
                  ? "Timeline view"
                  : mode === "compact"
                    ? "Compact view"
                    : "Card view",
              exact: true,
            })
            .click();
        } else if (mode !== "timeline") {
          await page
            .getByRole("button", {
              name:
                mode === "compact"
                  ? "Switch to compact view"
                  : "Switch to card view",
              exact: true,
            })
            .click();
        }
        const original = await spacing(article);
        const stored = await page.evaluate(() =>
          localStorage.getItem("symbaiex.forum.feed-display"),
        );
        const handle = await article.elementHandle();
        await choose(page, "Compact");
        const compact = await spacing(article);
        expect(parseFloat(compact.padding)).toBeLessThanOrEqual(
          parseFloat(original.padding),
        );
        expect(compact.padding).toBe("8px");
        expect(compact.fontSize).toBe(original.fontSize);
        expect(compact.text).toBe(original.text);
        expect(await handle!.evaluate((node) => node.isConnected)).toBe(true);
        expect(
          await page.evaluate(() =>
            localStorage.getItem("symbaiex.forum.feed-display"),
          ),
        ).toBe(stored);
        await choose(page, "Comfortable");
        expect(await spacing(article)).toEqual(original);
      }
      expect((await evidence(page)).queries).toEqual(["forum:listFeedThreads"]);
      await audit.check();
    });

for (const app of ["platform", "forum"])
  for (const forcedColors of ["none", "active"] as const)
    test(`${app} 320px keyboard density choices retain 44px targets in ${forcedColors} forced colors and reduced motion`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await page.emulateMedia({ forcedColors, reducedMotion: "reduce" });
      const audit = await harness(page, app);
      await expect(page.getByRole("article").first()).toBeVisible();
      await page
        .getByRole("button", { name: "Forum menu", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      const comfortable = page.getByRole("menuitemradio", {
        name: "Comfortable",
        exact: true,
      });
      await expect(comfortable).toHaveAttribute("aria-checked", "true");
      await comfortable.focus();
      await page.keyboard.press("ArrowDown");
      const compact = page.getByRole("menuitemradio", {
        name: "Compact",
        exact: true,
      });
      await expect(compact).toBeFocused();
      const b = (await compact.boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(320);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height).toBeLessThanOrEqual(568);
      // The established Radix menu exposes focus with its highlighted row.
      await expect(compact).toHaveAttribute("data-highlighted", "");
      if (forcedColors === "active") {
        expect(
          await compact.evaluate((node) => getComputedStyle(node).outlineStyle),
        ).not.toBe("none");
      }
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("button", { name: "Forum menu", exact: true }),
      ).toBeFocused();
      await expect(page.locator(".forum-app-shell")).toHaveAttribute(
        "data-density",
        "compact",
      );
      await page
        .getByRole("button", { name: "Forum menu", exact: true })
        .click();
      await expect(
        page.getByRole("menuitemradio", { name: "Compact", exact: true }),
      ).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("Escape");
      await audit.check();
    });

for (const surface of ["blog", "news", "newsletter"])
  test(`${surface} never receives forum density styling`, async ({ page }) => {
    const audit = await harness(page, "platform", "feed", `surface=${surface}`);
    const shell = page.locator(".forum-app-shell");
    const original = await fixedContent(shell.locator("main,footer,footer a"));
    await setFixtureDensity(page, "compact");
    await expect(shell).not.toHaveAttribute("data-density");
    expect(await fixedContent(shell.locator("main,footer,footer a"))).toEqual(
      original,
    );
    await audit.check();
  });

test("the existing Community compact embed remains distinct from display density", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const audit = await harness(page, "forum", "community", "embed");
  const panel = page
    .getByRole("region", { name: "Project hubs", exact: true })
    .locator("section")
    .first();
  await expect(panel).toBeVisible();
  const original = await spacing(panel);
  const content = await fixedContent(panel.locator("*"));
  await choose(page, "Compact");
  expect(await spacing(panel)).toEqual(original);
  expect(await fixedContent(panel.locator("*"))).toEqual(content);
  await audit.check();
});

test("native Terminal handoff remains read-only while the shared menu changes density", async ({
  page,
}) => {
  const audit = await harness(page, "forum", "terminal", "native");
  await expect(
    page.getByRole("link", { name: "Open the trading terminal" }),
  ).toBeVisible();
  await choose(page, "Compact");
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(
    page.getByRole("table", { name: "Sampled markets" }),
  ).toHaveCount(0);
  expect(audit.requests).toEqual([]);
  expect((await operations(page)).queries).toEqual([
    "forum:getMyForumNavState:{}",
    "forum:overview:{}",
  ]);
  expect((await operations(page)).calls).toEqual([]);
  await audit.check();
});

test("session-only density resets on reload without a cookie, URL, storage or backend preference", async ({
  page,
}) => {
  const audit = await harness(page);
  const cookies = await page.context().cookies();
  const url = page.url();
  await expect(page.getByRole("article").first()).toBeVisible();
  await choose(page, "Compact");
  expect(await page.context().cookies()).toEqual(cookies);
  expect(page.url()).toBe(url);
  await page.reload();
  await expect(
    page.locator(".forum-app-shell[data-density=comfortable]"),
  ).toBeVisible();
  await audit.check();
});

test("an open Community draft and a protected receipt retain their owners and controls across density changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const audit = await harness(page, "forum", "community");
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Introduce your project",
    exact: true,
  });
  const draft = dialog.getByLabel("What are you building?");
  await draft.fill("Unsaved local-only project draft");
  await settled(dialog);
  const handle = await draft.elementHandle();
  const before = await fixedContent(dialog.locator("input,textarea,button"));
  // A modal correctly hides the navigation. Deliberately use the existing
  // context setter through a fixture event rather than bypassing the focus trap.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("density-fixture:set", { detail: "compact" }),
    ),
  );
  await expect(
    page.locator(".forum-app-shell[data-density=compact]"),
  ).toBeVisible();
  await expect(draft).toHaveValue("Unsaved local-only project draft");
  expect(await handle!.evaluate((node) => node.isConnected)).toBe(true);
  expect(await fixedContent(dialog.locator("input,textarea,button"))).toEqual(
    before,
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Your receipts", exact: true })
    .click();
  const receipt = page.getByRole("button", {
    name: "Check protected receipt",
    exact: true,
  });
  await receipt.click();
  const protectedDialog = page.getByRole("dialog", {
    name: "Review reward payment",
    exact: true,
  });
  await expect(
    protectedDialog.getByText("Protected uncertain outcome", { exact: true }),
  ).toBeVisible();
  await settled(protectedDialog);
  const protectedBefore = await fixedContent(
    protectedDialog.locator("input,button"),
  );
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("density-fixture:set", { detail: "comfortable" }),
    ),
  );
  expect(await fixedContent(protectedDialog.locator("input,button"))).toEqual(
    protectedBefore,
  );
  await expect(
    protectedDialog.getByRole("button", {
      name: "Open exact payment in wallet",
    }),
  ).toHaveCount(0);
  await audit.check();
});
