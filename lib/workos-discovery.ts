
import { PRIMARY_SITE_URL } from "./site-urls";
import { workosConfig } from "./workos-config";

/** No endpoints are synthesized: AuthKit is the source of OAuth capabilities. */
export async function workosMetadata(fetcher: typeof fetch = fetch) {
  const config = workosConfig(process.env);
  if (!config) return null;
  const response = await fetcher(config.metadata, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json")
  ) {
    throw new Error("Authorization discovery is unavailable.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty authorization metadata.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 64 * 1024)
        throw new Error("Authorization metadata exceeds the size limit.");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const metadata = JSON.parse(new TextDecoder().decode(bytes)) as Record<
    string,
    unknown
  >;
  if (
    !metadata ||
    metadata.issuer !== config.issuer ||
    !Array.isArray(metadata.code_challenge_methods_supported) ||
    !metadata.code_challenge_methods_supported.includes("S256") ||
    !Array.isArray(metadata.response_types_supported) ||
    !metadata.response_types_supported.includes("code")
  ) {
    throw new Error(
      "Authorization metadata does not match the configured provider.",
    );
  }
  for (const field of [
    "authorization_endpoint",
    "token_endpoint",
    "jwks_uri",
  ]) {
    if (typeof metadata[field] !== "string")
      throw new Error("Incomplete authorization metadata.");
  }
  for (const [field, value] of Object.entries(metadata)) {
    if (field.endsWith("_endpoint") || field === "jwks_uri") {
      if (typeof value !== "string")
        throw new Error("Invalid authorization endpoint.");
      const url = new URL(value);
      if (
        url.origin !== config.issuer ||
        url.username ||
        url.password ||
        url.hash
      ) {
        throw new Error(
          "Authorization endpoints must remain on the configured issuer.",
        );
      }
    }
  }
  return metadata;
}

export function oauthPublicConfiguration() {
  const config = workosConfig(process.env);
  if (!config) return null;
  return {
    issuer: config.issuer,
    authorizationServerMetadata: config.metadata,
    resource: config.audience,
    scopes: ["openid", "offline_access"],
    permission: "evidence",
    ownerConnections: PRIMARY_SITE_URL + "/agent/connect",
    documentation: PRIMARY_SITE_URL + "/auth.md",
  };
}
