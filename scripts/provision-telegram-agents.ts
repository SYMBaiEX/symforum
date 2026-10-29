import { installation } from "../lib/installation";

import { FORUM_SITE_URL, FORUM_TELEGRAM_URL } from "../lib/site-urls";
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
  !["inspect", "profiles", "commands", "webhooks", "verify"].includes(mode) ||
  !credentialPath
) {
  console.error(
    "Usage: bun scripts/provision-telegram-agents.ts inspect|profiles|commands|webhooks|verify /private/bots.json [/private/avatars]",
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

function commandsFor(name: string) {
  return [
    { command: "ask", description: `Ask ${name} a question` },
    { command: "menu", description: "Choose an agent and start a question" },
    { command: "help", description: "How to talk with this agent" },
    { command: "about", description: "Official identity and community links" },
  ];
}

const webhookOrigin = new URL(process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "");
if (webhookOrigin.protocol !== "https:" || webhookOrigin.username || webhookOrigin.password || webhookOrigin.pathname !== "/" || webhookOrigin.search || webhookOrigin.hash || !TELEGRAM_COMMUNITY_ID) throw Error("Configure the exact HTTPS Convex site and Telegram community before provisioning.");

for (const [slug, bot] of registry) {
  if (onlyAgent && slug !== onlyAgent) continue;
  const identity = (await api(bot.token, "getMe")) as {
    id: number;
    username: string;
    can_join_groups?: boolean;
    can_read_all_group_messages?: boolean;
  };
  if (
    String(identity.id) !== bot.id ||
    identity.username.toLowerCase() !== bot.username
  )
    throw new Error(`Bot identity mismatch for ${slug}`);
  const name = names.get(slug)!;
  const webhookUrl = `${webhookOrigin.origin}/telegram/agents/${slug}`;
  if (mode === "profiles") {
    if (!avatarDir)
      throw new Error(
        "Profiles mode requires the prepared JPG avatar directory",
      );
    // Scouts have no existing forum portrait. Preserve their current avatar
    // when no prepared image exists, rather than inventing a character image.
    const avatarPath = resolve(avatarDir, `${slug}.jpg`);
    let avatar: Buffer | undefined;
    try {
      avatar = await readFile(avatarPath);
    } catch (error) {
      if (
        !(slug === "bags-scout" || slug === "pumpfun-scout") ||
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      )
        throw new Error(`Prepared JPG avatar unavailable for ${slug}`);
      console.log(JSON.stringify({ slug, avatar: "existing_preserved" }));
    }
    await api(bot.token, "setMyName", { name: `${name} | SYMBaiEX Forum` });
    await api(bot.token, "setMyShortDescription", {
      short_description: `${name}, AI participant in ${installation.name}. Official community: ${installation.telegram.url}`,
    });
    await api(bot.token, "setMyDescription", {
      description: `${name} is an AI participant in the SYMBaiEX Forum community. Ask questions with /ask@${bot.username} followed by your message, or reply to a message from this bot.\n\nForum: ${FORUM_SITE_URL}\nOfficial community: ${FORUM_TELEGRAM_URL}\n\nStaff and agents never ask for seed phrases or wallet verification.`,
    });
    await api(bot.token, "setMyCommands", {
      commands: commandsFor(name),
      scope: { type: "chat", chat_id: Number(TELEGRAM_COMMUNITY_ID) },
    });
    if (avatar) {
      const form = new FormData();
      form.set(
        "photo",
        JSON.stringify({ type: "static", photo: "attach://avatar" }),
      );
      form.set(
        "avatar",
        new Blob([new Uint8Array(avatar)], { type: "image/jpeg" }),
        `${slug}.jpg`,
      );
      await api(bot.token, "setMyProfilePhoto", form);
    }
  }
  if (mode === "commands") {
    await api(bot.token, "setMyCommands", {
      commands: commandsFor(name),
      scope: { type: "chat", chat_id: Number(TELEGRAM_COMMUNITY_ID) },
    });
  }
  if (mode === "webhooks") {
    await api(bot.token, "setWebhook", {
      url: webhookUrl,
      secret_token: await telegramWebhookSecret(bot.token),
      allowed_updates: ["message", "callback_query"],
      max_connections: 1,
      drop_pending_updates: false,
    });
  }
  const hook = (await api(bot.token, "getWebhookInfo")) as {
    url?: string;
    pending_update_count?: number;
    last_error_message?: string;
    allowed_updates?: string[];
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
      callbacksEnabled:
        hook.allowed_updates?.includes("callback_query") === true,
      membership,
      canJoinGroups: identity.can_join_groups === true,
      privacyEnabled: identity.can_read_all_group_messages !== true,
    }),
  );
  if (
    mode === "verify" &&
    (hook.url !== webhookUrl ||
      hook.last_error_message ||
      !hook.allowed_updates?.includes("callback_query") ||
      membership !== "member" ||
      identity.can_join_groups !== true ||
      identity.can_read_all_group_messages === true)
  )
    process.exitCode = 1;
}
