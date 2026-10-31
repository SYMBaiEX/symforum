"use client";

import { ForumAgentAttachmentPicker } from "./forum-webmcp";

import { Button } from "@/components/ui/button";
import { type ForumAttachmentInput } from "@/components/forum/forum-refs";
import {
  FORUM_ATTACHMENT_ACCEPT,
  MAX_FORUM_ATTACHMENTS,
  forumAttachmentContentTypeForFile,
  isAllowedForumAttachmentFile,
} from "@/components/forum/forum-attachment-upload";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { usePlatformAuthToken as useAuthToken } from "@symbaiex/auth/token";
import { useForumRuntime } from "./forum-runtime-context";
import {
  BarChart3,
  Bold,
  Code2,
  EyeOff,
  GitCompareArrows,
  Heading2,
  ImageIcon,
  Info,
  Italic,
  LinkIcon,
  List,
  ListOrdered,
  Minus,
  Paperclip,
  Quote,
  Smile,
  Strikethrough,
  Table2,
  Underline,
  Upload,
  Workflow,
  X,
} from "lucide-react";
import {
  useImperativeHandle,
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type Ref,
  type ReactNode,
} from "react";

export type ForumAttachmentDraft = ForumAttachmentInput & {
  contentType: string;
  size: number;
};

type ForumAttachmentUploadResponse = ForumAttachmentDraft & {
  error?: string;
};

const FORUM_DRAFT_SCHEMA_VERSION = 1;
type StoredForumDraft = {
  body?: string;
  title?: string;
  data?: Record<string, string>;
};
type DraftProtectionReason =
  "version" | "malformed" | "unavailable" | "changed";
type ProtectedForumDraft = {
  key: string;
  scope: string;
  raw: string | null;
  reason: DraftProtectionReason;
};
function readForumDraft(
  raw: string,
):
  | { kind: "ready"; draft: StoredForumDraft }
  | { kind: "version" | "malformed" } {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { kind: "malformed" };
    const draft = value as Record<string, unknown>;
    if (
      draft.version !== undefined &&
      draft.version !== FORUM_DRAFT_SCHEMA_VERSION
    )
      return { kind: "version" };
    if (
      (draft.body !== undefined && typeof draft.body !== "string") ||
      (draft.title !== undefined && typeof draft.title !== "string") ||
      (draft.data !== undefined &&
        (!draft.data ||
          typeof draft.data !== "object" ||
          Array.isArray(draft.data) ||
          !Object.values(draft.data).every(
            (value) => typeof value === "string",
          )))
    )
      return { kind: "malformed" };
    return { kind: "ready", draft: draft as StoredForumDraft };
  } catch {
    return { kind: "malformed" };
  }
}

