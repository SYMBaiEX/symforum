import { describe, expect, test } from "bun:test";
import {
  fetchGateway,
  MAX_REQUEST_BYTES,
  PILOT_CONTAINER_NAME,
  type GatewayEnv,
} from "../src/gateway";

const secret = "gateway-test-secret-with-at-least-32-characters";
const liveSecret = "runtime-test-secret-with-at-least-32-characters";
const headers = {
  Authorization: `Bearer ${secret}`,
  "Content-Type": "application/json",
};

function fixture(
  fetch = async (_request: Request) => Response.json({ shadowOnly: true }),
) {
  const names: string[] = [];
  const requests: Request[] = [];
  const env: GatewayEnv = {
    ELIZA_SHADOW_WORKER_SECRET: secret,
    ELIZA_SHADOW_CONTAINER: {
      getByName(name) {
        names.push(name);
        return {
          fetch: async (request) => {
            requests.push(request);
            return fetch(request);
          },
        };
      },
    },
  };
  return { env, names, requests };
}

function request(path = "/generate", init: RequestInit = {}): Request {
  return new Request(`https://gateway.example${path}`, {
    method: "POST",
    headers,
    body: "{}",
    ...init,
  });
}

function streamRequest(
  chunks: Uint8Array[],
  extraHeaders: Record<string, string> = {},
) {
  let cancelled = false;
  let reads = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        reads += 1;
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return {
    request: request("/generate", {
      body,
      headers: { ...headers, ...extraHeaders },
    }),
    cancelled: () => cancelled,
    reads: () => reads,
  };
}

