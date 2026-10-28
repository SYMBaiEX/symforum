import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PREINFERENCE_REJECTION_CODES } from "../src/contract.mjs";
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

test("X stages draft and review only for the existing editorial persona", () => {
  for (const slug of ["nyx", "belle", "suki", "damon-pike"]) {
    for (const suffix of ["draft", "evidence-review"]) assert.equal(validateLiveRequest(request({ agentSlug: slug, stage: `${slug}:x-${suffix}` })).agentSlug, slug);
    assert.throws(() => validateLiveRequest(request({ agentSlug: slug, stage: `${slug}:x-publish` })), /invalid_request/);
  }
  for (const slug of ["system", "pumpfun-scout", "bags-scout"]) assert.throws(() => validateLiveRequest(request({ agentSlug: slug, stage: `${slug}:x-draft` })), /invalid_request/);
  assert.throws(() => validateLiveRequest(request({ agentSlug: "nyx", stage: "belle:x-draft" })), /invalid_request/);
});

test("Telegram stages are restricted to the existing persona and cannot publish or cross identities", () => {
  for (const agentSlug of LIVE_AGENTS) {
    if (agentSlug === "system") continue;
    for (const suffix of ["reply", "evidence-review"])
      assert.equal(validateLiveRequest(request({ agentSlug, stage: `${agentSlug}:telegram-${suffix}` })).agentSlug, agentSlug);
    assert.throws(() => validateLiveRequest(request({ agentSlug, stage: `${agentSlug}:telegram-publish` })), /invalid_request/);
  }
  assert.throws(() => validateLiveRequest(request({ agentSlug: "system", stage: "system:telegram-reply" })), /invalid_request/);
  assert.throws(() => validateLiveRequest(request({ agentSlug: "suki", stage: "belle:telegram-reply" })), /invalid_request/);
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
  assert.doesNotMatch(seen[0].sql, /(?:SELECT|,)\s*result\s*(?:,|FROM)|\bINSERT\b|\bUPDATE\b/i);
  assert.doesNotMatch(seen[0].sql, /#>>\s*'\{completion,choices,0,message,content\}'/);
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

test("allowlist covers exactly roster 30 plus Suki, Belle, Nyx and the two token scouts", async () => {
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
    new Set([
      ...slugs,
      "suki",
      "belle",
      "nyx",
      "bags-scout",
      "pumpfun-scout",
      "system",
    ]),
    LIVE_AGENTS,
  );
});

for (const agentSlug of ["bags-scout", "pumpfun-scout"]) {
  test(`${agentSlug} uses existing forum draft and review stages without accepting foreign or unknown stages`, () => {
    for (const suffix of ["draft", "evidence-review"]) {
      const stage = `${agentSlug}:forum-${suffix}`;
      const validated = validateLiveRequest(request({ agentSlug, stage }));
      assert.equal(validated.agentSlug, agentSlug);
      assert.equal(validated.stage, stage);
      assert.equal(validated.body, body);
    }
    for (const stage of [
      `${agentSlug}:forum-publish`,
      `${agentSlug}:forum-evidence-review-extra`,
      `${agentSlug === "bags-scout" ? "pumpfun-scout" : "bags-scout"}:forum-draft`,
      "belle:daily-signal:draft",
      "health-canary",
    ])
      assert.throws(
        () => validateLiveRequest(request({ agentSlug, stage })),
        /invalid_request/,
      );
    const unknownSlug = `${agentSlug}-extra`;
    assert.throws(
      () =>
        validateLiveRequest(
          request({ agentSlug: unknownSlug, stage: `${unknownSlug}:forum-draft` }),
        ),
      /invalid_request/,
    );
  });

  test(`${agentSlug} admits Luna only for bounded draft and evidence review`, () => {
    const lunaBody = {
      ...body,
      model: "openai/gpt-6-luna",
      reasoning: { effort: "low", exclude: true },
      provider: {
        allow_fallbacks: false,
        require_parameters: true,
        only: ["openai"],
        ignore: ["openai/fast", "openai/flex"],
        max_price: { prompt: "0.2", completion: "0.5" },
      },
    };
    const lunaRequest = (stage, nextBody = lunaBody, nextAgent = agentSlug) =>
      request({
        agentSlug: nextAgent,
        stage,
        body: nextBody,
        inputHash: liveInputHash(nextBody),
      });
    for (const suffix of ["draft", "evidence-review"]) {
      const stage = `${agentSlug}:forum-${suffix}`;
      assert.equal(validateLiveRequest(lunaRequest(stage)).body, lunaBody);
      for (const invalidBody of [
        { ...lunaBody, reasoning: { effort: "medium", exclude: true } },
        { ...lunaBody, reasoning: { effort: "low", exclude: false } },
        {
          ...lunaBody,
          provider: { ...lunaBody.provider, allow_fallbacks: true },
        },
        {
          ...lunaBody,
          provider: { ...lunaBody.provider, require_parameters: false },
        },
        { ...lunaBody, provider: { ...lunaBody.provider, only: ["other"] } },
        {
          ...lunaBody,
          provider: { ...lunaBody.provider, ignore: ["openai/flex"] },
        },
        {
          ...lunaBody,
          provider: {
            ...lunaBody.provider,
            max_price: { prompt: "0.2000000000000001", completion: "0.5" },
          },
        },
        {
          ...lunaBody,
          provider: {
            ...lunaBody.provider,
            max_price: { prompt: "0.2", completion: "0.5000000000000001" },
          },
        },
        {
          ...lunaBody,
          provider: {
            ...lunaBody.provider,
            max_price: { prompt: 0.2, completion: 0.5 },
          },
        },
        { ...lunaBody, temperature: 0.1 },
        { ...lunaBody, top_p: 0.9 },
        { ...lunaBody, top_k: 10 },
        {
          ...lunaBody,
          tools: [{ type: "function", function: { name: "lookup" } }],
        },
        { ...lunaBody, tool_choice: "none" },
        {
          ...lunaBody,
          messages: [{ role: "tool", tool_call_id: "call-1", content: "result" }],
        },
        {
          ...lunaBody,
          messages: [
            {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "call-1", type: "function" }],
            },
          ],
        },
      ])
        assert.throws(() => validateLiveRequest(lunaRequest(stage, invalidBody)));
    }
    const otherScout = agentSlug === "bags-scout" ? "pumpfun-scout" : "bags-scout";
    for (const stage of [
      `${agentSlug}:forum-topic`,
      `${agentSlug}:forum-revision`,
      `${agentSlug}:forum-reply`,
      `${agentSlug}:forum-evidence-review-extra`,
      `${otherScout}:forum-draft`,
      `${otherScout}:forum-evidence-review`,
      "belle:daily-signal:draft",
      "health-canary",
    ])
      assert.throws(() => validateLiveRequest(lunaRequest(stage)), /invalid_request/);
    for (const wrongAgent of [`${agentSlug}-extra`])
      assert.throws(
        () =>
          validateLiveRequest(
            lunaRequest(`${wrongAgent}:forum-draft`, lunaBody, wrongAgent),
          ),
        /invalid_request/,
      );
  });
}

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
  const nonNewsletterPinnedProvider = {
    ...body,
    provider: { ...body.provider, only: ["deepinfra"] },
  };
  assert.throws(() =>
    validateLiveRequest(
      request({
        body: nonNewsletterPinnedProvider,
        inputHash: liveInputHash(nonNewsletterPinnedProvider),
      }),
    ),
  );
});

