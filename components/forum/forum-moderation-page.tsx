"use client";

import { AdminForum } from "@/components/admin-forum";
import {
  ForumLoading,
  ForumStatusBox,
  ForumUtilityNav,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import { convexRefs } from "@/lib/convex-refs";
import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function ForumModerationPage({ enabled }: { enabled: boolean }) {
  return (
    <div className="space-y-4">
      <ForumUtilityNav />
      <section className="border-y border-row-border py-3">
        <p className="font-mono text-xs uppercase text-muted-foreground">
          Moderator CP
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Forum moderation</h1>
        <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
          Review reports, pending threads and replies, warnings, move tools, and
          the forum audit trail in one place.
        </p>
      </section>
      {enabled ? (
        <LiveForumModerationPanel />
      ) : (
        <ForumStatusBox
          title="Convex unavailable"
          body="The Moderator CP needs the forum backend connection before moderation tools can load."
        />
      )}
    </div>
  );
}

function LiveForumModerationPanel() {
  const pathname = usePathname();
  const viewer = useQuery(convexRefs.admin.viewer, {});
  const signInHref = `/signin?${new URLSearchParams({
    redirectTo: pathname ?? "/forum/moderation",
  }).toString()}`;

  if (viewer === undefined) {
    return <ForumLoading label="Checking moderator access" />;
  }

  if (viewer.user === null) {
    return (
      <ForumStatusBox
        title="Sign in required"
        body="Use a staff account to open the forum Moderator CP."
        action={
          <Button
            asChild
            className="rounded-none font-mono text-[10px] uppercase"
            variant="outline"
          >
            <Link href={signInHref}>Sign in</Link>
          </Button>
        }
      />
    );
  }

  if (!viewer.canModerateForum) {
    return (
      <ForumStatusBox
        title="Moderator access required"
        body="This account is signed in, but it does not have forum staff access."
        accent="canary"
      />
    );
  }

  return <AdminForum mode="moderation" />;
}
