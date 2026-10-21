import { createHash } from "node:crypto";
import { AgentRuntime, ModelType, stringToUuid } from "@elizaos/core";
import { createDatabaseAdapter } from "@elizaos/plugin-sql";
import {
  MAX_REQUEST_BYTES,
  RUNTIME_VERSION,
  WorkerError,
  readBoundedResponse,
  record,
  requestHash,
} from "./contract.mjs";

export const LIVE_MODELS = new Set([
  "openrouter/free",
  "~deepseek/deepseek-v4-flash-latest",
]);
// Leave room for the v2 envelope inside the transport's 256 KiB response cap.
const MAX_LIVE_COMPLETION_BYTES = 240 * 1024;
export const LIVE_AGENTS = new Set([
  "mara-venn",
  "theo-marlow",
  "nia-calder",
  "jonah-vale",
  "elise-rowan",
  "micah-sol",
  "sora-bennett",
  "iris-kellan",
  "damon-pike",
  "lena-corwin",
  "ari-mercer",
  "talia-frost",
  "nolan-reese",
  "mina-hart",
  "evan-lark",
  "cleo-arden",
  "silas-quinn",
  "rhea-nolan",
  "owen-voss",
  "zara-penn",
  "cal-hartley",
  "maya-fen",
  "leo-senn",
  "nora-flint",
  "kira-morrow",
  "drew-ellison",
  "asha-lennox",
  "remy-kade",
  "june-merritt",
  "max-delaney",
  "suki",
  "belle",
  "nyx",
  "system",
]);
const BODY_KEYS = new Set([
  "model",
  "messages",
  "stream",
  "response_format",
  "tools",
  "tool_choice",
  "provider",
  "reasoning",
  "plugins",
  "max_tokens",
  "max_completion_tokens",
  "temperature",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "stop",
  "seed",
  "n",
  "parallel_tool_calls",
  "usage",
  "user",
]);
const KNOWN_PREINFERENCE_STATUSES = new Set([
  400, 401, 402, 403, 404, 410, 413, 415, 422, 429,
]);
const FORUM_STAGE_SUFFIXES = new Set([
  "topic",
  "draft",
  "revision",
  "revision-light",
  "evidence-review",
  "reply",
  "reply-evidence-review",
]);

function validStage(agentSlug, stage) {
  if (agentSlug === "system") return stage === "health-canary";
  if (
    stage.startsWith(`${agentSlug}:forum-`) &&
    FORUM_STAGE_SUFFIXES.has(stage.slice(`${agentSlug}:forum-`.length))
  )
    return true;
  if (agentSlug !== "belle") return false;
  return /^(?:belle:(?:daily-signal|weekly-field-note):(?:draft|revision)|belle:hacker-news-digest(?:-revision)?)$/.test(
    stage,
  );
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!record(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}
export function liveInputHash(body) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(body)))
    .digest("hex");
}

