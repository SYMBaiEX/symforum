"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
export type ForumMediaAttachment = {
  _id: string; filename: string; contentType: string; size: number; url: string;
  altText?: string; credit?: string;
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
  const [selected, setSelected] = useState<number | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const image = selected === null ? undefined : images[selected];
  if (!files.length) return null;
  return (
    <div className={`forum-media ${compact ? "is-compact" : ""}`}>
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
                setSelected(index);
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
          if (!open) setSelected(null);
        }}
      >
        <DialogContent
          className="forum-media-viewer"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
          onKeyDown={(event) => {
            if (images.length < 2) return;
            if (event.key === "ArrowRight") {
              event.preventDefault();
              setSelected(((selected ?? 0) + 1) % images.length);
            }
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setSelected(
                ((selected ?? 0) + images.length - 1) % images.length,
              );
            }
          }}
        >
          <DialogTitle className="pr-10 text-sm">
            {image?.altText || image?.filename}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Attached image. Use the arrow keys to browse photos, or Escape to
            close.
          </DialogDescription>
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
                  {(selected ?? 0) + 1} / {images.length}
                  {image.credit ? ` · ${image.credit}` : ""}
                </span>
                {images.length > 1 && (
                  <div>
                    <button
                      type="button"
                      aria-label="Previous image"
                      onClick={() =>
                        setSelected(
                          ((selected ?? 0) + images.length - 1) % images.length,
                        )
                      }
                    >
                      <ChevronLeft aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label="Next image"
                      onClick={() =>
                        setSelected(((selected ?? 0) + 1) % images.length)
                      }
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
