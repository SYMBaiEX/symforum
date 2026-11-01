import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43255",
  mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  mintB = "So11111111111111111111111111111111111111112";
declare global {
  interface Window {
    __marketExport: {
      queries: Record<string, unknown>[];
      actions: string[];
      forbidden: string[];
      replace(): void;
      empty(): void;
      unknown(): void;
      ready(): void;
      unmount(): void;
    };
    __marketDownload: {
      created: string[];
      revoked: string[];
      texts(): Promise<string[]>;
    };
  }
}
let script: string;
const css = {} as Record<"platform" | "forum", string>;
const audits = new WeakMap<Page, { errors: string[]; outbound: string[] }>();
test.beforeAll(() => {
  for (const app of ["platform", "forum"] as const)
    css[app] =
      FORUM_SHARED_THEME_CSS +
      readFileSync("styles/forum-shared.css", "utf8") +
      execFileSync(
        "bun",
        [
          "-e",
          `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./${app === "forum" ? "apps/forum/tailwind.config.ts" : "tailwind.config.ts"}";config.content=["./components/**/*.{ts,tsx}","./packages/forum-ui/src/**/*.{ts,tsx}"];const css=(await Bun.file("apps/${app}/app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
        ],
        { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
      );
  const baseline =
    process.env.MARKET_EXPORT_CONTEXT_BASELINE === "1"
      ? execFileSync(
          "git",
          ["show", "495672e8:components/trading/market-explorer.tsx"],
          { encoding: "utf8" },
        )
      : process.env.MARKET_EXPORT_BASELINE === "1"
        ? execFileSync(
            "git",
            ["show", "8ba7ac40:components/trading/market-explorer.tsx"],
            { encoding: "utf8" },
          )
        : null;
  const serializerBaseline =
    process.env.MARKET_EXPORT_CONTEXT_BASELINE === "1"
      ? execFileSync(
          "git",
          ["show", "495672e8:components/trading/market-export.ts"],
          { encoding: "utf8" },
        )
      : null;
  script = execFileSync(
    "bun",
    [
      "-e",
      `const baseline=${JSON.stringify(baseline)};const serializerBaseline=${JSON.stringify(serializerBaseline)};const r=await Bun.build({entrypoints:["tests/e2e/fixtures/market-export.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"public-loaded-sample",setup(build){if(baseline!==null)build.onLoad({filter:/market-explorer\\.tsx$/},()=>({contents:baseline,loader:"tsx"}));if(serializerBaseline!==null)build.onLoad({filter:/market-export\\.ts$/},()=>({contents:serializerBaseline,loader:"ts"}));build.onResolve({filter:/^convex\\/react$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/market-export-state.tsx"}));}}]});if(!r.success)throw Error(r.logs.join("\\n"));for(const f of r.outputs){if(f.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await f.text())+"}));");else if(f.path.endsWith(".js"))process.stdout.write(await f.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 6 * 1024 * 1024 },
  );
});
const control = (p: Page) =>
  p.getByRole("button", {
    name: "Export CSV of displayed market rows",
    exact: true,
  });
