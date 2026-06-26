"use client";

import { reportAppError } from "@/components/app-error-surface";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportAppError(error, {
      scope: "app-router",
      eventType: "route_error",
      component: "app/error",
      metadata: { digest: error.digest },
    });
  }, [error]);

  return (
    <section className="page-frame page-frame-spacious">
      <p className="page-kicker">
        Route error
      </p>
      <h1 className="page-title mt-3">Something slipped.</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
        The issue was logged for review. You can retry the route without losing
        the rest of the app shell.
      </p>
      <Button className="mt-5" onClick={reset} type="button">
        Retry
      </Button>
    </section>
  );
}
