import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HomeBanner } from "./home-banner";
import { SignalMothPet } from "./signal-moth-pet";

describe("SignalMothPet", () => {
  it("renders the animated sprite sheet from the first frame", () => {
    const html = renderToStaticMarkup(<SignalMothPet />);

    expect(html).toContain('class="signal-moth-track is-ready"');
    expect(html).not.toContain("is-acting");
  });

  it("renders the decorative sprite without preloading it", () => {
    const html = renderToStaticMarkup(<HomeBanner />);

    expect(html).toContain('class="signal-moth-track is-ready"');
    expect(html).not.toContain(
      'href="/images/pets/signal-moth-optimized.webp"',
    );
  });

  it("stacks footer controls before the compact two-column layout", () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/site-shell.tsx"),
      "utf8",
    );

    expect(source).toMatch(
      /grid-cols-1[^\n]*sm:grid-cols-\[minmax\(0,1fr\)_auto\]/,
    );
    expect(source).toContain("flex-wrap");
    expect(source).toContain("--site-footer-offset");
  });
});
