import { test, expect, type Page, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";

const origin = "http://127.0.0.1:43259";
let script: string;
const css: Record<string, string> = {};
const destinations = [
  ["Read agent instructions", "https://www.symbaiex.com/agent/instructions"],
  ["Owner-led agent enrollment", "https://www.symbaiex.com/agent/signup"],
  [
    "Manage forum access & approvals",
    "https://forum.symbaiex.com/control-panel/agent-access#review-queue",
  ],
] as const;
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
      `const baseline=process.env.AGENT_ONBOARDING_BASELINE==="1";const sources=baseline?Object.fromEntries(await Promise.all(["forum-agents-page","forum-start-here"].map(async name=>[name,await Bun.$\`git show 8ba7ac40:components/forum/\${name}.tsx\`.text()]))):{};const r=await Bun.build({entrypoints:["tests/e2e/fixtures/agent-directory-onboarding.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"isolated",setup(build){if(baseline)build.onLoad({filter:/components\\/forum\\/forum-(agents-page|start-here)\\.tsx$/},({path})=>({contents:sources[path.match(/forum-(agents-page|start-here)/)[0]],loader:"tsx"}));build.onResolve({filter:/^convex\\/react$|^convex-helpers\\/react\\/cache\\/hooks$|^next\\/navigation$|^next\\/link$|forum-primitives$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/agent-directory-onboarding-state.tsx"}));}}]});if(!r.success)throw Error(r.logs.join("\\n"));process.stdout.write(await r.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 },
  );
});
async function open(
  page: Page,
  path = "/agents",
  scenario = "guest",
  app = "forum",
  native = false,
) {
  const errors: string[] = [],
    network: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === path)
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    network.push(url.href);
    return route.abort();
  });
  await page.goto(
    `${origin}${path}?scenario=${scenario}${native ? "&native" : ""}${scenario === "disabled" ? "&disabled" : ""}`,
  );
  return async (reads: number) => {
    expect(errors).toEqual([]);
    expect(network).toEqual([]);
    expect(await page.evaluate(() => window.agentDirectory.forbidden)).toEqual(
      [],
    );
    expect(await page.evaluate(() => window.agentDirectory.reads)).toEqual(
      Array.from({ length: reads }, () => ({})),
    );
  };
}
async function bounded(node: Locator, width: number, control = false) {
  await node.scrollIntoViewIfNeeded();
  const box = (await node.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(
    await node.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  if (control) expect(box.height).toBeGreaterThanOrEqual(44);
}
test("directory labels enabled configuration, not online activity or achieved publication", async ({
  page,
}) => {
  const check = await open(page);
  await expect(
    page.getByText("Enabled profile", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Configured target", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Cadence", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Recent published activity is not included", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open profile" }),
  ).toHaveAttribute("href", "/members/fixture_agent");
  await expect(
    page.getByRole("link", { name: "Bring your own agent" }),
  ).toHaveAttribute("href", "/start-here#bring-your-own-agent");
  await check(1);
});
test("empty, loading and disabled roster states do not invent online status or extra reads", async ({
  page,
}) => {
  const check = await open(page, "/agents", "loading");
  await expect(page.getByRole("status")).toHaveText("Syncing agent roster");
  await expect(page.getByText("Enabled profile", { exact: true })).toHaveCount(
    0,
  );
  await page.evaluate(() => window.agentDirectory.setRoster("empty"));
  await expect(
    page.getByText("No enabled agent profiles", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No agents are online", { exact: true }),
  ).toHaveCount(0);
  await check(1);
});
test("disabled directory never admits a roster subscription", async ({
  page,
}) => {
  const check = await open(page, "/agents", "disabled");
  await expect(
    page.getByText("Local forum disabled", { exact: true }),
  ).toBeVisible();
  await check(0);
});
for (const path of ["/start-here", "/forum/start-here"])
  for (const scenario of ["guest", "member", "loading"])
    test(`${path} ${scenario}: optional guide preserves join behavior and exact owner-led destinations`, async ({
      page,
    }) => {
      const check = await open(page, path, scenario);
      const summary = page.getByText("Bring your own agent", { exact: true });
      await expect(summary).toBeVisible();
      const join = page.getByRole("link", {
        name:
          scenario === "guest" ? "Sign in to join" : "Choose your interests",
        exact: true,
      });
      const destination = `${path.startsWith("/forum") ? "/forum" : ""}/catch-up#interests`;
      await expect(join).toHaveAttribute(
        "href",
        scenario === "guest"
          ? `/signin?${new URLSearchParams({ redirectTo: destination })}`
          : destination,
      );
      await expect(
        page.getByRole("link", { name: "Read agent instructions" }),
      ).toBeHidden();
      await summary.focus();
      await summary.press("Enter");
      await expect(
        page.getByText("Opening this guide does not create an account", {
          exact: false,
        }),
      ).toBeVisible();
      for (const [label, href] of destinations) {
        const link = page.getByRole("link", { name: label, exact: true });
        await expect(link).toHaveAttribute("href", href);
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", "noopener noreferrer");
        if (label !== "Read agent instructions")
          await expect(link).toHaveAttribute(
            "data-forum-owner-control",
            "true",
          );
      }
      expect(
        await page.evaluate(() => window.agentDirectory.navigations),
      ).toEqual([]);
      await summary.press("Enter");
      await expect(
        page.getByRole("link", { name: "Read agent instructions" }),
      ).toBeHidden();
      await check(0);
    });
test("native host uses first-party owner-control handoffs without enrollment or credentials in the embedded surface", async ({
  page,
}) => {
  const check = await open(page, "/start-here", "member", "forum", true);
  await page.getByText("Bring your own agent", { exact: true }).click();
  const enroll = page.getByRole("link", {
    name: "Owner-led agent enrollment",
    exact: true,
  });
  await enroll.focus();
  await enroll.press("Enter");
  expect(await page.evaluate(() => window.agentDirectory.navigations)).toEqual([
    destinations[1][1],
  ]);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /enroll|approve|create|publish/i }),
  ).toHaveCount(0);
  await check(0);
});
test("guide destinations have existing source route implementations", () => {
  for (const path of [
    "apps/platform/app/agent/signup/page.tsx",
    "apps/platform/app/agent/instructions/route.ts",
    "apps/forum/app/control-panel/agent-access/page.tsx",
  ])
    expect(existsSync(path)).toBe(true);
});
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} ${width}: directory extremes and guided links fit intrinsic bounds with 44px keyboard targets`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const check = await open(
        page,
        app === "platform" ? "/forum/agents" : "/agents",
        "member",
        app,
      );
      await page.evaluate(() => window.agentDirectory.setRoster("long"));
      await bounded(page.getByRole("article"), width);
      await bounded(
        page.getByRole("link", { name: "Open profile" }),
        width,
        true,
      );
      await bounded(
        page.getByRole("link", { name: "Bring your own agent" }),
        width,
        true,
      );
      await check(1);
    });
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} ${width}: expanded guide controls remain accessible without widening the component`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const check = await open(
        page,
        app === "platform" ? "/forum/start-here" : "/start-here",
        "guest",
        app,
      );
      const summary = page.getByText("Bring your own agent", { exact: true });
      await bounded(summary, width, true);
      await summary.focus();
      await summary.press("Enter");
      await bounded(page.locator("#bring-your-own-agent"), width);
      for (const [label] of destinations)
        await bounded(
          page.getByRole("link", { name: label, exact: true }),
          width,
          true,
        );
      await check(0);
    });
