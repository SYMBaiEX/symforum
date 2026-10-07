/** Outcomes describe observed forum participation, never inferred human intent. */
export type CommunityActorKind = "human" | "assisted" | "agent" | "unknown";

export function communityActorKind(
  author: { isAgent?: boolean } | null,
  agentAssisted?: boolean,
): CommunityActorKind {
  if (author === null) return "unknown";
  if (author.isAgent === true) return "agent";
  return agentAssisted === true ? "assisted" : "human";
}

export interface CommunityThreadObservation {
  threadId: string;
  actorKind: CommunityActorKind;
  kind: "discussion" | "question" | "link" | "showcase";
  totalPublishedReplies: number;
  acceptedAnswerValid: boolean;
  replies: { actorKind: CommunityActorKind; isThreadAuthor: boolean }[];
  repliesLimited: boolean;
  publicationFollowUpValid: boolean;
}

const actorCounts = () => ({ human: 0, assisted: 0, agent: 0, unknown: 0 });

export function deriveForumCommunityOutcomes(
  threads: readonly CommunityThreadObservation[],
) {
  const threadsByActor = actorCounts();
  const repliesByActor = actorCounts();
  const repliesOnAgentThreads = actorCounts();
  const humanQuestions = {
    unassisted: 0,
    assisted: 0,
    unanswered: 0,
    resolved: 0,
  };
  let threadsWithHumanProfileParticipation = 0;
  let agentThreadsWithHumanProfileReplies = 0;
  let agentAuthorFollowUpThreads = 0;
  let publicationFollowUpThreads = 0;
  let sampledReplyCount = 0;
  let threadsWithLimitedReplySamples = 0;
  for (const thread of threads) {
    threadsByActor[thread.actorKind] += 1;
    const humanProfile =
      thread.actorKind === "human" || thread.actorKind === "assisted";
    if (humanProfile && thread.kind === "question") {
      humanQuestions[
        thread.actorKind === "human" ? "unassisted" : "assisted"
      ] += 1;
      if (thread.totalPublishedReplies === 0) humanQuestions.unanswered += 1;
      if (thread.acceptedAnswerValid) humanQuestions.resolved += 1;
    }
    let otherParticipantSeen = false;
    let authorFollowedUp = false;
    let humanReplied = false;
    for (const reply of thread.replies) {
      sampledReplyCount += 1;
      repliesByActor[reply.actorKind] += 1;
      if (thread.actorKind === "agent")
        repliesOnAgentThreads[reply.actorKind] += 1;
      if (reply.actorKind === "human" || reply.actorKind === "assisted")
        humanReplied = true;
      if (!reply.isThreadAuthor) otherParticipantSeen = true;
      else if (otherParticipantSeen) authorFollowedUp = true;
    }
    if (humanProfile || humanReplied) threadsWithHumanProfileParticipation += 1;
    if (thread.actorKind === "agent" && humanReplied)
      agentThreadsWithHumanProfileReplies += 1;
    if (thread.actorKind === "agent" && authorFollowedUp)
      agentAuthorFollowUpThreads += 1;
    if (thread.publicationFollowUpValid) publicationFollowUpThreads += 1;
    if (thread.repliesLimited) threadsWithLimitedReplySamples += 1;
  }
  return {
    sampledThreadCount: threads.length,
    sampledReplyCount,
    threadsByActor,
    repliesByActor,
    repliesOnAgentThreads,
    humanQuestions,
    threadsWithHumanProfileParticipation,
    agentThreadsWithHumanProfileReplies,
    agentAuthorFollowUpThreads,
    publicationFollowUpThreads,
    threadsWithLimitedReplySamples,
    saves: null,
  };
}

export const COMMUNITY_OUTCOME_COVERAGE_NOTES = [
  "This is a bounded sample of recently active threads, not a forum-wide census or cohort conversion rate.",
  "Reply counts cover sampled active replies within the requested window; assisted human-profile replies are not evidence of unaided human participation.",
  "Unanswered means the stored published reply count is zero. Resolution requires a currently active accepted-answer post on the same question thread.",
  "Author follow-ups are observed replies after another participant in chronological sampled replies; a publication follow-up is a separately recorded run follow-up with a currently active post.",
  "Saves are unavailable for this sample: bookmarks have no thread index. View counts, unique human readers, retained readers and answer usefulness are not inferred.",
] as const;
