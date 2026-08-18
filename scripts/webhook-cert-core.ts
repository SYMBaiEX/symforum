import asyncApiDocument from "../contracts/asyncapi/agent-events.json";

export const WEBHOOK_EVENT_TYPES = [
  "evidence.document.changed",
  "evidence.research.completed",
  "evidence.export.completed",
  "evidence.benchmark.completed",
  "evidence.claim.verified",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
export const MAX_WEBHOOK_BODY_BYTES = 16_000;
export const MAX_WEBHOOK_TIMESTAMP_SKEW_SECONDS = 5 * 60;

export type WebhookHeaders = Readonly<{
  eventId?: string;
  eventType?: string;
  timestamp?: string;
  signature?: string;
}>;
export type WebhookBody = string | Uint8Array;
export type VerificationResult =
  | { ok: true; eventId: string; eventType: WebhookEventType }
  | { ok: false; code: string };

type JsonRecord = Record<string, unknown>;
type JsonSchema = JsonRecord;

/** In-memory guard for a bounded certification session; it is not persistent storage. */
export class WebhookReplayGuard {
  private readonly seen = new Set<string>();
  accept(eventId: string) {
    if (this.seen.has(eventId)) return false;
    this.seen.add(eventId);
    return true;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}
function encoderBytes(value: string) {
  return new TextEncoder().encode(value);
}
function bodyBytes(body: WebhookBody) {
  return typeof body === "string" ? encoderBytes(body) : body;
}
function bodyText(body: WebhookBody) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes(body));
  } catch {
    return null;
  }
}
function boundedOverride(value: number | undefined, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
}

