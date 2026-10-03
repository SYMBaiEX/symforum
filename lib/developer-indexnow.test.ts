import { describe, expect, test } from "vitest";
import {
  DEVELOPER_INDEX_URLS,
  developerIndexNowPayload,
} from "./developer-indexnow";
import { DEVELOPER_RESOURCES } from "./developer-resources";

describe("developer and product discovery indexing", () => {
  test("covers the changed homepage and canonical public guides, not owner sessions or arbitrary URLs", () => {
    const payload = developerIndexNowPayload("a".repeat(64));
    expect(payload.host).toBe("www.symbaiex.com");
    expect(payload.keyLocation).toBe(
      `https://www.symbaiex.com/indexnow-${"a".repeat(64)}.txt`,
    );
    expect(new Set(payload.urlList).size).toBe(18);
    expect(payload.urlList).toContain("https://www.symbaiex.com/");
    for (const path of [
      "/agents.md",
      "/auth.md",
      "/developers/llms.txt",
      "/llms.txt",
      "/llms-full.txt",
      "/skills.sh",
    ]) {
      expect(payload.urlList).toContain(`https://www.symbaiex.com${path}`);
    }
    for (const slug of Object.keys(DEVELOPER_RESOURCES))
      expect(payload.urlList).toContain(
        `https://www.symbaiex.com/developers/${slug}`,
      );
    for (const value of payload.urlList) {
      const url = new URL(value);
      expect(url.origin).toBe("https://www.symbaiex.com");
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
      expect(url.pathname).not.toMatch(
        /signin|claim|connect|admin|control-panel/,
      );
    }
    payload.urlList.pop();
    expect(DEVELOPER_INDEX_URLS).toHaveLength(18);
    expect(DEVELOPER_INDEX_URLS).not.toContain(
      "https://www.symbaiex.com/agent/instructions",
    );
  });

  test("enforces the published IndexNow key syntax and length", () => {
    for (const key of [
      "short",
      "a".repeat(129),
      "invalid_key",
      "bad/key=value",
      "https://evil.example",
    ])
      expect(() => developerIndexNowPayload(key)).toThrow();
  });
});
