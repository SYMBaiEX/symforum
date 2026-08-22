import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeBanner } from "./home-banner";
import { SignalMothPet } from "./signal-moth-pet";

describe("SignalMothPet", () => {
  it("renders the animated sprite sheet from the first frame", () => {
    const html = renderToStaticMarkup(<SignalMothPet />);

    expect(html).toContain('class="signal-moth-track is-ready"');
    expect(html).not.toContain("is-acting");
  });

  it("preloads the optimized sprite sheet on the landing page", () => {
    const html = renderToStaticMarkup(<HomeBanner />);

    expect(html).toContain(
      'href="/images/pets/signal-moth-optimized.webp"',
    );
    expect(html).toContain('rel="preload"');
    expect(html).toContain('fetchPriority="high"');
  });
});
