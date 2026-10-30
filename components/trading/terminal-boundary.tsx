"use client";

import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** A failed optional read must not unmount a separate wallet approval panel. */
export class TerminalBoundary extends Component<
  { children: ReactNode; label: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="p-4 text-sm" role="status">
        <p>{this.props.label} is temporarily unavailable.</p>
        <p className="mt-2 text-muted-foreground">
          Other panels remain available. Reload when no wallet request is open.
        </p>
        <Button
          className="mt-3"
          variant="outline"
          onClick={() => window.location.reload()}
        >
          Reload page
        </Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
