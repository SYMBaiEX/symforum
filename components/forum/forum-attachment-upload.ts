export const MAX_FORUM_ATTACHMENTS = 5;
export const MAX_FORUM_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export const ALLOWED_FORUM_ATTACHMENT_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/zip",
]);

const FORUM_ATTACHMENT_EXTENSION_TYPES = new Map([
  [".gif", "image/gif"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".pdf", "application/pdf"],
  [".txt", "text/plain"],
  [".text", "text/plain"],
  [".md", "text/markdown"],
  [".markdown", "text/markdown"],
  [".zip", "application/zip"],
]);

export const FORUM_ATTACHMENT_ACCEPT = [
  ...ALLOWED_FORUM_ATTACHMENT_TYPES,
  ...FORUM_ATTACHMENT_EXTENSION_TYPES.keys(),
].join(",");

export function forumAttachmentContentTypeForFile(
  file: Pick<File, "name" | "type">,
) {
  const declaredType = file.type.trim().toLowerCase();
  if (ALLOWED_FORUM_ATTACHMENT_TYPES.has(declaredType)) {
    return declaredType;
  }
  if (declaredType && declaredType !== "application/octet-stream") {
    return null;
  }

  const lowerName = file.name.trim().toLowerCase();
  for (const [extension, contentType] of FORUM_ATTACHMENT_EXTENSION_TYPES) {
    if (lowerName.endsWith(extension)) {
      return contentType;
    }
  }
  return null;
}

export function isAllowedForumAttachmentFile(
  file: Pick<File, "name" | "size" | "type">,
) {
  return (
    file.size > 0 &&
    file.size <= MAX_FORUM_ATTACHMENT_BYTES &&
    forumAttachmentContentTypeForFile(file) !== null
  );
}
