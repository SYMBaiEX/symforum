import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43231";
const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const mintB = "So11111111111111111111111111111111111111112";
const program = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const installation = JSON.parse(
  readFileSync("tests/fixtures/installation.symbaiex.json", "utf8"),
);
const canonical = `${installation.sites.forum}/crypto/recorded-discussion#post-2`;
type Clipboard = {
  mode: "success" | "failure" | "deferred";
  writes: string[];
  pending: { resolve(): void; reject(): void }[];
  settle(index: number, success: boolean): void;
};
declare global {
  interface Window {
    __sharingClipboard: Clipboard;
    __sharingFacts: {
      select(mint: string): void;
      setPath(path: string | null): void;
      setMounted(mounted: boolean): void;
      symfMint: string;
      reads: { name: string; mint: string }[];
      forbidden: string[];
    };
  }
}
const styles = {} as Record<"platform" | "forum", string>;
let script: string;
const audits = new WeakMap<Page, { errors: string[]; outbound: string[] }>();
const share = (page: Page) =>
  page.getByRole("button", { name: "Copy discussion link", exact: true });
const addresses = (page: Page) =>
  page.getByLabel("Recorded authority addresses", { exact: true });
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/token-sharing-facts.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"sharing-facts-only",setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|^\\.\\/price-chart$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/token-sharing-facts-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 6 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  scenario = "",
  mode: Clipboard["mode"] = "success",
  app: "platform" | "forum" = "platform",
  native = true,
) {
  const audit = { errors: [] as string[], outbound: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  await page.addInitScript((mode) => {
    const clipboard: Clipboard = {
      mode,
      writes: [],
      pending: [],
      settle(index, success) {
        if (success) this.pending[index].resolve();
        else this.pending[index].reject();
      },
    };
    window.__sharingClipboard = clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(value: string) {
          clipboard.writes.push(value);
          if (clipboard.mode === "failure")
            return Promise.reject(new Error("Fixture clipboard denied"));
          if (clipboard.mode === "deferred")
            return new Promise<void>((resolve, reject) =>
              clipboard.pending.push({
                resolve,
                reject: () => reject(new Error("Fixture clipboard denied")),
              }),
            );
          return Promise.resolve();
        },
      },
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: () => {
        throw new Error("Native sharing forbidden");
      },
    });
  }, mode);
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
  await page.goto(`${origin}/?scenario=${scenario}${native ? "&native" : ""}`);
  await expect(
    page.getByRole("heading", { name: "$SAME", exact: true }),
  ).toBeVisible();
}
async function openSharing(page: Page) {
  await page.getByText("Market details & sources", { exact: true }).click();
}
async function openFacts(page: Page) {
  await page
    .locator("summary")
    .filter({ hasText: /^Mint facts Authorities & recorded checks$/ })
    .click();
  await addresses(page).locator("summary").click();
}
async function settle(page: Page, index: number, success: boolean) {
  await page.evaluate(
    async ({ index, success }) => {
      window.__sharingClipboard.settle(index, success);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    },
    { index, success },
  );
}
test.afterEach(async ({ page }) => {
  expect(audits.get(page)?.errors).toEqual([]);
  expect(audits.get(page)?.outbound).toEqual([]);
  expect(await page.evaluate(() => window.__sharingFacts.forbidden)).toEqual(
    [],
  );
});
for (const native of [false, true])
  test(`${native ? "native" : "website"} explicit discussion copy uses the canonical website, not the host or market source`, async ({
    page,
  }) => {
    await harness(page, "", "success", "platform", native);
    await openSharing(page);
    await share(page).click();
    await expect(
      page.getByText("Discussion link copied.", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.__sharingClipboard.writes)).toEqual(
      [canonical],
    );
    expect(
      await page
        .getByRole("link", { name: "Read the token discussion", exact: true })
        .getAttribute("href"),
    ).toBe(
      native
        ? "/crypto/recorded-discussion#post-2"
        : "/forum/crypto/recorded-discussion#post-2",
    );
  });
