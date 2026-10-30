"use client";

import { CommunityHub } from "@/components/community/community-hub";
import { ForumTerminal } from "./forum-terminal";
import { ResearchPurchase } from "./research-purchase";
import { TerminalBoundary } from "./terminal-boundary";
import styles from "./forum-terminal.module.css";

export function TerminalPage({ enabled }: { enabled: boolean }) {
  return (
    <ForumTerminal
      enabled={enabled}
      renderUtilities={(mint) => (
        <div className={styles.utilityGrid}>
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
