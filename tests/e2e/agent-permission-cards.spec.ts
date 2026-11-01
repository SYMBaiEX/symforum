import { test, expect, type Page, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43264";
let script: string;
const css: Record<string, string> = {};
const audits = new WeakMap<Page, { errors: string[]; external: string[] }>();
test.beforeAll(() => {
  for (const app of ["platform", "forum"])
    css[app] =
      FORUM_SHARED_THEME_CSS +
      readFileSync("styles/forum-shared.css", "utf8") +
      execFileSync(
        "bun",
        [
          "-e",
          `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./${app === "forum" ? "apps/forum/tailwind.config.ts" : "tailwind.config.ts"}";config.content=["./components/**/*.{ts,tsx}","./packages/forum-ui/src/**/*.{ts,tsx}"];const css=(await Bun.file("apps/${app}/app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
        ],
        { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 },
      );
  const baseline =
    process.env.AGENT_PERMISSION_CARDS_BASELINE === "1"
      ? execFileSync(
          "git",
          ["show", "0beb8049:components/forum/forum-agent-access.tsx"],
          { encoding: "utf8" },
        )
      : null;
  script = execFileSync(
    "bun",
    [
      "-e",
      `const baseline=${JSON.stringify(baseline)};const r=await Bun.build({entrypoints:["tests/e2e/fixtures/agent-permission-cards.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"inert-permission-cards",setup(build){if(baseline)build.onLoad({filter:/forum-agent-access\\.tsx$/},()=>({contents:baseline,loader:"tsx"}));build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|^next\\/link$|forum-plugin-selection$|forum-primitives$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/agent-permission-cards-state.tsx"}));}}]});if(!r.success)throw Error(r.logs.join("\\n"));process.stdout.write(await r.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 },
  );
});
async function open(page: Page, scenario = "owner", app = "platform") {
  const audit = { errors: [] as string[], external: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    audit.external.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/?scenario=${scenario}`);
}
test.afterEach(async ({ page }) => {
  const audit = audits.get(page);
  if (audit) {
    expect(audit.errors).toEqual([]);
    expect(audit.external).toEqual([]);
  }
  if (audit)
    expect(
      await page.evaluate(() => window.agentPermissions.evidence.forbidden),
    ).toEqual([]);
});
const active = (page: Page) =>
  page.locator(".forum-connection-card").filter({
    has: page.getByRole("heading", { name: "Owner A", exact: true }),
  });
const saved = (card: Locator) =>
  card.getByRole("region", {
    name: "Saved connection permissions",
    exact: true,
  });
const requested = (card: Locator) =>
  card.getByRole("region", {
    name: "Requested permission summary",
    exact: true,
  });
async function edit(card: Locator) {
  const summary = card.getByText(
    "Edit execution mode, identity and permissions",
    { exact: true },
  );
  await summary.focus();
  await summary.press("Enter");
  await expect(requested(card)).toBeVisible();
}
test("all original queries, mutations, handlers, defaults, ceilings and busy/auth gates remain byte-identical", () => {
  const before = execFileSync(
    "git",
    ["show", "0beb8049:components/forum/forum-agent-access.tsx"],
    { encoding: "utf8" },
  );
  const after = readFileSync("components/forum/forum-agent-access.tsx", "utf8");
  function authority(source: string) {
    const tree = ts.createSourceFile(
      "access.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const entries: string[] = [];
    function walk(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        /^(useQuery|useMutation|useConvexAuth|useEffect|useState|useForumRuntime|useForumBrowserConnectionId)$/.test(
          node.expression.getText(tree),
        )
      )
        entries.push(node.getText(tree));
      if (
        ts.isJsxAttribute(node) &&
        /^(onClick|onChange|onSubmit|disabled|ceiling|allowNewAgent|checked)$/.test(
          node.name.getText(tree),
        )
      )
        entries.push(node.getText(tree));
      if (
        ts.isFunctionDeclaration(node) &&
        /^(createConnection|save|disconnect|resolve)$/.test(
          node.name?.text ?? "",
        )
      )
        entries.push(node.getText(tree));
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText(tree) === "DEFAULT_FORUM_CONNECTION_OPTIONS"
      )
        entries.push(node.getText(tree));
      ts.forEachChild(node, walk);
    }
    walk(tree);
    return entries;
  }
  expect(authority(after)).toEqual(authority(before));
  expect(authority(after).length).toBeGreaterThan(60);
});
test("edited requests never masquerade as saved permission grants, and original payload/busy gates remain intact", async ({
  page,
}) => {
  await open(page);
  const card = active(page);
  await expect(saved(card)).toContainText("Active record");
  await expect(saved(card)).toContainText("Saved mode: Require review");
  await edit(card);
  await card
    .getByRole("checkbox", { name: /^Profile and saved items/ })
    .check();
  await card.getByRole("combobox").selectOption("agent:agent-a");
  await card.getByRole("radio", { name: /^Direct execution/ }).check();
  await expect(requested(card)).toContainText(
    "Requested settings · editor values only",
  );
  await expect(requested(card)).toContainText("agent-a");
  await expect(requested(card)).toContainText("Profile and saved items");
  await expect(requested(card)).toContainText("Requested Direct execution");
  await expect(saved(card)).not.toContainText(
    "Saved permissions: Browse and search, Post and reply, Profile and saved items",
  );
  await expect(saved(card)).toContainText("Saved acting profile: Owner A");
  await expect(saved(card)).toContainText("Saved mode: Require review");
  await expect(
    card.getByRole("checkbox", { name: /^Private messages/ }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => window.agentPermissions.evidence.mutations),
  ).toEqual([]);
  await card
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  expect(
    await page.evaluate(() => window.agentPermissions.evidence.mutations),
  ).toEqual([
    {
      name: "forumPluginAccess:updateConnection",
      args: {
        actorMode: "agent",
        agentId: "agent-a",
        capabilities: ["read", "participate", "personal"],
        executionMode: "direct",
        connectionId: "active-browser",
      },
    },
  ]);
  await expect(card.getByRole("combobox")).toBeDisabled();
  await expect(
    card.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => window.agentPermissions.settle(0, true));
  await expect(
    card.getByText("Connection saved.", { exact: true }),
  ).toBeVisible();
  await expect(saved(card)).toContainText("Saved mode: Require review");
  await page.evaluate(() =>
    window.agentPermissions.connection(0, {
      policyVersion: 2,
      executionMode: "direct",
      capabilities: ["read", "personal"],
    }),
  );
  await expect(saved(card)).toContainText("Saved mode: Direct execution");
  await expect(saved(card)).toContainText(
    "Saved permissions: Browse and search, Profile and saved items",
  );
});
test("pending and revoked records remain historical/non-active with no edit or disconnect authority", async ({
  page,
}) => {
  await open(page);
  const pending = page
    .locator(".forum-connection-card")
    .filter({ hasText: "Pending agent" });
  const revoked = page
    .locator(".forum-connection-card")
    .filter({ hasText: "Revoked agent" });
  await expect(saved(pending)).toContainText(
    "Pending record: listed permissions are not active authorization",
  );
  await expect(saved(revoked)).toContainText(
    "Revoked record: listed permissions are historical",
  );
  for (const card of [pending, revoked]) {
    await expect(
      card.getByRole("button", { name: "Disconnect", exact: true }),
    ).toHaveCount(0);
    await expect(
      card.getByText("Edit execution mode, identity and permissions", {
        exact: true,
      }),
    ).toHaveCount(0);
  }
  await expect(saved(active(page))).toContainText(
    "Use Disconnect above to revoke this connection",
  );
  await expect(saved(active(page))).toContainText(
    "not authorize wallet signing",
  );
});
test("existing disconnect entry sends only its connection ID through an inert adapter", async ({
  page,
}) => {
  await open(page);
  const card = active(page);
  await card.getByRole("button", { name: "Disconnect", exact: true }).click();
  expect(
    await page.evaluate(() => window.agentPermissions.evidence.mutations),
  ).toEqual([
    {
      name: "forumPluginAccess:revokeConnection",
      args: { connectionId: "active-browser" },
    },
  ]);
  await page.evaluate(() => window.agentPermissions.settle(0, false));
  await expect(card.getByRole("alert")).toContainText(
    "Inert disconnect failure",
  );
  await expect(saved(card)).toContainText("Active record");
});
test("new browser requested defaults preserve exact opt-in payload and no mutation runs before submission", async ({
  page,
}) => {
  await open(page);
  const summary = page.getByText("Enable a browser connection", {
    exact: true,
  });
  await summary.focus();
  await summary.press("Enter");
  const form = summary.locator("..");
  await expect(requested(form)).toContainText("My own profile");
  await expect(requested(form)).toContainText("Requested Direct execution");
  await expect(
    form.getByRole("checkbox", { name: /^Private messages/ }),
  ).not.toBeChecked();
  expect(
    await page.evaluate(() => window.agentPermissions.evidence.mutations),
  ).toEqual([]);
  await form
    .getByRole("button", { name: "Enable agent access", exact: true })
    .click();
  expect(
    await page.evaluate(() => window.agentPermissions.evidence.mutations),
  ).toEqual([
    {
      name: "forumPluginAccess:createBrowserConnection",
      args: {
        actorMode: "human",
        executionMode: "direct",
        capabilities: [
          "read",
          "participate",
          "personal",
          "feedback",
          "attachments",
        ],
      },
    },
  ]);
  await page.evaluate(() => window.agentPermissions.settle(0, true));
  expect(
    await page.evaluate(() => window.agentPermissions.evidence.selections),
  ).toEqual(["inert-created"]);
});
for (const mode of ["review", "direct", "unknown"])
  test(`plugin ${mode} reports supplied values without private owner authority or invented connection status`, async ({
    page,
  }) => {
    await open(page, `plugin-${mode}`);
    const region = page.getByRole("region", {
      name: "Permissions reported by this surface",
    });
    await expect(region).toBeVisible();
    await expect(region).toContainText(
      "Connection status and consent ceiling: Not provided by this surface",
    );
    await expect(region).toContainText(
      mode === "unknown"
        ? "Execution mode: Not provided"
        : mode === "review"
          ? "Reported mode: Require review"
          : "Reported mode: Direct execution",
    );
    if (mode === "unknown")
      await expect(region).toContainText("Permissions: Not provided");
    await expect(
      page.getByRole("button", { name: "Disconnect", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(
      page.getByRole("link", {
        name: "Manage connection & approvals ↗",
        exact: true,
      }),
    ).toHaveAttribute(
      "href",
      "https://forum.symbaiex.com/control-panel/agent-access#review-queue",
    );
    expect(
      await page.evaluate(() => window.agentPermissions.evidence.reads),
    ).toEqual([]);
    expect(
      await page.evaluate(() => window.agentPermissions.evidence.mutations),
    ).toEqual([]);
  });
for (const [scenario, message] of [
  ["guest", "Sign in required"],
  ["loading", "Checking your account"],
  ["connections-loading", "Loading agent access"],
  ["agent", "Owner account required"],
  ["plugin-guest", "Connect your forum profile"],
  ["disabled", "Forum unavailable"],
])
  test(`${scenario} does not expose owner permission cards or write authority`, async ({
    page,
  }) => {
    await open(page, scenario);
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(page.locator(".forum-connection-card")).toHaveCount(0);
    expect(
      await page.evaluate(() => window.agentPermissions.evidence.mutations),
    ).toEqual([]);
    const reads = await page.evaluate(() =>
      window.agentPermissions.evidence.reads.map((entry) => entry.name),
    );
    if (scenario === "agent") expect(reads).toEqual(["users:maybeViewer"]);
    else if (scenario !== "connections-loading") expect(reads).toEqual([]);
  });
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} ${width}px saved/requested cards and keyboard targets remain bounded with actual forum surface CSS`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, "owner", app);
      const card = active(page);
      await edit(card);
      const targets = card.locator("button, select, summary, label");
      for (const target of await targets.all()) {
        await target.scrollIntoViewIfNeeded();
        const box = (await target.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      for (const panel of [card, saved(card), requested(card)]) {
        const box = (await panel.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(
          await panel.evaluate(
            (node) => node.scrollWidth <= node.clientWidth + 1,
          ),
        ).toBe(true);
      }
      const review = card.getByRole("radio", { name: /^Require review/ });
      await review.focus();
      await page.keyboard.press("ArrowLeft");
      await expect(
        card.getByRole("radio", { name: /^Direct execution/ }),
      ).toBeChecked();
      await expect(requested(card)).toContainText("Requested Direct execution");
      await expect(saved(card)).toContainText("Saved mode: Require review");
      expect(
        await page.evaluate(() => window.agentPermissions.evidence.mutations),
      ).toEqual([]);
      const enableSummary = page.getByText("Enable a browser connection", {
        exact: true,
      });
      await enableSummary.focus();
      await enableSummary.press("Enter");
      const enable = enableSummary
        .locator("..")
        .getByRole("button", { name: "Enable agent access", exact: true });
      await enable.scrollIntoViewIfNeeded();
      const enableBox = (await enable.boundingBox())!;
      expect(enableBox.height).toBeGreaterThanOrEqual(44);
      expect(enableBox.x).toBeGreaterThanOrEqual(0);
      expect(enableBox.x + enableBox.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: `tmp/forum-render-tests/permission-cards-${app}-${width}.png`,
        fullPage: true,
      });
    });
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} ${width}px plugin reports only supplied permissions and keeps owner-management navigation keyboard accessible`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, "plugin-review", app);
      const region = page.getByRole("region", {
        name: "Permissions reported by this surface",
      });
      const link = region.getByRole("link", {
        name: "Manage connection & approvals ↗",
        exact: true,
      });
      await link.focus();
      await expect(link).toBeFocused();
      await link.scrollIntoViewIfNeeded();
      for (const target of [region, link]) {
        const box = (await target.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(
          await target.evaluate(
            (node) => node.scrollWidth <= node.clientWidth + 1,
          ),
        ).toBe(true);
      }
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(() => window.agentPermissions.evidence.reads),
      ).toEqual([]);
      expect(
        await page.evaluate(() => window.agentPermissions.evidence.mutations),
      ).toEqual([]);
    });
