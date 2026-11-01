import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43239";
const key = "draft:owner-a:board-a:human";
let script: string;
const css = new Map<string, string>();
const audits = new WeakMap<Page, { errors: string[]; network: string[] }>();
test.beforeAll(() => {
  for (const app of ["platform", "forum"]) {
    css.set(
      app,
      FORUM_SHARED_THEME_CSS +
        readFileSync("styles/forum-shared.css", "utf8") +
        execFileSync(
          "bun",
          [
            "-e",
            `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./${app === "platform" ? "tailwind.config.ts" : "apps/forum/tailwind.config.ts"}";config.content=["./components/**/*.{ts,tsx}","./packages/forum-ui/src/**/*.{ts,tsx}"];const css=(await Bun.file("apps/${app}/app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
          ],
          { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 },
        ),
    );
  }
  const baseline =
    process.env.COMPOSER_FEEDBACK_BASELINE === "1"
      ? `build.onLoad({filter:/forum-compose\\.tsx$/},()=>({contents:Bun.spawnSync(['git','show','37b8a13a:components/forum/forum-compose.tsx']).stdout.toString(),loader:'tsx',resolveDir:process.cwd()+'/components/forum'}));`
      : "";
  script = execFileSync(
    "bun",
    [
      "-e",
      `const r=await Bun.build({entrypoints:['tests/e2e/fixtures/composer-feedback.tsx'],target:'browser',format:'iife',define:{'process.env':JSON.stringify({NODE_ENV:'production',NEXT_PUBLIC_CONVEX_SITE_URL:'${origin}'})},plugins:[{name:'inert-composer',setup(build){${baseline}build.onResolve({filter:/^@symbaiex\\/auth\\/token$|forum-webmcp$/},()=>({path:process.cwd()+'/tests/e2e/fixtures/composer-feedback-state.tsx'}));}}]});if(!r.success)throw new Error(r.logs.join('\\n'));process.stdout.write(await r.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  app = "platform",
  raw: string | null = null,
) {
  const audit = { errors: [] as string[], network: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  await page.addInitScript(
    ({ key, raw }) => {
      if (raw !== null && localStorage.getItem(key) === null)
        localStorage.setItem(key, raw);
    },
    { key, raw },
  );
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.get(app)}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    audit.network.push(url.href);
    return route.abort();
  });
  await page.goto(origin);
  await expect(body(page)).toBeVisible();
}
test.afterEach(async ({ page }) => {
  const audit = audits.get(page);
  if (audit) {
    expect(audit.errors).toEqual([]);
    expect(audit.network).toEqual([]);
  }
});
const body = (page: Page) =>
  page.getByRole("textbox", { name: "Draft body", exact: true });
const input = (page: Page) => page.getByLabel("Choose forum attachment files");
const file = (name: string) => ({
  name,
  mimeType: "text/plain",
  buffer: Buffer.from("inert"),
});
const outcomes = (page: Page) =>
  page.getByRole("list", { name: "File upload outcomes" });
async function calls(page: Page, count: number) {
  await expect
    .poll(() => page.evaluate(() => window.composerFeedback.calls().length))
    .toBe(count);
}
async function settle(page: Page, index: number, ok: boolean) {
  await page.evaluate(
    ({ index, ok }) => window.composerFeedback.settle(index, ok),
    { index, ok },
  );
}
async function stored(page: Page, storageKey = key) {
  return page.evaluate((key) => localStorage.getItem(key), storageKey);
}
async function bounds(page: Page) {
  const result = await page.locator(".forum-composer").evaluate((element) => {
    const root = element.getBoundingClientRect();
    return {
      root: { left: root.left, right: root.right },
      escaped: Array.from(
        element.querySelectorAll(
          "section,li,textarea,input:not([type=file]),button,p",
        ),
      )
        .filter(
          (node) =>
            !node.closest("[role=toolbar]") &&
            !node.classList.contains("sr-only"),
        )
        .filter((node) => {
          const box = node.getBoundingClientRect();
          return (
            box.width > 0 &&
            (box.left < root.left - 1 || box.right > root.right + 1)
          );
        })
        .map((node) => node.textContent?.slice(0, 50)),
      controls: Array.from(element.querySelectorAll("button")).map((node) => ({
        name: node.getAttribute("aria-label") ?? node.textContent,
        height: node.getBoundingClientRect().height,
        width: node.getBoundingClientRect().width,
      })),
    };
  });
  expect(result.root.left).toBeGreaterThanOrEqual(0);
  expect(result.root.right).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(result.escaped).toEqual([]);
  for (const control of result.controls) {
    expect(control.height, control.name ?? "button").toBeGreaterThanOrEqual(44);
    expect(control.width, control.name ?? "button").toBeGreaterThanOrEqual(44);
  }
}
for (const app of ["platform", "forum"])
  for (const width of [320, 390]) {
    test(`${app} ${width}px shows actual per-file progress, failure and keyboard controls within composer bounds`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await harness(page, app);
      const long = `${"long-name-".repeat(18)}.txt`;
      await input(page).setInputFiles([
        file("one.txt"),
        file(long),
        file("three.txt"),
      ]);
      await calls(page, 1);
      await expect(outcomes(page)).toContainText(
        "one.txt — Awaiting confirmation",
      );
      await expect(outcomes(page)).toContainText(
        "three.txt — Waiting to start",
      );
      await expect(
        page.getByText(
          "Waiting for upload confirmation. Byte progress is unavailable.",
        ),
      ).toBeVisible();
      await expect(page.getByRole("progressbar")).toHaveCount(0);
      await settle(page, 0, true);
      await calls(page, 2);
      await settle(page, 1, false);
      await expect(outcomes(page)).toContainText(
        "one.txt — Confirmed attachment",
      );
      await expect(outcomes(page)).toContainText(
        "Not confirmed; may have uploaded",
      );
      await expect(outcomes(page)).toContainText("three.txt — Not started");
      expect(
        await page.evaluate(() => window.composerFeedback.changes()),
      ).toEqual([["inert-one.txt"]]);
      await calls(page, 2);
      await expect(page.getByText("PRIVATE_FAILURE")).toHaveCount(0);
      await bounds(page);
      const heading = page.getByRole("button", {
        name: "Insert section heading",
      });
      await heading.focus();
      await page.keyboard.press("ArrowRight");
      await expect(
        page.getByRole("button", { name: "Insert bold markup" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(body(page)).toBeFocused();
      await page.evaluate(() =>
        window.composerFeedback.update({ pending: true }),
      );
      await expect(body(page)).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Posting...", exact: true }),
      ).toBeDisabled();
    });
  }
test("stop preserves confirmed outcomes, marks unknown versus not-started, and ignores late receipt", async ({
  page,
}) => {
  await harness(page);
  await input(page).setInputFiles([
    file("one.txt"),
    file("two.txt"),
    file("three.txt"),
  ]);
  await calls(page, 1);
  await settle(page, 0, true);
  await calls(page, 2);
  await page.getByRole("button", { name: "Stop waiting", exact: true }).click();
  await settle(page, 1, true);
  await expect(outcomes(page)).toContainText("one.txt — Confirmed attachment");
  await expect(outcomes(page)).toContainText(
    "two.txt — Not confirmed; may have uploaded",
  );
  await expect(outcomes(page)).toContainText("three.txt — Not started");
  expect(await page.evaluate(() => window.composerFeedback.changes())).toEqual([
    ["inert-one.txt"],
  ]);
  await calls(page, 2);
});
test("host batch reports no invented per-file progress before atomic receipt and no replay after failure", async ({
  page,
}) => {
  await harness(page);
  await page.evaluate(() => window.composerFeedback.update({ plugin: true }));
  await input(page).setInputFiles([file("one.txt"), file("two.txt")]);
  await calls(page, 1);
  await expect(outcomes(page).getByText(/Awaiting confirmation/)).toHaveCount(
    2,
  );
  await settle(page, 0, false);
  await expect(
    outcomes(page).getByText(/Not confirmed; may have uploaded/),
  ).toHaveCount(2);
  await calls(page, 1);
  await input(page).setInputFiles(file("one.txt"));
  await calls(page, 2);
  await settle(page, 1, true);
  await expect(outcomes(page)).toHaveText("one.txt — Confirmed attachment");
});
test("local draft restore and clear never resurrect cleared text on remount", async ({
  page,
}) => {
  await harness(
    page,
    "platform",
    JSON.stringify({ version: 1, body: "Saved body", title: "Saved title" }),
  );
  await expect(body(page)).toHaveValue("Saved body");
  await expect(page.getByRole("status")).toContainText(
    "Draft restored from this device",
  );
  await expect(page.getByText(/not cloud sync/)).toBeVisible();
  await body(page).fill("");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("");
  await expect(page.getByRole("status")).toContainText(
    "Empty editor: no draft text saved",
  );
  expect(await stored(page)).toBeNull();
  // Avoid seed-on-reload: this test checks real cleared storage, not fixture reseeding.
  await page.evaluate(() =>
    window.composerFeedback.update({ token: "inert-remount" }),
  );
  await expect(body(page)).toHaveValue("");
  expect(await stored(page)).toBeNull();
});
test("write and clear failures never claim saved or discarded text", async ({
  page,
}) => {
  await harness(page);
  await body(page).fill("Keep this");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("inert quota");
    };
    Storage.prototype.removeItem = () => {
      throw new Error("inert clear denial");
    };
  });
  await body(page).fill("Unsaved work");
  await expect(page.getByRole("status")).toContainText(
    "Could not save the draft",
  );
  expect(JSON.parse((await stored(page))!).body).toBe("Keep this");
  await body(page).fill("");
  await expect(page.getByRole("status")).toContainText(
    "Could not clear the draft",
  );
  expect(JSON.parse((await stored(page))!).body).toBe("Keep this");
});
test("reload restores only actual local saved text; clearing and reloading remains empty", async ({
  page,
}) => {
  await harness(page);
  await body(page).fill("Saved before reload");
  await page.reload();
  await expect(body(page)).toHaveValue("Saved before reload");
  await expect(page.getByRole("status")).toContainText(
    "Draft restored from this device",
  );
  await body(page).fill("");
  await expect(page.getByRole("status")).toContainText("Empty editor");
  await page.reload();
  await expect(body(page)).toHaveValue("");
  await expect(page.getByRole("status")).toContainText("Empty editor");
  expect(await stored(page)).toBeNull();
});
test("removing a confirmed attachment clears historical file feedback without another upload", async ({
  page,
}) => {
  await harness(page);
  await input(page).setInputFiles(file("one.txt"));
  await calls(page, 1);
  await settle(page, 0, true);
  await expect(outcomes(page)).toContainText("Confirmed attachment");
  await page
    .getByRole("button", { name: "Remove one.txt", exact: true })
    .click();
  await expect(outcomes(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.composerFeedback.changes())).toEqual([
    ["inert-one.txt"],
    [],
  ]);
  await calls(page, 1);
});
test("successful inert post reports failed local cleanup without claiming another post is needed", async ({
  page,
}) => {
  await harness(page);
  await body(page).fill("Post once");
  await page.evaluate(() => {
    Storage.prototype.removeItem = () => {
      throw new Error("inert denial");
    };
  });
  await page.getByRole("button", { name: "Post fixture", exact: true }).click();
  await page.evaluate(() => window.composerFeedback.submit(true));
  await expect(page.getByRole("status")).toContainText(
    "Posted successfully, but the local draft could not be cleared",
  );
  expect(await page.evaluate(() => window.composerFeedback.submissions())).toBe(
    1,
  );
  expect(JSON.parse((await stored(page))!).body).toBe("Post once");
});
for (const boundary of ["owner", "board", "actor", "token"] as const)
  test(`${boundary} ABA fences draft feedback and stale upload outcomes`, async ({
    page,
  }) => {
    await harness(page);
    await body(page).fill("Owner A work");
    await input(page).setInputFiles(file("private-a.txt"));
    await calls(page, 1);
    await page.evaluate(
      (boundary) => window.composerFeedback.update({ [boundary]: "context-b" }),
      boundary,
    );
    await expect(outcomes(page)).toHaveCount(0);
    await page.evaluate(
      ({ boundary, value }) =>
        window.composerFeedback.update({ [boundary]: value }),
      {
        boundary,
        value: {
          owner: "owner-a",
          board: "board-a",
          actor: "human",
          token: "inert-a",
        }[boundary],
      },
    );
    await settle(page, 0, true);
    await expect(outcomes(page)).toHaveCount(0);
    await expect(body(page)).toHaveValue("Owner A work");
    expect(
      await page.evaluate(() => window.composerFeedback.changes()),
    ).toEqual([]);
  });
test("unknown schema remains byte-protected and empty current editor does not claim discard", async ({
  page,
}) => {
  const raw = JSON.stringify({
    version: 90,
    body: "Future private bytes",
    unknown: [1, 2],
  });
  await harness(page, "forum", raw);
  await body(page).fill("Current independent work");
  await body(page).fill("");
  await expect(
    page.getByText("Saved draft protected; current edits are not saved", {
      exact: true,
    }),
  ).toBeVisible();
  expect(await stored(page)).toBe(raw);
});
