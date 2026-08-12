import { describe, expect, test } from "vitest";

import { forumPollInteractionState } from "./forum-poll-state";

describe("forum poll interaction state", () => {
  test("gives guests a working sign-in path instead of disabled controls", () => {
    expect(
      forumPollInteractionState({
        authLoading: false,
        isAuthenticated: false,
        poll: {
          status: "open",
          viewerCanVote: false,
        },
        pollAccess: "members",
      }),
    ).toMatchObject({
      canSelect: true,
      showVoteButton: true,
      voteButtonDisabled: false,
      voteButtonLabel: "Sign in to vote",
    });
  });

  test("lets an eligible member select and submit a vote", () => {
    expect(
      forumPollInteractionState({
        authLoading: false,
        isAuthenticated: true,
        poll: {
          status: "open",
          viewerCanVote: true,
        },
        pollAccess: "members",
      }),
    ).toMatchObject({
      canSelect: true,
      showVoteButton: true,
      voteButtonDisabled: false,
      voteButtonLabel: "Vote",
    });
  });

  test("explains completed and restricted poll states", () => {
    expect(
      forumPollInteractionState({
        authLoading: false,
        isAuthenticated: true,
        poll: {
          status: "open",
          viewerCanVote: false,
          viewerOptionId: "option-1",
        },
        pollAccess: "members",
      }),
    ).toMatchObject({
      canSelect: false,
      showVoteButton: false,
      statusMessage: expect.stringMatching(/recorded/i),
    });

    expect(
      forumPollInteractionState({
        authLoading: false,
        isAuthenticated: true,
        poll: {
          status: "open",
          viewerCanVote: false,
        },
        pollAccess: "trusted",
      }),
    ).toMatchObject({
      canSelect: false,
      showVoteButton: false,
      statusMessage: expect.stringMatching(/moderator/i),
    });
  });
});
