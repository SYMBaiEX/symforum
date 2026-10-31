import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";

let script: string, css: string, forumCss: string;
test.beforeAll(() => {
  css =
    FORUM_SHARED_THEME_CSS +
    readFileSync("styles/forum-shared.css", "utf8") +
    execFileSync(
      "bun",
      [
        "-e",
        `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("apps/platform/app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
  forumCss =
    FORUM_SHARED_THEME_CSS +
    readFileSync("styles/forum-shared.css", "utf8") +
    execFileSync(
      "bun",
      [
        "-e",
        `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("apps/forum/app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/control-panel-feedback.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"control-panel-feedback-isolation",setup(build){build.onResolve({filter:/^convex\\/react$|^convex-helpers\\/react\\/cache\\/hooks$|^next\\/navigation$|forum-runtime-context$|forum-primitives$|forum-agent-access$|app-error-surface$|^next\\/link$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/control-panel-feedback-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));process.stdout.write(await result.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
});
async function harness(page: Page, standaloneForum = false) {
  const errors: string[] = [],
    unexpected: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:43239" && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${standaloneForum ? forumCss : css}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (
      url.origin === "http://127.0.0.1:43239" &&
      url.pathname === "/fixture.js"
    )
      return route.fulfill({ contentType: "text/javascript", body: script });
    unexpected.push(url.href);
    return route.abort();
  });
  await page.goto("http://127.0.0.1:43239/");
  await page.getByRole("link", { name: /^Buddies \/ ignore/ }).click();
  await expect(username(page)).toBeVisible();
  return () => {
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  };
}
const username = (page: Page) =>
  page.getByRole("textbox", { name: "Username", exact: true });
const calls = (page: Page) =>
  page.evaluate(() => window.controlPanelFeedback.calls());

test("signature placeholder contains a real line break", async ({ page }) => {
  const check = await harness(page);
  await page.getByRole("link", { name: /^Profile member-a/ }).click();
  const placeholder = await page
    .getByRole("textbox", { name: /^Signature/ })
    .getAttribute("placeholder");
  expect(placeholder).toContain("[b]Build notes[/b]\nhttps://");
  expect(placeholder).not.toContain("\\n");
  check();
});
test("empty username is announced and associated without any mutation", async ({
  page,
}) => {
  const check = await harness(page);
  await page.getByRole("button", { name: "Add buddy", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Add a username first.");
  await expect(username(page)).toHaveAttribute("aria-invalid", "true");
  await expect(username(page)).toHaveAccessibleDescription(
    "Add a username first.",
  );
  expect(await calls(page)).toEqual([]);
  check();
});
for (const button of ["Add buddy", "Ignore"])
  test(`${button} failure preserves username and exposes a stable associated alert`, async ({
    page,
  }) => {
    const check = await harness(page);
    await username(page).fill("  target-member  ");
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Add buddy", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Ignore", exact: true }),
    ).toBeDisabled();
    expect(await calls(page)).toEqual([
      {
        owner: "member-a",
        payload: {
          username: "target-member",
          kind: button === "Ignore" ? "ignore" : "buddy",
          enabled: true,
        },
      },
    ]);
    await page.evaluate(() => window.controlPanelFeedback.settle(0, true));
    await expect(page.getByRole("alert")).toContainText(
      "Fixture member-list failure",
    );
    await expect(username(page)).toHaveValue("  target-member  ");
    await expect(username(page)).toHaveAttribute("aria-invalid", "true");
    const errorId = await page.getByRole("alert").getAttribute("id");
    expect(errorId).toBeTruthy();
    await expect(username(page)).toHaveAttribute("aria-describedby", errorId!);
    await expect(username(page)).toHaveAccessibleDescription(
      /Fixture member-list failure/,
    );
    await username(page).fill("corrected-member");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(username(page)).not.toHaveAttribute("aria-invalid", "true");
    await page.getByRole("button", { name: button, exact: true }).click();
    await page.evaluate(() => window.controlPanelFeedback.settle(1, true));
    await expect(page.getByRole("alert")).toHaveAttribute("id", errorId!);
    check();
  });
