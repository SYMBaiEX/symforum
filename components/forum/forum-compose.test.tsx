// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { ComponentProps, EffectCallback } from "react";

const composeHarness = vi.hoisted(() => ({
  effects: [] as EffectCallback[],
  buttons: [] as Array<{ onClick?: () => void; ariaLabel?: string }>,
  textareas: [] as Array<ComponentProps<"textarea">>,
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
      ariaLabel,
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
vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: ComponentProps<"textarea">) => {
    composeHarness.textareas.push(props);
    return <textarea {...props} />;
  },
}));
beforeEach(() => {
  composeHarness.effects.length = 0;
  composeHarness.buttons.length = 0;
  composeHarness.textareas.length = 0;
  vi.unstubAllGlobals();
});

vi.mock("./forum-webmcp", () => ({ ForumAgentAttachmentPicker: () => null }));
import { ForumCompose } from "./forum-compose";
import { getForumTokenTemplate, TOKEN_POST_TEMPLATE } from "@/lib/forum-token-template";

test.each([
  [null, TOKEN_POST_TEMPLATE],
  [JSON.stringify({ version: 1, body: "My saved token draft" }), "My saved token draft"],
  [JSON.stringify({ version: 1, body: "" }), ""],
])("token templates seed only new drafts and preserve saved bodies (%s)", (stored, expected) => {
  const onBodyChange = vi.fn();
  vi.stubGlobal("window", { localStorage: { getItem: () => stored } });
  renderToStaticMarkup(
    <ForumCompose
      body=""
      draftKey="token-draft"
      bodyTemplate={getForumTokenTemplate("crypto-bags")}
      bodyLabel="First post"
      bodyPlaceholder="Write"
      submitLabel="Post"
      onBodyChange={onBodyChange}
      onSubmit={() => {}}
    />,
  );
  composeHarness.effects[0]?.();
  composeHarness.effects[0]?.();
  expect(onBodyChange).toHaveBeenCalledExactlyOnceWith(expected);
});

test("token templates are scoped to the Crypto and Bags.App boards", () => {
  expect(getForumTokenTemplate("crypto")).toBe(TOKEN_POST_TEMPLATE);
  expect(getForumTokenTemplate("crypto-bags")).toBe(TOKEN_POST_TEMPLATE);
  expect(getForumTokenTemplate("general")).toBeUndefined();
  expect(getForumTokenTemplate("research")).toBeUndefined();
});

test("a token template does not replace a body already being edited", () => {
  const onBodyChange = vi.fn();
  vi.stubGlobal("window", { localStorage: { getItem: () => null } });
  renderToStaticMarkup(
    <ForumCompose
      body="My work in progress"
      draftKey="token-draft"
      bodyTemplate={TOKEN_POST_TEMPLATE}
      bodyLabel="First post"
      bodyPlaceholder="Write"
      submitLabel="Post"
      onBodyChange={onBodyChange}
      onSubmit={() => {}}
    />,
  );
  composeHarness.effects[0]?.();
  expect(onBodyChange).not.toHaveBeenCalled();
});

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
    vi.stubGlobal("window", { localStorage: { getItem: () => null, removeItem } });
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

function mountSelectionEditor(connected = true) {
  const onBodyChange = vi.fn();
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("window", {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return 1;
    },
  });
  renderToStaticMarkup(
    <ForumCompose
      body="Hello world!"
      bodyLabel="Reply"
      bodyPlaceholder="Reply"
      submitLabel="Post"
      onBodyChange={onBodyChange}
      onSubmit={() => {}}
    />,
  );
  const input = {
    selectionStart: 6,
    selectionEnd: 11,
    isConnected: connected,
    disabled: false,
    focus: vi.fn(),
    setSelectionRange: vi.fn(),
  };
  const ref = composeHarness.textareas[0]?.ref;
  if (typeof ref === "function") ref(input as unknown as HTMLTextAreaElement);
  else if (ref) ref.current = input as unknown as HTMLTextAreaElement;
  composeHarness.buttons
    .find((button) => button.ariaLabel === "Insert bold markup")
    ?.onClick?.();
  return { input, callbacks, onBodyChange };
}

test("formatting wraps the selected text and restores its selection after the controlled update", () => {
  const { input, callbacks, onBodyChange } = mountSelectionEditor();
  expect(onBodyChange).toHaveBeenCalledWith("Hello [b]world[/b]!");
  callbacks[0]?.(0);
  expect(input.focus).toHaveBeenCalledOnce();
  expect(input.setSelectionRange).toHaveBeenCalledWith(9, 14);
});

test("a deferred formatting update does not focus a detached editor", () => {
  const { input, callbacks } = mountSelectionEditor(false);
  callbacks[0]?.(0);
  expect(input.focus).not.toHaveBeenCalled();
  expect(input.setSelectionRange).not.toHaveBeenCalled();
});

test.each([false, true])(
  "keyboard posting respects the pending state (pending %s)",
  (pending) => {
    const onSubmit = vi.fn();
    renderToStaticMarkup(
      <ForumCompose
        body="A reply"
        bodyLabel="Reply"
        bodyPlaceholder="Reply"
        submitLabel="Post"
        pending={pending}
        onBodyChange={() => {}}
        onSubmit={onSubmit}
      />,
    );
    const preventDefault = vi.fn();
    const handler = composeHarness.textareas[0]?.onKeyDown;
    handler?.({
      key: "Enter",
      ctrlKey: true,
      metaKey: false,
      nativeEvent: { isComposing: false },
      preventDefault,
    } as unknown as Parameters<NonNullable<typeof handler>>[0]);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledTimes(pending ? 0 : 1);
  },
);

test("failed-post feedback is associated with the labelled editor", () => {
  const html = renderToStaticMarkup(
    <ForumCompose
      body="A reply"
      bodyLabel="Reply"
      bodyPlaceholder="Reply"
      submitLabel="Post"
      error="Could not post"
      onBodyChange={() => {}}
      onSubmit={() => {}}
    />,
  );
  const errorId = html.match(/<p[^>]*id="([^"]+)"[^>]*role="alert"/)?.[1];
  expect(errorId).toBeDefined();
  expect(html).toContain(`aria-describedby="${errorId}"`);
});
