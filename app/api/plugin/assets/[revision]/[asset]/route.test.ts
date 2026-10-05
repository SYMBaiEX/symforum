import { describe, expect, test } from "vitest";
import { GET } from "./route";
import { FORUM_PLUGIN_APP_SCRIPT, FORUM_PLUGIN_APP_CSS, FORUM_PLUGIN_ASSET_REVISION } from "@/lib/forum-plugin-app";

function asset(revision: string, name: string) {
  return GET(new Request(`https://www.symbaiex.com/api/plugin/assets/${revision}/${name}`), { params: Promise.resolve({ revision, asset: name }) });
}
describe("public forum UI asset delivery", () => {
  test.each([["forum.js", "text/javascript", FORUM_PLUGIN_APP_SCRIPT], ["forum.css", "text/css", FORUM_PLUGIN_APP_CSS]])("serves exact generated %s bytes without credentials", async (name, type, source) => {
    const response = await asset(FORUM_PLUGIN_ASSET_REVISION, name);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain(type);
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe(source);
  });
  test("refreshes the complete current UI generation for previously cached loading documents", async () => {
    const response = await asset("current", "forum.js");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe(FORUM_PLUGIN_APP_SCRIPT);
  });
  test.each([["000000000000", "forum.js"], [FORUM_PLUGIN_ASSET_REVISION, "secrets.json"], [FORUM_PLUGIN_ASSET_REVISION, "../forum.js"]])("never serves mismatched or unrelated assets %s/%s", async (revision, name) => {
    const response = await asset(revision, name);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
