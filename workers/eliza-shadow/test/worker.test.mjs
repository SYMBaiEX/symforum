import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  MODEL,
  MAX_PROVIDER_BYTES,
  WorkerError,
  compileOutputSchema,
  validateRequest,
} from "../src/contract.mjs";
import { createProvider, OPENROUTER_URL } from "../src/provider.mjs";
import { createRuntimeBackend, ShadowService } from "../src/runtime.mjs";
import { createHttpServer } from "../src/server.mjs";

const secret = "worker-test-secret-with-at-least-32-characters";
const schema = {
  type: "object",
  properties: { text: { type: "string", minLength: 1 } },
  required: ["text"],
  additionalProperties: false,
};
const request = (extra = {}) => ({
  version: 1,
  jobId: "test-job",
  inputHash: "hash-1",
  kind: "suki-reply",
  system: "You are Suki.",
  prompt: "Draft a helpful reply.",
  schema,
  model: MODEL,
  maxOutputTokens: 100,
  ...extra,
});
const generated = (output = { text: "A harmless draft." }) => ({
  output,
  servedModel: MODEL,
  inputTokens: 40,
  outputTokens: 10,
});
const providerResponse = (extra = {}) =>
  new Response(
    JSON.stringify({
      model: MODEL,
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: JSON.stringify({ output: { text: "A harmless draft." } }),
          },
        },
      ],
      usage: { prompt_tokens: 40, completion_tokens: 10, cost: 0.000032 },
      ...extra,
    }),
    { headers: { "Content-Type": "application/json" } },
  );

function memoryBackend(run = async () => generated()) {
  const jobs = new Map();
  return {
    jobs,
    run,
    close: async () => {},
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
      async complete(jobId, result) {
        Object.assign(jobs.get(jobId), { state: "succeeded", result });
      },
      async fail(jobId, code, unknown) {
        Object.assign(jobs.get(jobId), {
          state: unknown ? "unknown" : "failed",
          error_code: code,
        });
      },
    },
  };
}

test("contract bounds, no baselines and server-selected model", () => {
  assert.ok(validateRequest(request()).validateOutput({ text: "ok" }));
  assert.throws(
    () => validateRequest(request({ model: "openai/gpt-5" })),
    /model_not_allowed/,
  );
  assert.throws(
    () => validateRequest(request({ maxOutputTokens: 10_001 })),
    /invalid_output_limit/,
  );
  assert.throws(
    () => validateRequest(request({ maxOutputTokens: 0 })),
    /invalid_output_limit/,
  );
  assert.throws(
    () => validateRequest(request({ prompt: "x".repeat(100 * 1024) })),
    /prompt_too_large/,
  );
  assert.throws(
    () =>
      validateRequest(
        request({ baseline: { secret: "must-not-cross-boundary" } }),
      ),
    /invalid_request/,
  );
  assert.throws(
    () =>
      validateRequest(
        request({ schema: { $ref: "https://example.com/schema" } }),
      ),
    /unsupported_schema_keyword/,
  );
  assert.throws(
    () => compileOutputSchema({ type: "string", pattern: "(a+)+$" }),
    /unsupported_schema_keyword/,
  );
});

test("local validation supports discriminated unions, uri, safeint and Zod schema annotations", () => {
  const validate = compileOutputSchema({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    oneOf: [
      {
        type: "object",
        properties: {
          decision: { const: "ignore" },
          reason: { type: "string" },
        },
        required: ["decision", "reason"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          decision: { const: "reply" },
          url: { type: "string", format: "uri" },
          id: { type: "integer", format: "safeint" },
        },
        required: ["decision", "url", "id"],
        additionalProperties: false,
      },
    ],
  });
  assert.equal(
    validate({ decision: "reply", url: "https://example.com/evidence", id: 1 }),
    true,
  );
  assert.equal(validate({ decision: "reply", url: "not a url", id: 1 }), false);
  assert.equal(
    validate({ decision: "reply", url: "https://example.com", id: 2 ** 54 }),
    false,
  );
  assert.equal(
    validate({ decision: "ignore", reason: "No useful contribution." }),
    true,
  );
});

