import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ForumMediaGallery, forumMediaUrl } from "./forum-media-gallery";
import type { ForumAttachmentRecord } from "./forum-refs";
const image = (id: number, url = `https://strong-bee-384.convex.cloud/api/storage/${id}`) => ({ _id: String(id), url, filename: `Photo ${id}.png`, altText: `Photo <${id}>`, contentType: "image/png", size: 20 } as ForumAttachmentRecord);
describe("authorized forum attachment previews", () => {
  test("uses safe HTTPS URLs and escapes captions while limiting each item's previews to five", () => {
    expect(forumMediaUrl("javascript:alert(1)")).toBeNull();
    expect(forumMediaUrl("https://user:password@example.com/photo")).toBeNull();
    expect(forumMediaUrl("http://example.com/photo")).toBeNull();
    const html = renderToStaticMarkup(<ForumMediaGallery attachments={Array.from({length:6},(_,i)=>image(i))} />);
    expect(html.match(/class="forum-media-tile/g)).toHaveLength(5);
    expect(html).toContain("Photo &lt;0&gt;"); expect(html).not.toContain("Photo 5.png");
    expect(html).toContain('referrerPolicy="no-referrer"');
  });
  test("unsafe URLs do not become previews or document links, and compact mode retains accessible names", () => {
    const html = renderToStaticMarkup(<ForumMediaGallery compact attachments={[image(1),image(2,"javascript:alert(1)")]} />);
    expect(html).toContain("forum-media is-compact"); expect(html).toContain("View image 1 of 1"); expect(html).not.toContain("javascript:");
  });
});
