import { installation } from "./installation";
/** Shared by Next.js discovery and Convex token verification. */
export const WORKOS_AGENT_RESOURCE = `${installation.sites.primary}/api/agent/mcp`;
export const WORKOS_PLUGIN_RESOURCE = `${installation.sites.primary}/api/plugin/mcp`;
export const WORKOS_PLUGIN_GRANT_CLAIM = "urn:symbaiex:forum-plugin-grant";
export const WORKOS_PLUGIN_RESOURCE_CLAIM =
  "urn:symbaiex:forum-plugin-resource";
export const WORKOS_PLUGIN_KIND_CLAIM = "urn:symbaiex:forum-plugin-kind";
export const WORKOS_GRANT_CLAIM = "urn:symbaiex:agent-grant";

export function workosConfig(environment: {
  [key: string]: string | undefined;
  WORKOS_CONNECT_ENABLED?: string;
  WORKOS_AUTHKIT_ISSUER?: string;
}) {
  if (environment.WORKOS_CONNECT_ENABLED !== "true") return null;
  const value = environment.WORKOS_AUTHKIT_ISSUER;
  if (!value)
    throw new Error(
      "WORKOS_AUTHKIT_ISSUER is required when Connect is enabled.",
    );
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !(
      url.hostname.endsWith(".authkit.app") ||
      (Boolean(installation.identity.cookieDomain) && url.hostname.endsWith(`.${installation.identity.cookieDomain}`))
    )
  )
    throw new Error(
      "WorkOS issuer must be an HTTPS AuthKit or SYMBaiEX origin.",
    );
  return {
    issuer: url.origin,
    audience: WORKOS_AGENT_RESOURCE,
    jwks: `${url.origin}/oauth2/jwks`,
    metadata: `${url.origin}/.well-known/oauth-authorization-server`,
  };
}

export function workosAgentRegistrationConfig(environment: {
  [key: string]: string | undefined;
  WORKOS_AGENT_REGISTRATION_ENABLED?: string;
  WORKOS_AUTHKIT_ISSUER?: string;
}) {
  if (environment.WORKOS_AGENT_REGISTRATION_ENABLED !== "true") return null;
  const issuer = normalizeAuthKitIssuer(environment.WORKOS_AUTHKIT_ISSUER);
  return {
    issuer,
    audience: WORKOS_AGENT_RESOURCE,
    jwks: `${issuer}/oauth2/jwks`,
  };
}

function normalizeAuthKitIssuer(value: string | undefined) {
  if (!value)
    throw new Error(
      "WORKOS_AUTHKIT_ISSUER is required when Agent Registration is enabled.",
    );
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !(
      url.hostname.endsWith(".authkit.app") ||
      (Boolean(installation.identity.cookieDomain) && url.hostname.endsWith(`.${installation.identity.cookieDomain}`))
    )
  )
    throw new Error(
      "WorkOS issuer must be an HTTPS AuthKit or SYMBaiEX origin.",
    );
  return url.origin;
}

export function workosPluginConfig(
  environment: Parameters<typeof workosConfig>[0],
) {
  const config = workosConfig(environment);
  return config ? { ...config, audience: WORKOS_PLUGIN_RESOURCE } : null;
}
