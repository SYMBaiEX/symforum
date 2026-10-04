import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  getFunctionName,
  type FunctionReference,
  type FunctionArgs,
  type FunctionReturnType,
} from "convex/server";
import { FORUM_PLUGIN_OPERATIONS } from "@/lib/forum-plugin-catalog";
import { forumHost, record } from "./host";
import { navigate } from "./router";
import { toast } from "sonner";

type Json = Record<string, unknown>;
type Entry = {
  data: unknown;
  error?: Error;
  loading: boolean;
  listeners: Set<() => void>;
  name: string;
  args: Json;
};
const cache = new Map<string, Entry>();
const retries = new Map<string, string>();
const desiredStates = new Map<string, Json>();
const inFlight = new Map<string, Promise<unknown>>();
let revision = 0;
const statusListeners = new Set<() => void>();
const emitStatus = () => {
  revision++;
  for (const listener of statusListeners) listener();
};
forumHost.subscribe(emitStatus);
export function useConvexAuth() {
  useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    () => revision,
    () => revision,
  );
  return {
    isAuthenticated: Boolean(record(forumHost.status.actingAs).userId),
    isLoading: !forumHost.ready,
  };
}
const aliases: Record<string, string> = {
  "forum:toggleThreadSubscription": "setThreadSubscription",
  "forum:toggleCategorySubscription": "setCategorySubscription",
  "forumAgentRoster:listPublicAgents": "listPublicAgents",
  "users:publicProfile": "getMemberProfile",
  "news:timeline": "listNewsFeed",
  "admin:forumOverview": "adminOverview",
  "admin:listForumCategories": "listCategoriesAdmin",
  "admin:listForumThreadPrefixes": "listThreadPrefixesAdmin",
  "admin:listForumAnnouncements": "listAnnouncementsAdmin",
  "admin:listForumHelpDocuments": "listHelpDocumentsAdmin",
  "admin:listForumCalendarEvents": "listCalendarEventsAdmin",
  "admin:listForumCategoryModerators": "listCategoryModeratorsAdmin",
  "admin:listForumBoardRules": "listBoardRulesAdmin",
  "admin:upsertForumThreadPrefix": "upsertThreadPrefixAdmin",
  "admin:upsertForumAnnouncement": "upsertAnnouncementAdmin",
  "admin:upsertForumHelpDocument": "upsertHelpDocumentAdmin",
  "admin:upsertForumCalendarEvent": "upsertCalendarEventAdmin",
  "admin:upsertForumBoardRules": "upsertBoardRulesAdmin",
  "admin:assignForumCategoryModerator": "assignCategoryModerator",
  "admin:removeForumCategoryModerator": "removeCategoryModerator",
};
export function operationForReference(name: string) {
  const operation = aliases[name] ?? name.split(":")[1];
  const resolved = FORUM_PLUGIN_OPERATIONS.find(
    (item) => item.operation === operation && item.name !== "forum_open",
  );
  if (!resolved)
    throw new Error(
      `This action is unavailable in the connected forum: ${name}.`,
    );
  return resolved;
}
function allowed(capability: string) {
  return (
    capability === "read" ||
    (Array.isArray(forumHost.status.capabilities) &&
      forumHost.status.capabilities.includes(capability))
  );
}
function navGuest() {
  return {
    authenticated: Boolean(record(forumHost.status.actingAs).userId),
    username: record(forumHost.status.actingAs).username ?? null,
    trusted: forumHost.status.postingTrust === "trusted",
    canModerate: allowed("moderate"),
    canManageBoards: allowed("administer"),
    unreadNotifications: 0,
    unreadPrivateMessages: 0,
  };
}

