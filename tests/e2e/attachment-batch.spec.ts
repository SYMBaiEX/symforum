import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
let script: string;
test.beforeAll(() => {
  // Optional local red check against the immutable pre-fix source. Normalize
  // only the input's test label so the failure measures partial receipt loss.
  const baselineLoader = process.env.FORUM_ATTACHMENT_BASELINE === "1"
    ? `build.onLoad({filter:/forum-compose\\.tsx$/},()=>({contents:Bun.spawnSync(['git','show','5b60b23b:components/forum/forum-compose.tsx']).stdout.toString().replace('id={inputId}','id={inputId} aria-label="Choose forum attachment files"'),loader:'tsx',resolveDir:process.cwd()+'/components/forum'}));`
    : "";
  script = execFileSync("bun", ["-e", `const result=await Bun.build({entrypoints:['tests/e2e/fixtures/attachment-batch.tsx'],target:'browser',format:'iife',define:{'process.env':JSON.stringify({NODE_ENV:'production',NEXT_PUBLIC_CONVEX_SITE_URL:'http://127.0.0.1:43231',NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file('tests/fixtures/installation.symbaiex.json').text()})},plugins:[{name:'isolated-attachments',setup(build){${baselineLoader}build.onResolve({filter:/^@symbaiex\\/auth\\/token$|forum-webmcp$/},()=>({path:process.cwd()+'/tests/e2e/fixtures/attachment-batch-state.ts'}));}}]});if(!result.success)throw new Error(JSON.stringify(result.logs));process.stdout.write(await result.outputs[0].text());`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
});
async function harness(page: Page) {
  const unexpected: string[] = [], errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:43231" && url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script>' });
    if (url.origin === "http://127.0.0.1:43231" && url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: script });
    unexpected.push(url.pathname); return route.abort();
  });
  await page.goto("http://127.0.0.1:43231/");
  await expect(page.getByRole("button", { name: "Add files", exact: true })).toBeVisible();
  return () => { expect(unexpected).toEqual([]); expect(errors).toEqual([]); };
}
const file = (name: string, size = 5, mimeType = "text/plain") => ({ name, mimeType, buffer: Buffer.alloc(size, "a") });
const input = (page: Page) => page.getByLabel("Choose forum attachment files");
async function count(page: Page, expected: number) { await expect.poll(() => page.evaluate(() => window.attachmentBatchFixture.calls().length)).toBe(expected); }
async function settle(page: Page, index: number, ok: boolean, id: string) { await page.evaluate(({ index, ok, id }) => window.attachmentBatchFixture.settle(index, ok, [id]), { index, ok, id }); }

