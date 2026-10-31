import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";

const origin = "http://127.0.0.1:43239",
  day = Date.UTC(2026, 9, 31);
let script: string;
const styles = {} as Record<"platform" | "forum", string>;
type Patch = {
  authenticated?: boolean;
  loading?: boolean;
  actor?: string;
  mounted?: boolean;
  instance?: number;
  surface?: "feed" | "recent";
  mode?: "today" | "new";
  deferred?: boolean;
};
type Call = { name: string; args: Record<string, unknown>; actor: string };
declare global {
  interface Window {
    __sharedForumKeys: {
      update(patch: Patch): void;
      reads: Call[];
      mutations: Call[];
      forbidden: string[];
      resolve(index: number): void;
      reject(index: number): void;
    };
  }
}
const audits = new WeakMap<Page, { errors: string[]; outbound: string[] }>();
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/shared-forum-query-keys.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"inert-forum-reads",setup(build){build.onResolve({filter:/^convex\\/react$|^convex-helpers\\/react\\/cache\\/hooks$|^next\\/navigation$|app-error-surface$|forum-webmcp$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/shared-forum-query-keys-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  time = day + 12345,
  app: "platform" | "forum" = "platform",
) {
  const audit = { errors: [] as string[], outbound: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  await page.clock.install({ time: new Date(time) });
  await page.clock.pauseAt(new Date(time));
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
  await page.goto(`${origin}/?view=feed`);
  await expect(page.getByRole("article")).toHaveCount(1);
}
async function update(page: Page, patch: Patch) {
  await page.evaluate((patch) => window.__sharedForumKeys.update(patch), patch);
}
const reads = (page: Page, name = "forum:listFeedThreads") =>
  page.evaluate(
    (name) =>
      window.__sharedForumKeys.reads.filter((read) => read.name === name),
    name,
  );
const refresh = (page: Page) =>
  page.getByRole("button", { name: /^(Refresh|Refresh discussions)$/ });
test.afterEach(async ({ page }) => {
  expect(audits.get(page)?.errors).toEqual([]);
  expect(audits.get(page)?.outbound).toEqual([]);
  expect(await page.evaluate(() => window.__sharedForumKeys.forbidden)).toEqual(
    [],
  );
});

test("guest mount, explicit Refresh and a different-ms remount use identical complete arguments without now", async ({
  page,
}) => {
  await harness(page);
  await page.clock.setSystemTime(day + 45678);
  await refresh(page).click();
  await expect.poll(async () => (await reads(page)).length).toBe(2);
  await page.clock.setSystemTime(day + 98765);
  await update(page, { instance: 1 });
  await expect.poll(async () => (await reads(page)).length).toBe(3);
  const calls = await reads(page);
  expect(calls.map((call) => call.args)).toEqual(
    Array.from({ length: 3 }, () => ({
      sort: "active",
      communityOnly: false,
      scope: "discover",
      authorFilter: "all",
      paginationOpts: { numItems: 12, cursor: null },
    })),
  );
  expect(await page.evaluate(() => window.__sharedForumKeys.mutations)).toEqual(
    [],
  );
  await page.clock.runFor(120000);
  expect(await reads(page)).toHaveLength(3);
});

test("authenticated requests retain exact millisecond times across the temporary-mute boundary and original cursor", async ({
  page,
}) => {
  await harness(page);
  const until = Date.UTC(2026, 9, 31, 20, 0, 30, 321);
  await page.clock.setSystemTime(until - 1);
  await update(page, { authenticated: true, actor: "owner-a" });
  await expect(page.getByRole("article")).toContainText(
    "owner-a sampled discussion",
  );
  await page.clock.setSystemTime(until);
  await refresh(page).click();
  await expect.poll(async () => (await reads(page)).length).toBe(3);
  await page.clock.setSystemTime(until + 1);
  await page
    .getByRole("button", { name: "Load more discussions", exact: true })
    .click();
  await expect.poll(async () => (await reads(page)).length).toBe(4);
  const calls = (await reads(page)).slice(1);
  expect(calls.map((call) => call.actor)).toEqual([
    "owner-a",
    "owner-a",
    "owner-a",
  ]);
  expect(calls.map((call) => call.args)).toEqual(
    [until - 1, until, until + 1].map((now, index) => ({
      sort: "active",
      communityOnly: false,
      scope: "discover",
      authorFilter: "all",
      now,
      paginationOpts: {
        numItems: 12,
        cursor: index === 2 ? "sample-next" : null,
      },
    })),
  );
});

test("auth loading, old-identity delayed success and sign-out cannot bind old content or exact-time args to the new guest", async ({
  page,
}) => {
  await harness(page);
  await update(page, {
    loading: true,
    authenticated: true,
    actor: "owner-a",
    deferred: true,
  });
  await expect(
    page.getByText("Loading discussions", { exact: true }),
  ).toBeVisible();
  expect(await reads(page)).toHaveLength(1);
  await page.clock.setSystemTime(day + 22345);
  await update(page, { loading: false });
  await expect.poll(async () => (await reads(page)).length).toBe(2);
  await page.clock.setSystemTime(day + 33456);
  await update(page, { authenticated: false, actor: "guest" });
  await expect.poll(async () => (await reads(page)).length).toBe(3);
  await page.evaluate(() => window.__sharedForumKeys.resolve(0));
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.evaluate(() => window.__sharedForumKeys.resolve(1));
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText(
    "guest sampled discussion",
  );
  const calls = await reads(page);
  expect(calls[1].args.now).toBe(day + 22345);
  expect(calls[2].args).not.toHaveProperty("now");
  expect(calls.map((call) => call.actor)).toEqual([
    "guest",
    "owner-a",
    "guest",
  ]);
});

test("guest Refresh failure retains accepted content and explicit retry keeps the same public query key", async ({
  page,
}) => {
  await harness(page);
  const original = (await reads(page))[0].args;
  await update(page, { deferred: true });
  await refresh(page).click();
  await page.evaluate(() => window.__sharedForumKeys.reject(0));
  await expect(
    page.getByText(
      "Could not update the feed. Your loaded discussions are still here.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.clock.setSystemTime(day + 56789);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.evaluate(() => window.__sharedForumKeys.resolve(1));
  await expect(
    page.getByText(
      "Could not update the feed. Your loaded discussions are still here.",
      { exact: true },
    ),
  ).toBeHidden();
  expect((await reads(page)).map((call) => call.args)).toEqual([
    original,
    original,
    original,
  ]);
});

for (const mode of ["today", "new"] as const)
  test(`recent ${mode} mounts share a UTC-day argument across milliseconds and retain their mounted window after midnight`, async ({
    page,
  }) => {
    await harness(page);
    await page.clock.setSystemTime(day + 12345);
    await update(page, { surface: "recent", mode });
    await expect(
      page.getByRole("heading", { name: "Recent discussions", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => (await reads(page, "forum:listRecentThreads")).length)
      .toBe(1);
    await page.clock.setSystemTime(day + 86399999);
    await update(page, { instance: 1 });
    await expect
      .poll(async () => (await reads(page, "forum:listRecentThreads")).length)
      .toBe(2);
    await page.clock.setSystemTime(day + 86400000);
    await update(page, {});
    expect(await reads(page, "forum:listRecentThreads")).toHaveLength(2);
    await update(page, { instance: 2 });
    await expect
      .poll(async () => (await reads(page, "forum:listRecentThreads")).length)
      .toBe(3);
    expect(
      (await reads(page, "forum:listRecentThreads")).map((call) => call.args),
    ).toEqual(
      [day, day, day + 86400000].map((now) => ({
        mode,
        now,
        page: 1,
        pageSize: 25,
      })),
    );
    await page.clock.runFor(120000);
    expect(await reads(page, "forum:listRecentThreads")).toHaveLength(3);
  });

for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390])
    test(`${app} ${width}px feed keyboard controls and recent activity remain contained`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 568 });
      await harness(page, day + 12345, app);
      const control = refresh(page);
      await control.focus();
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await reads(page)).length).toBe(2);
      await expect(control).toBeFocused();
      for (const node of [
        page.getByRole("region", { name: "Forum discussions", exact: true }),
        control,
        page.getByRole("combobox", { name: "Authors", exact: true }),
      ]) {
        const bounds = (await node.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(-1);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
      }
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", { name: "Catch up & interests", exact: true }),
      ).toBeFocused();
      expect((await reads(page)).map((call) => call.args)).toEqual([
        expect.not.objectContaining({ now: expect.anything() }),
        expect.not.objectContaining({ now: expect.anything() }),
      ]);
      await update(page, { surface: "recent" });
      await expect(
        page.getByRole("heading", { name: "Recent discussions", exact: true }),
      ).toBeVisible();
      for (const node of [
        page.locator("main > div"),
        page.getByRole("heading", { name: "Recent discussions", exact: true }),
        page.getByText("No posts today", { exact: true }),
      ]) {
        const bounds = (await node.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(-1);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
        expect(
          await node.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
        ).toBe(true);
      }
      expect(
        (await reads(page, "forum:listRecentThreads")).map((call) => call.args),
      ).toEqual([{ mode: "today", now: day, page: 1, pageSize: 25 }]);
    });
