import {
  useCallback,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { ForumConnection } from "../../../components/forum/forum-plugin-refs";
import type { ForumRuntime } from "../../../components/forum/forum-runtime-context";

const scenario =
  new URLSearchParams(location.search).get("scenario") ?? "owner";
export const connections: ForumConnection[] = [
  {
    _id: "active-browser",
    actorMode: "human",
    transport: "browser",
    actingAs: { userId: "owner-a", username: "Owner A", isAgent: false },
    credentialAgentId: "",
    capabilities: ["read", "participate"],
    capabilityCeiling: ["read", "participate", "personal"],
    executionMode: "review",
    policyVersion: 1,
    status: "active",
    createdAt: 100,
  },
  {
    _id: "pending-app",
    actorMode: "agent",
    transport: "oauth",
    actingAs: { userId: "agent-a", username: "Pending agent", isAgent: true },
    credentialAgentId: "agent-a",
    capabilities: ["read", "messages"],
    capabilityCeiling: ["read", "messages"],
    executionMode: "direct",
    policyVersion: 1,
    status: "pending",
    createdAt: 100,
  },
  {
    _id: "revoked-app",
    actorMode: "agent",
    transport: "oauth",
    actingAs: { userId: "agent-b", username: "Revoked agent", isAgent: true },
    credentialAgentId: "agent-b",
    capabilities: ["read", "attachments"],
    capabilityCeiling: ["read", "attachments"],
    executionMode: "review",
    policyVersion: 1,
    status: "revoked",
    createdAt: 100,
  },
];
let state = {
  authenticated: scenario !== "guest" && scenario !== "loading",
  loading: scenario === "loading",
  agentViewer: scenario === "agent",
  connectionsLoaded: scenario !== "connections-loading",
  connections,
  runtime: scenario.startsWith("plugin")
    ? ({
        host: "plugin",
        ...(scenario === "plugin-guest"
          ? {}
          : {
              actingAs: {
                userId: "reported-agent",
                username: "Reported agent",
                isAgent: true,
              },
            }),
        ...(scenario === "plugin-review"
          ? { executionMode: "review", capabilities: ["read", "messages"] }
          : {}),
        ...(scenario === "plugin-direct"
          ? { executionMode: "direct", capabilities: ["read", "participate"] }
          : {}),
      } as ForumRuntime)
    : ({ host: "website" } as ForumRuntime),
};
const listeners = new Set<() => void>();
export function update(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
export function useFixtureState() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
export const evidence = {
  reads: [] as { name: string; args: unknown }[],
  mutations: [] as { name: string; args: unknown }[],
  selections: [] as (string | null)[],
  forbidden: [] as string[],
};
export function useConvexAuth() {
  const current = useFixtureState();
  return { isAuthenticated: current.authenticated, isLoading: current.loading };
}
export function useQuery(ref: FunctionReference<"query">, args: unknown) {
  const current = useFixtureState();
  if (args === "skip") return undefined;
  const name = getFunctionName(ref);
  if (
    !current.authenticated ||
    current.runtime.host !== "website" ||
    (current.agentViewer && name !== "users:maybeViewer")
  ) {
    evidence.forbidden.push(name);
    throw Error("Forbidden private read");
  }
  if (
    !evidence.reads.some(
      (read) =>
        read.name === name &&
        JSON.stringify(read.args) === JSON.stringify(args),
    )
  )
    evidence.reads.push({ name, args });
  if (name === "users:maybeViewer")
    return { _id: "owner-a", isAgent: current.agentViewer, role: "member" };
  if (name === "forumPluginAccess:listMyConnections")
    return current.connectionsLoaded ? current.connections : undefined;
  if (name === "forumPluginAccess:listMyAgents")
    return [{ agentId: "agent-a", userId: "agent-a", status: "active" }];
  if (name === "forumPlugin:listCommands") return [];
  if (name === "forumPlugin:listMyPendingContent")
    return { items: [], limited: false };
  if (name === "admin:viewer") return { canModerateForum: false };
  evidence.forbidden.push(name);
  throw Error("Unexpected read");
}
const pending: { resolve(value: unknown): void; reject(error: Error): void }[] =
  [];
export function useMutation(ref: FunctionReference<"mutation">) {
  const name = getFunctionName(ref);
  return useCallback(
    (args: unknown) => {
      if (
        ![
          "forumPluginAccess:createBrowserConnection",
          "forumPluginAccess:updateConnection",
          "forumPluginAccess:revokeConnection",
        ].includes(name) ||
        !state.authenticated ||
        state.agentViewer ||
        state.runtime.host !== "website"
      ) {
        evidence.forbidden.push(name);
        throw Error("Forbidden mutation");
      }
      evidence.mutations.push({ name, args });
      return new Promise((resolve, reject) =>
        pending.push({ resolve, reject }),
      );
    },
    [name],
  );
}
export function useSearchParams() {
  return new URLSearchParams();
}
export function usePathname() {
  return "/control-panel/agent-access";
}
// Presentation-only leaves isolate unrelated auth/WebMCP module imports.
export function ForumLoading({ label }: { label: string }) {
  return (
    <p role="status" aria-live="polite">
      {label}
    </p>
  );
}
export function ForumStatusBox({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <section className="forum-panel min-w-0 p-4">
      <p>{title}</p>
      <p>{body}</p>
      {action}
    </section>
  );
}
export default function InertLink({
  href,
  children,
  ...props
}: ComponentProps<"a">) {
  return (
    <a {...props} href={href}>
      {children}
    </a>
  );
}
export function useForumBrowserConnectionId() {
  return null;
}
export function selectForumBrowserConnection(id: string | null) {
  evidence.selections.push(id);
}
declare global {
  interface Window {
    agentPermissions: {
      update: typeof update;
      evidence: typeof evidence;
      connection(index: number, patch: Partial<ForumConnection>): void;
      settle(index: number, ok: boolean): void;
    };
  }
}
window.agentPermissions = {
  update,
  evidence,
  connection(index, patch) {
    update({
      connections: state.connections.map((entry, at) =>
        at === index ? { ...entry, ...patch } : entry,
      ),
    });
  },
  settle(index, ok) {
    if (ok) pending[index].resolve({ connectionId: "inert-created" });
    else pending[index].reject(Error("Inert disconnect failure"));
  },
};