describe("gateway routing and pre-wake authorization", () => {
  test("status is live-key-only, exact bounded JSON, and does not wake on invalid input", async () => {
    const { env, names, requests } = fixture(async () =>
      Response.json({ version: 2, state: "unknown" }),
    );
    const status = (body: string, authorization = `Bearer ${liveSecret}`) =>
      request("/status", {
        headers: { ...headers, Authorization: authorization },
        body,
      });
    expect((await fetchGateway(status('{"jobId":"held"}'), env)).status).toBe(
      503,
    );
    env.ELIZA_RUNTIME_WORKER_SECRET = liveSecret;
    expect(
      (await fetchGateway(status('{"jobId":"held"}', `Bearer ${secret}`), env))
        .status,
    ).toBe(401);
    for (const bad of [
      "{}",
      '{"jobId":"bad/id"}',
      '{"jobId":"held","result":true}',
      '{"jobId":"' + "x".repeat(201) + '"}',
      "x".repeat(513),
    ]) {
      expect((await fetchGateway(status(bad), env)).status).toBe(
        bad.length > 512 ? 413 : 400,
      );
    }
    expect(names).toEqual([]);
    const response = await fetchGateway(status('{"jobId":"held"}'), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 2, state: "unknown" });
    expect(names).toEqual([PILOT_CONTAINER_NAME]);
    expect(new URL(requests[0]!.url).pathname).toBe("/status");
    expect(await requests[0]!.text()).toBe('{"jobId":"held"}');
  });
  test("live route requires separate configured bearer before reading or waking", async () => {
    const { env, names, requests } = fixture();
    const missing = await fetchGateway(request("/complete"), env);
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({
      error: "gateway_not_configured",
      outcomeUnknown: false,
    });
    expect(names).toEqual([]);
    env.ELIZA_RUNTIME_WORKER_SECRET = liveSecret;
    const unauthorized = await fetchGateway(request("/complete"), env);
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({
      error: "unauthorized",
      outcomeUnknown: false,
    });
    expect(names).toEqual([]);
    const response = await fetchGateway(
      request("/complete", {
        headers: { ...headers, Authorization: `Bearer ${liveSecret}` },
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(names).toEqual([PILOT_CONTAINER_NAME]);
    expect(new URL(requests[0]!.url).pathname).toBe("/complete");
    expect(
      (
        await fetchGateway(
          request("/generate", {
            headers: { ...headers, Authorization: `Bearer ${liveSecret}` },
          }),
          env,
        )
      ).status,
    ).toBe(401);
    expect(names).toHaveLength(1);
  });

  test("live health advertises configuration without waking a container", async () => {
    const { env, names } = fixture();
    env.ELIZA_RUNTIME_WORKER_SECRET = liveSecret;
    const response = await fetchGateway(
      request("/healthz", { method: "GET", body: undefined }),
      env,
    );
    expect(await response.json()).toEqual({
      ok: true,
      scope: "gateway",
      containerHealth: "not_checked",
      shadowOnly: false,
      liveConfigured: true,
    });
    expect(names).toEqual([]);
  });
  test("public health explicitly checks only the gateway without waking a container", async () => {
    const { env, names } = fixture();
    const response = await fetchGateway(
      request("/healthz", { method: "GET", body: undefined }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      scope: "gateway",
      containerHealth: "not_checked",
      shadowOnly: true,
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(names).toEqual([]);
  });

  test("health is available without any configured worker secret", async () => {
    const { env, names } = fixture();
    delete env.ELIZA_SHADOW_WORKER_SECRET;
    expect(
      (
        await fetchGateway(
          request("/healthz", { method: "GET", body: undefined }),
          env,
        )
      ).status,
    ).toBe(200);
    expect(names).toEqual([]);
  });

  test.each([
    "/baselines",
    "/publish",
    "/generate/extra",
    "/maintenance/",
    "/generate?publish=true",
    "/healthz",
  ])("rejects unsupported route %s without waking", async (path) => {
    const { env, names } = fixture();
    expect((await fetchGateway(request(path), env)).status).toBe(404);
    expect(names).toEqual([]);
  });

  test.each(["GET", "PUT", "DELETE", "OPTIONS", "HEAD"])(
    "rejects %s generation without waking",
    async (method) => {
      const { env, names } = fixture();
      expect(
        (
          await fetchGateway(
            request("/generate", { method, body: undefined }),
            env,
          )
        ).status,
      ).toBe(404);
      expect(names).toEqual([]);
    },
  );

  test.each([
    "",
    `Basic ${secret}`,
    "Bearer short",
    `Bearer ${"x".repeat(64)}`,
    `Bearer ${"x".repeat(513)}`,
  ])(
    "rejects invalid authorization without reading body or waking",
    async (authorization) => {
      const { env, names } = fixture();
      const input = streamRequest([new Uint8Array(MAX_REQUEST_BYTES + 1)], {
        Authorization: authorization,
      });
      expect((await fetchGateway(input.request, env)).status).toBe(401);
      expect(names).toEqual([]);
      expect(input.reads()).toBe(0);
    },
  );

  test.each([undefined, "", "short", "a".repeat(513), " ".repeat(32)])(
    "fails closed for invalid gateway secret",
    async (invalidSecret) => {
      const { env, names } = fixture();
      env.ELIZA_SHADOW_WORKER_SECRET = invalidSecret;
      const response = await fetchGateway(request(), env);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "gateway_not_configured",
      });
      expect(names).toEqual([]);
    },
  );
});

describe("bounded body before container access", () => {
  test("rejects an oversized declared length before reading the stream", async () => {
    const { env, names } = fixture();
    const input = streamRequest([new Uint8Array(1)], {
      "Content-Length": String(MAX_REQUEST_BYTES + 1),
    });
    expect((await fetchGateway(input.request, env)).status).toBe(413);
    expect(input.reads()).toBe(0);
    expect(names).toEqual([]);
  });

  test.each(["-1", "1.5", "NaN", "12, 13"])(
    "rejects malformed declared length %s without waking",
    async (length) => {
      const { env, names } = fixture();
      expect(
        (
          await fetchGateway(
            request("/generate", {
              headers: { ...headers, "Content-Length": length },
            }),
            env,
          )
        ).status,
      ).toBe(400);
      expect(names).toEqual([]);
    },
  );

  test.each([{}, { "Content-Length": "1" }] as Record<string, string>[])(
    "bounds streamed bytes even without a truthful declared length",
    async (extraHeaders) => {
      const { env, names } = fixture();
      const input = streamRequest(
        [
          new Uint8Array(MAX_REQUEST_BYTES),
          new Uint8Array(1),
          new Uint8Array(1),
        ],
        extraHeaders,
      );
      expect((await fetchGateway(input.request, env)).status).toBe(413);
      expect(input.cancelled()).toBe(true);
      expect(input.reads()).toBe(2);
      expect(names).toEqual([]);
    },
  );

  test("does not wake until the complete bounded stream has been read", async () => {
    const { env, names } = fixture();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const pending = fetchGateway(request("/generate", { body }), env);
    controller.enqueue(new TextEncoder().encode("{}"));
    await Promise.resolve();
    expect(names).toEqual([]);
    controller.close();
    expect((await pending).status).toBe(200);
    expect(names).toEqual([PILOT_CONTAINER_NAME]);
  });

  test("preserves exact bytes at the limit, without JSON parsing or UTF-8 rewriting", async () => {
    const bytes = new Uint8Array(MAX_REQUEST_BYTES).fill(255);
    const { env, names } = fixture(async (forwarded) => {
      expect(new Uint8Array(await forwarded.arrayBuffer())).toEqual(bytes);
      expect(forwarded.headers.get("Content-Length")).toBe(
        String(MAX_REQUEST_BYTES),
      );
      return Response.json({ shadowOnly: true });
    });
    expect(
      (await fetchGateway(request("/generate", { body: bytes }), env)).status,
    ).toBe(200);
    expect(names).toEqual(["pilot"]);
  });

  test("returns a safe error for a broken request stream without waking", async () => {
    const { env, names } = fixture();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error(secret));
      },
    });
    const response = await fetchGateway(request("/generate", { body }), env);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_body" });
    expect(names).toEqual([]);
  });

  test.each([
    { "Content-Type": "text/plain" },
    { "Content-Encoding": "gzip" },
  ] as Record<string, string>[])(
    "rejects unsupported body formats before waking",
    async (extraHeaders) => {
      const { env, names } = fixture();
      expect(
        (
          await fetchGateway(
            request("/generate", { headers: { ...headers, ...extraHeaders } }),
            env,
          )
        ).status,
      ).toBe(415);
      expect(names).toEqual([]);
    },
  );
});

