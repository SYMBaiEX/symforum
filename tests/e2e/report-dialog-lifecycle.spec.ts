import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43265";
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
          `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./${app === "forum" ? "apps/forum/tailwind.config.ts" : "tailwind.config.ts"}";config.content=["./components/**/*.{ts,tsx}","./packages/forum-ui/src/**/*.{ts,tsx}"];const css=(await Bun.file("apps/${app}/app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
        ],
        { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 },
      );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const r=await Bun.build({entrypoints:["tests/e2e/fixtures/report-dialog-lifecycle.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"isolated-report",setup(build){build.onResolve({filter:/^convex\\/react$|^convex-helpers\\/react\\/cache\\/hooks$|^next\\/navigation$|^next\\/dynamic$|forum-primitives$|forum-commerce$|community-hub$|forum-compose$|app-error-surface$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/report-dialog-lifecycle-state.tsx"}));}}]});if(!r.success)throw Error(r.logs.join("\\n"));process.stdout.write(await r.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 14 * 1024 * 1024 },
  );
});
async function open(page: Page, app = "platform") {
  const errors: string[] = [],
    network: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    network.push(url.href);
    return route.abort();
  });
  await page.goto(origin);
  await expect(page.locator("#post-1")).toBeVisible();
  return async () => {
    expect(errors).toEqual([]);
    expect(network).toEqual([]);
    expect(await page.evaluate(() => window.reportLifecycle.forbidden)).toEqual(
      [],
    );
  };
}
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "Report post", exact: true });
const reason = (page: Page) =>
  dialog(page).getByRole("textbox", { name: "Reason", exact: true });
async function report(page: Page, post = 1, checkTarget = false) {
  const root = page.locator(`#post-${post}`);
  const more = root.getByLabel(`More actions for post ${post}`);
  if (!(await more.locator("..").evaluate((node) => node.hasAttribute("open"))))
    await more.click();
  const trigger = root.getByRole("button", { name: "Report", exact: true });
  if (checkTarget)
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await trigger.click();
  await expect(dialog(page)).toBeVisible();
  return trigger;
}
async function fill(page: Page) {
  await reason(page).fill("  Off topic  ");
  await dialog(page)
    .getByRole("textbox", { name: "Details", exact: true })
    .fill("  Context for staff  ");
}
const count = (page: Page) =>
  page.evaluate(() => window.reportLifecycle.reports().length);
test("same-tick double activation admits one exact original report payload", async ({
  page,
}) => {
  const check = await open(page);
  await report(page);
  await fill(page);
  await dialog(page)
    .getByRole("button", { name: "Send report", exact: true })
    .evaluate((node) => {
      (node as HTMLButtonElement).click();
      (node as HTMLButtonElement).click();
    });
  expect(await count(page)).toBe(1);
  expect(
    await page.evaluate(() => window.reportLifecycle.reports()[0]),
  ).toEqual({
    entityType: "thread",
    threadId: "thread-a",
    reason: "Off topic",
    details: "Context for staff",
  });
  await check();
});
for (const outcome of ["success", "failure", "auth"] as const)
  test(`old ${outcome} cannot close or write errors into a newly selected report target`, async ({
    page,
  }) => {
    const check = await open(page);
    await report(page);
    await fill(page);
    await dialog(page)
      .getByRole("button", { name: "Send report", exact: true })
      .click();
    await dialog(page)
      .getByRole("button", { name: /^(Cancel|Close dialog)$/ })
      .click();
    await report(page, 2);
    await reason(page).fill("New target draft");
    await page.evaluate(
      (outcome) => window.reportLifecycle.settle(0, outcome),
      outcome,
    );
    await expect(dialog(page)).toBeVisible();
    await expect(reason(page)).toHaveValue("New target draft");
    await expect(dialog(page).getByRole("alert")).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "Use a SYM handle" }),
    ).toHaveCount(0);
    await check();
  });
