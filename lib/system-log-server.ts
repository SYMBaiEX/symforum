import "server-only";

import { makeFunctionReference } from "convex/server";
import { getServerConvexClient } from "@/lib/server-convex";

type ServerLogInput = {
  level?: "info" | "warn" | "error";
  source?: "client" | "server" | "api" | "convex";
  scope?: string;
  eventType?: string;
  message: string;
  name?: string;
  stack?: string;
  fingerprint?: string;
  path?: string;
  url?: string;
  method?: string;
  statusCode?: number;
  userAgent?: string;
  metadataJson?: string;
};

const systemLogRefs = {
  record: makeFunctionReference<
    "mutation",
    ServerLogInput,
    { logged: boolean; deduped: boolean; id: string | null }
  >("systemLogs:record"),
};

export async function recordSystemLog(input: ServerLogInput) {
  const client = getServerConvexClient();
  if (!client) {
    return;
  }

  try {
    await client.mutation(systemLogRefs.record, withoutUndefined(input));
  } catch {
    // Logging cannot be allowed to break a request path.
  }
}

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as T;
}

export function requestLogContext(request: Request | undefined) {
  if (!request) {
    return {};
  }

  const path = new URL(request.url).pathname;

  return {
    method: request.method,
    path,
    url: request.url,
    userAgent: request.headers.get("user-agent") ?? undefined,
  };
}
