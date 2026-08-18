import fixture from "../fixtures/webhooks/document-changed.json";
import { describe, expect, test } from "vitest";
import {
  assertAsyncApiContract,
  joinWebhookBodyChunks,
  MAX_WEBHOOK_BODY_BYTES,
  signWebhookBody,
  verifyWebhookRequest,
  WebhookReplayGuard,
} from "./webhook-cert-core";

const secret = "certification-secret-not-for-production";
const timestamp = "1735689600";
const body = JSON.stringify(fixture);

async function signedRequest(overrides: Partial<Parameters<typeof verifyWebhookRequest>[0]> = {}) {
  const signature = await signWebhookBody(secret, timestamp, body);
  return {
    body,
    secret,
    nowSeconds: Number(timestamp),
    headers: {
      eventId: fixture.id,
      eventType: fixture.type,
      timestamp,
      signature,
    },
    ...overrides,
  };
}

async function correctlySigned(bodyValue: string | Uint8Array, eventId: string, eventType: string) {
  return {
    body: bodyValue,
    secret,
    nowSeconds: Number(timestamp),
    headers: {
      eventId,
      eventType,
      timestamp,
      signature: await signWebhookBody(secret, timestamp, bodyValue),
    },
  };
}

describe("webhook certification core", () => {
  test("keeps the local verifier aligned with the published AsyncAPI contract", () => {
    expect(() => assertAsyncApiContract()).not.toThrow();
  });

  test("accepts a valid deterministic fixture", async () => {
    await expect(verifyWebhookRequest(await signedRequest())).resolves.toEqual({
      ok: true,
      eventId: fixture.id,
      eventType: fixture.type,
    });
  });

  test("rejects tampered requests without including signing material in the result", async () => {
    const request = await signedRequest({ body: `${body} ` });
    const result = await verifyWebhookRequest(request);
    expect(result).toEqual({ ok: false, code: "signature_mismatch" });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  test("rejects stale timestamps", async () => {
    const request = await signedRequest({ nowSeconds: Number(timestamp) + 301 });
    await expect(verifyWebhookRequest(request)).resolves.toEqual({
      ok: false,
      code: "timestamp_outside_tolerance",
    });
  });

  test("rejects an oversized body before verification", async () => {
    const request = await signedRequest({ body: "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1) });
    await expect(verifyWebhookRequest(request)).resolves.toEqual({
      ok: false,
      code: "body_too_large",
    });
  });

  test("rejects a valid event id when it is replayed within a certification session", async () => {
    const first = await verifyWebhookRequest(await signedRequest());
    const second = await verifyWebhookRequest(await signedRequest());
    expect(first).toMatchObject({ ok: true, eventId: fixture.id });
    expect(second).toMatchObject({ ok: true, eventId: fixture.id });
    const guard = new WebhookReplayGuard();
    expect(guard.accept(fixture.id)).toBe(true);
    expect(guard.accept(fixture.id)).toBe(false);
  });

  test("validates contract value types and constants after HMAC verification", async () => {
    const invalidBenchmarkData = [
      { runId: 1, runKey: "run", score: 1, model: "model" },
      { runId: "run", runKey: [], score: 1, model: "model" },
      { runId: "run", runKey: "run", score: "1", model: "model" },
      { runId: "run", runKey: "run", score: 1, model: null },
    ];
    for (const data of invalidBenchmarkData) {
      const benchmark = JSON.stringify({
        id: "benchmark-cert-001",
        type: "evidence.benchmark.completed",
        occurredAt: Number(timestamp),
        data,
      });
      await expect(
        verifyWebhookRequest(await correctlySigned(benchmark, "benchmark-cert-001", "evidence.benchmark.completed")),
      ).resolves.toEqual({ ok: false, code: "contract_data_mismatch" });
    }
  });

  test("validates real changedFields payloads and signs raw bytes across split UTF-8 chunks", async () => {
    const unicodeBody = JSON.stringify({
      ...fixture,
      data: { ...fixture.data, changedFields: ["títle", "excerpt"] },
    });
    const bytes = new TextEncoder().encode(unicodeBody);
    const accentedByte = bytes.indexOf(0xc3);
    expect(accentedByte).toBeGreaterThan(0);
    const split = joinWebhookBodyChunks([bytes.slice(0, accentedByte + 1), bytes.slice(accentedByte + 1)]);
    await expect(
      verifyWebhookRequest(await correctlySigned(split, fixture.id, fixture.type)),
    ).resolves.toMatchObject({ ok: true, eventId: fixture.id });
  });

  test.each([
    { maxBodyBytes: Number.NaN },
    { maxBodyBytes: Number.POSITIVE_INFINITY },
    { maxBodyBytes: -1 },
    { maxBodyBytes: MAX_WEBHOOK_BODY_BYTES + 1 },
    { maxTimestampSkewSeconds: Number.NaN },
    { maxTimestampSkewSeconds: Number.POSITIVE_INFINITY },
    { maxTimestampSkewSeconds: -1 },
    { maxTimestampSkewSeconds: 301 },
  ])("fails closed for invalid verifier overrides: %o", async (overrides) => {
    await expect(verifyWebhookRequest(await signedRequest(overrides))).resolves.toEqual({
      ok: false,
      code: "invalid_verifier_options",
    });
  });
});
