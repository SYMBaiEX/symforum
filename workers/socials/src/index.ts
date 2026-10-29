import { BodyReadError, readBoundedBody } from "../../../lib/bounded-body";

const TYPEFULLY_WEBHOOK_PATH = "/webhooks/typefully";
const HEALTH_PATH = "/health";
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TIMESTAMP_AGE_SECONDS = 5 * 60;
const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

const KNOWN_TYPEFULLY_EVENTS = new Set([
  "draft.created",
  "draft.planned",
  "draft.scheduled",
  "draft.published",
  "draft.status_changed",
  "draft.tags_changed",
  "draft.deleted",
]);

export interface SocialsWorkerEnv {
  ASSETS: Fetcher;
  DB: D1DatabaseLike;
  TYPEFULLY_WEBHOOK_SECRET?: string;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface TypefullyPayload {
  event: string;
  data: Record<string, unknown>;
}

const worker = {
  async fetch(
    request: Request,
    env: SocialsWorkerEnv,
    context: ExecutionContextLike,
  ): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === TYPEFULLY_WEBHOOK_PATH) {
        if (request.method !== "POST") {
          return jsonResponse({ error: "Method not allowed" }, 405, {
            Allow: "POST",
          });
        }
        return await receiveTypefullyWebhook(request, env, context);
      }

      if (url.pathname === HEALTH_PATH) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return jsonResponse({ error: "Method not allowed" }, 405, {
            Allow: "GET, HEAD",
          });
        }
        return await healthResponse(request, env);
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        return jsonResponse({ error: "Method not allowed" }, 405, {
          Allow: "GET, HEAD",
        });
      }

      return secureAssetResponse(await env.ASSETS.fetch(request));
    } catch (error) {
      console.error("[socials-worker] request failed", {
        method: request.method,
        pathname: url.pathname,
        error: safeErrorMessage(error),
      });
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  },
};

export default worker;

async function receiveTypefullyWebhook(
  request: Request,
  env: SocialsWorkerEnv,
  context: ExecutionContextLike,
) {
  const secret = env.TYPEFULLY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return jsonResponse({ error: "Webhook receiver is not configured" }, 503, {
      "Retry-After": "60",
    });
  }

  const contentLength = parseContentLength(
    request.headers.get("content-length"),
  );
  if (contentLength !== null && contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Payload too large" }, 413);
  }

  const timestamp = request.headers.get("x-typefully-timestamp")?.trim();
  const signature = request.headers.get("x-typefully-signature")?.trim();
  const eventHeader = request.headers.get("x-typefully-event")?.trim();
  if (!timestamp || !signature || !eventHeader) {
    return jsonResponse({ error: "Missing Typefully signature headers" }, 401);
  }

  if (!/^\d{10}$/.test(timestamp)) {
    return jsonResponse({ error: "Invalid webhook timestamp" }, 401);
  }
  const timestampSeconds = Number(timestamp);
  const currentSeconds = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(currentSeconds - timestampSeconds) > MAX_TIMESTAMP_AGE_SECONDS
  ) {
    return jsonResponse({ error: "Stale webhook timestamp" }, 401);
  }

  const signatureBytes = parseSignature(signature);
  if (signatureBytes === null) {
    return jsonResponse({ error: "Invalid webhook signature" }, 401);
  }

  let rawBody: Uint8Array;
  try {
    rawBody = await readBoundedBody(request, MAX_BODY_BYTES);
  } catch (error) {
    return jsonResponse(
      { error: "Invalid webhook body" },
      error instanceof BodyReadError ? error.status : 400,
    );
  }

  const signedPayload = joinBytes(
    new TextEncoder().encode(`${timestamp}.`),
    rawBody,
  );
  if (!(await verifyHmac(secret, signedPayload, signatureBytes))) {
    return jsonResponse({ error: "Invalid webhook signature" }, 401);
  }

  const payload = parseTypefullyPayload(rawBody);
  if (payload === null) {
    return jsonResponse({ error: "Invalid webhook payload" }, 400);
  }
  if (payload.event !== eventHeader) {
    return jsonResponse({ error: "Webhook event header mismatch" }, 400);
  }

  const payloadSha256 = await sha256Hex(rawBody);
  const eventId = await sha256Hex(signedPayload);
  const draftId = scalarString(payload.data.id ?? payload.data.draft_id);
  const socialSetId = scalarString(payload.data.social_set_id);
  const draftStatus = scalarString(payload.data.status);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO typefully_webhook_events (
      event_id,
      event_type,
      known_event,
      draft_id,
      social_set_id,
      draft_status,
      event_timestamp,
      received_at,
      payload_sha256
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      eventId,
      payload.event,
      KNOWN_TYPEFULLY_EVENTS.has(payload.event) ? 1 : 0,
      draftId,
      socialSetId,
      draftStatus,
      timestampSeconds,
      new Date().toISOString(),
      payloadSha256,
    )
    .run();

  context.waitUntil(
    Promise.resolve().then(() => {
      console.info("[typefully-webhook] accepted", {
        eventId,
        eventType: payload.event,
        draftId,
        knownEvent: KNOWN_TYPEFULLY_EVENTS.has(payload.event),
      });
    }),
  );

  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function healthResponse(request: Request, env: SocialsWorkerEnv) {
  let database = "unavailable";
  try {
    const result = await env.DB.prepare("SELECT 1 AS ok").first<{
      ok: number;
    }>();
    database = result?.ok === 1 ? "ok" : "unavailable";
  } catch {
    database = "unavailable";
  }

  const webhook = env.TYPEFULLY_WEBHOOK_SECRET?.trim()
    ? "configured"
    : "not_configured";
  const healthy = database === "ok" && webhook === "configured";
  const body = JSON.stringify({
    status: healthy ? "ok" : "degraded",
    database,
    webhook,
  });

  return new Response(request.method === "HEAD" ? null : body, {
    status: healthy ? 200 : 503,
    headers: JSON_HEADERS,
  });
}

function parseTypefullyPayload(rawBody: Uint8Array): TypefullyPayload | null {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
    const value: unknown = JSON.parse(decoded);
    if (!isRecord(value) || !isRecord(value.data)) {
      return null;
    }
    if (
      typeof value.event !== "string" ||
      !/^draft\.[a-z_]{1,48}$/.test(value.event)
    ) {
      return null;
    }
    return { event: value.event, data: value.data };
  } catch {
    return null;
  }
}

function parseContentLength(value: string | null) {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseSignature(value: string) {
  const match = /^sha256=([a-f0-9]{64})$/i.exec(value);
  if (!match) return null;
  return hexToBytes(match[1]);
}

async function verifyHmac(
  secret: string,
  payload: Uint8Array,
  signature: Uint8Array,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    copyToArrayBuffer(signature),
    copyToArrayBuffer(payload),
  );
}

async function sha256Hex(value: Uint8Array) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    copyToArrayBuffer(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

function copyToArrayBuffer(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(value.byteLength));
  copy.set(value);
  return copy;
}

function joinBytes(left: Uint8Array, right: Uint8Array) {
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left, 0);
  joined.set(right, left.byteLength);
  return joined;
}

function hexToBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function bytesToHex(value: Uint8Array) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function scalarString(value: unknown) {
  if (typeof value === "string" && value.length <= 200) return value;
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function secureAssetResponse(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");

  const contentType = headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    headers.set(
      "Content-Security-Policy",
      "default-src 'none'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; manifest-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
    );
    headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 240);
  return "Unknown error";
}