describe("singleton forwarding", () => {
  test.each(["/generate", "/maintenance"])(
    "forwards only authenticated %s to pilot and preserves the response",
    async (path) => {
      const { env, names, requests } = fixture(async (forwarded) => {
        expect(forwarded.url).toBe(`http://container${path}`);
        expect(forwarded.method).toBe("POST");
        expect(forwarded.headers.get("Authorization")).toBe(`Bearer ${secret}`);
        expect(forwarded.headers.get("Content-Type")).toBe("application/json");
        expect(forwarded.headers.get("Host")).toBeNull();
        expect(await forwarded.text()).toBe('{"safe":"body"}');
        return new Response("container response", {
          status: 409,
          headers: { "X-Test": "preserved" },
        });
      });
      const response = await fetchGateway(
        request(path, {
          body: '{"safe":"body"}',
          headers: { ...headers, Host: "public.example" },
        }),
        env,
      );
      expect(response.status).toBe(409);
      expect(response.headers.get("X-Test")).toBe("preserved");
      expect(await response.text()).toBe("container response");
      expect(names).toEqual(["pilot"]);
      expect(requests).toHaveLength(1);
    },
  );

  test("never exposes platform exception messages", async () => {
    const { env } = fixture(async () => {
      throw new Error(`platform exception ${secret} request-body provider-key`);
    });
    const response = await fetchGateway(request(), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "container_unavailable" });
  });
});
