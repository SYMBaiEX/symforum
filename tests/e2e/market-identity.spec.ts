import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import type { MarketChoice } from "../../components/trading/market-identity";

const origin = "http://127.0.0.1:43231";
const imageA = "https://images.example.test/logo-a.png";
const imageB = "https://images.example.test/logo-b.png";
const token: MarketChoice = {
  mint: "11111111111111111111111111111111",
  symbol: "AAA",
  name: "Fixture token",
  imageUrl: imageA,
};
let script: string;
test.beforeAll(() => {
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/market-identity.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})}});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".js"))process.stdout.write(await file.text());else if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");}`,
    ],
    { encoding: "utf8", maxBuffer: 6 * 1024 * 1024 },
  );
});

async function harness(page: Page, src?: string) {
  const images: string[] = [];
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: '<meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script>',
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    if (url.href === imageA) {
      images.push(url.href);
      return route.fulfill({ status: 404, body: "Fixture missing image" });
    }
    if (
      url.href === imageB ||
      (url.origin === origin && url.pathname === "/images/fixture-logo.svg")
    ) {
      images.push(url.href);
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>',
      });
    }
    unexpected.push(url.href);
    return route.abort();
  });
  await page.goto(
    `${origin}/${src === undefined ? "" : `?src=${encodeURIComponent(src)}`}`,
  );
  await expect(page.getByTestId("token-logo")).toBeVisible();
  return {
    images,
    check() {
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
    },
  };
}

async function replace(page: Page, patch: Partial<MarketChoice>) {
  await page.evaluate((next) => window.renderMarketIdentity(next), {
    ...token,
    ...patch,
  });
}

test("a replacement URL recovers after the original URL fails", async ({
  page,
}) => {
  const state = await harness(page);
  await expect(page.getByTestId("token-logo")).toHaveText("AA");
  expect(state.images).toEqual([imageA]);
  await replace(page, { imageUrl: imageB });
  const image = page.getByTestId("token-logo").locator("img");
  await expect(image).toHaveAttribute("src", imageB);
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBe(40);
  expect(state.images).toEqual([imageA, imageB]);
  await expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
  state.check();
});

test("the same failed URL stays on the symbol fallback across rerenders", async ({
  page,
}) => {
  const state = await harness(page);
  await expect(page.getByTestId("token-logo")).toHaveText("AA");
  for (const symbol of ["BBB", "CCC", "DDD"]) {
    await replace(page, { symbol });
    await expect(page.getByTestId("token-logo")).toHaveText(symbol.slice(0, 2));
    await expect(page.getByTestId("token-logo").locator("img")).toHaveCount(0);
  }
  expect(state.images).toEqual([imageA]);
  state.check();
});

test("a new exact mint resets the failed image state even for the same URL", async ({
  page,
}) => {
  const state = await harness(page);
  await expect(page.getByTestId("token-logo")).toHaveText("AA");
  await replace(page, {
    mint: "So11111111111111111111111111111111111111112",
    symbol: "NEW",
  });
  await expect.poll(() => state.images.length).toBe(2);
  await expect(page.getByTestId("token-logo")).toHaveText("NE");
  expect(state.images).toEqual([imageA, imageA]);
  state.check();
});

test("a late error from a replaced image cannot hide the current logo", async ({
  page,
}) => {
  const state = await harness(page, imageB);
  const image = page.getByTestId("token-logo").locator("img");
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBe(40);
  const previousImage = await image.elementHandle();
  expect(previousImage).not.toBeNull();
  await replace(page, { imageUrl: "/images/fixture-logo.svg" });
  await expect(image).toHaveAttribute(
    "src",
    `${origin}/images/fixture-logo.svg`,
  );
  await previousImage!.evaluate((node) =>
    node.dispatchEvent(new Event("error")),
  );
  await replace(page, {
    imageUrl: "/images/fixture-logo.svg",
    symbol: "CURRENT",
  });
  await expect(image).toHaveAttribute(
    "src",
    `${origin}/images/fixture-logo.svg`,
  );
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBe(40);
  expect(state.images).toEqual([imageB, `${origin}/images/fixture-logo.svg`]);
  state.check();
});

for (const src of [
  "http://images.example.test/logo.png",
  "javascript:alert(1)",
  "data:image/svg+xml,<svg/>",
  "blob:https://images.example.test/fixture",
  "//images.example.test/logo.png",
  "https://user:password@images.example.test/logo.png",
  "not-a-url",
  `https://images.example.test/${"a".repeat(2048)}`,
]) {
  test(`unsafe logo URL uses the fallback without requesting it: ${src.slice(0, 65)}`, async ({
    page,
  }) => {
    const state = await harness(page, src);
    await expect(page.getByTestId("token-logo")).toHaveText("AA");
    await expect(page.getByTestId("token-logo").locator("img")).toHaveCount(0);
    expect(state.images).toEqual([]);
    state.check();
  });
}

test("the existing local image prefix still loads normally", async ({
  page,
}) => {
  const state = await harness(page, "/images/fixture-logo.svg");
  const image = page.getByTestId("token-logo").locator("img");
  await expect(image).toHaveAttribute(
    "src",
    `${origin}/images/fixture-logo.svg`,
  );
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBe(40);
  expect(state.images).toEqual([`${origin}/images/fixture-logo.svg`]);
  state.check();
});
