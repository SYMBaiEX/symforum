import { describe, expect, test } from "vitest";
import { GET } from "./route";
import { GET as standalone } from "@/apps/forum/app/api/agents/x/callback/route";

describe("X authorization callback on both website surfaces", () => {
  test.each([GET, standalone])(
    "moves a valid result to the fixed owner page without rendering the code",
    async (handler) => {
      const response = handler(
        new Request(
          `https://forum.symbaiex.com/api/agents/x/callback?state=${"a".repeat(64)}&code=synthetic-code`,
        ),
      );
      expect(response.status).toBe(303);
      const location = new URL(response.headers.get("location")!);
      expect(location.origin).toBe("https://forum.symbaiex.com");
      expect(location.pathname).toBe("/control-panel/x-accounts");
      expect(location.search).toBe("");
      expect(location.hash).toContain("x_code=synthetic-code");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("");
    },
  );
});
