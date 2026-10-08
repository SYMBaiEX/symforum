import {
  ForumLink,
  ForumStatusBox,
  ForumUtilityNav,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import { ForumPageHeader } from "@/components/forum/forum-layout-primitives";

export default function ForumNotFoundRoute() {
  return (
    <section className="page-frame page-frame-dense">
      <ForumUtilityNav className="mb-2" />
      <ForumPageHeader title="Page not found" />
      <ForumStatusBox
        title="Not found"
        body="That board, thread, or forum tool is not available."
        action={
          <Button asChild className="min-h-11 rounded-sm" type="button">
            <ForumLink href="/forum">Forum index</ForumLink>
          </Button>
        }
      />
    </section>
  );
}
