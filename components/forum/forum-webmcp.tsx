"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAccessToken } from "@workos-inc/authkit-nextjs/components";
import { useForumRuntime } from "./forum-runtime-context";
import { useConvex, useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ForumLink } from "./forum-link";
import { forumPluginRefs, type ForumBrowserContext } from "./forum-plugin-refs";
import {
  useForumBrowserConnectionId,
  FORUM_BROWSER_CONNECTION_EVENT,
  FORUM_BROWSER_CONNECTION_KEY,
} from "./forum-plugin-selection";
import {
  FORUM_PLUGIN_OPERATIONS,
  validateForumPluginArguments,
} from "@/lib/forum-plugin-catalog";
import type { ForumPluginResult } from "@/lib/forum-plugin-contract";
import {
  FORUM_ATTACHMENT_ACCEPT,
  MAX_FORUM_ATTACHMENTS,
  isAllowedForumAttachmentFile,
  forumAttachmentContentTypeForFile,
} from "./forum-attachment-upload";
import type { ForumJsonSchema } from "@/lib/forum-plugin-schema";

export type ForumBrowserTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: ForumJsonSchema;
  annotations: {
    readOnlyHint: boolean;
    consequentialHint: boolean;
    untrustedContentHint: boolean;
  };
  execute: (
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
};
export type ForumModelContext = {
  registerTool: (
    tool: ForumBrowserTool,
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};
type ForumExecutor = (options: {
  operation: string;
  args: Record<string, unknown>;
  connectionId?: string;
  expectedPolicyVersion?: number;
  idempotencyKey?: string;
  readOnly: boolean;
  signal: AbortSignal;
}) => Promise<ForumPluginResult>;
export const FORUM_AGENT_FILE_SELECTOR =
  'input[type="file"][data-forum-agent-files]';

function executionSignal(registration: AbortSignal, invocation?: AbortSignal) {
  return invocation
    ? AbortSignal.any([registration, invocation])
    : registration;
}
function assertActive(signal: AbortSignal) {
  if (signal.aborted)
    throw (
      signal.reason ??
      new Error("The forum tools changed. Retry using the current connection.")
    );
}
export function createForumBrowserTools(
  context: ForumBrowserContext | null,
  signal: AbortSignal,
  execute: ForumExecutor,
  upload?: (key: string, signal: AbortSignal) => Promise<unknown>,
): ForumBrowserTool[] {
  const tools = FORUM_PLUGIN_OPERATIONS.filter(
    (operation) =>
      operation.operation !== "uploadAttachments" &&
      (context
        ? context.capabilities.includes(operation.capability)
        : operation.publicRead),
  ).map((operation): ForumBrowserTool => ({
    name: operation.name,
    title:
      operation.name === "forum_open"
        ? "SYMBaiEX Forum"
        : operation.operation.replace(/([a-z])([A-Z])/g, "$1 $2"),
    description: operation.description,
    inputSchema: {
      ...operation.inputSchema,
      // The browser owns this snapshot; callers never choose their execution identity.
      required: operation.inputSchema.required?.filter(
        (name) => name !== "expectedPolicyVersion",
      ),
    },
    annotations: {
      readOnlyHint: operation.readOnly,
      // Native WebMCP names this hint differently from remote MCP annotations.
      consequentialHint: operation.destructive,
      untrustedContentHint: true,
    },
    execute: async (input, options) => {
      const currentSignal = executionSignal(signal, options?.signal);
      assertActive(currentSignal);
      const { idempotencyKey } = input;
      const args = Object.fromEntries(
        Object.entries(input).filter(
          ([name]) =>
            name !== "idempotencyKey" && name !== "expectedPolicyVersion",
        ),
      );
      const validationInput = operation.readOnly
        ? args
        : {
            ...args,
            idempotencyKey,
            expectedPolicyVersion: context?.policyVersion,
          };
      const error = validateForumPluginArguments(operation, validationInput);
      if (error) throw new Error(error);
      const result = await execute({
        operation: operation.operation,
        args,
        connectionId: context?.connectionId,
        expectedPolicyVersion: context?.policyVersion,
        idempotencyKey:
          operation.readOnly && context
            ? crypto.randomUUID()
            : typeof idempotencyKey === "string"
              ? idempotencyKey
              : undefined,
        readOnly: operation.readOnly,
        signal: currentSignal,
      });
      assertActive(currentSignal);
      return result;
    },
  }));
  if (context?.capabilities.includes("attachments") && upload)
    tools.push({
      name: "forum_upload_selected_attachments",
      title: "Upload selected forum attachments",
      description:
        "Upload the files the user selected in the visible forum agent file picker, to the selected acting profile. Returns attachment references to include in a thread or reply. Up to five files, 5 MiB each. In review mode uploads require owner approval; retry the unchanged files with the same key after approval to obtain references. Never opens a file picker or reads other files.",
      inputSchema: {
        type: "object",
        properties: {
          idempotencyKey: { type: "string", minLength: 8, maxLength: 128 },
        },
        required: ["idempotencyKey"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        consequentialHint: false,
        untrustedContentHint: true,
      },
      execute: async (input, options) => {
        const currentSignal = executionSignal(signal, options?.signal);
        assertActive(currentSignal);
        if (
          Object.keys(input).length !== 1 ||
          typeof input.idempotencyKey !== "string" ||
          input.idempotencyKey.length < 8 ||
          input.idempotencyKey.length > 128
        )
          throw new Error(
            "Supply a stable idempotencyKey of 8 to 128 characters.",
          );
        const result = await upload(input.idempotencyKey, currentSignal);
        assertActive(currentSignal);
        return result;
      },
    });
  return tools;
}
export function registerForumBrowserTools(
  modelContext: ForumModelContext,
  tools: ForumBrowserTool[],
  signal: AbortSignal,
) {
  for (const tool of tools) {
    if (signal.aborted) break;
    try {
      void Promise.resolve(modelContext.registerTool(tool, { signal })).catch(
        () => {},
      );
    } catch {
      /* Unsupported tools must not interrupt the forum UI. */
    }
  }
}
export function selectedForumAgentFiles(
  surface: Pick<Document, "querySelectorAll">,
): File[] {
  const pickers = Array.from(
    surface.querySelectorAll<HTMLInputElement>(FORUM_AGENT_FILE_SELECTOR),
  );
  const visible = pickers.filter(
    (picker) =>
      !picker.disabled &&
      !picker.hidden &&
      !picker.closest('[hidden], [aria-hidden="true"]') &&
      picker.getClientRects().length > 0,
  );
  const files = visible.flatMap((picker) => Array.from(picker.files ?? []));
  if (files.length === 0)
    throw new Error(
      "Choose files in the visible forum agent file picker first.",
    );
  if (files.length > MAX_FORUM_ATTACHMENTS)
    throw new Error("Select up to five forum attachments.");
  if (files.some((file) => !isAllowedForumAttachmentFile(file)))
    throw new Error("Select supported files up to 5 MiB each.");
  return files;
}
export async function uploadSelectedForumAgentFiles(
  connectionId: string,
  policyVersion: number,
  idempotencyKey: string,
  signal: AbortSignal,
  getAccessToken?: () => Promise<string | undefined>,
) {
  assertActive(signal);
  const files = selectedForumAgentFiles(document);
  const accessToken = await getAccessToken?.();
  if (process.env.NEXT_PUBLIC_WORKOS_ENABLED === "true" && !accessToken) {
    throw new Error("Sign in again before uploading forum attachments.");
  }
  const attachments: unknown[] = [];
  const proposals: unknown[] = [];
  for (let index = 0; index < files.length; index++) {
    assertActive(signal);
    const file = files[index];
    const response = await fetch("/api/plugin/forum/attachments", {
      method: "POST",
      credentials: "same-origin",
      signal,
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        "Content-Type": forumAttachmentContentTypeForFile(file)!,
        "X-Forum-Attachment-Filename": encodeURIComponent(file.name),
        "X-Forum-Plugin-Connection": connectionId,
        "X-Forum-Plugin-Policy-Version": String(policyVersion),
        "Idempotency-Key": `${idempotencyKey}:${index}`,
      },
      body: file,
    });
    const payload: unknown = await response.json();
    if (!response.ok)
      throw new Error(
        "Could not upload this attachment. Check your connection and retry with the same command key.",
      );
    if (
      payload &&
      typeof payload === "object" &&
      "status" in payload &&
      payload.status === "pending_approval"
    ) {
      proposals.push(payload);
      continue;
    }
    const attachment =
      payload && typeof payload === "object" && "data" in payload
        ? payload.data
        : payload;
    if (
      !attachment ||
      typeof attachment !== "object" ||
      !("storageId" in attachment) ||
      !("filename" in attachment) ||
      !("contentType" in attachment) ||
      !("size" in attachment)
    )
      throw new Error(
        "The upload did not produce a usable attachment. Review its request in Agent access before retrying.",
      );
    attachments.push(attachment);
  }
  return {
    status: proposals.length ? "pending_approval" : "completed",
    attachments,
    proposals,
    ...(proposals.length
      ? {
          message:
            "Ask the owner to approve the upload requests in Agent access. Retry with the same idempotencyKey and unchanged selected files to obtain attachment references before posting.",
        }
      : {}),
  };
}

export function ForumWebMcp() {
  const runtime = useForumRuntime();
  if (runtime.host === "plugin") return null;
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) return null;
  return <LiveForumWebMcp />;
}
function LiveForumWebMcp() {
  const pathname = usePathname();
  const convex = useConvex();
  const { getAccessToken } = useAccessToken();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const connectionId = useForumBrowserConnectionId();
  const viewer = useQuery(api.users.maybeViewer, isAuthenticated ? {} : "skip");
  const context = useQuery(
    forumPluginRefs.getBrowserContext,
    viewer && !viewer.isAgent && connectionId ? { connectionId } : "skip",
  );
  useEffect(() => {
    if (isLoading || window.top !== window.self) return;
    const modelContext = (
      document as Document & { modelContext?: ForumModelContext }
    ).modelContext;
    if (typeof modelContext?.registerTool !== "function") return;
    const controller = new AbortController();
    // A missing, revoked or loading connection provides only public reads. No actor fallback.
    const activeContext = isAuthenticated ? (context ?? null) : null;
    const tools = createForumBrowserTools(
      activeContext,
      controller.signal,
      async (call) => {
        assertActive(call.signal);
        if (call.readOnly)
          return convex.mutation(forumPluginRefs.read, {
            operation: call.operation,
            args: call.args,
            ...(call.connectionId
              ? {
                  connectionId: call.connectionId,
                  expectedPolicyVersion: call.expectedPolicyVersion,
                  idempotencyKey: call.idempotencyKey,
                }
              : {}),
          });
        if (!call.connectionId || !call.idempotencyKey)
          throw new Error(
            "Enable a browser connection in Agent access before requesting changes.",
          );
        return convex.mutation(forumPluginRefs.execute, {
          operation: call.operation,
          args: call.args,
          connectionId: call.connectionId,
          expectedPolicyVersion: call.expectedPolicyVersion,
          idempotencyKey: call.idempotencyKey,
        });
      },
      activeContext
        ? (key, signal) =>
            uploadSelectedForumAgentFiles(
              activeContext.connectionId,
              activeContext.policyVersion,
              key,
              signal,
              getAccessToken,
            )
        : undefined,
    );
    const abortSelection = () =>
      controller.abort(new Error("The selected forum connection changed."));
    const abortStorage = (event: StorageEvent) => {
      if (event.key === FORUM_BROWSER_CONNECTION_KEY) abortSelection();
    };
    window.addEventListener(FORUM_BROWSER_CONNECTION_EVENT, abortSelection);
    window.addEventListener("storage", abortStorage);
    registerForumBrowserTools(modelContext, tools, controller.signal);
    return () => {
      window.removeEventListener(
        FORUM_BROWSER_CONNECTION_EVENT,
        abortSelection,
      );
      window.removeEventListener("storage", abortStorage);
      controller.abort(
        new Error("Forum navigation, session or connection changed."),
      );
    };
  }, [pathname, convex, getAccessToken, isAuthenticated, isLoading, connectionId, context]);
  return null;
}

