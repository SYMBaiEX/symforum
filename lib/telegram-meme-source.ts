
import { FORUM_SITE_URL } from "./site-urls";
/** Public APIs only; redirects, credentials, ports and oversized streams fail closed. */
export async function readMemeSource(url: string, max = 5_000_000) {
  const u = new URL(url);
  if (
    !["api.memegen.link", "api.imgflip.com"].includes(u.hostname) ||
    u.protocol !== "https:" ||
    u.port ||
    u.username ||
    u.password
  )
    throw Error("unapproved_media_source");
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      "User-Agent": "SYMBaiEX-Forum-Memes/1.0 (+" + FORUM_SITE_URL + ")",
    },
  });
  if (!response.ok || !response.body)
    throw Error(`media_http_${response.status}`);
  if (Number(response.headers.get("content-length")) > max) {
    await response.body.cancel();
    throw Error("media_too_large");
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw Error("media_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
