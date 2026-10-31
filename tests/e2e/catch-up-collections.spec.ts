import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43244";
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/catch-up-collections.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"catch-up-collection-isolation",setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|^next\\/link$|forum-primitives$|^sonner$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/catch-up-collections-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));process.stdout.write(await result.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 },
  );
});
async function harness(page: Page, query = "", app = "platform") {
  const errors: string[] = [],
    network: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/catch-up")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    network.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/catch-up?${query}`);
  await expect(page.locator("main")).toBeVisible();
  return async () => {
    expect(errors).toEqual([]);
    expect(network).toEqual([]);
    expect(
      await page.evaluate(() => window.catchUpCollections.forbidden),
    ).toEqual([]);
  };
}
const titles = ["AI builders", "Local models", "Game developers"];
const collection = (page: Page, title = "AI builders") =>
  page.getByRole("group", { name: title, exact: true });
const save = (page: Page) =>
  page.getByRole("button", { name: "Follow selected boards", exact: true });
const ops = (page: Page) =>
  page.evaluate(() => window.catchUpCollections.operations);
async function populate(page: Page) {
  await page.evaluate(() =>
    window.catchUpCollections.update({
      boards: window.catchUpCollections.allBoards,
    }),
  );
}
test("unresolved collection options show local loading feedback then existing checkboxes", async ({
  page,
}) => {
  const check = await harness(page);
  for (const title of titles)
    await expect(collection(page, title).getByRole("status")).toHaveText(
      `Loading board options for ${title}…`,
    );
  await expect(save(page)).toBeDisabled();
  await populate(page);
  for (const title of titles) {
    await expect(collection(page, title).getByRole("status")).toHaveCount(0);
    expect(
      await collection(page, title).getByRole("checkbox").count(),
    ).toBeGreaterThan(0);
  }
  expect(await ops(page)).toEqual([]);
  await check();
});
for (const unmatched of [false, true])
  test(`${unmatched ? "loaded but unmatched" : "empty loaded array"} is collection-specific, not a global no-boards/follows claim`, async ({
    page,
  }) => {
    const check = await harness(page);
    await page.evaluate(
      (value) =>
        window.catchUpCollections.update({
          boards: value ? [{ _id: "other", name: "Music", slug: "music" }] : [],
        }),
      unmatched,
    );
    for (const title of titles)
      await expect(collection(page, title).getByRole("status")).toHaveText(
        `No matching boards for ${title} in the loaded options.`,
      );
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(save(page)).toBeDisabled();
    expect(await ops(page)).toEqual([]);
    await check();
  });
