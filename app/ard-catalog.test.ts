import { expect, test } from "vitest";
import { GET, HEAD } from "./.well-known/ard.json/route";
import { AI_CATALOG, DISCOVERY_LINK_HEADER } from "@/lib/agent-discovery";

test("publishes ARD v0.91 entries with stable identity, live targets and useful query examples", async () => {
  const response = GET();
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  const { entries, specVersion, host } = await response.json();
  expect(specVersion).toBe(AI_CATALOG.specVersion);
  expect(host).toEqual(AI_CATALOG.host);
  expect(entries).toHaveLength(AI_CATALOG.entries.length);
  for (const [index, entry] of entries.entries()) {
    expect(entry.identifier).toBe(AI_CATALOG.entries[index].identifier);
    expect(entry.url).toBe(AI_CATALOG.entries[index].url);
    expect(entry).not.toHaveProperty("data");
    expect(entry["@context"]).toBe(
      "https://agenticresourcediscovery.org/context/v1",
    );
    expect(entry.representativeQueries).toHaveLength(2);
    expect(
      entry.representativeQueries.every((query: string) => query.length > 20),
    ).toBe(true);
  }
  expect(await HEAD().text()).toBe("");
  expect(HEAD().headers.get("cache-control")).toBe(
    response.headers.get("cache-control"),
  );
  expect(DISCOVERY_LINK_HEADER).toContain('/.well-known/ard.json>; rel="ard"');
  expect(DISCOVERY_LINK_HEADER).toContain(
    '/.well-known/ai-catalog.json>; rel="ai-catalog"',
  );
});