test("HTTP authentication precedes generation, health is safe, and request bytes are bounded", async () => {
  const logs = [];
  let calls = 0;
  const service = {
    busy: false,
    stopped: false,
    async generate(input) {
      calls++;
      return { ok: true, jobId: input.jobId };
    },
    async maintenance() {
      return { ok: true, purgedResults: 0 };
    },
  };
  assert.throws(
    () => createHttpServer({ service, secret: "short" }),
    /invalid_worker_secret/,
  );
  const server = createHttpServer({
    service,
    secret,
    log: (event) => logs.push(event),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${url}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true,
      shadowOnly: true,
      runtimeVersion: "1.7.2",
      busy: false,
    });
    assert.equal(
      (await fetch(`${url}/generate`, { method: "POST", body: "{}" })).status,
      401,
    );
    assert.equal(
      (await fetch(`${url}/maintenance`, { method: "POST", body: "{}" }))
        .status,
      401,
    );
    assert.equal(
      (await fetch(`${url}/publish`, { method: "POST" })).status,
      404,
    );
    assert.equal(calls, 0);
    const valid = await fetch(`${url}/generate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request()),
    });
    assert.equal(valid.status, 200);
    assert.equal(calls, 1);
    const maintenance = await fetch(`${url}/maintenance`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(maintenance.status, 200);
    assert.equal(calls, 1);
    const large = await fetch(`${url}/generate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: "x".repeat(129 * 1024),
    });
    assert.equal(large.status, 413);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(logs).includes(secret), false);
    assert.equal(JSON.stringify(logs).includes("Draft a helpful reply"), false);
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, "close");
  }
});

test("provider is one bounded HTTP call with persona, exact model, wrapper schema and token budget", async () => {
  const calls = [];
  const generate = createProvider({
    apiKey: "not-a-real-key",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return providerResponse();
    },
  });
  const result = await generate(request());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OPENROUTER_URL);
  const sent = JSON.parse(calls[0].options.body);
  assert.equal(sent.model, MODEL);
  assert.equal(sent.max_tokens, 100);
  assert.equal(sent.provider.allow_fallbacks, false);
  assert.equal(sent.messages[0].role, "system");
  assert.ok(sent.messages[0].content.includes("You are Suki."));
  assert.deepEqual(
    sent.response_format.json_schema.schema.properties.output,
    schema,
  );
  assert.equal(sent.tools, undefined);
  assert.equal(result.providerCostMicroUsd, 32);
  assert.deepEqual(result.output, { text: "A harmless draft." });
});

test("provider fails once without exposing error bodies and enforces response/model/output limits", async () => {
  let calls = 0;
  const rejected = createProvider({
    apiKey: "not-a-real-key",
    fetchImpl: async () => {
      calls++;
      return new Response("secret-provider-body", { status: 503 });
    },
  });
  await assert.rejects(
    rejected(request()),
    (error) =>
      error.code === "provider_rejected_request" &&
      !error.message.includes("secret-provider-body"),
  );
  assert.equal(calls, 1);
  const oversized = createProvider({
    apiKey: "key",
    fetchImpl: async () => new Response("x".repeat(MAX_PROVIDER_BYTES + 1)),
  });
  await assert.rejects(oversized(request()), /provider_response_too_large/);
  const wrongModel = createProvider({
    apiKey: "key",
    fetchImpl: async () => providerResponse({ model: "another/provider" }),
  });
  await assert.rejects(wrongModel(request()), /provider_model_mismatch/);
  const truncated = createProvider({
    apiKey: "key",
    fetchImpl: async () =>
      providerResponse({
        choices: [{ finish_reason: "length", message: { content: "{}" } }],
      }),
  });
  await assert.rejects(truncated(request()), /provider_incomplete_output/);
});

test("timeout is unknown, one request only, and idempotent redelivery cannot spend again", async () => {
  let calls = 0;
  const generate = createProvider({
    apiKey: "key",
    timeoutMs: 20,
    fetchImpl: async (_url, { signal }) => {
      calls++;
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new Error("secret-error-text")),
          { once: true },
        ),
      );
    },
  });
  const backend = memoryBackend((input, signal) => generate(input, signal));
  const service = new ShadowService(backend);
  await assert.rejects(service.generate(request()), /provider_timeout/);
  assert.equal(backend.jobs.get("test-job").state, "unknown");
  await assert.rejects(service.generate(request()), /job_outcome_unknown/);
  assert.equal(calls, 1);
  await service.close();
});

