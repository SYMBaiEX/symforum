import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43243";
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/work-brief-guidance.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"work-guidance-isolation",setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/work-brief-guidance-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 },
  );
});
async function harness(page: Page, app = "platform") {
  const errors: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/community")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    requests.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/community?section=work`);
  await expect(
    page.getByRole("heading", { name: "Research brief work-one" }),
  ).toBeVisible();
  return async () => {
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
    expect(
      await page.evaluate(() => window.workBriefFixture.forbidden),
    ).toEqual([]);
  };
}
const operations = (page: Page) =>
  page.evaluate(() => window.workBriefFixture.operations);
const brief = (page: Page) =>
  page.getByRole("textbox", { name: "Brief and acceptance criteria" });
const template = (page: Page) =>
  page.getByRole("button", { name: "Append brief template" });
const url = (page: Page) =>
  page.getByRole("textbox", { name: "Deliverable link", exact: true });
async function creation(page: Page) {
  await page.getByRole("button", { name: "Create brief", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
async function submission(page: Page) {
  await page
    .getByText("Submit or view your deliverable", { exact: true })
    .click();
  await expect(url(page)).toBeVisible();
}
for (const kind of ["bounty", "research"])
  test(`explicit ${kind} template appends editable text without changing other fields or publishing`, async ({
    page,
  }) => {
    const check = await harness(page);
    await creation(page);
    await expect(brief(page)).toHaveValue("");
    await page
      .getByRole("combobox", { name: "Type", exact: true })
      .selectOption(kind);
    await page
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Original authored title");
    await page
      .getByRole("textbox", { name: "Sponsor pledge (SOL)" })
      .fill("0.5");
    await brief(page).fill("Authored text\n保留");
    const mint = await page
      .getByRole("textbox", { name: "Related token mint (optional)" })
      .inputValue();
    await template(page).focus();
    await page.keyboard.press("Enter");
    const value = await brief(page).inputValue();
    expect(value.startsWith("Authored text\n保留\n\n")).toBe(true);
    expect(value).toContain(
      kind === "research" ? "Research question" : "build, fix or contribution",
    );
    await expect(brief(page)).toBeFocused();
    await brief(page).fill(
      value.replace(
        "[YYYY-MM-DD HH:mm UTC — editable request, not an enforced timer.]",
        "Requested: 2027-01-01 18:00 UTC",
      ),
    );
    await expect(
      page.getByRole("combobox", { name: "Type", exact: true }),
    ).toHaveValue(kind);
    await expect(
      page.getByRole("textbox", { name: "Title", exact: true }),
    ).toHaveValue("Original authored title");
    await expect(
      page.getByRole("textbox", { name: "Sponsor pledge (SOL)" }),
    ).toHaveValue("0.5");
    await expect(
      page.getByRole("textbox", { name: "Related token mint (optional)" }),
    ).toHaveValue(mint);
    expect(await operations(page)).toEqual([]);
    await check();
  });
test("capacity cannot silently truncate or overwrite a full brief", async ({
  page,
}) => {
  const check = await harness(page);
  await creation(page);
  await brief(page).fill("x".repeat(5000));
  await template(page).click();
  await expect(brief(page)).toHaveValue("x".repeat(5000));
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
    /Template not added/,
  );
  expect(await operations(page)).toEqual([]);
  await check();
});
for (const ok of [true, false])
  test(`explicit publish ${ok ? "success resets" : "failure retains"} native fields and local template feedback`, async ({
    page,
  }) => {
    const check = await harness(page);
    await creation(page);
    await page
      .getByRole("combobox", { name: "Type", exact: true })
      .selectOption("research");
    await page
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Original research title");
    await template(page).click();
    await page
      .getByRole("textbox", { name: "Sponsor pledge (SOL)" })
      .fill("0.25");
    const text = await brief(page).inputValue();
    await page.getByRole("button", { name: "Publish unfunded pledge" }).click();
    await expect(
      page.getByRole("button", { name: "Publishing…" }),
    ).toBeDisabled();
    await expect(template(page)).toBeDisabled();
    expect(await operations(page)).toEqual([
      {
        name: "forumCommunity:createBounty",
        args: {
          kind: "research",
          mint: "So11111111111111111111111111111111111111112",
          title: "Original research title",
          brief: text,
          amountLamports: "250000000",
        },
      },
    ]);
    await page.evaluate(
      (value) => window.workBriefFixture.settleCreate(value),
      ok,
    );
    if (ok) {
      await expect(brief(page)).toHaveValue("");
      await expect(
        page.getByRole("combobox", { name: "Type", exact: true }),
      ).toHaveValue("bounty");
      await expect(
        page.getByText(
          "Editable guidance appended. Replace the placeholders before publishing.",
          { exact: true },
        ),
      ).toHaveCount(0);
    } else {
      await expect(brief(page)).toHaveValue(text);
      await expect(
        page.getByText("Invented creation failure; brief retained", {
          exact: true,
        }),
      ).toBeVisible();
    }
    expect((await operations(page)).length).toBe(1);
    await check();
  });
test("mint changes never insert a template or reset authored brief, title, kind or pledge", async ({
  page,
}) => {
  const check = await harness(page);
  await creation(page);
  await brief(page).fill("Existing authored brief remains unchanged.");
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Existing authored title");
  await page
    .getByRole("textbox", { name: "Sponsor pledge (SOL)" })
    .fill("0.75");
  await page.evaluate(() =>
    window.workBriefFixture.mint(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    ),
  );
  await expect(brief(page)).toHaveValue(
    "Existing authored brief remains unchanged.",
  );
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Existing authored title");
  await expect(
    page.getByRole("textbox", { name: "Sponsor pledge (SOL)" }),
  ).toHaveValue("0.75");
  expect(await operations(page)).toEqual([]);
  await check();
});
test("URL preview exposes only actual host, never path/token or a clickable fetched link", async ({
  page,
}) => {
  const check = await harness(page);
  await submission(page);
  await url(page).fill(
    "https://例え.テスト/private-path?token=private-preview-marker",
  );
  await expect(
    page.getByText("xn--r8jz45g.xn--zckzah", { exact: true }),
  ).toBeVisible();
  await expect(url(page)).toHaveAccessibleDescription(
    /not been fetched, resolved, checked or endorsed/,
  );
  expect(await page.locator("body").innerText()).not.toContain(
    "private-preview-marker",
  );
  await expect(page.getByRole("link", { name: /xn--r8jz45g/ })).toHaveCount(0);
  expect(await operations(page)).toEqual([]);
  await check();
});
for (const value of [
  "",
  "https://",
  "https://user:secret@example.com",
  "http://example.com",
  "https://localhost",
  "https://127.0.0.1",
  "javascript:alert(1)",
])
  test(`missing/unsupported URL removes any old host without network (${value || "empty"})`, async ({
    page,
  }) => {
    const check = await harness(page);
    await submission(page);
    await url(page).fill("https://example.org/delivery");
    await expect(page.getByText("example.org", { exact: true })).toBeVisible();
    await url(page).fill(value);
    await expect(page.getByText("example.org", { exact: true })).toHaveCount(0);
    await expect(url(page)).toHaveAccessibleDescription(
      value
        ? /Destination preview unavailable/
        : /Add a public HTTPS delivery link/,
    );
    expect(await operations(page)).toEqual([]);
    await check();
  });
test("valid URL payload and saved synchronization remain authoritative, not preview state", async ({
  page,
}) => {
  const check = await harness(page);
  await submission(page);
  await url(page).fill("https://EXAMPLE.com/delivery?x=1");
  await page
    .getByRole("textbox", { name: "What did you deliver?" })
    .fill("Useful existing deliverable with public evidence.");
  await page
    .getByRole("button", { name: "Save deliverable", exact: true })
    .click();
  expect(await operations(page)).toEqual([
    {
      name: "forumCommunity:claimBounty",
      args: {
        workId: "work-one",
        url: "https://example.com/delivery?x=1",
        summary: "Useful existing deliverable with public evidence.",
      },
    },
  ]);
  await expect(
    page.getByText("Submission saved. The sponsor can now review it.", {
      exact: true,
    }),
  ).toBeVisible();
  await check();
});
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} ${width}px template/dialog and Unicode destination preview fit with keyboard/44px controls`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const check = await harness(page, app);
      await creation(page);
      await template(page).focus();
      await page.keyboard.press("Enter");
      for (const node of [
        page.getByRole("dialog"),
        template(page),
        brief(page),
      ]) {
        const box = await node.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      await expect
        .poll(async () => (await template(page).boundingBox())!.height)
        .toBeGreaterThanOrEqual(44);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await submission(page);
      await url(page).fill("https://" + "a".repeat(60) + ".example.com/path");
      const form = page.getByRole("form", { name: "Edit your deliverable" });
      for (const node of [
        form,
        url(page),
        page.getByText("a".repeat(60) + ".example.com", { exact: true }),
      ]) {
        const box = await node.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      expect((await url(page).boundingBox())!.height).toBeGreaterThanOrEqual(
        44,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      expect(await operations(page)).toEqual([]);
      await check();
    });