test("one unmatched collection does not hide options in populated collections", async ({
  page,
}) => {
  const check = await harness(page);
  await page.evaluate(() =>
    window.catchUpCollections.update({
      boards: [window.catchUpCollections.allBoards[1]],
    }),
  );
  await expect(
    collection(page, "Local models").getByRole("checkbox", {
      name: "Local models board",
    }),
  ).toBeVisible();
  await expect(
    collection(page, "Local models").getByRole("status"),
  ).toHaveCount(0);
  await expect(collection(page).getByRole("status")).toHaveText(
    "No matching boards for AI builders in the loaded options.",
  );
  expect(await ops(page)).toEqual([]);
  await check();
});
test("existing followed and selected states survive missing options and dynamic reappearance without automatic follows", async ({
  page,
}) => {
  const check = await harness(page);
  await populate(page);
  const followed = collection(page).getByRole("checkbox", {
    name: /AI frameworks/,
  });
  await expect(followed).toBeChecked();
  await expect(followed).toBeDisabled();
  const local = collection(page, "Local models").getByRole("checkbox", {
    name: "Local models board",
  });
  await local.check();
  const general = collection(page).getByRole("checkbox", {
    name: "General discussions",
  });
  await general.check();
  await expect(
    collection(page, "Game developers").getByRole("checkbox", {
      name: "General discussions",
    }),
  ).toBeChecked();
  await page.evaluate(() =>
    window.catchUpCollections.update({ boards: undefined }),
  );
  for (const title of titles)
    await expect(collection(page, title).getByRole("status")).toContainText(
      "Loading board options",
    );
  await page.evaluate(() => window.catchUpCollections.update({ boards: [] }));
  await populate(page);
  await expect(local).toBeChecked();
  await expect(general).toBeChecked();
  await expect(followed).toBeChecked();
  await expect(followed).toBeDisabled();
  await expect(save(page)).toBeEnabled();
  expect(await ops(page)).toEqual([]);
  await check();
});
test("explicit save keeps original payload, busy state and retained selection after inert failure", async ({
  page,
}) => {
  const check = await harness(page, "admission");
  await populate(page);
  const selected = collection(page, "Local models").getByRole("checkbox", {
    name: "Local models board",
  });
  await selected.check();
  await save(page).click();
  await expect(save(page)).toBeDisabled();
  await expect(selected).toBeDisabled();
  expect(await ops(page)).toEqual([
    {
      name: "forum:setCategorySubscription",
      args: { categorySlug: "ai-models", subscribed: true },
    },
  ]);
  await page.evaluate(() => window.catchUpCollections.settle(0, false));
  await expect(save(page)).toBeEnabled();
  await expect(selected).toBeChecked();
  expect(await page.evaluate(() => window.catchUpCollections.toasts)).toEqual([
    "Could not save every board. Your choices are still here; try again.",
  ]);
  await save(page).click();
  await page.evaluate(() => window.catchUpCollections.settle(1));
  await expect(selected).not.toBeChecked();
  expect(await ops(page)).toEqual([
    {
      name: "forum:setCategorySubscription",
      args: { categorySlug: "ai-models", subscribed: true },
    },
    {
      name: "forum:setCategorySubscription",
      args: { categorySlug: "ai-models", subscribed: true },
    },
    {
      name: "forum:updateMyForumExperience",
      args: { onboardingCompleted: true },
    },
  ]);
  await check();
});
for (const mode of ["guest", "authloading"])
  test(`${mode} retains original boundary and private query skips`, async ({
    page,
  }) => {
    const check = await harness(page, mode);
    await expect(page.getByRole("group")).toHaveCount(0);
    if (mode === "guest")
      await expect(
        page.getByRole("link", { name: "Sign in", exact: true }),
      ).toBeVisible();
    else
      await expect(page.getByRole("status")).toHaveText("Loading your forum…");
    expect(
      await page.evaluate(() =>
        window.catchUpCollections.queries.map((query) => query.name),
      ),
    ).toEqual(["forum:listCategoryOptions"]);
    expect(await ops(page)).toEqual([]);
    await check();
  });
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} ${width}px fieldsets/loading/content/checkbox targets fit and remain keyboard usable`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const check = await harness(page, "", app);
      for (const title of titles) {
        const group = collection(page, title);
        const box = await group.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        await expect(group.getByRole("status")).toContainText(title);
      }
      await populate(page);
      const checkbox = collection(page, "Local models").getByRole("checkbox", {
        name: "Local models board",
      });
      await checkbox.focus();
      await page.keyboard.press("Space");
      await expect(checkbox).toBeChecked();
      const label = collection(page, "Local models").locator("label");
      expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const longName =
        "Local models board · On-device inference, multilingual research, community experiments and practical deployment notes for independent builders";
      await page.evaluate(
        (name) =>
          window.catchUpCollections.update({
            boards: window.catchUpCollections.allBoards.map((board) =>
              board.slug === "ai-models" ? { ...board, name } : board,
            ),
          }),
        longName,
      );
      await expect(
        collection(page, "Local models").getByRole("checkbox", {
          name: longName,
        }),
      ).toBeChecked();
      const labelBounds = (await label.boundingBox())!;
      expect(labelBounds.x).toBeGreaterThanOrEqual(0);
      expect(labelBounds.x + labelBounds.width).toBeLessThanOrEqual(width);
      expect(
        await label.evaluate((node) => node.scrollWidth),
      ).toBeLessThanOrEqual(await label.evaluate((node) => node.clientWidth));
      for (const title of titles) {
        const group = collection(page, title);
        expect(
          await group.evaluate((node) => node.scrollWidth),
        ).toBeLessThanOrEqual(await group.evaluate((node) => node.clientWidth));
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      expect(await ops(page)).toEqual([]);
      await check();
    });
