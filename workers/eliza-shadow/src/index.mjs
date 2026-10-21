import { createHttpServer, validSecret } from "./server.mjs";
import { createProvider } from "./provider.mjs";
import { createRuntimeBackend, ShadowService } from "./runtime.mjs";
import { WorkerError } from "./contract.mjs";

async function main() {
  const secret = process.env.ELIZA_SHADOW_WORKER_SECRET;
  if (!validSecret(secret)) throw new WorkerError("invalid_worker_secret", 500);
  const postgresUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const pgliteDir = process.env.ELIZA_SHADOW_PGLITE_DIR;
  if (!postgresUrl && (process.env.NODE_ENV === "production" || !pgliteDir))
    throw new WorkerError("postgres_required", 500);
  if (postgresUrl && !/^postgres(?:ql)?:\/\//.test(postgresUrl))
    throw new WorkerError("invalid_postgres_url", 500);
  const timeoutMs = Number(
    process.env.ELIZA_SHADOW_PROVIDER_TIMEOUT_MS || 120_000,
  );
  const port = Number(process.env.PORT || 8080);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new WorkerError("invalid_port", 500);
  const generate = createProvider({
    apiKey: process.env.OPENROUTER_API_KEY,
    timeoutMs,
  });
  const backend = await createRuntimeBackend({
    postgresUrl,
    pgliteDir,
    generate,
  });
  const service = new ShadowService(backend);
  const server = createHttpServer({ service, secret });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "0.0.0.0", resolve);
    });
  } catch (error) {
    await service.close();
    throw error;
  }
  console.log(
    JSON.stringify({
      event: "worker_ready",
      runtimeVersion: "1.7.2",
      shadowOnly: true,
    }),
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    server.closeIdleConnections();
    await service.close();
  };
  process.once("SIGTERM", () => {
    void stop();
  });
  process.once("SIGINT", () => {
    void stop();
  });
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: "worker_start_failed",
      code: error instanceof WorkerError ? error.code : "initialization_failed",
    }),
  );
  process.exitCode = 1;
});
