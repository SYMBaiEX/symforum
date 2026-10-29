import { afterEach, describe, expect, test, vi } from "vitest";
import fixture from "../tests/fixtures/installation.symbaiex.json";
import example from "../config/installation.example.json";
import {
  installationIdentityOrigins,
  installationRoutingBinding,
  matchesInstallationBinding,
  installationWebOrigins,
  localInstallation,
  parseInstallationConfig,
  telegramMessageUrl,
} from "./installation-config";

afterEach(() => vi.resetModules());
function raw(patch: Record<string, unknown> = {}) {
  return JSON.stringify({ ...fixture, ...patch });
}
describe("installation configuration boundaries", () => {
  test("unconfigured forks use local destinations and no social/payment identities", () => {
    const config = parseInstallationConfig(undefined);
    expect(
      Object.values(config.sites).every((origin) =>
        new URL(origin).hostname.endsWith("localhost"),
      ),
    ).toBe(true);
    expect(config.telegram.communityId).toBe("");
    expect(config.token.mint).toBe("");
    expect(config.x.officialSources).toEqual([]);
    expect(config.x.publisherUserId).toBe("");
    expect(config.links.agentConsole).toBe("");
  });
  test("the fork example contains no production bindings", () => {
    const config = parseInstallationConfig(JSON.stringify(example));
    expect(config.sites.forum).toBe("https://forum.example.com");
    expect(config.telegram.communityId).toBe("");
    expect(config.token.mint).toBe("");
  });
  test.each([
    "http://example.com",
    "https://user:password@example.com",
    "https://example.com/path",
    "https://example.com/?api_key=private",
    "https://*.example.com",
    "https://example.com#fragment",
  ])("rejects unsafe origin %s", (value) => {
    expect(() =>
      parseInstallationConfig(
        raw({ sites: { ...fixture.sites, primary: value } }),
      ),
    ).toThrow();
  });
  test("rejects credentials accidentally placed in a public configuration", () => {
    expect(() =>
      parseInstallationConfig(raw({ clientSecret: "not-a-real-secret" })),
    ).toThrow(/separate secret/);
    expect(() =>
      parseInstallationConfig(
        raw({ x: { ...fixture.x, accessToken: "not-a-real-token" } }),
      ),
    ).toThrow(/separate secret/);
  });
  test.each(["com", "evil.test", "symbaiex.com.evil.test"])(
    "rejects foreign or overbroad cookie domain %s",
    (cookieDomain) => {
      expect(() =>
        parseInstallationConfig(
          raw({ identity: { ...fixture.identity, cookieDomain } }),
        ),
      ).toThrow(/Cookie domain/);
    },
  );
  test("API origins retain their existing roles without adding content app origins", () => {
    const config = parseInstallationConfig(raw());
    expect(installationWebOrigins(config).sort()).toEqual(
      [
        fixture.sites.primary,
        fixture.sites.forum,
        "https://symbaiex.com",
      ].sort(),
    );
    expect(installationIdentityOrigins(config)).toContain(fixture.sites.blog);
    expect(installationWebOrigins(config)).not.toContain(fixture.sites.blog);
  });
  test("rejects mismatched, duplicate or handle-only official publisher bindings", () => {
    expect(() =>
      parseInstallationConfig(
        raw({ x: { ...fixture.x, publisherUserId: "123" } }),
      ),
    ).toThrow(/publisher/);
    expect(() =>
      parseInstallationConfig(
        raw({
          x: {
            ...fixture.x,
            officialSources: [
              fixture.x.officialSources[0],
              fixture.x.officialSources[0],
            ],
          },
        }),
      ),
    ).toThrow(/Duplicate/);
    expect(() =>
      parseInstallationConfig(
        raw({
          x: {
            ...fixture.x,
            officialSources: [{ username: "someone", userId: "someone" }],
          },
        }),
      ),
    ).toThrow(/source/);
  });
  test("rejects non-supergroup destinations and topic IDs without their community", () => {
    expect(() =>
      parseInstallationConfig(
        raw({ telegram: { ...fixture.telegram, communityId: "123" } }),
      ),
    ).toThrow(/supergroup/);
    expect(() =>
      parseInstallationConfig(raw({ telegram: { topics: { yappers: 42 } } })),
    ).toThrow(/community/);
    expect(() =>
      parseInstallationConfig(
        raw({ telegram: { ...fixture.telegram, topics: { yappers: -1 } } }),
      ),
    ).toThrow(/topic/);
  });
  test("mint and pool must decode to exactly 32 Solana bytes", () => {
    for (const mint of ["invalid", "1".repeat(44), "1".repeat(31)])
      expect(() =>
        parseInstallationConfig(raw({ token: { ...fixture.token, mint } })),
      ).toThrow(/token/);
    expect(parseInstallationConfig(raw()).token.mint).toBe(fixture.token.mint);
  });
  test("community links derive from the configured group and refuse invalid message IDs", () => {
    const config = parseInstallationConfig(
      raw({ telegram: { ...fixture.telegram, communityId: "-1001234567890" } }),
    );
    expect(telegramMessageUrl(config, 42, 43)).toBe(
      "https://t.me/c/1234567890/42/43",
    );
    expect(telegramMessageUrl(config, 42, -1)).toBe("");
    expect(telegramMessageUrl(localInstallation(), 42, 43)).toBe("");
  });
  test("a different installation binds OAuth, Telegram and payment identities to its own configuration", async () => {
    vi.resetModules();
    const config = {
      ...fixture,
      ...example,
      telegram: {
        ...fixture.telegram,
        communityId: "-1001234567890",
        topics: { ...fixture.telegram.topics, yappers: 42 },
      },
      x: {
        accounts: { nyx: "example_nyx", symforum: "example_forum" },
        officialSources: [{ username: "example_forum", userId: "123" }],
        publisherUserId: "123",
      },
      token: {
        ...fixture.token,
        symbol: "DEMO",
        mint: "So11111111111111111111111111111111111111112",
      },
    };
    vi.stubEnv("NEXT_PUBLIC_INSTALLATION_CONFIG", JSON.stringify(config));
    const x = await import("./x-agent-policy");
    const tg = await import("./telegram-agent-policy");
    const contract = await import("./forum-plugin-contract");
    const commerce = await import("./forum-commerce");
    const token = await import("./symf-token");
    expect(x.X_CALLBACK_URL).toBe(
      "https://forum.example.com/api/agents/x/callback",
    );
    expect(x.expectedXUsername("nyx", "example_nyx")).toBe("example_nyx");
    expect(() => x.expectedXUsername("nyx", "symbaiex_nyx")).toThrow();
    expect(x.officialXAuthor(fixture.x.publisherUserId)).toBeUndefined();
    expect(tg.TELEGRAM_COMMUNITY_ID).toBe("-1001234567890");
    expect(contract.FORUM_PLUGIN_RESOURCE).toBe(
      "https://www.example.com/api/plugin/mcp",
    );
    expect(commerce.COMMERCE_MINT).toBe(config.token.mint);
    expect(token.SYMF_TOKEN.symbol).toBe("DEMO");
    const { buildPromotionTransaction } = await import("./swap-transactions");
    const fetcher = vi.fn<typeof fetch>();
    const intent = {
      wallet: config.token.mint,
      treasury: config.token.mint,
      mint: fixture.token.mint,
      tokenProgram: commerce.TOKEN_2022_PROGRAM,
      decimals: 6,
      amountRaw: "10",
      treasuryAmountRaw: "5",
      burnAmountRaw: "5",
      reference: config.token.mint,
      checkoutExpiresAt: Date.now() + 600000,
    };
    await expect(
      buildPromotionTransaction(
        intent,
        { treasury: config.token.mint, rpcUrl: "https://rpc.example.com" },
        false,
        fetcher,
      ),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("durable destination binding", () => {
  test("local defaults round-trip and disabled token metadata stays empty", () => {
    expect(
      parseInstallationConfig(JSON.stringify(localInstallation())),
    ).toEqual(localInstallation());
  });
  test("a routing change never retargets new or legacy work", () => {
    const old = parseInstallationConfig(raw());
    const binding = installationRoutingBinding(old);
    expect(
      matchesInstallationBinding(
        { installationBinding: binding },
        binding,
        undefined,
      ),
    ).toBe(true);
    expect(matchesInstallationBinding({}, binding, undefined)).toBe(false);
    expect(matchesInstallationBinding({}, binding, binding)).toBe(true);
    for (const changed of [
      { ...old, telegram: { ...old.telegram, communityId: "-1001234567890" } },
      {
        ...old,
        telegram: {
          ...old.telegram,
          topics: { ...old.telegram.topics, yappers: 45 },
        },
      },
      {
        ...old,
        x: { ...old.x, accounts: { ...old.x.accounts, nyx: "another_nyx" } },
      },
      {
        ...old,
        token: {
          ...old.token,
          mint: "So11111111111111111111111111111111111111112",
        },
      },
      { ...old, sites: { ...old.sites, forum: "https://forum.example.com" } },
    ]) {
      const current = installationRoutingBinding(changed);
      expect(
        matchesInstallationBinding(
          { installationBinding: binding },
          current,
          binding,
        ),
      ).toBe(false);
      expect(matchesInstallationBinding({}, current, binding)).toBe(false);
    }
    expect(
      installationRoutingBinding({
        ...old,
        name: "Renamed display",
        x: {
          ...old.x,
          officialSources: [...old.x.officialSources].reverse(),
          accounts: Object.fromEntries(
            Object.entries(old.x.accounts).reverse(),
          ),
        },
      }),
    ).toBe(binding);
  });
  test("automated topic roles cannot overlap", () => {
    expect(() =>
      parseInstallationConfig(
        raw({
          telegram: {
            ...fixture.telegram,
            topics: {
              ...fixture.telegram.topics,
              yappers: fixture.telegram.topics.main,
            },
          },
        }),
      ),
    ).toThrow(/distinct/);
  });
});
