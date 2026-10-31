import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
import { CHECKED, localCandles } from "./fixtures/candle-navigation-state";
const origin = "http://127.0.0.1:43241";
let script: string;
const css: Record<string, string> = {};
test.beforeAll(() => {
  for (const app of ["platform", "forum"])
    css[app] =
      FORUM_SHARED_THEME_CSS +
      readFileSync("styles/forum-shared.css", "utf8") +
      execFileSync(
        "bun",
        [
          "-e",
          `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("apps/${app}/app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
        ],
        { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
      );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const r=await Bun.build({entrypoints:["tests/e2e/fixtures/candle-navigation.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env.NODE_ENV":JSON.stringify("production")}});if(!r.success)throw Error(r.logs.join("\\n"));for(const f of r.outputs){if(f.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await f.text())+"}));");else process.stdout.write(await f.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  leaf = false,
  app = "platform",
  defer = false,
) {
  const errors: string[] = [],
    unexpected: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install({ time: CHECKED + 1000 });
  await page.addInitScript((defer) => {
    const w = window as unknown as { copied: string[]; finish?: () => void };
    w.copied = [];
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (text: string) => {
          w.copied.push(text);
          return defer
            ? new Promise<void>((resolve) => {
                w.finish = resolve;
              })
            : Promise.resolve();
        },
      },
    });
  }, defer);
  await page.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.origin === origin) {
      if (u.pathname === "/")
        return r.fulfill({
          contentType: "text/html",
          body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
        });
      if (u.pathname === "/fixture.js")
        return r.fulfill({ contentType: "text/javascript", body: script });
      const mint = u.pathname.match(/^\/api\/token\/([^/]+)\/chart$/)?.[1];
      if (mint) {
        requests.push(u.href);
        return r.fulfill({
          json: {
            mint,
            pool: "11111111111111111111111111111111",
            interval: u.searchParams.get("interval"),
            checkedAt: CHECKED,
            candleSource: "solana-tracker",
            candles: localCandles(),
          },
        });
      }
    }
    unexpected.push(u.href);
    return r.abort();
  });
  await page.goto(origin + (leaf ? "/?leaf" : "/"));
  if (!leaf) await page.getByText("Read candle data", { exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Recent candle data", exact: true }),
  ).toBeVisible();
  return {
    requests,
    check: () => {
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
    },
  };
}
const reader = (p: Page) =>
    p.getByRole("region", { name: "Recent candle data", exact: true }),
  windowSize = (p: Page) =>
    p.getByRole("combobox", { name: "Displayed candle readings", exact: true });
const replace = (p: Page, kind: string) =>
  p.evaluate(
    (kind) =>
      window.dispatchEvent(new CustomEvent("candle:replace", { detail: kind })),
    kind,
  );
async function announcement(p: Page) {
  const id = await p
    .getByRole("button", { name: "Next reading", exact: true })
    .getAttribute("aria-controls");
  return p.locator(`[id="${id}"]`);
}
test("20/50/all slice only loaded sparse bars and copy exactly the displayed rows without chart reset", async ({
  page,
}) => {
  const audit = await harness(page);
  const canvas = await page.locator("canvas").first().elementHandle();
  const bounds = await page.locator("canvas").first().boundingBox();
  for (const [count, value] of [
    [20, "20"],
    [50, "50"],
    [120, "all"],
  ] as const) {
    await windowSize(page).selectOption(value);
    await expect(reader(page).locator("tbody tr")).toHaveCount(count);
    await page
      .getByRole("button", { name: "Copy displayed readings", exact: true })
      .click();
    const text = await page.evaluate(() =>
      (window as unknown as { copied: string[] }).copied.at(-1)!,
    );
    const rows = await reader(page)
      .locator("tbody tr")
      .evaluateAll((rows) =>
        rows.map((r) =>
          Array.from(r.querySelectorAll("td"), (c) =>
            c.textContent!.trim(),
          ).join("\t"),
        ),
      );
    expect(text.split("\n").slice(6)).toEqual(rows);
    expect(text).toContain("Source volume unit unknown");
    expect(text).toContain("Checked: 2026-10-31 12:00:00 UTC");
  }
  expect(audit.requests).toHaveLength(1);
  expect(await canvas?.evaluate((n) => n.isConnected)).toBe(true);
  expect(await page.locator("canvas").first().boundingBox()).toEqual(bounds);
  audit.check();
});
test("deliberate reading navigation announces actual UTC OHLC and zero volume without autonomous chatter", async ({
  page,
}) => {
  const audit = await harness(page);
  const note = await announcement(page);
  await expect(note).toHaveText("");
  await expect(
    page.getByRole("button", { name: "Previous reading", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Next reading", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(note).toContainText("Reading 1 of 20.");
  await expect(
    page.getByRole("button", { name: "Next reading", exact: true }),
  ).toHaveAccessibleDescription(
    /Newest loaded bar first.*older bars.*newer bars/,
  );
  await expect(note).toContainText("Source volume 0 (unit unknown).");
  await expect(note).toContainText("Open $120");
  await page.getByRole("button", { name: "Next reading", exact: true }).click();
  await expect(note).toContainText("Reading 2 of 20.");
  await page
    .getByRole("button", { name: "Previous reading", exact: true })
    .click();
  await expect(note).toContainText("Reading 1 of 20.");
  for (let index = 1; index < 20; index++)
    await page
      .getByRole("button", { name: "Next reading", exact: true })
      .click();
  await expect(note).toContainText("Reading 20 of 20.");
  await expect(
    page.getByRole("button", { name: "Next reading", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Previous reading", exact: true })
    .click();
  await expect(note).toContainText("Reading 19 of 20.");
  await page.clock.fastForward(1000);
  await expect(note).toContainText("Reading 19 of 20.");
  expect(audit.requests).toHaveLength(1);
  audit.check();
});
for (const kind of ["mint", "interval", "history", "short"])
  test(`history/context replacement resets reading truthfully (${kind})`, async ({
    page,
  }) => {
    const audit = await harness(page, true);
    await windowSize(page).selectOption("50");
    await page
      .getByRole("button", { name: "Next reading", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Next reading", exact: true })
      .click();
    await replace(page, kind);
    await expect(await announcement(page)).toHaveText("");
    await expect(windowSize(page)).toHaveValue(
      kind === "mint" || kind === "interval" ? "20" : "50",
    );
    await page
      .getByRole("button", { name: "Next reading", exact: true })
      .click();
    await expect(await announcement(page)).toContainText(
      kind === "short"
        ? "Reading 1 of 3."
        : kind === "history"
          ? "Reading 1 of 50."
          : "Reading 1 of 20.",
    );
    if (kind === "history")
      await expect(await announcement(page)).toContainText(
        "2021-01-04 05:45:00 UTC",
      );
    expect(audit.requests).toHaveLength(0);
    audit.check();
  });
test("single/empty/missing volume never creates another bar or fake value", async ({
  page,
}) => {
  const audit = await harness(page, true);
  await replace(page, "single");
  await expect(reader(page).locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Next reading", exact: true }).click();
  await expect(await announcement(page)).toContainText(
    "Source volume 0 (unit unknown).",
  );
  await expect(
    page.getByRole("button", { name: "Next reading", exact: true }),
  ).toBeDisabled();
  await replace(page, "missing");
  await page.getByRole("button", { name: "Next reading", exact: true }).click();
  await expect(await announcement(page)).toContainText(
    "Source volume Unavailable (unit unknown).",
  );
  await replace(page, "empty");
  await expect(reader(page)).toContainText("Loaded 0 bars");
  await expect(
    page.getByRole("button", { name: "Next reading", exact: true }),
  ).toBeDisabled();
  await expect(await announcement(page)).toHaveText("");
  audit.check();
});
test("deferred copy cannot report a different displayed slice", async ({
  page,
}) => {
  const audit = await harness(page, false, "platform", true);
  await page
    .getByRole("button", { name: "Copy displayed readings", exact: true })
    .click();
  await windowSize(page).selectOption("50");
  await page.evaluate(() =>
    (window as unknown as { finish?: () => void }).finish?.(),
  );
  await expect(reader(page).getByRole("status")).toHaveText("");
  const text = await page.evaluate(
    () => (window as unknown as { copied: string[] }).copied[0],
  );
  expect(text.split("\n").slice(6)).toHaveLength(20);
  await expect(reader(page).locator("tbody tr")).toHaveCount(50);
  audit.check();
});
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} reading controls fit ${width}px and leave keyboard scrolling reachable`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const audit = await harness(page, false, app);
      await expect(windowSize(page)).toHaveCSS("font-size", "16px");
      for (const control of [
        windowSize(page),
        page.getByRole("button", { name: "Previous reading", exact: true }),
        page.getByRole("button", { name: "Next reading", exact: true }),
      ]) {
        await control.scrollIntoViewIfNeeded();
        const b = await control.boundingBox();
        expect(b!.height).toBeGreaterThanOrEqual(44);
        expect(b!.x).toBeGreaterThanOrEqual(0);
        expect(b!.x + b!.width).toBeLessThanOrEqual(width);
        expect(b!.y).toBeGreaterThanOrEqual(0);
        expect(b!.y + b!.height).toBeLessThanOrEqual(844);
        const component = await reader(page).boundingBox();
        expect(b!.x).toBeGreaterThanOrEqual(component!.x);
        expect(b!.x + b!.width).toBeLessThanOrEqual(
          component!.x + component!.width,
        );
      }
      const box = await reader(page).boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(
        await reader(page).evaluate(
          (node) => node.scrollWidth <= node.clientWidth,
        ),
      ).toBe(true);
      await windowSize(page).focus();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "Next reading", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("region", {
          name: "Scrollable candle readings",
          exact: true,
        }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "After readings", exact: true }),
      ).toBeFocused();
      expect(audit.requests).toHaveLength(1);
      audit.check();
    });
