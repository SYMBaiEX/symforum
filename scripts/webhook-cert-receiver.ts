#!/usr/bin/env bun
import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import {
  assertAsyncApiContract,
  joinWebhookBodyChunks,
  MAX_WEBHOOK_BODY_BYTES,
  verifyWebhookRequest,
  WebhookReplayGuard,
} from "./webhook-cert-core";

const LOCALHOST = "127.0.0.1";
const DEFAULT_MAX_EVENTS = 2;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_STDIN_SECRET_BYTES = 512;

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function positiveInteger(name: string, fallback: number) {
  const value = option(name);
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

async function readStdinSecret() {
  let value = "";
  for await (const chunk of process.stdin) {
    value += String(chunk);
    if (new TextEncoder().encode(value).byteLength > MAX_STDIN_SECRET_BYTES) {
      throw new Error("Webhook signing secret input is too large");
    }
  }
  return value.trim();
}

async function readSigningSecret() {
  const fromEnvironment = process.env.SYMBAIEX_WEBHOOK_SIGNING_SECRET;
  const secret = fromEnvironment ?? (process.argv.includes("--secret-stdin") ? await readStdinSecret() : undefined);
  if (!secret || secret.length < 16) {
    throw new Error("Provide the signing secret once with SYMBAIEX_WEBHOOK_SIGNING_SECRET or --secret-stdin");
  }
  return secret;
}

function reject(response: import("node:http").ServerResponse, status: number, code: string) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify({ accepted: false, code }));
}

function singleHeader(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function forceClose(
  server: ReturnType<typeof createServer>,
  requests: Set<IncomingMessage>,
  sockets: Set<Socket>,
) {
  for (const request of requests) request.destroy();
  for (const socket of sockets) socket.destroy();
  server.close();
  // A socket or parser should never keep this disposable verifier alive indefinitely.
  setTimeout(() => process.exit(0), 1_000).unref();
}

async function main() {
  if (option("--host") !== undefined) throw new Error("The certification receiver always binds to 127.0.0.1");
  assertAsyncApiContract();
  const secret = await readSigningSecret();
  const port = positiveInteger("--port", 8788);
  const maxEvents = positiveInteger("--max-events", DEFAULT_MAX_EVENTS);
  const timeoutMs = positiveInteger("--timeout-ms", DEFAULT_TIMEOUT_MS);
  const replayGuard = new WebhookReplayGuard();
  let acceptedEvents = 0;
  let closed = false;
  const activeRequests = new Set<IncomingMessage>();
  const sockets = new Set<Socket>();
  const server = createServer(async (request, response) => {
    activeRequests.add(request);
    request.once("close", () => activeRequests.delete(request));
    if (request.method !== "POST" || request.url !== "/webhooks/symbaiex") {
      reject(response, 404, "not_found");
      return;
    }
    const declaredLength = singleHeader(request.headers["content-length"]);
    if (declaredLength && (!/^[0-9]+$/.test(declaredLength) || Number(declaredLength) > MAX_WEBHOOK_BODY_BYTES)) {
      request.resume();
      reject(response, 413, "body_too_large");
      return;
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for await (const chunk of request) {
        const raw = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
        bytes += raw.byteLength;
        if (bytes > MAX_WEBHOOK_BODY_BYTES) {
          request.resume();
          reject(response, 413, "body_too_large");
          return;
        }
        chunks.push(raw);
      }
      const body = joinWebhookBodyChunks(chunks);
      const result = await verifyWebhookRequest({
        body,
        secret,
        nowSeconds: Math.floor(Date.now() / 1_000),
        headers: {
          eventId: singleHeader(request.headers["x-symbaiex-event-id"]),
          eventType: singleHeader(request.headers["x-symbaiex-event-type"]),
          timestamp: singleHeader(request.headers["x-symbaiex-timestamp"]),
          signature: singleHeader(request.headers["x-symbaiex-signature"]),
        },
      });
      if (!result.ok) {
        reject(response, result.code === "body_too_large" ? 413 : 401, result.code);
        return;
      }
      if (!replayGuard.accept(result.eventId)) {
        reject(response, 409, "duplicate_event");
        return;
      }
      acceptedEvents += 1;
      response.writeHead(204, { "cache-control": "no-store" });
      response.end();
      if (acceptedEvents >= maxEvents && !closed) {
        closed = true;
        response.once("finish", () => forceClose(server, activeRequests, sockets));
      }
    } catch {
      reject(response, 400, "invalid_request");
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const timeout = setTimeout(() => forceClose(server, activeRequests, sockets), timeoutMs);
  server.on("close", () => clearTimeout(timeout));
  server.listen(port, LOCALHOST, () => {
    console.log(`Webhook certification receiver listening at http://${LOCALHOST}:${port}/webhooks/symbaiex`);
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unable to start webhook certification receiver";
  console.error(message);
  process.exitCode = 1;
});
