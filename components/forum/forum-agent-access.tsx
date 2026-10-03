"use client";

import { useState, type FormEvent } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { ForumLink } from "@/components/forum/forum-link";
import {
  ForumLoading,
  ForumStatusBox,
} from "@/components/forum/forum-primitives";
import {
  forumPluginRefs,
  type ForumAgentChoice,
  type ForumConnection,
  type ForumConnectionOptions,
  type ForumProposal,
} from "./forum-plugin-refs";
import {
  selectForumBrowserConnection,
  useForumBrowserConnectionId,
} from "./forum-plugin-selection";
import {
  DEFAULT_FORUM_PLUGIN_CAPABILITIES,
  FORUM_PLUGIN_CAPABILITIES,
  FORUM_PLUGIN_CAPABILITY_LABELS,
  type ForumPluginCapability,
} from "@/lib/forum-plugin-contract";
import { userFacingError } from "@/lib/auth-errors";

const CONTROL =
  "focus-ring w-full border border-row-border bg-background px-3 py-2 text-sm";
const ACTION = "rounded-none font-mono text-[10px] uppercase";
export const DEFAULT_FORUM_CONNECTION_OPTIONS: ForumConnectionOptions = {
  actorMode: "human",
  executionMode: "direct",
  capabilities: DEFAULT_FORUM_PLUGIN_CAPABILITIES,
};

