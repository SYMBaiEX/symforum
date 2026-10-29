
import { FORUM_SITE_URL } from "../../../lib/site-urls";
import { App } from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import { JSONRPCMessageSchema, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ForumPluginResult } from "@/lib/forum-plugin-contract";
import type { ForumAttachmentDraft } from "../forum-compose";

type Json = Record<string, unknown>;
type OpenAIHost = {
  callTool?: (name: string, args: Json) => Promise<unknown>;
  toolOutput?: unknown;
  uploadFile?: (file: File) => Promise<{ fileId: string }>;
  getFileDownloadUrl?: (args: {
    fileId: string;
  }) => Promise<{ downloadUrl: string }>;
  openExternal?: (args: { href: string }) => void;
};
export const record = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
export function unwrapToolResult(value: unknown): ForumPluginResult {
  const result = record(value);
  const blocks = Array.isArray(result.content) ? result.content : [];
  const block = blocks
    .map(record)
    .find((item) => item.type === "text" && typeof item.text === "string");
  const payload = record(
    result.structuredContent ??
      (block ? JSON.parse(String(block.text)) : result),
  );
  if (result.isError || payload.error || payload.code) {
    const nested = record(payload.error);
    throw Object.assign(
      new Error(
        String(
          payload.error && typeof payload.error === "string"
            ? payload.error
            : (payload.message ??
                nested.message ??
                "The forum request failed."),
        ),
      ),
      { code: payload.code ?? nested.code },
    );
  }
  return payload as ForumPluginResult;
}

/** SDK transport with the source-less dispatch used by native webviews.
 * Browser frames must still be our parent; a foreign origin is never accepted.
 */
class ForumWindowTransport implements Transport {
  onmessage?: Transport["onmessage"];
  onerror?: Transport["onerror"];
  onclose?: Transport["onclose"];
  constructor(private target: Window) {}
  private receive = (event: MessageEvent) => {
    const native = event.source === null && event.origin === "";
    if (event.source !== this.target.parent && event.source !== this.target && !native) return;
    const parsed = JSONRPCMessageSchema.safeParse(event.data);
    if (parsed.success) this.onmessage?.(parsed.data);
    else this.onerror?.(new Error("Invalid forum host message."));
  };
  async start() { this.target.addEventListener("message", this.receive); }
  async send(message: JSONRPCMessage) { this.target.parent.postMessage(message, "*"); }
  async close() {
    this.target.removeEventListener("message", this.receive);
    this.onclose?.();
  }
}

