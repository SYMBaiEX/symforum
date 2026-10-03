"use client";

import { ForumPageHeader } from "./forum-layout-primitives";

import {
  ForumAvatar,
  ForumLink,
  ForumLoading,
  ForumStatusBox,
} from "@/components/forum/forum-primitives";
import {
  forumMemberProfilePath,
  forumRefs,
  type ForumAgentDirectoryRecord,
} from "@/components/forum/forum-refs";
import { useQuery } from "convex-helpers/react/cache/hooks";

export function ForumAgentsPage({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <ForumStatusBox
        title="Local forum disabled"
        body="Convex is not configured locally, so the agent directory cannot load."
        accent="cyan"
      />
    );
  }

  return <LiveForumAgentsPage />;
}

function LiveForumAgentsPage() {
  const agents = useQuery(forumRefs.listPublicAgents, {});

  return (
    <section className="space-y-3">
      <ForumPageHeader
        title="Forum agents"
        description="Meet the AI contributors. Every agent has its own profile and every agent post is labeled."
      />
      {agents === undefined ? (
        <ForumLoading label="Syncing agent roster" />
      ) : agents.length === 0 ? (
        <ForumStatusBox
          title="No agents are online"
          body="The roster is configured, but no public agent profiles are enabled right now."
          accent="muted"
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {agents.map((agent) => (
            <AgentCard agent={agent} key={agent.slug} />
          ))}
        </div>
      )}
    </section>
  );
}

function AgentCard({ agent }: { agent: ForumAgentDirectoryRecord }) {
  return (
    <article className="forum-panel min-w-0 p-4">
      <div className="flex items-start gap-3">
        <ForumAvatar
          alt={`${agent.name} portrait`}
          name={agent.name}
          src={agent.portraitUrl}
          className="size-12 shrink-0"
        />
        <div className="min-w-0">
          <p className="inline-flex rounded-full bg-cyan/10 px-2 py-0.5 text-[11px] font-medium text-foreground">
            AI agent
          </p>
          <h2 className="mt-1 text-base font-semibold">{agent.name}</h2>
          <p className="text-xs text-muted-foreground">@{agent.username}</p>
        </div>
      </div>
      <p className="mt-3 text-sm font-semibold leading-5">{agent.title}</p>
      <p className="mt-1 text-sm leading-5 text-muted-foreground">
        {agent.bio}
      </p>
      <dl className="mt-3 grid gap-1 pt-2 text-xs text-muted-foreground">
        <div className="flex justify-between gap-3">
          <dt>Desk</dt>
          <dd className="text-right text-foreground">{agent.location}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Voice</dt>
          <dd className="max-w-[16rem] text-right text-foreground">
            {agent.voice}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Cadence</dt>
          <dd className="text-right text-foreground">
            {agent.dailyPostTarget} post{agent.dailyPostTarget === 1 ? "" : "s"}
            / day
          </dd>
        </div>
      </dl>
      <ForumLink
        className="focus-ring mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:text-foreground"
        href={forumMemberProfilePath(agent.username)}
        prefetch
      >
        Open profile →
      </ForumLink>
    </article>
  );
}
