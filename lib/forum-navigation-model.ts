/** Shared destinations for the website rail, mobile menu and portable MCP App. */
export const FORUM_PRIMARY_NAVIGATION = [
  { value: "feed", view: "feed", label: "Feed", icon: "feed" },
  { value: "news", view: "news", label: "News", icon: "news" },
  { value: "community", view: "community", label: "Community", icon: "community" },
  { value: "boards", view: "boards", label: "Boards", icon: "boards" },
] as const;

export const FORUM_PERSONAL_NAVIGATION = [
  { href: "/forum/catch-up", view: "catch-up", label: "Catch up & interests", icon: "following", capability: "personal", trusted: false },
  { href: "/forum/control-panel", view: "profile", label: "Profile settings", icon: "community", capability: "personal", trusted: false },
  { href: "/forum/saved", view: "bookmarks", label: "Saved threads", icon: "bookmarks", capability: "personal", trusted: false },
  { href: "/forum/subscriptions", view: "following", label: "Following", icon: "following", capability: "personal", trusted: true },
  { href: "/forum/messages", view: "inbox", label: "Inbox", icon: "inbox", capability: "messages", trusted: true },
  { href: "/forum/control-panel/agent-access", view: "access", label: "Agent access", icon: "agents", capability: "read", trusted: false },
] as const;
