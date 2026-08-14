"use client";

import {
  formatForumCount,
  formatForumDateTime,
  forumMemberProfilePath,
  forumRefs,
  type ForumOnlineMembersRecord,
} from "@/components/forum/forum-refs";
import {
  ForumAvatar,
  ForumLink,
  ForumLoading,
  ForumMetricBar,
  ForumPaginationBar,
  ForumStatusBox,
} from "@/components/forum/forum-primitives";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useSearchParams } from "next/navigation";

const ONLINE_PAGE_SIZE = 25;

type ForumOnlineMemberRecord = ForumOnlineMembersRecord["members"][number];
type ForumOnlineLocationRecord = ForumOnlineMemberRecord["location"];

export function ForumOnlinePage({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <ForumStatusBox
        title="Local forum disabled"
        body="Convex is not configured locally, so the online roster cannot load."
        accent="cyan"
      />
    );
  }

  return <LiveForumOnlinePage />;
}

function LiveForumOnlinePage() {
  const searchParams = useSearchParams();
  const page = parseOnlinePage(searchParams.get("page"));
  const online = useQuery(forumRefs.listOnlineMembers, {
    page,
    pageSize: ONLINE_PAGE_SIZE,
  });

  if (online === undefined) {
    return <ForumLoading label="Checking who's online" variant="index" />;
  }

  return <ForumOnlineRoster online={online} />;
}

