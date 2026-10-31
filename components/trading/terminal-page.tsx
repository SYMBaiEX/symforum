"use client";

import { CommunityHub } from "@/components/community/community-hub";
import { useSearchParams } from "next/navigation";
import { ForumLink } from "@/components/forum/forum-link";
import { useForumRuntime } from "@/components/forum/forum-runtime-context";
import { parseTerminalMint } from "@/lib/terminal-selection";
import { ForumTerminal } from "./forum-terminal";
import { ResearchPurchase } from "./research-purchase";
import { TerminalBoundary } from "./terminal-boundary";
import styles from "./forum-terminal.module.css";

export function TerminalPage({ enabled }: { enabled: boolean }) {
  const { host } = useForumRuntime();
  if (host !== "website") return <ForumTerminal enabled={enabled} />;
  return <WebsiteTerminalPage enabled={enabled} />;
}

function WebsiteTerminalPage({ enabled }: { enabled: boolean }) {
  const searchParams = useSearchParams();
  const selection = parseTerminalMint(searchParams.getAll("mint"));
  if (selection.status === "invalid")
    return (
      <section className={styles.native}>
        <h1>Trading terminal</h1>
        <p role="alert">
          This link does not identify one valid Solana mint. No token, quote or
          wallet request was opened.
        </p>
        <ForumLink
          className="focus-ring underline underline-offset-4"
          href="/forum/trade"
        >
          Return to the terminal
        </ForumLink>
      </section>
    );
  const initialMint = selection.status === "valid" ? selection.mint : undefined;
  return (
    <ForumTerminal
      key={initialMint ?? "default"}
      enabled={enabled}
      initialMint={initialMint}
      renderUtilities={(mint, active) => (
        <div className={styles.utilityGrid}>
          <div hidden={active !== "research"}>
            <TerminalBoundary label="Research purchases">
              <ResearchPurchase key={mint} mint={mint} />
            </TerminalBoundary>
          </div>
          <div hidden={active !== "community"}>
            <TerminalBoundary label="Community utilities">
              <CommunityHub key={mint} mint={mint} compact />
            </TerminalBoundary>
          </div>
        </div>
      )}
    />
  );
}
