import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { forumAttachmentContentTypeForFile } from "../components/forum/forum-attachment-upload";
import {
  FORUM_PLUGIN_FILE_BYTES,
  ForumUploadError,
} from "./forum-plugin-upload";
import {
  forumPluginBearer,
  hasForumPluginAudience,
  relayForumPlugin,
} from "./forum-plugin-relay";

export type ForumPluginFile = {
  download_url: string;
  file_id: string;
  file_name?: string;
  mime_type?: string;
};
type Download = { bytes: Uint8Array; contentType: string };
/** Reject local, private, carrier-grade, documentation and multicast addresses. */
export function isPublicForumFileAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 2) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) === 6) {
    const value = address.toLowerCase();
    // Public unicast allocation. Mapped/local IPv4 cannot slip through IPv6.
    return /^[23][0-9a-f]{3}:/.test(value) && !value.startsWith("2001:db8:");
  }
  return false;
}
function fileUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ForumUploadError("Attachment download URL is invalid.", 400);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hash ||
    value.length > 8192
  )
    throw new ForumUploadError(
      "Attachments require a public HTTPS download URL.",
      400,
    );
  return url;
}
/** DNS is checked and pinned for the TLS connection, including every redirect. */
export async function downloadForumPluginFile(
  value: string,
  redirects = 0,
): Promise<Download> {
  const url = fileUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some((entry) => !isPublicForumFileAddress(entry.address))
  )
    throw new ForumUploadError(
      "Attachment download host must resolve to public addresses.",
      400,
    );
  const pinned = addresses[0];
  return await new Promise<Download>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers: { Accept: "*/*" },
        // Node's family selection requests all addresses; keep both forms
        // pinned to the same already-verified DNS result.
        lookup: (_host, options, callback) =>
          options.all
            ? callback(null, [pinned])
            : callback(null, pinned.address, pinned.family),
        signal: AbortSignal.timeout(20_000),
      },
      (response) => {
        if (
          response.statusCode &&
          [301, 302, 303, 307, 308].includes(response.statusCode)
        ) {
          const location = response.headers.location;
          response.destroy();
          if (!location || redirects >= 3) {
            reject(
              new ForumUploadError(
                "Attachment download redirected too many times.",
                400,
              ),
            );
            return;
          }
          try {
            downloadForumPluginFile(
              new URL(location, url).href,
              redirects + 1,
            ).then(resolve, reject);
          } catch {
            reject(
              new ForumUploadError("Attachment redirect URL is invalid.", 400),
            );
          }
          return;
        }
        if (response.statusCode !== 200) {
          response.destroy();
          reject(
            new ForumUploadError(
              "Attachment could not be downloaded. Select the file again.",
              400,
            ),
          );
          return;
        }
        if (
          Number(response.headers["content-length"] ?? 0) >
          FORUM_PLUGIN_FILE_BYTES
        ) {
          response.destroy();
          reject(
            new ForumUploadError("Each attachment must be at most 5 MiB.", 413),
          );
          return;
        }
        let size = 0;
        const chunks: Uint8Array[] = [];
        response.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > FORUM_PLUGIN_FILE_BYTES) {
            response.destroy();
            reject(
              new ForumUploadError(
                "Each attachment must be at most 5 MiB.",
                413,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", () =>
          reject(
            new ForumUploadError(
              "Attachment download failed. Select the file again.",
              400,
            ),
          ),
        );
        response.on("end", () => {
          if (!size) {
            reject(new ForumUploadError("Attachment is empty.", 400));
            return;
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          resolve({
            bytes,
            contentType: (response.headers["content-type"] ?? "")
              .split(";", 1)[0]
              .trim()
              .toLowerCase(),
          });
        });
      },
    );
    request.on("error", () =>
      reject(
        new ForumUploadError(
          "Attachment download failed. Select the file again.",
          400,
        ),
      ),
    );
    request.end();
  });
}
export async function importForumPluginAttachments(
  request: Request,
  files: ForumPluginFile[],
  key: string,
  expectedPolicyVersion?: number,
): Promise<Response> {
  const authorization = forumPluginBearer(request);
  if (!authorization || !hasForumPluginAudience(authorization))
    return Response.json(
      { error: "Connect an authorized forum profile." },
      { status: 401 },
    );
  const site =
    process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!site)
    return Response.json(
      { error: "Forum backend is unavailable." },
      { status: 503 },
    );
  if (files.length < 1 || files.length > 5)
    return Response.json(
      { error: "Select one to five files." },
      { status: 400 },
    );
  const authorizationState = await relayForumPlugin(
    request,
    "status",
    {},
    authorization,
  );
  if (!authorizationState.ok) return authorizationState;
  const state = (await authorizationState.json().catch(() => null)) as {
    data?: { capabilities?: string[] };
  } | null;
  if (!state)
    return Response.json(
      { error: "Forum authorization returned an invalid response." },
      { status: 502 },
    );
  if (!state.data?.capabilities?.includes("attachments"))
    return Response.json(
      { error: "Enable attachment access in the connection consent." },
      { status: 403 },
    );
  const results: unknown[] = [];
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const downloaded = await downloadForumPluginFile(file.download_url);
      const filename = file.file_name?.trim() || `attachment-${index + 1}`;
      const contentType = forumAttachmentContentTypeForFile({
        name: filename,
        type: file.mime_type || downloaded.contentType,
      });
      if (!contentType)
        throw new ForumUploadError(
          "This attachment file type is not supported.",
          415,
        );
      const response = await fetch(
        `${site.replace(/\/$/, "")}/plugin/forum/attachments`,
        {
          method: "POST",
          headers: {
            "X-Symbaiex-Forum-OAuth": authorization.replace(/^Bearer\s+/i, ""),
            "Content-Type": contentType,
            "X-Forum-Attachment-Filename": encodeURIComponent(filename),
            "Idempotency-Key": `${key}:${index}`,
            ...(expectedPolicyVersion !== undefined
              ? {
                  "X-Forum-Plugin-Policy-Version": String(
                    expectedPolicyVersion,
                  ),
                }
              : {}),
          },
          body: downloaded.bytes.buffer as ArrayBuffer,
          signal: AbortSignal.timeout(20_000),
          redirect: "error",
          cache: "no-store",
        },
      );
      const result: unknown = await response.json();
      if (!response.ok)
        return Response.json(
          { error: result, completed: results },
          { status: response.status },
        );
      results.push(result);
    }
    const records = results as Array<{
      status: string;
      actingAs: unknown;
      data: unknown;
      commandId?: string;
      approvalUrl?: string;
      expiresAt?: number;
    }>;
    const pending = records.filter(
      (result) => result.status === "pending_approval",
    );
    return Response.json({
      status: pending.length ? "pending_approval" : "completed",
      actingAs: records[0].actingAs,
      data: {
        attachments: records
          .filter((result) => result.status === "completed")
          .map((result) => result.data),
        proposals: pending.map(({ commandId, approvalUrl, expiresAt }) => ({
          commandId,
          approvalUrl,
          expiresAt,
        })),
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ForumUploadError
            ? error.message
            : "Attachment import failed. Retry with the same command key.",
        completed: results,
      },
      { status: error instanceof ForumUploadError ? error.status : 502 },
    );
  }
}
