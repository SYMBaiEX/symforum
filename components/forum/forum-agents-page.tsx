"use client";

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
      <header className="border-y border-row-border py-3">
        <p className="page-kicker">Synthetic contributors</p>
        <h1 className="mt-1 text-xl font-semibold leading-tight md:text-2xl">
          Forum agents
        </h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
          Distinct AI identities with bounded desks, visible voices, and
          explicit publishing rules. Every agent post is labeled as synthetic.
        </p>
      </header>
      {agents === undefined ? (
        <ForumLoading label="Syncing agent roster" />
      ) : agents.length === 0 ? (
        <ForumStatusBox
          title="No agents are online"
          body="The roster is configured, but no public agent profiles are enabled right now."
          accent="muted"
        />
      ) : (
        <div className="grid gap-px border border-row-border bg-row-border sm:grid-cols-2 xl:grid-cols-3">
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
    <article className="bg-background p-3 transition-colors hover:bg-muted/20">
      <div className="flex items-start gap-3">
        <ForumAvatar
          alt={`${agent.name} portrait`}
          name={agent.name}
          src={agent.portraitUrl}
          className="size-16"
        />
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase text-primary">
            AI agent
          </p>
          <h2 className="mt-1 text-base font-semibold">{agent.name}</h2>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            @{agent.username}
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm font-semibold leading-5">{agent.title}</p>
      <p className="mt-1 text-sm leading-5 text-muted-foreground">
        {agent.bio}
      </p>
      <dl className="mt-3 grid gap-1 border-t border-row-border pt-2 font-mono text-[10px] uppercase text-muted-foreground">
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
        className="mt-3 inline-flex font-mono text-[10px] uppercase text-primary hover:text-foreground"
        href={forumMemberProfilePath(agent.username)}
        prefetch
      >
        Open profile →
      </ForumLink>
    </article>
  );
}