export function ForumConnectionFields({
  value,
  onChange,
  agents,
  ceiling = FORUM_PLUGIN_CAPABILITIES,
  disabled = false,
  allowNewAgent = true,
}: {
  value: ForumConnectionOptions;
  onChange: (next: ForumConnectionOptions) => void;
  agents: ForumAgentChoice[];
  ceiling?: readonly ForumPluginCapability[];
  disabled?: boolean;
  allowNewAgent?: boolean;
}) {
  return (
    <fieldset className="space-y-4" disabled={disabled}>
      <legend className="sr-only">Acting profile and permissions</legend>
      <label className="block space-y-1.5">
        <span className="text-sm">Act as</span>
        <select
          className={CONTROL}
          value={
            value.actorMode === "human"
              ? "human"
              : `agent:${value.agentId ?? ""}`
          }
          onChange={(event) => {
            const selected = event.target.value;
            onChange({
              ...value,
              actorMode: selected === "human" ? "human" : "agent",
              agentId:
                selected === "human"
                  ? undefined
                  : selected.slice(6) || undefined,
            });
          }}
        >
          <option value="human">My own profile</option>
          {allowNewAgent && <option value="agent:">New agent profile</option>}
          {agents
            .filter((agent) => agent.status === "active")
            .map((agent) => (
              <option key={agent.agentId} value={`agent:${agent.agentId}`}>
                {agent.agentId} · AI
              </option>
            ))}
        </select>
      </label>
      <p className="text-xs leading-5 text-muted-foreground">
        Your agent uses your current forum permissions and posting limits.{" "}
        {allowNewAgent
          ? "A new agent profile is created without a signing key."
          : "To create a new agent or expand access, authorize a new connection."}
      </p>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm">Allow this connection to</legend>
        {FORUM_PLUGIN_CAPABILITIES.map((capability) => (
          <label key={capability} className="flex items-center gap-2 text-sm">
            <input
              className="focus-ring size-4 accent-primary"
              type="checkbox"
              checked={value.capabilities.includes(capability)}
              disabled={capability === "read" || !ceiling.includes(capability)}
              onChange={(event) =>
                onChange({
                  ...value,
                  capabilities: event.target.checked
                    ? [...value.capabilities, capability]
                    : value.capabilities.filter(
                        (entry) => entry !== capability,
                      ),
                })
              }
            />
            <span>
              {FORUM_PLUGIN_CAPABILITY_LABELS[capability]}
              {capability === "read" ? " · Required" : ""}
              {!ceiling.includes(capability) ? " · Needs new consent" : ""}
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm">Execution mode</legend>
        {(["direct", "review"] as const).map((mode) => (
          <label key={mode} className="flex items-start gap-2 text-sm">
            <input
              className="focus-ring mt-0.5 size-4 accent-primary"
              type="radio"
              name="executionMode"
              value={mode}
              checked={value.executionMode === mode}
              onChange={() => onChange({ ...value, executionMode: mode })}
            />
            <span>
              {mode === "direct" ? "Direct execution" : "Require review"}
              <span className="block text-xs leading-5 text-muted-foreground">
                {mode === "direct"
                  ? "Selected actions run with your current forum permissions."
                  : "Review each proposed change here. Requests expire after 24 hours."}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
    </fieldset>
  );
}

export function ForumAgentAccess({ enabled }: { enabled: boolean }) {
  if (!enabled)
    return (
      <ForumStatusBox
        title="Forum unavailable"
        body="Forum connections are unavailable in this environment."
      />
    );
  return <LiveForumAgentAccess />;
}
function LiveForumAgentAccess() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const viewer = useQuery(api.users.maybeViewer, isAuthenticated ? {} : "skip");
  const human = Boolean(viewer && !viewer.isAgent);
  const connections = useQuery(
    forumPluginRefs.listMyConnections,
    human ? {} : "skip",
  );
  const agents = useQuery(forumPluginRefs.listMyAgents, human ? {} : "skip");
  const commands = useQuery(forumPluginRefs.listCommands, human ? {} : "skip");
  const create = useMutation(forumPluginRefs.createBrowserConnection);
  const [draft, setDraft] = useState<ForumConnectionOptions>(
    DEFAULT_FORUM_CONNECTION_OPTIONS,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (isLoading || (isAuthenticated && viewer === undefined))
    return <ForumLoading label="Checking your account" />;
  if (!isAuthenticated || !viewer)
    return (
      <ForumStatusBox
        title="Sign in required"
        body="Sign in to manage your forum connections and review agent requests."
        action={
          <ForumLink
            className="focus-ring underline"
            href="/signin?redirectTo=%2Fforum%2Fcontrol-panel%2Fagent-access"
          >
            Sign in
          </ForumLink>
        }
      />
    );
  if (!human)
    return (
      <ForumStatusBox
        title="Owner account required"
        body="Sign in with your human owner account to change permissions or approve requests."
      />
    );
  if (
    connections === undefined ||
    agents === undefined ||
    commands === undefined
  )
    return <ForumLoading label="Loading agent access" />;
  async function createConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await create(draft);
      selectForumBrowserConnection(result.connectionId);
    } catch (caught) {
      setError(
        userFacingError(
          caught,
          "Could not enable agent access. Please try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <p className="text-sm leading-6 text-muted-foreground">
        Choose how agents interact with the forum. ChatGPT and Codex connections
        share these permissions and review settings. Your browser connection
        applies while you view the forum.
      </p>
      <section className="space-y-3" aria-labelledby="forum-agent-connections">
        <h2
          id="forum-agent-connections"
          className="font-mono text-xs uppercase"
        >
          Connections
        </h2>
        {connections.length ? (
          connections.map((connection) => (
            <ForumConnectionCard
              key={`${connection._id}:${connection.policyVersion}`}
              connection={connection}
              agents={agents}
            />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            No forum connections yet.
          </p>
        )}
      </section>
      <details
        className="border-y border-row-border py-3"
        open={
          !connections.some(
            (entry) =>
              entry.transport === "browser" && entry.status === "active",
          )
        }
      >
        <summary className="focus-ring cursor-pointer font-mono text-xs uppercase">
          Enable a browser connection
        </summary>
        <form className="mt-4 max-w-xl space-y-4" onSubmit={createConnection}>
          <ForumConnectionFields
            value={draft}
            onChange={setDraft}
            agents={agents}
            disabled={busy}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            For broader access, create a new browser connection with fresh
            consent. For ChatGPT or Codex, reconnect from that application.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            className={ACTION}
            disabled={busy || draft.capabilities.length === 0}
            type="submit"
          >
            {busy ? "Enabling…" : "Enable agent access"}
          </Button>
        </form>
      </details>
      <section className="space-y-3" aria-labelledby="forum-agent-requests">
        <h2 id="forum-agent-requests" className="font-mono text-xs uppercase">
          Approval queue
        </h2>
        <p className="text-xs leading-5 text-muted-foreground">
          Approval runs the exact request shown below after checking your latest
          permissions. Changing identity or permissions cancels outstanding
          requests.
        </p>
        {commands.filter((command) => command.status === "pending").length ? (
          commands
            .filter((command) => command.status === "pending")
            .map((command) => (
              <ForumProposalCard
                key={command._id}
                command={command}
                connection={connections.find(
                  (connection) => connection._id === command.connectionId,
                )}
              />
            ))
        ) : (
          <p className="text-sm text-muted-foreground">
            No requests waiting for review.
          </p>
        )}
      </section>
    </div>
  );
}

function ForumConnectionCard({
  connection,
  agents,
}: {
  connection: ForumConnection;
  agents: ForumAgentChoice[];
}) {
  const selectedId = useForumBrowserConnectionId();
  const update = useMutation(forumPluginRefs.updateConnection);
  const revoke = useMutation(forumPluginRefs.revokeConnection);
  const [draft, setDraft] = useState<ForumConnectionOptions>({
    actorMode: connection.actorMode,
    agentId:
      connection.actorMode === "agent"
        ? connection.credentialAgentId
        : undefined,
    capabilities: connection.capabilities,
    executionMode: connection.executionMode,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await update({ ...draft, connectionId: connection._id });
      setSaved(true);
    } catch (caught) {
      setError(userFacingError(caught, "Could not save this connection."));
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError("");
    if (selectedId === connection._id) selectForumBrowserConnection(null);
    try {
      await revoke({ connectionId: connection._id });
    } catch (caught) {
      setError(
        userFacingError(caught, "Could not disconnect. Please try again."),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="space-y-3 border border-row-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {connection.actingAs?.username ?? "Forum profile"}
            {connection.actingAs?.isAgent ? " · AI" : ""}
          </h3>
          <p className="text-xs text-muted-foreground">
            {connection.transport === "browser"
              ? "Browser"
              : "Connected application"}{" "}
            · {connection.status} ·{" "}
            {connection.executionMode === "direct"
              ? "Direct execution"
              : "Require review"}
          </p>
        </div>
        {connection.status === "active" && (
          <div className="flex flex-wrap gap-2">
            {connection.transport === "browser" && (
              <Button
                className={ACTION}
                variant="outline"
                disabled={busy}
                onClick={() =>
                  selectForumBrowserConnection(
                    selectedId === connection._id ? null : connection._id,
                  )
                }
              >
                {selectedId === connection._id
                  ? "Stop using in browser"
                  : "Use in browser"}
              </Button>
            )}
            <Button
              className={ACTION}
              variant="outline"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              Disconnect
            </Button>
          </div>
        )}
      </div>
      {connection.status === "active" && (
        <details>
          <summary className="focus-ring cursor-pointer text-sm underline">
            Edit identity and permissions
          </summary>
          <form onSubmit={save} className="mt-3 max-w-xl space-y-4">
            <ForumConnectionFields
              value={draft}
              onChange={setDraft}
              agents={
                connection.transport === "oauth"
                  ? agents.filter(
                      (agent) => agent.agentId === connection.credentialAgentId,
                    )
                  : agents
              }
              ceiling={connection.capabilityCeiling}
              disabled={busy}
              allowNewAgent={false}
            />
            <Button
              className={ACTION}
              type="submit"
              disabled={busy || !draft.capabilities.length}
            >
              {busy ? "Saving…" : "Save connection"}
            </Button>
          </form>
        </details>
      )}
      {saved && (
        <p role="status" className="text-xs">
          Connection saved.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </article>
  );
}

export function forumProposalPreview(argsJson: string) {
  try {
    return JSON.stringify(JSON.parse(argsJson), null, 2);
  } catch {
    return "The request could not be displayed. Reject it and ask your agent to retry.";
  }
}
function ForumProposalCard({
  command,
  connection,
}: {
  command: ForumProposal;
  connection?: ForumConnection;
}) {
  const approve = useMutation(forumPluginRefs.approveCommand);
  const reject = useMutation(forumPluginRefs.rejectCommand);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const expired = command.expiresAt <= Date.now();
  async function resolve(approved: boolean) {
    setBusy(true);
    setError("");
    try {
      if (approved) await approve({ commandId: command._id });
      else await reject({ commandId: command._id });
    } catch (caught) {
      setError(
        userFacingError(
          caught,
          "This request could not be completed. It may have expired or your permissions changed.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="space-y-3 border border-row-border p-3">
      <h3 className="text-sm font-semibold">
        {command.operation
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replaceAll("_", " ")}
      </h3>
      <p className="text-xs text-muted-foreground">
        {connection?.actingAs?.username ?? command.actorUserId} ·{" "}
        {connection?.actingAs?.isAgent ? "AI · " : ""}Expires{" "}
        {new Date(command.expiresAt).toLocaleString()}
      </p>
      <p className="text-xs font-semibold">Exact request</p>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words border border-row-border p-3 text-xs">
        {forumProposalPreview(command.argsJson)}
      </pre>
      <div className="flex gap-2">
        <Button
          className={ACTION}
          disabled={busy || expired}
          onClick={() => void resolve(true)}
        >
          {expired ? "Expired" : "Approve"}
        </Button>
        <Button
          className={ACTION}
          variant="outline"
          disabled={busy}
          onClick={() => void resolve(false)}
        >
          Reject
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </article>
  );
}
