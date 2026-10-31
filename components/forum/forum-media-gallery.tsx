"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
export type ForumMediaAttachment = {
  _id: string;
  filename: string;
  contentType: string;
  size: number;
  url: string;
  altText?: string;
  credit?: string;
};

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
export function forumMediaUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** URLs come from an authorized, current content query; never persisted here. */
export function ForumMediaGallery({
  attachments = [],
  compact = false,
}: {
  attachments?: ForumMediaAttachment[];
  compact?: boolean;
}) {
  const files = attachments
    .slice(0, 5)
    .filter((file) => forumMediaUrl(file.url));
  const images = files.filter((file) => IMAGE_TYPES.has(file.contentType));
  const documents = files.filter((file) => !IMAGE_TYPES.has(file.contentType));
  const [selection, setSelection] = useState<{
    id: string;
    announcement: string;
  } | null>(null);
  const [hasOpened, setHasOpened] = useState(false);
  const gallery = useRef<HTMLDivElement | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const selected = images.findIndex((file) => file._id === selection?.id);
  const image = selected < 0 ? undefined : images[selected];
  // Close in the same render that loses the selected identity; never display
  // another attachment at its previous index or reopen it if it later returns.
  useEffect(() => {
    if (selection && !image) setSelection(null);
  }, [selection, image]);
  function navigate(direction: number) {
    setSelection((current) => {
      const index = images.findIndex((file) => file._id === current?.id);
      if (index < 0 || images.length < 2) return current;
      const next = (index + direction + images.length) % images.length;
      const file = images[next];
      return {
        id: file._id,
        announcement: `Image ${next + 1} of ${images.length}: ${file.altText || file.filename}`,
      };
    });
  }
  function visible(node: HTMLElement | null): node is HTMLElement {
    return Boolean(
      node?.isConnected &&
      !node.closest("[hidden], [inert]") &&
      node.getClientRects().length &&
      getComputedStyle(node).visibility !== "hidden",
    );
  }
  if (!files.length && !hasOpened) return null;
  return (
    <div
      ref={gallery}
      className={`forum-media ${compact ? "is-compact" : ""}`}
      role="group"
      aria-label="Attachments"
      tabIndex={-1}
    >
      {!files.length && <p>Attachments are no longer available.</p>}
      {images.length > 0 && (
        <div className="forum-media-grid" data-count={images.length}>
          {images.map((file, index) => (
            <button
              key={file._id}
              type="button"
              className="forum-media-tile focus-ring"
              aria-label={`View image ${index + 1} of ${images.length}: ${file.altText || file.filename}`}
              onClick={(event) => {
                returnFocus.current = event.currentTarget;
                setHasOpened(true);
                setSelection({ id: file._id, announcement: "" });
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Authorized runtime storage URLs must not enter the public image optimizer cache. */}
              <img
                src={file.url}
                alt={file.altText || file.filename}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
              <span className="forum-media-number">
                {index + 1}/{images.length}
              </span>
            </button>
          ))}
        </div>
      )}
      {documents.length > 0 && (
        <div className="forum-media-files">
          {documents.map((file) => (
            <a
              key={file._id}
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring"
            >
              <FileText className="size-4 shrink-0" aria-hidden="true" />
              <span>{file.filename}</span>
              <small>{Math.ceil(file.size / 1024)} KB</small>
            </a>
          ))}
        </div>
      )}
      <Dialog
        open={image !== undefined}
        onOpenChange={(open) => {
          if (!open) setSelection(null);
        }}
      >
        <DialogContent
          className="forum-media-viewer [&>button:last-child]:min-h-11 [&>button:last-child]:min-w-11"
          onCloseAutoFocus={(event) => {
            const fallback = Array.from(
              gallery.current?.querySelectorAll<HTMLButtonElement>(
                ".forum-media-tile",
              ) ?? [],
            ).find(visible);
            const target = visible(returnFocus.current)
              ? returnFocus.current
              : (fallback ?? gallery.current);
            if (visible(target)) {
              event.preventDefault();
              target.focus();
            }
          }}
          onKeyDown={(event) => {
            if (images.length < 2) return;
            if (event.key === "ArrowRight") {
              event.preventDefault();
              navigate(1);
            }
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              navigate(-1);
            }
          }}
        >
          <DialogTitle className="pr-10 text-sm">
            <span className="sr-only">Image viewer</span>
            <span aria-hidden="true">{image?.altText || image?.filename}</span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Attached image. Use the arrow keys to browse photos, or Escape to
            close.
          </DialogDescription>
          <span
            className="sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {selection?.announcement ?? ""}
          </span>
          {image && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- Runtime authorized attachment, deliberately uncached. */}
              <img
                src={image.url}
                alt={image.altText || image.filename}
                referrerPolicy="no-referrer"
              />
              <div className="forum-media-viewer-footer">
                <span>
                  <span aria-hidden="true">
                    {selected + 1} / {images.length}
                  </span>
                  {image.credit ? ` · ${image.credit}` : ""}
                </span>
                {images.length > 1 && (
                  <div>
                    <button
                      type="button"
                      aria-label="Previous image"
                      onClick={() => navigate(-1)}
                    >
                      <ChevronLeft aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label="Next image"
                      onClick={() => navigate(1)}
                    >
                      <ChevronRight aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
