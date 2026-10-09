import type { ReactNode } from "react";

export function PrimaryPageSurface({ children }: { children: ReactNode }) {
  return (
    <div
      data-surface="primary"
      className="forum-app-shell relative z-10 min-h-full min-w-0 bg-background text-foreground"
    >
      <div className="forum-surface">{children}</div>
    </div>
  );
}