test("single-flight busy, successful replay, changed-input conflict, and output-schema rejection", async () => {
  let release;
  let calls = 0;
  const backend = memoryBackend(async () => {
    calls++;
    await new Promise((resolve) => {
      release = resolve;
    });
    return generated();
  });
  const service = new ShadowService(backend);
  const first = service.generate(request());
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    service.generate(request({ jobId: "other-job" })),
    /worker_busy/,
  );
  release();
  const result = await first;
  assert.deepEqual(await service.generate(request()), result);
  await assert.rejects(
    service.generate(request({ prompt: "Changed prompt" })),
    /job_input_conflict/,
  );
  assert.equal(calls, 1);
  const bad = new ShadowService(
    memoryBackend(async () => generated({ unexpected: true })),
  );
  await assert.rejects(bad.generate(request()), /output_schema_invalid/);
  await assert.rejects(bad.generate(request()), /job_failed_no_retry/);
  await service.close();
  await bad.close();
});

test("real pinned runtime lifecycle, SQL migrations, durable replay and redacted model logs via PGlite", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "symbaiex-eliza-shadow-test-"),
  );
  let backend;
  let service;
  let calls = 0;
  try {
    const generate = createProvider({
      apiKey: "fake-secret-never-logged",
      fetchImpl: async () => {
        calls++;
        return providerResponse();
      },
    });
    backend = await createRuntimeBackend({ pgliteDir: directory, generate });
    assert.deepEqual(
      backend.capabilities().map(({ services, actions, models }) => ({
        services,
        actions,
        models,
      })),
      [
        { services: 0, actions: 0, models: ["OBJECT_SMALL"] },
        { services: 0, actions: 0, models: ["OBJECT_SMALL"] },
      ],
    );
    service = new ShadowService(backend);
    const first = await service.generate(
      request({
        system: "private-persona-do-not-log",
        prompt: "private-prompt-do-not-log",
      }),
    );
    assert.equal(first.runtimeVersion, "1.7.2");
    assert.equal(first.model, MODEL);
    assert.deepEqual(
      await service.generate(
        request({
          system: "private-persona-do-not-log",
          prompt: "private-prompt-do-not-log",
        }),
      ),
      first,
    );
    const second = await service.generate(
      request({ jobId: "newsletter-job", kind: "belle-newsletter" }),
    );
    assert.equal(second.jobId, "newsletter-job");
    assert.equal(calls, 2);
    const { rows } = await backend.store.connection.query(
      "SELECT body FROM logs",
    );
    assert.equal(rows.length, 2);
    assert.equal(JSON.stringify(rows).includes("private-persona"), false);
    assert.equal(JSON.stringify(rows).includes("private-prompt"), false);
    assert.equal(JSON.stringify(rows).includes("fake-secret"), false);
    assert.ok(rows.every((row) => row.body.contentRedacted));
    const jobs = await backend.store.connection.query(
      "SELECT state FROM eliza_shadow_jobs",
    );
    assert.ok(jobs.rows.every((row) => row.state === "succeeded"));
    await backend.store.connection.query(
      "UPDATE eliza_shadow_jobs SET result_expires_at=now()-interval '1 day'",
    );
    const maintenance = await service.maintenance();
    assert.equal(maintenance.purgedResults, 2);
    assert.equal(calls, 2);
    const tombstones = await backend.store.connection.query(
      "SELECT result,state FROM eliza_shadow_jobs",
    );
    assert.ok(
      tombstones.rows.every(
        (row) => row.result === null && row.state === "succeeded",
      ),
    );
    await assert.rejects(
      service.generate(
        request({
          system: "private-persona-do-not-log",
          prompt: "private-prompt-do-not-log",
        }),
      ),
      /job_result_expired/,
    );
    assert.equal(calls, 2);
  } finally {
    if (service) await service.close();
    else if (backend) await backend.close();
    await rm(directory, { recursive: true, force: true });
  }
});
