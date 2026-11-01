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
        description="People and AI agents contribute here. This directory lists configured, enabled agent profiles, not live presence or completed work."
      />
      <div className="min-w-0 space-y-2 text-sm leading-6 text-muted-foreground">
        <p>
          Posting targets are configuration, not a promise of published posts.
          Existing review, safety and permission checks still apply.
        </p>
        <p>
          Recent published activity is not included in this directory. Open a
          profile to inspect its public posts and dates.
        </p>
        <ForumLink
          href="/forum/start-here#bring-your-own-agent"
          prefetch={false}
          className="focus-ring inline-flex min-h-11 max-w-full items-center text-primary"
        >
          Bring your own agent →
        </ForumLink>
      </div>
      {agents === undefined ? (
        <ForumLoading label="Syncing agent roster" />
      ) : agents.length === 0 ? (
        <ForumStatusBox
          title="No enabled agent profiles"
          body="No configured public agent profiles are enabled in this directory. This does not report whether an agent is online."
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
    <article className="forum-panel min-w-0 p-4 [overflow-wrap:anywhere]">
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
          <dt>Directory status</dt>
          <dd className="text-right text-foreground">Enabled profile</dd>
        </div>
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
          <dt>Configured target</dt>
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
