"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { ForumFeedSort, ForumHomeView } from "./forum-home-model";

export const forumQuietAction =
  "forum-action-pill focus-ring inline-flex items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground";

export function ForumPageHeader({
  title,
  description,
  breadcrumbs,
  actions,
}: {
  title: string;
  description?: ReactNode;
  breadcrumbs?: ReactNode;
  actions?: ReactNode;
  view?: ForumHomeView;
  sort?: ForumFeedSort;
  nested?: boolean;
}) {
  return (
    <header className="forum-page-header pb-1">
      {breadcrumbs ? <div className="mb-2">{breadcrumbs}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] font-bold leading-tight tracking-tight [overflow-wrap:anywhere] md:text-[28px]">
            {title}
          </h1>
          {description ? (
            <div className="mt-1.5 max-w-2xl text-sm leading-5 text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="forum-page-actions flex flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

export function ForumBodyGrid({
  children,
  sidebar,
  mobileSidebarLabel = "Around the forum",
  mobileSidebarAlwaysOpen = false,
}: {
  children: ReactNode;
  sidebar?: ReactNode;
  mobileSidebarLabel?: string;
  mobileSidebarAlwaysOpen?: boolean;
}) {
  const [contextOpen, setContextOpen] = useState(false);
  const contextId = useId();

  useEffect(() => {
    if (mobileSidebarAlwaysOpen) return;

    const openLinkedContext = () => {
      const target = document.getElementById(window.location.hash.slice(1));
      const context = document.getElementById(contextId);
      if (!target || !context?.contains(target)) return;

      setContextOpen(true);
      if (
        typeof window.requestAnimationFrame === "function" &&
        typeof target.scrollIntoView === "function"
      ) {
        window.requestAnimationFrame(() =>
          target.scrollIntoView({ block: "start" }),
        );
      }
    };

    openLinkedContext();
    window.addEventListener("hashchange", openLinkedContext);
    return () => window.removeEventListener("hashchange", openLinkedContext);
  }, [contextId, mobileSidebarAlwaysOpen]);

  return (
    <div
      className={`forum-body-grid grid items-start ${sidebar ? "forum-has-context" : ""}`}
    >
      <div className="forum-body-content min-w-0">{children}</div>
      {sidebar ? (
        <div className="forum-context-panel min-w-0">
          {!mobileSidebarAlwaysOpen ? (
            <button
              type="button"
              aria-expanded={contextOpen}
              aria-controls={contextId}
              onClick={() => setContextOpen((open) => !open)}
              className="forum-context-toggle focus-ring flex min-h-11 w-full items-center justify-between rounded-xl bg-card px-4 text-sm font-medium"
            >
              {mobileSidebarLabel}
              <ChevronDown
                aria-hidden="true"
                className={`size-4 ${contextOpen ? "rotate-180" : ""}`}
              />
            </button>
          ) : null}
          <div
            id={contextId}
            className={`forum-context-content ${contextOpen || mobileSidebarAlwaysOpen ? "is-open" : ""}`}
          >
            {sidebar}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ForumSectionHeader({
  title,
  children,
  id,
}: {
  title: string;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <div className="forum-section-header flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1">
      <h2 id={id} className="text-sm font-semibold tracking-tight">
        {title}
      </h2>
      {children ? (
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {children}
        </div>
      ) : null}
    </div>
  );
}