function boundedTree(
  value,
  { maxNodes = 2500, maxDepth = 16, maxString = 100_000 } = {},
) {
  let nodes = 0;
  function visit(node, depth) {
    if (++nodes > maxNodes || depth > maxDepth)
      throw new WorkerError("invalid_request");
    if (typeof node === "string") {
      if (Buffer.byteLength(node) > maxString)
        throw new WorkerError("request_too_large", 413);
    } else if (typeof node === "number") {
      if (!Number.isFinite(node)) throw new WorkerError("invalid_request");
    } else if (Array.isArray(node)) {
      if (node.length > 256) throw new WorkerError("invalid_request");
      for (const child of node) visit(child, depth + 1);
    } else if (record(node)) {
      if (Object.keys(node).length > 200)
        throw new WorkerError("invalid_request");
      for (const [key, child] of Object.entries(node)) {
        if (
          key === "$ref" &&
          (typeof child !== "string" ||
            !/^#\/(?:\$defs|definitions)\/[A-Za-z0-9_~/-]{1,200}$/.test(child))
        )
          throw new WorkerError("invalid_request");
        if (
          key === "__proto__" ||
          key === "constructor" ||
          key === "prototype" ||
          key.length > 200
        )
          throw new WorkerError("invalid_request");
        visit(child, depth + 1);
      }
    } else if (node !== null && typeof node !== "boolean")
      throw new WorkerError("invalid_request");
  }
  visit(value, 0);
}

export function validateLiveRequest(input) {
  if (
    !record(input) ||
    Object.keys(input).length !== 6 ||
    Object.keys(input).some(
      (key) =>
        ![
          "version",
          "jobId",
          "inputHash",
          "agentSlug",
          "stage",
          "body",
        ].includes(key),
    ) ||
    input.version !== 2 ||
    typeof input.jobId !== "string" ||
    !/^[A-Za-z0-9:_-]{1,200}$/.test(input.jobId) ||
    typeof input.inputHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.inputHash) ||
    typeof input.agentSlug !== "string" ||
    !LIVE_AGENTS.has(input.agentSlug) ||
    typeof input.stage !== "string" ||
    !/^[a-zA-Z0-9:_-]{1,160}$/.test(input.stage) ||
    !validStage(input.agentSlug, input.stage) ||
    !record(input.body)
  )
    throw new WorkerError("invalid_request");
  const body = input.body;
  // The non-streaming official SDK method omits stream; only doStream sets true.
  if (
    Object.keys(body).some((key) => !BODY_KEYS.has(key)) ||
    (body.stream !== undefined && body.stream !== false) ||
    !LIVE_MODELS.has(body.model)
  )
    throw new WorkerError(
      body.model && !LIVE_MODELS.has(body.model)
        ? "model_not_allowed"
        : "invalid_request",
    );
  if (
    !Array.isArray(body.messages) ||
    body.messages.length < 1 ||
    body.messages.length > 64
  )
    throw new WorkerError("invalid_request");
  for (const message of body.messages) {
    if (
      !record(message) ||
      !["system", "developer", "user", "assistant", "tool"].includes(
        message.role,
      ) ||
      Object.keys(message).some(
        (key) =>
          ![
            "role",
            "content",
            "name",
            "tool_call_id",
            "tool_calls",
            "refusal",
          ].includes(key),
      )
    )
      throw new WorkerError("invalid_request");
    if (
      typeof message.content !== "string" &&
      message.content !== null &&
      !Array.isArray(message.content)
    )
      throw new WorkerError("invalid_request");
    if (
      Array.isArray(message.content) &&
      (message.content.length > 64 ||
        message.content.some(
          (part) =>
            !record(part) ||
            part.type !== "text" ||
            typeof part.text !== "string",
        ))
    )
      throw new WorkerError("invalid_request");
  }
  if (body.max_tokens === undefined && body.max_completion_tokens === undefined)
    throw new WorkerError("invalid_output_limit");
  for (const key of ["max_tokens", "max_completion_tokens"])
    if (
      body[key] !== undefined &&
      (!Number.isSafeInteger(body[key]) || body[key] < 1 || body[key] > 40_000)
    )
      throw new WorkerError("invalid_output_limit");
  if (body.n !== undefined && body.n !== 1)
    throw new WorkerError("invalid_request");
  if (
    body.provider !== undefined &&
    (!record(body.provider) ||
      Object.keys(body.provider).some(
        (key) =>
          ![
            "allow_fallbacks",
            "require_parameters",
            "order",
            "ignore",
            "data_collection",
            "quantizations",
            "sort",
          ].includes(key),
      ))
  )
    throw new WorkerError("invalid_request");
  if (
    body.plugins !== undefined &&
    (!Array.isArray(body.plugins) ||
      body.plugins.length > 4 ||
      body.plugins.some(
        (plugin) =>
          !record(plugin) ||
          plugin.id !== "response-healing" ||
          Object.keys(plugin).some((key) => key !== "id"),
      ))
  )
    throw new WorkerError("invalid_request");
  if (
    body.tools !== undefined &&
    (!Array.isArray(body.tools) ||
      body.tools.length > 20 ||
      body.tools.some(
        (tool) =>
          !record(tool) ||
          tool.type !== "function" ||
          !record(tool.function) ||
          typeof tool.function.name !== "string" ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(tool.function.name),
      ))
  )
    throw new WorkerError("invalid_request");
  if (
    body.response_format !== undefined &&
    (!record(body.response_format) ||
      !["json_schema", "json_object", "text"].includes(
        body.response_format.type,
      ))
  )
    throw new WorkerError("invalid_request");
  boundedTree(body);
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_REQUEST_BYTES)
    throw new WorkerError("request_too_large", 413);
  if (liveInputHash(body) !== input.inputHash)
    throw new WorkerError("input_hash_mismatch", 409);
  return input;
}

