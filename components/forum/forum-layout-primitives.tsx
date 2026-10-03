"use client";

import type { ReactNode } from "react";
import {
  forumHomeHref,
  type ForumFeedSort,
  type ForumHomeView,
} from "./forum-home-model";
import { ForumLink } from "./forum-primitives";

export const forumQuietAction =
  "focus-ring inline-flex min-h-11 items-center gap-2 rounded-sm px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground";

const views = [
  { value: "boards", label: "Boards" },
  { value: "feed", label: "Feed" },
  { value: "news", label: "News" },
  { value: "community", label: "Community" },
] as const;

export function ForumPageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  view,
  sort = "active",
  nested = false,
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
    <header>
      {breadcrumbs ? <div className="mb-3">{breadcrumbs}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
            {title}
          </h1>
          {description ? (
            <div className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      <nav aria-label="Forum views" className="mt-3 flex flex-wrap gap-1">
        {views.map((item) => (
          <ForumLink
            aria-current={
              view === item.value ? (nested ? "true" : "page") : undefined
            }
            className={`${forumQuietAction} ${view === item.value ? "bg-primary/10 font-medium text-primary" : ""}`}
            href={forumHomeHref(item.value, sort)}
            key={item.value}
          >
            {item.label}
          </ForumLink>
        ))}
      </nav>
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
  return (
    <div
      className={`mt-4 grid items-start gap-6 ${sidebar ? "lg:grid-cols-[minmax(0,3fr)_minmax(220px,1fr)]" : ""}`}
    >
      <div className="min-w-0 space-y-5">{children}</div>
      {sidebar}
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
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-sm bg-muted/70 px-4 py-2">
      <span className="size-2 shrink-0 bg-primary" aria-hidden="true" />
      <h2 id={id} className="text-sm font-semibold">
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
