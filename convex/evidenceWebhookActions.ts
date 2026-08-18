import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { env, internalAction } from "./_generated/server";
import {
  decryptWebhookSecret,
  parseAllowedHosts,
  validateWebhookUrl,
} from "./evidenceWebhooks";

const getDeliveryInputRef = makeFunctionReference<
  "query",
  { deliveryId: Id<"apiWebhookDeliveries"> },
  {
    deliveryId: Id<"apiWebhookDeliveries">;
    subscriptionId: Id<"apiWebhookSubscriptions">;
    attempt: number;
    eventKey: string;
    url: string;
    status: "active" | "paused" | "revoked";
    eventType:
      | "evidence.document.changed"
      | "evidence.research.completed"
      | "evidence.export.completed"
      | "evidence.benchmark.completed"
      | "evidence.claim.verified";
    payloadJson: string;
    signingSecretCiphertext?: string;
    signingSecretNonce?: string;
  } | null
>("evidenceWebhooks:getDeliveryInput");
const markDeliveryRef = makeFunctionReference<
  "mutation",
  {
    deliveryId: Id<"apiWebhookDeliveries">;
    delivered: boolean;
    responseCode?: number;
    errorMessage?: string;
  },
  null
>("evidenceWebhooks:markDelivery");

const MAX_DELIVERY_BODY_BYTES = 16_000;
const DELIVERY_TIMEOUT_MS = 5_000;

function limitedError(error: unknown) {
  return (error instanceof Error ? error.message : "Webhook delivery failed")
    .replace(/\s+/g, " ")
    .slice(0, 400);
}

function hex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function hmac(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
}

export const deliver = internalAction({
  args: { deliveryId: v.id("apiWebhookDeliveries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const webhookEnv = env as typeof env & {
      readonly EVIDENCE_WEBHOOK_ALLOWED_HOSTS: string | undefined;
      readonly EVIDENCE_WEBHOOK_KEK: string | undefined;
    };
    const input = await ctx.runQuery(getDeliveryInputRef, {
      deliveryId: args.deliveryId,
    });
    if (input === null) return null;
    if (input.status !== "active") {
      await ctx.runMutation(markDeliveryRef, {
        deliveryId: input.deliveryId,
        delivered: false,
        errorMessage: "Subscription is not active",
      });
      return null;
    }

    let url: string;
    try {
      url = validateWebhookUrl(
        input.url,
        parseAllowedHosts(webhookEnv.EVIDENCE_WEBHOOK_ALLOWED_HOSTS),
      );
    } catch (error) {
      await ctx.runMutation(markDeliveryRef, {
        deliveryId: input.deliveryId,
        delivered: false,
        errorMessage: limitedError(error),
      });
      return null;
    }
    if (
      !webhookEnv.EVIDENCE_WEBHOOK_KEK ||
      !input.signingSecretCiphertext ||
      !input.signingSecretNonce
    ) {
      await ctx.runMutation(markDeliveryRef, {
        deliveryId: input.deliveryId,
        delivered: false,
        errorMessage: "Webhook signing is unavailable",
      });
      return null;
    }

    let signingSecret: string;
    try {
      signingSecret = await decryptWebhookSecret(
        webhookEnv.EVIDENCE_WEBHOOK_KEK,
        input.signingSecretCiphertext,
        input.signingSecretNonce,
      );
    } catch {
      await ctx.runMutation(markDeliveryRef, {
        deliveryId: input.deliveryId,
        delivered: false,
        errorMessage: "Webhook signing material is unavailable",
      });
      return null;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(input.payloadJson);
    } catch {
      await ctx.runMutation(markDeliveryRef, {
        deliveryId: input.deliveryId,
        delivered: false,
        errorMessage: "Stored webhook payload is invalid",
      });
      return null;
    }
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const body = JSON.stringify({
      id: input.eventKey,
      type: input.eventType,
      occurredAt: Number(timestamp),
      data: payload,
    });
    if (new TextEncoder().encode(body).byteLength > MAX_DELIVERY_BODY_BYTES) {
      await ctx.runMutation(markDeliveryRef, {
        deliveryId: input.deliveryId,
        delivered: false,
        errorMessage: "Webhook body exceeded bounded delivery size",
      });
      return null;
    }

    const signature = await hmac(
      signingSecret,
      `${timestamp}.${body}`,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "user-agent": "SYMBaiEX-Evidence-Webhook/1.0",
          "x-symbaiex-event-id": input.eventKey,
          "x-symbaiex-event-type": input.eventType,
          "x-symbaiex-timestamp": timestamp,
          "x-symbaiex-signature": `v1=${signature}`,
        },
        body,
      });
      await ctx.runMutation(markDeliveryRef, {
        deliveryId: input.deliveryId,
        delivered: response.ok,
        responseCode: response.status,
        ...(response.ok
          ? {}
          : { errorMessage: `Endpoint returned HTTP ${response.status}` }),
      });
    } catch (error) {
      await ctx.runMutation(markDeliveryRef, {
        deliveryId: input.deliveryId,
        delivered: false,
        errorMessage: limitedError(error),
      });
    } finally {
      clearTimeout(timer);
    }
    return null;
  },
});
