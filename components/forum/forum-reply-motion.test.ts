// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { focusForumReplyComposer } from "./forum-reply-motion";
afterEach(() => vi.unstubAllGlobals());
function elements() {
  const scrollIntoView = vi.fn();
  const focus = vi.fn();
  return {
    composer: { isConnected: true, scrollIntoView } as unknown as HTMLElement,
    textarea: { isConnected: true, disabled: false, value: "Existing reply draft", focus } as unknown as HTMLTextAreaElement,
    scrollIntoView,
    focus,
  };
}
it.each(["start", "center"] as const)("normal %s jump preserves alignment and avoids focus scrolling", (block) => {
  const nodes = elements();
  const matchMedia = vi.fn(() => ({ matches: false }));
  vi.stubGlobal("window", { matchMedia });
  focusForumReplyComposer(nodes.composer, nodes.textarea, block);
  expect(matchMedia).toHaveBeenCalledExactlyOnceWith("(prefers-reduced-motion: reduce)");
  expect(nodes.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block, behavior: "smooth" });
  expect(nodes.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  expect(nodes.textarea.value).toBe("Existing reply draft");
});
it("honors reduced motion at action time and keeps the draft and focus", () => {
  const nodes = elements();
  let reduced = false;
  vi.stubGlobal("window", { matchMedia: () => ({ matches: reduced }) });
  focusForumReplyComposer(nodes.composer, nodes.textarea, "start");
  reduced = true;
  focusForumReplyComposer(nodes.composer, nodes.textarea, "center");
  expect(nodes.scrollIntoView.mock.calls).toEqual([[{ block: "start", behavior: "smooth" }], [{ block: "center", behavior: "instant" }]]);
  expect(nodes.focus).toHaveBeenLastCalledWith({ preventScroll: true });
  expect(nodes.textarea.value).toBe("Existing reply draft");
});
it.each([undefined, {}, { matchMedia: () => ({}) }, { matchMedia: () => { throw new Error("Unavailable preference API"); } }])("unknown preference uses the instant fallback", (windowValue) => {
  const nodes = elements();
  vi.stubGlobal("window", windowValue);
  focusForumReplyComposer(nodes.composer, nodes.textarea, "start");
  expect(nodes.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "instant" });
  expect(nodes.focus).toHaveBeenCalledWith({ preventScroll: true });
});
it("does not focus or scroll detached nodes, and tolerates missing targets", () => {
  const nodes = elements();
  Object.assign(nodes.composer, { isConnected: false });
  Object.assign(nodes.textarea, { isConnected: false });
  focusForumReplyComposer(nodes.composer, nodes.textarea, "start");
  focusForumReplyComposer(null, null, "center");
  expect(nodes.scrollIntoView).not.toHaveBeenCalled();
  expect(nodes.focus).not.toHaveBeenCalled();
});
it("does not force focus into a disabled reply editor", () => {
  const nodes = elements();
  nodes.textarea.disabled = true;
  focusForumReplyComposer(nodes.composer, nodes.textarea, "start");
  expect(nodes.focus).not.toHaveBeenCalled();
});