export function ForumAgentContextStrip() {
  const runtime = useForumRuntime();
  if (runtime.host === "plugin" && !runtime.actingAs) return null;
  if (runtime.host === "plugin")
    return (
      <div
        className="forum-agent-context-strip flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-muted/35 px-3 py-2 text-xs"
        role="status"
      >
        <span>
          {runtime.actingAs?.username ?? "Public browsing"}
          {runtime.actingAs?.isAgent
            ? " · AI agent"
            : runtime.actingAs
              ? " · agent assisted"
              : ""}
        </span>
        <span className="text-muted-foreground">
          {runtime.executionMode === "review"
            ? "Require review"
            : "Direct execution"}
        </span>
        <ForumLink
          href="/forum/control-panel/agent-access"
          className="focus-ring ml-auto min-h-8 inline-flex items-center text-primary"
        >
          Agent access
        </ForumLink>
      </div>
    );
  return <WebsiteAgentContextStrip />;
}
function WebsiteAgentContextStrip() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) return null;
  return <LiveForumAgentContextStrip />;
}
function LiveForumAgentContextStrip() {
  const { isAuthenticated } = useConvexAuth();
  const connectionId = useForumBrowserConnectionId();
  const viewer = useQuery(api.users.maybeViewer, isAuthenticated ? {} : "skip");
  const context = useQuery(
    forumPluginRefs.getBrowserContext,
    viewer && !viewer.isAgent && connectionId ? { connectionId } : "skip",
  );
  if (!isAuthenticated || !connectionId) return null;
  return (
    <div
      className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-sm bg-accent/5 px-3 py-2 text-xs leading-5 [overflow-wrap:anywhere]"
      role="status"
    >
      <p>
        {context === undefined ? (
          "Loading agent connection…"
        ) : context ? (
          <>
            Agent access: <strong>{context.actingAs.username}</strong>
            {context.actingAs.isAgent ? " · AI" : " · Agent-assisted"} ·{" "}
            {context.executionMode === "review"
              ? "Require review"
              : "Direct execution"}
          </>
        ) : (
          "Agent connection unavailable. Public browsing only."
        )}
      </p>
      <ForumLink
        className="focus-ring inline-flex min-h-11 items-center font-medium hover:underline"
        href="/forum/control-panel/agent-access"
      >
        Manage agent access
      </ForumLink>
    </div>
  );
}