test("Bounded Luna requests require an enrolled persona stage and bounded provider prices", () => {
  const newsletterBody = {
    ...body,
    model: "openai/gpt-6-luna",
    provider: {
      allow_fallbacks: false,
      require_parameters: true,
      only: ["openai"],
      ignore: ["openai/fast", "openai/flex"],
      max_price: { prompt: "0.2", completion: "0.5" },
    },
  };
  newsletterBody.reasoning = { effort: "low", exclude: true };
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
    ["suki", "suki:forum-reply"],
    ["mara-venn", "mara-venn:forum-draft"],
  ]) {
    assert.equal(
      validateLiveRequest(newsletterRequest(agentSlug, stage)).body,
      newsletterBody,
    );
  }
  const emptyToolsBody = { ...newsletterBody, tools: [] };
  assert.equal(
    validateLiveRequest(
      newsletterRequest("belle", "belle:daily-signal:draft", emptyToolsBody),
    ).body,
    emptyToolsBody,
  );
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
          model: "qwen/qwen3.8-flash",
        }),
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
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      model: "deepseek/deepseek-v4-flash-0731",
    }),
    newsletterRequest("suki", "belle:forum-reply"),
    newsletterRequest("mara-venn", "mara-venn:arbitrary-stage"),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      provider: { ...newsletterBody.provider, require_parameters: false },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      provider: { ...newsletterBody.provider, allow_fallbacks: true },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      provider: {
        allow_fallbacks: false,
        require_parameters: true,
        max_price: newsletterBody.provider.max_price,
      },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      provider: { ...newsletterBody.provider, only: ["other"] },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      provider: { ...newsletterBody.provider, only: ["openai/fast"] },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      provider: { ...newsletterBody.provider, only: ["openai", "other"] },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      provider: { ...newsletterBody.provider, only: "openai" },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      provider: {
        require_parameters: true,
        only: ["openai"],
        ignore: newsletterBody.provider.ignore,
        max_price: newsletterBody.provider.max_price,
      },
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
      reasoning: { effort: "none", exclude: true },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      reasoning: { effort: "medium", exclude: true },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      reasoning: { effort: "high", exclude: true },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      reasoning: { effort: "low", exclude: false },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      reasoning: { effort: "low", exclude: true, max_tokens: 100 },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      reasoning: { effort: "low", exclude: true, enabled: false },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      tools: [{ type: "function", function: { name: "lookup" } }],
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      tools: "lookup",
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      tool_choice: "none",
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      messages: [
        ...newsletterBody.messages,
        { role: "tool", tool_call_id: "call-1", content: "result" },
      ],
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      messages: [
        ...newsletterBody.messages,
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call-1", type: "function" }],
        },
      ],
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
      model: "deepseek/deepseek-v4.1-flash-1017",
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      provider: { ...newsletterBody.provider, ignore: ["openai/flex"] },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      provider: {
        ...newsletterBody.provider,
        ignore: ["openai/flex", "openai/fast", "openai/fast"],
      },
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      temperature: 0,
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      top_p: 0.8,
    }),
    newsletterRequest("belle", "belle:daily-signal:draft", {
      ...newsletterBody,
      top_k: 10,
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

test("fixed Luna strips raw reasoning before returning or caching while preserving usage", async () => {
  const reasoningSecret = "private-reasoning-sentinel";
  const lunaBody = {
    model: "openai/gpt-6-luna",
    messages: [
      { role: "system", content: "draft safely" },
      { role: "user", content: "write a short note" },
    ],
    max_tokens: 4_000,
    response_format: { type: "json_schema", json_schema: { name: "note" } },
    provider: {
      allow_fallbacks: false,
      require_parameters: true,
      only: ["openai"],
      ignore: ["openai/fast", "openai/flex"],
      max_price: { prompt: "0.2", completion: "0.5" },
    },
    reasoning: { effort: "low", exclude: true },
  };
  const lunaRequest = {
    ...request(),
    jobId: "luna-reasoning-redaction",
    inputHash: liveInputHash(lunaBody),
    agentSlug: "belle",
    stage: "belle:daily-signal:draft",
    body: lunaBody,
  };
  const usage = {
    prompt_tokens: 12,
    completion_tokens: 34,
    total_tokens: 46,
    cost: 0.0002,
    completion_tokens_details: { reasoning_tokens: 10 },
  };
  const rawCompletion = {
    id: "luna-private-reasoning",
    model: "openai/gpt-6-luna",
    reasoning: reasoningSecret,
    reasoning_content: reasoningSecret,
    reasoning_details: [{ text: reasoningSecret }],
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: '{"status":"ok"}',
          reasoning: reasoningSecret,
          reasoning_content: reasoningSecret,
          reasoning_details: [{ text: reasoningSecret }],
        },
      },
    ],
    usage,
  };
  let cachedResult;
  const service = new LiveService({
    live: {
      run: createLiveProvider({
        apiKey: "private-key",
        fetchImpl: async () => Response.json(rawCompletion),
      }),
    },
    store: {
      async claim(request, hash) {
        if (cachedResult) {
          return {
            claimed: false,
            input_hash: request.inputHash,
            request_hash: hash,
            state: "succeeded",
            result: cachedResult,
          };
        }
        return { claimed: true };
      },
      async complete(_jobId, result) {
        cachedResult = result;
      },
      async fail() {},
    },
  });

  const returned = await service.complete(lunaRequest);
  assert.equal(JSON.stringify(returned).includes(reasoningSecret), false);
  assert.deepEqual(returned.completion.usage, usage);
  assert.deepEqual(returned.completion.choices[0].message, {
    role: "assistant",
    content: '{"status":"ok"}',
  });
  assert.deepEqual(cachedResult, returned);
  assert.deepEqual(await service.complete(lunaRequest), returned);
  assert.equal(JSON.stringify(cachedResult).includes(reasoningSecret), false);
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

test("known 429 rate rejections expose finite categories without provider text", async () => {
  const privateText = "private prompt and bearer secret";
  for (const [message, code] of [
    [
      "tokens_per_minute quota exceeded; account quota",
      "provider_rejected_rate_tokens",
    ],
    ["tokenquota exceeded; rate limit", "provider_rejected_rate_tokens"],
    ["requests_per_minute exceeded", "provider_rejected_rate_requests"],
    ["requestquota exceeded", "provider_rejected_rate_requests"],
    [
      "server busy: concurrency limit reached",
      "provider_rejected_rate_concurrency",
    ],
    ["upstream temporarily rate limited", "provider_rejected_rate_upstream"],
    ["API key rate limit exceeded", "provider_rejected_rate_account"],
    ["rate limit", "provider_rejected_rate_generic"],
  ]) {
    assert.equal(PREINFERENCE_REJECTION_CODES.has(code), true);
    const provider = createLiveProvider({
      apiKey: "private-key",
      fetchImpl: async () =>
        Response.json(
          { error: { message: `${message}; ${privateText}` } },
          { status: 429 },
        ),
    });
    await assert.rejects(
      provider(request()),
      (error) =>
        error.code === code &&
        error.status === 429 &&
        error.outcomeUnknown === false &&
        error.message === code &&
        !JSON.stringify(error).includes(privateText),
    );
  }
  const rawProvider = createLiveProvider({
    apiKey: "private-key",
    fetchImpl: async () =>
      Response.json(
        {
          error: {
            message: "rate limit",
            metadata: { raw: `tokenquota exceeded; ${privateText}` },
          },
        },
        { status: 429 },
      ),
  });
  await assert.rejects(
    rawProvider(request()),
    (error) =>
      error.code === "provider_rejected_rate_tokens" &&
      error.message === error.code &&
      !JSON.stringify(error).includes(privateText),
  );
  for (const status of [408, 409, 500]) {
    const ambiguous = createLiveProvider({
      apiKey: "private-key",
      fetchImpl: async () =>
        Response.json(
          {
            error: { message: `tokens_per_minute rate limit; ${privateText}` },
          },
          { status },
        ),
    });
    await assert.rejects(
      ambiguous(request()),
      (error) =>
        error.code === "provider_unavailable" &&
        error.status === 502 &&
        error.outcomeUnknown === true &&
        !JSON.stringify(error).includes(privateText),
    );
  }
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


test("receipt diagnostics return fixed scalar shape checks without completion text", async () => {
  const row = {job_id:"eliza-shape",input_hash:"a".repeat(64),request_hash:"b".repeat(64),state:"succeeded",error_code:null,created_at:new Date(),updated_at:new Date(),result_version:2,result_runtime_version:"1.7.2",result_job_id:"eliza-shape",result_input_hash:"a".repeat(64),served_model:"openai/gpt-6-luna-20260922",completion_object:"chat.completion",completion_created:1793170000,choice_index:0,choice_role:"assistant",content_type:"string",tool_calls_type:"null",prompt_tokens:100,completion_tokens:30,total_tokens:130,result:{private:"PRIVATE_OUTPUT_MUST_NOT_LEAK"}};
  const service = new LiveService({store:{async inspect(){return row;}},live:{async run(){throw Error("must not infer");}}});
  const r = await service.status({jobId:row.job_id});
  assert.equal(r.receiptDiagnostics.bindingValid,true);
  assert.equal(r.receiptDiagnostics.toolCallsType,"null");
  assert.equal(r.receiptDiagnostics.servedModel,"openai/gpt-6-luna-20260922");
  assert.equal(JSON.stringify(r).includes("PRIVATE_OUTPUT"),false);
  row.served_model="private-credential-must-not-leak";
  assert.equal((await service.status({jobId:row.job_id})).receiptDiagnostics.servedModel,"invalid");
});

test('fresh receipt recovery is a bound read with no claim, purge or inference', async () => {
  const input = {jobId:'fresh-job',inputHash:'a'.repeat(64),agentSlug:'suki',stage:'suki:forum-reply'};
  const result = {version:2,...input,runtimeVersion:'1.7.2',completion};
  let reads=0;
  const store=new SqlJobStore({async query(sql,args){
    reads++;
    assert.match(sql,/^SELECT result/);
    assert.match(sql,/state='succeeded'/);
    assert.match(sql,/created_at > now\(\) - interval '2 minutes'/);
    assert.match(sql,/result_expires_at > now\(\)/);
    assert.deepEqual(args,[input.jobId,input.inputHash,input.agentSlug,input.stage]);
    return {rows:[{result}]};
  }});
  const liveService=new LiveService({store,live:{async run(){assert.fail('must not infer');}}});
  assert.deepEqual(await liveService.receipt(input),result);
  assert.equal(reads,1);
  assert.equal(liveService.active.size,0);
  for (const extra of [{body:{}},{inputHash:'invalid'},{agentSlug:'system'},{stage:'nyx:forum-reply'}])
    await assert.rejects(liveService.receipt({...input,...extra}),/invalid_request/);
  assert.equal(reads,1);
});
test('missing, expired, mismatched or uncommitted receipts cannot be recovered',async()=>{
  const input={jobId:'fresh-job',inputHash:'a'.repeat(64),agentSlug:'suki',stage:'suki:forum-reply'};
  for(const result of [null,{version:2,...input,agentSlug:'nyx',runtimeVersion:'1.7.2'}]){
    const service=new LiveService({store:{async receipt(){return result;}},live:{async run(){assert.fail('must not infer');}}});
    await assert.rejects(service.receipt(input),/receipt_unavailable/);
  }
});

test('HTTP receipt is live-key-only, body-bounded and never invokes complete',async()=>{
  let reads=0;
  const server=createHttpServer({
    service:{stopped:false,busy:false},secret:shadowSecret,liveSecret,log:()=>{},
    liveService:{active:new Map(),async receipt(input){reads++;return {version:2,jobId:input.jobId};},async complete(){assert.fail('must not complete');}},
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}/receipt`;
  const input={jobId:'fresh',inputHash:'a'.repeat(64),agentSlug:'suki',stage:'suki:forum-reply'};
  const post=(key,body)=>fetch(url,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body});
  try{
    assert.equal((await post(shadowSecret,JSON.stringify(input))).status,401);
    assert.equal(reads,0);
    assert.equal((await post(liveSecret,'x'.repeat(513))).status,413);
    assert.equal(reads,0);
    const r=await post(liveSecret,JSON.stringify(input));assert.equal(r.status,200);
    assert.deepEqual(await r.json(),{version:2,jobId:'fresh'});assert.equal(reads,1);
  }finally{server.close();server.closeAllConnections();await once(server,'close');}
});
