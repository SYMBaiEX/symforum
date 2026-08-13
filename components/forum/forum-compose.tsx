"use client";

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
import { useAuthToken } from "@convex-dev/auth/react";
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
  useEffect,
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

export function ForumCompose({
  body,
  bodyAriaDescribedBy,
  bodyAriaInvalid,
  bodyMaxLength,
  bodyTextareaRef,
  bodyPlaceholder,
  bodyRows = 7,
  bodyLabel,
  children,
  disabled = false,
  draftKey,
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
  bodyTextareaRef?: Ref<HTMLTextAreaElement>;
  bodyRows?: number;
  children?: ReactNode;
  disabled?: boolean;
  draftKey?: string;
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
  onSubmit: () => void | Promise<void>;
  onTitleChange?: (value: string) => void;
}) {
  const bodyInputId = useId();
  const [draftHydrated, setDraftHydrated] = useState(draftKey === undefined);
  const titleEnabled =
    typeof title === "string" && typeof onTitleChange === "function";

  useEffect(() => {
    if (!draftKey) {
      setDraftHydrated(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw) as {
          body?: unknown;
          title?: unknown;
          version?: unknown;
        };
        if (
          draft.version !== undefined &&
          draft.version !== FORUM_DRAFT_SCHEMA_VERSION
        ) {
          return;
        }
        if (body.trim().length === 0 && typeof draft.body === "string") {
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
      // Storage can be unavailable in private or sandboxed browsers.
    } finally {
      setDraftHydrated(true);
    }
  }, [body, draftKey, onBodyChange, onTitleChange, title, titleEnabled]);

  useEffect(() => {
    if (!draftKey || !draftHydrated) {
      return;
    }
    try {
      if (
        body.trim().length === 0 &&
        (!titleEnabled || title?.trim().length === 0)
      ) {
        window.localStorage.removeItem(draftKey);
        return;
      }
      window.localStorage.setItem(
        draftKey,
        JSON.stringify({
          version: FORUM_DRAFT_SCHEMA_VERSION,
          body,
          ...(titleEnabled ? { title } : {}),
          savedAt: Date.now(),
        }),
      );
    } catch {
      // Storage can be unavailable in private or sandboxed browsers.
    }
  }, [body, draftHydrated, draftKey, title, titleEnabled]);

  async function submitWithDraftCleanup() {
    await onSubmit();
    if (draftKey) {
      try {
        window.localStorage.removeItem(draftKey);
      } catch {
        // Ignore storage cleanup failures after a successful post.
      }
    }
  }
  function appendMarkup(open: string, close: string, sample: string) {
    if (disabled) {
      return;
    }
    const next =
      body.trim().length === 0
        ? `${open}${sample}${close}`
        : `${body.trimEnd()}\n\n${open}${sample}${close}`;
    onBodyChange(next);
  }

  return (
    <div className="border border-row-border p-3">
      {titleEnabled ? (
        <label className="block">
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            {titleLabel ?? "Title"}
          </span>
          <Input
            disabled={disabled}
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder={titlePlaceholder}
            className="mt-2 rounded-none border-row-border"
          />
        </label>
      ) : null}
      <div className={`block ${titleEnabled ? "mt-3" : ""}`}>
        <label
          className="font-mono text-[10px] uppercase text-muted-foreground"
          htmlFor={bodyInputId}
        >
          {bodyLabel}
        </label>
        <div
          aria-label="Forum formatting toolbar"
          className="mt-2 flex flex-wrap gap-2"
          role="toolbar"
        >
          <ToolbarButton
            ariaLabel="Insert section heading"
            disabled={disabled}
            label={<Heading2 className="size-3.5" />}
            onClick={() => appendMarkup("[h2]", "[/h2]", "Section heading")}
          />
          <ToolbarButton
            ariaLabel="Insert bold markup"
            disabled={disabled}
            label={<Bold className="size-3.5" />}
            onClick={() => appendMarkup("[b]", "[/b]", "bold text")}
          />
          <ToolbarButton
            ariaLabel="Insert italic markup"
            disabled={disabled}
            label={<Italic className="size-3.5" />}
            onClick={() => appendMarkup("[i]", "[/i]", "italic text")}
          />
          <ToolbarButton
            ariaLabel="Insert underline markup"
            disabled={disabled}
            label={<Underline className="size-3.5" />}
            onClick={() => appendMarkup("[u]", "[/u]", "underlined text")}
          />
          <ToolbarButton
            ariaLabel="Insert strike markup"
            disabled={disabled}
            label={<Strikethrough className="size-3.5" />}
            onClick={() => appendMarkup("[s]", "[/s]", "struck text")}
          />
          <ToolbarButton
            ariaLabel="Insert code block markup"
            disabled={disabled}
            label={<Code2 className="size-3.5" />}
            onClick={() => appendMarkup("[code]\n", "\n[/code]", "code")}
          />
          <ToolbarButton
            ariaLabel="Insert quote markup"
            disabled={disabled}
            label={<Quote className="size-3.5" />}
            onClick={() =>
              appendMarkup("[quote]\n", "\n[/quote]", "quoted text")
            }
          />
          <ToolbarButton
            ariaLabel="Insert link markup"
            disabled={disabled}
            label={<LinkIcon className="size-3.5" />}
            onClick={() =>
              appendMarkup("[url=https://example.com]", "[/url]", "link text")
            }
          />
          <ToolbarButton
            ariaLabel="Insert image markup"
            disabled={disabled}
            label={<ImageIcon className="size-3.5" />}
            onClick={() =>
              appendMarkup("[img]", "[/img]", "https://example.com/image.jpg")
            }
          />
          <ToolbarButton
            ariaLabel="Insert list markup"
            disabled={disabled}
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
            disabled={disabled}
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
            disabled={disabled}
            label={<Info className="size-3.5" />}
            onClick={() =>
              appendMarkup("[note]\n", "\n[/note]", "Useful context")
            }
          />
          <ToolbarButton
            ariaLabel="Insert spoiler markup"
            disabled={disabled}
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
            disabled={disabled}
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
            disabled={disabled}
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
            disabled={disabled}
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
            disabled={disabled}
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
            disabled={disabled}
            label={<Minus className="size-3.5" />}
            onClick={() => appendMarkup("", "", "[hr]")}
          />
          <ToolbarButton
            ariaLabel="Insert smilie"
            disabled={disabled}
            label={<Smile className="size-3.5" />}
            onClick={() => appendMarkup("", "", ":)")}
          />
        </div>
        <Textarea
          ref={bodyTextareaRef}
          id={bodyInputId}
          aria-describedby={bodyAriaDescribedBy}
          aria-invalid={bodyAriaInvalid}
          disabled={disabled}
          maxLength={bodyMaxLength}
          value={body}
          onChange={(event) => onBodyChange(event.target.value)}
          placeholder={bodyPlaceholder}
          rows={bodyRows}
          className="mt-2 rounded-none border-row-border"
        />
        <details className="mt-2 border border-row-border bg-muted/15">
          <summary className="focus-ring flex min-h-10 cursor-pointer list-none items-center justify-between px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground marker:content-none">
            Formatting help
            <span aria-hidden="true" className="text-primary">
              +
            </span>
          </summary>
          <p className="border-t border-row-border px-3 py-2.5 text-xs leading-5 text-muted-foreground">
            Use headings, bold, italic, quotes, code, links, images, bullet or
            numbered lists, notes, warnings, spoilers, tables, signal charts,
            action sequences, decision matrices, keyboard keys, highlights, and
            horizontal rules. Structured rows use pipe separators. Preview
            before posting to check the final layout.
          </p>
        </details>
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
      {note ? (
        <p className="mt-3 text-xs leading-6 text-muted-foreground">{note}</p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          className="mt-3 border border-row-border p-3 text-sm text-muted-foreground"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase text-muted-foreground">
          Classic board format
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {footerActions}
          <Button
            className="rounded-none font-mono text-[10px] uppercase"
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
  onAttachmentsChange,
}: {
  attachments: ForumAttachmentDraft[];
  disabled?: boolean;
  reservedAttachmentSlots?: number;
  onAttachmentsChange: (attachments: ForumAttachmentDraft[]) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const authToken = useAuthToken();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const usedAttachmentSlots =
    Math.max(0, reservedAttachmentSlots) + attachments.length;

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }
    const nextFiles = Array.from(files);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    setError("");

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

    setUploading(true);
    try {
      const uploaded: ForumAttachmentDraft[] = [];
      const uploadEndpoint = forumAttachmentUploadEndpoint();
      if (uploadEndpoint === null) {
        throw new Error("Forum attachment uploads are not configured.");
      }
      if (!authToken) {
        throw new Error("Sign in to upload forum attachments.");
      }
      for (const file of nextFiles) {
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
        });
        const payload = (await response
          .json()
          .catch(() => ({}))) as ForumAttachmentUploadResponse;
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
        uploaded.push({
          storageId: claimed.storageId,
          filename: claimed.filename,
          contentType: claimed.contentType,
          size: claimed.size,
        });
      }
      onAttachmentsChange([...attachments, ...uploaded]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not upload forum attachment.",
      );
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(storageId: string) {
    onAttachmentsChange(
      attachments.filter((attachment) => attachment.storageId !== storageId),
    );
  }

  return (
    <section className="border border-row-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Attachments
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Images, PDFs, text, markdown, or zip files. 5 MB each.
          </p>
        </div>
        <Button
          className="rounded-none font-mono text-[10px] uppercase"
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
        <input
          ref={inputRef}
          id={inputId}
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
      {attachments.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {attachments.map((attachment) => (
            <div
              className="flex flex-wrap items-center justify-between gap-2 border border-row-border px-3 py-2"
              key={attachment.storageId}
            >
              <span className="min-w-0">
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
                className="size-8 rounded-none p-0"
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
      className="h-7 rounded-none px-2 font-mono text-[10px] uppercase"
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
