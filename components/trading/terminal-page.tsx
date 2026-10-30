"use client";

import { CommunityHub } from "@/components/community/community-hub";
import { ForumTerminal } from "./forum-terminal";
import { ResearchPurchase } from "./research-purchase";
import { TerminalBoundary } from "./terminal-boundary";

export function TerminalPage({ enabled }: { enabled: boolean }) {
  return (
    <ForumTerminal
      enabled={enabled}
      renderUtilities={(mint) => (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <TerminalBoundary label="Research purchases">
            <ResearchPurchase key={mint} mint={mint} />
          </TerminalBoundary>
          <TerminalBoundary label="Community utilities">
            <CommunityHub key={mint} mint={mint} compact />
          </TerminalBoundary>
        </div>
      )}
    />
  );
}
