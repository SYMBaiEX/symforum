import { makeFunctionReference } from "convex/server";
import type {
  ForumPluginActorMode,
  ForumPluginCapability,
  ForumPluginExecutionMode,
  ForumPluginResult,
} from "@/lib/forum-plugin-contract";

export type ForumPluginIdentity = {
  userId: string;
  username: string;
  isAgent: boolean;
};
export type ForumBrowserContext = {
  connectionId: string;
  actorMode: ForumPluginActorMode;
  actingAs: ForumPluginIdentity;
  capabilities: ForumPluginCapability[];
  capabilityCeiling: ForumPluginCapability[];
  executionMode: ForumPluginExecutionMode;
  policyVersion: number;
};
export type ForumConnection = {
  _id: string;
  actorMode: ForumPluginActorMode;
  transport: "browser" | "oauth";
  actingAs: ForumPluginIdentity;
  credentialAgentId: string;
  capabilities: ForumPluginCapability[];
  capabilityCeiling: ForumPluginCapability[];
  executionMode: ForumPluginExecutionMode;
  policyVersion: number;
  status: "pending" | "active" | "revoked";
  createdAt: number;
};
export type ForumAgentChoice = {
  agentId: string;
  userId: string;
  status: string;
  credentialKind?: string;
};
export type ForumConnectionOptions = {
  actorMode: ForumPluginActorMode;
  agentId?: string;
  capabilities: ForumPluginCapability[];
  executionMode: ForumPluginExecutionMode;
};
export type ForumProposal = {
  _id: string;
  connectionId: string;
  actorUserId: string;
  operation: string;
  argsJson: string;
  status: "pending" | "completed" | "rejected" | "expired" | "invalidated";
  createdAt: number;
  expiresAt: number;
};
export type ForumPendingAgentContent = {
  items: Array<{
    id: string;
    kind: "thread" | "reply";
    title: string;
    body: string;
    categoryName: string;
    actingAs: ForumPluginIdentity;
    createdAt: number;
    url: string;
  }>;
  limited: boolean;
  restricted?: boolean;
};
export const forumPluginRefs = {
  listMyPendingContent: makeFunctionReference<
    "query",
    Record<string, never>,
    ForumPendingAgentContent
  >("forumPlugin:listMyPendingContent"),
  listMyConnections: makeFunctionReference<
    "query",
    Record<string, never>,
    ForumConnection[]
  >("forumPluginAccess:listMyConnections"),
  listMyAgents: makeFunctionReference<
    "query",
    Record<string, never>,
    ForumAgentChoice[]
  >("forumPluginAccess:listMyAgents"),
  createBrowserConnection: makeFunctionReference<
    "mutation",
    ForumConnectionOptions,
    { connectionId: string }
  >("forumPluginAccess:createBrowserConnection"),
  updateConnection: makeFunctionReference<
    "mutation",
    ForumConnectionOptions & { connectionId: string },
    null
  >("forumPluginAccess:updateConnection"),
  revokeConnection: makeFunctionReference<
    "mutation",
    { connectionId: string },
    null
  >("forumPluginAccess:revokeConnection"),
  getBrowserContext: makeFunctionReference<
    "query",
    { connectionId: string },
    ForumBrowserContext | null
  >("forumPluginAccess:getBrowserContext"),
  complete: makeFunctionReference<
    "action",
    ForumConnectionOptions & { externalAuthId: string },
    { redirectUri: string }
  >("forumPluginOAuth:complete"),
  read: makeFunctionReference<
    "mutation",
    {
      connectionId?: string;
      expectedPolicyVersion?: number;
      idempotencyKey?: string;
      operation: string;
      args: Record<string, unknown>;
    },
    ForumPluginResult
  >("forumPlugin:read"),
  execute: makeFunctionReference<
    "mutation",
    {
      connectionId: string;
      expectedPolicyVersion?: number;
      operation: string;
      args: Record<string, unknown>;
      idempotencyKey: string;
    },
    ForumPluginResult
  >("forumPlugin:execute"),
  listCommands: makeFunctionReference<
    "query",
    { connectionId?: string },
    ForumProposal[]
  >("forumPlugin:listCommands"),
  approveCommand: makeFunctionReference<
    "mutation",
    { commandId: string },
    ForumPluginResult
  >("forumPlugin:approveCommand"),
  rejectCommand: makeFunctionReference<"mutation", { commandId: string }, null>(
    "forumPlugin:rejectCommand",
  ),
};
