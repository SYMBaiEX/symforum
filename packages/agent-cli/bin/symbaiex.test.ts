// @vitest-environment node
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { run } from "./symbaiex";
import { FileTokenStore } from "../src/token-store";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("symbaiex login", () => {
  test("stores a stdin token without writing it to stdout or stderr", async () => {
    const directory = await mkdtemp(join(tmpdir(), "symbaiex-cli-output-"));
    const tokenFile = join(directory, "token");
    const output: string[] = [];
    const errors: string[] = [];
    const secret = "do-not-print-this-token";
    const code = await run(
      ["login", "--token-file", tokenFile],
      {
        log: (value: unknown) => output.push(String(value)),
        error: (value: unknown) => errors.push(String(value)),
      },
      async () => secret,
    );
    expect(code).toBe(0);
    expect(output.join("\n")).not.toContain(secret);
    expect(errors.join("\n")).not.toContain(secret);
    expect(await readFile(tokenFile, "utf8")).toBe(`${secret}\n`);
  });

  test("rejects arbitrary origins before a command can read credentials", async () => {
    let tokenReads = 0;
    const errors: string[] = [];
    const code = await run(
      ["status", "--origin", "https://untrusted.example"],
      {
        log: () => undefined,
        error: (value: unknown) => errors.push(String(value)),
      },
      async () => {
        tokenReads += 1;
        return "access-token";
      },
    );
    expect(code).toBe(1);
    expect(tokenReads).toBe(0);
    expect(errors.join("\n")).toMatch(/SYMBaiEX platform origin/i);
  });

  test("requires an explicit idempotency key before webhook writes", async () => {
    const errors: string[] = [];
    const code = await run(
      ["webhook-status", "primary", "paused"],
      {
        log: () => undefined,
        error: (value: unknown) => errors.push(String(value)),
      },
      async () => "access-token",
    );
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/idempotency-key is required/i);
  });

  test("shows grouped help without reading credentials or calling the network", async () => {
    const output: string[] = [];
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const code = await run(["help"], {
      log: (value: unknown) => output.push(String(value)),
      error: () => undefined,
    });

    expect(code).toBe(0);
    expect(output.join("\n")).toContain("source-registry");
    expect(output.join("\n")).toContain("research-create");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("routes source registry reads through the authenticated SDK client", async () => {
    const directory = await mkdtemp(join(tmpdir(), "symbaiex-cli-source-"));
    const tokenFile = join(directory, "token");
    await new FileTokenStore(tokenFile).setToken("test-access-token");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json({ adapters: [] }),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    const output: string[] = [];

    const code = await run(["source-registry", "--token-file", tokenFile], {
      log: (value: unknown) => output.push(String(value)),
      error: () => undefined,
    });

    expect(code).toBe(0);
    expect(output.join("\n")).toContain('"adapters"');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://www.symbaiex.com/api/agent/v1/source-registry",
    );
  });

  test("requires a replay key before semantic provider work", async () => {
    const errors: string[] = [];
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    const code = await run(["semantic-search", "durable workflows"], {
      log: () => undefined,
      error: (value: unknown) => errors.push(String(value)),
    });

    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/idempotency-key is required/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects misspelled options before reading a token", async () => {
    const errors: string[] = [];
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    const code = await run(["status", "--limt", "10"], {
      log: () => undefined,
      error: (value: unknown) => errors.push(String(value)),
    });

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("Unknown option: --limt");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
