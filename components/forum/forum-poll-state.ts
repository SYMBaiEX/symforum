import type {
  ForumCategoryWriteAccess,
  ForumPollRecord,
} from "@/lib/convex-refs";

type ForumPollInteractionInput = {
  authLoading: boolean;
  isAuthenticated: boolean;
  poll: Pick<ForumPollRecord, "status" | "viewerCanVote" | "viewerOptionId">;
  pollAccess?: ForumCategoryWriteAccess;
};

export type ForumPollInteractionState = {
  canSelect: boolean;
  showVoteButton: boolean;
  statusMessage: string;
  voteButtonDisabled: boolean;
  voteButtonLabel: string;
};

export function forumPollInteractionState({
  authLoading,
  isAuthenticated,
  poll,
  pollAccess,
}: ForumPollInteractionInput): ForumPollInteractionState {
  if (poll.viewerOptionId) {
    return {
      canSelect: false,
      showVoteButton: false,
      statusMessage: "Your vote is recorded. Results are shown below.",
      voteButtonDisabled: true,
      voteButtonLabel: "Voted",
    };
  }

  if (poll.status === "closed") {
    return {
      canSelect: false,
      showVoteButton: false,
      statusMessage: "This poll is closed. Final results are shown below.",
      voteButtonDisabled: true,
      voteButtonLabel: "Poll closed",
    };
  }

  if (poll.viewerCanVote) {
    return {
      canSelect: true,
      showVoteButton: true,
      statusMessage: "Choose one option, then cast your vote.",
      voteButtonDisabled: false,
      voteButtonLabel: "Vote",
    };
  }

  if (authLoading) {
    return {
      canSelect: false,
      showVoteButton: true,
      statusMessage: "Checking your voting access...",
      voteButtonDisabled: true,
      voteButtonLabel: "Checking access...",
    };
  }

  if (!isAuthenticated) {
    return {
      canSelect: true,
      showVoteButton: true,
      statusMessage:
        "Sign in or create a SYM handle to vote. Your choice stays private until you submit it.",
      voteButtonDisabled: false,
      voteButtonLabel: "Sign in to vote",
    };
  }

  if (pollAccess === "staff" || pollAccess === "closed") {
    return {
      canSelect: false,
      showVoteButton: false,
      statusMessage: "Only forum staff can vote in this board.",
      voteButtonDisabled: true,
      voteButtonLabel: "Staff only",
    };
  }

  if (pollAccess === "trusted") {
    return {
      canSelect: false,
      showVoteButton: false,
      statusMessage:
        "A moderator needs to approve your forum access before you can vote here.",
      voteButtonDisabled: true,
      voteButtonLabel: "Approval required",
    };
  }

  return {
    canSelect: false,
    showVoteButton: false,
    statusMessage: "Your account cannot vote in this poll right now.",
    voteButtonDisabled: true,
    voteButtonLabel: "Voting unavailable",
  };
}
