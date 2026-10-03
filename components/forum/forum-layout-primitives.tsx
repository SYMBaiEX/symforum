"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { ForumFeedSort, ForumHomeView } from "./forum-home-model";

export const forumQuietAction =
  "focus-ring inline-flex min-h-11 items-center gap-2 rounded-sm px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground";

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
    <header className="forum-page-header">
      {breadcrumbs ? <div className="mb-2">{breadcrumbs}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] md:text-2xl">
            {title}
          </h1>
          {description ? (
            <div className="mt-1.5 max-w-3xl text-sm leading-5 text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

export function ForumBodyGrid({
  children,
  sidebar,
}: {
  children: ReactNode;
  sidebar?: ReactNode;
}) {
  const [contextOpen, setContextOpen] = useState(false);
  const contextId = useId();
  return (
    <div
      className={`forum-body-grid mt-4 grid items-start gap-5 lg:gap-8 ${sidebar ? "lg:grid-cols-[minmax(0,1fr)_260px]" : ""}`}
    >
      <div className="min-w-0 space-y-4">{children}</div>
      {sidebar ? (
        <div className="forum-context-panel min-w-0">
          <button
            type="button"
            aria-expanded={contextOpen}
            aria-controls={contextId}
            onClick={() => setContextOpen((open) => !open)}
            className="focus-ring flex min-h-11 w-full items-center justify-between bg-muted/35 px-3 text-sm font-medium lg:hidden"
          >
            Around the forum
            <ChevronDown
              aria-hidden="true"
              className={`size-4 ${contextOpen ? "rotate-180" : ""}`}
            />
          </button>
          <div
            id={contextId}
            className={`${contextOpen ? "block pt-3" : "hidden"} lg:block lg:pt-0`}
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
