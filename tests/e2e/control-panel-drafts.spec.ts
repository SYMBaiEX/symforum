import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
let script: string;
test.beforeAll(() => {
  script = execFileSync("bun", ["-e", `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/control-panel-drafts.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"control-panel-isolation",setup(build){build.onResolve({filter:/^convex\\/react$|^convex-helpers\\/react\\/cache\\/hooks$|^next\\/navigation$|forum-runtime-context$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/control-panel-drafts-state.ts"}));build.onResolve({filter:/forum-primitives$|forum-agent-access$|app-error-surface$|^next\\/link$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/control-panel-drafts-leaves.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));process.stdout.write(await result.outputs[0].text());`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
});
async function harness(page: Page) {
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:43229" && url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script>' });
    if (url.origin === "http://127.0.0.1:43229" && url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: script });
    unexpected.push(url.pathname);
    return route.abort();
  });
  await page.goto("http://127.0.0.1:43229/");
  await expect(page.getByRole("textbox", { name: /^Bio/ })).toHaveValue("member-a biography");
  return () => { expect(errors).toEqual([]); expect(unexpected).toEqual([]); };
}
const bio = (page: Page) => page.getByRole("textbox", { name: /^Bio/ });
const replies = (page: Page) => page.getByRole("checkbox", { name: /^In-app replies/ });

test("clean profile and preferences follow server updates", async ({ page }) => {
  const check = await harness(page);
  await page.evaluate(() => { window.controlPanelDraftsFixture.profile({ bio: "Remote profile" }); window.controlPanelDraftsFixture.preferences({ inAppReplies: false }); });
  await expect(bio(page)).toHaveValue("Remote profile");
  await expect(replies(page)).not.toBeChecked();
  expect(await page.evaluate(() => window.controlPanelDraftsFixture.calls())).toEqual([]);
  check();
});
test("same-account refresh preserves dirty profile and notification drafts", async ({ page }) => {
  const check = await harness(page);
  await bio(page).fill("Local profile");
  await replies(page).uncheck();
  await page.evaluate(() => { window.controlPanelDraftsFixture.profile({ bio: "Remote profile", postCount: 1 }); window.controlPanelDraftsFixture.preferences({ inAppReplies: true, updatedAt: 2 }); });
  await expect(bio(page)).toHaveValue("Local profile");
  await expect(replies(page)).not.toBeChecked();
  check();
});
test("profile save acknowledgement does not mark later edits saved", async ({ page }) => {
  const check = await harness(page);
  await bio(page).fill("Submitted profile");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await bio(page).fill("Newer profile");
  await page.evaluate(() => { window.controlPanelDraftsFixture.profile({ bio: "Submitted profile" }); window.controlPanelDraftsFixture.settle(0); });
  await expect(page.getByRole("button", { name: "Save profile", exact: true })).toBeEnabled();
  await expect(bio(page)).toHaveValue("Newer profile");
  await expect(page.getByText("Forum profile saved", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.evaluate(() => window.controlPanelDraftsFixture.settle(1));
  await expect(page.getByText("Forum profile saved", { exact: true })).toBeVisible();
  await page.evaluate(() => window.controlPanelDraftsFixture.profile({ bio: "Later clean update" }));
  await expect(bio(page)).toHaveValue("Later clean update");
  expect(await page.evaluate(() => window.controlPanelDraftsFixture.calls().map((call) => call.kind))).toEqual(["profile", "profile"]);
  check();
});
test("notification acknowledgement preserves edits made while saving", async ({ page }) => {
  const check = await harness(page);
  await replies(page).uncheck();
  await page.getByRole("button", { name: "Save notifications", exact: true }).click();
  await replies(page).check();
  await page.evaluate(() => { window.controlPanelDraftsFixture.preferences({ inAppReplies: false }); window.controlPanelDraftsFixture.settle(0); });
  await expect(replies(page)).toBeChecked();
  await expect(page.getByText("Notification settings saved", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save notifications", exact: true }).click();
  await page.evaluate(() => window.controlPanelDraftsFixture.settle(1));
  await expect(page.getByText("Notification settings saved", { exact: true })).toBeVisible();
  await page.evaluate(() => window.controlPanelDraftsFixture.preferences({ inAppReplies: false }));
  await expect(replies(page)).not.toBeChecked();
  check();
});
test("account switch fences drafts, old preferences and late save completion", async ({ page }) => {
  const check = await harness(page);
  await bio(page).fill("Private member-a edit");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.evaluate(() => window.controlPanelDraftsFixture.account("member-b", true));
  await expect(bio(page)).toHaveValue("member-b biography");
  await expect(replies(page)).toBeDisabled();
  await page.evaluate(() => { window.controlPanelDraftsFixture.settle(0); window.controlPanelDraftsFixture.preferences({ userId: "member-b", inAppReplies: false }); });
  await expect(replies(page)).not.toBeChecked();
  await expect(page.getByText("Forum profile saved", { exact: true })).toHaveCount(0);
  await expect(bio(page)).toHaveValue("member-b biography");
  check();
});
test("logout clears private drafts and blocks late failure feedback", async ({ page }) => {
  const check = await harness(page);
  await bio(page).fill("Private draft");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.evaluate(() => window.controlPanelDraftsFixture.auth({ isAuthenticated: false }));
  await expect(page.getByRole("heading", { name: "Sign in required" })).toBeVisible();
  await page.evaluate(() => window.controlPanelDraftsFixture.settle(0, true));
  await expect(page.getByText("Could not save forum profile")).toHaveCount(0);
  await page.evaluate(() => window.controlPanelDraftsFixture.account("member-a"));
  await expect(bio(page)).toHaveValue("member-a biography");
  check();
});
