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

export class ForumHostBridge {
  private sequence = 0;
  private stopped = false;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
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
    target.addEventListener("message", this.onMessage);
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
  private onMessage = (event: MessageEvent) => {
    // Native webviews inject MessageEvents without a source/origin; browser
    // frames carry a WindowProxy and must still match our parent or self.
    const nativeDispatch = event.source === null && event.origin === "";
    if (event.source !== this.target.parent && event.source !== this.target && !nativeDispatch) return;
    const message = record(event.data);
    if (message.jsonrpc !== "2.0") return;
    // Request IDs are independent in each direction. A host health check may
    // use the same ID as our pending initialize request; it is not its reply.
    if (message.method === "ping" && (typeof message.id === "number" || typeof message.id === "string")) {
      this.target.parent.postMessage({ jsonrpc: "2.0", id: message.id, result: {} }, "*");
      return;
    }
    if (typeof message.method !== "string" && typeof message.id === "number" && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error)
        pending.reject(
          new Error(
            String(record(message.error).message ?? "Host request failed."),
          ),
        );
      else pending.resolve(message.result);
    } else if (message.method === "ui/notifications/host-context-changed")
      this.applyContext(message.params);
    else if (message.method === "ui/notifications/tool-result") {
      try {
        const value = unwrapToolResult(message.params);
        if (record(value.data).connectionId) this.acceptStatus(value);
        else this.target.dispatchEvent(new Event("forum:host-refresh"));
      } catch {
        void this.refreshStatus().catch(() => {});
      }
    } else if (message.method === "ui/resource-teardown") {
      if (message.id !== undefined)
        this.target.parent.postMessage(
          { jsonrpc: "2.0", id: message.id, result: {} },
          "*",
        );
      this.destroy();
    }
  };
  request(
    method: string,
    params: Json = {},
    timeout = 20_000,
  ): Promise<unknown> {
    if (this.stopped)
      return Promise.reject(new Error("Reopen the forum to continue."));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            "The host did not respond. Your draft is preserved; try again.",
          ),
        );
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.target.parent.postMessage(
        { jsonrpc: "2.0", id, method, params },
        "*",
      );
    });
  }
  notify(method: string, params: Json = {}) {
    if (!this.stopped)
      this.target.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
  }
  async connect() {
    try {
      const result = record(
        await this.request(
          "ui/initialize",
          {
            protocolVersion: "2026-01-26",
            appInfo: { name: "SYMBaiEX Forum", version: "2.2.2" },
            appCapabilities: { availableDisplayModes: ["fullscreen"] },
          },
          this.host.callTool ? 2000 : 20_000,
        ),
      );
      this.applyContext(result.hostContext);
      this.notify("ui/notifications/initialized");
      const context = record(result.hostContext);
      if (
        context.displayMode !== "fullscreen" &&
        Array.isArray(context.availableDisplayModes) &&
        context.availableDisplayModes.includes("fullscreen")
      )
        void this.request("ui/request-display-mode", {
          mode: "fullscreen",
        }).catch(() => {});
    } catch (error) {
      if (!this.host.callTool) throw error;
    }
    const launch = unwrapToolResult(this.host.toolOutput ?? {});
    if (record(launch.data).connectionId) this.acceptStatus(launch);
    else await this.refreshStatus();
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
    const authority = this.authority();
    const result = unwrapToolResult(
      this.host.callTool
        ? await this.host.callTool(name, args)
        : await this.request("tools/call", { name, arguments: args }),
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
    const target = new URL(url, "https://forum.symbaiex.com");
    if (!["https:", "http:"].includes(target.protocol))
      throw new Error("This link cannot be opened.");
    if (this.host.openExternal) this.host.openExternal({ href: target.href });
    else await this.request("ui/open-link", { url: target.href });
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
    this.stopped = true;
    this.target.removeEventListener("message", this.onMessage);
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error("Forum closed."));
    }
    this.pending.clear();
    this.listeners.clear();
  }
}
