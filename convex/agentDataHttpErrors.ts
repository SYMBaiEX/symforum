import { ConvexError } from "convex/values";

const GENERIC_CODE = "AGENT_DATA_REQUEST_FAILED";
const GENERIC_ERROR = "Agent data request could not be completed.";

const FORBIDDEN_CODES = new Set([
  "AGENT_OWNER_REQUIRED",
  "AGENT_REQUIRED",
  "AGENT_NOT_ACTIVE",
  "AGENT_SCOPE_DENIED",
  "SERVICE_ACCOUNT_DENIED",
  "COMMAND_DENIED",
]);

const CONFLICT_CODES = new Set([
  "IDEMPOTENCY_REPLAY_IN_PROGRESS",
  "IDEMPOTENCY_REPLAY_FAILED",
  "IDEMPOTENCY_REPLAY_UNAVAILABLE",
  "COMMAND_IDEMPOTENCY_MISMATCH",
  "QUOTA_IDEMPOTENCY_MISMATCH",
]);

const BUDGET_CODES = new Set([
  "ORGANIZATION_SPEND_DISABLED",
  "ORGANIZATION_BUDGET_EXCEEDED",
]);

export type AgentDataHttpError = {
  payload: { code: string; error: string };
  status: 400 | 401 | 403 | 409 | 429;
};

export function normalizeAgentDataHttpError(
  error: unknown,
): AgentDataHttpError {
  const code = stableConvexErrorCode(error);
  const message = error instanceof Error ? error.message : "";
  const status =
    code === "AUTH_REQUIRED"
      ? 401
      : (code !== null && BUDGET_CODES.has(code)) ||
          code === "AGENT_QUOTA_EXCEEDED" ||
          /quota|rate limit|budget/i.test(message)
        ? 429
        : code !== null && CONFLICT_CODES.has(code)
          ? 409
          : (code !== null && FORBIDDEN_CODES.has(code)) ||
              /AGENT_SCOPE_DENIED|active agent identity/i.test(message)
            ? 403
            : 400;

  return {
    payload: {
      code: code ?? GENERIC_CODE,
      error:
        status === 401
          ? "A valid bearer access token is required."
          : status === 403
            ? "An active agent identity with the evidence scope is required."
            : status === 429
              ? "Agent usage quota, rate limit, or spend budget reached."
              : status === 409
                ? "The idempotent request cannot be replayed yet."
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
