export const DOCS_MCP_PROTOCOL_VERSIONS = [
  "2026-07-28",
  "2025-06-18",
  "2025-03-26",
] as const;
export const DOCS_MCP_MODERN_VERSION = DOCS_MCP_PROTOCOL_VERSIONS[0];

type ProtocolError = { code: number; message: string; data?: unknown };
export type DocsProtocol = "modern" | "legacy";

/** Modern metadata and transport headers must describe the same request. */
export function validateDocsProtocol(
  request: Request,
  body: Record<string, unknown>,
  supportedVersions: readonly string[] = DOCS_MCP_PROTOCOL_VERSIONS,
): DocsProtocol | ProtocolError {
  const version = request.headers.get("mcp-protocol-version");
  const params = isRecord(body.params) ? body.params : null;
  const meta = isRecord(params?._meta) ? params._meta : null;
  const metaVersion = meta?.["io.modelcontextprotocol/protocolVersion"];
  if (metaVersion === undefined && version !== DOCS_MCP_MODERN_VERSION) {
    return version === null ||
      supportedVersions.some((v) => v === version)
      ? "legacy"
      : unsupported(version, supportedVersions);
  }
  if (typeof metaVersion !== "string" || version !== metaVersion) {
    return mismatch("MCP-Protocol-Version must match request _meta.");
  }
  if (metaVersion !== DOCS_MCP_MODERN_VERSION)
    return unsupported(metaVersion, supportedVersions);
  if (!isRecord(meta?.["io.modelcontextprotocol/clientCapabilities"])) {
    return {
      code: -32600,
      message: "Invalid Request: clientCapabilities metadata is required.",
    };
  }
  const client = meta?.["io.modelcontextprotocol/clientInfo"];
  if (
    client !== undefined &&
    (!isRecord(client) ||
      typeof client.name !== "string" ||
      typeof client.version !== "string")
  ) {
    return {
      code: -32600,
      message: "Invalid Request: clientInfo metadata is malformed.",
    };
  }
  if (request.headers.get("mcp-method") !== body.method)
    return mismatch("Mcp-Method must match the request method.");
  const name =
    body.method === "tools/call"
      ? params?.name
      : body.method === "resources/read"
        ? params?.uri
        : undefined;
  if (body.method === "tools/call" || body.method === "resources/read") {
    if (
      typeof name !== "string" ||
      decodeHeader(request.headers.get("mcp-name")) !== name
    ) {
      return mismatch(
        "Mcp-Name must match the requested tool or resource URI.",
      );
    }
  }
  return "modern";
}

function mismatch(message: string): ProtocolError {
  return { code: -32020, message: `Header mismatch: ${message}` };
}

function unsupported(
  requested: string,
  supportedVersions: readonly string[] = DOCS_MCP_PROTOCOL_VERSIONS,
): ProtocolError {
  return {
    code: -32022,
    message: "Unsupported protocol version",
    data: { supported: supportedVersions, requested },
  };
}

function decodeHeader(value: string | null) {
  if (value === null || !value.startsWith("=?base64?")) return value;
  if (!value.endsWith("?=")) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(value.slice(9, -2)), (c) => c.charCodeAt(0)),
    );
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
