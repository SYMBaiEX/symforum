import { ForumLoading } from "@/components/forum/forum-primitives";

export default function Loading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="page-frame page-frame-spacious"
    >
      <ForumLoading label="Loading forum" variant="index" />
    </div>
  );
}
