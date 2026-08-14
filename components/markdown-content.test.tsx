import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { MarkdownContent } from "./markdown-content";

describe("MarkdownContent headings", () => {
  test("can demote mirrored Markdown headings below a page H1", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={"# Primary heading\n\n## Section heading"}
        headingLevelOffset={1}
      />,
    );

    expect(html).toContain("<h2");
    expect(html).toContain("<h3");
    expect(html).not.toContain("<h1");
  });
});
