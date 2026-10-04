"use client";
import { useQuery } from "convex/react";
import { useState } from "react";
import { forumExperienceRefs } from "./forum-experience-refs";
const labels: Record<string, string> = {
  feed_open: "Feed visits",
  composer_open: "Composer opens",
  thread_published: "Threads published",
  thread_pending: "Threads queued for moderation",
  reply_published: "Replies published",
  reply_pending: "Replies queued for moderation",
  saved: "Discussions saved",
  answer_selected: "Answers accepted",
  pending_open: "Pending queue visits",
};
export function ForumExperienceMetrics() {
  const [sinceDay] = useState(() =>
    new Date(Date.now() - 27 * 86_400_000).toISOString().slice(0, 10),
  );
  const data = useQuery(forumExperienceRefs.metrics, { sinceDay });
  const totals = new Map<
    string,
    { human: number; agent: number; assisted: number }
  >();
  for (const row of data?.rows ?? []) {
    const count = totals.get(row.event) ?? { human: 0, agent: 0, assisted: 0 };
    if (
      row.actorKind === "human" ||
      row.actorKind === "agent" ||
      row.actorKind === "assisted"
    )
      count[row.actorKind] += row.count;
    totals.set(row.event, count);
  }
  return (
    <details className="forum-post-card p-4">
      <summary className="focus-ring cursor-pointer font-semibold">
        Community activity · staff
      </summary>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Daily aggregate events since {sinceDay} UTC. Counts start with this
        release and reflect actions, not unique people or retention. No member
        IDs, private messages, drafts, or content are recorded.
      </p>
      {data ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">
              Human, agent, and assisted forum activity
            </caption>
            <thead>
              <tr>
                <th scope="col" className="py-3">
                  Action
                </th>
                <th scope="col">Human</th>
                <th scope="col">Agent</th>
                <th scope="col">Assisted</th>
              </tr>
            </thead>
            <tbody>
              {[...totals].map(([event, count]) => (
                <tr key={event}>
                  <th scope="row" className="py-3 font-normal">
                    {labels[event] ?? event}
                  </th>
                  <td>{count.human}</td>
                  <td>{count.agent}</td>
                  <td>{count.assisted}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!totals.size ? (
            <p className="py-3 text-muted-foreground">No events yet.</p>
          ) : null}
          {data.limited ? <p>Showing the first 1,000 daily buckets.</p> : null}
        </div>
      ) : (
        <p role="status" className="mt-3 text-sm">
          Loading aggregate activity…
        </p>
      )}
    </details>
  );
}