/** Preserves byte boundaries until a complete request body is available. */
export function joinWebhookBodyChunks(chunks: readonly Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  let difference = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}
function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function signedInput(timestamp: string, body: WebhookBody) {
  return joinWebhookBodyChunks([encoderBytes(`${timestamp}.`), bodyBytes(body)]);
}
export async function signWebhookBody(secret: string, timestamp: string, body: WebhookBody) {
  const key = await crypto.subtle.importKey("raw", encoderBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `v1=${hex(await crypto.subtle.sign("HMAC", key, signedInput(timestamp, body)))}`;
}

function rootDocument() {
  const document = asyncApiDocument as unknown as JsonRecord;
  if (!isRecord(document.components) || !isRecord(document.components.schemas) || !isRecord(document.components.messages)) {
    throw new Error("AsyncAPI webhook contract is malformed");
  }
  return document;
}
function resolveSchema(schema: JsonSchema, document: JsonRecord): JsonSchema | null {
  const ref = schema.$ref;
  if (typeof ref !== "string") return schema;
  const prefix = "#/components/schemas/";
  if (!ref.startsWith(prefix)) return null;
  const schemas = (document.components as JsonRecord).schemas as JsonRecord;
  const resolved = schemas[ref.slice(prefix.length)];
  return isRecord(resolved) ? resolved : null;
}
function isUri(value: string) {
  try {
    return new URL(value).protocol.length > 1;
  } catch {
    return false;
  }
}

/** Minimal deterministic JSON Schema evaluator for every schema feature used by this contract. */
function matchesSchema(value: unknown, unresolved: JsonSchema, document: JsonRecord): boolean {
  const schema = resolveSchema(unresolved, document);
  if (schema === null) return false;
  if (Array.isArray(schema.allOf) && !schema.allOf.every((part) => isRecord(part) && matchesSchema(value, part, document))) return false;
  if ("const" in schema && value !== schema.const) return false;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  const type = schema.type;
  if (type === "object") {
    if (!isRecord(value)) return false;
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (!required.every((key) => typeof key === "string" && key in value)) return false;
    const properties = isRecord(schema.properties) ? schema.properties : {};
    if (schema.additionalProperties === false && Object.keys(value).some((key) => !(key in properties))) return false;
    return Object.entries(properties).every(([key, child]) => !(key in value) || (isRecord(child) && matchesSchema(value[key], child, document)));
  }
  if (type === "array") {
    if (!Array.isArray(value)) return false;
    return !schema.items || (isRecord(schema.items) && value.every((item) => matchesSchema(item, schema.items as JsonSchema, document)));
  }
  if (type === "string") {
    if (typeof value !== "string") return false;
    if (typeof schema.pattern === "string" && !(new RegExp(schema.pattern).test(value))) return false;
    return schema.format !== "uri" || isUri(value);
  }
  if (type === "integer") return typeof value === "number" && Number.isInteger(value) && (typeof schema.minimum !== "number" || value >= schema.minimum) && (typeof schema.maximum !== "number" || value <= schema.maximum);
  if (type === "number") return typeof value === "number" && Number.isFinite(value) && (typeof schema.minimum !== "number" || value >= schema.minimum) && (typeof schema.maximum !== "number" || value <= schema.maximum);
  return type === undefined;
}

function payloadSchemaFor(eventType: WebhookEventType, document: JsonRecord) {
  const messages = ((document.components as JsonRecord).messages as JsonRecord);
  for (const message of Object.values(messages)) {
    if (!isRecord(message) || message.name !== eventType || !isRecord(message.payload)) continue;
    return message.payload;
  }
  return null;
}

export function assertAsyncApiContract() {
  const document = rootDocument();
  if (document.asyncapi !== "3.0.0" || !isRecord(document.channels)) throw new Error("AsyncAPI webhook contract is malformed");
  const schemas = (document.components as JsonRecord).schemas as JsonRecord;
  const headers = schemas.DeliveryHeaders;
  if (!isRecord(headers) || !Array.isArray(headers.required) || !isRecord(headers.properties)) throw new Error("AsyncAPI webhook contract is malformed");
  const requiredHeaders = ["x-symbaiex-event-id", "x-symbaiex-event-type", "x-symbaiex-timestamp", "x-symbaiex-signature"];
  const required = headers.required as unknown[];
  if (!requiredHeaders.every((header) => required.includes(header))) throw new Error("AsyncAPI webhook contract is malformed");
  for (const eventType of WEBHOOK_EVENT_TYPES) {
    if (!isRecord(document.channels[eventType]) || payloadSchemaFor(eventType, document) === null) throw new Error("AsyncAPI webhook contract is malformed");
  }
}

function validateEnvelope(body: WebhookBody, headers: WebhookHeaders): VerificationResult | null {
  const text = bodyText(body);
  if (text === null) return { ok: false, code: "invalid_utf8" };
  let envelope: unknown;
  try { envelope = JSON.parse(text); } catch { return { ok: false, code: "invalid_json" }; }
  if (!isRecord(envelope) || typeof envelope.id !== "string" || !isEventType(String(envelope.type))) return { ok: false, code: "invalid_envelope" };
  const eventType = envelope.type as WebhookEventType;
  if (headers.eventId !== envelope.id || headers.eventType !== eventType) return { ok: false, code: "header_body_mismatch" };
  const document = rootDocument();
  const schema = payloadSchemaFor(eventType, document);
  if (schema === null || !matchesSchema(envelope, schema, document)) return { ok: false, code: "contract_data_mismatch" };
  return null;
}

export async function verifyWebhookRequest(args: Readonly<{ body: WebhookBody; headers: WebhookHeaders; secret: string; nowSeconds: number; maxBodyBytes?: number; maxTimestampSkewSeconds?: number; }>): Promise<VerificationResult> {
  const maxBodyBytes = boundedOverride(args.maxBodyBytes, MAX_WEBHOOK_BODY_BYTES, MAX_WEBHOOK_BODY_BYTES);
  const maxTimestampSkewSeconds = boundedOverride(args.maxTimestampSkewSeconds, MAX_WEBHOOK_TIMESTAMP_SKEW_SECONDS, MAX_WEBHOOK_TIMESTAMP_SKEW_SECONDS);
  if (maxBodyBytes === null || maxTimestampSkewSeconds === null) return { ok: false, code: "invalid_verifier_options" };
  if (bodyBytes(args.body).byteLength > maxBodyBytes) return { ok: false, code: "body_too_large" };
  const { eventId, eventType, timestamp, signature } = args.headers;
  if (!eventId || !eventType || !timestamp || !signature || !isEventType(eventType)) return { ok: false, code: "missing_or_invalid_headers" };
  if (!/^v1=[a-f0-9]{64}$/.test(signature) || !/^(0|[1-9][0-9]*)$/.test(timestamp)) return { ok: false, code: "invalid_signature_or_timestamp" };
  const parsedTimestamp = Number(timestamp);
  if (!Number.isSafeInteger(parsedTimestamp) || Math.abs(args.nowSeconds - parsedTimestamp) > maxTimestampSkewSeconds) return { ok: false, code: "timestamp_outside_tolerance" };
  const expected = await signWebhookBody(args.secret, timestamp, args.body);
  if (!constantTimeEqual(encoderBytes(expected), encoderBytes(signature))) return { ok: false, code: "signature_mismatch" };
  const contractError = validateEnvelope(args.body, args.headers);
  if (contractError) return contractError;
  return { ok: true, eventId, eventType };
}