function ForumOnlineRoster({ online }: { online: ForumOnlineMembersRecord }) {
  const countLabel = `${formatForumCount(online.registeredCount)}${
    online.registeredCountLimited ? "+" : ""
  }`;
  const pageCountLabel = Math.max(online.pagination.totalPages, 1);
  const showingLabel =
    online.pagination.totalItems > 0
      ? `${formatForumCount(online.pagination.startItem)}-${formatForumCount(
          online.pagination.endItem,
        )}`
      : "0";

  return (
    <div className="space-y-3">
      <section className="border border-row-border">
        <div className="border-b border-row-border px-3 py-2">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Who&apos;s online
          </p>
          <h2 className="mt-1 text-xl font-semibold md:text-2xl">
            Active members
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
            Registered forum members active since{" "}
            {formatForumDateTime(online.activeSince)}.
          </p>
        </div>
        <ForumMetricBar
          className="border-0 border-b border-row-border"
          items={[
            {
              label: "Registered",
              value: countLabel,
            },
            {
              label: "Showing",
              value: showingLabel,
            },
            {
              label: "Roster page",
              value: `${online.pagination.page}/${pageCountLabel}`,
            },
          ]}
        />
        <div className="grid gap-px border-b border-row-border bg-row-border md:grid-cols-[minmax(0,1fr)_12rem_12rem]">
          <ForumOnlineSignal
            label="Active since"
            value={formatForumDateTime(online.activeSince)}
          />
          <ForumOnlineSignal label="Order" value="Newest activity" />
          <ForumOnlineSignal label="Window" value="15m presence" />
        </div>
        {online.members.length > 0 ? (
          <>
            <div className="divide-y divide-row-border md:hidden">
              {online.members.map((member) => (
                <ForumOnlineMobileRow key={member.userId} member={member} />
              ))}
            </div>
            <table className="hidden w-full table-fixed border-collapse md:table">
              <caption className="sr-only">Online forum members</caption>
              <thead>
                <tr className="border-b border-row-border font-mono text-[10px] uppercase text-muted-foreground">
                  <th className="px-3 py-2 text-left font-normal" scope="col">
                    Roster
                  </th>
                  <th className="px-3 py-2 text-left font-normal" scope="col">
                    Activity / location
                  </th>
                  <th
                    className="w-24 px-3 py-2 text-left font-normal"
                    scope="col"
                  >
                    Posts
                  </th>
                  <th
                    className="w-28 px-3 py-2 text-left font-normal"
                    scope="col"
                  >
                    Reputation
                  </th>
                  <th
                    className="w-44 px-3 py-2 text-left font-normal"
                    scope="col"
                  >
                    Last active
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-row-border">
                {online.members.map((member) => (
                  <ForumOnlineDesktopRow key={member.userId} member={member} />
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="px-3 py-3 text-sm leading-5 text-muted-foreground">
            No registered members are active in the forum window.
          </p>
        )}
      </section>
      <ForumPaginationBar
        buildHref={(nextPage) =>
          nextPage === 1 ? "/forum/online" : `/forum/online?page=${nextPage}`
        }
        label="Online members"
        pagination={online.pagination}
      />
    </div>
  );
}

function ForumOnlineSignal({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background px-3 py-2">
      <p className="font-mono text-[10px] uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

function ForumOnlineDesktopRow({
  member,
}: {
  member: ForumOnlineMemberRecord;
}) {
  return (
    <tr className="odd:bg-muted/15">
      <th
        className="px-3 py-2.5 text-left align-middle font-normal"
        scope="row"
      >
        <ForumOnlineIdentity member={member} size="desktop" />
      </th>
      <td className="px-3 py-2.5 align-middle">
        <ForumOnlineLocation location={member.location} />
      </td>
      <td className="px-3 py-2.5 align-middle font-mono text-[11px] uppercase">
        {formatForumCount(member.postCount)}
      </td>
      <td className="px-3 py-2.5 align-middle font-mono text-[11px] uppercase">
        {formatForumReputation(member.reputationScore)}
      </td>
      <td className="px-3 py-2.5 align-middle">
        <p className="text-sm font-medium">
          {formatForumDateTime(member.lastSeenAt)}
        </p>
        <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
          Last active
        </p>
      </td>
    </tr>
  );
}

function ForumOnlineMobileRow({ member }: { member: ForumOnlineMemberRecord }) {
  return (
    <article className="grid gap-3 px-3 py-3 odd:bg-muted/15">
      <ForumOnlineIdentity member={member} size="mobile" />
      <div className="border border-row-border">
        <div className="border-b border-row-border px-3 py-2">
          <ForumOnlineLocation location={member.location} />
        </div>
        <dl className="grid gap-px bg-row-border text-center font-mono text-[10px] uppercase text-muted-foreground sm:grid-cols-3">
          <ForumOnlineStat label="Posts">
            {formatForumCount(member.postCount)}
          </ForumOnlineStat>
          <ForumOnlineStat label="Rep">
            {formatForumReputation(member.reputationScore)}
          </ForumOnlineStat>
          <ForumOnlineStat label="Last active">
            {formatForumDateTime(member.lastSeenAt)}
          </ForumOnlineStat>
        </dl>
      </div>
    </article>
  );
}

function ForumOnlineIdentity({
  member,
}: {
  member: ForumOnlineMemberRecord;
  size: "desktop" | "mobile";
}) {
  return (
    <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3">
      <ForumAvatar
        alt={`${member.displayName} avatar`}
        className="size-10"
        name={member.displayName}
        src={member.avatarUrl}
      />
      <div className="min-w-0">
        <ForumLink
          className="focus-ring block truncate text-base font-semibold leading-tight hover:text-primary"
          href={forumMemberProfilePath(member.username)}
          prefetch
        >
          {member.displayName}
        </ForumLink>
        <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
          /members/{member.username}
        </p>
        <p className="mt-1 break-words font-mono text-[10px] uppercase text-muted-foreground">
          {member.rank}
          {member.customTitle ? ` / ${member.customTitle}` : ""}
        </p>
      </div>
    </div>
  );
}

function ForumOnlineLocation({
  location,
}: {
  location: ForumOnlineLocationRecord;
}) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] uppercase text-muted-foreground">
        {formatPresenceLocationType(location.type)}
      </p>
      <p className="mt-1 truncate text-sm font-semibold">
        {location.href ? (
          <ForumLink
            className="focus-ring hover:text-primary"
            href={location.href}
            prefetch
          >
            {location.label}
          </ForumLink>
        ) : (
          location.label
        )}
      </p>
    </div>
  );
}

function ForumOnlineStat({
  children,
  label,
}: {
  children: string;
  label: string;
}) {
  return (
    <div className="bg-background px-2 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-foreground">{children}</dd>
    </div>
  );
}

function formatPresenceLocationType(type: ForumOnlineLocationRecord["type"]) {
  if (type === "index") {
    return "Board index";
  }
  if (type === "board") {
    return "Board";
  }
  if (type === "thread") {
    return "Thread";
  }
  if (type === "search") {
    return "Search";
  }
  if (type === "members") {
    return "Members";
  }
  if (type === "online") {
    return "Who's online";
  }
  if (type === "newPosts") {
    return "New posts";
  }
  if (type === "help") {
    return "Help";
  }
  if (type === "calendar") {
    return "Calendar";
  }
  if (type === "userCp") {
    return "User CP";
  }
  if (type === "messages") {
    return "Messages";
  }
  if (type === "subscriptions") {
    return "Subscriptions";
  }
  if (type === "saved") {
    return "Saved threads";
  }
  return "Forum";
}

function formatForumReputation(value: number) {
  return `${value > 0 ? "+" : ""}${formatForumCount(value)}`;
}

function parseOnlinePage(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.floor(parsed);
}
