import { describe, expect, test } from "vitest";
import { serializeJsonLd } from "@/lib/seo";

describe("serializeJsonLd", () => {
  test("escapes script-breaking characters", () => {
    const serialized = serializeJsonLd({
      description: "</script><script>alert(1)</script> & more",
    });

    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c/script\\u003e");
    expect(serialized).toContain("\\u0026");
  });
});
