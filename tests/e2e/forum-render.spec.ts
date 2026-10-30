import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { matchForumRoute } from "../../lib/forum-native-routing";
import { FORUM_NATIVE_ROUTES } from "../../lib/forum-native-app.generated";

// Public snapshots only; no cookies, access tokens, private data or live writes.
const fixtures = JSON.parse(readFileSync("tests/e2e/fixtures/forum-public.json", "utf8"));
let FORUM_PLUGIN_APP_HTML: string, FORUM_PLUGIN_APP_SCRIPT: string, FORUM_PLUGIN_ASSET_ORIGIN: string;
let html: string;
test.beforeAll(async () => {
  // This branded snapshot must not depend on an operator's .env files. The
  // public URL enables the mocked MCP transport; every HTTP request is blocked
  // below unless it is one of the explicit fixture documents/assets.
  const previousInstallation = process.env.NEXT_PUBLIC_INSTALLATION_CONFIG;
  const previousBackend = process.env.NEXT_PUBLIC_CONVEX_URL;
  try {
    process.env.NEXT_PUBLIC_INSTALLATION_CONFIG = readFileSync("tests/fixtures/installation.symbaiex.json", "utf8");
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://strong-bee-384.convex.cloud";
    ({ FORUM_PLUGIN_APP_HTML, FORUM_PLUGIN_APP_SCRIPT, FORUM_PLUGIN_ASSET_ORIGIN } = await import("../../lib/forum-plugin-app"));
  } finally {
    if (previousInstallation === undefined) delete process.env.NEXT_PUBLIC_INSTALLATION_CONFIG;
    else process.env.NEXT_PUBLIC_INSTALLATION_CONFIG = previousInstallation;
    if (previousBackend === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL;
    else process.env.NEXT_PUBLIC_CONVEX_URL = previousBackend;
  }
  html = `<!doctype html><body style="margin:0"><iframe title="Forum fixture" style="border:0;width:100vw;height:100vh"></iframe><script>
const frame = document.querySelector('iframe');
window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow) return;
  const m = event.data;
  const reply = result => frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result},'*');
  if (m.method === 'ui/initialize') reply({protocolVersion:'2026-01-26',hostInfo:{name:'Isolated test host',version:'1'},hostCapabilities:{serverTools:{}},hostContext:{theme:'dark',displayMode:'fullscreen',availableDisplayModes:['fullscreen']}});
  if (m.method === 'ui/notifications/initialized') frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{content:[],structuredContent:{status:'completed',actingAs:null,data:{}}}},'*');
  if (m.method === 'tools/call') reply((${JSON.stringify(fixtures).replaceAll("<", "\\u003c")})[m.params.name] || {isError:true,content:[],structuredContent:{code:'AUTH_REQUIRED',error:'Connect a profile to continue.'}});
});
frame.src = '/forum-fixture';
</script>`;
});

for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
  test(`renders and navigates the shipped forum at ${viewport.width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize(viewport);
    // Every request is intercepted. This test cannot reach ChatGPT or mutate the forum.
    await page.route("**/*", route => {
      const url = route.request().url();
      if (url === "http://127.0.0.1:43191/") return route.fulfill({ contentType: "text/html", body: html });
      if (url === "http://127.0.0.1:43191/forum-fixture") return route.fulfill({contentType: "text/html", body: FORUM_PLUGIN_APP_HTML});
      if (url === `${FORUM_PLUGIN_ASSET_ORIGIN}/api/plugin/assets/current/forum.js`)
        return route.fulfill({ contentType: "text/javascript", body: FORUM_PLUGIN_APP_SCRIPT });
      return route.abort();
    });
    await page.goto("http://127.0.0.1:43191/");
    const app = page.frameLocator('iframe[title="Forum fixture"]');
    await expect(app.getByRole("heading", { name: "Feed", exact: true })).toBeVisible();
    expect(await app.locator("html").evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await expect(app.getByText("The connection could not continue")).toHaveCount(0);
    await expect(app.locator("#forum-app-startup")).toHaveCount(0);
    if (viewport.width >= 1280) {
      await app.getByRole("button", { name: "Collapse navigation" }).click();
      const rail = app.getByRole("complementary", { name: "Forum navigation" });
      for (const name of ["Start here", "$SYMF", "Swap tokens"]) {
        const link = rail.getByRole("link", { name, exact: true });
        await expect(link).toBeVisible();
        await expect(link.locator("svg")).toBeVisible();
        await expect(link.locator(".forum-nav-label")).toBeHidden();
        expect(await link.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      }
      const active = rail.locator('[aria-current="page"]').first();
      expect(await active.evaluate(el => getComputedStyle(el, "::before").content)).toBe("none");
      await page.screenshot({ path: "tmp/forum-render-tests/navigation-collapsed.png" });
      await app.getByRole("button", { name: "Expand navigation" }).click();
    }
    // Validate all rendered internal links against the real shared route catalog.
    for (const href of await app.locator("a[href]").evaluateAll(elements => elements.map(a => a.getAttribute("href")))) {
      if (!href || !href.startsWith("/forum")) continue;
      expect(matchForumRoute(FORUM_NATIVE_ROUTES.map(r => ({ ...r, path: r.path })), href.split(/[?#]/)[0]), `Dead native forum route: ${href}`).toBeTruthy();
    }
    await app.getByRole("link", { name: "Start here", exact: true }).first().click();
    await expect(app.getByRole("heading", { name: "Start with one good conversation.", exact: true })).toBeVisible();
    await expect(app.getByRole("link", { name: "Introduce yourself", exact: true })).toBeVisible();
    await expect(app.getByRole("link", { name: "Official $SYMF announcement", exact: true })).toBeVisible();
    expect(await app.locator("html").evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `tmp/forum-render-tests/start-here-${viewport.width}.png` });
    // The same dead-link check covers the guide, not just the default feed.
    for (const href of await app.locator("a[href]").evaluateAll(elements => elements.map(a => a.getAttribute("href")))) {
      if (!href || !href.startsWith("/forum")) continue;
      expect(matchForumRoute(FORUM_NATIVE_ROUTES.map(r => ({ ...r, path: r.path })), href.split(/[?#]/)[0]), `Dead onboarding route: ${href}`).toBeTruthy();
    }
    await app.getByRole("link", { name: "Boards", exact: true }).click();
    await expect(app.getByRole("heading", { name: "Boards", exact: true })).toBeVisible();
    await app.locator('a[href="/forum?view=news"]:visible').getByText("News", { exact: true }).click();
    await expect(app.getByRole("heading", { name: "News", exact: true }).first()).toBeVisible();
    await page.screenshot({ path: `tmp/forum-render-tests/forum-${viewport.width}.png` });
    expect(errors).toEqual([]);
  });
}

test("blocked UI bundle leaves a visible recovery message", async ({ page }) => {
  await page.route("**/*", route => route.request().url() === "http://127.0.0.1:43191/"
    ? route.fulfill({ contentType: "text/html", body: html }) : route.request().url() === "http://127.0.0.1:43191/forum-fixture"
    ? route.fulfill({contentType: "text/html", body: FORUM_PLUGIN_APP_HTML}) : route.abort());
  await page.goto("http://127.0.0.1:43191/");
  const app = page.frameLocator('iframe[title="Forum fixture"]');
  await expect(app.getByRole("status")).toContainText("could not start");
  await expect(app.getByRole("link", { name: "Open the forum website" })).toBeVisible();
});
