import { describe, expect, test } from "vitest";
import {
  communityActorKind,
  deriveForumCommunityOutcomes,
  type CommunityThreadObservation,
} from "./forum-community-quality";

const observation = (
  patch: Partial<CommunityThreadObservation> = {},
): CommunityThreadObservation => ({
  threadId: "thread-1",
  actorKind: "agent",
  kind: "discussion",
  totalPublishedReplies: 0,
  acceptedAnswerValid: false,
  replies: [],
  repliesLimited: false,
  publicationFollowUpValid: false,
  ...patch,
});

describe("observed forum community outcomes", () => {
  test("does not relabel agent assistance as an unaided human or a missing account as an agent", () => {
    expect(communityActorKind({ isAgent: true }, true)).toBe("agent");
    expect(communityActorKind({}, true)).toBe("assisted");
    expect(communityActorKind({})).toBe("human");
    expect(communityActorKind(null, true)).toBe("unknown");
  });
  test("separates participation, resolutions and actual follow-ups from opening counts", () => {
    const outcomes = deriveForumCommunityOutcomes([
      observation({ actorKind: "human", kind: "question" }),
      observation({
        actorKind: "assisted",
        kind: "question",
        totalPublishedReplies: 1,
        acceptedAnswerValid: true,
        replies: [{ actorKind: "agent", isThreadAuthor: false }],
      }),
      observation({
        totalPublishedReplies: 4,
        publicationFollowUpValid: true,
        replies: [
          { actorKind: "agent", isThreadAuthor: true },
          { actorKind: "human", isThreadAuthor: false },
          { actorKind: "assisted", isThreadAuthor: false },
          { actorKind: "agent", isThreadAuthor: true },
        ],
      }),
      observation({ actorKind: "unknown" }),
    ]);
    expect(outcomes).toMatchObject({
      sampledThreadCount: 4,
      sampledReplyCount: 5,
      threadsByActor: { human: 1, assisted: 1, agent: 1, unknown: 1 },
      repliesByActor: { human: 1, assisted: 1, agent: 3, unknown: 0 },
      repliesOnAgentThreads: { human: 1, assisted: 1, agent: 2, unknown: 0 },
      humanQuestions: {
        unassisted: 1,
        assisted: 1,
        unanswered: 1,
        resolved: 1,
      },
      threadsWithHumanProfileParticipation: 3,
      agentThreadsWithHumanProfileReplies: 1,
      agentAuthorFollowUpThreads: 1,
      publicationFollowUpThreads: 1,
      saves: null,
    });
  });
  test("does not count a solo agent reply as conversational follow-through", () => {
    const result = deriveForumCommunityOutcomes([
      observation({
        repliesLimited: true,
        replies: [{ actorKind: "agent", isThreadAuthor: true }],
      }),
    ]);
    expect(result.agentAuthorFollowUpThreads).toBe(0);
    expect(result.threadsWithLimitedReplySamples).toBe(1);
    expect(result.agentThreadsWithHumanProfileReplies).toBe(0);
  });
  test("empty samples remain zero counts with unavailable measurements explicitly null", () => {
    expect(deriveForumCommunityOutcomes([])).toMatchObject({
      sampledThreadCount: 0,
      humanQuestions: {
        unassisted: 0,
        assisted: 0,
        unanswered: 0,
        resolved: 0,
      },
      saves: null,
    });
  });
});
