import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const origin = "http://127.0.0.1:43234";
const key = "draft:owner-a:thread-one:human";
const unknown = JSON.stringify({
  version: 77,
  body: "Invented future private draft",
  title: "Future title",
  data: { opaque: "keep" },
});
let script: string;
test.beforeAll(() => {
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/draft-schema.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production"})},plugins:[{name:"draft-isolation",setup(build){build.onResolve({filter:/forum-webmcp$|^@symbaiex\\/auth\\/token$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/draft-schema-state.ts"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));process.stdout.write(await result.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  raw: string | null = unknown,
  scenario = "",
) {
  const errors: string[] = [],
    requests: string[] = [];
  await page.addInitScript(
    ({ key, raw }) => {
      if (raw !== null && localStorage.getItem(key) === null)
        localStorage.setItem(key, raw);
    },
    { key, raw },
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: '<meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script>',
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    requests.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/?${scenario}`);
  await expect(
    page.getByRole("textbox", { name: "Draft body", exact: true }),
  ).toBeVisible();
  return () => {
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
  };
}
async function stored(page: Page, storageKey = key) {
  return page.evaluate((key) => localStorage.getItem(key), storageKey);
}
const body = (page: Page) =>
  page.getByRole("textbox", { name: "Draft body", exact: true });
test("unknown draft survives hydration, typing, templates, remount and reload byte-for-byte", async ({
  page,
}) => {
  const check = await harness(page, unknown, "template");
  expect(await stored(page)).toBe(unknown);
  await body(page).fill("Current editor work");
  expect(await stored(page)).toBe(unknown);
  await page
    .getByRole("button", { name: "Remount editor", exact: true })
    .click();
  expect(await stored(page)).toBe(unknown);
  await page.reload();
  expect(await stored(page)).toBe(unknown);
  await expect(
    page.getByRole("heading", { name: "Saved draft protected", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Invented future private draft", { exact: true }),
  ).toHaveCount(0);
  check();
});

test("replacement requires informed consent and saves current editor text with schema1", async ({
  page,
}) => {
  const check = await harness(page);
  await body(page).fill("Replacement editor text");
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Replacement title");
  const replace = page.getByRole("button", {
    name: "Replace saved draft with current text",
    exact: true,
  });
  await expect(replace).toBeDisabled();
  expect(await stored(page)).toBe(unknown);
  await page
    .getByRole("checkbox", {
      name: "I understand replacement overwrites the saved copy.",
      exact: true,
    })
    .check();
  await replace.click();
  await expect(
    page.getByRole("heading", { name: "Saved draft protected", exact: true }),
  ).toHaveCount(0);
  expect(JSON.parse((await stored(page))!)).toMatchObject({
    version: 1,
    body: "Replacement editor text",
    title: "Replacement title",
    data: { kind: "discussion" },
  });
  await body(page).fill("Subsequent edit");
  expect(JSON.parse((await stored(page))!).body).toBe("Subsequent edit");
  check();
});
test("explicit backup downloads only the exact protected local bytes with a neutral filename", async ({
  page,
}) => {
  const check = await harness(page);
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download saved draft", exact: true })
    .click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("forum-draft-backup.json");
  expect(readFileSync((await download.path())!, "utf8")).toBe(unknown);
  expect(await stored(page)).toBe(unknown);
  check();
});
test("changed stored bytes revoke replacement consent and cannot be downloaded as the old snapshot", async ({
  page,
}) => {
  const check = await harness(page);
  await body(page).fill("Current editor text");
  const confirmation = page.getByRole("checkbox", {
    name: "I understand replacement overwrites the saved copy.",
    exact: true,
  });
  await confirmation.check();
  const newer = JSON.stringify({
    version: 78,
    body: "Invented newer saved copy",
  });
  await page.evaluate(({ key, newer }) => localStorage.setItem(key, newer), {
    key,
    newer,
  });
  await page
    .getByRole("button", {
      name: "Replace saved draft with current text",
      exact: true,
    })
    .click();
  await expect(confirmation).not.toBeChecked();
  await expect(page.getByRole("status")).toContainText("Nothing was replaced");
  expect(await stored(page)).toBe(newer);
  check();
});
test("a successful fake post receipt cannot remove a protected saved draft", async ({
  page,
}) => {
  const check = await harness(page);
  await body(page).fill("Independent editor text");
  await page.getByRole("button", { name: "Post fixture", exact: true }).click();
  await page.evaluate(() => window.draftSchemaFinishSubmit(true));
  expect(await stored(page)).toBe(unknown);
  expect(await page.evaluate(() => window.draftSchemaSubmitCount())).toBe(1);
  check();
});

test("backup rechecks exact stored bytes instead of downloading an outdated snapshot", async ({
  page,
}) => {
  const check = await harness(page);
  let downloads = 0;
  page.on("download", () => {
    downloads++;
  });
  const newer = "{invented malformed newer bytes";
  await page.evaluate(({ key, newer }) => localStorage.setItem(key, newer), {
    key,
    newer,
  });
  await page
    .getByRole("button", { name: "Download saved draft", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Nothing was replaced");
  expect(downloads).toBe(0);
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download saved draft", exact: true })
    .click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("forum-draft-backup.txt");
  expect(readFileSync((await download.path())!, "utf8")).toBe(newer);
  expect(await stored(page)).toBe(newer);
  check();
});

test("known schema keeps existing successful-receipt cleanup", async ({
  page,
}) => {
  const check = await harness(
    page,
    JSON.stringify({ version: 1, body: "Known draft" }),
  );
  await expect(body(page)).toHaveValue("Known draft");
  await page.getByRole("button", { name: "Post fixture", exact: true }).click();
  await page.evaluate(() => window.draftSchemaFinishSubmit(true));
  expect(await stored(page)).toBeNull();
  check();
});
for (const raw of [
  "{broken",
  "null",
  "[]",
  JSON.stringify({ version: 1, body: 4 }),
  JSON.stringify({ version: 1, body: "old", data: ["not-a-record"] }),
]) {
  test(`malformed local drafts remain unchanged until deliberate replacement: ${raw.slice(0, 35)}`, async ({
    page,
  }) => {
    const check = await harness(page, raw);
    await expect(
      page.getByRole("heading", { name: "Saved draft protected", exact: true }),
    ).toBeVisible();
    await body(page).fill("New local editing");
    expect(await stored(page)).toBe(raw);
    await page
      .getByRole("button", { name: "Remount editor", exact: true })
      .click();
    expect(await stored(page)).toBe(raw);
    check();
  });
}
for (const version of [undefined, 1])
  test(`supported draft restoration and autosave remain unchanged: ${version ?? "legacy"}`, async ({
    page,
  }) => {
    const raw = JSON.stringify({
      ...(version ? { version } : {}),
      body: "Known saved body",
      title: "Known title",
      data: { kind: "research" },
    });
    const check = await harness(page, raw);
    await expect(body(page)).toHaveValue("Known saved body");
    await expect(
      page.getByRole("textbox", { name: "Title", exact: true }),
    ).toHaveValue("Known title");
    await expect(
      page.getByRole("textbox", { name: "Topic kind", exact: true }),
    ).toHaveValue("research");
    await expect(
      page.getByRole("heading", { name: "Saved draft protected", exact: true }),
    ).toHaveCount(0);
    await body(page).fill("Known edited body");
    expect(JSON.parse((await stored(page))!).body).toBe("Known edited body");
    check();
  });
test("owner route acting-profile and token remount fences keep backups isolated", async ({
  page,
}) => {
  const check = await harness(page);
  const otherKey = "draft:owner-b:thread-two:agent-b";
  const other = JSON.stringify({
    version: 88,
    body: "Invented other owner's saved copy",
  });
  await page.evaluate(
    ({ otherKey, other }) => {
      localStorage.setItem(otherKey, other);
      window.draftSchemaScope({
        owner: "owner-b",
        route: "thread-two",
        actor: "agent-b",
        token: "inert-b",
      });
    },
    { otherKey, other },
  );
  await expect(body(page)).toHaveValue("");
  await expect(
    page.getByRole("heading", { name: "Saved draft protected", exact: true }),
  ).toBeVisible();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download saved draft", exact: true })
    .click();
  expect(readFileSync((await (await pending).path())!, "utf8")).toBe(other);
  expect(await stored(page)).toBe(unknown);
  expect(await stored(page, otherKey)).toBe(other);
  check();
});

for (const initial of [
  null,
  JSON.stringify({ version: 1, body: "Known initial draft" }),
])
  test(`later unsupported schema is protected before typing autosave (${initial ? "known" : "blank"} hydration)`, async ({
    page,
  }) => {
    const check = await harness(page, initial);
    if (initial) await expect(body(page)).toHaveValue("Known initial draft");
    await page.evaluate(
      ({ key, unknown }) => localStorage.setItem(key, unknown),
      { key, unknown },
    );
    await body(page).fill("Edited text after external update");
    expect(await stored(page)).toBe(unknown);
    await expect(
      page.getByRole("heading", { name: "Saved draft protected", exact: true }),
    ).toBeVisible();
    check();
  });

test("later unsupported schema is protected before empty-editor autosave removal", async ({
  page,
}) => {
  const check = await harness(
    page,
    JSON.stringify({ version: 1, body: "Known initial draft" }),
  );
  await expect(body(page)).toHaveValue("Known initial draft");
  await page.evaluate(
    ({ key, unknown }) => localStorage.setItem(key, unknown),
    { key, unknown },
  );
  await body(page).fill("");
  expect(await stored(page)).toBe(unknown);
  await expect(
    page.getByRole("heading", { name: "Saved draft protected", exact: true }),
  ).toBeVisible();
  check();
});

test("later unsupported schema is protected before pending fake-post success cleanup", async ({
  page,
}) => {
  const check = await harness(
    page,
    JSON.stringify({ version: 1, body: "Known initial draft" }),
  );
  await expect(body(page)).toHaveValue("Known initial draft");
  await page.getByRole("button", { name: "Post fixture", exact: true }).click();
  await page.evaluate(
    ({ key, unknown }) => {
      localStorage.setItem(key, unknown);
      window.draftSchemaFinishSubmit(true);
    },
    { key, unknown },
  );
  expect(await stored(page)).toBe(unknown);
  await expect(
    page.getByRole("heading", { name: "Saved draft protected", exact: true }),
  ).toBeVisible();
  check();
});

test("later malformed bytes are protected before normal autosave", async ({
  page,
}) => {
  const check = await harness(
    page,
    JSON.stringify({ version: 1, body: "Known initial draft" }),
  );
  await expect(body(page)).toHaveValue("Known initial draft");
  const malformed = "{unrecognized local update";
  await page.evaluate(
    ({ key, malformed }) => localStorage.setItem(key, malformed),
    { key, malformed },
  );
  await body(page).fill("New editor text");
  expect(await stored(page)).toBe(malformed);
  await expect(
    page.getByRole("heading", { name: "Saved draft protected", exact: true }),
  ).toBeVisible();
  check();
});

test("later local read failure refuses autosave and keeps the original bytes", async ({
  page,
}) => {
  const original = JSON.stringify({ version: 1, body: "Known initial draft" });
  const check = await harness(page, original);
  await expect(body(page)).toHaveValue("Known initial draft");
  const before = await stored(page);
  await page.evaluate((key) => {
    const getItem = Storage.prototype.getItem;
    Object.assign(window, {
      restoreDraftStorageRead: () => {
        Storage.prototype.getItem = getItem;
      },
    });
    Storage.prototype.getItem = function (requested) {
      if (requested === key) throw new Error("Invented local read failure");
      return getItem.call(this, requested);
    };
  }, key);
  await body(page).fill("Editor text after read failure");
  await expect(
    page.getByRole("heading", { name: "Saved draft protected", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { restoreDraftStorageRead(): void }
    ).restoreDraftStorageRead(),
  );
  expect(await stored(page)).toBe(before);
  check();
});
