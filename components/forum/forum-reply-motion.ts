/** A reply jump keeps its focus handoff without forcing nonessential movement. */
export function focusForumReplyComposer(
  composer: HTMLElement | null,
  textarea: HTMLTextAreaElement | null,
  block: ScrollLogicalPosition,
) {
  let behavior: ScrollBehavior = "instant";
  try {
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches === false
    ) {
      behavior = "smooth";
    }
  } catch {
    // Unknown preference uses the motion-safe path, never a second query.
  }
  if (composer?.isConnected) composer.scrollIntoView({ block, behavior });
  if (textarea?.isConnected && !textarea.disabled) {
    textarea.focus({ preventScroll: true });
  }
}
