/**
 * Register Vercel's OpenTelemetry bridge once per server runtime and retain
 * Next.js' request-level error context for deployment diagnostics.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { registerOTel } = await import("@vercel/otel");
  const { registerTelemetry } = await import("ai");
  const { OpenTelemetry } = await import("@ai-sdk/otel");
  registerOTel("symbaiex");
  registerTelemetry(new OpenTelemetry({ runtimeContext: true }));
}

export function onRequestError(
  error: unknown,
  request: Readonly<{
    path: string;
    method: string;
    headers: NodeJS.Dict<string | string[]>;
  }>,
  context: Readonly<{
    routerKind: "Pages Router" | "App Router";
    routePath: string;
    routeType: "render" | "route" | "action" | "proxy";
    renderSource?:
      | "react-server-components"
      | "react-server-components-payload"
      | "server-rendering";
    revalidateReason: "on-demand" | "stale" | undefined;
  }>,
) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error("[instrumentation] request error", {
    error: errorMessage,
    method: request.method,
    path: request.path,
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
  });
}
