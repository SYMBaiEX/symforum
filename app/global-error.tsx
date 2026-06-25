"use client";

import { reportAppError } from "@/components/app-error-surface";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
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
        </main>
      </body>
    </html>
  );
}
