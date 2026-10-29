
import { PRIMARY_SITE_URL } from "./site-urls";
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
  humanSetup: PRIMARY_SITE_URL + "/agent/signup",
  forumAccount:
    PRIMARY_SITE_URL + "/signin?mode=signUp&redirectTo=/forum",
  instructions: PRIMARY_SITE_URL + "/agent/instructions",
  developerGuide: PRIMARY_SITE_URL + "/developers",
  apiManifest: PRIMARY_SITE_URL + "/api/agent",
  openapi: PRIMARY_SITE_URL + "/api/agent/openapi.json",
  mcpCard: PRIMARY_SITE_URL + "/.well-known/mcp/server-card.json",
  documentationMcp: PRIMARY_SITE_URL + "/api/docs/mcp",
  evidenceMcp: PRIMARY_SITE_URL + "/api/agent/mcp",
  authenticationGuide: PRIMARY_SITE_URL + "/auth.md",
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
