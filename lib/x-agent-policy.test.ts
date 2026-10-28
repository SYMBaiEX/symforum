// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  expectedXUsername,
  validXDraft,
  xAuthorizationUrl,
  xCallbackDestination,
  X_CALLBACK_URL,
  X_ACTIVITY_SCOPES,
  officialXAuthor,
  xOriginalKind,
  xVoice,
  xReplySummoned,
  xFirstReplyInvitationParent,
} from "./x-agent-policy";
import { pkceChallenge, randomXSecret, sealX, unsealX } from "./x-agent-crypto";
import { permitsLunaRuntimeStage } from "./eliza-runtime-personas";

describe("X account authorization and draft boundaries", () => {
  test("a first reply invitation must mention NyX under the same official author's original", () => {
    const parent = {
      id: "90",
      author_id: "2112678767726366720",
      text: "Main Chat stays clear.",
      created_at: "2026-10-28T17:00:00Z",
    };
    const invite = {
      id: "91",
      author_id: parent.author_id,
      text: "NyX?",
      created_at: "2026-10-28T17:01:00Z",
      conversation_id: parent.id,
      entities: { mentions: [{ id: "1234" }] },
      referenced_tweets: [{ id: parent.id, type: "replied_to" }],
    };
    const parse = (p = invite, r: object = parent) =>
      xFirstReplyInvitationParent(p, "1234", { tweets: [r] });
    expect(parse()).toEqual({
      id: "90",
      authorId: parent.author_id,
      text: parent.text,
      createdAt: Date.parse(parent.created_at),
    });
    expect(
      parse({ ...invite, entities: { mentions: [{ id: "5678" }] } }),
    ).toBeNull();
    expect(
      parse(invite, { ...parent, author_id: "1494195618213990401" }),
    ).toBeNull();
    expect(
      parse(invite, {
        ...parent,
        referenced_tweets: [{ id: "80", type: "replied_to" }],
      }),
    ).toBeNull();
    expect(parse(invite, { ...parent, possibly_sensitive: true })).toBeNull();
    expect(parse({ ...invite, conversation_id: "80" })).toBeNull();
    expect(xFirstReplyInvitationParent(invite, "1234")).toBeNull();
    expect(parse({ ...invite, author_id: "1234" })).toBeNull();
  });
  test("automatic replies require the exact mentioned or quoted account ID", () => {
    expect(
      xReplySummoned({ entities: { mentions: [{ id: "1234" }] } }, "1234"),
    ).toBe(true);
    expect(
      xReplySummoned(
        { text: "@symbaiex_nyx", entities: { mentions: [{ id: "5678" }] } },
        "1234",
      ),
    ).toBe(false);
    const p = { referenced_tweets: [{ type: "quoted", id: "99" }] };
    expect(
      xReplySummoned(p, "1234", { tweets: [{ id: "99", author_id: "1234" }] }),
    ).toBe(true);
    expect(
      xReplySummoned(p, "1234", { tweets: [{ id: "99", author_id: "5678" }] }),
    ).toBe(false);
    expect(
      xReplySummoned(
        { referenced_tweets: [{ type: "replied_to", id: "99" }] },
        "1234",
        { tweets: [{ id: "99", author_id: "1234" }] },
      ),
    ).toBe(false);
    expect(xReplySummoned(p, "1234")).toBe(false);
  });
  test("NyX's automatic draft mix is four mascot posts and one Forum find", () => {
    expect(
      Array.from({ length: 10 }, (_, i) => xOriginalKind("nyx", i)),
    ).toEqual([
      "mascot",
      "mascot",
      "mascot",
      "mascot",
      "forum",
      "mascot",
      "mascot",
      "mascot",
      "mascot",
      "forum",
    ]);
    expect(xVoice("nyx", "researcher")).toContain("mischievous AI mascot");
    expect(xVoice("belle", "Cheeky")).toBe("Cheeky");
  });
  test("official activity adds only posting scope and binds sources to verified IDs", () => {
    expect(
      new URL(xAuthorizationUrl("state", "challenge", true)).searchParams.get(
        "scope",
      ),
    ).toBe(X_ACTIVITY_SCOPES.join(" "));
    expect(officialXAuthor("1494195618213990401")?.username).toBe("symbiex");
    expect(officialXAuthor("2112678767726366720")?.username).toBe("symforum");
    expect(officialXAuthor("symforum")).toBeUndefined();
  });
  test("NyX cannot be assigned the project or another persona's account", () => {
    expect(expectedXUsername("nyx", "@SYMBaiEX_Nyx")).toBe("symbaiex_nyx");
    expect(() => expectedXUsername("nyx", "symforum")).toThrow();
    expect(() => expectedXUsername("suki", "https://x.com/suki")).toThrow();
  });
  test("PKCE uses the RFC 7636 S256 example", async () => {
    expect(
      await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(randomXSecret()).toMatch(/^[a-f0-9]{64}$/);
  });
  test("grants are authenticated against agent, owner and purpose", async () => {
    const k = "a".repeat(64),
      binding = "owner:nyx:grant:v1";
    const a = await sealX(k, "private token", binding),
      b = await sealX(k, "private token", binding);
    expect(a.nonce).not.toBe(b.nonce);
    expect(await unsealX(k, a, binding)).toBe("private token");
    await expect(unsealX(k, a, "owner:belle:grant:v1")).rejects.toThrow();
    await expect(unsealX(k, a, "other:nyx:grant:v1")).rejects.toThrow();
    await expect(unsealX(k, a, "owner:nyx:pkce:v1")).rejects.toThrow();
  });
  test("the shared app initially requests no write or DM permission", () => {
    const u = xAuthorizationUrl("a".repeat(64), "challenge");
    expect(u.origin).toBe("https://x.com");
    expect(u.searchParams.get("redirect_uri")).toBe(X_CALLBACK_URL);
    expect(u.searchParams.get("scope")).toBe(
      "tweet.read users.read offline.access",
    );
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });
  test("callback destinations are fixed and authorization material moves out of the query", () => {
    const u = xCallbackDestination(
      new URL(
        `https://evil.test/?state=${"a".repeat(64)}&code=one-use&next=https://evil.test`,
      ),
    );
    expect(u.origin).toBe("https://forum.symbaiex.com");
    expect(u.search).toBe("");
    expect(u.hash).toContain("x_code=one-use");
    expect(
      xCallbackDestination(new URL("https://forum.symbaiex.com/?error=denied"))
        .hash,
    ).toBe("#x_error=authorization_failed");
  });
  test("draft length is bounded without chopping sources or Unicode", () => {
    expect(validXDraft("x".repeat(280))).toBe(true);
    expect(validXDraft("x".repeat(281))).toBe(false);
    expect(validXDraft("猫".repeat(141))).toBe(false);
    expect(
      validXDraft(
        "A useful detail. https://forum.symbaiex.com/" + "a".repeat(200),
      ),
    ).toBe(true);
  });
  test("only editorial identities can draft and review; publishing is never a model stage", () => {
    expect(permitsLunaRuntimeStage("nyx", "nyx:x-draft")).toBe(true);
    expect(permitsLunaRuntimeStage("nyx", "nyx:x-evidence-review")).toBe(true);
    for (const [slug, stage] of [
      ["nyx", "belle:x-draft"],
      ["system", "system:x-draft"],
      ["pumpfun-scout", "pumpfun-scout:x-draft"],
      ["nyx", "nyx:x-publish"],
    ])
      expect(permitsLunaRuntimeStage(slug, stage)).toBe(false);
  });
});
