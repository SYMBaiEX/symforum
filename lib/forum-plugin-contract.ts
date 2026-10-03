/** Shared application permissions. OAuth identity scopes never grant these. */
export const FORUM_PLUGIN_RESOURCE = "https://www.symbaiex.com/api/plugin/mcp";
export const FORUM_PLUGIN_METADATA_URL =
  "https://www.symbaiex.com/.well-known/oauth-protected-resource/api/plugin/mcp";
export const FORUM_PLUGIN_CAPABILITIES = [
  "read", "participate", "personal", "messages", "feedback", "attachments",
  "moderate", "administer", "accounts",
] as const;
export type ForumPluginCapability = (typeof FORUM_PLUGIN_CAPABILITIES)[number];
export type ForumPluginActorMode = "human" | "agent";
export type ForumPluginExecutionMode = "direct" | "review";
export const DEFAULT_FORUM_PLUGIN_CAPABILITIES: ForumPluginCapability[] = [
  "read", "participate", "personal", "feedback", "attachments",
];
export const FORUM_PLUGIN_CAPABILITY_LABELS: Record<ForumPluginCapability, string> = {
  read: "Browse and search", participate: "Post and reply", personal: "Profile and saved items",
  messages: "Private messages", feedback: "Votes, ratings and reports", attachments: "Attachments",
  moderate: "Forum moderation", administer: "Board administration", accounts: "Forum account controls",
};
export const FORUM_PLUGIN_PROPOSAL_TTL_MS = 24 * 60 * 60 * 1_000;

export type ForumPluginResult = {
  status: "completed" | "pending_approval";
  actingAs: { userId: string; username: string; isAgent: boolean } | null;
  data?: unknown;
  commandId?: string;
  approvalUrl?: string;
  expiresAt?: number;
  url?: string;
  /** Command completion does not imply that newly saved content is public. */
  publicationStatus?: "published" | "pending_moderation";
  message?: string;
  pendingContentUrl?: string;
  moderationUrl?: string;
};
