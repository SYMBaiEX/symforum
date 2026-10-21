import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRuntimeBackend } from "../src/runtime.mjs";
import { createHttpServer } from "../src/server.mjs";
import { SqlJobStore } from "../src/store.mjs";
import {
  createLiveProvider,
  LiveService,
  LIVE_AGENTS,
  liveInputHash,
  validateLiveRequest,
} from "../src/live.mjs";

const shadowSecret = "shadow-worker-secret-with-at-least-32-characters";
const liveSecret = "runtime-worker-secret-with-at-least-32-characters";
const completion = {
  id: "chatcmpl-1",
  model: "openrouter/free",
  choices: [
    {
      index: 0,
      finish_reason: "stop",
      message: { role: "assistant", content: "done" },
    },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 1, cost: 0.00001 },
};
const body = {
  model: "openrouter/free",
  messages: [
    { role: "system", content: "private prompt" },
    { role: "user", content: "write" },
  ],
  max_tokens: 100,
  response_format: { type: "json_object" },
  provider: { allow_fallbacks: false },
  reasoning: { effort: "low" },
};
const request = (extra = {}) => ({
  version: 2,
  jobId: "live-job",
  inputHash: liveInputHash(body),
  agentSlug: "suki",
  stage: "suki:forum-reply",
  body,
  ...extra,
});

test("status reads only fixed ledger metadata and never invokes inference", async () => {
  const seen = [];
  const row = {
    job_id: "eliza-held-job",
    input_hash: "a".repeat(64),
    request_hash: "b".repeat(64),
    state: "unknown",
    error_code: "provider_unavailable",
    created_at: new Date("2026-10-20T00:00:00.000Z"),
    updated_at: new Date("2026-10-20T00:00:08.000Z"),
    result: { private: "must-not-leak" },
  };
  const store = new SqlJobStore({
    async query(sql, args) {
      seen.push({ sql, args });
      return { rows: args?.[0] === row.job_id ? [row] : [] };
    },
  });
  const liveService = new LiveService({
    store,
    live: {
      async run() {
        throw new Error("inference must not run");
      },
    },
  });
  const status = await liveService.status({ jobId: row.job_id });
  assert.deepEqual(status, {
    version: 2,
    jobId: row.job_id,
    inputHash: row.input_hash,
    requestHash: row.request_hash,
    state: "unknown",
    errorCode: "provider_unavailable",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:08.000Z",
  });
  assert.equal(JSON.stringify(status).includes("must-not-leak"), false);
  assert.match(
    seen[0].sql,
    /^SELECT job_id,input_hash,request_hash,state,error_code,created_at,updated_at/,
  );
  assert.doesNotMatch(seen[0].sql, /\bresult\b|\bINSERT\b|\bUPDATE\b/i);
  assert.deepEqual(seen[0].args, [row.job_id]);
  await assert.rejects(
    liveService.status({ jobId: "not-found" }),
    /job_not_found/,
  );
  for (const invalid of [
    {},
    { jobId: row.job_id, extra: true },
    { jobId: "x".repeat(201) },
    { jobId: "bad/id" },
  ])
    await assert.rejects(liveService.status(invalid), /invalid_request/);
});