test("Escape returns focus to the connected report trigger", async ({
  page,
}) => {
  const check = await open(page);
  const trigger = await report(page);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await check();
});
test("a current confirmed response closes only its dialog and restores the original trigger", async ({
  page,
}) => {
  const check = await open(page);
  const trigger = await report(page);
  await fill(page);
  await dialog(page)
    .getByRole("button", { name: "Send report", exact: true })
    .click();
  await page.evaluate(() => window.reportLifecycle.settle(0, "success"));
  await expect(dialog(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await report(page);
  await expect(reason(page)).toHaveValue("");
  expect(await count(page)).toBe(1);
  await check();
});
test("unrelated thread handlers, query effects and original report payload are unchanged", () => {
  const before = execFileSync(
    "git",
    ["show", "f6a469ee:components/forum/forum-thread-view.tsx"],
    { encoding: "utf8" },
  );
  const after = readFileSync("components/forum/forum-thread-view.tsx", "utf8");
  function protectedCode(source: string) {
    const tree = ts.createSourceFile(
        "thread.tsx",
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      ),
      entries: string[] = [];
    function walk(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        /^(useQuery|useMutation|useConvexAuth|useEffect|createReport)$/.test(
          node.expression.getText(tree),
        )
      )
        entries.push(node.getText(tree));
      if (
        ts.isFunctionDeclaration(node) &&
        !/^(LiveForumThreadView|openReport|closeReport|submitReport|PostActions)$/.test(
          node.name?.text ?? "",
        )
      )
        entries.push(node.getText(tree));
      ts.forEachChild(node, walk);
    }
    walk(tree);
    return entries;
  }
  expect(protectedCode(after)).toEqual(protectedCode(before));
  expect(protectedCode(after).length).toBeGreaterThan(50);
});
test("validation and failed response preserve typed context without an automatic retry or false unsent claim", async ({
  page,
}) => {
  const check = await open(page);
  await report(page);
  await reason(page).fill("ab");
  await dialog(page)
    .getByRole("button", { name: "Send report", exact: true })
    .click();
  await expect(dialog(page).getByRole("alert")).toContainText(
    "Add a short reason",
  );
  expect(await count(page)).toBe(0);
  await fill(page);
  await dialog(page)
    .getByRole("button", { name: "Send report", exact: true })
    .click();
  await expect(reason(page)).toBeDisabled();
  await page.evaluate(() => window.reportLifecycle.settle(0, "failure"));
  await expect(dialog(page).getByRole("alert")).toContainText(
    "may already have reached moderation",
  );
  await expect(reason(page)).toHaveValue("  Off topic  ");
  await expect(
    dialog(page).getByRole("textbox", { name: "Details", exact: true }),
  ).toHaveValue("  Context for staff  ");
  await expect(reason(page)).toBeEnabled();
  expect(await count(page)).toBe(1);
  await check();
});
test("closing keeps the earlier request admitted; new target can edit but cannot send until it settles", async ({
  page,
}) => {
  const check = await open(page);
  await report(page);
  await fill(page);
  await dialog(page)
    .getByRole("button", { name: "Send report", exact: true })
    .click();
  await expect(dialog(page).getByRole("status")).toContainText(
    "does not cancel",
  );
  await dialog(page)
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await report(page, 2);
  await reason(page).fill("New reply report");
  await expect(
    dialog(page).getByRole("button", {
      name: "Earlier report pending",
      exact: true,
    }),
  ).toBeDisabled();
  expect(await count(page)).toBe(1);
  await page.evaluate(() => window.reportLifecycle.settle(0, "success"));
  await expect(reason(page)).toHaveValue("New reply report");
  await dialog(page)
    .getByRole("button", { name: "Send report", exact: true })
    .click();
  expect(await count(page)).toBe(2);
  expect(
    await page.evaluate(() => window.reportLifecycle.reports()[1]),
  ).toEqual({
    entityType: "post",
    threadId: "thread-a",
    postId: "post-b",
    reason: "New reply report",
  });
  await check();
});
test("same-owner target A→B→A does not admit or attach the older target-A completion to the reopened draft", async ({
  page,
}) => {
  const check = await open(page);
  await report(page);
  await fill(page);
  await dialog(page)
    .getByRole("button", { name: "Send report", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await report(page, 2);
  await page.keyboard.press("Escape");
  await report(page);
  await reason(page).fill("New A draft");
  await page.evaluate(() => window.reportLifecycle.settle(0, "failure"));
  await expect(reason(page)).toHaveValue("New A draft");
  await expect(dialog(page).getByRole("alert")).toHaveCount(0);
  expect(await count(page)).toBe(1);
  await check();
});
test("owner A→B→A clears private typed context and fences late authentication failure", async ({
  page,
}) => {
  const check = await open(page);
  await report(page);
  await fill(page);
  await dialog(page)
    .getByRole("button", { name: "Send report", exact: true })
    .click();
  await page.evaluate(() =>
    window.reportLifecycle.update({ owner: "owner-b" }),
  );
  await expect(dialog(page)).toHaveCount(0);
  await page.evaluate(() =>
    window.reportLifecycle.update({ owner: "owner-a" }),
  );
  await report(page, 2);
  await expect(reason(page)).toHaveValue("");
  await reason(page).fill("Current owner draft");
  await page.evaluate(() => window.reportLifecycle.settle(0, "auth"));
  await expect(reason(page)).toHaveValue("Current owner draft");
  await expect(
    page.getByRole("dialog", { name: "Use a SYM handle" }),
  ).toHaveCount(0);
  expect(await count(page)).toBe(1);
  await check();
});
test("losing authentication closes private report fields; a late result does not reopen or resubmit", async ({
  page,
}) => {
  const check = await open(page);
  await report(page);
  await fill(page);
  await dialog(page)
    .getByRole("button", { name: "Send report", exact: true })
    .click();
  await page.evaluate(() =>
    window.reportLifecycle.update({ authenticated: false, loading: true }),
  );
  await expect(dialog(page)).toHaveCount(0);
  await page.evaluate(() => window.reportLifecycle.settle(0, "failure"));
  expect(await count(page)).toBe(1);
  expect(await page.evaluate(() => window.reportLifecycle.errors)).toEqual([]);
  await check();
});
test("unmount and remount cannot publish an earlier report error or retain its local pending state", async ({
  page,
}) => {
  const check = await open(page);
  await report(page);
  await fill(page);
  await dialog(page)
    .getByRole("button", { name: "Send report", exact: true })
    .click();
  await page.evaluate(() => window.reportLifecycle.update({ mounted: false }));
  await expect(dialog(page)).toHaveCount(0);
  await page.evaluate(() => window.reportLifecycle.settle(0, "failure"));
  await page.evaluate(() => window.reportLifecycle.update({ mounted: true }));
  await report(page);
  await expect(reason(page)).toHaveValue("");
  await expect(dialog(page).getByRole("alert")).toHaveCount(0);
  await expect(
    dialog(page).getByRole("button", { name: "Send report", exact: true }),
  ).toBeEnabled();
  expect(await count(page)).toBe(1);
  expect(await page.evaluate(() => window.reportLifecycle.errors)).toEqual([]);
  await check();
});
test("a removed/hidden initiating control falls back to visible discussion content on Escape", async ({
  page,
}) => {
  const check = await open(page);
  await report(page);
  await page
    .locator("#post-1")
    .getByRole("button", { name: "Report", exact: true, includeHidden: true })
    .evaluate((node) => {
      (node as HTMLElement).hidden = true;
    });
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Discussion content", exact: true }),
  ).toBeFocused();
  await check();
});
for (const loading of [false, true])
  test(`guest ${loading ? "loading" : "resolved"} cannot submit a report or inherit typed fields`, async ({
    page,
  }) => {
    const check = await open(page);
    await page.evaluate(
      (loading) =>
        window.reportLifecycle.update({ authenticated: false, loading }),
      loading,
    );
    await page.locator("#post-1").getByLabel("More actions for post 1").click();
    await page
      .locator("#post-1")
      .getByRole("button", { name: "Report", exact: true })
      .click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "Use a SYM handle" }),
    ).toHaveCount(loading ? 0 : 1);
    expect(await count(page)).toBe(0);
    await check();
  });
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} ${width}: report stays bounded with keyboard trap, 44px controls and explicit close`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const check = await open(page, app);
      const trigger = await report(page, 1, true);
      await expect(reason(page)).toBeFocused();
      await fill(page);
      for (const name of ["Close", "Close dialog", "Send report"]) {
        const control = dialog(page).getByRole("button", { name, exact: true });
        await control.scrollIntoViewIfNeeded();
        const box = (await control.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
      const box = (await dialog(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await reason(page).focus();
      for (let index = 0; index < 7; index++) {
        await page.keyboard.press("Tab");
        expect(
          await dialog(page).evaluate((node) =>
            node.contains(document.activeElement),
          ),
        ).toBe(true);
      }
      await page.keyboard.press("Shift+Tab");
      expect(
        await dialog(page).evaluate((node) =>
          node.contains(document.activeElement),
        ),
      ).toBe(true);
      await dialog(page)
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(await count(page)).toBe(0);
      await check();
    });
test("short landscape retains reachable close and submit controls within its own dialog scrollport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  const check = await open(page, "forum");
  const trigger = await report(page);
  const box = (await dialog(page).boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(390);
  for (const name of ["Send report", "Close dialog"]) {
    const control = dialog(page).getByRole("button", { name, exact: true });
    await control.scrollIntoViewIfNeeded();
    const bounds = (await control.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(390);
  }
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  expect(await count(page)).toBe(0);
  await check();
});
