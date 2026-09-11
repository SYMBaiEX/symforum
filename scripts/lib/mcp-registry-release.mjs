import { isDeepStrictEqual } from "node:util";

export function registryArguments(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === "--check"))
    return { publish: false };
  if (
    args.length === 3 &&
    args[0] === "--publish" &&
    args[1] === "--key-file" &&
    args[2].startsWith("/")
  )
    return { publish: true, keyPath: args[2] };
  throw new Error(
    "Usage: bun scripts/publish-mcp-registry.mjs --check | --publish --key-file /private/path/key.pem",
  );
}

export async function boundedRegistryText(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 128 * 1024)
        throw new Error("Registry response exceeded its size budget");
      chunks.push(part.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel();
  }
}

export function verifyRegistryEntry(expected, actual) {
  // Only the registry-owned envelope may add fields, never the published server payload.
  if (!isDeepStrictEqual(expected, actual?.server))
    throw new Error(`Registry readback mismatch for ${expected.name}`);
}
