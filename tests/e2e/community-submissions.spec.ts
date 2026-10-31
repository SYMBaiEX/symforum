import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

let script: string;
let css: string;
test.beforeAll(() => {
  css = readFileSync("styles/forum-shared.css", "utf8");
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/community-submissions.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"community-submissions",setup(build){build.onResolve({filter:/^convex\\/react$|commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/community-submissions-mocks.tsx"}));build.onResolve({filter:/^next\\/navigation$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/identity-navigation.ts"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
});
async function harness(page: Page, scenario = "") {
  const errors: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:43225" && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (
      url.origin === "http://127.0.0.1:43225" &&
      url.pathname === "/fixture.js"
    )
      return route.fulfill({ contentType: "text/javascript", body: script });
    requests.push(url.pathname);
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:43225/?${scenario}`);
  await page
    .getByRole("button", { name: "Bounties & research", exact: true })
    .click();
  await page
    .getByText("Submit or view your deliverable", { exact: true })
    .click();
  return async () => {
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { submissionCalls: { name: string }[] }
        ).submissionCalls.every(
          (call) => call.name === "forumCommunity:claimBounty",
        ),
      ),
    ).toBe(true);
  };
}
async function event(page: Page, name: string, detail?: unknown) {
  await page.evaluate(
    ({ name, detail }) =>
      window.dispatchEvent(new CustomEvent(`submissions:${name}`, { detail })),
    { name, detail },
  );
}
const url = (page: Page) =>
  page.getByRole("textbox", { name: "Deliverable link", exact: true });
const summary = (page: Page) =>
  page.getByRole("textbox", { name: "What did you deliver?", exact: true });

for (const width of [390, 1440])
  test(`saved deliverable prefills and updates through the existing upsert at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const check = await harness(page);
    await expect(url(page)).toHaveValue("https://example.com/original");
    await expect(summary(page)).toHaveValue(
      "Original privately submitted research summary.",
    );
    await expect(
      page.getByText("This is not a reward approval or payment receipt.", {
        exact: false,
      }),
    ).toBeVisible();
    await url(page).fill("https://example.com/revised");
    await expect(page.getByText("You have unsaved changes.")).toBeVisible();
    await page
      .getByRole("button", { name: "Save deliverable", exact: true })
      .click();
    await expect(
      page.getByText("Submission saved. The sponsor can now review it."),
    ).toBeVisible();
    await expect(page.getByText("You have unsaved changes.")).toBeHidden();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { submissionCalls: unknown[] }).submissionCalls,
      ),
    ).toEqual([
      {
        name: "forumCommunity:claimBounty",
        args: {
          workId: "work-one",
          url: "https://example.com/revised",
          summary: "Original privately submitted research summary.",
        },
      },
    ]);
    await check();
  });
