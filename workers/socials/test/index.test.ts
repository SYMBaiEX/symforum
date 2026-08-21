import { existsSync, readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import worker, { type SocialsWorkerEnv } from "../src/index";

const WEBHOOK_SECRET = "test-webhook-secret";
const NOW_SECONDS = 1_787_200_000;
const LANDING_PAGE = readFileSync(
  new URL("../public/index.html", import.meta.url),
  "utf8",
);
const SIGNAL_MOTH_SCRIPT = readFileSync(
  new URL("../public/signal-moth.js", import.meta.url),
  "utf8",
);
const SIGNAL_MOTH_STYLES = readFileSync(
  new URL("../public/signal-moth.css", import.meta.url),
  "utf8",
);

class TestDatabase {
  inserts: unknown[][] = [];
  healthAvailable = true;

  prepare(query: string) {
    const database = this;
    let values: unknown[] = [];
    return {
      bind(...nextValues: unknown[]) {
        values = nextValues;
        return this;
      },
      async first<T>() {
        if (!database.healthAvailable) throw new Error("database unavailable");
        return { ok: 1 } as T;
      },
      async run() {
        if (!query.includes("INSERT OR IGNORE")) {
          throw new Error("unexpected query");
        }
        database.inserts.push(values);
        return { success: true };
      },
    };
  }
}

function testEnv(database = new TestDatabase()): SocialsWorkerEnv {
  return {
    ASSETS: {
      async fetch() {
        return new Response("<h1>socials</h1>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
    },
    DB: database,
    TYPEFULLY_WEBHOOK_SECRET: WEBHOOK_SECRET,
  };
}

function testContext() {
  const promises: Promise<unknown>[] = [];
  return {
    promises,
    waitUntil(promise: Promise<unknown>) {
      promises.push(promise);
    },
  };
}

async function signedWebhookRequest(
  payload: Record<string, unknown>,
  options: { secret?: string; timestamp?: number; eventHeader?: string } = {},
) {
  const timestamp = String(options.timestamp ?? NOW_SECONDS);
  const rawBody = JSON.stringify(payload);
  const signedBody = new TextEncoder().encode(`${timestamp}.${rawBody}`);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(options.secret ?? WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, signedBody),
  );
  const signatureHex = Array.from(signature, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return new Request("https://socials.symbaiex.com/webhooks/typefully", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-typefully-event":
        options.eventHeader ?? String(payload.event ?? "draft.created"),
      "x-typefully-signature": `sha256=${signatureHex}`,
      "x-typefully-timestamp": timestamp,
    },
    body: rawBody,
  });
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW_SECONDS * 1000);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("socials worker", () => {
  it("keeps the compact responsive layout and current contact details", () => {
    expect(LANDING_PAGE).not.toContain("/about-symbiex-portrait-dark.webp");
    expect(LANDING_PAGE).not.toContain(".portrait");
    expect(LANDING_PAGE).toContain("mailto:austin@symbaiex.com");
    expect(LANDING_PAGE).toContain("white-space: nowrap");
    expect(LANDING_PAGE).toContain("text-align: center");
    expect(LANDING_PAGE).toContain("<h1>SYMBiEX's Socials</h1>");
    expect(LANDING_PAGE).toContain('class="signal-moth-track is-ready"');
    expect(LANDING_PAGE).toContain(
      'href="/images/pets/signal-moth-optimized.webp"',
    );
    expect(LANDING_PAGE).toContain('rel="preload"');
    expect(LANDING_PAGE).toContain('src="/signal-moth.js"');
    expect(LANDING_PAGE).toContain('href="/signal-moth.css"');
    expect(SIGNAL_MOTH_STYLES).toContain("signal-moth-patrol 32s");
    expect(SIGNAL_MOTH_STYLES).toContain("prefers-reduced-motion: reduce");
    expect(SIGNAL_MOTH_SCRIPT).toContain(
      '["waving", "jumping", "waiting", "review", "failed"]',
    );
    expect(SIGNAL_MOTH_SCRIPT).toContain(
      'addEventListener("click", playAction)',
    );
    expect(SIGNAL_MOTH_SCRIPT).not.toContain("readyTimeout");
    expect(SIGNAL_MOTH_SCRIPT).not.toMatch(/console\.|debugger/);
    for (const asset of [
      "../public/signal-moth.js",
      "../public/signal-moth.css",
      "../public/images/pets/signal-moth-thumb.webp",
      "../public/images/pets/signal-moth-optimized.webp",
    ]) {
      expect(existsSync(new URL(asset, import.meta.url))).toBe(true);
    }
    expect(LANDING_PAGE).not.toContain("text-shadow:");
    expect(LANDING_PAGE).not.toContain("box-shadow:");
    expect(LANDING_PAGE).toContain("justify-content: flex-end");
    expect(LANDING_PAGE).toContain("min-height: 100svh");
    expect(LANDING_PAGE).toContain('class="content"');
    expect(LANDING_PAGE).toMatch(
      /\.content\s*\{[\s\S]*?justify-content: center/,
    );
    expect(LANDING_PAGE).not.toContain('id="links-title"');
    expect(LANDING_PAGE).not.toContain(".links-heading");
    expect(LANDING_PAGE).toContain('aria-label="Social profiles"');
    expect(LANDING_PAGE).not.toContain('class="index"');
    expect(LANDING_PAGE).not.toContain(".index {");
    expect(LANDING_PAGE).not.toContain("border-top: 1px solid var(--ink)");
    expect(LANDING_PAGE).toContain(".link-list li:last-child .signal-link");
    expect(LANDING_PAGE).toContain("overflow-wrap: anywhere");
    expect(
      LANDING_PAGE.match(/class="signal-link"\s+data-accent=/g),
    ).toHaveLength(6);
    expect(LANDING_PAGE).not.toMatch(/Dallas|Find the|S\/AI|Online/);
  });

  it("serves the landing page with strict browser headers", async () => {
    const response = await worker.fetch(
      new Request("https://socials.symbaiex.com/"),
      testEnv(),
      testContext(),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("socials");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
    expect(response.headers.get("cache-control")).toBe(
      "no-cache, no-store, must-revalidate",
    );
  });

  it("reports ready only when both D1 and the webhook secret are available", async () => {
    const ready = await worker.fetch(
      new Request("https://socials.symbaiex.com/health"),
      testEnv(),
      testContext(),
    );
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toEqual({
      status: "ok",
      database: "ok",
      webhook: "configured",
    });

    const env = testEnv();
    delete env.TYPEFULLY_WEBHOOK_SECRET;
    const degraded = await worker.fetch(
      new Request("https://socials.symbaiex.com/health"),
      env,
      testContext(),
    );
    expect(degraded.status).toBe(503);
  });

  it("accepts a correctly signed event and stores metadata, not draft text", async () => {
    const database = new TestDatabase();
    const context = testContext();
    const request = await signedWebhookRequest({
      event: "draft.published",
      data: {
        id: 123,
        social_set_id: 327474,
        status: "published",
        text: "private draft text must not enter the ledger",
      },
    });

    const response = await worker.fetch(request, testEnv(database), context);
    await Promise.all(context.promises);

    expect(response.status).toBe(204);
    expect(database.inserts).toHaveLength(1);
    expect(database.inserts[0]).toHaveLength(9);
    expect(database.inserts[0]).toContain("draft.published");
    expect(database.inserts[0]).toContain("123");
    expect(database.inserts[0]).not.toContain(
      "private draft text must not enter the ledger",
    );
  });

  it("rejects an invalid signature", async () => {
    const request = await signedWebhookRequest(
      { event: "draft.created", data: { id: 123 } },
      { secret: "wrong-secret" },
    );
    const response = await worker.fetch(request, testEnv(), testContext());
    expect(response.status).toBe(401);
  });

  it("rejects stale deliveries to prevent replay attacks", async () => {
    const request = await signedWebhookRequest(
      { event: "draft.created", data: { id: 123 } },
      { timestamp: NOW_SECONDS - 301 },
    );
    const response = await worker.fetch(request, testEnv(), testContext());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Stale webhook timestamp",
    });
  });

  it("rejects a disagreement between the signed header and payload", async () => {
    const request = await signedWebhookRequest(
      { event: "draft.created", data: { id: 123 } },
      { eventHeader: "draft.published" },
    );
    const response = await worker.fetch(request, testEnv(), testContext());
    expect(response.status).toBe(400);
  });

  it("does not expose a webhook route over GET", async () => {
    const response = await worker.fetch(
      new Request("https://socials.symbaiex.com/webhooks/typefully"),
      testEnv(),
      testContext(),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
