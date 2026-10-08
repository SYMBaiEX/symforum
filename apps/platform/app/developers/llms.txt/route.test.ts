import { describe, expect, test } from "vitest";

import { GET } from "./route";

describe("developer llms index", () => {
  test("links the published CLI release to its dedicated integration guide", async () => {
    const response = GET();
    const content = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(content).toContain("https://www.symbaiex.com/developers/cli");
    expect(content).toContain("@symbaiex/agent-cli@0.1.0 manifest");
    expect(content).toContain(
      "token handling and supported release boundaries",
    );
  });
});
