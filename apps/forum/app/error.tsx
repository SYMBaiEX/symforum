"use client";

import {
  ForumStatusBox,
  ForumUtilityNav,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";

export default function ForumErrorRoute({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="page-frame page-frame-dense">
      <ForumUtilityNav className="mb-2" />
      <ForumStatusBox
        title="Forum unavailable"
        body="This board view failed to load. Try again, or return to the forum index."
        accent="magenta"
        action={
          <Button className="rounded-none" type="button" onClick={reset}>
            Retry
          </Button>
        }
      />
    </section>
  );
}