test("absent discussions expose no copy action, but the configured SYMF announcement fallback remains shareable", async ({
  page,
}) => {
  await harness(page);
  await page.evaluate(() => window.__sharingFacts.setPath(null));
  await openSharing(page);
  await expect(share(page)).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Browse Web3 discussions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Market source", exact: true }),
  ).toHaveAttribute("href", "https://source.example.test/not-a-discussion");
  await page.evaluate(() =>
    window.__sharingFacts.select(window.__sharingFacts.symfMint),
  );
  await share(page).click();
  const path = installation.token.announcementPath.replace(/^\/forum\//, "/");
  expect(await page.evaluate(() => window.__sharingClipboard.writes)).toEqual([
    `${installation.sites.forum}${path}`,
  ]);
});
test("untrusted discussion references never become a copy action or a disguised market-source discussion", async ({
  page,
}) => {
  await harness(page);
  await openSharing(page);
  for (const path of [
    "https://untrusted.example/thread",
    "//untrusted.example/thread",
    "javascript:alert(1)",
    "https://user:password@forum.symbaiex.com/crypto/recorded",
    "/\\untrusted.example/thread",
    "/forum/\n/escape",
  ]) {
    await page.evaluate((path) => window.__sharingFacts.setPath(path), path);
    await expect(share(page)).toHaveCount(0);
    await expect(
      page.getByRole("link", {
        name: "Read the token discussion",
        exact: true,
      }),
    ).toHaveCount(0);
  }
  expect(await page.evaluate(() => window.__sharingClipboard.writes)).toEqual(
    [],
  );
});
test("existing first-party absolute discussion references canonicalize without carrying their source origin", async ({
  page,
}) => {
  await harness(page);
  await page.evaluate(() =>
    window.__sharingFacts.setPath(
      "https://www.symbaiex.com/forum/crypto/recorded-discussion#post-2",
    ),
  );
  await openSharing(page);
  await share(page).click();
  expect(await page.evaluate(() => window.__sharingClipboard.writes)).toEqual([
    canonical,
  ]);
});
test("discussion copy failure is explicit and does not overwrite independent mint-copy feedback", async ({
  page,
}) => {
  await harness(page);
  await openSharing(page);
  await page
    .getByRole("button", { name: "Copy selected token mint", exact: true })
    .click();
  await expect(page.getByText("Mint copied.", { exact: true })).toHaveCount(1);
  await page.evaluate(() => {
    window.__sharingClipboard.mode = "failure";
  });
  await share(page).click();
  await expect(
    page.getByText(
      "Copy unavailable. Open the token discussion to copy its website address.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText("Mint copied.", { exact: true })).toHaveCount(1);
});
for (const transition of ["mint", "aba", "path", "path-aba", "unmount"])
  test(`deferred discussion copy feedback cannot survive ${transition} identity changes`, async ({
    page,
  }) => {
    await harness(page, "", "deferred");
    await openSharing(page);
    await share(page).click();
    if (transition === "mint" || transition === "aba") {
      await page.getByRole("button", { name: "Token B", exact: true }).click();
      if (transition === "aba")
        await page
          .getByRole("button", { name: "Token A", exact: true })
          .click();
    } else if (transition === "unmount") {
      await page.evaluate(() => window.__sharingFacts.setMounted(false));
    } else {
      await page.evaluate(() =>
        window.__sharingFacts.setPath("/forum/crypto/new-discussion"),
      );
      if (transition === "path-aba")
        await page.evaluate(() =>
          window.__sharingFacts.setPath(
            "/forum/crypto/recorded-discussion#post-2",
          ),
        );
    }
    await settle(page, 0, true);
    await expect(
      page.getByText("Discussion link copied.", { exact: true }),
    ).toHaveCount(0);
    if (transition === "unmount") {
      await page.evaluate(() => window.__sharingFacts.setMounted(true));
      await openSharing(page);
    }
    await share(page).click();
    await settle(page, 1, true);
    await expect(
      page.getByText("Discussion link copied.", { exact: true }),
    ).toBeVisible();
    // An already-requested OS clipboard write is not claimed to be cancelled.
    expect(
      (await page.evaluate(() => window.__sharingClipboard.writes)).length,
    ).toBe(2);
  });
test("late old-mint copy denial cannot replace a current successful discussion copy", async ({
  page,
}) => {
  await harness(page, "", "deferred");
  await openSharing(page);
  await share(page).click();
  await page.getByRole("button", { name: "Token B", exact: true }).click();
  await share(page).click();
  await settle(page, 1, true);
  await settle(page, 0, false);
  await expect(
    page.getByText("Discussion link copied.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Copy unavailable. Open the token discussion/),
  ).toHaveCount(0);
});
test("stale authority facts retain full addresses, original mint/time and existing disclosure semantics", async ({
  page,
}) => {
  await harness(page);
  await expect(addresses(page).locator("summary")).toBeHidden();
  await openFacts(page);
  await expect(addresses(page)).toContainText(mintA);
  await expect(addresses(page)).toContainText(mintB);
  await expect(addresses(page)).toContainText(program);
  await expect(addresses(page).locator("time")).toHaveAttribute(
    "datetime",
    "2026-10-31T11:00:00.000Z",
  );
  await expect(addresses(page)).toContainText("Stale recorded check.");
  await expect(page.getByText(/These mint facts are stale/)).toBeVisible();
  await expect(addresses(page)).toContainText(
    "not a safety audit or endorsement",
  );
  await page.getByRole("button", { name: "Token B", exact: true }).click();
  await expect(
    addresses(page)
      .getByRole("listitem", {
        name: "Mint authority recorded address",
        exact: true,
      })
      .locator("code"),
  ).toHaveText(mintB);
  await expect(
    addresses(page)
      .getByRole("listitem", {
        name: "Freeze authority recorded address",
        exact: true,
      })
      .locator("code"),
  ).toHaveText(mintA);
});
for (const scenario of ["null", "fresh", "loading", "missing"])
  test(`${scenario} mint facts preserve not-set, recorded-check and missing/loading distinctions`, async ({
    page,
  }) => {
    await harness(page, scenario);
    await page
      .locator("summary")
      .filter({ hasText: /^Mint facts Authorities & recorded checks$/ })
      .click();
    if (scenario === "loading" || scenario === "missing") {
      await expect(addresses(page)).toHaveCount(0);
      await expect(
        page.getByText(
          scenario === "loading"
            ? "Loading checked mint facts…"
            : "No recent mint facts are cached. Missing data does not mean the token is safe.",
          { exact: true },
        ),
      ).toBeVisible();
    } else {
      await addresses(page).locator("summary").click();
      if (scenario === "null") {
        for (const label of ["Mint authority", "Freeze authority"])
          await expect(
            addresses(page)
              .getByRole("listitem", {
                name: `${label} recorded address`,
                exact: true,
              })
              .locator("code"),
          ).toHaveText("No authority set at this check");
      } else {
        await expect(addresses(page).locator("time")).toHaveAttribute(
          "datetime",
          "2026-10-31T12:59:00.000Z",
        );
        await expect(addresses(page)).toContainText(
          "Recorded check, not a current-state guarantee.",
        );
      }
    }
  });
for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390])
    test(`${app} ${width}px sharing and exact authorities remain keyboard readable inside the real scrollport`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 568 });
      await harness(page, "", "success", app);
      await page.getByText("Market details & sources", { exact: true }).focus();
      await page.keyboard.press("Enter");
      await share(page).focus();
      await expect(share(page)).toBeFocused();
      expect((await share(page).boundingBox())!.height).toBeGreaterThanOrEqual(
        44,
      );
      await page.keyboard.press("Enter");
      await expect(
        page.getByText("Discussion link copied.", { exact: true }),
      ).toBeVisible();
      const outer = page
        .locator("summary")
        .filter({ hasText: /^Mint facts Authorities & recorded checks$/ });
      await outer.focus();
      await page.keyboard.press("Enter");
      const summary = addresses(page).locator("summary");
      await summary.focus();
      await expect(summary).toBeFocused();
      expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.keyboard.press("Enter");
      const workspace = page.getByRole("region", {
        name: "Loaded sharing workspace",
        exact: true,
      });
      for (const node of [
        share(page),
        addresses(page),
        ...(await addresses(page).getByRole("listitem").all()),
      ]) {
        await node.scrollIntoViewIfNeeded();
        const box = (await node.boundingBox())!,
          port = (await workspace.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(port.x - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(port.x + port.width + 1);
        expect(
          await node.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
      }
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(summary).toBeFocused();
      await expect(
        addresses(page).getByRole("listitem", {
          name: "Mint authority recorded address",
          exact: true,
        }),
      ).toBeHidden();
      expect(
        await workspace.evaluate((el) => el.scrollHeight > el.clientHeight),
      ).toBe(true);
      expect(
        await page.evaluate(() => document.scrollingElement?.scrollTop),
      ).toBe(0);
      expect(await page.evaluate(() => window.__sharingFacts.reads)).toEqual([
        { name: "forumTerminal:getMarket", mint: mintA },
        { name: "forumTerminal:getRisk", mint: mintA },
      ]);
    });
