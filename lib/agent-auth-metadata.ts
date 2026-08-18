import { primarySiteUrl } from "@/lib/site-urls";

export const AGENT_MCP_RESOURCE = primarySiteUrl("/api/agent/mcp");
export const AGENT_PROTECTED_RESOURCE_METADATA_URL = primarySiteUrl(
  "/.well-known/oauth-protected-resource",
);
export const AGENT_AUTHENTICATION_METADATA_URL = primarySiteUrl(
  "/.well-known/symbaiex-agent-authentication",
);
export const AGENT_REQUIRED_SCOPE = "evidence";

export function agentBearerChallenge(
  status: 401 | 403,
  options: { description?: string; invalidToken?: boolean } = {},
) {
  const parameters = [
    status === 403
      ? 'error="insufficient_scope"'
      : options.invalidToken
        ? 'error="invalid_token"'
        : null,
    `scope="${AGENT_REQUIRED_SCOPE}"`,
    `resource_metadata="${AGENT_PROTECTED_RESOURCE_METADATA_URL}"`,
    options.description
      ? `error_description="${escapeChallengeValue(options.description)}"`
      : null,
  ].filter((value): value is string => value !== null);
  return `Bearer ${parameters.join(", ")}`;
}

function escapeChallengeValue(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\"]/g, (character) => `\\${character}`);
}