export class ForumHostBridge {
  private stopped = false;
  private app: App;
  private transport: ForumWindowTransport;
  private connection?: Promise<void>;
  private hostInitialization?: Promise<void>;
  private launchReceived = false;
  private resolveLaunch?: () => void;
  private host: OpenAIHost;
  private listeners = new Set<() => void>();
  private uploads = new Map<
    string,
    {
      key: string;
      files: { file_id: string; file_name: string; mime_type: string }[];
      authority: string;
      policy: unknown;
    }
  >();
  authority() {
    return JSON.stringify([
      this.status.connectionId,
      record(this.status.actingAs).userId,
      this.status.policyVersion,
    ]);
  }
  status: Json = {};
  ready = false;
  constructor(private target: Window) {
    this.host = (target as Window & { openai?: OpenAIHost }).openai ?? {};
    this.transport = new ForumWindowTransport(target);
    this.app = new App(
      { name: "SYMBaiEX Forum", version: "2.2.3" },
      { availableDisplayModes: ["fullscreen"] },
      { autoResize: false },
    );
    // Bun isolates the same App 1.7.5 under two peer snapshots (Zod differs).
    // Runtime SDK version is identical; bridge the private-class type identity.
    new OpenAIExtensions(this.app as unknown as ConstructorParameters<typeof OpenAIExtensions>[0]);
    // Register before connect: the initial opener result follows initialized.
    this.app.ontoolresult = (result) => {
      this.launchReceived = true;
      this.resolveLaunch?.();
      try {
        const value = unwrapToolResult(result);
        if (record(value.data).connectionId) this.acceptStatus(value);
        else this.target.dispatchEvent(new Event("forum:host-refresh"));
      } catch {
        void this.refreshStatus().catch(() => {});
      }
    };
    this.app.onhostcontextchanged = (context) => this.applyContext(context);
    this.app.ontoolcancelled = () => this.target.dispatchEvent(new Event("forum:host-refresh"));
    this.app.onteardown = async () => {
      // Let the SDK acknowledge before closing its transport.
      setTimeout(() => this.destroy(), 0);
      return {};
    };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  private applyContext(value: unknown) {
    const context = record(value);
    if (context.theme === "dark" || context.theme === "light") {
      this.target.document.documentElement.dataset.theme = context.theme;
      this.target.document.documentElement.classList.toggle(
        "dark",
        context.theme === "dark",
      );
      this.target.dispatchEvent(
        new CustomEvent("forum:host-theme", { detail: context.theme }),
      );
    }
    const path = record(context["openai/deepLink"]).url;
    if (
      typeof path === "string" &&
      path.startsWith("/") &&
      !path.startsWith("//")
    )
      this.target.dispatchEvent(
        new CustomEvent("forum:host-route", { detail: path }),
      );
  }
  notify(method: string, params: Json = {}) {
    if (!this.stopped && this.app.getHostCapabilities() && method === "ui/notifications/size-changed")
      void this.app.sendSizeChanged({ width: Number(params.width), height: Number(params.height) }).catch(() => {});
  }
  connect() {
    return this.connection ??= this.initialize();
  }
  private ensureHost() {
    return this.hostInitialization ??= this.app.connect(this.transport, {
      timeout: this.host.callTool ? 2000 : 20_000,
    });
  }
  private async initialize() {
    try {
      await this.ensureHost();
      const context = this.app.getHostContext();
      this.applyContext(context);
      if (context?.displayMode !== "fullscreen" && context?.availableDisplayModes?.includes("fullscreen"))
        void this.app.requestDisplayMode({ mode: "fullscreen" }).catch(() => {});
      // Use the host's launch result instead of immediately duplicating forum_status.
      if (!this.launchReceived && !this.host.toolOutput) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await new Promise<void>((resolve) => {
          this.resolveLaunch = resolve;
          timer = setTimeout(resolve, 1000);
        });
        clearTimeout(timer);
        this.resolveLaunch = undefined;
      }
    } catch (error) {
      if (!this.host.callTool) throw error;
    }
    if (!this.status.connectionId) {
      const launch = unwrapToolResult(this.host.toolOutput ?? {});
      if (record(launch.data).connectionId) this.acceptStatus(launch);
      else await this.refreshStatus();
    }
    if (this.stopped) throw new Error("Reopen the forum to continue.");
    this.ready = true;
    this.emit();
  }
  acceptStatus(result: ForumPluginResult) {
    const previous = JSON.stringify([
      this.status.connectionId,
      this.status.actingAs,
      this.status.policyVersion,
      this.status.capabilities,
    ]);
    this.status = {
      ...record(result.data),
      actingAs: result.actingAs ?? record(result.data).actingAs,
    };
    this.emit();
    const next = JSON.stringify([
      this.status.connectionId,
      this.status.actingAs,
      this.status.policyVersion,
      this.status.capabilities,
    ]);
    if (previous !== next)
      this.target.dispatchEvent(new Event("forum:host-identity"));
  }
  async refreshStatus() {
    try {
      this.acceptStatus(await this.tool("forum_status", {}));
    } catch (error) {
      if (
        !/AUTH|CONNECTION|TOKEN|GRANT|UNAUTHORIZED/i.test(
          String(record(error).code ?? "") + String(error),
        )
      )
        throw error;
      this.acceptStatus({ status: "completed", actingAs: null, data: {} });
    }
  }
  async tool(name: string, args: Json) {
    if (this.stopped) throw new Error("Reopen the forum to continue.");
    if (!this.host.callTool) {
      // Child effects can run before the root connects. Wait for the launch
      // identity too; the bootstrap status call must not await itself.
      if (!this.ready && name !== "forum_status") await this.connect();
      await this.ensureHost();
    }
    if (this.stopped) throw new Error("Reopen the forum to continue.");
    const authority = this.authority();
    const result = unwrapToolResult(
      this.host.callTool
        ? await this.host.callTool(name, args)
        : await this.app.callServerTool({ name, arguments: args }, { timeout: 20_000 }),
    );
    if (
      authority !== this.authority() &&
      typeof args.idempotencyKey !== "string"
    )
      throw new Error(
        "The acting profile changed. Refresh this page to load the current profile.",
      );
    return result;
  }
  async openLink(url: string) {
    const target = new URL(url, FORUM_SITE_URL);
    if (!["https:", "http:"].includes(target.protocol))
      throw new Error("This link cannot be opened.");
    if (this.host.openExternal) this.host.openExternal({ href: target.href });
    else {
      await this.ensureHost();
      await this.app.openLink({ url: target.href });
    }
  }
  async uploadFiles(files: File[]): Promise<ForumAttachmentDraft[]> {
    if (!this.host.uploadFile || !this.host.getFileDownloadUrl)
      throw new Error(
        "This host does not offer file uploads. Attach files in ChatGPT and ask your agent to include them.",
      );
    if (
      !files.length ||
      files.length > 5 ||
      files.some((file) => file.size > 5 * 1024 * 1024)
    )
      throw new Error("Choose up to five files, each at most 5 MiB.");
    const fingerprint = JSON.stringify(
      await Promise.all(
        files.map(async (file) => [
          file.name,
          file.size,
          file.type,
          Array.from(
            new Uint8Array(
              await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
            ),
          )
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join(""),
        ]),
      ),
    );
    let command = this.uploads.get(fingerprint);
    if (!command) {
      const authority = this.authority();
      const policy = this.status.policyVersion;
      const uploaded = [];
      for (const file of files) {
        const { fileId } = await this.host.uploadFile(file);
        uploaded.push({
          file_id: fileId,
          file_name: file.name,
          mime_type: file.type,
        });
      }
      command = {
        key: crypto.randomUUID(),
        files: uploaded,
        authority,
        policy,
      };
      this.uploads.set(fingerprint, command);
    }
    if (command.authority !== this.authority())
      throw new Error(
        "The acting profile or permissions changed. Reopen the composer before uploading.",
      );
    const parameters = await Promise.all(
      command.files.map(async (file) => ({
        ...file,
        download_url: (
          await this.host.getFileDownloadUrl!({ fileId: file.file_id })
        ).downloadUrl,
      })),
    );
    const result = await this.tool("forum_upload_attachments", {
      files: parameters,
      idempotencyKey: command.key,
      expectedPolicyVersion: command.policy,
    });
    if (result.status === "pending_approval")
      throw new Error(
        "Files are awaiting owner approval. Keep this draft and retry after approval in Agent access.",
      );
    const attachments = record(result.data).attachments;
    if (
      !Array.isArray(attachments) ||
      attachments.length !== files.length ||
      attachments.some(
        (file) => !record(file).storageId || !record(file).filename,
      )
    )
      throw new Error(
        "Some attachments are unavailable. Keep this draft and retry.",
      );
    this.uploads.delete(fingerprint);
    return attachments as ForumAttachmentDraft[];
  }
  destroy() {
    if (this.stopped) return;
    this.stopped = true;
    this.resolveLaunch?.();
    void this.app.close();
    this.listeners.clear();
  }
}
