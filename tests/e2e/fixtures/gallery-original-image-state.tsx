import { useSyncExternalStore } from "react";
import type { ForumMediaAttachment } from "../../../components/forum/forum-media-gallery";
export const files: Record<string, ForumMediaAttachment> = Object.fromEntries(
  ["A", "B", "C"].map((id) => [
    id,
    {
      _id: id,
      filename: `${id}.png`,
      altText: `Illustration ${id}`,
      contentType: "image/png",
      size: 1234,
      url: `https://gallery-original.invalid/${id}.png`,
    },
  ]),
);
let attachments = [files.A, files.B, files.C];
const listeners = new Set<() => void>();
export const fixture = {
  set(value: ForumMediaAttachment[]) {
    attachments = value;
    listeners.forEach((listener) => listener());
  },
  files,
};
declare global {
  interface Window {
    galleryOriginal: typeof fixture;
  }
}
window.galleryOriginal = fixture;
export function useAttachments() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => attachments,
  );
}