export function createLiveProvider({
  apiKey,
  timeoutMs = 120_000,
  fetchImpl = fetch,
}) {
  if (
    !apiKey ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120_000
  )
    throw new WorkerError("invalid_provider_configuration", 500);
  return async (request, shutdownSignal) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    shutdownSignal?.addEventListener("abort", abort, { once: true });
    if (shutdownSignal?.aborted) controller.abort();
    try {
      const response = await fetchImpl(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "X-Title": "SYMBaiEX Eliza runtime",
          },
          body: JSON.stringify(request.body),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        if (KNOWN_PREINFERENCE_STATUSES.has(response.status))
          throw new WorkerError("provider_rejected", response.status);
        throw new WorkerError("provider_unavailable", 502, true);
      }
      let completion;
      try {
        completion = JSON.parse(
          await readBoundedResponse(response, MAX_LIVE_COMPLETION_BYTES),
        );
      } catch {
        throw new WorkerError("provider_invalid_response", 502, true);
      }
      if (record(completion) && Object.hasOwn(completion, "error"))
        throw new WorkerError("provider_embedded_error", 502, true);
      if (
        !record(completion) ||
        typeof completion.id !== "string" ||
        !Array.isArray(completion.choices) ||
        completion.choices.length < 1 ||
        completion.choices.length > 4 ||
        !record(completion.choices[0]) ||
        !record(completion.choices[0].message) ||
        typeof completion.model !== "string" ||
        completion.model.length > 200 ||
        !record(completion.usage) ||
        !Number.isSafeInteger(completion.usage.prompt_tokens) ||
        completion.usage.prompt_tokens < 0 ||
        !Number.isSafeInteger(completion.usage.completion_tokens) ||
        completion.usage.completion_tokens < 0
      )
        throw new WorkerError("provider_invalid_response", 502, true);
      return completion;
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      throw new WorkerError(
        controller.signal.aborted
          ? "provider_timeout"
          : "provider_network_error",
        controller.signal.aborted ? 504 : 502,
        true,
      );
    } finally {
      clearTimeout(timeout);
      shutdownSignal?.removeEventListener("abort", abort);
    }
  };
}

export function createLiveRunner({
  postgresUrl,
  pgliteDir,
  generate,
  adapters,
  quiet,
}) {
  const runtimes = new Map();
  const pendingLogs = new Set();
  return {
    async run(request, signal) {
      let runtime = runtimes.get(request.agentSlug);
      if (!runtime) {
        const id = stringToUuid(
          `symbaiex:eliza-runtime:v2:${request.agentSlug}`,
        );
        const adapter = createDatabaseAdapter(
          postgresUrl ? { postgresUrl } : { dataDir: pgliteDir },
          id,
        );
        adapters.push(adapter);
        const persistLog = adapter.log.bind(adapter);
        adapter.log = (entry) => {
          const pending = persistLog({
            ...entry,
            body: {
              runtimeVersion: RUNTIME_VERSION,
              modelType: entry.body?.modelType,
              provider: "openrouter",
              contentRedacted: true,
            },
          }).catch(quiet);
          pendingLogs.add(pending);
          void pending.finally(() => pendingLogs.delete(pending));
          return pending;
        };
        runtime = new AgentRuntime({
          character: {
            id,
            name: request.agentSlug,
            bio: [`Forum agent ${request.agentSlug}.`],
            settings: {},
            plugins: [],
          },
          adapter,
          settings: {},
          plugins: [
            {
              name: "symbaiex-live-model",
              description:
                "One bounded model request; no tools or publication.",
              models: {
                [ModelType.TEXT_LARGE]: (_runtime, params) =>
                  generate(params.request, params.signal),
              },
            },
          ],
        });
        for (const method of [
          "trace",
          "debug",
          "info",
          "warn",
          "error",
          "fatal",
          "success",
          "progress",
          "log",
        ])
          runtime.logger[method] = quiet;
        await runtime.initialize({ skipMigrations: true });
        runtimes.set(request.agentSlug, runtime);
      }
      runtime.startRun();
      try {
        return await runtime.useModel(
          ModelType.TEXT_LARGE,
          { request, signal },
          "symbaiex-live-model",
        );
      } finally {
        runtime.endRun();
      }
    },
    async close() {
      for (const runtime of runtimes.values()) await runtime.stop();
      await Promise.allSettled([...pendingLogs]);
    },
    capabilities() {
      return { initialized: runtimes.size, allowlisted: LIVE_AGENTS.size - 1 };
    },
  };
}

