import { createHash, timingSafeEqual } from 'node:crypto';

export const MAX_REQUEST_BYTES = 128 * 1024;
export const PILOT_CONTAINER_NAME = 'pilot';

export interface GatewayEnv {
  ELIZA_SHADOW_WORKER_SECRET?: string;
  ELIZA_SHADOW_CONTAINER: {
    getByName(name: string): { fetch(request: Request): Promise<Response> };
  };
}

function json(status: number, value: Record<string, unknown>): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export function unavailable(): Response {
  return json(503, { error: 'container_unavailable' });
}

export function validSecret(secret: unknown): secret is string {
  return typeof secret === 'string' && secret.length >= 32 && secret.length <= 512 && !/\s/.test(secret);
}

function authorized(header: string | null, secret: string): boolean {
  if (!header?.startsWith('Bearer ') || !validSecret(header.slice(7))) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}

class BodyError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) throw new BodyError(400, 'invalid_content_length');
    if (Number(declaredLength) > MAX_REQUEST_BYTES) throw new BodyError(413, 'request_too_large');
  }
  const encoding = request.headers.get('Content-Encoding');
  if (encoding && encoding !== 'identity') throw new BodyError(415, 'unsupported_content_encoding');
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) {
    throw new BodyError(415, 'json_required');
  }

  const bytes = new Uint8Array(MAX_REQUEST_BYTES);
  const reader = request.body?.getReader();
  let size = 0;
  if (!reader) return bytes.subarray(0, 0);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > MAX_REQUEST_BYTES) {
        void reader.cancel().catch(() => {});
        throw new BodyError(413, 'request_too_large');
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
  } catch (error) {
    if (error instanceof BodyError) throw error;
    throw new BodyError(400, 'invalid_body');
  } finally {
    reader.releaseLock();
  }
  return bytes.subarray(0, size);
}

export async function fetchGateway(request: Request, env: GatewayEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/healthz' && !url.search && request.method === 'GET') {
    // This check must never obtain a Durable Object stub or wake its container.
    return json(200, { ok: true, scope: 'gateway', containerHealth: 'not_checked', shadowOnly: true });
  }
  if (url.search || request.method !== 'POST' || !['/generate', '/maintenance'].includes(url.pathname)) {
    return json(404, { error: 'not_found' });
  }
  if (!validSecret(env.ELIZA_SHADOW_WORKER_SECRET)) {
    return json(503, { error: 'gateway_not_configured' });
  }
  if (!authorized(request.headers.get('Authorization'), env.ELIZA_SHADOW_WORKER_SECRET)) {
    return json(401, { error: 'unauthorized' });
  }

  let body: Uint8Array;
  try {
    body = await readBoundedBody(request);
  } catch (error) {
    const safe = error instanceof BodyError ? error : new BodyError(400, 'invalid_body');
    return json(safe.status, { error: safe.code });
  }

  const headers = new Headers(request.headers);
  headers.delete('Host');
  headers.delete('Transfer-Encoding');
  headers.set('Content-Length', String(body.byteLength));
  const forwarded = new Request(`http://container${url.pathname}`, {
    method: 'POST',
    headers,
    body,
    signal: request.signal,
    redirect: 'manual',
  });
  try {
    // Authentication and full bounded read must finish before this line.
    return await env.ELIZA_SHADOW_CONTAINER.getByName(PILOT_CONTAINER_NAME).fetch(forwarded);
  } catch {
    // Never include platform exception text, provider data, headers or secrets.
    return unavailable();
  }
}
