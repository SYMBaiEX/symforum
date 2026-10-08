"use client";

import { reportAppError } from "@/components/app-error-surface";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportAppError(error, {
      scope: "app-router",
      eventType: "global_error",
      component: "app/global-error",
      metadata: { digest: error.digest },
    });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main style={{ padding: "3rem", fontFamily: "monospace" }}>
          <p>SYMBaiEX / global error</p>
          <h1>Something failed before the shell could recover.</h1>
          <p>The issue was logged for review.</p>
          <p style={{ marginTop: "1.5rem" }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                cursor: "pointer",
                fontFamily: "monospace",
                padding: "0.5rem 1rem",
                marginRight: "1rem",
              }}
            >
              Reload
            </button>
            {/* Global error replaces the root layout, so the router (and <Link/>) may be broken; a full-page navigation is the reliable escape hatch. */}
            <a href="/" style={{ fontFamily: "monospace" }}>
              Back to home
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
