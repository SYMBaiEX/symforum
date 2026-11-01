import { expect, test } from "vitest";
import fixture from "../tests/fixtures/installation.symbaiex.json";
import {
  localInstallation,
  parseInstallationConfig,
} from "./installation-config";
import { forumCommunityLinks } from "./forum-community-links";

test("configured community links use only the explicit forum account and canonical public identities", () => {
  const config = parseInstallationConfig(JSON.stringify(fixture));
  const before = JSON.stringify(config);
  const links = forumCommunityLinks(config);
  expect(links.forum.href).toBe("https://forum.symbaiex.com/");
  expect(links.telegram?.href).toBe("https://t.me/symforum");
  expect(links.x).toEqual({
    href: "https://x.com/symforum",
    label: "@symforum on X",
  });
  expect(links.token).toMatchObject({
    href: "https://forum.symbaiex.com/symf",
    path: "/forum/symf",
    symbol: "SYMF",
    announcementPath: fixture.token.announcementPath,
  });
  expect(JSON.stringify(links)).not.toMatch(
    /symbiex|1494195618213990401|api-key|publisherUserId/,
  );
  expect(JSON.stringify(config)).toBe(before);
});
test("missing optional destinations are omitted without invented X, Telegram or token fallbacks", () => {
  const links = forumCommunityLinks(localInstallation());
  expect(links).toEqual({
    forum: { href: "http://forum.localhost:3000/", label: "Forum community" },
    telegram: null,
    x: null,
    token: null,
  });
});
test("community links remain available without any configured token", () => {
  const config = parseInstallationConfig(JSON.stringify(fixture));
  config.token = localInstallation().token;
  const links = forumCommunityLinks(config);
  expect(links.token).toBeNull();
  expect(links.x?.href).toBe("https://x.com/symforum");
  expect(links.telegram?.href).toBe("https://t.me/symforum");
});
test("alternate valid installation controls every public destination without rewriting route conventions", () => {
  const config = parseInstallationConfig(
    JSON.stringify({
      ...fixture,
      name: "Example Community",
      sites: {
        primary: "https://www.example.com",
        forum: "https://forum.example.com",
        blog: "https://blog.example.com",
        news: "https://news.example.com",
        newsletter: "https://newsletter.example.com",
      },
      identity: {
        cookieDomain: "example.com",
        extraOrigins: ["https://example.com"],
      },
      telegram: { ...fixture.telegram, url: "https://t.me/example_forum" },
      x: {
        accounts: { symforum: "example_forum" },
        officialSources: [],
        publisherUserId: "",
      },
      token: {
        ...fixture.token,
        symbol: "DEMO",
        announcementPath: "/forum/crypto/example-token-announcement",
      },
    }),
  );
  const links = forumCommunityLinks(config);
  expect(links.forum.href).toBe("https://forum.example.com/");
  expect(links.telegram?.href).toBe("https://t.me/example_forum");
  expect(links.x?.href).toBe("https://x.com/example_forum");
  expect(links.token).toMatchObject({
    href: "https://forum.example.com/symf",
    path: "/forum/symf",
    label: "$DEMO page & chart",
    announcementPath: "/forum/crypto/example-token-announcement",
  });
});
test("verified source records never substitute for an absent configured forum X account", () => {
  const config = parseInstallationConfig(JSON.stringify(fixture));
  config.x.accounts = {};
  config.x.publisherUserId = "";
  expect(config.x.officialSources.length).toBeGreaterThan(0);
  expect(forumCommunityLinks(config).x).toBeNull();
});