async function harness(
  page: Page,
  query = "",
  app: "platform" | "forum" = "platform",
) {
  const audit = { errors: [] as string[], outbound: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (e) => audit.errors.push(e.message));
  await page.addInitScript(() => {
    const blobs: Blob[] = [],
      created: string[] = [],
      revoked: string[] = [];
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      if (!(blob instanceof Blob)) throw Error("Unexpected media source");
      const url = create(blob);
      blobs.push(blob);
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      revoked.push(url);
      revoke(url);
    };
    Object.assign(window, {
      __marketDownload: {
        created,
        revoked,
        texts: () => Promise.all(blobs.map((b) => b.text())),
      },
    });
  });
  await page.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.origin === origin && u.pathname === "/")
      return r.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div class="forum-surface"><div id="root"></div></div><script src="/fixture.js"></script>`,
      });
    if (u.origin === origin && u.pathname === "/fixture.js")
      return r.fulfill({ contentType: "text/javascript", body: script });
    if (
      u.origin === origin &&
      u.pathname === "/images/brand/symforum-icon-64.png"
    )
      return r.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>',
      });
    audit.outbound.push(u.href);
    return r.abort();
  });
  await page.goto(`${origin}/?${query}`);
  await expect(control(page)).toBeVisible();
}
test.afterEach(async ({ page }) => {
  expect(audits.get(page)).toEqual({ errors: [], outbound: [] });
  expect(await page.evaluate(() => window.__marketExport.forbidden)).toEqual(
    [],
  );
});
function parse(csv: string) {
  const result: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || (c === "\r" && csv[i + 1] === "\n")) && !quoted) {
      row.push(cell);
      result.push(row);
      row = [];
      cell = "";
      if (c === "\r") i++;
    } else cell += c;
  }
  return result;
}
async function download(page: Page) {
  const next = page.waitForEvent("download");
  await control(page).click();
  expect((await next).suggestedFilename()).toBe(
    "symforum-displayed-market-sample.csv",
  );
  const texts = await page.evaluate(() => window.__marketDownload.texts());
  return parse(texts.at(-1)!);
}
function selectedContext(rows: string[][]) {
  const headers = [
    "selected_market_cap_band",
    "selected_platform",
    "selected_fresh_only",
    "selected_sort_key",
    "selected_sort_direction",
    "search_applied",
  ];
  for (const header of headers) expect(rows[0]).toContain(header);
  return rows
    .slice(1)
    .map((row) => headers.map((header) => row[rows[0].indexOf(header)]));
}
test("explicit download contains the current displayed order and original public evidence only", async ({
  page,
}) => {
  await harness(page);
  await expect
    .poll(() => page.evaluate(() => window.__marketExport.actions.length))
    .toBe(1);
  expect(await page.evaluate(() => window.__marketDownload.created)).toEqual(
    [],
  );
  const before = await page.evaluate(() => ({
    queries: window.__marketExport.queries.length,
    actions: window.__marketExport.actions.length,
  }));
  const rows = await download(page);
  const h = rows[0];
  expect(rows.slice(1).map((r) => r[h.indexOf("mint")])).toEqual([
    mintB,
    mintA,
  ]);
  expect(rows[1][h.indexOf("price_usd")]).toBe("0.0000000000000000000000001");
  expect(rows[1][h.indexOf("liquidity_usd")]).toBe("0");
  expect(rows[1][h.indexOf("volume_24h_usd")]).toBe("null");
  expect(rows[1][h.indexOf("market_checked_at_utc")]).not.toBe(
    rows[1][h.indexOf("holders_observed_at_utc")],
  );
  expect(rows[1][h.indexOf("market_canonical_public_source_path")]).toBe(
    "https://dexscreener.com/solana/pool",
  );
  expect(rows.flat().join(" ")).not.toMatch(
    /DO_NOT_EXPORT|not-public|secret|fragment/,
  );
  expect(selectedContext(rows)).toEqual([
    ["all", "all", "false", "volume1h", "desc", "false"],
    ["all", "all", "false", "volume1h", "desc", "false"],
  ]);
  expect(
    await page.evaluate(() => ({
      queries: window.__marketExport.queries.length,
      actions: window.__marketExport.actions.length,
    })),
  ).toEqual(before);
  await download(page);
  expect(
    await page.evaluate(() => window.__marketDownload.revoked.length),
  ).toBe(1);
  await page.evaluate(() => window.__marketExport.unmount());
  await expect
    .poll(() => page.evaluate(() => window.__marketDownload.revoked.length))
    .toBe(2);
  expect(await page.locator("a[download]").count()).toBe(0);
});
test("local search/sort/freshness changes export only matching visible rows without extra reads", async ({
  page,
}) => {
  await harness(page);
  await page.getByLabel("Sort sampled tokens").selectOption("volume1h:asc");
  let rows = await download(page);
  expect(rows.slice(1).map((r) => r[3])).toEqual([mintA, mintB]);
  expect(selectedContext(rows)).toEqual([
    ["all", "all", "false", "volume1h", "asc", "false"],
    ["all", "all", "false", "volume1h", "asc", "false"],
  ]);
  await page.getByLabel("Search sampled tokens").fill("AAA");
  rows = await download(page);
  expect(rows).toHaveLength(2);
  expect(rows[1][3]).toBe(mintA);
  expect(selectedContext(rows)).toEqual([
    ["all", "all", "false", "volume1h", "asc", "true"],
  ]);
  await page
    .getByRole("button", { name: "Fresh market rows only", exact: true })
    .click();
  rows = await download(page);
  expect(rows).toHaveLength(2);
  expect(selectedContext(rows)).toEqual([
    ["all", "all", "true", "volume1h", "asc", "true"],
  ]);
  expect(await page.evaluate(() => window.__marketExport.queries)).toHaveLength(
    1,
  );
});
test("selected filter provenance follows current public controls, not cached response band or raw search text", async ({
  page,
}) => {
  await harness(page);
  await page
    .getByRole("combobox", { name: "Market cap", exact: true })
    .selectOption("50k100k");
  await page
    .getByRole("combobox", { name: "Platform", exact: true })
    .selectOption("pumpfun");
  await page.getByLabel("Sort sampled tokens").selectOption("price:asc");
  await page.getByLabel("Search sampled tokens").fill("  aAa  ");
  await page
    .getByRole("button", { name: "Fresh market rows only", exact: true })
    .click();
  const before = await page.evaluate(() => ({
    queries: window.__marketExport.queries.length,
    actions: window.__marketExport.actions.length,
  }));
  const rows = await download(page);
  expect(rows).toHaveLength(2);
  expect(rows[1][3]).toBe(mintA);
  expect(selectedContext(rows)).toEqual([
    ["50k100k", "pumpfun", "true", "price", "asc", "true"],
  ]);
  expect(rows.flat().join(" ")).not.toContain("aAa");
  await expect(page.getByLabel("Search sampled tokens")).toHaveValue("  aAa  ");
  expect(
    await page.evaluate(() => ({
      queries: window.__marketExport.queries.length,
      actions: window.__marketExport.actions.length,
    })),
  ).toEqual(before);
  await expect(
    page.getByText(/search text is excluded for privacy/),
  ).toBeVisible();
});
test("changing only public sort context invalidates old manual feedback even when displayed row data is identical", async ({
  page,
}) => {
  await harness(page, "native");
  await page.getByLabel("Search sampled tokens").fill("AAA");
  await control(page).click();
  const text = page.getByRole("textbox", { name: "Displayed market rows CSV" });
  await expect(text).toBeVisible();
  await page.getByLabel("Sort sampled tokens").selectOption("price:asc");
  await expect(text).toHaveCount(0);
  await control(page).click();
  expect(selectedContext(parse(await text.inputValue()))).toEqual([
    ["all", "all", "false", "price", "asc", "true"],
  ]);
  expect(await page.evaluate(() => window.__marketExport.queries)).toHaveLength(
    1,
  );
  expect(await page.evaluate(() => window.__marketDownload.created)).toEqual(
    [],
  );
});
test("reactive replacement hides old feedback and exports the new loaded snapshot", async ({
  page,
}) => {
  await harness(page);
  await download(page);
  await expect(page.getByText(/CSV download requested/)).toBeVisible();
  await page.evaluate(() => window.__marketExport.replace());
  await expect(page.getByText(/CSV download requested/)).toHaveCount(0);
  const rows = await download(page);
  expect(rows).toHaveLength(2);
  expect(rows[1][4]).toBe("NEW");
  expect(rows[1][7]).toBe("9");
});
test("latest unavailable fields export null without resurrecting the previous successful sample", async ({
  page,
}) => {
  await harness(page);
  await download(page);
  await page.evaluate(() => window.__marketExport.unknown());
  const rows = await download(page),
    h = rows[0];
  expect(rows[1][h.indexOf("price_usd")]).toBe("null");
  expect(rows[1][h.indexOf("market_checked_at_utc")]).toBe("null");
  expect(rows[1][h.indexOf("market_source_state")]).toBe("unavailable");
  expect(rows[1][h.indexOf("holders")]).toBe("0");
});
for (const mode of ["loading", "empty"])
  test(`${mode} cannot create a download`, async ({ page }) => {
    await harness(page, `mode=${mode}`);
    await expect(control(page)).toBeDisabled();
    expect(await page.evaluate(() => window.__marketDownload.created)).toEqual(
      [],
    );
  });
test("native host exposes manual CSV text without Blob URLs, transport or automatic selection", async ({
  page,
}) => {
  await harness(page, "native");
  await control(page).click();
  await expect(
    page.getByRole("textbox", { name: "Displayed market rows CSV" }),
  ).toHaveValue(/displayed_loaded_sample_only/);
  expect(
    selectedContext(
      parse(
        await page
          .getByRole("textbox", { name: "Displayed market rows CSV" })
          .inputValue(),
      ),
    ),
  ).toEqual([
    ["all", "all", "false", "volume1h", "desc", "false"],
    ["all", "all", "false", "volume1h", "desc", "false"],
  ]);
  expect(await page.evaluate(() => window.__marketDownload.created)).toEqual(
    [],
  );
  expect(await page.evaluate(() => window.__marketExport.actions)).toEqual([]);
  await page.evaluate(() => window.__marketExport.replace());
  await expect(
    page.getByRole("textbox", { name: "Displayed market rows CSV" }),
  ).toHaveCount(0);
});
test("unsupported Blob download falls back to readable CSV without clipboard or retry", async ({
  page,
}) => {
  await harness(page);
  await page.evaluate(() => {
    Object.defineProperty(URL, "createObjectURL", {
      value: undefined,
      configurable: true,
    });
  });
  await control(page).click();
  await expect(
    page.getByRole("textbox", { name: "Displayed market rows CSV" }),
  ).toHaveValue(/displayed_loaded_sample_only/);
  expect(await page.evaluate(() => window.__marketDownload.created)).toEqual(
    [],
  );
});
test("a blocked download click revokes its URL and leaves one manual readable snapshot", async ({
  page,
}) => {
  await harness(page);
  await page.evaluate(() => {
    HTMLAnchorElement.prototype.click = () => {
      throw Error("Fixture download blocked");
    };
  });
  await control(page).click();
  await expect(
    page.getByRole("textbox", { name: "Displayed market rows CSV" }),
  ).toHaveValue(/displayed_loaded_sample_only/);
  expect(
    await page.evaluate(() => window.__marketDownload.created.length),
  ).toBe(1);
  expect(
    await page.evaluate(() => window.__marketDownload.revoked.length),
  ).toBe(1);
  expect(await page.locator("a[download]").count()).toBe(0);
});
for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390])
    test(`${app} ${width}px export fits actual component with a 44px keyboard target`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await harness(page, "native", app);
      for (const target of [
        page.getByRole("region", { name: "Sampled token discovery" }),
        control(page),
      ]) {
        const b = await target.boundingBox();
        expect(b!.x).toBeGreaterThanOrEqual(0);
        expect(b!.x + b!.width).toBeLessThanOrEqual(width);
      }
      const b = await control(page).boundingBox();
      expect(b!.height).toBeGreaterThanOrEqual(44);
      expect(b!.width).toBeGreaterThanOrEqual(44);
      await control(page).focus();
      await page.screenshot({
        path: `tmp/forum-render-tests/market-export-${app}-${width}.png`,
        fullPage: true,
      });
      await page.keyboard.press("Enter");
      const text = page.getByRole("textbox", {
        name: "Displayed market rows CSV",
      });
      await expect(text).toBeVisible();
      const box = await text.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(
        await text.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
      ).toBeGreaterThanOrEqual(16);
    });
