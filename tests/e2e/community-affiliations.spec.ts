import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import installationFixture from "../fixtures/installation.symbaiex.json";

const fixtureMint = installationFixture.token.mint;

let script: string;
let css: string;
test.beforeAll(() => {
  css =
    readFileSync("styles/forum-shared.css", "utf8") +
    execFileSync(
      "bun",
      [
        "-e",
        `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("apps/platform/app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/community-affiliations.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"isolated-community",setup(build){build.onResolve({filter:/^convex\\/react$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/community-affiliations-mocks.tsx"}));build.onResolve({filter:/^next\\/navigation$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/identity-navigation.ts"}));build.onResolve({filter:/commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/community-affiliations-mocks.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 6 * 1024 * 1024 },
  );
});

async function harness(page: Page, scenario = "") {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:43213") return route.abort();
    if (url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:43213/?${scenario}`);
  await expect(
    page.getByRole("heading", { name: "Fixture project DEMO" }),
  ).toBeVisible();
  return errors;
}
async function calls(page: Page) {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __communityFixtureCalls: Array<{
            name: string;
            args: Record<string, unknown>;
          }>;
        }
      ).__communityFixtureCalls,
  );
}
async function identity(page: Page, actor: string, loading = false) {
  await page.evaluate(
    (detail) =>
      window.dispatchEvent(
        new CustomEvent("community-fixture:identity", { detail }),
      ),
    { actor, loading },
  );
}
const editName = "Edit your affiliation for Fixture project";

for (const width of [390, 1440])
  test(`owner affiliation editing keeps exact mint, draft and focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = await harness(page);
    const edit = page.getByRole("button", { name: editName, exact: true });
    await expect(edit).toHaveCount(1);
    expect(await calls(page)).toEqual([]);
    await edit.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "Edit your affiliation",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    const mint = dialog.getByLabel("Exact Solana mint");
    await expect(mint).toHaveValue(fixtureMint);
    await expect(mint).toHaveAttribute("readonly", "");
    await expect(mint).toHaveAccessibleDescription(
      "The project mint cannot change when editing an affiliation.",
    );
    await expect(dialog.getByLabel("Your role")).toHaveValue(
      "Original researcher",
    );
    await expect(dialog.getByLabel("What are you building?")).toHaveValue(
      "The author's invented original project affiliation.",
    );
    await expect(dialog.getByLabel("Project website (optional)")).toHaveValue(
      "https://example.com/original",
    );
    await dialog.getByLabel("Your role").fill("Updated researcher");
    await dialog
      .getByLabel("What are you building?")
      .fill("An updated public description with clear project documentation.");
    await dialog.getByLabel("Project website (optional)").fill("");
    await page.evaluate(() =>
      window.dispatchEvent(new Event("community-fixture:updated-claim")),
    );
    await expect(dialog.getByLabel("Your role")).toHaveValue(
      "Updated researcher",
    );
    // Even a tampered DOM field cannot redirect this saved edit to another mint.
    await mint.evaluate((element: HTMLInputElement) => {
      element.readOnly = false;
      element.value = "So11111111111111111111111111111111111111112";
    });
    await dialog
      .getByRole("button", { name: "Save affiliation changes", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toHaveText(
      "Affiliation updated. It is labelled self-declared, not verified ownership.",
    );
    expect(await calls(page)).toEqual([
      {
        name: "forumCommerce:resolveMint",
        args: {
          wallet: "11111111111111111111111111111111",
          mint: fixtureMint,
        },
      },
      {
        name: "forumCommunity:createProjectClaim",
        args: {
          wallet: "11111111111111111111111111111111",
          mint: fixtureMint,
          role: "Updated researcher",
          description:
            "An updated public description with clear project documentation.",
        },
      },
    ]);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(edit).toBeFocused();
    await expect(
      page.getByText("Updated researcher", { exact: true }),
    ).toBeVisible();
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
    expect(errors).toEqual([]);
  });

for (const scenario of ["guest", "identityloading", "mineloading"])
  test(`an unresolved or signed-out owner never sees an affiliation edit (${scenario})`, async ({
    page,
  }) => {
    const errors = await harness(page, scenario);
    await expect(page.getByRole("button", { name: editName })).toHaveCount(0);
    expect(await calls(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

test("changing identity retains the draft but cannot save another author's affiliation", async ({
  page,
}) => {
  const errors = await harness(page);
  await page.getByRole("button", { name: editName }).click();
  const dialog = page.getByRole("dialog", {
    name: "Edit your affiliation",
    exact: true,
  });
  await dialog.getByLabel("Your role").fill("Keep this local draft");
  await identity(page, "other");
  await expect(
    dialog.getByRole("button", { name: "Save affiliation changes" }),
  ).toBeDisabled();
  await expect(
    dialog.getByText(
      "Sign in as the affiliation author to save changes. Your draft has been kept.",
    ),
  ).toBeVisible();
  await expect(dialog.getByLabel("Your role")).toHaveValue(
    "Keep this local draft",
  );
  expect(await calls(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Add project", exact: true }),
  ).toBeFocused();
  expect(errors).toEqual([]);
});

test("an actor change during mint resolution invalidates the pending edit", async ({
  page,
}) => {
  const errors = await harness(page, "pendingresolve");
  await page.getByRole("button", { name: editName }).click();
  const dialog = page.getByRole("dialog", {
    name: "Edit your affiliation",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Save affiliation changes" })
    .click();
  await expect(dialog.getByLabel("Your role")).toBeDisabled();
  await identity(page, "other");
  await page.evaluate(() =>
    window.dispatchEvent(new Event("community-fixture:resolve")),
  );
  await expect(dialog.getByRole("status")).toHaveText(
    "Your account or wallet changed. Review your affiliation before saving again.",
  );
  expect((await calls(page)).map((call) => call.name)).toEqual([
    "forumCommerce:resolveMint",
  ]);
  expect(errors).toEqual([]);
});

test("a rejected edit keeps the entered fields and publishes no success state", async ({
  page,
}) => {
  const errors = await harness(page, "saveerror");
  await page.getByRole("button", { name: editName }).click();
  const dialog = page.getByRole("dialog", {
    name: "Edit your affiliation",
    exact: true,
  });
  await dialog.getByLabel("Your role").fill("Preserved after failure");
  await dialog
    .getByRole("button", { name: "Save affiliation changes" })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(
    "The fixture rejected this affiliation. Try again.",
  );
  await expect(dialog.getByLabel("Your role")).toHaveValue(
    "Preserved after failure",
  );
  await expect(
    dialog.getByRole("button", { name: "Save affiliation changes" }),
  ).toBeEnabled();
  expect((await calls(page)).map((call) => call.name)).toEqual([
    "forumCommerce:resolveMint",
    "forumCommunity:createProjectClaim",
  ]);
  expect(errors).toEqual([]);
});

test("adding a project remains a blank, editable-mint flow after closing an edit", async ({
  page,
}) => {
  const errors = await harness(page);
  await page.getByRole("button", { name: editName }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Introduce your project",
    exact: true,
  });
  await expect(dialog.getByLabel("Exact Solana mint")).toHaveValue("");
  await expect(dialog.getByLabel("Exact Solana mint")).toBeEditable();
  await expect(dialog.getByLabel("Your role")).toHaveValue("");
  await expect(
    dialog.getByRole("button", {
      name: "Save public affiliation",
      exact: true,
    }),
  ).toBeEnabled();
  expect(await calls(page)).toEqual([]);
  expect(errors).toEqual([]);
});
