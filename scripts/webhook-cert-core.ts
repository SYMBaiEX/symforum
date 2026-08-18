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

export type VerificationResult =
  | { ok: true; eventId: string; eventType: WebhookEventType }
  | { ok: false; code: string };

/** In-memory guard for a bounded certification session; it is not persistent storage. */
export class WebhookReplayGuard {
  private readonly seen = new Set<string>();

  accept(eventId: string) {
    if (this.seen.has(eventId)) return false;
    this.seen.add(eventId);
    return true;
  }
}

type JsonRecord = Record<string, unknown>;

const schemaDataKeys: Readonly<Record<WebhookEventType, readonly string[]>> = {
  "evidence.document.changed": [
    "documentId",
    "documentVersionId",
    "version",
    "canonicalUrl",
    "kind",
  ],
  "evidence.research.completed": ["researchJobId", "status", "expiresAt"],
  "evidence.export.completed": [
    "exportJobId",
    "status",
    "checksum",
    "recordCount",
    "expiresAt",
  ],
  "evidence.benchmark.completed": ["runId", "runKey", "score", "model"],
  "evidence.claim.verified": [
    "claimId",
    "documentVersionId",
    "status",
    "confidence",
  ],
};

const schemaRequiredDataKeys: Readonly<Record<WebhookEventType, readonly string[]>> = {
  "evidence.document.changed": [
    "documentId",
    "documentVersionId",
    "version",
    "canonicalUrl",
  ],
  "evidence.research.completed": ["researchJobId", "status", "expiresAt"],
  "evidence.export.completed": [
    "exportJobId",
    "status",
    "checksum",
    "recordCount",
    "expiresAt",
  ],
  "evidence.benchmark.completed": ["runId", "runKey", "score", "model"],
  "evidence.claim.verified": [
    "claimId",
    "documentVersionId",
    "status",
    "confidence",
  ],
};

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

function encoderBytes(value: string) {
  return new TextEncoder().encode(value);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  let difference = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function signWebhookBody(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoderBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return `v1=${hex(await crypto.subtle.sign("HMAC", key, encoderBytes(`${timestamp}.${body}`)))}`;
}

export function assertAsyncApiContract() {
  const document = asyncApiDocument as unknown as JsonRecord;
  if (document.asyncapi !== "3.0.0" || !isRecord(document.channels) || !isRecord(document.components)) {
    throw new Error("AsyncAPI webhook contract is malformed");
  }
  const components = document.components;
  if (!isRecord(components.messages) || !isRecord(components.schemas)) {
    throw new Error("AsyncAPI webhook contract is malformed");
  }
  const headers = components.schemas.DeliveryHeaders;
  if (!isRecord(headers) || !Array.isArray(headers.required)) {
    throw new Error("AsyncAPI webhook contract is malformed");
  }
  const declaredRequiredHeaders = headers.required as unknown[];
  const requiredHeaders = [
    "x-symbaiex-event-id",
    "x-symbaiex-event-type",
    "x-symbaiex-timestamp",
    "x-symbaiex-signature",
  ];
  if (!requiredHeaders.every((header) => declaredRequiredHeaders.includes(header))) {
    throw new Error("AsyncAPI webhook contract is malformed");
  }
  for (const eventType of WEBHOOK_EVENT_TYPES) {
    if (!isRecord(document.channels[eventType])) {
      throw new Error("AsyncAPI webhook contract is malformed");
    }
  }
}

type EnvelopeValidation =
  | { kind: "invalid"; result: VerificationResult }
  | { kind: "valid"; envelope: JsonRecord };

function validateEnvelope(body: string, headers: WebhookHeaders): EnvelopeValidation {
  let envelope: unknown;
  try {
    envelope = JSON.parse(body);
  } catch {
    return { kind: "invalid", result: { ok: false, code: "invalid_json" } };
  }
  if (!isRecord(envelope) || typeof envelope.id !== "string" || envelope.id.length === 0) {
    return { kind: "invalid", result: { ok: false, code: "invalid_envelope" } };
  }
  const data = envelope.data;
  if (
    typeof envelope.type !== "string" ||
    !isEventType(envelope.type) ||
    !Number.isInteger(envelope.occurredAt) ||
    (envelope.occurredAt as number) < 0 ||
    !isRecord(data)
  ) {
    return { kind: "invalid", result: { ok: false, code: "invalid_envelope" } };
  }
  if (headers.eventId !== envelope.id || headers.eventType !== envelope.type) {
    return { kind: "invalid", result: { ok: false, code: "header_body_mismatch" } };
  }
  const allowed = schemaDataKeys[envelope.type];
  const required = schemaRequiredDataKeys[envelope.type];
  if (
    !required.every((key) => key in data) ||
    Object.keys(data).some((key) => !allowed.includes(key))
  ) {
    return { kind: "invalid", result: { ok: false, code: "contract_data_mismatch" } };
  }
  return { kind: "valid", envelope };
}

export async function verifyWebhookRequest(args: Readonly<{
  body: string;
  headers: WebhookHeaders;
  secret: string;
  nowSeconds: number;
  maxBodyBytes?: number;
  maxTimestampSkewSeconds?: number;
}>): Promise<VerificationResult> {
  if (encoderBytes(args.body).byteLength > (args.maxBodyBytes ?? MAX_WEBHOOK_BODY_BYTES)) {
    return { ok: false, code: "body_too_large" };
  }
  const { eventId, eventType, timestamp, signature } = args.headers;
  if (!eventId || !eventType || !timestamp || !signature || !isEventType(eventType)) {
    return { ok: false, code: "missing_or_invalid_headers" };
  }
  if (!/^v1=[a-f0-9]{64}$/.test(signature) || !/^(0|[1-9][0-9]*)$/.test(timestamp)) {
    return { ok: false, code: "invalid_signature_or_timestamp" };
  }
  const parsedTimestamp = Number(timestamp);
  if (
    !Number.isSafeInteger(parsedTimestamp) ||
    Math.abs(args.nowSeconds - parsedTimestamp) > (args.maxTimestampSkewSeconds ?? MAX_WEBHOOK_TIMESTAMP_SKEW_SECONDS)
  ) {
    return { ok: false, code: "timestamp_outside_tolerance" };
  }
  const expected = await signWebhookBody(args.secret, timestamp, args.body);
  if (!constantTimeEqual(encoderBytes(expected), encoderBytes(signature))) {
    return { ok: false, code: "signature_mismatch" };
  }
  const envelope = validateEnvelope(args.body, args.headers);
  if (envelope.kind === "invalid") return envelope.result;
  return { ok: true, eventId, eventType };
}
