import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
let script: string, css: string;
test.beforeAll(() => {
  css =
    FORUM_SHARED_THEME_CSS +
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
      `const r=await Bun.build({entrypoints:["tests/e2e/fixtures/forum-gallery-lifecycle.tsx"],target:"browser",format:"iife",define:{"process.env.NODE_ENV":JSON.stringify("production")}});if(!r.success)throw Error(r.logs.join("\\n"));process.stdout.write(await r.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
});
async function harness(page: Page) {
  const errors: string[] = [],
    unexpected: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:43237" && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (
      url.origin === "http://127.0.0.1:43237" &&
      url.pathname === "/fixture.js"
    )
      return route.fulfill({ contentType: "text/javascript", body: script });
    if (
      url.origin === "https://gallery.invalid" &&
      /^\/[ABC]\.png$/.test(url.pathname)
    )
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
    unexpected.push(url.href);
    return route.abort();
  });
  await page.goto("http://127.0.0.1:43237/");
  await expect(
    page.getByRole("button", {
      name: "View image 2 of 3: Illustration B",
      exact: true,
    }),
  ).toBeVisible();
  return () => {
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  };
}
async function change(page: Page, ids: string[]) {
  await page.evaluate(
    (ids) =>
      window.dispatchEvent(new CustomEvent("gallery:set", { detail: ids })),
    ids,
  );
}
const openB = (page: Page) =>
  page
    .getByRole("button", {
      name: "View image 2 of 3: Illustration B",
      exact: true,
    })
    .click();
test("selection follows exact attachment identity across reorder and removal never shows a replacement", async ({
  page,
}) => {
  const check = await harness(page);
  await openB(page);
  await change(page, ["C", "A", "B"]);
  await expect(
    page.getByRole("button", {
      name: "View image 3 of 3: Illustration B",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("dialog").getByRole("img", { name: /Illustration/ }),
  ).toHaveAttribute("src", "https://gallery.invalid/B.png");
  await change(page, ["C", "A"]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "View image 1 of 2: Illustration C",
      exact: true,
    }),
  ).toBeFocused();
  await change(page, ["C", "A", "B"]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  check();
});
test("Escape returns to visible trigger or gallery fallback after all attachments disappear", async ({
  page,
}) => {
  const check = await harness(page);
  await openB(page);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", {
      name: "View image 2 of 3: Illustration B",
      exact: true,
      includeHidden: true,
    }),
  ).toBeFocused();
  await openB(page);
  await page
    .getByRole("button", {
      name: "View image 2 of 3: Illustration B",
      exact: true,
      includeHidden: true,
    })
    .evaluate((node) => ((node as HTMLElement).style.display = "none"));
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", {
      name: "View image 1 of 3: Illustration A",
      exact: true,
    }),
  ).toBeFocused();
  await page
    .getByRole("button", {
      name: "View image 1 of 3: Illustration A",
      exact: true,
    })
    .click();
  await change(page, []);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Attachments are no longer available.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Attachments", exact: true }),
  ).toBeFocused();
  check();
});
test("an unused empty gallery adds no blank focus region and does not steal focus", async ({
  page,
}) => {
  const check = await harness(page);
  await page
    .getByRole("button", { name: "After gallery", exact: true })
    .click();
  await change(page, []);
  await expect(
    page.getByRole("group", { name: "Attachments", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "After gallery", exact: true }),
  ).toBeFocused();
  check();
});
test("deliberate rapid navigation announces one concise position without renaming the dialog", async ({
  page,
}) => {
  const check = await harness(page);
  await openB(page);
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Image viewer");
  await expect(page.getByRole("status")).toHaveText("");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("status")).toHaveText(
    "Image 3 of 3: Illustration C",
  );
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.getByRole("dialog").getByRole("img", { name: /Illustration/ }),
  ).toHaveAttribute("src", "https://gallery.invalid/A.png");
  await expect(page.getByRole("status")).toHaveText(
    "Image 1 of 3: Illustration A",
  );
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Image viewer");
  await page.getByRole("button", { name: "Next image", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Image 2 of 3: Illustration B",
  );
  check();
});
for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  for (const reducedMotion of ["reduce", "no-preference"] as const)
    test(`gallery controls fit ${viewport.width}x${viewport.height} with motion ${reducedMotion}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion });
      const check = await harness(page);
      await openB(page);
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.evaluate(async (node) => {
        await Promise.all(
          node
            .getAnimations()
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      for (const button of [
        page.getByRole("button", { name: "Close", exact: true }),
        page.getByRole("button", { name: "Previous image", exact: true }),
        page.getByRole("button", { name: "Next image", exact: true }),
      ]) {
        const rect = await button.boundingBox();
        expect(rect!.width).toBeGreaterThanOrEqual(44);
        expect(rect!.height).toBeGreaterThanOrEqual(44);
        expect(rect!.x).toBeGreaterThanOrEqual(0);
        expect(rect!.y).toBeGreaterThanOrEqual(0);
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width);
        expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height + 1);
      }
      if (reducedMotion === "reduce")
        await expect(dialog).toHaveCSS("animation-name", "none");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      check();
    });
