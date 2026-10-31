import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
let script: string;
const css = readFileSync("styles/forum-shared.css", "utf8");
test.beforeAll(() => {
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/author-tip-integration.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"author-tip-integration",setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|commerce-wallet$|^@solana\\/kit-plugin-wallet\\/react$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/author-tip-integration-mocks.tsx"}));build.onResolve({filter:/^@solana\\/react$/},()=>({path:"solana-action",namespace:"author-tip-action"}));build.onLoad({filter:/.*/,namespace:"author-tip-action"},()=>({contents:'export {useWalletAction as useAction} from "'+process.cwd()+'/tests/e2e/fixtures/author-tip-integration-mocks.tsx"',loader:"ts"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
});
async function operations(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          authorTipOperations: { name: string; args: unknown }[];
        }
      ).authorTipOperations,
  );
}
async function queries(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          authorTipQueries: { name: string; args: unknown }[];
        }
      ).authorTipQueries,
  );
}
async function harness(page: Page, scenario = "") {
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:43229" && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (
      url.origin === "http://127.0.0.1:43229" &&
      url.pathname === "/fixture.js"
    )
      return route.fulfill({ contentType: "text/javascript", body: script });
    external.push(url.pathname);
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:43229/?${scenario}`);
  await expect(
    page.getByRole("heading", { name: "Invented public thread" }),
  ).toBeVisible();
  return async (expected: unknown[] = []) => {
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    expect(await operations(page)).toEqual(expected);
  };
}
for (const scenario of [
  "",
  "mapped",
  "unverified",
  "archive",
  "archive&mapped",
  "agentauthor",
])
  test(`existing frame exposes only its public opted-in author without payment actions:${scenario || "unmapped"}`, async ({
    page,
  }) => {
    const check = await harness(page, scenario);
    await expect(
      page.getByRole("heading", {
        name: scenario.includes("agentauthor")
          ? "Support @public_agent_author"
          : "Support @public_thread_author",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review tip", exact: true }),
    ).toBeDisabled();
    if (scenario.includes("archive"))
      await expect(
        page.getByRole("heading", { name: "Promote this post", exact: true }),
      ).toHaveCount(0);
    expect(
      (await queries(page))
        .filter((q) => q.name === "forumCommunity:getThreadRecipient")
        .every(
          (q) =>
            JSON.stringify(q.args) ===
            JSON.stringify({ threadId: "public-thread-one" }),
        ),
    ).toBe(true);
    expect(
      (await queries(page)).some(
        (q) => q.name === "forumCommunity:listTipRecipients",
      ),
    ).toBe(false);
    expect(await page.locator("body").innerText()).not.toContain(
      "22222222222222222222222222222222",
    );
    await check();
  });
for (const scenario of ["optout", "private"])
  test(`unavailable public recipient exposes no tip identity or address:${scenario}`, async ({
    page,
  }) => {
    const check = await harness(page, scenario);
    await expect(page.getByRole("heading", { name: /Support @/ })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("textbox", { name: "Optional author tip (SOL)" }),
    ).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toContain(
      "22222222222222222222222222222222",
    );
    await check();
  });
test("loading recipient does not flash eligibility and a later known opt-in can render", async ({
  page,
}) => {
  const check = await harness(page, "loading");
  await expect(
    page.getByRole("button", { name: "Review tip", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("author-tip:resolve")),
  );
  await expect(
    page.getByRole("heading", { name: "Support @public_thread_author" }),
  ).toBeVisible();
  await check();
});
test("recipient query failure is isolated from the public thread and never leaks raw details", async ({
  page,
}) => {
  const check = await harness(page, "error");
  await expect(
    page.getByRole("heading", { name: "Trading temporarily unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review tip", exact: true }),
  ).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toContain(
    "Fixture recipient lookup failed",
  );
  await check();
});
for (const scenario of ["guest", "agentviewer"])
  test(`non-human-linked viewer cannot start a tip by normal UI:${scenario}`, async ({
    page,
  }) => {
    const check = await harness(page, scenario);
    await expect(
      page.getByRole("button", { name: "Review tip", exact: true }),
    ).toBeDisabled();
    expect(
      (await queries(page)).some((q) => q.name.endsWith(":listMine")),
    ).toBe(false);
    await check();
  });
test("native host retains thread content without any commerce transport", async ({
  page,
}) => {
  const check = await harness(page, "native");
  await expect(
    page.getByRole("button", { name: "Fixture wallet" }),
  ).toHaveCount(0);
  expect(await queries(page)).toEqual([]);
  await check();
});
test("changing thread queries its actual new author and removes the old opt-in UI", async ({
  page,
}) => {
  const check = await harness(page);
  await expect(
    page.getByRole("heading", { name: "Support @public_thread_author" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Read another thread" }).click();
  await expect(page.getByRole("heading", { name: /Support @/ })).toHaveCount(0);
  expect(
    (await queries(page))
      .filter((q) => q.name === "forumCommunity:getThreadRecipient")
      .at(-1)?.args,
  ).toEqual({ threadId: "other-thread-two" });
  await check();
});
test("unlinked retained connection cannot programmatically prepare an author tip", async ({
  page,
}) => {
  const check = await harness(page, "retained&unlinked");
  await expect(
    page.getByRole("button", { name: "Review tip", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Optional author tip (SOL)" })
    .evaluate((input) =>
      (input.closest("form") as HTMLFormElement).requestSubmit(),
    );
  await check();
});
test("eligible explicit review binds the actual author and same-tick submissions admit only one fake preparation", async ({
  page,
}) => {
  const check = await harness(page, "admission");
  const amount = page.getByRole("textbox", {
    name: "Optional author tip (SOL)",
  });
  await expect(
    page.getByRole("button", { name: "Review tip", exact: true }),
  ).toBeEnabled();
  await amount.evaluate((input) => {
    const form = input.closest("form") as HTMLFormElement;
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(
    page.getByRole("button", { name: "Review tip", exact: true }),
  ).toBeDisabled();
  await check([
    {
      name: "forumCommunity:preparePayment",
      args: {
        wallet: "11111111111111111111111111111111",
        threadId: "public-thread-one",
        recipientId: "actual-thread-author",
        amountLamports: "10000000",
      },
    },
  ]);
});

test("one explicit eligible review uses only the public thread author's bound recipient", async ({
  page,
}) => {
  const check = await harness(page, "admission");
  await page.getByRole("button", { name: "Review tip", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review tip", exact: true }),
  ).toBeDisabled();
  await check([
    {
      name: "forumCommunity:preparePayment",
      args: {
        wallet: "11111111111111111111111111111111",
        threadId: "public-thread-one",
        recipientId: "actual-thread-author",
        amountLamports: "10000000",
      },
    },
  ]);
});

test("local invalid amount creates no preparation and releases only the local admission lock", async ({
  page,
}) => {
  const check = await harness(page, "admission");
  const amount = page.getByRole("textbox", {
    name: "Optional author tip (SOL)",
  });
  await amount.fill(".");
  await page.getByRole("button", { name: "Review tip", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Use an amount above zero and no more than 100 SOL.",
  );
  expect(await operations(page)).toEqual([]);
  await amount.fill("0.02");
  await page.getByRole("button", { name: "Review tip", exact: true }).click();
  await check([
    {
      name: "forumCommunity:preparePayment",
      args: {
        wallet: "11111111111111111111111111111111",
        threadId: "public-thread-one",
        recipientId: "actual-thread-author",
        amountLamports: "20000000",
      },
    },
  ]);
});

test("a known pre-intent async rejection releases local admission only for a deliberate corrected request", async ({
  page,
}) => {
  const check = await harness(page, "admission&rejectable");
  const review = page.getByRole("button", { name: "Review tip", exact: true });
  const original = {
    name: "forumCommunity:preparePayment",
    args: {
      wallet: "11111111111111111111111111111111",
      threadId: "public-thread-one",
      recipientId: "actual-thread-author",
      amountLamports: "10000000",
    },
  };
  await review.click();
  await expect(review).toBeDisabled();
  expect(await operations(page)).toEqual([original]);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("author-tip:reject-before-intent")),
  );
  await expect(page.getByRole("alert")).toHaveText(
    "Fixture preparation rejected before creating any intent.",
  );
  await expect(review).toBeEnabled();
  // Awaiting this enabled state must not itself dispatch an automatic retry.
  expect(await operations(page)).toEqual([original]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await queries(page)).some(
      (query) => query.name === "forumCommunity:getPayment",
    ),
  ).toBe(false);
  await page
    .getByRole("textbox", { name: "Optional author tip (SOL)" })
    .fill("0.02");
  await review.click();
  await expect(review).toBeDisabled();
  await check([
    original,
    { ...original, args: { ...original.args, amountLamports: "20000000" } },
  ]);
});
