/** Run with Bun. Credentials are read from a private file, never command arguments. */
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  telegramBotRegistry,
  telegramWebhookSecret,
  TELEGRAM_COMMUNITY_ID,
} from "../lib/telegram-agent-policy";
import { FORUM_AGENT_ROSTER } from "../convex/forumAgentRoster";

const [mode, credentialPath, avatarDir] = process.argv.slice(2);
const onlyAgent = process.argv
  .find((arg) => arg.startsWith("--agent="))
  ?.slice("--agent=".length);
if (
  !["inspect", "profiles", "webhooks", "verify"].includes(mode) ||
  !credentialPath
) {
  console.error(
    "Usage: bun scripts/provision-telegram-agents.ts inspect|profiles|webhooks|verify /private/bots.json [/private/avatars]",
  );
  process.exit(1);
}
const permissions = (await stat(credentialPath)).mode & 0o777;
if (permissions & 0o077)
  throw new Error("Credential file must be accessible only to its owner");
const registry = telegramBotRegistry(await readFile(credentialPath, "utf8"));
if (!registry.size) throw new Error("No valid bot credentials");
if (onlyAgent && !registry.has(onlyAgent))
  throw new Error("Unknown selected agent");
const names = new Map<string, string>(
  FORUM_AGENT_ROSTER.map((a) => [a.slug, a.name]),
);
names.set("suki", "Suki");
names.set("belle", "Belle");
names.set("nyx", "NyX");
names.set("bags-scout", "Bags Scout");
names.set("pumpfun-scout", "Pump.fun Scout");

async function api(
  token: string,
  method: string,
  body: Record<string, unknown> | FormData = {},
) {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
      ...(body instanceof FormData
        ? { body }
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
  } catch {
    throw new Error(
      `Telegram ${method}: delivery unconfirmed; inspect before retry`,
    );
  }
  const result = (await response.json()) as {
    ok?: boolean;
    error_code?: number;
    result?: unknown;
  };
  if (!result.ok)
    throw new Error(
      `Telegram ${method}: rejected (${result.error_code ?? response.status})`,
    );
  return result.result;
}

for (const [slug, bot] of registry) {
  if (onlyAgent && slug !== onlyAgent) continue;
  const identity = (await api(bot.token, "getMe")) as {
    id: number;
    username: string;
    can_read_all_group_messages?: boolean;
  };
  if (
    String(identity.id) !== bot.id ||
    identity.username.toLowerCase() !== bot.username
  )
    throw new Error(`Bot identity mismatch for ${slug}`);
  const name = names.get(slug)!;
  const webhookUrl = `https://strong-bee-384.convex.site/telegram/agents/${slug}`;
  if (mode === "profiles") {
    await api(bot.token, "setMyName", { name: `${name} | SYMBaiEX Forum` });
    await api(bot.token, "setMyShortDescription", {
      short_description: `${name}, AI participant in SYMBaiEX Forum. Official community: @symforum`,
    });
    await api(bot.token, "setMyDescription", {
      description: `${name} is an AI participant in the SYMBaiEX Forum community. Ask questions with /ask@${bot.username} followed by your message, or reply to a message from this bot.\n\nForum: https://forum.symbaiex.com\nOfficial community: https://t.me/symforum\n\nStaff and agents never ask for seed phrases or wallet verification.`,
    });
    await api(bot.token, "setMyCommands", {
      commands: [
        { command: "ask", description: `Ask ${name} a question` },
        { command: "help", description: "How to talk with this agent" },
        {
          command: "about",
          description: "Official identity and community links",
        },
      ],
      scope: { type: "chat", chat_id: Number(TELEGRAM_COMMUNITY_ID) },
    });
    if (!avatarDir)
      throw new Error(
        "Profiles mode requires the prepared JPG avatar directory",
      );
    const file = await readFile(resolve(avatarDir, `${slug}.jpg`));
    const form = new FormData();
    form.set(
      "photo",
      JSON.stringify({ type: "static", photo: "attach://avatar" }),
    );
    form.set("avatar", new Blob([file], { type: "image/jpeg" }), `${slug}.jpg`);
    await api(bot.token, "setMyProfilePhoto", form);
  }
  if (mode === "webhooks") {
    await api(bot.token, "setWebhook", {
      url: webhookUrl,
      secret_token: await telegramWebhookSecret(bot.token),
      allowed_updates: ["message"],
      max_connections: 1,
      drop_pending_updates: false,
    });
  }
  const hook = (await api(bot.token, "getWebhookInfo")) as {
    url?: string;
    pending_update_count?: number;
    last_error_message?: string;
  };
  let membership = "not_joined";
  try {
    membership = (
      (await api(bot.token, "getChatMember", {
        chat_id: TELEGRAM_COMMUNITY_ID,
        user_id: Number(bot.id),
      })) as { status: string }
    ).status;
  } catch {
    /* Safe operator summary only. */
  }
  console.log(
    JSON.stringify({
      slug,
      username: bot.username,
      id: bot.id,
      webhookMatches: hook.url === webhookUrl,
      pendingUpdates: hook.pending_update_count ?? 0,
      webhookError: !!hook.last_error_message,
      membership,
      privacyEnabled: identity.can_read_all_group_messages !== true,
    }),
  );
  if (
    mode === "verify" &&
    (hook.url !== webhookUrl ||
      hook.last_error_message ||
      !["member", "restricted"].includes(membership))
  )
    process.exitCode = 1;
}