test("failed remove announces the row target but does not invalidate add username", async ({
  page,
}) => {
  const check = await harness(page);
  await username(page).fill("unrelated-member");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Removing...", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => window.controlPanelFeedback.settle(0, true));
  await expect(page.getByRole("alert")).toContainText("existing-buddy");
  await expect(username(page)).toHaveValue("unrelated-member");
  await expect(username(page)).not.toHaveAttribute("aria-invalid", "true");
  await expect(username(page)).not.toHaveAttribute("aria-describedby");
  expect(await calls(page)).toEqual([
    {
      owner: "member-a",
      payload: { username: "existing-buddy", kind: "buddy", enabled: false },
    },
  ]);
  check();
});
test("editing username during deferred add does not attribute old failure to new input", async ({
  page,
}) => {
  const check = await harness(page);
  await username(page).fill("first-member");
  await page.getByRole("button", { name: "Add buddy", exact: true }).click();
  await username(page).fill("next-member");
  await page.evaluate(() => window.controlPanelFeedback.settle(0, true));
  await expect(page.getByRole("alert")).toContainText("first-member");
  await expect(username(page)).toHaveValue("next-member");
  await expect(username(page)).not.toHaveAttribute("aria-invalid", "true");
  await expect(username(page)).not.toHaveAttribute("aria-describedby");
  check();
});
test("keyboard add success keeps existing payload and clears username", async ({
  page,
}) => {
  const check = await harness(page);
  await username(page).fill("keyboard-member");
  await username(page).press("Tab");
  await expect(
    page.getByRole("button", { name: "Add buddy", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Add buddy", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => window.controlPanelFeedback.settle(0));
  await expect(username(page)).toHaveValue("");
  await expect(
    page.getByText("keyboard-member added to buddies.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await calls(page)).length).toBe(1);
  check();
});
test("account switch and logout fence deferred relationship failures", async ({
  page,
}) => {
  const check = await harness(page);
  await username(page).fill("private-a-target");
  await page.getByRole("button", { name: "Add buddy", exact: true }).click();
  await page.evaluate(() => window.controlPanelFeedback.account("member-b"));
  await page.getByRole("link", { name: /^Buddies \/ ignore/ }).click();
  await expect(username(page)).toHaveValue("");
  await page.evaluate(() => window.controlPanelFeedback.settle(0, true));
  await expect(page.getByRole("alert")).toHaveCount(0);
  await username(page).fill("private-b-target");
  await page.getByRole("button", { name: "Ignore", exact: true }).click();
  await page.evaluate(() =>
    window.controlPanelFeedback.update({ isAuthenticated: false }),
  );
  await page.evaluate(() => window.controlPanelFeedback.settle(1, true));
  await expect(username(page)).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  check();
});
test("session loading hides account feedback and drops late failure on remount", async ({
  page,
}) => {
  const check = await harness(page);
  await username(page).fill("private-target");
  await page.getByRole("button", { name: "Add buddy", exact: true }).click();
  await page.evaluate(() =>
    window.controlPanelFeedback.update({ isLoading: true }),
  );
  await expect(page.getByRole("status")).toHaveText("Checking forum session");
  await expect(username(page)).toHaveCount(0);
  await page.evaluate(() => window.controlPanelFeedback.settle(0, true));
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() =>
    window.controlPanelFeedback.update({ isLoading: false }),
  );
  await page.getByRole("link", { name: /^Buddies \/ ignore/ }).click();
  await expect(username(page)).toHaveValue("");
  await expect(page.getByRole("alert")).toHaveCount(0);
  check();
});
test("loading relationships and untrusted permissions keep existing controls unavailable", async ({
  page,
}) => {
  const check = await harness(page);
  await page.evaluate(() =>
    window.controlPanelFeedback.update({ relationshipsLoaded: false }),
  );
  await expect(
    page.getByRole("button", { name: "Add buddy", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Ignore", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => window.controlPanelFeedback.trust(false));
  await expect(
    page.getByRole("heading", { name: "Locked", exact: true }),
  ).toBeVisible();
  await expect(username(page)).toHaveCount(0);
  expect(await calls(page)).toEqual([]);
  check();
});
for (const width of [320, 390])
  test(`forum theme feedback fits ${width}px with reachable controls`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const check = await harness(page);
    await username(page).fill("target-member");
    await page.getByRole("button", { name: "Ignore", exact: true }).click();
    await page.evaluate(() => window.controlPanelFeedback.settle(0, true));
    await expect(page.getByRole("alert")).toBeVisible();
    const dimensions = await page.locator("#ucp-lists").evaluate((node) => ({
      width: node.clientWidth,
      scroll: node.scrollWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
    for (const name of ["Add buddy", "Ignore", "Remove"]) {
      const box = await page
        .getByRole("button", { name, exact: true })
        .boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    check();
  });

for (const surface of ["platform", "standalone forum"])
  test(`long unbroken failed username wraps without document overflow at 320px (${surface})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    const check = await harness(page, surface === "standalone forum");
    const attemptedUsername = "unbroken".repeat(25);
    await username(page).fill(attemptedUsername);
    await page.getByRole("button", { name: "Add buddy", exact: true }).click();
    expect(await calls(page)).toEqual([
      {
        owner: "member-a",
        payload: { username: attemptedUsername, kind: "buddy", enabled: true },
      },
    ]);
    await page.evaluate(() => window.controlPanelFeedback.settle(0, true));
    const message = `Could not add ${attemptedUsername}. Fixture member-list failure`;
    await expect(page.getByRole("alert")).toHaveText(message);
    await expect(username(page)).toHaveValue(attemptedUsername);
    await expect(username(page)).toHaveAttribute("aria-invalid", "true");
    await expect(username(page)).toHaveAccessibleDescription(message);
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
    for (const element of [
      page.locator("#ucp-lists"),
      page.getByRole("alert"),
    ]) {
      const bounds = await element.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
        dimensions.viewport,
      );
    }
    const errorDimensions = await page.getByRole("alert").evaluate((node) => ({
      width: node.clientWidth,
      scrollWidth: node.scrollWidth,
      height: node.clientHeight,
      scrollHeight: node.scrollHeight,
    }));
    expect(errorDimensions.scrollWidth).toBeLessThanOrEqual(
      errorDimensions.width,
    );
    expect(errorDimensions.scrollHeight).toBeLessThanOrEqual(
      errorDimensions.height,
    );
    check();
  });
