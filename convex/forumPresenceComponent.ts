import { Presence } from "@convex-dev/presence";
import { components } from "./_generated/api";

export const FORUM_PRESENCE_ROOM = "forum" as const;
export const forumPresenceComponent = new Presence<
  typeof FORUM_PRESENCE_ROOM,
  string
>(components.presence);
