import { createHash, timingSafeEqual } from "node:crypto";

export const MAX_REQUEST_BYTES = 128 * 1024;
export const PILOT_CONTAINER_NAME = "pilot";

export interface GatewayEnv {
  ELIZA_SHADOW_WORKER_SECRET?: string;
  ELIZA_RUNTIME_WORKER_SECRET?: string;
  ELIZA_SHADOW_CONTAINER: {
    getByName(name: string): { fetch(request: Request): Promise<Response> };
  };
}

function json(status: number, value: Record<string, unknown>): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function unavailable(): Response {
  return json(503, { error: "container_unavailable" });
}

export function validSecret(secret: unknown): secret is string {
  return (
    typeof secret === "string" &&
    secret.length >= 32 &&
    secret.length <= 512 &&
    !/\s/.test(secret)
  );
}

function authorized(header: string | null, secret: string): boolean {
  if (!header?.startsWith("Bearer ") || !validSecret(header.slice(7)))
    return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}

class BodyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function readBoundedBody(
  request: Request,
  limit = MAX_REQUEST_BYTES,
): Promise<Uint8Array> {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength))
      throw new BodyError(400, "invalid_content_length");
    if (Number(declaredLength) > limit)
      throw new BodyError(413, "request_too_large");
  }
  const encoding = request.headers.get("Content-Encoding");
  if (encoding && encoding !== "identity")
    throw new BodyError(415, "unsupported_content_encoding");
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("Content-Type") ?? "",
    )
  ) {
    throw new BodyError(415, "json_required");
  }

  const bytes = new Uint8Array(limit);
  const reader = request.body?.getReader();
  let size = 0;
  if (!reader) return bytes.subarray(0, 0);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > limit) {
        void reader.cancel().catch(() => {});
        throw new BodyError(413, "request_too_large");
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
  } catch (error) {
    if (error instanceof BodyError) throw error;
    throw new BodyError(400, "invalid_body");
  } finally {
    reader.releaseLock();
  }
  return bytes.subarray(0, size);
}

export async function fetchGateway(
  request: Request,
  env: GatewayEnv,
): Promise<Response> {
  const url = new URL(request.url);
  const liveRoute = url.pathname === "/complete" || url.pathname === "/status";
  if (url.pathname === "/healthz" && !url.search && request.method === "GET") {
    // This check must never obtain a Durable Object stub or wake its container.
    const liveConfigured =
      validSecret(env.ELIZA_RUNTIME_WORKER_SECRET) &&
      env.ELIZA_RUNTIME_WORKER_SECRET !== env.ELIZA_SHADOW_WORKER_SECRET;
    return json(200, {
      ok: true,
      scope: "gateway",
      containerHealth: "not_checked",
      shadowOnly: !liveConfigured,
      ...(liveConfigured ? { liveConfigured: true } : {}),
    });
  }
  if (
    url.search ||
    request.method !== "POST" ||
    !["/generate", "/maintenance", "/complete", "/status"].includes(
      url.pathname,
    )
  ) {
    return json(404, {
      error: "not_found",
      ...(liveRoute ? { outcomeUnknown: false } : {}),
    });
  }
  const secret = liveRoute
    ? env.ELIZA_RUNTIME_WORKER_SECRET
    : env.ELIZA_SHADOW_WORKER_SECRET;
  if (
    !validSecret(secret) ||
    (liveRoute && secret === env.ELIZA_SHADOW_WORKER_SECRET)
  ) {
    return json(503, {
      error: "gateway_not_configured",
      ...(liveRoute ? { outcomeUnknown: false } : {}),
    });
  }
  if (!authorized(request.headers.get("Authorization"), secret)) {
    return json(401, {
      error: "unauthorized",
      ...(liveRoute ? { outcomeUnknown: false } : {}),
    });
  }

  let body: Uint8Array;
  try {
    body = await readBoundedBody(
      request,
      url.pathname === "/status" ? 512 : MAX_REQUEST_BYTES,
    );
    if (url.pathname === "/status") {
      let value: unknown;
      try {
        value = JSON.parse(
          new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
            body,
          ),
        );
      } catch {
        throw new BodyError(400, "invalid_request");
      }
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).length !== 1 ||
        typeof (value as { jobId?: unknown }).jobId !== "string" ||
        !/^[A-Za-z0-9:_-]{1,200}$/.test((value as { jobId: string }).jobId)
      )
        throw new BodyError(400, "invalid_request");
    }
  } catch (error) {
    const safe =
      error instanceof BodyError ? error : new BodyError(400, "invalid_body");
    return json(safe.status, {
      error: safe.code,
      ...(liveRoute ? { outcomeUnknown: false } : {}),
    });
  }

  const headers = new Headers(request.headers);
  headers.delete("Host");
  headers.delete("Transfer-Encoding");
  headers.set("Content-Length", String(body.byteLength));
  const forwarded = new Request(`http://container${url.pathname}`, {
    method: "POST",
    headers,
    body,
    signal: request.signal,
    redirect: "manual",
  });
  try {
    // Authentication and full bounded read must finish before this line.
    return await env.ELIZA_SHADOW_CONTAINER.getByName(
      PILOT_CONTAINER_NAME,
    ).fetch(forwarded);
  } catch {
    // Never include platform exception text, provider data, headers or secrets.
    return url.pathname === "/complete"
      ? json(503, { error: "container_unavailable", outcomeUnknown: true })
      : url.pathname === "/status"
        ? json(503, { error: "container_unavailable", outcomeUnknown: false })
        : unavailable();
  }
}
