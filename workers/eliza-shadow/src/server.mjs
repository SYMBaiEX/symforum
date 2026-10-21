import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import {
  MAX_REQUEST_BYTES,
  RUNTIME_VERSION,
  WorkerError,
} from "./contract.mjs";

export function validSecret(secret) {
  return (
    typeof secret === "string" &&
    secret.length >= 32 &&
    secret.length <= 512 &&
    !/\s/.test(secret)
  );
}

function authorized(header, secret) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const digest = (value) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}

async function readRequest(req) {
  if (Number(req.headers["content-length"]) > MAX_REQUEST_BYTES)
    throw new WorkerError("request_too_large", 413);
  if (
    req.headers["content-encoding"] &&
    req.headers["content-encoding"] !== "identity"
  )
    throw new WorkerError("unsupported_content_encoding", 415);
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || ""))
    throw new WorkerError("json_required", 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES)
      throw new WorkerError("request_too_large", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new WorkerError("invalid_json");
  }
}

export function createHttpServer({
  service,
  secret,
  log = (event) => console.log(JSON.stringify(event)),
}) {
  if (!validSecret(secret)) throw new WorkerError("invalid_worker_secret", 500);
  const server = createServer(async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(value));
    };
    if (req.url === "/healthz" && req.method === "GET") {
      return send(service.stopped ? 503 : 200, {
        ok: !service.stopped,
        shadowOnly: true,
        runtimeVersion: RUNTIME_VERSION,
        busy: service.busy,
      });
    }
    if (
      !["/generate", "/maintenance"].includes(req.url) ||
      req.method !== "POST"
    )
      return send(404, { error: "not_found" });
    if (!authorized(req.headers.authorization, secret))
      return send(401, { error: "unauthorized" });
    try {
      const input = await readRequest(req);
      send(
        200,
        req.url === "/maintenance"
          ? await service.maintenance()
          : await service.generate(input),
      );
    } catch (error) {
      const safe =
        error instanceof WorkerError
          ? error
          : new WorkerError("worker_internal_error", 503);
      // Never log headers, request data, provider errors/bodies or exception text.
      log({
        event: "generation_rejected",
        code: safe.code,
        status: safe.status,
      });
      if (!res.destroyed) send(safe.status, { error: safe.code });
    }
  });
  server.requestTimeout = 130_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return server;
}
