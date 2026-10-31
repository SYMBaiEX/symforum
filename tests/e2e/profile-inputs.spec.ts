import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
let script: string;
test.beforeAll(() => {
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/profile-inputs.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"profile-input-isolation",setup(build){build.onResolve({filter:/^convex\\/react$|^convex-helpers\\/react\\/cache\\/hooks$|^next\\/navigation$|forum-runtime-context$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/control-panel-drafts-state.ts"}));build.onResolve({filter:/forum-primitives$|forum-agent-access$|app-error-surface$|^next\\/link$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/control-panel-drafts-leaves.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));process.stdout.write(await result.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
});
async function harness(page: Page) {
  const unexpected: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:43236" && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: '<meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script>',
      });
    if (
      url.origin === "http://127.0.0.1:43236" &&
      url.pathname === "/fixture.js"
    )
      return route.fulfill({ contentType: "text/javascript", body: script });
    unexpected.push(url.pathname);
    return route.abort();
  });
  await page.goto("http://127.0.0.1:43236/");
  await expect(page.getByRole("textbox", { name: /^Bio/ })).toHaveValue(
    "member-a biography",
  );
  return () => {
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
  };
}
const avatar = (page: Page) =>
  page.getByRole("textbox", { name: /^Avatar URL/ });
const website = (page: Page) => page.getByRole("textbox", { name: /^Website/ });
const birthday = (page: Page) =>
  page.getByRole("textbox", { name: /^Birthday/ });
const save = (page: Page) =>
  page.getByRole("button", { name: "Save profile", exact: true });
const calls = (page: Page) =>
  page.evaluate(() => window.profileInputsFixture.calls());
test("valid URLs and leap day use the original payload; blank optional values stay optional", async ({
  page,
}) => {
  const check = await harness(page);
  await expect(avatar(page)).toHaveAttribute("inputmode", "url");
  await expect(website(page)).toHaveAttribute("inputmode", "url");
  await expect(avatar(page)).toHaveAccessibleDescription(/Optional.*http/);
  await avatar(page).fill(" https://example.com/avatar.png ");
  await website(page).fill("http://example.com/profile");
  await birthday(page).fill("2000-02-29");
  await save(page).focus();
  await page.keyboard.press("Enter");
  expect(await calls(page)).toMatchObject([
    {
      kind: "profile",
      owner: "member-a",
      payload: {
        avatarUrl: "https://example.com/avatar.png",
        websiteUrl: "http://example.com/profile",
        birthday: "2000-02-29",
      },
    },
  ]);
  await page.evaluate(() => window.profileInputsFixture.settle(0));
  await avatar(page).fill("");
  await website(page).fill("");
  await birthday(page).fill("");
  await save(page).click();
  expect(await calls(page)).toHaveLength(2);
  expect(
    await page.evaluate(() => {
      const payload = window.profileInputsFixture.calls()[1].payload as Record<
        string,
        unknown
      >;
      return [payload.avatarUrl, payload.websiteUrl, payload.birthday].every(
        (value) => value === undefined,
      );
    }),
  ).toBe(true);
  check();
});
test("URL errors are associated, preserve text and block save until corrected", async ({
  page,
}) => {
  const check = await harness(page);
  await avatar(page).fill("ftp://example.com/photo.png");
  await page.keyboard.press("Tab");
  await expect(avatar(page)).toHaveAttribute("aria-invalid", "true");
  await expect(avatar(page)).toHaveAccessibleDescription(
    /Avatar URL must use http or https/,
  );
  await website(page).fill("not a URL");
  await save(page).click();
  await expect(avatar(page)).toBeFocused();
  await expect(website(page)).toHaveAccessibleDescription(
    /Website URL must be a valid URL/,
  );
  expect(await calls(page)).toEqual([]);
  await expect(avatar(page)).toHaveValue("ftp://example.com/photo.png");
  await avatar(page).fill("https://example.com/photo.png");
  await website(page).fill("https://example.com/");
  await expect(avatar(page)).toHaveAttribute("aria-invalid", "false");
  await save(page).click();
  expect(await calls(page)).toHaveLength(1);
  check();
});
test("malformed and impossible dates remain visible and cannot be saved", async ({
  page,
}) => {
  const check = await harness(page);
  for (const value of ["2024-2-09", "2023-02-29", "2024-04-31"]) {
    await birthday(page).fill(value);
    await save(page).click();
    await expect(birthday(page)).toBeFocused();
    await expect(birthday(page)).toHaveValue(value);
    await expect(birthday(page)).toHaveAttribute("aria-invalid", "true");
    await expect(birthday(page)).toHaveAccessibleDescription(/Birthday must/);
  }
  expect(await calls(page)).toEqual([]);
  await birthday(page).fill("0000-01-01");
  await save(page).click();
  expect(await calls(page)).toMatchObject([
    { payload: { birthday: "0000-01-01" } },
  ]);
  check();
});
test("legacy values are not erased and same-account refresh keeps corrected drafts", async ({
  page,
}) => {
  const check = await harness(page);
  await page.evaluate(() =>
    window.profileInputsFixture.profile({
      avatarUrl: "ftp://legacy.example/avatar",
      websiteUrl: "legacy.example",
      birthday: "2023-02-29",
    }),
  );
  await expect(avatar(page)).toHaveValue("ftp://legacy.example/avatar");
  await expect(website(page)).toHaveValue("legacy.example");
  await expect(birthday(page)).toHaveValue("2023-02-29");
  await save(page).click();
  expect(await calls(page)).toEqual([]);
  await avatar(page).fill("https://example.com/corrected");
  await page.evaluate(() =>
    window.profileInputsFixture.profile({
      avatarUrl: "https://example.com/remote",
      birthday: "2000-02-29",
    }),
  );
  await expect(avatar(page)).toHaveValue("https://example.com/corrected");
  await expect(birthday(page)).toHaveValue("2023-02-29");
  await page.evaluate(() => window.profileInputsFixture.account("member-b"));
  await expect(avatar(page)).toHaveValue("");
  await expect(birthday(page)).toHaveValue("");
  await expect(avatar(page)).toHaveAttribute("aria-invalid", "false");
  check();
});
test("late save feedback cannot leak across an account switch or overwrite newer fields", async ({
  page,
}) => {
  const check = await harness(page);
  await birthday(page).fill("2000-02-29");
  await save(page).click();
  await birthday(page).fill("2024-02-29");
  await page.evaluate(() => {
    window.profileInputsFixture.profile({ birthday: "2000-02-29" });
    window.profileInputsFixture.settle(0);
  });
  await expect(birthday(page)).toHaveValue("2024-02-29");
  await expect(
    page.getByText("Forum profile saved", { exact: true }),
  ).toHaveCount(0);
  await save(page).click();
  await page.evaluate(() => {
    window.profileInputsFixture.account("member-b");
    window.profileInputsFixture.settle(1, true);
  });
  await expect(birthday(page)).toHaveValue("");
  await expect(page.getByRole("alert")).toHaveCount(0);
  check();
});
test("server validation remains authoritative and failed saves preserve inputs", async ({
  page,
}) => {
  const check = await harness(page);
  await website(page).fill("https://example.com/valid");
  await save(page).click();
  await page.evaluate(() => window.profileInputsFixture.settle(0, true));
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(website(page)).toHaveValue("https://example.com/valid");
  await expect(save(page)).toBeEnabled();
  check();
});