async function queryReference(name: string, args: Json): Promise<unknown> {
  if (name === "forum:feedAuthorizationFingerprint")
    return {
      fingerprint: JSON.stringify([
        forumHost.status.connectionId,
        forumHost.status.policyVersion,
        forumHost.status.actingAs,
      ]),
    };
  if (name === "forum:getMyForumExperience" && !allowed("personal"))
    return {
      defaultFeed: "discover",
      authorFilter: "all",
      mutedWords: [],
      onboardingCompleted: true,
      followingBoards: [],
      followingMembers: [],
    };
  if (name === "users:maybeViewer")
    return record(forumHost.status.actingAs).userId
      ? {
          ...record(forumHost.status.actingAs),
          _id: record(forumHost.status.actingAs).userId,
        }
      : null;
  if (name === "forum:getMyForumNavState" && !allowed("personal"))
    return navGuest();
  if (name === "admin:viewer")
    return {
      user: record(forumHost.status.actingAs).userId
        ? {
            ...record(forumHost.status.actingAs),
            _id: record(forumHost.status.actingAs).userId,
          }
        : null,
      canModerateForum: allowed("moderate"),
      canAdministerForum: allowed("administer"),
      canAdminForum: allowed("administer"),
      canAccessAdmin: allowed("moderate") || allowed("administer"),
      isOwner: false,
      ownerExists: true,
      canManageUsers: allowed("accounts"),
    };
  if (name === "interactions:summaries" || name === "interactions:summary") {
    const entityIds = Array.isArray(args.entityIds)
      ? args.entityIds
      : [args.entityId];
    const result = await forumHost.tool("forum_get_news_interactions", {
      hnItemIds: entityIds.map(Number),
    });
    const rows = record(result.data);
    return name.endsWith(":summary") ? rows[String(args.entityId)] : rows;
  }
  const operation = operationForReference(name);
  if (!allowed(operation.capability))
    throw new Error(
      `Enable ${operation.capability} access for this connection to use this page.`,
    );
  const result = await forumHost.tool(
    operation.name,
    name === "news:timeline" ? { ...args, limit: 30 } : args,
  );
  if (name === "news:timeline") {
    const data = record(result.data);
    return {
      ...data,
      stories: (Array.isArray(data.stories) ? data.stories : []).map(
        (value) => {
          const story = record(value);
          return {
            ...story,
            id: story.hnItemId,
            score: story.hnScore,
            descendants: story.hnCommentCount,
            time: story.timePosted,
          };
        },
      ),
    };
  }
  return result.data;
}
function keyFor(name: string, args: Json) {
  return JSON.stringify([
    forumHost.status.connectionId,
    record(forumHost.status.actingAs).userId,
    forumHost.status.policyVersion,
    name,
    args,
  ]);
}
function entryFor(name: string, args: Json) {
  const key = keyFor(name, args);
  let entry = cache.get(key);
  if (!entry) {
    entry = {
      data: undefined,
      loading: false,
      listeners: new Set(),
      name,
      args,
    };
    cache.set(key, entry);
  }
  return entry;
}
function load(entry: Entry) {
  if (entry.loading) return;
  entry.loading = true;
  void queryReference(entry.name, entry.args)
    .then(
      (data) => {
        entry.data = data;
        entry.error = undefined;
      },
      (error) => {
        entry.error = error instanceof Error ? error : new Error(String(error));
      },
    )
    .finally(() => {
      entry.loading = false;
      for (const listener of entry.listeners) listener();
    });
}
export function useQuery<Query extends FunctionReference<"query">>(
  reference: Query,
  args: FunctionArgs<Query> | "skip" = {} as FunctionArgs<Query>,
): FunctionReturnType<Query> | undefined {
  const currentRevision = useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    () => revision,
    () => revision,
  );
  const name = getFunctionName(reference);
  const entry = args === "skip" ? null : entryFor(name, args as Json);
  useEffect(() => {
    if (entry && forumHost.ready && entry.data === undefined && !entry.error)
      load(entry);
  }, [entry, currentRevision]);
  const data = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        if (!entry) return () => {};
        entry.listeners.add(listener);
        return () => entry.listeners.delete(listener);
      },
      [entry],
    ),
    () => entry?.error ?? entry?.data,
    () => undefined,
  );
  if (data instanceof Error) throw data;
  return data as FunctionReturnType<Query> | undefined;
}
export async function mutationReference(
  name: string,
  args: Json,
  authority = forumHost.authority(),
) {
  if (authority !== forumHost.authority())
    throw new Error(
      "The acting profile or permissions changed. Your draft is preserved; reopen this page before sending.",
    );
  const inputKey = keyFor(name, args);
  let operation: string;
  let payload = { ...args };
  if (name === "interactions:set") {
    operation = "setNewsInteraction";
    payload = {
      hnItemId: Number(args.entityId),
      vote: args.vote,
      saved: args.saved,
    };
  } else {
    operation = operationForReference(name).operation;
    if (
      name === "forum:toggleThreadSubscription" ||
      name === "forum:toggleCategorySubscription"
    ) {
      // Native controls toggle a displayed value. Resolve it to a desired state before committing.
      const cached = desiredStates.get(inputKey);
      if (cached) payload = cached;
      else {
        const collection = await queryReference(
          name.includes("Thread")
            ? "forum:listMyThreadSubscriptions"
            : "forum:listMyCategorySubscriptions",
          {},
        );
        const rows = Array.isArray(collection)
          ? collection
          : (record(collection).threads ??
            record(collection).categories ??
            record(collection).items ??
            record(collection).page ??
            []);
        const target = args.threadId ?? args.categoryId ?? args.categorySlug;
        payload.subscribed = !(
          Array.isArray(rows) &&
          rows.some((item) =>
            [
              record(item)._id,
              record(item).threadId,
              record(item).categoryId,
              record(record(item).category)._id,
              record(item).slug,
            ].includes(target),
          )
        );
        desiredStates.set(inputKey, payload);
      }
    }
  }
  const tool = FORUM_PLUGIN_OPERATIONS.find(
    (item) => item.operation === operation && item.name !== "forum_open",
  );
  if (!tool) throw new Error("This action is unavailable.");
  if (!allowed(tool.capability))
    throw new Error(
      `Enable ${tool.capability} access for this connection first.`,
    );
  if (authority !== forumHost.authority())
    throw new Error(
      "The connection changed before this action could be sent. Your draft is preserved.",
    );
  const key = keyFor(name, payload);
  if (inFlight.has(key)) return inFlight.get(key);
  const idempotencyKey = retries.get(key) ?? crypto.randomUUID();
  retries.set(key, idempotencyKey);
  const call = forumHost
    .tool(tool.name, {
      ...payload,
      idempotencyKey,
      expectedPolicyVersion: forumHost.status.policyVersion,
    })
    .then((result) => {
      if (result.status === "pending_approval") {
        toast("Saved for owner review", {
          description:
            "Your draft is preserved until the owner approves this action.",
          action: result.approvalUrl
            ? {
                label: "Review request",
                onClick: () => void forumHost.openLink(result.approvalUrl!),
              }
            : undefined,
        });
        throw new Error(
          "Saved for owner approval. Your draft is preserved; review this request in Agent access.",
        );
      }
      retries.delete(key);
      desiredStates.delete(inputKey);
      invalidateQueries();
      if (result.publicationStatus === "pending_moderation")
        toast("Saved · pending publication", {
          description: result.message ?? "Forum staff will review this post.",
          action: result.pendingContentUrl
            ? {
                label: "View pending posts",
                onClick: () => navigate(result.pendingContentUrl!),
              }
            : undefined,
        });
      return result.data;
    })
    .catch((error) => {
      if (/POLICY|CONNECTION|TOKEN|GRANT/i.test(String(record(error).code)))
        void forumHost.refreshStatus();
      throw error;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, call);
  return call;
}
export function useMutation<Mutation extends FunctionReference<"mutation">>(
  reference: Mutation,
) {
  const name = getFunctionName(reference);
  const authority = useRef<string | null>(null);
  const currentRevision = useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    () => revision,
    () => revision,
  );
  useEffect(() => {
    if (forumHost.ready && authority.current === null)
      authority.current = forumHost.authority();
  }, [currentRevision]);
  return useCallback(
    (args: FunctionArgs<Mutation>) =>
      mutationReference(
        name,
        args as Json,
        authority.current ?? "not-connected",
      ) as Promise<FunctionReturnType<Mutation>>,
    [name],
  );
}
export const useAction = useMutation;
export const pluginClient = {
  query: <Q extends FunctionReference<"query">>(
    reference: Q,
    args: FunctionArgs<Q>,
  ) =>
    queryReference(getFunctionName(reference), args as Json) as Promise<
      FunctionReturnType<Q>
    >,
  mutation: <M extends FunctionReference<"mutation">>(
    reference: M,
    args: FunctionArgs<M>,
  ) =>
    mutationReference(getFunctionName(reference), args as Json) as Promise<
      FunctionReturnType<M>
    >,
};
export function useConvex() {
  return pluginClient;
}
export function invalidateQueries() {
  for (const entry of cache.values()) {
    if (entry.listeners.size) load(entry);
    else cache.delete(keyFor(entry.name, entry.args));
  }
}
window.addEventListener("forum:host-refresh", invalidateQueries);
window.addEventListener("forum:host-identity", () => {
  cache.clear();
  retries.clear();
  desiredStates.clear();
  emitStatus();
});
