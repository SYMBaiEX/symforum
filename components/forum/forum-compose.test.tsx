// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("./forum-webmcp", () => ({ ForumAgentAttachmentPicker: () => null }));
import { ForumCompose } from "./forum-compose";

function renderComposer(pending: boolean) {
  return renderToStaticMarkup(
    <ForumCompose
      body="A drafted reply"
      title="A drafted topic"
      bodyLabel="Reply"
      bodyPlaceholder="Write a reply"
      submitLabel="Post reply"
      pending={pending}
      onTitleChange={() => {}}
      onBodyChange={() => {}}
      onSubmit={() => {}}
    />,
  );
}

test("pending publication freezes the title, body and formatting controls while retaining the draft", () => {
  const html = renderComposer(true);
  expect(html).toContain('aria-busy="true"');
  expect(html).toMatch(/<input[^>]*disabled=""/);
  expect(html).toMatch(
    /<textarea[^>]*disabled=""[^>]*>A drafted reply<\/textarea>/,
  );
  const buttons = html.match(/<button[^>]*>/g) ?? [];
  expect(buttons.length).toBeGreaterThan(3);
  expect(buttons.every((button) => button.includes('disabled=""'))).toBe(true);
  expect(html).toContain("A drafted topic");
  expect(html).toContain("Posting...");
});

test("editable publication state keeps a labelled body and named formatting controls", () => {
  const html = renderComposer(false);
  expect(html).toContain('aria-busy="false"');
  expect(html).not.toContain('disabled=""');
  expect(html).toContain('aria-label="Forum formatting toolbar"');
  expect(html).toContain('aria-label="Insert bold markup"');
  expect(html).toMatch(/<label[^>]*for="([^"]+)"[^>]*>Reply<\/label>/);
});
