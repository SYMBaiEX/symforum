"use client";

import { ForumPageHeader } from "./forum-layout-primitives";

import { asRoute } from "@/lib/typed-route";

import { AdminForum } from "@/components/admin-forum";
import {
  ForumLoading,
  ForumStatusBox,
  ForumUtilityNav,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import { convexRefs } from "@/lib/convex-refs";
import { useQuery } from "convex-helpers/react/cache/hooks";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function ForumModerationPage({ enabled }: { enabled: boolean }) {
  return (
    <div className="space-y-3">
      <ForumUtilityNav />
      <ForumPageHeader
        title="Forum moderation"
        description="Review reports, pending posts, warnings, and moderation history."
      />
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
          <Button asChild className="rounded-sm text-xs" variant="outline">
            <Link href={asRoute(signInHref)}>Sign in</Link>
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
