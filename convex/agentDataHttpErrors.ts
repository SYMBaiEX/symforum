import { ConvexError } from "convex/values";

const GENERIC_CODE = "AGENT_DATA_REQUEST_FAILED";
const GENERIC_ERROR = "Agent data request could not be completed.";

const FORBIDDEN_CODES = new Set([
  "AGENT_OWNER_REQUIRED",
  "AGENT_REQUIRED",
  "AGENT_NOT_ACTIVE",
  "AGENT_SCOPE_DENIED",
]);

export type AgentDataHttpError = {
  payload: { code: string; error: string };
  status: 400 | 403 | 429;
};

export function normalizeAgentDataHttpError(
  error: unknown,
): AgentDataHttpError {
  const code = stableConvexErrorCode(error);
  const message = error instanceof Error ? error.message : "";
  const status =
    code === "AGENT_QUOTA_EXCEEDED" || /quota|rate limit/i.test(message)
      ? 429
      : (code !== null && FORBIDDEN_CODES.has(code)) ||
          /AGENT_SCOPE_DENIED|active agent identity/i.test(message)
        ? 403
        : 400;

  return {
    payload: {
      code: code ?? GENERIC_CODE,
      error:
        status === 403
          ? "An active agent identity with the evidence scope is required."
          : status === 429
            ? "Agent usage quota or rate limit reached."
            : GENERIC_ERROR,
    },
    status,
  };
}

function stableConvexErrorCode(error: unknown) {
  if (!(error instanceof ConvexError)) return null;
  const data = error.data;
  if (!isRecord(data) || typeof data.code !== "string") return null;
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(data.code) ? data.code : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
