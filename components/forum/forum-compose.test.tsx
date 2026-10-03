// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { ComponentProps, EffectCallback } from "react";

const composeHarness = vi.hoisted(() => ({
  effects: [] as EffectCallback[],
  buttons: [] as Array<{ onClick?: () => void }>,
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: EffectCallback) => {
    composeHarness.effects.push(effect);
  },
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    className,
    title,
    type,
    "aria-label": ariaLabel,
  }: ComponentProps<"button">) => {
    composeHarness.buttons.push({
      onClick: onClick as (() => void) | undefined,
    });
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        className={className}
        title={title}
        type={type}
        aria-label={ariaLabel}
      >
        {children}
      </button>
    );
  },
}));
beforeEach(() => {
  composeHarness.effects.length = 0;
  composeHarness.buttons.length = 0;
  vi.unstubAllGlobals();
});

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

test.each([false, true])(
  "draft cleanup requires a successful publication receipt (success %s)",
  async (published) => {
    const removeItem = vi.fn();
    vi.stubGlobal("window", { localStorage: { removeItem } });
    const onSubmit = vi.fn(async () => (published ? true : undefined));
    renderToStaticMarkup(
      <ForumCompose
        body="Keep this draft"
        draftKey="discussion-draft"
        bodyLabel="Reply"
        bodyPlaceholder="Reply"
        submitLabel="Post"
        onBodyChange={() => {}}
        onSubmit={onSubmit}
      />,
    );
    composeHarness.buttons.at(-1)?.onClick?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledOnce();
    if (published) expect(removeItem).toHaveBeenCalledWith("discussion-draft");
    else expect(removeItem).not.toHaveBeenCalled();
  },
);

test("a restored draft is hydrated once rather than being resurrected when the body is cleared", () => {
  const onBodyChange = vi.fn();
  const getItem = vi.fn(() =>
    JSON.stringify({ version: 1, body: "Recovered reply" }),
  );
  vi.stubGlobal("window", { localStorage: { getItem } });
  renderToStaticMarkup(
    <ForumCompose
      body=""
      draftKey="reply-draft"
      bodyLabel="Reply"
      bodyPlaceholder="Reply"
      submitLabel="Post"
      onBodyChange={onBodyChange}
      onSubmit={() => {}}
    />,
  );
  const restoreDraft = composeHarness.effects[0];
  restoreDraft?.();
  restoreDraft?.();
  expect(getItem).toHaveBeenCalledOnce();
  expect(onBodyChange).toHaveBeenCalledExactlyOnceWith("Recovered reply");
});
