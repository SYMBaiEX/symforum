import { describe, expect, test } from "vitest";
import {
  registryArguments,
  boundedRegistryText,
  verifyRegistryEntry,
} from "../scripts/lib/mcp-registry-release.mjs";
import entry from "@/registry/docs.server.json";

describe("registry release safeguards", () => {
  test("requires an unambiguous publish mode and private-key path", () => {
    expect(registryArguments([])).toEqual({ publish: false });
    expect(registryArguments(["--check"])).toEqual({ publish: false });
    expect(
      registryArguments(["--publish", "--key-file", "/private/key.pem"]),
    ).toEqual({ publish: true, keyPath: "/private/key.pem" });
    for (const args of [
      ["--check", "--publish"],
      ["unexpected"],
      ["--publish"],
      ["--publish", "--key-file", "relative.pem"],
      ["--check", "--publish", "--key-file", "/private/key.pem"],
    ])
      expect(() => registryArguments(args)).toThrow("Usage:");
  });

  test("accepts identical published versions and rejects any immutable metadata drift", () => {
    expect(() =>
      verifyRegistryEntry(entry, {
        server: structuredClone(entry),
        _meta: { registry: "owned" },
      }),
    ).not.toThrow();
    for (const actual of [
      null,
      { server: { ...entry, description: "Other" } },
      { server: { ...entry, remotes: [] } },
      { server: { ...entry, packages: [] } },
    ])
      expect(() => verifyRegistryEntry(entry, actual)).toThrow("mismatch");
  });

  test("bounds the response while streaming, not after buffering it", async () => {
    await expect(boundedRegistryText(new Response("ok"))).resolves.toBe("ok");
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(65536));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(boundedRegistryText(new Response(stream))).rejects.toThrow(
      "size budget",
    );
    expect(cancelled).toBe(true);
  });
});
