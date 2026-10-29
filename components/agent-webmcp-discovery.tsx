"use client";
import { PRIMARY_SITE_URL } from "../lib/site-urls";


import { useEffect } from "react";
import { SYMBAIEX_WEBMCP_DISCOVERY_RESULT } from "@/lib/agent-webmcp-inline";

type WebMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  execute: (
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => Promise<Record<string, unknown>>;
};

export type WebMcpModelContext = {
  registerTool: (
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ) => Promise<void> | void;
};

type WebMcpDocument = Document & {
  modelContext?: WebMcpModelContext;
};

type WebMcpNavigator = Navigator & {
  modelContext?: WebMcpModelContext;
};

export const SYMBAIEX_WEBMCP_DISCOVERY_TOOL: WebMcpTool = {
  name: "discover_symbaiex_agent_access",
  title: "Discover SYMBaiEX agent access",
  description:
    "Use when the user wants to connect an agent to SYMBaiEX or discover its public evidence tools. Returns only canonical public setup and contract URLs; it never enrolls, authenticates, posts, or reads credentials.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  annotations: {
    readOnlyHint: true,
    untrustedContentHint: false,
  },
  execute: async (_input, options) => {
    const signal = executionSignal(options);
    if (signal.aborted) {
      throw signal.reason;
    }
    if (Object.keys(_input).length !== 0)
      throw new Error("This discovery tool takes no arguments.");

    return SYMBAIEX_WEBMCP_DISCOVERY_RESULT;
  },
};

const DOCS_ENDPOINT = PRIMARY_SITE_URL + "/api/docs/mcp";
const MAX_RESPONSE_BYTES = 64 * 1024;

function executionSignal(options?: { signal?: AbortSignal }): AbortSignal {
  // Chrome's current WebMCP preview omits the callback-options argument.
  // Keep older hosts bounded while honoring cancellation on newer hosts.
  return options?.signal ?? AbortSignal.timeout(10_000);
}

async function callPublicDocs(
  name: "docs_search" | "docs_get",
  input: Record<string, unknown>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const response = await fetch(DOCS_ENDPOINT, {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "browser-docs",
      method: "tools/call",
      params: { name, arguments: input },
    }),
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json")
  )
    throw new Error(
      "Public documentation is unavailable. Use " + PRIMARY_SITE_URL + "/developers.",
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty documentation response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES)
        throw new Error("Documentation response exceeds the size limit.");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    !isRecord(body) ||
    body.jsonrpc !== "2.0" ||
    body.id !== "browser-docs" ||
    body.error ||
    !isRecord(body.result) ||
    body.result.isError ||
    !isRecord(body.result.structuredContent)
  )
    throw new Error("Invalid documentation response.");
  signal.throwIfAborted();
  return body.result.structuredContent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const SYMBAIEX_WEBMCP_DOCS_SEARCH_TOOL: WebMcpTool = {
  name: "search_symbaiex_docs",
  title: "Search SYMBaiEX documentation",
  description:
    "Use when connecting to SYMBaiEX or checking its API, OAuth, Ed25519, MCP, SDK, quotas, or webhooks. Searches only public integration documentation, not evidence records or the web. Returns canonical URIs for read_symbaiex_doc.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string", minLength: 1, maxLength: 200 },
      limit: { type: "integer", minimum: 1, maximum: 4, default: 4 },
    },
  },
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  execute: async (input, options) => {
    const signal = executionSignal(options);
    signal.throwIfAborted();
    if (
      Object.keys(input).some((key) => key !== "query" && key !== "limit") ||
      typeof input.query !== "string" ||
      !input.query.trim() ||
      input.query.length > 200 ||
      (input.limit !== undefined &&
        (!Number.isInteger(input.limit) ||
          Number(input.limit) < 1 ||
          Number(input.limit) > 4))
    )
      throw new Error(
        "Provide a query of 1–200 characters and an optional limit of 1–4.",
      );
    const result = await callPublicDocs("docs_search", input, signal);
    if (!Array.isArray(result.results) || result.results.length > 4)
      throw new Error("Invalid documentation search result.");
    return result;
  },
};

export const SYMBAIEX_WEBMCP_DOCS_READ_TOOL: WebMcpTool = {
  name: "read_symbaiex_doc",
  title: "Read SYMBaiEX documentation",
  description:
    "Read a public documentation URI returned by search_symbaiex_docs. Returns the complete indexed Markdown guide. This cannot fetch arbitrary URLs, read accounts, authenticate, or perform writes.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["uri"],
    properties: { uri: { type: "string", format: "uri", maxLength: 300 } },
  },
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  execute: async (input, options) => {
    const signal = executionSignal(options);
    signal.throwIfAborted();
    if (
      Object.keys(input).length !== 1 ||
      typeof input.uri !== "string" ||
      input.uri.length > 300 ||
      !input.uri.startsWith(PRIMARY_SITE_URL + "/")
    )
      throw new Error(
        "Provide a canonical documentation URI returned by search_symbaiex_docs.",
      );
    const result = await callPublicDocs("docs_get", input, signal);
    if (
      !isRecord(result.resource) ||
      result.resource.uri !== input.uri ||
      typeof result.resource.text !== "string"
    )
      throw new Error("Invalid documentation resource.");
    return result;
  },
};

export const SYMBAIEX_WEBMCP_TOOLS = [
  SYMBAIEX_WEBMCP_DISCOVERY_TOOL,
  SYMBAIEX_WEBMCP_DOCS_SEARCH_TOOL,
  SYMBAIEX_WEBMCP_DOCS_READ_TOOL,
] as const;

export const SYMBAIEX_WEBMCP_DOCS_TOOLS = [
  SYMBAIEX_WEBMCP_DOCS_SEARCH_TOOL,
  SYMBAIEX_WEBMCP_DOCS_READ_TOOL,
] as const;

export function registerSymbaiexBrowserTools(
  modelContext: WebMcpModelContext,
  signal: AbortSignal,
) {
  registerTools(modelContext, SYMBAIEX_WEBMCP_TOOLS, signal);
}

export function registerSymbaiexBrowserDocsTools(
  modelContext: WebMcpModelContext,
  signal: AbortSignal,
) {
  registerTools(modelContext, SYMBAIEX_WEBMCP_DOCS_TOOLS, signal);
}

function registerTools(
  modelContext: WebMcpModelContext,
  tools: readonly WebMcpTool[],
  signal: AbortSignal,
) {
  for (const tool of tools) {
    if (signal.aborted) return;
    try {
      // Feature detection must tolerate both synchronous failures and promise rejection.
      void Promise.resolve(modelContext.registerTool(tool, { signal })).catch(
        () => {},
      );
    } catch {
      // One unsupported registration must not break the page or other tools.
    }
  }
}

export function resolveWebMcpModelContext(
  documentModelContext: unknown,
  navigatorModelContext: unknown,
): WebMcpModelContext | null {
  if (isWebMcpModelContext(documentModelContext)) return documentModelContext;
  if (isWebMcpModelContext(navigatorModelContext)) return navigatorModelContext;
  return null;
}

function isWebMcpModelContext(value: unknown): value is WebMcpModelContext {
  return isRecord(value) && typeof value.registerTool === "function";
}

export function AgentWebMcpDiscovery() {
  useEffect(() => {
    const modelContext = resolveWebMcpModelContext(
      (document as WebMcpDocument).modelContext,
      (navigator as WebMcpNavigator).modelContext,
    );
    if (modelContext === null) return;

    const controller = new AbortController();
    registerSymbaiexBrowserDocsTools(modelContext, controller.signal);

    return () => controller.abort();
  }, []);

  return null;
}