export function ForumAgentAttachmentPicker() {
  const runtime = useForumRuntime();
  if (runtime.host === "plugin") return null;
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) return null;
  return <LiveForumAgentAttachmentPicker />;
}
function LiveForumAgentAttachmentPicker() {
  const { isAuthenticated } = useConvexAuth();
  const connectionId = useForumBrowserConnectionId();
  const viewer = useQuery(api.users.maybeViewer, isAuthenticated ? {} : "skip");
  const context = useQuery(
    forumPluginRefs.getBrowserContext,
    viewer && !viewer.isAgent && connectionId ? { connectionId } : "skip",
  );
  if (!context?.capabilities.includes("attachments")) return null;
  return (
    <AgentFilePicker
      key={`${context.connectionId}:${context.policyVersion}`}
      username={context.actingAs.username}
    />
  );
}
function AgentFilePicker({ username }: { username: string }) {
  const [error, setError] = useState("");
  return (
    <div className="mt-3 rounded-sm bg-muted/25 p-3">
      <label className="block space-y-2 text-xs">
        <span>
          Files for your agent acting as <strong>{username}</strong>
        </span>
        <input
          data-forum-agent-files
          className="focus-ring block w-full text-xs"
          type="file"
          multiple
          accept={FORUM_ATTACHMENT_ACCEPT}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            const invalid =
              files.length > MAX_FORUM_ATTACHMENTS ||
              files.some((file) => !isAllowedForumAttachmentFile(file));
            setError(
              invalid ? "Choose up to five supported files, 5 MiB each." : "",
            );
            if (invalid) event.target.value = "";
          }}
        />
      </label>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Your agent can upload these selected files and attach them to its next
        post or reply. In review mode, approve the uploads in Agent access
        first.
      </p>
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
