import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
let document: {
  html: string;
  csp: string;
  middleware: Record<string, { html: string; csp: string }>;
};
test.beforeAll(() => {
  document = JSON.parse(
    execFileSync(
      "bun",
      [
        "-e",
        'import {mock} from "bun:test";mock.module("server-only",()=>({}));process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLED="true";process.env.NODE_ENV="production";globalThis.fetch=()=>{throw Error("Network denied")};const {NextRequest}=await import("next/server");const proxy=(await import("./proxy")).default;const {researchReportHtml,researchReportCsp}=await import("./lib/forum-research-report-html");const {reportReceipt}=await import("./tests/e2e/fixtures/research-report-view");const middleware={};for(const host of ["forum","platform"]){const request=new NextRequest(`https://${host==="forum"?"forum":"www"}.symbaiex.com/api/research/token/${reportReceipt.intentKey}/view`);const response=await proxy(request);middleware[host]={csp:response.headers.get("content-security-policy"),html:researchReportHtml(reportReceipt,response.headers.get("x-middleware-request-x-nonce"))};}process.stdout.write(JSON.stringify({html:researchReportHtml(reportReceipt),csp:researchReportCsp(),middleware}));',
      ],
      { encoding: "utf8" },
    ),
  );
});
for (const width of [320, 390])
  for (const origin of [
    "https://forum.symbaiex.test",
    "https://platform.symbaiex.test",
  ]) {
    test(`static private reader ${origin} ${width}: original facts, bounds and keyboard`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const denied: string[] = [],
        errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => {
        if (route.request().url() === origin + "/report")
          return route.fulfill({
            status: 200,
            headers: {
              "content-type": "text/html",
              "content-security-policy":
                document.middleware[
                  origin.includes("forum") ? "forum" : "platform"
                ].csp,
              "cache-control": "private, no-store",
            },
            body: document.middleware[
              origin.includes("forum") ? "forum" : "platform"
            ].html,
          });
        denied.push(route.request().url());
        return route.abort();
      });
      await page.goto(origin + "/report");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Invented frozen token report <not live>",
      );
      await expect(
        page.getByText("$0.0000000001", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("$0", { exact: true })).toBeVisible();
      await expect(page.locator("time").first()).toHaveAttribute(
        "datetime",
        "2024-01-01T01:01:30.000Z",
      );
      expect(await page.locator("script,img,iframe").count()).toBe(0);
      const geometry = await page.locator("main,main *").evaluateAll((nodes) =>
        nodes
          .filter((n) => n.getClientRects().length)
          .map((n) => ({
            tag: n.tagName,
            x: n.getBoundingClientRect().left,
            right: n.getBoundingClientRect().right,
            width: n.clientWidth,
            scroll: n.scrollWidth,
          }))
          .filter(
            (r) =>
              r.x < -1 || r.right > innerWidth + 1 || r.scroll > r.width + 1,
          ),
      );
      expect(geometry).toEqual([]);
      const source = page.getByRole("link").first();
      await page.keyboard.press("Tab");
      await expect(source).toBeFocused();
      expect(
        await source.evaluate((n) => getComputedStyle(n).outlineStyle),
      ).not.toBe("none");
      for (const link of await page.getByRole("link").all()) {
        const box = await link.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
      }
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", {
          name: "Open original JSON report and receipt",
        }),
      ).toBeFocused();
      expect(denied).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
test("reader needs no JavaScript or external assets", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 568 },
  });
  const page = await context.newPage();
  const denied: string[] = [];
  await page.route("**/*", (route) =>
    route.request().url() === "https://reader.test/"
      ? route.fulfill({
          contentType: "text/html",
          body: document.html,
          headers: { "Content-Security-Policy": document.csp },
        })
      : (denied.push(route.request().url()), route.abort()),
  );
  await page.goto("https://reader.test/");
  await expect(
    page.getByRole("heading", { name: "Recorded facts" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Open original JSON report and receipt" })
    .focus();
  await expect(
    page.getByRole("link", { name: "Open original JSON report and receipt" }),
  ).toBeFocused();
  expect(denied).toEqual([]);
  await context.close();
});

test("reader styles survive an existing middleware nonce policy", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const denied: string[] = [];
  await page.route("**/*", (route) => {
    if (route.request().url() !== "https://reader.test/") {
      denied.push(route.request().url());
      return route.abort();
    }
    return route.fulfill({
      contentType: "text/html",
      body: document.middleware.forum.html,
      headers: { "Content-Security-Policy": document.middleware.forum.csp },
    });
  });
  await page.goto("https://reader.test/");
  expect(
    await page
      .locator("main")
      .evaluate((node) => getComputedStyle(node).paddingLeft),
  ).toBe("16px");
  expect(await page.evaluate(() => globalThis.document.referrer)).toBe("");
  expect(
    await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content"),
  ).toContain("script-src 'none'");
  expect(
    await page.locator('meta[name="referrer"]').getAttribute("content"),
  ).toBe("no-referrer");
  // Even a script bearing the upstream nonce is blocked by the intersecting
  // reader policy. This sentinel has no I/O, financial or provider callback.
  const ran = await page.evaluate(() => {
    const node = globalThis.document.createElement("script");
    node.nonce = globalThis.document.querySelector("style")!.nonce;
    node.textContent = "globalThis.__readerSentinelExecuted=true";
    globalThis.document.body.append(node);
    return Reflect.get(globalThis, "__readerSentinelExecuted");
  });
  expect(ran).toBeUndefined();
  expect(denied).toEqual([]);
});