test("HTTP status requires live bearer and excludes result content", async () => {
  let calls = 0;
  const service = {
    stopped: false,
    busy: false,
    async generate() {
      throw new Error("unused");
    },
    async maintenance() {
      throw new Error("unused");
    },
  };
  const liveService = new LiveService({
    store: {
      async inspect(jobId) {
        calls++;
        return {
          job_id: jobId,
          input_hash: "a".repeat(64),
          request_hash: "b".repeat(64),
          state: "unknown",
          error_code: "provider_unavailable",
          created_at: new Date("2026-10-20T00:00:00.000Z"),
          updated_at: new Date("2026-10-20T00:00:08.000Z"),
        };
      },
    },
    live: {
      async run() {
        throw new Error("unused");
      },
    },
  });
  const server = createHttpServer({
    service,
    secret: shadowSecret,
    liveService,
    liveSecret,
    log: () => {},
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/status`;
  const post = (secret, body) =>
    fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await post(shadowSecret, { jobId: "held" })).status, 401);
    const invalid = await post(liveSecret, { jobId: "held", result: true });
    assert.equal(invalid.status, 400);
    const response = await post(liveSecret, { jobId: "held" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      version: 2,
      jobId: "held",
      inputHash: "a".repeat(64),
      requestHash: "b".repeat(64),
      state: "unknown",
      errorCode: "provider_unavailable",
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:00:08.000Z",
    });
    assert.equal(calls, 1);
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, "close");
  }
});

test("HTTP classified rejection exposes only fixed code, provider status and known outcome", async () => {
  const privateText = "private reflected prompt and account secret";
  const logs = [];
  const provider = createLiveProvider({
    apiKey: "private-key",
    fetchImpl: async () =>
      Response.json(
        { error: { message: `No provider matches max_price; ${privateText}` } },
        { status: 400 },
      ),
  });
  const liveService = new LiveService({
    live: { run: provider },
    store: {
      async claim() {
        return { claimed: true };
      },
      async fail() {},
    },
  });
  const server = createHttpServer({
    service: { stopped: false, busy: false },
    secret: shadowSecret,
    liveService,
    liveSecret,
    log: (event) => logs.push(event),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${liveSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request()),
      },
    );
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.deepEqual(payload, {
      error: "provider_rejected_price",
      providerStatus: 400,
      outcomeUnknown: false,
    });
    assert.equal(
      JSON.stringify({ payload, logs }).includes(privateText),
      false,
    );
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, "close");
  }
});

test("allowlist covers exactly roster 30 plus Suki, Belle and Nyx", async () => {
  const roster = await readFile(
    new URL("../../../convex/forumAgentRoster.ts", import.meta.url),
    "utf8",
  );
  const slugs = [
    ...roster
      .slice(0, roster.indexOf('slug: "max-delaney"') + 40)
      .matchAll(/\bslug:\s*"([a-z-]+)"/g),
  ].map((match) => match[1]);
  assert.equal(slugs.length, 30);
  assert.deepEqual(
    new Set([...slugs, "suki", "belle", "nyx", "system"]),
    LIVE_AGENTS,
  );
});

test("live request preserves SDK body, bounds fields, and verifies canonical input hash", () => {
  assert.equal(validateLiveRequest(request()).body, body);
  const newsletterBody = { ...body, max_tokens: 24_000 };
  assert.equal(
    validateLiveRequest(
      request({
        body: newsletterBody,
        inputHash: liveInputHash(newsletterBody),
      }),
    ).body.max_tokens,
    24_000,
  );
  for (const stage of [
    "belle:daily-signal:draft",
    "belle:daily-signal:evidence-review",
    "belle:weekly-field-note:revision",
    "belle:weekly-field-note:evidence-review",
    "belle:hacker-news-digest",
    "belle:hacker-news-digest-revision",
    "belle:forum-evidence-review",
  ]) {
    assert.equal(
      validateLiveRequest(request({ agentSlug: "belle", stage })).stage,
      stage,
    );
  }
  const localSchemaBody = {
    ...body,
    response_format: {
      type: "json_schema",
      json_schema: {
        schema: {
          $defs: { entry: { type: "string" } },
          properties: { value: { $ref: "#/$defs/entry" } },
        },
      },
    },
  };
  assert.equal(
    validateLiveRequest(
      request({
        body: localSchemaBody,
        inputHash: liveInputHash(localSchemaBody),
      }),
    ).body,
    localSchemaBody,
  );
  assert.equal(
    liveInputHash({ b: [2, { z: 1, a: 0 }], a: 1 }),
    liveInputHash({ a: 1, b: [2, { a: 0, z: 1 }] }),
  );
  for (const invalid of [
    request({ agentSlug: "intruder" }),
    request({ agentSlug: "system" }),
    request({ agentSlug: "belle" }),
    request({ stage: "belle:forum-draft" }),
    request({ stage: "belle:daily-signal:evidence-review" }),
    request({
      agentSlug: "mara-venn",
      stage: "belle:weekly-field-note:evidence-review",
    }),
    request({
      agentSlug: "belle",
      stage: "belle:daily-signal:reply-evidence-review",
    }),
    request({
      agentSlug: "belle",
      stage: "belle:weekly-field-note:evidence-review-extra",
    }),
    request({
      agentSlug: "belle",
      stage: "belle:hacker-news-digest:evidence-review",
    }),
    request({ stage: "suki:arbitrary-signed-stage" }),
    request({ inputHash: "a".repeat(64) }),
    request({ body: { ...body, stream: true } }),
    request({ body: { ...body, model: "unapproved/model" } }),
    request({ body: { ...body, base_url: "https://attacker.invalid" } }),
    request({ body: { ...body, max_tokens: 40_001 } }),
    request({ body: { model: body.model, messages: body.messages } }),
    request({
      body: {
        ...body,
        messages: Array(65).fill({ role: "user", content: "x" }),
      },
    }),
    request({
      body: {
        ...body,
        response_format: {
          type: "json_schema",
          json_schema: { schema: { $ref: "https://attacker.invalid" } },
        },
      },
    }),
  ])
    assert.throws(() => validateLiveRequest(invalid));
  const healthBody = {
    model: "openrouter/free",
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 10,
  };
  assert.equal(
    validateLiveRequest(
      request({
        agentSlug: "system",
        stage: "health-canary",
        body: healthBody,
        inputHash: liveInputHash(healthBody),
      }),
    ).agentSlug,
    "system",
  );
});

test("Bounded newsletter live requests require a Belle or system stage and bounded provider prices", () => {
  const newsletterBody = {
    ...body,
    model: "qwen/qwen3.8-flash",
    provider: {
      allow_fallbacks: false,
      require_parameters: true,
      max_price: { prompt: "0.2", completion: "0.5" },
    },
  };
  newsletterBody.reasoning = { enabled: false };
  const newsletterRequest = (agentSlug, stage, nextBody = newsletterBody) =>
    request({
      agentSlug,
      stage,
      body: nextBody,
      inputHash: liveInputHash(nextBody),
    });
  for (const [agentSlug, stage] of [
    ["belle", "belle:daily-signal:draft"],
    ["system", "health-canary"],
  ]) {
    assert.equal(
      validateLiveRequest(newsletterRequest(agentSlug, stage)).body,
      newsletterBody,
    );
  }
  const cheaperBody = {
    ...newsletterBody,
    provider: {
      ...newsletterBody.provider,
      max_price: { prompt: "0.1", completion: "0.25" },
    },
  };
  assert.equal(
    validateLiveRequest(
      newsletterRequest("belle", "belle:daily-signal:draft", cheaperBody),
    ).body,
    cheaperBody,
  );
  const retiredBody = {
    ...newsletterBody,
    model: "qwen/qwen3-235b-a22b-2507",
  };
  assert.throws(
    () =>
      validateLiveRequest(
        newsletterRequest("belle", "belle:daily-signal:draft", retiredBody),
      ),
    /model_not_allowed/,
  );
  assert.throws(
    () =>
      validateLiveRequest(
        newsletterRequest("belle", "belle:daily-signal:draft", {
          ...newsletterBody,
          model: "qwen/qwen3.5-flash-02-23",
        }),
      ),
    /model_not_allowed/,
  );
  assert.throws(
    () =>
      validateLiveRequest(
        newsletterRequest("belle", "belle:daily-signal:draft", {
          ...newsletterBody,
          model: "mistralai/mistral-small-3.2-24b-instruct",
        }),
      ),
    /model_not_allowed/,
  );
  for (const max_price of [
    { prompt: 0.2, completion: "0.5" },
    { prompt: "0.2", completion: 0.5 },
    { prompt: "2e-1", completion: "0.5" },
    { prompt: "0.2", completion: "5e-1" },
    { prompt: " 0.2", completion: "0.5" },
    { prompt: "0.2", completion: "Infinity" },
    { prompt: "-0.1", completion: "0.5" },
    { prompt: "0.2", completion: "0" },
    { prompt: "0.2000000000000001", completion: "0.5" },
    { prompt: "0.2", completion: "0.5000000000000001" },
    { prompt: "0.20", completion: "0.5" },
    { prompt: "0.2", completion: "0.5", image: "0.1" },
  ]) {
    const invalidBody = {
      ...newsletterBody,
      provider: { ...newsletterBody.provider, max_price },
    };
    assert.throws(() =>
      validateLiveRequest(
        newsletterRequest("belle", "belle:daily-signal:draft", invalidBody),
      ),
    );
  }
  for (const invalid of [
    newsletterRequest("suki", "suki:forum-reply"),
    newsletterRequest("mara-venn", "mara-venn:forum-draft"),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      provider: { ...newsletterBody.provider, require_parameters: false },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      provider: { ...newsletterBody.provider, max_price: { prompt: "0.2" } },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      provider: {
        ...newsletterBody.provider,
        max_price: { prompt: "0.2", completion: "0" },
      },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      provider: {
        ...newsletterBody.provider,
        max_price: { prompt: "0.21", completion: "0.5" },
      },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      provider: {
        ...newsletterBody.provider,
        max_price: { prompt: "0.2", completion: "0.51" },
      },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      provider: {
        ...newsletterBody.provider,
        max_price: { prompt: "NaN", completion: "0.5" },
      },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      reasoning: { effort: "low" },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      reasoning: { enabled: true },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      reasoning: { enabled: false, exclude: true },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      reasoning: undefined,
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      reasoning_effort: "low",
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      models: ["openrouter/free"],
    }),
  ])
    assert.throws(() => validateLiveRequest(invalid));
});

test("provider performs one exact-body request and classifies known versus unknown failures safely", async () => {
  let calls = 0;
  const provider = createLiveProvider({
    apiKey: "private-key",
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      assert.deepEqual(JSON.parse(options.body), body);
      return Response.json(completion);
    },
  });
  assert.deepEqual(await provider(request()), completion);
  assert.equal(calls, 1);
  const rejected = createLiveProvider({
    apiKey: "private-key",
    fetchImpl: async () => new Response("private rejection", { status: 402 }),
  });
  await assert.rejects(
    rejected(request()),
    (error) =>
      error.code === "provider_rejected" &&
      error.status === 402 &&
      !error.message.includes("private"),
  );
  for (const status of [408, 409]) {
    let attempts = 0;
    const ambiguous = createLiveProvider({
      apiKey: "private-key",
      fetchImpl: async () => {
        attempts++;
        return new Response("private ambiguous response", { status });
      },
    });
    await assert.rejects(
      ambiguous(request()),
      (error) =>
        error.code === "provider_unavailable" &&
        error.outcomeUnknown &&
        error.status === 502 &&
        !error.message.includes("private"),
    );
    assert.equal(attempts, 1);
  }
  const embedded = createLiveProvider({
    apiKey: "private-key",
    fetchImpl: async () =>
      Response.json({
        ...completion,
        error: { code: 409, message: "private content" },
      }),
  });
  await assert.rejects(
    embedded(request()),
    (error) =>
      error.code === "provider_embedded_error" &&
      error.outcomeUnknown &&
      !error.message.includes("private"),
  );
  const unknown = createLiveProvider({
    apiKey: "private-key",
    fetchImpl: async () => {
      throw new Error("private provider details");
    },
  });
  await assert.rejects(
    unknown(request()),
    (error) =>
      error.code === "provider_network_error" &&
      error.outcomeUnknown &&
      !error.message.includes("private"),
  );
});

test("known provider rejections emit only bounded fixed diagnostics and remain failed", async () => {
  const privateText = "private prompt and bearer secret";
  for (const [message, code] of [
    ["Unsupported parameter: temperature", "provider_rejected_parameter"],
    [
      "Unsupported parameter: provider.max_price",
      "provider_rejected_parameter",
    ],
    [
      "JSON schema is not supported by this endpoint",
      "provider_rejected_schema",
    ],
    ["No endpoints found for this model", "provider_rejected_no_endpoints"],
    ["No provider matches max_price", "provider_rejected_price"],
    ["Insufficient credits for request", "provider_rejected_account"],
    ["Model not found", "provider_rejected_model"],
  ]) {
    const provider = createLiveProvider({
      apiKey: "private-key",
      fetchImpl: async () =>
        Response.json(
          { error: { message: `${message}; ${privateText}` } },
          { status: 400 },
        ),
    });
    await assert.rejects(
      provider(request()),
      (error) =>
        error.code === code &&
        error.status === 400 &&
        error.outcomeUnknown === false &&
        error.message === code &&
        !JSON.stringify(error).includes(privateText),
    );
  }
  const metadataProvider = createLiveProvider({
    apiKey: "private-key",
    fetchImpl: async () =>
      Response.json(
        {
          error: {
            message: "Bad request",
            metadata: { raw: "Unsupported parameter: temperature" },
          },
        },
        { status: 422 },
      ),
  });
  await assert.rejects(
    metadataProvider(request()),
    (error) =>
      error.code === "provider_rejected_parameter" && error.status === 422,
  );
  for (const response of [
    new Response("private non-JSON", { status: 400 }),
    new Response(JSON.stringify({ error: { message: privateText } }), {
      status: 400,
    }),
    new Response("private", {
      status: 400,
      headers: { "Content-Length": String(32 * 1024 + 1) },
    }),
    new Response("x".repeat(32 * 1024 + 1), { status: 400 }),
    new Response(
      new ReadableStream({
        pull() {
          throw new Error(privateText);
        },
      }),
      { status: 400 },
    ),
  ]) {
    const provider = createLiveProvider({
      apiKey: "private-key",
      fetchImpl: async () => response,
    });
    await assert.rejects(
      provider(request()),
      (error) =>
        error.code === "provider_rejected" &&
        error.status === 400 &&
        error.outcomeUnknown === false &&
        !error.message.includes("private"),
    );
  }
  const state = { failed: null };
  const provider = createLiveProvider({
    apiKey: "private-key",
    fetchImpl: async () =>
      Response.json(
        { error: { message: "No provider matches max_price" } },
        { status: 400 },
      ),
  });
  const store = {
    async claim() {
      return { claimed: true };
    },
    async fail(_jobId, code, unknown) {
      state.failed = { code, unknown };
    },
    async inspect(jobId) {
      return {
        job_id: jobId,
        input_hash: request().inputHash,
        request_hash: "b".repeat(64),
        state: state.failed?.unknown ? "unknown" : "failed",
        error_code: state.failed?.code ?? null,
        created_at: "2026-10-20T00:00:00.000Z",
        updated_at: "2026-10-20T00:00:01.000Z",
      };
    },
    async complete() {
      throw new Error("unexpected completion");
    },
  };
  const service = new LiveService({ live: { run: provider }, store });
  await assert.rejects(service.complete(request()), {
    code: "provider_rejected_price",
    status: 400,
    outcomeUnknown: false,
  });
  assert.deepEqual(state.failed, {
    code: "provider_rejected_price",
    unknown: false,
  });
  const status = await service.status({ jobId: request().jobId });
  assert.equal(status.state, "failed");
  assert.equal(status.errorCode, "provider_rejected_price");
  assert.equal(JSON.stringify(status).includes(privateText), false);
  let cancelCalled = false;
  const oversizedProvider = createLiveProvider({
    apiKey: "private-key",
    timeoutMs: 100,
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelCalled = true;
            return new Promise(() => {});
          },
        }),
        {
          status: 400,
          headers: { "Content-Length": String(32 * 1024 + 1) },
        },
      ),
  });
  state.failed = null;
  const oversizedService = new LiveService({
    live: { run: oversizedProvider },
    store,
  });
  let timeoutId;
  try {
    await assert.rejects(
      Promise.race([
        oversizedService.complete(request()),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("read stalled")), 500);
        }),
      ]),
      { code: "provider_rejected", status: 400, outcomeUnknown: false },
    );
  } finally {
    clearTimeout(timeoutId);
  }
  assert.equal(cancelCalled, true);
  assert.deepEqual(state.failed, { code: "provider_rejected", unknown: false });
  assert.equal(
    (await oversizedService.status({ jobId: request().jobId })).state,
    "failed",
  );
  let cancelled = false;
  const stalledProvider = createLiveProvider({
    apiKey: "private-key",
    timeoutMs: 20,
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 400 },
      ),
  });
  await assert.rejects(
    stalledProvider(request()),
    (error) =>
      error.code === "provider_rejected" &&
      error.status === 400 &&
      error.outcomeUnknown === false,
  );
  assert.equal(cancelled, true);
});

test("non-known status and unexpected stream do not wait for provider body cancellation", async () => {
  for (const [status, headers, code] of [
    [408, {}, "provider_unavailable"],
    [
      200,
      { "Content-Type": "text/event-stream" },
      "provider_unexpected_stream",
    ],
  ]) {
    let cancelCalled = false;
    const provider = createLiveProvider({
      apiKey: "private-key",
      timeoutMs: 100,
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelCalled = true;
              return new Promise(() => {});
            },
          }),
          { status, headers },
        ),
    });
    let timeoutId;
    try {
      await assert.rejects(
        Promise.race([
          provider(request()),
          new Promise((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error("cancel stalled")),
              500,
            );
          }),
        ]),
        (error) =>
          error.code === code &&
          error.outcomeUnknown === true &&
          error.status === 502,
      );
    } finally {
      clearTimeout(timeoutId);
    }
    assert.equal(cancelCalled, true);
  }
});

test("non-streaming provider failures have fixed diagnostics without leaking content", async () => {
  for (const [response, code] of [
    [
      new Response(": keepalive\n\ndata: private content\n\n", {
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      }),
      "provider_unexpected_stream",
    ],
    [new Response("private malformed JSON"), "provider_invalid_json"],
    [new Response(null), "provider_empty_response"],
    [
      new Response("private", {
        headers: { "Content-Length": String(240 * 1024 + 1) },
      }),
      "provider_response_too_large",
    ],
    [Response.json({ ...completion, usage: null }), "provider_invalid_usage"],
    [Response.json(null), "provider_invalid_envelope"],
    [Response.json({ ...completion, id: null }), "provider_invalid_id"],
    [Response.json({ ...completion, choices: [] }), "provider_invalid_choices"],
    [
      Response.json({ ...completion, choices: [{ message: null }] }),
      "provider_invalid_message",
    ],
    [Response.json({ ...completion, model: null }), "provider_invalid_model"],
  ]) {
    let calls = 0;
    const provider = createLiveProvider({
      apiKey: "private-key",
      fetchImpl: async () => {
        calls++;
        return response;
      },
    });
    await assert.rejects(
      provider(request()),
      (error) =>
        error.code === code &&
        error.outcomeUnknown === true &&
        !error.message.includes("private"),
    );
    assert.equal(calls, 1);
  }
});

test("timeout while reading a 200 body stays an unknown timeout", async () => {
  let calls = 0;
  const provider = createLiveProvider({
    apiKey: "private-key",
    timeoutMs: 20,
    fetchImpl: async (_url, { signal }) => {
      calls++;
      return new Response(
        new ReadableStream({
          start(controller) {
            signal.addEventListener(
              "abort",
              () => controller.error(new Error("private body read failure")),
              { once: true },
            );
          },
        }),
      );
    },
  });
  await assert.rejects(
    provider(request()),
    (error) =>
      error.code === "provider_timeout" &&
      error.status === 504 &&
      error.outcomeUnknown === true &&
      !error.message.includes("private"),
  );
  assert.equal(calls, 1);
});

test("service shutdown distinguishes provider abort from deadline and tombstones once", async () => {
  let calls = 0;
  let started;
  const providerStarted = new Promise((resolve) => {
    started = resolve;
  });
  const provider = createLiveProvider({
    apiKey: "private-key",
    timeoutMs: 120_000,
    fetchImpl: async (_url, { signal }) => {
      calls++;
      started();
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new Error("private provider abort detail")),
          { once: true },
        );
      });
    },
  });
  let state;
  const store = {
    async claim(input, hash) {
      if (state) return { claimed: false, ...state };
      state = {
        input_hash: input.inputHash,
        request_hash: hash,
        state: "running",
      };
      return { claimed: true };
    },
    async complete() {
      throw new Error("unexpected completion");
    },
    async fail(_id, code, unknown) {
      state.state = unknown ? "unknown" : "failed";
      state.error_code = code;
    },
  };
  const service = new LiveService({ live: { run: provider }, store });
  const pending = service.complete(request());
  await providerStarted;
  const closing = service.close();
  await assert.rejects(
    pending,
    (error) =>
      error.code === "provider_shutdown" &&
      error.status === 503 &&
      error.outcomeUnknown === true &&
      !error.message.includes("private"),
  );
  await closing;
  const restarted = new LiveService({ live: { run: provider }, store });
  await assert.rejects(restarted.complete(request()), /job_outcome_unknown/);
  assert.deepEqual(
    [state.state, state.error_code, calls],
    ["unknown", "provider_shutdown", 1],
  );
});

test("graceful live drain finishes active work and blocks new admission", async () => {
  let release;
  let started;
  let calls = 0;
  const providerStarted = new Promise((resolve) => {
    started = resolve;
  });
  const provider = createLiveProvider({
    apiKey: "private-key",
    fetchImpl: async () => {
      calls++;
      started();
      return new Promise((resolve) => {
        release = () => resolve(Response.json(completion));
      });
    },
  });
  let state;
  const service = new LiveService({
    live: { run: provider },
    store: {
      async claim(input, hash) {
        if (state) return { claimed: false, ...state };
        state = {
          input_hash: input.inputHash,
          request_hash: hash,
          state: "running",
        };
        return { claimed: true };
      },
      async complete(_id, result) {
        state.state = "succeeded";
        state.result = result;
      },
      async fail() {
        throw new Error("unexpected failure");
      },
    },
  });
  const pending = service.complete(request());
  await providerStarted;
  service.stopAccepting();
  const draining = service.drain();
  await assert.rejects(
    service.complete(request({ jobId: "new-during-drain" })),
    /worker_stopping/,
  );
  release();
  assert.deepEqual((await pending).completion, completion);
  await draining;
  assert.deepEqual([state.state, calls], ["succeeded", 1]);
});

test("graceful live drain preserves the provider deadline and unknown tombstone", async () => {
  let started;
  let calls = 0;
  const providerStarted = new Promise((resolve) => {
    started = resolve;
  });
  const provider = createLiveProvider({
    apiKey: "private-key",
    timeoutMs: 20,
    fetchImpl: async (_url, { signal }) => {
      calls++;
      started();
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("private")), {
          once: true,
        });
      });
    },
  });
  let state;
  const store = {
    async claim(input, hash) {
      if (state) return { claimed: false, ...state };
      state = {
        input_hash: input.inputHash,
        request_hash: hash,
        state: "running",
      };
      return { claimed: true };
    },
    async complete() {
      throw new Error("unexpected completion");
    },
    async fail(_id, code, unknown) {
      state.state = unknown ? "unknown" : "failed";
      state.error_code = code;
    },
  };
  const service = new LiveService({ live: { run: provider }, store });
  const pending = service.complete(request());
  await providerStarted;
  service.stopAccepting();
  const draining = service.drain();
  await assert.rejects(
    pending,
    (error) => error.code === "provider_timeout" && error.outcomeUnknown,
  );
  await draining;
  const restarted = new LiveService({ live: { run: provider }, store });
  await assert.rejects(restarted.complete(request()), /job_outcome_unknown/);
  assert.deepEqual(
    [state.state, state.error_code, calls],
    ["unknown", "provider_timeout", 1],
  );
});

test("ambiguous HTTP 408/409 tombstones the job and cannot issue another provider call", async () => {
  for (const status of [408, 409]) {
    let calls = 0;
    let state;
    const provider = createLiveProvider({
      apiKey: "private-key",
      fetchImpl: async () => {
        calls++;
        return new Response("private", { status });
      },
    });
    const service = new LiveService({
      live: { run: provider },
      store: {
        async claim(input, hash) {
          if (state) return { claimed: false, ...state };
          state = {
            input_hash: input.inputHash,
            request_hash: hash,
            state: "running",
          };
          return { claimed: true };
        },
        async complete() {
          throw new Error("unexpected completion");
        },
        async fail(_id, _code, unknown) {
          state.state = unknown ? "unknown" : "failed";
        },
      },
    });
    await assert.rejects(
      service.complete(request()),
      (error) => error.outcomeUnknown === true,
    );
    await assert.rejects(
      service.complete(request()),
      (error) =>
        error.code === "job_outcome_unknown" && error.outcomeUnknown === true,
    );
    assert.equal(state.state, "unknown");
    assert.equal(calls, 1);
  }
});

test("malformed HTTP 200 tombstones the job without replaying inference", async () => {
  for (const [response, code] of [
    [new Response("private malformed JSON"), "provider_invalid_json"],
    [
      Response.json({ ...completion, usage: undefined }),
      "provider_invalid_usage",
    ],
    [Response.json({ ...completion, choices: [] }), "provider_invalid_choices"],
  ]) {
    let calls = 0;
    let state;
    const provider = createLiveProvider({
      apiKey: "private-key",
      fetchImpl: async () => {
        calls++;
        return response;
      },
    });
    const service = new LiveService({
      live: { run: provider },
      store: {
        async claim(input, hash) {
          if (state) return { claimed: false, ...state };
          state = {
            input_hash: input.inputHash,
            request_hash: hash,
            state: "running",
          };
          return { claimed: true };
        },
        async complete() {
          throw new Error("unexpected completion");
        },
        async fail(_id, errorCode, unknown) {
          state.state = unknown ? "unknown" : "failed";
          state.error_code = errorCode;
        },
      },
    });
    await assert.rejects(
      service.complete(request()),
      (error) => error.code === code && error.outcomeUnknown,
    );
    await assert.rejects(service.complete(request()), /job_outcome_unknown/);
    assert.deepEqual(
      [state.state, state.error_code, calls],
      ["unknown", code, 1],
    );
  }
});

test("live service bounds two different personas, replays without re-inference, and tombstones unknown", async () => {
  const jobs = new Map();
  let calls = 0;
  const waits = [];
  const backend = {
    store: {
      async claim(input, hash) {
        if (jobs.has(input.jobId))
          return { claimed: false, ...jobs.get(input.jobId) };
        jobs.set(input.jobId, {
          input_hash: input.inputHash,
          request_hash: hash,
          state: "running",
        });
        return { claimed: true };
      },
      async complete(id, result) {
        Object.assign(jobs.get(id), { state: "succeeded", result });
      },
      async fail(id, code, unknown) {
        Object.assign(jobs.get(id), {
          state: unknown ? "unknown" : "failed",
          error_code: code,
        });
      },
    },
    live: {
      async run() {
        calls++;
        return await new Promise((resolve) => waits.push(resolve));
      },
    },
  };
  const service = new LiveService(backend);
  const first = service.complete(request());
  const belle = service.complete(
    request({
      jobId: "belle-job",
      agentSlug: "belle",
      stage: "belle:daily-signal:draft",
    }),
  );
  await assert.rejects(
    service.complete(request({ jobId: "same-persona" })),
    /worker_busy/,
  );
  await assert.rejects(
    service.complete(
      request({ jobId: "third", agentSlug: "nyx", stage: "nyx:forum-draft" }),
    ),
    /worker_busy/,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  waits.splice(0).forEach((resolve) => resolve(completion));
  const result = await first;
  await belle;
  assert.deepEqual(await service.complete(request()), result);
  assert.equal(calls, 2);
  await assert.rejects(
    service.complete(
      request({
        body: { ...body, temperature: 0.5 },
        inputHash: liveInputHash({ ...body, temperature: 0.5 }),
      }),
    ),
    /job_input_conflict/,
  );
  const failed = new LiveService({
    store: backend.store,
    live: {
      async run() {
        throw new Error("private");
      },
    },
  });
  const failing = request({ jobId: "unknown-job" });
  await assert.rejects(
    failed.complete(failing),
    (error) => error.code === "worker_internal_error" && error.outcomeUnknown,
  );
  assert.equal(jobs.get("unknown-job").state, "unknown");
  await assert.rejects(failed.complete(failing), /job_outcome_unknown/);
});

test("real Eliza TEXT_LARGE runtime uses provider mock, SQL replay, and redacted logs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "symbaiex-eliza-live-test-"));
  let backend;
  let calls = 0;
  try {
    backend = await createRuntimeBackend({
      pgliteDir: dir,
      generate: async () => ({ output: {} }),
      generateLive: createLiveProvider({
        apiKey: "secret-key",
        fetchImpl: async () => {
          calls++;
          return Response.json(completion);
        },
      }),
    });
    const service = new LiveService(backend);
    const first = await service.complete(request());
    assert.deepEqual(first.completion, completion);
    assert.deepEqual(await service.complete(request()), first);
    assert.equal(calls, 1);
    assert.equal(backend.live.capabilities().initialized, 1);
    const { rows } = await backend.store.connection.query(
      "SELECT body FROM logs",
    );
    assert.equal(JSON.stringify(rows).includes("private prompt"), false);
    assert.ok(rows.every((row) => row.body.contentRedacted));
    await service.close();
  } finally {
    await backend?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HTTP auth scopes are isolated; unconfigured live does not break shadow", async () => {
  let calls = 0;
  const service = {
    stopped: false,
    busy: false,
    async generate() {
      return { version: 1 };
    },
    async maintenance() {
      return { ok: true };
    },
  };
  const liveService = {
    active: new Map(),
    async complete() {
      calls++;
      return { version: 2 };
    },
  };
  const server = createHttpServer({
    service,
    secret: shadowSecret,
    liveService,
    liveSecret,
    log: () => {},
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (path, secret) =>
    fetch(url + path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
  try {
    assert.equal((await post("/complete", shadowSecret)).status, 401);
    assert.equal((await post("/generate", liveSecret)).status, 401);
    assert.equal((await post("/complete", liveSecret)).status, 200);
    assert.equal((await post("/generate", shadowSecret)).status, 200);
    assert.equal(calls, 1);
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, "close");
  }
  const noLive = createHttpServer({
    service,
    secret: shadowSecret,
    log: () => {},
  });
  noLive.listen(0, "127.0.0.1");
  await once(noLive, "listening");
  const noLiveUrl = `http://127.0.0.1:${noLive.address().port}`;
  try {
    assert.equal(
      (await fetch(noLiveUrl + "/complete", { method: "POST" })).status,
      503,
    );
    assert.equal((await fetch(noLiveUrl + "/healthz")).status, 200);
  } finally {
    noLive.close();
    noLive.closeAllConnections();
    await once(noLive, "close");
  }
});
