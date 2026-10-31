import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
let script: string;
const css: Record<string, string> = {};
const origin = "http://127.0.0.1:43246";
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
      `const r=await Bun.build({entrypoints:["tests/e2e/fixtures/gallery-original-image.tsx"],target:"browser",format:"iife",define:{"process.env.NODE_ENV":JSON.stringify("production")}});if(!r.success)throw Error(r.logs.join("\\n"));process.stdout.write(await r.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
});
async function harness(page: Page, app = "platform") {
  const errors: string[] = [],
    unexpected: string[] = [],
    images: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}body{margin:0}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    if (
      url.origin === "https://gallery-original.invalid" &&
      /^\/[ABC](?:-new)?\.png$/.test(url.pathname) &&
      route.request().resourceType() === "image"
    ) {
      images.push(url.href);
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
    }
    unexpected.push(url.href);
    return route.abort();
  });
  await page.goto(origin);
  await expect(
    page.getByRole("button", {
      name: "View image 2 of 3: Illustration B",
      exact: true,
    }),
  ).toBeVisible();
  return {
    images,
    check: () => {
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
    },
  };
}
const link = (page: Page) =>
  page.getByRole("dialog").getByRole("link", { name: /^Open original image:/ });
async function openB(page: Page) {
  await page
    .getByRole("button", {
      name: "View image 2 of 3: Illustration B",
      exact: true,
    })
    .click();
}
async function settled(page: Page) {
  await page.getByRole("dialog").evaluate(async (node) => {
    await Promise.all(
      node
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
}
test("current authorized image has a safe contextual plain original link without extra traffic", async ({
  page,
}) => {
  const h = await harness(page);
  await openB(page);
  await expect(link(page)).toHaveAccessibleName(
    "Open original image: Illustration B",
  );
  await expect(link(page)).toHaveAttribute(
    "href",
    "https://gallery-original.invalid/B.png",
  );
  await expect(link(page)).toHaveAttribute("target", "_blank");
  await expect(link(page)).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link(page)).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(link(page)).toHaveText("Open original");
  expect(h.images.every((url) => /\/[ABC]\.png$/.test(url))).toBe(true);
  h.check();
});
test("navigation, reorder and same-ID URL replacement always retain current image identity", async ({
  page,
}) => {
  const h = await harness(page);
  await openB(page);
  await page.keyboard.press("ArrowRight");
  await expect(link(page)).toHaveAttribute(
    "href",
    "https://gallery-original.invalid/C.png",
  );
  await page.evaluate(() =>
    window.galleryOriginal.set([
      window.galleryOriginal.files.C,
      window.galleryOriginal.files.A,
      window.galleryOriginal.files.B,
    ]),
  );
  await expect(link(page)).toHaveAccessibleName(
    "Open original image: Illustration C",
  );
  await expect(link(page)).toHaveAttribute(
    "href",
    "https://gallery-original.invalid/C.png",
  );
  await page.evaluate(() =>
    window.galleryOriginal.set([
      {
        ...window.galleryOriginal.files.C,
        url: "https://gallery-original.invalid/C-new.png",
      },
      window.galleryOriginal.files.A,
    ]),
  );
  await expect(link(page)).toHaveAttribute(
    "href",
    "https://gallery-original.invalid/C-new.png",
  );
  await expect(
    page
      .getByRole("dialog")
      .getByRole("img", { name: "Illustration C", exact: true }),
  ).toHaveAttribute("src", "https://gallery-original.invalid/C-new.png");
  await page.evaluate(() =>
    window.galleryOriginal.set([window.galleryOriginal.files.A]),
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link")).toHaveCount(0);
  await page.evaluate(() =>
    window.galleryOriginal.set([
      window.galleryOriginal.files.C,
      window.galleryOriginal.files.A,
    ]),
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  h.check();
});
test("unsafe current replacement removes link and restores visible fallback focus", async ({
  page,
}) => {
  const h = await harness(page);
  await openB(page);
  await page.evaluate(() =>
    window.galleryOriginal.set([
      { ...window.galleryOriginal.files.B, url: "javascript:alert(1)" },
      {
        ...window.galleryOriginal.files.A,
        url: "http://gallery-original.invalid/A.png",
      },
      {
        ...window.galleryOriginal.files.C,
        url: "https://member:secret@gallery-original.invalid/C.png",
      },
    ]),
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link")).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Attachments", exact: true }),
  ).toBeFocused();
  h.check();
});
test("multiple-image Tab and ShiftTab remain trapped and Escape restores the original trigger", async ({
  page,
}) => {
  const h = await harness(page);
  await openB(page);
  await settled(page);
  await expect(
    page.getByRole("button", { name: "Previous image", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Next image", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(link(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Close", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Previous image", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Close", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", {
      name: "View image 2 of 3: Illustration B",
      exact: true,
    }),
  ).toBeFocused();
  h.check();
});
test("single-image original link is a keyboard stop and Escape preserves trigger focus", async ({
  page,
}) => {
  const h = await harness(page);
  await page.evaluate(() =>
    window.galleryOriginal.set([window.galleryOriginal.files.A]),
  );
  const trigger = page.getByRole("button", {
    name: "View image 1 of 1: Illustration A",
    exact: true,
  });
  await trigger.click();
  await settled(page);
  await expect(
    page.getByRole("button", { name: "Close", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(link(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Close", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  h.check();
});
test("existing image credit remains visible without footer overflow beside the new action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const h = await harness(page);
  await page.evaluate(() =>
    window.galleryOriginal.set([
      window.galleryOriginal.files.A,
      {
        ...window.galleryOriginal.files.B,
        credit: "OpenAI-generated illustration",
      },
      window.galleryOriginal.files.C,
    ]),
  );
  await openB(page);
  await settled(page);
  await expect(
    page.getByText("· OpenAI-generated illustration", { exact: false }),
  ).toBeVisible();
  const footer = page.locator(".forum-media-viewer-footer");
  expect(await footer.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(
    await footer.evaluate((el) => el.clientWidth),
  );
  const rect = (await link(page).boundingBox())!;
  expect(rect.x + rect.width).toBeLessThanOrEqual(320);
  expect(rect.y + rect.height).toBeLessThanOrEqual(569);
  h.check();
});
for (const app of ["platform", "forum"])
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ])
    test(`${app} original link and unchanged controls fit ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const h = await harness(page, app);
      await openB(page);
      await settled(page);
      for (const control of [
        link(page),
        page.getByRole("button", { name: "Previous image", exact: true }),
        page.getByRole("button", { name: "Next image", exact: true }),
        page.getByRole("button", { name: "Close", exact: true }),
      ]) {
        const rect = (await control.boundingBox())!;
        expect(rect.width).toBeGreaterThanOrEqual(44);
        expect(rect.height).toBeGreaterThanOrEqual(44);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
        expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 1);
        expect(
          await control.evaluate((el) => el.scrollWidth),
        ).toBeLessThanOrEqual(await control.evaluate((el) => el.clientWidth));
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(viewport.width);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      h.check();
    });
