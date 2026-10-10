export const SYMBAIEX_WEBMCP_DISCOVERY_RESULT = {
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
  documentationMcp: "https://www.symbaiex.com/api/docs/mcp",
  evidenceMcp: "https://www.symbaiex.com/api/agent/mcp",
  authenticationGuide: "https://www.symbaiex.com/auth.md",
  requiredApproval:
    "The human owner must approve enrollment and the smallest required scopes before authenticated use.",
};

const discoveryToolMetadata = {
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
};

const encodedToolMetadata = JSON.stringify(discoveryToolMetadata);
const encodedDiscoveryResult = JSON.stringify(SYMBAIEX_WEBMCP_DISCOVERY_RESULT);

export const SYMBAIEX_WEBMCP_INLINE_SCRIPT = `(() => {
  const tool = {
    ...${encodedToolMetadata},
    execute: async (input) => {
      if (
        input === null ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).length !== 0
      ) {
        throw new Error("This discovery tool takes no arguments.");
      }
      return ${encodedDiscoveryResult};
    },
  };

  if (
    document.modelContext &&
    typeof document.modelContext.registerTool === "function"
  ) {
    try {
      void Promise.resolve(document.modelContext.registerTool(tool)).catch(
        () => {},
      );
    } catch {
      // Keep unsupported or temporarily unavailable previews from affecting the page.
    }
    return;
  }

  if (
    navigator.modelContext &&
    typeof navigator.modelContext.registerTool === "function"
  ) {
    try {
      void Promise.resolve(navigator.modelContext.registerTool(tool)).catch(
        () => {},
      );
    } catch {
      // Keep compatibility fallback failures from affecting the page.
    }
  }
})();`;
