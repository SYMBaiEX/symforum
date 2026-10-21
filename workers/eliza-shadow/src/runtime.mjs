import { AgentRuntime, ModelType, logger, stringToUuid } from "@elizaos/core";
import { createDatabaseAdapter } from "@elizaos/plugin-sql";
import {
  RUNTIME_VERSION,
  MODEL,
  WorkerError,
  requestHash,
  validateRequest,
} from "./contract.mjs";
import {
  initializeRuntimeDatabase,
  validatePostgresUrl,
  assertDedicatedDatabaseConfiguration,
} from "./database.mjs";

// Upstream database errors can contain SQL parameters. Keep all upstream logging
// disabled; this process emits only the fixed safe lifecycle/error codes below.
const quiet = () => {};
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
  logger[method] = quiet;

const personas = {
  "suki-reply": {
    name: "Suki shadow",
    bio: ["A thoughtful forum reply draft reviewer."],
  },
  "belle-newsletter": {
    name: "Belle shadow",
    bio: ["A source-grounded newsletter draft writer."],
  },
};

export async function createRuntimeBackend({
  postgresUrl,
  pgliteDir,
  generate,
}) {
  const adapters = [];
  const runtimes = new Map();
  const pendingLogs = new Set();
  let store;
  try {
    if (postgresUrl) {
      validatePostgresUrl(postgresUrl);
      assertDedicatedDatabaseConfiguration();
    }
    for (const [kind, persona] of Object.entries(personas)) {
      const id = stringToUuid(`symbaiex:eliza-shadow:v1:${kind}`);
      const adapter = createDatabaseAdapter(
        postgresUrl ? { postgresUrl } : { dataDir: pgliteDir },
        id,
      );
      adapters.push(adapter);
      if (adapters.length === 1) {
        store = await initializeRuntimeDatabase(adapter, { postgresUrl });
      }
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
      const plugin = {
        name: "symbaiex-shadow-model",
        description:
          "One bounded draft-only OpenRouter call; no services, tools, or publication.",
        models: {
          [ModelType.OBJECT_SMALL]: (_runtime, params) =>
            generate(params.request, params.signal),
        },
      };
      const runtime = new AgentRuntime({
        character: { id, ...persona, settings: {}, plugins: [] },
        adapter,
        settings: {},
        plugins: [plugin],
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
      runtimes.set(kind, runtime);
    }
    return {
      store,
      async run(request, signal) {
        const runtime = runtimes.get(request.kind);
        runtime.startRun();
        try {
          return await runtime.useModel(
            ModelType.OBJECT_SMALL,
            { request, signal },
            "symbaiex-shadow-model",
          );
        } finally {
          runtime.endRun();
        }
      },
      capabilities() {
        return [...runtimes.values()].map((runtime) => ({
          name: runtime.character.name,
          services: runtime.services.size,
          actions: runtime.actions.length,
          models: [...runtime.models.keys()],
        }));
      },
      async close() {
        for (const runtime of runtimes.values()) await runtime.stop();
        await Promise.allSettled([...pendingLogs]);
        // Adapters share one upstream connection pool/client. Close it once.
        await adapters[0].close();
      },
    };
  } catch (error) {
    if (adapters[0]) await adapters[0].close().catch(quiet);
    throw error;
  }
}

export class ShadowService {
  busy = false;
  stopped = false;
  active = null;
  constructor(backend) {
    this.backend = backend;
  }

  async generate(input) {
    const { request, validateOutput } = validateRequest(input);
    if (this.stopped) throw new WorkerError("worker_stopping", 503);
    if (this.busy) throw new WorkerError("worker_busy", 503);
    this.busy = true;
    const controller = new AbortController();
    this.controller = controller;
    const run = async () => {
      let claimed = false;
      let complete = false;
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
          );
        }
        claimed = true;
        const started = performance.now();
        const generated = await this.backend.run(request, controller.signal);
        if (!validateOutput(generated.output))
          throw new WorkerError("output_schema_invalid", 502);
        const result = {
          version: 1,
          jobId: request.jobId,
          inputHash: request.inputHash,
          ...generated,
          model: MODEL,
          durationMs: Math.ceil(performance.now() - started),
          runtimeVersion: RUNTIME_VERSION,
        };
        complete = true; // A provider result exists; a DB failure must never cause another call.
        await this.backend.store.complete(request.jobId, result);
        return result;
      } catch (error) {
        const safe =
          error instanceof WorkerError
            ? error
            : new WorkerError("worker_internal_error", 503, true);
        if (claimed)
          await this.backend.store
            .fail(request.jobId, safe.code, complete || safe.outcomeUnknown)
            .catch(quiet);
        throw safe;
      }
    };
    this.active = run();
    try {
      return await this.active;
    } finally {
      this.busy = false;
      this.active = null;
      this.controller = null;
    }
  }

  async maintenance() {
    if (this.stopped) throw new WorkerError("worker_stopping", 503);
    const purgedResults = await this.backend.store.purgeExpired();
    await this.backend.store.isReady();
    return {
      version: 1,
      ok: true,
      shadowOnly: true,
      purgedResults,
      runtimeVersion: RUNTIME_VERSION,
    };
  }

  async close() {
    this.stopped = true;
    this.controller?.abort();
    await this.active?.catch(quiet);
    await this.backend.close();
  }
}