test("reactive saved changes never overwrite a dirty draft", async ({
  page,
}) => {
  const check = await harness(page);
  await summary(page).fill("My unsaved locally edited contributor summary.");
  await event(page, "update");
  await expect(summary(page)).toHaveValue(
    "My unsaved locally edited contributor summary.",
  );
  await expect(url(page)).toHaveValue("https://example.com/original");
  await expect(
    page.getByText(
      "The saved version changed. Your current draft has not been replaced.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save deliverable", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Load latest saved version", exact: true })
    .click();
  await expect(summary(page)).toHaveValue(
    "A newer remote saved deliverable; never replace a dirty draft.",
  );
  await expect(page.getByText("You have unsaved changes.")).toHaveCount(0);
  await check();
});
test("failed saves keep the draft and unsaved status", async ({ page }) => {
  const check = await harness(page, "error");
  await summary(page).fill("My edited deliverable stays after the save error.");
  await page
    .getByRole("button", { name: "Save deliverable", exact: true })
    .click();
  await expect(
    page.getByText("Fixture save unavailable. Your draft is retained."),
  ).toBeVisible();
  await expect(summary(page)).toHaveValue(
    "My edited deliverable stays after the save error.",
  );
  await expect(page.getByText("You have unsaved changes.")).toBeVisible();
  await check();
});

test("pristine saved changes require explicitly loading the latest version before another save", async ({
  page,
}) => {
  const check = await harness(page);
  await event(page, "update");
  await expect(url(page)).toHaveValue("https://example.com/original");
  await expect(
    page.getByRole("button", { name: "Save deliverable", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Load latest saved version", exact: true })
    .click();
  await expect(url(page)).toHaveValue("https://example.com/remote");
  await expect(summary(page)).toHaveValue(
    "A newer remote saved deliverable; never replace a dirty draft.",
  );
  await expect(
    page.getByRole("button", {
      name: "Load latest saved version",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save deliverable", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { submissionCalls: unknown[] }).submissionCalls,
    ),
  ).toEqual([]);
  await check();
});

for (const ordering of ["querybefore", "queryafter"])
  test(`save and subscription ordering does not reload an older snapshot (${ordering})`, async ({
    page,
  }) => {
    const check = await harness(page, ordering);
    await summary(page).fill(
      "A revised deliverable from this explicit save attempt.",
    );
    await page
      .getByRole("button", { name: "Save deliverable", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Saving…", exact: true }),
    ).toBeDisabled();
    await event(page, "finish", true);
    await expect(
      page.getByText("Submission saved. The sponsor can now review it."),
    ).toBeVisible();
    await expect(summary(page)).toHaveValue(
      "A revised deliverable from this explicit save attempt.",
    );
    await expect(
      page.getByRole("button", {
        name: "Load latest saved version",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Save deliverable", exact: true }),
    ).toBeDisabled();
    if (ordering === "queryafter") await event(page, "publish");
    await expect(page.getByText("You have unsaved changes.")).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Load latest saved version",
        exact: true,
      }),
    ).toHaveCount(0);
    await summary(page).fill(
      "Another edit after the authoritative saved row is available.",
    );
    await expect(
      page.getByRole("button", { name: "Save deliverable", exact: true }),
    ).toBeEnabled();
    await check();
  });
test("account and work changes do not carry private draft data across owners", async ({
  page,
}) => {
  const check = await harness(page);
  await summary(page).fill("An unsaved draft private to the original account.");
  await event(page, "identity", { actor: "other" });
  await expect(summary(page)).toHaveValue(
    "A separate account's private saved deliverable.",
  );
  await event(page, "work");
  await page
    .getByText("Submit or view your deliverable", { exact: true })
    .click();
  await expect(summary(page)).toHaveValue("");
  await expect(url(page)).toHaveValue("");
  await expect(page.getByText("No deliverable saved yet.")).toBeVisible();
  await check();
});

for (const initial of [false, true])
  test(`a second save waits for authoritative confirmation without losing edits (${initial ? "new" : "existing"} submission)`, async ({
    page,
  }) => {
    const check = await harness(page, "queryafter");
    if (initial) {
      await event(page, "work");
      await page
        .getByText("Submit or view your deliverable", { exact: true })
        .click();
      await url(page).fill("https://example.com/new");
    }
    await summary(page).fill(
      "Version B submitted successfully but not yet observed.",
    );
    await page
      .getByRole("button", { name: "Save deliverable", exact: true })
      .click();
    await event(page, "finish", true);
    await expect(
      page.getByText("Submission saved. The sponsor can now review it."),
    ).toBeVisible();
    await summary(page).fill(
      "Version C is a new draft typed while the subscription catches up.",
    );
    const save = page.getByRole("button", {
      name: "Save deliverable",
      exact: true,
    });
    await expect(save).toBeDisabled();
    await expect(
      page.getByText(
        /Your save completed. Waiting for the saved version to sync/,
      ),
    ).toBeVisible();
    await page
      .getByRole("form", {
        name: initial ? "Submit your deliverable" : "Edit your deliverable",
        exact: true,
      })
      .evaluate((form: HTMLFormElement) => form.requestSubmit());
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { submissionCalls: unknown[] }).submissionCalls
            .length,
      ),
    ).toBe(1);
    await event(page, "publish");
    await expect(save).toBeEnabled();
    await expect(summary(page)).toHaveValue(
      "Version C is a new draft typed while the subscription catches up.",
    );
    await expect(
      page.getByRole("button", {
        name: "Load latest saved version",
        exact: true,
      }),
    ).toHaveCount(0);
    await save.click();
    await event(page, "finish", true);
    await expect(save).toBeDisabled();
    await event(page, "publish");
    await expect(
      page.getByText(
        /Your save completed. Waiting for the saved version to sync/,
      ),
    ).toHaveCount(0);
    await expect(summary(page)).toHaveValue(
      "Version C is a new draft typed while the subscription catches up.",
    );
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { submissionCalls: unknown[] }).submissionCalls
            .length,
      ),
    ).toBe(2);
    await check();
  });
test("loading private submissions does not expose an empty editable form", async ({
  page,
}) => {
  const check = await harness(page, "rowsloading");
  await expect(page.getByText("Loading deliverables…")).toBeVisible();
  await expect(url(page)).toHaveCount(0);
  await check();
});

