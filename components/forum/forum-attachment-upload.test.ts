import { describe, expect, test } from "vitest";

import {
  FORUM_ATTACHMENT_ACCEPT,
  forumAttachmentContentTypeForFile,
  isAllowedForumAttachmentFile,
} from "@/components/forum/forum-attachment-upload";

function fileFixture(
  name: string,
  type: string,
  size = 1024,
): Pick<File, "name" | "size" | "type"> {
  return { name, size, type };
}

describe("forum attachment upload helpers", () => {
  test("accepts browser files with reliable allowed MIME types", () => {
    const file = fileFixture("image.png", "image/png");

    expect(forumAttachmentContentTypeForFile(file)).toBe("image/png");
    expect(isAllowedForumAttachmentFile(file)).toBe(true);
  });

  test("falls back to safe text extensions when the browser omits the MIME type", () => {
    expect(
      forumAttachmentContentTypeForFile(fileFixture("notes.md", "")),
    ).toBe("text/markdown");
    expect(
      forumAttachmentContentTypeForFile(
        fileFixture("readme.MARKDOWN", "application/octet-stream"),
      ),
    ).toBe("text/markdown");
    expect(
      forumAttachmentContentTypeForFile(fileFixture("thread-log.txt", "")),
    ).toBe("text/plain");
  });

  test("does not let a disallowed declared MIME type through by extension", () => {
    const file = fileFixture("payload.png", "image/svg+xml");

    expect(forumAttachmentContentTypeForFile(file)).toBeNull();
    expect(isAllowedForumAttachmentFile(file)).toBe(false);
  });

  test("rejects empty files and oversized files", () => {
    expect(isAllowedForumAttachmentFile(fileFixture("empty.md", "", 0))).toBe(
      false,
    );
    expect(
      isAllowedForumAttachmentFile(fileFixture("large.md", "", 6 * 1024 * 1024)),
    ).toBe(false);
  });

  test("advertises MIME types and old-school text extensions in the file picker", () => {
    expect(FORUM_ATTACHMENT_ACCEPT).toContain("text/markdown");
    expect(FORUM_ATTACHMENT_ACCEPT).toContain(".md");
    expect(FORUM_ATTACHMENT_ACCEPT).toContain(".txt");
  });
});
