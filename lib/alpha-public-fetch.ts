import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { alphaPublisherUrl } from "./forum-alpha-editorial";
export function alphaPublicAddress(ip: string) {
  if (isIP(ip) === 6)
    return /^[23][0-9a-f]{3}:/i.test(ip) && !/^2001:db8:/i.test(ip);
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
/** Public DNS is pinned to the TLS connection. Every redirect is checked again. */
export async function alphaPublicFetch(
  value: string,
  init: RequestInit,
  maxBytes: number,
  hops = 0,
): Promise<Response> {
  const parsed = alphaPublisherUrl(value);
  // Only the configured RSS endpoint is permitted on Bing, never its tracker.
  const u = new URL(parsed ?? value);
  if (
    !parsed &&
    !(
      u.protocol === "https:" &&
      u.hostname === "www.bing.com" &&
      u.pathname === "/news/search" &&
      !u.username &&
      !u.password &&
      !u.port
    )
  )
    throw Error("Unsafe research URL");
  const addresses = await lookup(u.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some((a) => !alphaPublicAddress(a.address))
  )
    throw Error("Non-public research host");
  const pinned = addresses[0];
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, key) => {
    headers[key] = value;
  });
  return await new Promise<Response>((resolve, reject) => {
    const req = request(
      u,
      {
        method: "GET",
        headers,
        lookup: (_host, options, cb) =>
          options.all
            ? cb(null, [pinned])
            : cb(null, pinned.address, pinned.family),
        signal: init.signal ?? AbortSignal.timeout(12_000),
      },
      (res) => {
        const status = res.statusCode ?? 502;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.destroy();
          if (hops >= 4) {
            reject(Error("Too many redirects"));
            return;
          }
          alphaPublicFetch(
            new URL(res.headers.location, u).href,
            init,
            maxBytes,
            hops + 1,
          ).then(resolve, reject);
          return;
        }
        if (Number(res.headers["content-length"] ?? 0) > maxBytes) {
          res.destroy();
          reject(Error("Research response too large"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy(Error("Research response too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined)
              headers.set(k, Array.isArray(v) ? v.join(", ") : v);
          }
          resolve(
            new Response(new Uint8Array(Buffer.concat(chunks)), {
              status,
              headers,
            }),
          );
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}
