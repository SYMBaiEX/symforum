"use client";

import { Component, createRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** A failed optional read must not unmount a separate wallet approval panel. */
export class TerminalBoundary extends Component<
  { children: ReactNode; label: string; recovery?: "read-only" },
  { failed: boolean }
> {
  state = { failed: false };
  private fallback = createRef<HTMLDivElement>();
  private retryButton = createRef<HTMLButtonElement>();
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div
        ref={this.fallback}
        className="min-w-0 p-4 text-sm [overflow-wrap:anywhere]"
        role="status"
      >
        <p>{this.props.label} is temporarily unavailable.</p>
        <p className="mt-2 text-muted-foreground">
          {this.props.recovery === "read-only"
            ? "Retry only this read-only panel. Other panels stay open; wallet requests and protected attempts are not restarted."
            : "Other panels remain available. Reload when no wallet request is open."}
        </p>
        <Button
          ref={this.retryButton}
          type="button"
          className="mt-3 min-h-11"
          variant="outline"
          aria-label={
            this.props.recovery === "read-only"
              ? `Retry panel: ${this.props.label}`
              : undefined
          }
          onClick={() => {
            if (this.props.recovery !== "read-only") {
              window.location.reload();
              return;
            }
            // Existing workspace scrollports own focus; never reset their state
            // or a sibling controller to recover this failed public subtree.
            const target =
              this.fallback.current?.parentElement?.closest<HTMLElement>(
                "[tabindex]",
              );
            this.setState({ failed: false }, () => {
              if (this.state.failed) this.retryButton.current?.focus();
              else if (target?.isConnected && target.getClientRects().length)
                target.focus({ preventScroll: true });
            });
          }}
        >
          {this.props.recovery === "read-only" ? "Retry panel" : "Reload page"}
        </Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
