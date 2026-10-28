import { Container } from "@cloudflare/containers";
import { fetchGateway, unavailable } from "./gateway";

export interface Env extends Cloudflare.Env {
  OPENROUTER_API_KEY: string;
  DATABASE_URL: string;
  ELIZA_SHADOW_WORKER_SECRET: string;
  ELIZA_RUNTIME_WORKER_SECRET?: string;
}

export class ElizaShadowContainer extends Container<Env> {
  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Env) {
    super(ctx, env, {
      defaultPort: 8080,
      sleepAfter: "5m",
      enableInternet: true,
      envVars: {
        OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
        DATABASE_URL: env.DATABASE_URL,
        ELIZA_SHADOW_WORKER_SECRET: env.ELIZA_SHADOW_WORKER_SECRET,
        ...(env.ELIZA_RUNTIME_WORKER_SECRET
          ? { ELIZA_RUNTIME_WORKER_SECRET: env.ELIZA_RUNTIME_WORKER_SECRET }
          : {}),
        LOG_LEVEL: "error",
        NODE_ENV: "production",
      },
    });
  }

  override onError(_error: unknown): void {
    // The base hook logs raw platform errors; keep those out of Worker logs.
  }

  override async fetch(request: Request): Promise<Response> {
    try {
      await this.startAndWaitForPorts();
      this.renewActivityTimeout();
      // Use the runtime port directly: the SDK proxy logs raw exceptions and
      // returns their text to clients on failure. This endpoint is HTTP-only.
      return await this.ctx.container!.getTcpPort(8080).fetch(request);
    } catch {
      const path = new URL(request.url).pathname;
      return path === "/complete"
        ? Response.json(
            { error: "container_unavailable", outcomeUnknown: true },
            {
              status: 503,
              headers: {
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
              },
            },
          )
        : ["/status", "/receipt"].includes(path)
          ? Response.json(
              { error: "container_unavailable", outcomeUnknown: false },
              {
                status: 503,
                headers: {
                  "Cache-Control": "no-store",
                  "X-Content-Type-Options": "nosniff",
                },
              },
            )
          : unavailable();
    }
  }
}

export default { fetch: fetchGateway } satisfies ExportedHandler<Env>;
