import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { HOME_FAQS } from "@/lib/seo";

import { HomeFaq } from "./home-faq";

describe("HomeFaq", () => {
  test("renders a native collapsible list and the agent resource copy", () => {
    const html = renderToStaticMarkup(<HomeFaq />);

    expect(html.match(/<details/g)).toHaveLength(HOME_FAQS.length);
    expect(html).toContain("I build public software, AI systems, and research");
    expect(html).toContain('href="/developers"');
    expect(html).toContain(
      'href="https://github.com/SYMBaiEX/symbaiex-agent-clients"',
    );
  });
});