test("canonical server payload confirms a save without replacing a later draft", async ({
  page,
}) => {
  const check = await harness(page, "queryafter");
  await url(page).fill("https://Example.com");
  await summary(page).fill(
    "  A summary that is trimmed by the existing server contract.  ",
  );
  await page
    .getByRole("button", { name: "Save deliverable", exact: true })
    .click();
  await event(page, "finish", true);
  await expect(
    page.getByText("Submission saved. The sponsor can now review it."),
  ).toBeVisible();
  await summary(page).fill(
    "A later unsaved draft must survive canonical subscription confirmation.",
  );
  await expect(
    page.getByRole("button", { name: "Save deliverable", exact: true }),
  ).toBeDisabled();
  await event(page, "publish");
  await expect(
    page.getByRole("button", { name: "Save deliverable", exact: true }),
  ).toBeEnabled();
  await expect(summary(page)).toHaveValue(
    "A later unsaved draft must survive canonical subscription confirmation.",
  );
  await expect(url(page)).toHaveValue("https://Example.com");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { submissionCalls: unknown[] }).submissionCalls,
    ),
  ).toEqual([
    {
      name: "forumCommunity:claimBounty",
      args: {
        workId: "work-one",
        url: "https://example.com/",
        summary: "A summary that is trimmed by the existing server contract.",
      },
    },
  ]);
  await expect(
    page.getByText(
      /Your save completed. Waiting for the saved version to sync/,
    ),
  ).toHaveCount(0);
  await check();
});

test("coalesced newer saved version can be explicitly loaded without waiting forever for an intermediate echo", async ({
  page,
}) => {
  const check = await harness(page, "queryafter");
  await summary(page).fill(
    "Version B saved before a separate device writes version C.",
  );
  await page
    .getByRole("button", { name: "Save deliverable", exact: true })
    .click();
  await event(page, "finish", true);
  await expect(
    page.getByText("Submission saved. The sponsor can now review it."),
  ).toBeVisible();
  await summary(page).fill(
    "My local draft must remain untouched until I choose to load C.",
  );
  // The subscription skips B and directly observes another authoritative row.
  await event(page, "update");
  await expect(summary(page)).toHaveValue(
    "My local draft must remain untouched until I choose to load C.",
  );
  await expect(
    page.getByRole("button", { name: "Save deliverable", exact: true }),
  ).toBeDisabled();
  const load = page.getByRole("button", {
    name: "Load latest saved version",
    exact: true,
  });
  await expect(load).toBeEnabled();
  await load.click();
  await expect(summary(page)).toHaveValue(
    "A newer remote saved deliverable; never replace a dirty draft.",
  );
  await expect(
    page.getByText(
      /Your save completed. Waiting for the saved version to sync/,
    ),
  ).toHaveCount(0);
  await summary(page).fill(
    "Version D is an explicit new edit after loading the latest saved version.",
  );
  await page
    .getByRole("button", { name: "Save deliverable", exact: true })
    .click();
  await event(page, "finish", true);
  await event(page, "publish");
  await expect(
    page.getByText(
      /Your save completed. Waiting for the saved version to sync/,
    ),
  ).toHaveCount(0);
  await expect(summary(page)).toHaveValue(
    "Version D is an explicit new edit after loading the latest saved version.",
  );
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { submissionCalls: unknown[] }).submissionCalls
          .length,
    ),
  ).toBe(2);
  await check();
});

test("authentication loading and sign-out hide private editing immediately", async ({
  page,
}) => {
  const check = await harness(page);
  await summary(page).fill(
    "A draft that must not show during an identity transition.",
  );
  await event(page, "identity", { actor: "contributor", loading: true });
  await expect(url(page)).toHaveCount(0);
  await event(page, "identity", { actor: "guest" });
  await expect(
    page.getByText("Submit or view your deliverable", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Original privately submitted research summary.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await check();
});
test("pending save cannot be submitted twice and old completion never overwrites another account", async ({
  page,
}) => {
  const check = await harness(page, "pending");
  await summary(page).fill(
    "A single pending save belonging to the original author.",
  );
  await page
    .getByRole("button", { name: "Save deliverable", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await expect(url(page)).toBeDisabled();
  await event(page, "identity", { actor: "other" });
  await expect(summary(page)).toHaveValue(
    "A separate account's private saved deliverable.",
  );
  await event(page, "finish", true);
  await expect(summary(page)).toHaveValue(
    "A separate account's private saved deliverable.",
  );
  await expect(
    page.getByText("Submission saved. The sponsor can now review it."),
  ).toHaveCount(0);
  await check();
});
