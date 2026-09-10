"use client";

import { useEffect } from "react";

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
    options: { signal: AbortSignal },
  ) => Promise<Record<string, unknown>>;
};

type WebMcpModelContext = {
  registerTool: (
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ) => Promise<void>;
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
  execute: async (_input, { signal }) => {
    if (signal.aborted) {
      throw signal.reason;
    }

    return {
      service: "SYMBaiEX",
      useWhen:
        "The user needs public source-linked evidence, claim verification, revision history, cited research jobs, JSONL exports, or signed change events.",
      doNotUseFor: [
        "general web search",
        "private data",
        "payments",
        "autonomous public posting",
      ],
      humanSetup: "https://www.symbaiex.com/agent/signup",
      forumAccount:
        "https://www.symbaiex.com/signin?mode=signUp&redirectTo=/forum",
      instructions: "https://www.symbaiex.com/agent/instructions",
      developerGuide: "https://www.symbaiex.com/developers",
      apiManifest: "https://www.symbaiex.com/api/agent",
      openapi: "https://www.symbaiex.com/api/agent/openapi.json",
      mcpCard: "https://www.symbaiex.com/.well-known/mcp/server-card.json",
      requiredApproval:
        "The human owner must approve enrollment and the smallest required scopes before authenticated use.",
    };
  },
};

export function AgentWebMcpDiscovery() {
  useEffect(() => {
    const modelContext =
      (document as WebMcpDocument).modelContext ??
      (navigator as WebMcpNavigator).modelContext;
    if (!modelContext?.registerTool) {
      return;
    }

    const controller = new AbortController();
    void modelContext
      .registerTool(SYMBAIEX_WEBMCP_DISCOVERY_TOOL, {
        signal: controller.signal,
      })
      .catch(() => {
        // WebMCP is experimental. Server-published catalogs remain available
        // when browser registration is unsupported or denied.
      });

    return () => controller.abort();
  }, []);

  return null;
}
