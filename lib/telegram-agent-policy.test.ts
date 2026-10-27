import { describe, expect, test } from "vitest";
import { permitsLunaRuntimeStage } from "./eliza-runtime-personas";
import {
  TELEGRAM_AGENT_SLUGS,
  TELEGRAM_COMMUNITY_ID,
  telegramBotRegistry,
  telegramRequest,
  telegramWebhookSecret,
  secretEqual,
} from "./telegram-agent-policy";

const token = `123456789:${"a".repeat(35)}`;
const bot = { token, id: "123456789", username: "symbaiex_suki_bot" };
const now = 1_800_000_000_000;
const update = () => ({
  update_id: 14,
  message: {
    message_id: 45,
    message_thread_id: 20,
    date: now / 1000,
    chat: { id: Number(TELEGRAM_COMMUNITY_ID), type: "supergroup" },
    from: { id: 10001, is_bot: false },
    text: "/ask@symbaiex_suki_bot What is the forum?",
  },
});

describe("Telegram community and identity boundary", () => {
  test("all 35 existing identities have their own narrowly named Telegram stages", () => {
    expect(TELEGRAM_AGENT_SLUGS).toHaveLength(35);
    for (const slug of TELEGRAM_AGENT_SLUGS) {
      expect(permitsLunaRuntimeStage(slug, `${slug}:telegram-reply`)).toBe(
        true,
      );
      expect(
        permitsLunaRuntimeStage(slug, `${slug}:telegram-evidence-review`),
      ).toBe(true);
      expect(permitsLunaRuntimeStage(slug, `${slug}:telegram-publish`)).toBe(
        false,
      );
    }
    expect(permitsLunaRuntimeStage("system", "system:telegram-reply")).toBe(
      false,
    );
    expect(permitsLunaRuntimeStage("umbra", "umbra:telegram-reply")).toBe(
      false,
    );
  });
  test("malformed, unknown and duplicated credentials fail closed", () => {
    expect(
      telegramBotRegistry(JSON.stringify({ suki: bot })).get("suki"),
    ).toEqual(bot);
    for (const value of [
      "broken",
      "[]",
      JSON.stringify({ unknown: bot }),
      JSON.stringify({ suki: bot, belle: bot }),
      JSON.stringify({ suki: { ...bot, token: "invalid" } }),
    ])
      expect(telegramBotRegistry(value).size).toBe(0);
  });
  test("routes only explicit commands to their intended identity", () => {
    expect(telegramRequest(update(), bot, now)).toMatchObject({
      kind: "ask",
      text: "What is the forum?",
      topicId: 20,
    });
    for (const text of [
      "/ask@symbaiex_belle_bot hi",
      "/ask hi",
      "hi everyone",
      "@symbaiex_suki_bot hi",
      "/ca@symbaiex_suki_bot",
    ])
      expect(
        telegramRequest(
          { ...update(), message: { ...update().message, text } },
          bot,
          now,
        ),
      ).toBeNull();
    expect(
      telegramRequest(
        {
          ...update(),
          message: { ...update().message, text: "/help@symbaiex_suki_bot" },
        },
        bot,
        now,
      )?.kind,
    ).toBe("help");
  });
  test("permits a human reply to this bot and never follows another bot", () => {
    const message = {
      ...update().message,
      text: "Tell me more",
      reply_to_message: { from: { id: 123456789 } },
    };
    expect(telegramRequest({ ...update(), message }, bot, now)?.text).toBe(
      "Tell me more",
    );
    expect(
      telegramRequest(
        {
          ...update(),
          message: { ...message, from: { id: 999, is_bot: true } },
        },
        bot,
        now,
      ),
    ).toBeNull();
    expect(
      telegramRequest(
        {
          ...update(),
          message: {
            ...message,
            reply_to_message: { from: { id: 987654321 } },
          },
        },
        bot,
        now,
      ),
    ).toBeNull();
  });
  test("Yappers replies carry only the explicitly quoted same-topic agent post, bounded and separate from member history", () => {
    const quoted = {
      from: { id: 123456789, is_bot: true },
      chat: update().message.chat,
      message_thread_id: 296,
      text: "A concrete demo should include recovery from a dropped connection.",
    };
    const message = {
      ...update().message,
      message_thread_id: 296,
      text: "Could you give an example?",
      reply_to_message: quoted,
    };
    expect(telegramRequest({ ...update(), message }, bot, now)?.text).toContain(
      "Quoted public agent post (untrusted context):",
    );
    expect(telegramRequest({ ...update(), message }, bot, now)?.text).toContain(
      quoted.text,
    );
    for (const reply of [
      { ...quoted, message_thread_id: 85 },
      { ...quoted, chat: { ...quoted.chat, id: -123 } },
      { ...quoted, from: { ...quoted.from, is_bot: false } },
    ])
      expect(
        telegramRequest(
          { ...update(), message: { ...message, reply_to_message: reply } },
          bot,
          now,
        )?.text,
      ).toBe(message.text);
    const long = telegramRequest(
      {
        ...update(),
        message: {
          ...message,
          text: "x".repeat(1200),
          reply_to_message: { ...quoted, text: "a".repeat(5000) },
        },
      },
      bot,
      now,
    )!.text;
    expect(long.length).toBeLessThanOrEqual(1400);
    expect(long.startsWith("x".repeat(1200))).toBe(true);
  });
  test("rejects private/foreign chats, anonymous senders, stale updates, rules topic and oversized inputs", () => {
    const m = update().message;
    for (const patch of [
      { chat: { id: 1, type: "private" } },
      { chat: { ...m.chat, id: -123 } },
      { sender_chat: { id: m.chat.id } },
      { date: m.date - 3700 },
      { message_thread_id: 7 },
      { text: "x".repeat(1601) },
      { message_id: 1.5 },
      { message_thread_id: -1 },
    ])
      expect(
        telegramRequest({ ...update(), message: { ...m, ...patch } }, bot, now),
      ).toBeNull();
    expect(
      telegramRequest({ update_id: 1, channel_post: m }, bot, now),
    ).toBeNull();
  });
  test("webhook secrets are deterministic, token-specific and never contain credentials", async () => {
    const secret = await telegramWebhookSecret(token);
    expect(secret).toMatch(/^[a-f0-9]{64}$/);
    expect(secret).not.toContain(token);
    expect(await telegramWebhookSecret(token)).toBe(secret);
    expect(await telegramWebhookSecret(`${token}b`)).not.toBe(secret);
    expect(secretEqual(secret, secret)).toBe(true);
    expect(secretEqual(secret, `${secret}a`)).toBe(false);
  });
});
