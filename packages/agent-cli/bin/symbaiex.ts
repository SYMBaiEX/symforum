#!/usr/bin/env bun
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentApiError,
  AgentClient,
  DEFAULT_PLATFORM_ORIGIN,
} from "../../agent-sdk/src/index";
import { FileTokenStore } from "../src/token-store";

export async function run(
  argv: string[],
  io: Pick<Console, "log" | "error"> = console,
  readToken: () => Promise<string> = readStdin,
) {
  const [command, ...args] = argv;
  const tokenFile = tokenFileFrom(args);
  const store = new FileTokenStore(tokenFile);
  try {
    const origin = originFrom(args);
    const client = new AgentClient({
      origin,
      trustedOrigins: trustedOriginsForCli(origin),
      tokenStore: store,
    });
    if (command === "login") {
      const token = await readToken();
      await store.setToken(token);
      io.log("Token stored.");
      return 0;
    }
    const result =
      command === "manifest"
        ? await client.manifest()
        : command === "status"
          ? await client.status()
          : command === "quota"
            ? await client.quota()
            : command === "search"
              ? await client.search(requiredArgument(args, "search query"))
              : null;
    if (result === null)
      throw new UsageError(
        "Usage: symbaiex <manifest|status|quota|search|login> [options]",
      );
    io.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    io.error(
      error instanceof AgentApiError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : "Command failed.",
    );
    return 1;
  }
}

function originFrom(args: string[]) {
  const value = option(args, "--origin");
  return value ?? DEFAULT_PLATFORM_ORIGIN;
}

function tokenFileFrom(args: string[]) {
  return (
    option(args, "--token-file") ??
    join(homedir(), ".config", "symbaiex", "token")
  );
}

function trustedOriginsForCli(origin: string) {
  const parsed = new URL(origin);
  const normalized = parsed.origin;
  const productionOrigins = [
    "https://symbaiex.com",
    "https://www.symbaiex.com",
  ];
  if (productionOrigins.includes(normalized)) return productionOrigins;
  const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if (local && process.env.NODE_ENV !== "production") return [normalized];
  throw new UsageError(
    "--origin must be a SYMBaiEX platform origin; localhost is development-only.",
  );
}

function option(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw new UsageError(`${name} requires a value.`);
  return value;
}

function requiredArgument(args: string[], label: string) {
  const value = args.find(
    (argument, index) =>
      !argument.startsWith("--") &&
      args[index - 1] !== "--origin" &&
      args[index - 1] !== "--token-file",
  );
  if (!value) throw new UsageError(`${label} is required.`);
  return value;
}

async function readStdin() {
  let value = "";
  for await (const chunk of process.stdin) value += String(chunk);
  if (!value.trim())
    throw new UsageError("Provide the token on standard input.");
  return value;
}

class UsageError extends Error {}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await run(process.argv.slice(2));
}