test("two confirmed uploads survive a third failure; retry is explicit and excludes successes", async ({ page }) => {
  const check = await harness(page);
  await input(page).setInputFiles([file("one.txt"), file("two.txt"), file("three.txt")]);
  await count(page, 1); await settle(page, 0, true, "one");
  await count(page, 2);
  await settle(page, 1, true, "two"); await count(page, 3); await settle(page, 2, false, "three");
  await expect(page.getByText("one.txt", { exact: true })).toBeVisible();
  await expect(page.getByText("two.txt", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Could not confirm three.txt");
  expect(await page.evaluate(() => window.attachmentBatchFixture.changes())).toEqual([["one"], ["one", "two"]]);
  await expect(page.getByText("PRIVATE_SERVER_MARKER")).toHaveCount(0);
  await count(page, 3);
  await input(page).setInputFiles([file("three.txt")]); await count(page, 4); await settle(page, 3, true, "three");
  await expect(page.getByText("three.txt", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.attachmentBatchFixture.calls().map((call) => call.names))).toEqual([["one.txt"], ["two.txt"], ["three.txt"], ["three.txt"]]);
  expect(await page.evaluate(() => window.attachmentBatchFixture.changes().at(-1))).toEqual(["one", "two", "three"]);
  check();
});
test("a clean batch retains all confirmed files incrementally", async ({ page }) => {
  const check = await harness(page);
  await input(page).setInputFiles([file("one.txt"), file("two.txt")]);
  await count(page, 1); await settle(page, 0, true, "one"); await count(page, 2); await settle(page, 1, true, "two");
  await expect(page.getByRole("button", { name: "Add files", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.attachmentBatchFixture.changes())).toEqual([["one"], ["one", "two"]]);
  await expect(page.getByRole("alert")).toHaveCount(0); check();
});
test("stop keeps known files and ignores a late unconfirmed response without starting the remainder", async ({ page }) => {
  const check = await harness(page);
  await input(page).setInputFiles([file("one.txt"), file("two.txt"), file("three.txt")]);
  await count(page, 1); await settle(page, 0, true, "one"); await count(page, 2);
  await page.getByRole("button", { name: "Stop waiting", exact: true }).click();
  expect(await page.evaluate(() => window.attachmentBatchFixture.calls()[1].aborted)).toBe(true);
  await settle(page, 1, true, "late");
  await expect(page.getByRole("alert")).toContainText("Stopped waiting");
  await expect(page.getByRole("alert")).toContainText("An in-flight upload may still finish outside this draft");
  await expect(page.getByText("Not attached: two.txt, three.txt")).toBeVisible();
  expect(await page.evaluate(() => window.attachmentBatchFixture.changes())).toEqual([["one"]]);
  await count(page, 2); check();
});
for (const boundary of ["token", "acting-profile"] as const) {
test(`${boundary} changes fence old responses`, async ({ page }) => {
  const check = await harness(page);
  await input(page).setInputFiles([file("private.txt")]); await count(page, 1);
  await page.evaluate((boundary) => window.attachmentBatchFixture.update(boundary === "token" ? { token: "fixture-token-b", attachments: [] } : { actor: "member-b", attachments: [] }), boundary);
  await expect(page.getByRole("button", { name: "Add files", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.attachmentBatchFixture.calls()[0].aborted)).toBe(true);
  await settle(page, 0, true, "old-private");
  expect(await page.evaluate(() => window.attachmentBatchFixture.changes())).toEqual([]);
  await expect(page.getByText("private.txt", { exact: true })).toHaveCount(0); check();
});
}
test("external attachment replacement fences a response from the old selection", async ({ page }) => {
  const check = await harness(page);
  await input(page).setInputFiles([file("pending.txt")]); await count(page, 1);
  await page.evaluate(() => window.attachmentBatchFixture.update({ attachments: [{ storageId: "new-context", filename: "retained.txt", contentType: "text/plain", size: 5 }] }));
  await expect(page.getByText("retained.txt", { exact: true })).toBeVisible();
  await settle(page, 0, true, "old-selection");
  expect(await page.evaluate(() => window.attachmentBatchFixture.changes())).toEqual([]);
  expect(await page.evaluate(() => window.attachmentBatchFixture.calls()[0].aborted)).toBe(true);
  await expect(page.getByText("pending.txt", { exact: true })).toHaveCount(0); check();
});
test("route changes never attach a late receipt to the next draft", async ({ page }) => {
  const check = await harness(page);
  await input(page).setInputFiles([file("old.txt"), file("next.txt")]); await count(page, 1);
  await page.evaluate(() => history.pushState({}, "", "/another-thread"));
  await settle(page, 0, true, "old-thread");
  await expect(page.getByRole("button", { name: "Add files", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.attachmentBatchFixture.changes())).toEqual([]);
  await count(page, 1); check();
});
test("unmount aborts and cannot append a late result after remount", async ({ page }) => {
  const check = await harness(page);
  await input(page).setInputFiles([file("old.txt")]); await count(page, 1);
  await page.evaluate(() => window.attachmentBatchFixture.update({ mounted: false }));
  await expect(input(page)).toHaveCount(0);
  await settle(page, 0, true, "unmounted");
  await page.evaluate(() => window.attachmentBatchFixture.update({ mounted: true }));
  await expect(page.getByRole("button", { name: "Add files", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.attachmentBatchFixture.changes())).toEqual([]);
  expect(await page.evaluate(() => window.attachmentBatchFixture.calls()[0].aborted)).toBe(true); check();
});
test("batch count, reserved slots, MIME and size limits reject before transport", async ({ page }) => {
  const check = await harness(page);
  await input(page).setInputFiles(Array.from({ length: 6 }, (_, index) => file(`${index}.txt`)));
  await expect(page.getByRole("alert")).toContainText("Attach up to 5 files");
  await input(page).setInputFiles(file("bad.svg", 5, "image/svg+xml"));
  await expect(page.getByRole("alert")).toContainText("not an allowed forum attachment");
  await input(page).setInputFiles(file("large.txt", 6 * 1024 * 1024));
  await expect(page.getByRole("alert")).toContainText("not an allowed forum attachment");
  await page.evaluate(() => window.attachmentBatchFixture.update({ reserved: 4 }));
  await input(page).setInputFiles([file("one.txt"), file("two.txt")]);
  await expect(page.getByRole("alert")).toContainText("Attach up to 5 files");
  await count(page, 0); check();
});
test("plugin keeps its owner-approved batch boundary instead of per-file fanout", async ({ page }) => {
  const check = await harness(page);
  await page.evaluate(() => window.attachmentBatchFixture.update({ plugin: true }));
  await input(page).setInputFiles([file("one.txt"), file("two.txt")]); await count(page, 1);
  expect(await page.evaluate(() => window.attachmentBatchFixture.calls()[0].names)).toEqual(["one.txt", "two.txt"]);
  await page.evaluate(() => window.attachmentBatchFixture.settle(0, true, ["one", "two"]));
  await expect(page.getByText("two.txt", { exact: true })).toBeVisible();
  await count(page, 1); check();
});
test("stopping a pending plugin batch does not claim to cancel the remote job or replay it", async ({ page }) => {
  const check = await harness(page);
  await page.evaluate(() => window.attachmentBatchFixture.update({ plugin: true, attachments: [{ storageId: "known", filename: "known.txt", contentType: "text/plain", size: 5 }] }));
  await input(page).setInputFiles([file("one.txt"), file("two.txt")]); await count(page, 1);
  await page.getByRole("button", { name: "Stop waiting", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Stopped waiting. An in-flight upload may still finish outside this draft");
  await expect(page.getByRole("alert")).toContainText("Check Agent access and owner approval before choosing the files again");
  await expect(page.getByRole("alert")).toContainText("no retry runs automatically");
  await page.evaluate(() => window.attachmentBatchFixture.settle(0, true, ["late-one", "late-two"]));
  await expect(page.getByText("known.txt", { exact: true })).toBeVisible();
  await expect(page.getByText("one.txt", { exact: true })).toHaveCount(0);
  await expect(page.getByText("two.txt", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.attachmentBatchFixture.changes())).toEqual([]);
  expect(await page.evaluate(() => window.attachmentBatchFixture.calls().map((call) => call.names))).toEqual([["one.txt", "two.txt"]]);
  await count(page, 1); check();
});