export class LiveService {
  active = new Map();
  stopped = false;
  constructor(backend) {
    this.backend = backend;
  }
  async status(input) {
    if (
      !record(input) ||
      Object.keys(input).length !== 1 ||
      typeof input.jobId !== "string" ||
      !/^[A-Za-z0-9:_-]{1,200}$/.test(input.jobId)
    )
      throw new WorkerError("invalid_request");
    if (this.stopped) throw new WorkerError("worker_stopping", 503);
    const row = await this.backend.store.inspect(input.jobId);
    if (!row) throw new WorkerError("job_not_found", 404);
    if (
      row.job_id !== input.jobId ||
      typeof row.input_hash !== "string" ||
      row.input_hash.length > 128 ||
      typeof row.request_hash !== "string" ||
      row.request_hash.length > 128 ||
      !["running", "succeeded", "failed", "unknown"].includes(row.state) ||
      (row.error_code !== null &&
        row.error_code !== undefined &&
        (typeof row.error_code !== "string" || row.error_code.length > 80))
    )
      throw new WorkerError("job_status_unavailable", 503);
    const createdAt = new Date(row.created_at);
    const updatedAt = new Date(row.updated_at);
    if (
      !Number.isFinite(createdAt.getTime()) ||
      !Number.isFinite(updatedAt.getTime())
    )
      throw new WorkerError("job_status_unavailable", 503);
    return {
      version: 2,
      jobId: row.job_id,
      inputHash: row.input_hash,
      requestHash: row.request_hash,
      state: row.state,
      errorCode: row.error_code ?? null,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    };
  }
  async complete(input) {
    const request = validateLiveRequest(input);
    if (this.stopped) throw new WorkerError("worker_stopping", 503);
    if (this.active.size >= 2 || this.active.has(request.agentSlug))
      throw new WorkerError("worker_busy", 503);
    const controller = new AbortController();
    const run = async () => {
      let claimed = false;
      let inferenceStarted = false;
      try {
        const hash = requestHash(request);
        const claim = await this.backend.store.claim(request, hash);
        if (!claim.claimed) {
          if (
            claim.input_hash !== request.inputHash ||
            claim.request_hash !== hash
          )
            throw new WorkerError("job_input_conflict", 409);
          if (claim.state === "succeeded" && claim.result) return claim.result;
          throw new WorkerError(
            claim.state === "succeeded"
              ? "job_result_expired"
              : claim.state === "failed"
                ? "job_failed_no_retry"
                : "job_outcome_unknown",
            409,
            claim.state === "unknown" || claim.state === "running",
          );
        }
        claimed = true;
        inferenceStarted = true;
        const completion = await this.backend.live.run(
          request,
          controller.signal,
        );
        const result = {
          version: 2,
          jobId: request.jobId,
          inputHash: request.inputHash,
          agentSlug: request.agentSlug,
          stage: request.stage,
          runtimeVersion: RUNTIME_VERSION,
          completion,
        };
        await this.backend.store.complete(request.jobId, result);
        return result;
      } catch (error) {
        const safe =
          error instanceof WorkerError
            ? error
            : new WorkerError("worker_internal_error", 503, inferenceStarted);
        if (claimed)
          await this.backend.store
            .fail(
              request.jobId,
              safe.code,
              inferenceStarted && safe.code !== "provider_rejected",
            )
            .catch(() => {});
        throw safe;
      }
    };
    const pending = run();
    this.active.set(request.agentSlug, { pending, controller });
    try {
      return await pending;
    } finally {
      this.active.delete(request.agentSlug);
    }
  }
  async close() {
    this.stopped = true;
    for (const entry of this.active.values()) entry.controller.abort();
    await Promise.allSettled(
      [...this.active.values()].map((entry) => entry.pending),
    );
  }
}