export function ForumCompose({
  body,
  bodyAriaDescribedBy,
  bodyAriaInvalid,
  bodyMaxLength,
  bodyTextareaRef,
  bodyPlaceholder,
  bodyTemplate,
  bodyRows = 7,
  bodyLabel,
  children,
  disabled = false,
  draftKey,
  draftData,
  onDraftDataChange,
  error,
  errorId,
  footerActions,
  note,
  pending = false,
  pendingLabel = "Posting...",
  submitLabel,
  title,
  titleLabel,
  titlePlaceholder,
  onBodyChange,
  onSubmit,
  onTitleChange,
}: {
  body: string;
  bodyAriaDescribedBy?: string;
  bodyAriaInvalid?: boolean;
  bodyLabel: string;
  bodyMaxLength?: number;
  bodyPlaceholder: string;
  bodyTemplate?: string;
  bodyTextareaRef?: Ref<HTMLTextAreaElement>;
  bodyRows?: number;
  children?: ReactNode;
  disabled?: boolean;
  draftKey?: string;
  draftData?: Record<string, string>;
  onDraftDataChange?: (data: Record<string, string>) => void;
  error?: string;
  errorId?: string;
  footerActions?: ReactNode;
  note?: string;
  pending?: boolean;
  pendingLabel?: string;
  submitLabel: string;
  title?: string;
  titleLabel?: string;
  titlePlaceholder?: string;
  onBodyChange: (value: string) => void;
  onSubmit: () => void | boolean | Promise<void | boolean>;
  onTitleChange?: (value: string) => void;
}) {
  const bodyInputId = useId();
  const generatedErrorId = useId();
  const resolvedErrorId = errorId ?? generatedErrorId;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle(bodyTextareaRef, () => textareaRef.current!, []);
  const bodyDescription =
    Array.from(
      new Set(
        [bodyAriaDescribedBy, error ? resolvedErrorId : undefined].filter(
          Boolean,
        ),
      ),
    ).join(" ") || undefined;
  const controlsDisabled = disabled || pending;
  const runtime = useForumRuntime();
  // Callers supply owner/route-bound storage keys. Acting-profile changes also
  // fence local recovery controls; no auth requests or new storage keys are used.
  const draftScope = `${runtime.host}:${runtime.actingAs?.userId ?? "human"}:${draftKey ?? ""}`;
  const activeDraft = useRef({ scope: draftScope, disabled: controlsDisabled });
  useLayoutEffect(() => {
    activeDraft.current = { scope: draftScope, disabled: controlsDisabled };
  });
  const [hydratedDraftKey, setHydratedDraftKey] = useState<
    string | undefined
  >();
  const loadedDraftKey = useRef<string | undefined>(undefined);
  const [draftSaved, setDraftSaved] = useState(false);
  const protectedDraftRef = useRef<ProtectedForumDraft | null>(null);
  const [protectedDraft, setProtectedDraft] =
    useState<ProtectedForumDraft | null>(null);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const protection =
    protectedDraft?.scope === draftScope ? protectedDraft : null;
  const protectDraft = useCallback(
    (raw: string | null, reason: DraftProtectionReason) => {
      if (!draftKey) return;
      const record = { key: draftKey, scope: draftScope, raw, reason };
      protectedDraftRef.current = record;
      setProtectedDraft(record);
      setReplaceConfirmed(false);
      setDraftSaved(false);
    },
    [draftKey, draftScope],
  );
  const titleEnabled =
    typeof title === "string" && typeof onTitleChange === "function";

  useEffect(() => {
    if (!draftKey || loadedDraftKey.current === draftScope) return;
    loadedDraftKey.current = draftScope;
    protectedDraftRef.current = null;
    setProtectedDraft(null);
    setReplaceConfirmed(false);
    setRecoveryMessage("");
    let restoredBody = false;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(draftKey);
      if (raw !== null) {
        const parsed = readForumDraft(raw);
        if (parsed.kind !== "ready") {
          protectDraft(raw, parsed.kind);
          return;
        }
        const draft = parsed.draft;
        if (
          draft.data &&
          Object.values(draft.data).every((value) => typeof value === "string")
        )
          onDraftDataChange?.(draft.data);
        if (body.trim().length === 0 && typeof draft.body === "string") {
          restoredBody = true;
          onBodyChange(draft.body);
        }
        if (
          titleEnabled &&
          title?.trim().length === 0 &&
          typeof draft.title === "string"
        ) {
          onTitleChange?.(draft.title);
        }
      }
    } catch {
      protectDraft(raw, "unavailable");
      // Storage can be unavailable in private or sandboxed browsers.
    } finally {
      if (
        !protectedDraftRef.current &&
        !restoredBody &&
        body.trim().length === 0 &&
        bodyTemplate
      ) {
        onBodyChange(bodyTemplate);
      }
      setHydratedDraftKey(draftScope);
    }
  }, [
    body,
    bodyTemplate,
    draftKey,
    draftScope,
    protectDraft,
    onBodyChange,
    onTitleChange,
    title,
    titleEnabled,
    onDraftDataChange,
  ]);

  const canWriteStoredDraft = useCallback(() => {
    if (
      !draftKey ||
      activeDraft.current.scope !== draftScope ||
      protectedDraftRef.current?.scope === draftScope
    )
      return false;
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (raw !== null) {
        const parsed = readForumDraft(raw);
        if (parsed.kind !== "ready") {
          protectDraft(raw, parsed.kind);
          return false;
        }
      }
      return true;
    } catch {
      protectDraft(null, "unavailable");
      return false;
    }
  }, [draftKey, draftScope, protectDraft]);

  useEffect(() => {
    if (
      !draftKey ||
      hydratedDraftKey !== draftScope ||
      protectedDraftRef.current?.scope === draftScope
    ) {
      return;
    }
    // A different tab may have saved a newer schema after initial hydration.
    // Check immediately before either ordinary autosave write/removal.
    if (!canWriteStoredDraft()) return;
    try {
      if (
        body.trim().length === 0 &&
        (!titleEnabled || title?.trim().length === 0)
      ) {
        window.localStorage.removeItem(draftKey);
        setDraftSaved(false);
        return;
      }
      window.localStorage.setItem(
        draftKey,
        JSON.stringify({
          version: FORUM_DRAFT_SCHEMA_VERSION,
          body,
          ...(draftData ? { data: draftData } : {}),
          ...(titleEnabled ? { title } : {}),
          savedAt: Date.now(),
        }),
      );
      setDraftSaved(true);
    } catch {
      setDraftSaved(false);
      // Storage can be unavailable in private or sandboxed browsers.
    }
  }, [
    body,
    hydratedDraftKey,
    draftKey,
    draftScope,
    title,
    titleEnabled,
    draftData,
    canWriteStoredDraft,
  ]);

  function currentProtectedDraft() {
    const record = protectedDraftRef.current;
    if (
      !record ||
      record.scope !== draftScope ||
      record.key !== draftKey ||
      activeDraft.current.scope !== record.scope ||
      activeDraft.current.disabled
    )
      return null;
    try {
      const raw = window.localStorage.getItem(record.key);
      if (raw !== record.raw) {
        protectDraft(raw, "changed");
        setRecoveryMessage(
          "The saved copy changed. Nothing was replaced. Review or download the current copy before confirming again.",
        );
        return null;
      }
      return record;
    } catch {
      setRecoveryMessage(
        "Local storage is unavailable. Nothing was replaced or downloaded.",
      );
      return null;
    }
  }
  function downloadProtectedDraft() {
    const record = currentProtectedDraft();
    if (!record || record.raw === null) return;
    const json = record.reason === "version";
    const url = URL.createObjectURL(
      new Blob([record.raw], {
        type: json ? "application/json" : "text/plain;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = json ? "forum-draft-backup.json" : "forum-draft-backup.txt";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  function replaceProtectedDraft() {
    if (!replaceConfirmed || controlsDisabled) return;
    const record = currentProtectedDraft();
    if (!record) return;
    try {
      window.localStorage.setItem(
        record.key,
        JSON.stringify({
          version: FORUM_DRAFT_SCHEMA_VERSION,
          body,
          ...(draftData ? { data: draftData } : {}),
          ...(titleEnabled ? { title } : {}),
          savedAt: Date.now(),
        }),
      );
      protectedDraftRef.current = null;
      setProtectedDraft(null);
      setReplaceConfirmed(false);
      setRecoveryMessage("");
      setDraftSaved(true);
    } catch {
      setRecoveryMessage(
        "Could not replace the saved draft. Keep a backup and try again when local storage is available.",
      );
    }
  }

  async function submitWithDraftCleanup() {
    if (controlsDisabled) return;
    const submitted = await onSubmit();
    if (
      draftKey &&
      submitted === true &&
      activeDraft.current.scope === draftScope &&
      protectedDraftRef.current?.scope !== draftScope
    ) {
      if (!canWriteStoredDraft()) return;
      try {
        window.localStorage.removeItem(draftKey);
      } catch {
        // Ignore storage cleanup failures after a successful post.
      }
    }
  }
  function appendMarkup(open: string, close: string, sample: string) {
    if (controlsDisabled) return;
    const input = textareaRef.current;
    if (!input) {
      onBodyChange(
        `${body.trimEnd()}${body.length ? "\n\n" : ""}${open}${sample}${close}`,
      );
      return;
    }
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selected = body.slice(start, end) || sample;
    onBodyChange(
      `${body.slice(0, start)}${open}${selected}${close}${body.slice(end)}`,
    );
    window.requestAnimationFrame(() => {
      if (!input.isConnected || input.disabled) return;
      input.focus();
      input.setSelectionRange(
        start + open.length,
        start + open.length + selected.length,
      );
    });
  }

  return (
    <div className="forum-composer forum-panel min-w-0" aria-busy={pending}>
      {protection && (
        <section
          className="mb-3 rounded-xl border border-border p-3 text-sm"
          aria-label="Saved draft recovery"
        >
          <h3>Saved draft protected</h3>
          <p>
            {protection.reason === "version"
              ? "This saved draft uses an unsupported format."
              : protection.reason === "unavailable"
                ? "The saved draft could not be read from local storage."
                : protection.reason === "changed"
                  ? "The saved copy changed while you were editing."
                  : "The saved draft could not be read safely."}{" "}
            This editor has not overwritten the saved copy. Current editor text
            is not being saved over it.
          </p>
          <p>
            Download a local backup before replacing it. Replacement permanently
            overwrites the saved copy with the current editor text; it does not
            publish a post.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={controlsDisabled || protection.raw === null}
              onClick={downloadProtectedDraft}
            >
              Download saved draft
            </Button>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={replaceConfirmed}
                disabled={controlsDisabled}
                onChange={(event) => setReplaceConfirmed(event.target.checked)}
              />
              I understand replacement overwrites the saved copy.
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={controlsDisabled || !replaceConfirmed}
              onClick={replaceProtectedDraft}
            >
              Replace saved draft with current text
            </Button>
          </div>
          {recoveryMessage && <p role="status">{recoveryMessage}</p>}
        </section>
      )}
      {titleEnabled ? (
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">
            {titleLabel ?? "Title"}
          </span>
          <Input
            disabled={controlsDisabled}
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder={titlePlaceholder}
            className="mt-2 min-h-12 rounded-xl border border-input bg-background px-3 text-base focus-visible:ring-1 focus-visible:ring-primary"
          />
        </label>
      ) : null}
      <div className={`block ${titleEnabled ? "mt-3" : ""}`}>
        <label
          className="text-xs font-medium text-muted-foreground"
          htmlFor={bodyInputId}
        >
          {bodyLabel}
        </label>
        <div
          aria-label="Forum formatting toolbar"
          className="mt-2 flex min-w-0 gap-0.5 overflow-x-auto overscroll-x-contain rounded-t-xl border border-b-0 border-input bg-muted/30 p-1"
          role="toolbar"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ),
            );
            const index = buttons.indexOf(event.target as HTMLButtonElement);
            if (index < 0 || buttons.length === 0) return;
            event.preventDefault();
            const nextIndex =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (index +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      buttons.length) %
                    buttons.length;
            buttons[nextIndex]?.focus();
          }}
        >
          <ToolbarButton
            ariaLabel="Insert section heading"
            disabled={controlsDisabled}
            label={<Heading2 className="size-3.5" />}
            onClick={() => appendMarkup("[h2]", "[/h2]", "Section heading")}
          />
          <ToolbarButton
            ariaLabel="Insert bold markup"
            disabled={controlsDisabled}
            label={<Bold className="size-3.5" />}
            onClick={() => appendMarkup("[b]", "[/b]", "bold text")}
          />
          <ToolbarButton
            ariaLabel="Insert italic markup"
            disabled={controlsDisabled}
            label={<Italic className="size-3.5" />}
            onClick={() => appendMarkup("[i]", "[/i]", "italic text")}
          />
          <ToolbarButton
            ariaLabel="Insert underline markup"
            disabled={controlsDisabled}
            label={<Underline className="size-3.5" />}
            onClick={() => appendMarkup("[u]", "[/u]", "underlined text")}
          />
          <ToolbarButton
            ariaLabel="Insert strike markup"
            disabled={controlsDisabled}
            label={<Strikethrough className="size-3.5" />}
            onClick={() => appendMarkup("[s]", "[/s]", "struck text")}
          />
          <ToolbarButton
            ariaLabel="Insert code block markup"
            disabled={controlsDisabled}
            label={<Code2 className="size-3.5" />}
            onClick={() => appendMarkup("[code]\n", "\n[/code]", "code")}
          />
          <ToolbarButton
            ariaLabel="Insert quote markup"
            disabled={controlsDisabled}
            label={<Quote className="size-3.5" />}
            onClick={() =>
              appendMarkup("[quote]\n", "\n[/quote]", "quoted text")
            }
          />
          <ToolbarButton
            ariaLabel="Insert link markup"
            disabled={controlsDisabled}
            label={<LinkIcon className="size-3.5" />}
            onClick={() =>
              appendMarkup("[url=https://example.com]", "[/url]", "link text")
            }
          />
          <ToolbarButton
            ariaLabel="Insert image markup"
            disabled={controlsDisabled}
            label={<ImageIcon className="size-3.5" />}
            onClick={() =>
              appendMarkup("[img]", "[/img]", "https://example.com/image.jpg")
            }
          />
          <ToolbarButton
            ariaLabel="Insert list markup"
            disabled={controlsDisabled}
            label={<List className="size-3.5" />}
            onClick={() =>
              appendMarkup(
                "[list]\n",
                "\n[/list]",
                "[*] First item\n[*] Second item",
              )
            }
          />
          <ToolbarButton
            ariaLabel="Insert numbered list markup"
            disabled={controlsDisabled}
            label={<ListOrdered className="size-3.5" />}
            onClick={() =>
              appendMarkup(
                "[list=1]\n",
                "\n[/list]",
                "[*] First step\n[*] Second step",
              )
            }
          />
          <ToolbarButton
            ariaLabel="Insert note markup"
            disabled={controlsDisabled}
            label={<Info className="size-3.5" />}
            onClick={() =>
              appendMarkup("[note]\n", "\n[/note]", "Useful context")
            }
          />
          <ToolbarButton
            ariaLabel="Insert spoiler markup"
            disabled={controlsDisabled}
            label={<EyeOff className="size-3.5" />}
            onClick={() =>
              appendMarkup(
                "[spoiler=Show details]\n",
                "\n[/spoiler]",
                "Hidden details",
              )
            }
          />
          <ToolbarButton
            ariaLabel="Insert comparison table markup"
            disabled={controlsDisabled}
            label={<Table2 className="size-3.5" />}
            onClick={() =>
              appendMarkup(
                "[table]\n",
                "\n[/table]",
                "[tr][th]Option[/th][th]Notes[/th][/tr]\n[tr][td]A[/td][td]Details[/td][/tr]",
              )
            }
          />
          <ToolbarButton
            ariaLabel="Insert signal chart markup"
            disabled={controlsDisabled}
            label={<BarChart3 className="size-3.5" />}
            onClick={() =>
              appendMarkup(
                "[chart=Signal map]\n",
                "\n[/chart]",
                "Option A|72|Strong signal\nOption B|48|Mixed signal\nOption C|24|Early signal",
              )
            }
          />
          <ToolbarButton
            ariaLabel="Insert action sequence markup"
            disabled={controlsDisabled}
            label={<Workflow className="size-3.5" />}
            onClick={() =>
              appendMarkup(
                "[steps=Action sequence]\n",
                "\n[/steps]",
                "1|Inspect|Collect the evidence\n2|Decide|Choose the lowest-risk path\n3|Verify|Confirm the outcome",
              )
            }
          />
          <ToolbarButton
            ariaLabel="Insert decision matrix markup"
            disabled={controlsDisabled}
            label={<GitCompareArrows className="size-3.5" />}
            onClick={() =>
              appendMarkup(
                "[decision=Options]\n",
                "\n[/decision]",
                "Option A|Choose|Best fit for this constraint\nOption B|Watch|Promising but not ready",
              )
            }
          />
          <ToolbarButton
            ariaLabel="Insert horizontal rule"
            disabled={controlsDisabled}
            label={<Minus className="size-3.5" />}
            onClick={() => appendMarkup("", "", "[hr]")}
          />
          <ToolbarButton
            ariaLabel="Insert smilie"
            disabled={controlsDisabled}
            label={<Smile className="size-3.5" />}
            onClick={() => appendMarkup("", "", ":)")}
          />
        </div>
        <Textarea
          ref={textareaRef}
          id={bodyInputId}
          aria-describedby={bodyDescription}
          aria-invalid={bodyAriaInvalid}
          disabled={controlsDisabled}
          maxLength={bodyMaxLength}
          value={body}
          onChange={(event) => onBodyChange(event.target.value)}
          placeholder={bodyPlaceholder}
          rows={bodyRows}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key === "Enter" &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void submitWithDraftCleanup();
            }
          }}
          className="min-h-48 resize-y rounded-none rounded-b-xl border border-input bg-background px-3 py-3 text-base leading-7 focus-visible:ring-1 focus-visible:ring-primary"
        />
        <details className="mt-1">
          <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center justify-between px-1 py-2 text-xs text-muted-foreground marker:content-none">
            Formatting help
            <span aria-hidden="true" className="text-primary">
              +
            </span>
          </summary>
          <p className="px-1 py-2.5 text-xs leading-5 text-muted-foreground">
            Use headings, bold, italic, quotes, code, links, images, bullet or
            numbered lists, notes, warnings, spoilers, tables, signal charts,
            action sequences, decision matrices, keyboard keys, highlights, and
            horizontal rules. Structured rows use pipe separators. Preview
            before posting to check the final layout.
          </p>
        </details>
      </div>
      {children ? (
        <fieldset
          className="mt-3 min-w-0 space-y-3"
          disabled={controlsDisabled}
        >
          <legend className="sr-only">Post options</legend>
          {children}
        </fieldset>
      ) : null}
      {note ? (
        <p className="mt-3 text-xs leading-6 text-muted-foreground">{note}</p>
      ) : null}
      {error ? (
        <p
          id={resolvedErrorId}
          className="mt-3 rounded-sm bg-accent-canary/10 p-3 text-sm text-foreground"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {protection
            ? "Saved draft protected; current edits are not saved"
            : draftSaved
              ? "Draft saved on this device"
              : "Ctrl/⌘ Enter to post"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {footerActions}
          <Button
            className="min-h-11 rounded-full px-5 text-sm font-medium"
            type="button"
            onClick={() => {
              void submitWithDraftCleanup();
            }}
            disabled={disabled || pending}
          >
            {pending ? pendingLabel : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ForumAttachmentDraftPanel({
  attachments,
  disabled = false,
  reservedAttachmentSlots = 0,
  onUploadingChange,
  onAttachmentsChange,
}: {
  attachments: ForumAttachmentDraft[];
  disabled?: boolean;
  reservedAttachmentSlots?: number;
  onUploadingChange?: (uploading: boolean) => void;
  onAttachmentsChange: (attachments: ForumAttachmentDraft[]) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const authToken = useAuthToken();
  const runtime = useForumRuntime();
  const [uploading, setUploading] = useState(false);
  useEffect(() => { onUploadingChange?.(uploading); }, [uploading, onUploadingChange]);
  useEffect(() => () => onUploadingChange?.(false), [onUploadingChange]);
  const [error, setError] = useState("");
  const [remainingFiles, setRemainingFiles] = useState<string[]>([]);
  const uploadBatch = useRef<{
    controller: AbortController;
    cancelled: boolean;
    expectedIds: string;
    remaining: string[];
  } | null>(null);
  const attachmentIds = attachments.map((file) => file.storageId).join(":");
  const permissions = runtime.capabilities?.join(":");
  useLayoutEffect(() => {
    const batch = uploadBatch.current;
    if (batch) {
      batch.cancelled = true;
      batch.controller.abort();
      uploadBatch.current = null;
    }
    setUploading(false);
    setRemainingFiles([]);
    setError("");
    return () => {
      if (uploadBatch.current) {
        uploadBatch.current.cancelled = true;
        uploadBatch.current.controller.abort();
        uploadBatch.current = null;
      }
    };
  }, [authToken, runtime.host, runtime.actingAs?.userId, runtime.executionMode, permissions, disabled]);
  useLayoutEffect(() => {
    const batch = uploadBatch.current;
    if (batch && batch.expectedIds !== attachmentIds) {
      batch.cancelled = true;
      batch.controller.abort();
      uploadBatch.current = null;
      setUploading(false);
      setRemainingFiles([]);
    }
  }, [attachmentIds]);
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>(
    {},
  );
  const previewUrls = useRef(new Map<string, string>());
  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);
  useEffect(() => {
    const retained = new Set(attachments.map((file) => file.storageId));
    for (const [id, url] of previewUrls.current) {
      if (!retained.has(id)) {
        URL.revokeObjectURL(url);
        previewUrls.current.delete(id);
      }
    }
  }, [attachments]);
  const usedAttachmentSlots =
    Math.max(0, reservedAttachmentSlots) + attachments.length;

  async function uploadFiles(files: FileList | null) {
    if (disabled || uploadBatch.current || !files || files.length === 0) {
      return;
    }
    const nextFiles = Array.from(files);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    setError("");
    setRemainingFiles([]);

    if (usedAttachmentSlots + nextFiles.length > MAX_FORUM_ATTACHMENTS) {
      setError(`Attach up to ${MAX_FORUM_ATTACHMENTS} files.`);
      return;
    }

    const invalid = nextFiles.find(
      (file) => !isAllowedForumAttachmentFile(file),
    );
    if (invalid) {
      setError(`${invalid.name} is not an allowed forum attachment.`);
      return;
    }

    const batch = {
      controller: new AbortController(),
      cancelled: false,
      expectedIds: attachmentIds,
      remaining: nextFiles.map((file) => file.name.slice(0, 160)),
    };
    const route = typeof window === "undefined"
      ? ""
      : `${window.location.pathname}${window.location.search}`;
    const current = () => uploadBatch.current === batch && !batch.cancelled &&
      (typeof window === "undefined" || `${window.location.pathname}${window.location.search}` === route);
    uploadBatch.current = batch;
    setUploading(true);
    const uploaded: ForumAttachmentDraft[] = [];
    const keepConfirmed = (claimed: ForumAttachmentDraft, file: File) => {
      uploaded.push(claimed);
      const retained = [...attachments, ...uploaded];
      batch.expectedIds = retained.map((attachment) => attachment.storageId).join(":");
      if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(claimed.contentType)) {
        const url = URL.createObjectURL(file);
        previewUrls.current.set(claimed.storageId, url);
        setImagePreviews((previous) => ({ ...previous, [claimed.storageId]: url }));
      }
      onAttachmentsChange(retained);
    };
    try {
      if (runtime.uploadFiles) {
        // The host's owner-approved/idempotent batch protocol stays intact.
        const confirmed = await runtime.uploadFiles(nextFiles);
        if (!current()) return;
        if (confirmed.length !== nextFiles.length) throw new Error("Invalid upload receipt");
        for (let index = 0; index < confirmed.length; index++) {
          if (!current()) return;
          keepConfirmed(confirmed[index], nextFiles[index]);
        }
        batch.remaining = [];
        return;
      }
      const uploadEndpoint = forumAttachmentUploadEndpoint();
      if (uploadEndpoint === null) {
        throw new Error("Forum attachment uploads are not configured.");
      }
      if (!authToken) {
        throw new Error("Sign in to upload forum attachments.");
      }
      for (const file of nextFiles) {
        if (!current()) return;
        const contentType = forumAttachmentContentTypeForFile(file);
        if (contentType === null) {
          throw new Error(`${file.name} is not an allowed forum attachment.`);
        }
        const response = await fetch(uploadEndpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": contentType,
            "X-Forum-Attachment-Filename": encodeURIComponent(file.name),
          },
          body: file,
          signal: batch.controller.signal,
        });
        const payload = (await response
          .json()
          .catch(() => ({}))) as ForumAttachmentUploadResponse;
        if (!current()) return;
        if (!response.ok) {
          throw new Error(payload.error ?? "Attachment upload failed");
        }
        const claimed = payload;
        if (
          !claimed.storageId ||
          !claimed.filename ||
          !claimed.contentType ||
          typeof claimed.size !== "number"
        ) {
          throw new Error("Attachment upload returned an invalid response.");
        }
        keepConfirmed({
          storageId: claimed.storageId,
          filename: claimed.filename,
          contentType: claimed.contentType,
          size: claimed.size,
        }, file);
        batch.remaining.shift();
      }
    } catch {
      if (!current()) return;
      setRemainingFiles(batch.remaining);
      setError(`Could not confirm ${batch.remaining[0] ?? "the selected files"}. Confirmed attachments have been kept. Choose unconfirmed files again when ready; nothing is retried automatically.${runtime.host === "plugin" ? " Check Agent access for required owner approval first." : ""}`);
    } finally {
      if (uploadBatch.current === batch) {
        uploadBatch.current = null;
        setUploading(false);
      }
    }
  }

  function removeAttachment(storageId: string) {
    onAttachmentsChange(
      attachments.filter((attachment) => attachment.storageId !== storageId),
    );
  }

  function stopUpload() {
    const batch = uploadBatch.current;
    if (!batch) return;
    batch.cancelled = true;
    batch.controller.abort();
    uploadBatch.current = null;
    setUploading(false);
    setRemainingFiles(batch.remaining);
    setError(`Stopped waiting. An in-flight upload may still finish outside this draft. Confirmed attachments are kept; no retry runs automatically.${runtime.host === "plugin" ? " Check Agent access and owner approval before choosing the files again." : ""}`);
  }

  return (
    <section className="min-w-0 rounded-xl bg-muted/25 p-3">
      <ForumAgentAttachmentPicker />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-medium text-foreground">
            Attachments{" "}
            <span className="text-muted-foreground">
              {usedAttachmentSlots}/{MAX_FORUM_ATTACHMENTS}
            </span>
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Images, PDF, text, markdown, or zip. Up to 5 MiB per file.
          </p>
        </div>
        <Button
          className="forum-action-pill min-h-11 rounded-full text-xs"
          disabled={
            disabled ||
            uploading ||
            usedAttachmentSlots >= MAX_FORUM_ATTACHMENTS
          }
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-3.5" />
          {uploading ? "Uploading" : "Add files"}
        </Button>
        {uploading ? (
          <Button type="button" variant="ghost" className="min-h-11" onClick={stopUpload}>
            Stop waiting
          </Button>
        ) : null}
        <input
          ref={inputRef}
          id={inputId}
          aria-label="Choose forum attachment files"
          className="sr-only"
          type="file"
          multiple
          accept={FORUM_ATTACHMENT_ACCEPT}
          disabled={disabled || uploading}
          onChange={(event) => {
            void uploadFiles(event.target.files);
          }}
        />
      </div>
      {uploading ? (
        <p
          className="mt-3 font-mono text-[10px] uppercase text-muted-foreground"
          role="status"
        >
          Uploading attachment...
        </p>
      ) : null}
      {error ? (
        <p
          className="mt-3 border border-row-border p-2 text-sm text-muted-foreground"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {remainingFiles.length > 0 ? (
        <div className="mt-2 text-sm">
          <p>Not attached: {remainingFiles.join(", ")}</p>
          <Button type="button" variant="outline" className="mt-2 min-h-11" disabled={disabled || uploading} onClick={() => inputRef.current?.click()}>
            Choose unconfirmed files
          </Button>
        </div>
      ) : null}
      {attachments.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {attachments.map((attachment) => (
            <div
              className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-card px-3 py-2"
              key={attachment.storageId}
            >
              {imagePreviews[attachment.storageId] ? (
                // eslint-disable-next-line @next/next/no-img-element -- Temporary local File preview, revoked on removal or teardown.
                <img
                  src={imagePreviews[attachment.storageId]}
                  alt={attachment.filename}
                  className="size-14 shrink-0 rounded-lg object-cover"
                />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                  <Paperclip className="size-3.5 shrink-0" />
                  <span className="truncate">{attachment.filename}</span>
                </span>
                <span className="mt-1 block font-mono text-[10px] uppercase text-muted-foreground">
                  {attachment.contentType} /{" "}
                  {formatDraftFileSize(attachment.size)}
                </span>
              </span>
              <Button
                aria-label={`Remove ${attachment.filename}`}
                className="size-11 shrink-0 rounded-full p-0"
                disabled={disabled || uploading}
                type="button"
                variant="ghost"
                onClick={() => removeAttachment(attachment.storageId)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function forumAttachmentUploadEndpoint() {
  const explicit = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  if (explicit) {
    return `${explicit.replace(/\/$/, "")}/forum-attachment-upload`;
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!convexUrl) {
    return null;
  }
  const siteUrl = convexUrl.replace(/\.convex\.cloud$/, ".convex.site");
  return `${siteUrl.replace(/\/$/, "")}/forum-attachment-upload`;
}

function formatDraftFileSize(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${Math.ceil(size / 1024)} KB`;
  }
  return `${size} B`;
}

function ToolbarButton({
  ariaLabel,
  disabled = false,
  label,
  onClick,
}: {
  ariaLabel: string;
  disabled?: boolean;
  label: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={ariaLabel}
      className="size-11 shrink-0 rounded-sm border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-background hover:text-foreground"
      disabled={disabled}
      type="button"
      variant="outline"
      title={ariaLabel}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
