import { describe, expect, test } from "vitest";
import {
  forumDigestSlot,
  renderForumDigest,
  selectForumDigestItems,
  telegramAgentMenu,
  telegramQuestionPrompt,
  eligibleForumDigestTitle,
  type DigestItem,
} from "./telegram-community";
import {
  telegramBotRegistry,
  telegramMenuCallback,
  telegramRequest,
} from "./telegram-agent-policy";

const registry = telegramBotRegistry(
  JSON.stringify({
    suki: {
      token: `123456789:${"a".repeat(35)}`,
      username: "symbaiex_suki_bot",
    },
    nyx: { token: `987654321:${"b".repeat(35)}`, username: "symbaiex_nyx_bot" },
  }),
);
const hub = registry.get("suki")!;
const callback = () => ({
  update_id: 10,
  callback_query: {
    id: "callback-1",
    data: "agent:nyx",
    from: { id: 101, is_bot: false },
    message: {
      message_id: 5,
      message_thread_id: 85,
      date: 1,
      from: { id: Number(hub.id), is_bot: true },
      chat: { id: -1004387387301, type: "supergroup" },
    },
  },
});

describe("agent question menu boundaries", () => {
  test("old pinned menus accept new authenticated selections without accepting foreign or forged messages", () => {
    expect(telegramMenuCallback(callback(), hub, registry)).toMatchObject({
      agentSlug: "nyx",
      request: { kind: "prompt", senderId: "101", topicId: 85 },
    });
    for (const field of [
      "bot",
      "foreign",
      "rules",
      "unknown",
      "forged",
      "inaccessible",
    ] as const) {
      const input = callback();
      if (field === "bot") input.callback_query.from.is_bot = true;
      if (field === "foreign") input.callback_query.message.chat.id = -10001;
      if (field === "rules") input.callback_query.message.message_thread_id = 7;
      if (field === "unknown") input.callback_query.data = "agent:umbra";
      if (field === "forged") input.callback_query.message.from.id = 999;
      if (field === "inaccessible") input.callback_query.message.date = 0;
      expect(telegramMenuCallback(input, hub, registry)).toBeNull();
    }
  });
  test("menu commands must explicitly address the receiving identity", () => {
    const message = {
      message_id: 8,
      date: 100,
      chat: { id: -1004387387301, type: "supergroup" },
      from: { id: 101, is_bot: false },
      text: "/menu@symbaiex_suki_bot",
    };
    expect(telegramRequest({ update_id: 1, message }, hub, 100_000)?.kind).toBe(
      "menu",
    );
    for (const text of ["/menu", "/menu@symbaiex_nyx_bot", "/agents@other_bot"])
      expect(
        telegramRequest(
          { update_id: 1, message: { ...message, text } },
          hub,
          100_000,
        ),
      ).toBeNull();
  });
  test("buttons select only supplied identities and prompts address only the requesting member", () => {
    const menu = telegramAgentMenu([
      { slug: "nyx", name: "NyX", specialty: "Research" },
    ]);
    expect(menu.reply_markup.inline_keyboard).toEqual([
      [{ text: "NyX · Research", callback_data: "agent:nyx" }],
    ]);
    const prompt = telegramQuestionPrompt(
      "NyX <AI>",
      "Sources & uncertainty",
      "101",
    );
    expect(prompt.reply_markup).toMatchObject({
      force_reply: true,
      selective: true,
    });
    expect(prompt.text).toContain('href="tg://user?id=101"');
    expect(prompt.text).toContain("NyX &lt;AI&gt;");
    expect(prompt.text).not.toContain("<AI>");
  });
});

describe("weekly digest", () => {
  test("headline curation rejects identity insults and scam solicitations while retaining legitimate identity-related discussion", () => {
    expect(
      eligibleForumDigestTitle("Is that person the world's worst Jew?"),
    ).toBe(false);
    expect(eligibleForumDigestTitle("Send me your seed phrase to join")).toBe(
      false,
    );
    expect(
      eligibleForumDigestTitle("Guaranteed profits for token buyers"),
    ).toBe(false);
    expect(
      eligibleForumDigestTitle(
        "Jewish researchers build an open-source archive",
      ),
    ).toBe(true);
    expect(
      eligibleForumDigestTitle(
        "Critical feedback about a platform's fee policy",
      ),
    ).toBe(true);
  });
  test("Friday Chicago noon follows summer and winter offsets without a second slot", () => {
    expect(forumDigestSlot(Date.parse("2026-10-30T17:00:00Z"))).toBe(
      "2026-10-30",
    );
    expect(forumDigestSlot(Date.parse("2026-10-30T18:00:00Z"))).toBeNull();
    expect(forumDigestSlot(Date.parse("2026-11-06T17:00:00Z"))).toBeNull();
    expect(forumDigestSlot(Date.parse("2026-11-06T18:00:00Z"))).toBe(
      "2026-11-06",
    );
    expect(forumDigestSlot(Date.parse("2026-10-27T17:00:00Z"))).toBeNull();
  });
  test("selection retains an unanswered conversation, prioritizes humans and limits repeated authors", () => {
    const item = (i: number): DigestItem => ({
      threadId: String(i),
      title: `Thread ${i}`,
      url: `https://forum.symbaiex.com/general/t${i}`,
      authorId: i < 4 ? "agent" : `human${i}`,
      authorName: "Author",
      isAgent: i < 4,
      replyCount: i,
      showcase: false,
      lastPostAt: i,
    });
    const result = selectForumDigestItems([0, 1, 2, 3, 4, 5, 6].map(item));
    expect(result).toHaveLength(5);
    expect(result[0].replyCount).toBe(0);
    expect(result.filter((i) => i.authorId === "agent")).toHaveLength(2);
    expect(new Set(result.map((i) => i.threadId)).size).toBe(5);
  });
  test("titles and authors are escaped and attribution labels remain explicit", () => {
    const text = renderForumDigest(
      [
        {
          threadId: "x",
          title: '<a href="https://evil.test">claim</a>',
          url: "https://forum.symbaiex.com/general/x",
          authorId: "a",
          authorName: "A & B",
          isAgent: true,
          replyCount: 0,
          showcase: false,
          lastPostAt: 1,
        },
      ],
      1,
      2,
      true,
    );
    expect(text).toContain("PREVIEW");
    expect(text).toContain("&lt;a href=&quot;https://evil.test&quot;&gt;");
    expect(text).not.toContain('href="https://evil.test"');
    expect(text).toContain("A &amp; B · AI agent");
    expect(text).toContain("Start the conversation");
  });
});
