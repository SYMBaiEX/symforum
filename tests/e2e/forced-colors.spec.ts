import { test, expect, type Page, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
import {
  CHECKED,
  MINT,
  candles,
  hourlyCandles,
} from "./fixtures/forced-colors-state";

const origin = "http://127.0.0.1:43271";
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
          `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("apps/${app}/app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
        ],
        { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
      );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/forced-colors.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env.NODE_ENV":JSON.stringify("production")}});if(!result.success)throw Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 6 * 1024 * 1024 },
  );
});

async function harness(page: Page, app: string) {
  const errors: string[] = [],
    unexpected: string[] = [],
    requests: string[] = [];
  const pending: Array<() => Promise<void>> = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(CHECKED + 1000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (text: string) => {
          (window as unknown as { copied: string }).copied = text;
          return Promise.resolve();
        },
      },
    });
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      if (url.pathname === "/")
        return route.fulfill({
          contentType: "text/html",
          body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
        });
      if (url.pathname === "/fixture.js")
        return route.fulfill({ contentType: "text/javascript", body: script });
      if (url.pathname === `/api/token/${MINT}/chart`) {
        requests.push(url.href);
        const respond = () =>
          route.fulfill({
            json: {
              mint: MINT,
              pool: "11111111111111111111111111111111",
              interval: url.searchParams.get("interval"),
              checkedAt: CHECKED,
              candleSource: "solana-tracker",
              candles:
                url.searchParams.get("interval") === "1h"
                  ? hourlyCandles
                  : candles,
            },
          });
        if (url.searchParams.get("interval") === "1h") {
          pending.push(respond);
          return;
        }
        return respond();
      }
    }
    unexpected.push(url.href);
    return route.abort();
  });
  await page.goto(origin);
  await expect(page.locator("canvas").first()).toBeVisible();
  return {
    requests,
    pending,
    check: () => {
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
    },
  };
}

async function directBounds(control: Locator, width: number) {
  await control.scrollIntoViewIfNeeded();
  const b = (await control.boundingBox())!;
  expect
    .soft(b.width, `${await control.textContent()} width`)
    .toBeGreaterThanOrEqual(44);
  expect
    .soft(b.height, `${await control.textContent()} height`)
    .toBeGreaterThanOrEqual(44);
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(width);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.y + b.height).toBeLessThanOrEqual(844);
  expect(
    await control.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
      return hit === node || (hit !== null && node.contains(hit));
    }),
    "Control center must be unobscured",
  ).toBe(true);
}

async function visibleFocus(control: Locator) {
  await expect(control).toBeFocused();
  const focus = await control.evaluate((node) => {
    const s = getComputedStyle(node);
    return {
      style: s.outlineStyle,
      width: parseFloat(s.outlineWidth),
      color: s.outlineColor,
      background: s.backgroundColor,
    };
  });
  expect(focus.style).not.toBe("none");
  expect(focus.width).toBeGreaterThanOrEqual(1);
  expect(focus.color).not.toBe(focus.background);
}

for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} forced colors: real canvas and equivalent readings remain reachable at ${width}px`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ forcedColors: "active" });
      const audit = await harness(page, app);
      expect(
        await page.evaluate(
          () => matchMedia("(forced-colors: active)").matches,
        ),
      ).toBe(true);
      const intervals = page.getByRole("group", {
        name: "Candle interval",
        exact: true,
      });
      for (const button of await intervals.getByRole("button").all())
        await directBounds(button, width);
      const active = intervals.getByRole("button", {
        name: "15m",
        exact: true,
      });
      const inactive = intervals.getByRole("button", {
        name: "5m",
        exact: true,
      });
      const appearance = async (control: Locator) =>
        control.evaluate((node) => {
          const s = getComputedStyle(node);
          return {
            background: s.backgroundColor,
            color: s.color,
            border: s.border,
            outline: s.outline,
            decoration: s.textDecorationLine,
            weight: s.fontWeight,
          };
        });
      const baseline = {
        active: await appearance(active),
        inactive: await appearance(inactive),
      };
      await info.attach("forced-colors-control-appearance", {
        body: JSON.stringify(baseline, null, 2),
        contentType: "application/json",
      });
      expect
        .soft(
          {
            border: baseline.active.border,
            outline: baseline.active.outline,
            decoration: baseline.active.decoration,
            weight: baseline.active.weight,
          },
          "Selected interval must have a non-color distinction in forced colors",
        )
        .not.toEqual({
          border: baseline.inactive.border,
          outline: baseline.inactive.outline,
          decoration: baseline.inactive.decoration,
          weight: baseline.inactive.weight,
        });
      const disclosure = page.getByText("Read candle data", { exact: true });
      await directBounds(disclosure, width);
      await inactive.focus();
      await page.keyboard.press("Tab");
      await visibleFocus(active);
      await disclosure.focus();
      await expect(
        page.getByRole("region", { name: "Recent candle data", exact: true }),
      ).toHaveCount(0);
      await page.keyboard.press("Enter");
      await visibleFocus(disclosure);
      const reader = page.getByRole("region", {
        name: "Recent candle data",
        exact: true,
      });
      await expect(reader).toContainText("Source Solana Tracker");
      await expect(reader).toContainText("Checked 2026-10-31 12:00:00 UTC");
      await expect(reader).toContainText("Prices USD; volume unit unknown.");
      await expect(reader.locator("tbody tr")).toHaveCount(2);
      await expect(reader.getByRole("columnheader")).toHaveText([
        "UTC",
        "Open",
        "High",
        "Low",
        "Close",
        "Source volume",
      ]);
      await expect(reader.locator("tbody tr").first().locator("td")).toHaveText(
        ["2026-10-31 11:15:00 UTC", "$2", "$4", "$1", "$3", "0"],
      );
      for (const control of [
        reader.getByRole("button", { name: "Copy displayed readings" }),
        reader.getByRole("combobox", { name: "Displayed candle readings" }),
        reader.getByRole("button", { name: "Previous reading" }),
        reader.getByRole("button", { name: "Next reading" }),
      ])
        await directBounds(control, width);
      await reader
        .getByRole("button", { name: "Copy displayed readings" })
        .click();
      expect(
        await page.evaluate(
          () => (window as unknown as { copied: string }).copied,
        ),
      ).toContain("Source volume unit unknown");
      const select = reader.getByRole("combobox", {
        name: "Displayed candle readings",
      });
      await select.focus();
      await visibleFocus(select);
      await page.keyboard.press("Tab");
      const next = reader.getByRole("button", { name: "Next reading" });
      await visibleFocus(next);
      await page.keyboard.press("Enter");
      await expect(reader).toContainText("Reading 1 of 2.");
      await expect(reader).toContainText("Source volume 0 (unit unknown).");
      await page.keyboard.press("Tab");
      const scroller = page.getByRole("region", {
        name: "Scrollable candle readings",
        exact: true,
      });
      await visibleFocus(scroller);
      expect(
        await reader.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => scroller.evaluate((node) => node.scrollLeft))
        .toBeGreaterThan(0);
      await page.keyboard.press("Tab");
      await visibleFocus(page.getByRole("button", { name: "After readings" }));
      await info.attach("forced-colors-readings", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      expect(audit.requests).toHaveLength(1);
      audit.check();
    });

test("forced-color mode switches retain the renderer, while deferred interval replacement shows only its loaded data", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const audit = await harness(page, "platform");
  const canvas = await page.locator("canvas").first().elementHandle();
  const frame = page.getByRole("img", { name: /LOCAL USD candlestick chart/ });
  const bounds = await frame.boundingBox();
  for (const forcedColors of ["active", "none", "active"] as const) {
    await page.emulateMedia({ forcedColors });
    expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
    expect(await frame.boundingBox()).toEqual(bounds);
  }
  await page.getByText("Read candle data", { exact: true }).click();
  await page.getByRole("button", { name: "1h", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Recent candle data", exact: true }),
  ).toHaveCount(0);
  await expect.poll(() => audit.pending.length).toBe(1);
  await audit.pending[0]();
  await page.getByText("Read candle data", { exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Recent candle data", exact: true })
      .locator("tbody tr"),
  ).toHaveCount(1);
  await expect(
    page
      .getByRole("region", { name: "Recent candle data", exact: true })
      .locator("tbody tr")
      .first()
      .locator("td"),
  ).toHaveText(["2026-10-31 11:00:00 UTC", "$10", "$12", "$9", "$11", "0"]);
  expect(audit.requests).toHaveLength(2);
  audit.check();
});
