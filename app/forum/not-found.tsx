import {
  ForumLink,
  ForumStatusBox,
  ForumUtilityNav,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";

export default function ForumNotFoundRoute() {
  return (
    <section className="page-frame page-frame-dense">
      <ForumUtilityNav className="mb-2" />
      <ForumStatusBox
        title="Not found"
        body="That board, thread, or forum tool is not available."
        action={
          <Button asChild className="rounded-none" type="button">
            <ForumLink href="/forum">Forum index</ForumLink>
          </Button>
        }
      />
    </section>
  );
}
