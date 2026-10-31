import type { ComponentProps } from "react";
// Isolate peripheral chrome/media; feed orchestration and article rendering are real.
export function ForumLink(props: ComponentProps<"a">) {
  return <a {...props} />;
}
export function ForumAvatar({ name }: { name: string }) {
  return <span aria-hidden="true">{name.slice(0, 1)}</span>;
}
export function ForumThreadPrefixBadge() {
  return null;
}
export function ForumThreadStateBadges() {
  return null;
}
export function ForumFeedStarter() {
  return null;
}
export function ForumMediaGallery() {
  return null;
}
export function reportAppError() {
  return undefined;
}
