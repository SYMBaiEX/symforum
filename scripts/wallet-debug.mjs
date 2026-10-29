// Bun-only, opt-in manual diagnostics. Does not run Next, Convex, or load SDKs
// for embedded wallets. Listen only on loopback; all proof state is ephemeral.
import { createWalletDebugHandler } from "../tests/manual/wallet-debug-server.ts";

const port = Number(process.env.WALLET_DEBUG_PORT ?? 43218);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid diagnostic port.");
const result = await Bun.build({
  entrypoints: ["tests/manual/wallet-debug.tsx"],
  target: "browser",
  format: "iife",
  minify: false,
  define: { "process.env": JSON.stringify({ NODE_ENV: "production" }) },
});
if (!result.success) throw new Error(result.logs.join("\n"));
const origin = `http://127.0.0.1:${port}`;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  maxRequestBodySize: 8192,
  fetch: createWalletDebugHandler(origin, await result.outputs[0].text()),
  error: () =>
    Response.json(
      { error: "Local diagnostic request failed." },
      { status: 500 },
    ),
});
console.log(`Local wallet diagnostics: ${origin}/?walletDebug=1`);
console.log(
  "No production/backend calls. Minimal mode only connects; full mode verifies a local-only signature.",
);
process.on("SIGINT", () => {
  server.stop(true);
  process.exit(0);
});
