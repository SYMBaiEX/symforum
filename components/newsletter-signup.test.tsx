import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { NewsletterSignup } from "@/components/newsletter-signup";

describe("NewsletterSignup WebMCP metadata", () => {
  test("registers the single footer form as a user-confirmed declarative tool", () => {
    const markup = renderToStaticMarkup(
      <NewsletterSignup source="footer" variant="footer" />,
    );

    expect(markup).toContain('toolname="subscribe_symbaiex_newsletter"');
    expect(markup).toContain("tooldescription=");
    expect(markup).toContain('name="email"');
    expect(markup).toContain("toolparamdescription=");
    expect(markup).not.toContain("toolautosubmit");
  });

  test("does not duplicate the declarative tool on embedded signup forms", () => {
    const markup = renderToStaticMarkup(
      <NewsletterSignup source="newsletter-page" />,
    );

    expect(markup).not.toContain("toolname=");
    expect(markup).not.toContain("toolparamdescription=");
  });
});
