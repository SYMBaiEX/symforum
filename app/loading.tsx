import { ForumLoading } from "@/components/forum/forum-primitives";

export default function Loading() {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      className="page-frame page-frame-spacious"
    >
      <ForumLoading label="Loading SYMBiEX" variant="line" />
    </main>
  );
}
