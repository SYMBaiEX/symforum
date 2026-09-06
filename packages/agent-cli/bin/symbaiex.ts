#!/usr/bin/env bun
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
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
  if (command === "help") {
    io.log(CLI_USAGE);
    return 0;
  }
  try {
    validateOptions(args);
    const tokenFile = tokenFileFrom(args);
    const store = new FileTokenStore(tokenFile);
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
    const result = await executeCommand(client, command, args);
    if (result === null)
      throw new UsageError(
        "Unknown command. Run symbaiex help for the supported commands.",
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

async function executeCommand(
  client: AgentClient,
  command: string | undefined,
  args: string[],
): Promise<unknown | null> {
  const limit = optionalLimit(args);
  switch (command) {
    case "manifest":
      return await client.manifest();
    case "status":
      return await client.status();
    case "quota":
      return await client.quota();
    case "search":
      return await client.search(requiredArgument(args, "search query"), limit);
    case "sources":
      return await client.sources(limit);
    case "source-registry":
      return await client.sourceRegistry();
    case "universal-search":
      return await client.universalSearch(
        requiredArgument(args, "search query"),
        limit,
      );
    case "semantic-search":
      return await client.semanticSearch(
        requiredArgument(args, "search query"),
        {
          limit,
          idempotencyKey: requiredOption(args, "--idempotency-key"),
        },
      );
    case "document":
      return await client.document(requiredArgument(args, "document ID"));
    case "changes":
      return await client.changes(limit);
    case "entities":
      return await client.entities(
        requiredArgument(args, "entity query"),
        limit,
      );
    case "claim-timeline":
      return await client.claimTimeline(
        requiredArgument(args, "claim key"),
        limit,
      );
    case "products":
      return await client.products(limit);
    case "datasets":
      return await client.datasets(limit);
    case "dataset-versions":
      return await client.datasetVersions(
        requiredArgument(args, "dataset ID"),
        limit ?? 20,
        option(args, "--cursor"),
      );
    case "dataset-version-diff":
      return await client.datasetVersionDiff(
        requiredArgument(args, "dataset ID"),
        requiredArgumentAfter(args, "version ID", 1),
        option(args, "--against"),
      );
    case "dataset-version-download": {
      const output = requiredOption(args, "--output");
      const artifact = await client.datasetVersionArtifact(
        requiredArgument(args, "dataset ID"),
        requiredArgumentAfter(args, "version ID", 1),
      );
      await writeFile(output, artifact, { flag: "wx", mode: 0o600 });
      return { output, byteLength: artifact.byteLength };
    }
    case "benchmarks":
      return await client.benchmarks(limit);
    case "entitlements":
      return await client.entitlements();
    case "usage":
      return await client.usage(limit);
    case "verify-claim":
      return await client.verifyClaim(
        requiredArgument(args, "claim ID"),
        requiredOption(args, "--idempotency-key"),
      );
    case "research-create":
      return await client.createResearch(
        requiredArgument(args, "research query"),
        requiredOption(args, "--idempotency-key"),
      );
    case "research-job":
      return await client.researchJob(
        requiredArgument(args, "research job ID"),
      );
    case "export-create":
      return await client.createExport(
        requiredArgument(args, "dataset ID"),
        requiredOption(args, "--idempotency-key"),
        optionalRecordLimit(args),
        exportFormat(args),
        exportSelectionStrategy(args),
        option(args, "--cursor"),
      );
    case "export-job":
      return await client.exportJob(requiredArgument(args, "export job ID"));
    case "export-manifest": {
      const bytes = await client.exportManifest(
        requiredArgument(args, "export job ID"),
      );
      return JSON.parse(new TextDecoder().decode(bytes));
    }
    case "export-download": {
      const jobId = requiredArgument(args, "export job ID");
      const output = requiredOption(args, "--output");
      const artifact = await client.exportArtifact(jobId);
      await client.verifyExportManifest(jobId, artifact);
      await writeFile(output, artifact, { flag: "wx", mode: 0o600 });
      return { output, byteLength: artifact.byteLength, verified: true };
    }
    case "webhook-availability":
      return await client.webhookAvailability();
    case "webhook-list":
      return await client.listWebhooks();
    case "webhook-health":
      return await client.webhookHealth(
        requiredArgument(args, "subscription key"),
      );
    case "webhook-history":
      return await client.webhookHistory(
        requiredArgument(args, "subscription key"),
        limit,
      );
    case "webhook-status":
      return await client.setWebhookStatus(
        requiredArgument(args, "subscription key"),
        webhookStatus(requiredArgumentAfter(args, "status", 1)),
        requiredOption(args, "--idempotency-key"),
      );
    case "webhook-test":
      return await client.sendWebhookTest(
        requiredArgument(args, "subscription key"),
        webhookEventType(requiredArgumentAfter(args, "event type", 1)),
        requiredOption(args, "--idempotency-key"),
      );
    default:
      return null;
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

function requiredOption(args: string[], name: string) {
  const value = option(args, name);
  if (!value) throw new UsageError(`${name} is required.`);
  return value;
}

function requiredArgument(args: string[], label: string) {
  const value = positionalArguments(args)[0];
  if (!value) throw new UsageError(`${label} is required.`);
  return value;
}

function requiredArgumentAfter(args: string[], label: string, offset: number) {
  const value = positionalArguments(args)[offset];
  if (!value) throw new UsageError(`${label} is required.`);
  return value;
}

const VALUE_OPTIONS = new Set([
  "--idempotency-key",
  "--limit",
  "--origin",
  "--token-file",
  "--output",
  "--records",
  "--format",
  "--selection",
  "--cursor",
  "--against",
]);

function positionalArguments(args: string[]) {
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (VALUE_OPTIONS.has(argument)) {
      index += 1;
      continue;
    }
    if (!argument.startsWith("--")) positional.push(argument);
  }
  return positional;
}

function validateOptions(args: string[]) {
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!argument.startsWith("--")) continue;
    if (!VALUE_OPTIONS.has(argument))
      throw new UsageError(`Unknown option: ${argument}.`);
    if (seen.has(argument))
      throw new UsageError(`${argument} may only be provided once.`);
    seen.add(argument);
    option(args, argument);
    index += 1;
  }
}

function optionalLimit(args: string[]) {
  const value = option(args, "--limit");
  if (value === undefined) return undefined;
  if (!/^\d{1,2}$/.test(value) || Number(value) < 1 || Number(value) > 50)
    throw new UsageError("--limit must be an integer between 1 and 50.");
  return Number(value);
}

function optionalRecordLimit(args: string[]) {
  const value = option(args, "--records");
  if (value === undefined) return 100;
  if (!/^\d{1,3}$/.test(value) || Number(value) < 1 || Number(value) > 500)
    throw new UsageError("--records must be an integer between 1 and 500.");
  return Number(value);
}

function exportFormat(args: string[]): "jsonl" | "parquet" {
  const value = option(args, "--format") ?? "jsonl";
  if (value === "jsonl" || value === "parquet") return value;
  throw new UsageError("--format must be jsonl or parquet.");
}

function exportSelectionStrategy(args: string[]): "balanced" | "recent" {
  const value = option(args, "--selection") ?? "balanced";
  if (value === "balanced" || value === "recent") return value;
  throw new UsageError("--selection must be balanced or recent.");
}

function webhookStatus(value: string) {
  if (value === "active" || value === "paused" || value === "revoked")
    return value;
  throw new UsageError("status must be active, paused, or revoked.");
}

function webhookEventType(value: string) {
  const values = [
    "evidence.document.changed",
    "evidence.research.completed",
    "evidence.export.completed",
    "evidence.benchmark.completed",
    "evidence.claim.verified",
    "evidence.usage.threshold_reached",
    "evidence.usage.budget_reached",
    "evidence.entitlement.status_changed",
  ] as const;
  const eventType = values.find((candidate) => candidate === value);
  if (!eventType) throw new UsageError("event type is not supported.");
  return eventType;
}

const CLI_USAGE = `symbaiex <command> [arguments] [options]

Auth: login
Discovery: manifest, status, quota, sources, source-registry
Search: search, universal-search, semantic-search, entities
Evidence: document, changes, claim-timeline, verify-claim
Catalogs: products, datasets, dataset-versions, dataset-version-diff,
  dataset-version-download, benchmarks, entitlements, usage
Jobs: research-create, research-job, export-create, export-job, export-manifest,
  export-download
Webhooks: webhook-availability, webhook-list, webhook-health,
  webhook-history, webhook-status, webhook-test

Options: --limit <1-50>, --records <1-500>, --format <jsonl|parquet>,
  --selection <balanced|recent>, --cursor <opaque>, --idempotency-key <key>, --token-file <path>, --output <path>,
  --origin <origin>. Provider-capable and write commands require an explicit
  idempotency key.`;

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
