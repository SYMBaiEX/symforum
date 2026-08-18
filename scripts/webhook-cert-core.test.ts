import fixture from "../fixtures/webhooks/document-changed.json";
import { describe, expect, test } from "vitest";
import {
  assertAsyncApiContract,
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
});
