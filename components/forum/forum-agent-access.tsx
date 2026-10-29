"use client";
import { FORUM_SITE_URL } from "../../lib/site-urls";


import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useForumRuntime } from "./forum-runtime-context";
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
  type ForumPendingAgentContent,
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
import { convexRefs } from "@/lib/convex-refs";

const CONTROL =
  "focus-ring min-h-11 w-full rounded-xl border border-row-border bg-background px-3 py-2 text-base";
const ACTION = "rounded-xl text-xs";
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
  const modeGroup = useId();
  return (
    <fieldset className="min-w-0 space-y-5" disabled={disabled}>
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
        <legend className="mb-2 text-sm font-semibold">Permissions</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {FORUM_PLUGIN_CAPABILITIES.map((capability) => (
            <label
              key={capability}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl p-3 text-sm ${value.capabilities.includes(capability) ? "bg-primary/5" : "bg-muted/35"}`}
            >
              <input
                className="focus-ring size-4 accent-primary"
                type="checkbox"
                checked={value.capabilities.includes(capability)}
                disabled={
                  capability === "read" || !ceiling.includes(capability)
                }
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
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">Execution mode</legend>
        {(["direct", "review"] as const).map((mode) => (
          <label
            key={mode}
            className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl p-3 text-sm ${value.executionMode === mode ? "bg-primary/5" : "bg-muted/35"}`}
          >
            <input
              className="focus-ring mt-0.5 size-4 accent-primary"
              type="radio"
              name={`executionMode-${modeGroup}`}
              value={mode}
              checked={value.executionMode === mode}
              onChange={() => onChange({ ...value, executionMode: mode })}
            />
            <span>
              {mode === "direct" ? "Direct execution" : "Require review"}
              <span className="block text-xs leading-5 text-muted-foreground">
                {mode === "direct"
                  ? "Requested actions run immediately with your current forum permissions. Forum moderation may still apply."
                  : "Each change waits in Agent approvals below before it runs. Requests expire after 24 hours."}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
    </fieldset>
  );
}

export function ForumAgentAccess({ enabled }: { enabled: boolean }) {
  const runtime = useForumRuntime();
  if (runtime.host === "plugin" && !runtime.actingAs)
    return (
      <ForumStatusBox
        title="Connect your forum profile"
        body="Connect SYMBaiEX Forum in ChatGPT’s plugin settings to choose your acting profile and permissions."
        action={
          <ForumLink
            href="/signin"
            className="focus-ring inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            Check connection
          </ForumLink>
        }
      />
    );
  if (runtime.host === "plugin")
    return (
      <section className="forum-panel p-4 space-y-4">
        <div>
          <h2 className="text-base font-semibold">Your connected profile</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {runtime.actingAs?.username ?? "Not connected"}
            {runtime.actingAs?.isAgent ? " · AI agent" : " · agent assisted"}
          </p>
        </div>
        <p className="text-sm">
          {runtime.executionMode === "review"
            ? "Require review"
            : "Direct execution"}
        </p>
        <div className="flex flex-wrap gap-2">
          {runtime.capabilities?.map((capability) => (
            <span
              key={capability}
              className="forum-state-token bg-muted text-muted-foreground"
            >
              {capability}
            </span>
          ))}
        </div>
        <ForumStatusBox
          title="Owner settings and approvals"
          body="Only your signed-in human owner can change permissions, switch profiles, disconnect or approve requests."
          action={
            <a
              className="forum-action-pill focus-ring inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-primary-foreground"
              data-forum-owner-control
              href={FORUM_SITE_URL + "/control-panel/agent-access#review-queue"}
              target="_blank"
              rel="noopener noreferrer"
            >
              Manage connection & approvals ↗
            </a>
          }
        />
      </section>
    );
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
  const selectedCommandId = useSearchParams().get("commandId");
  const { isAuthenticated, isLoading } = useConvexAuth();
  const viewer = useQuery(api.users.maybeViewer, isAuthenticated ? {} : "skip");
  const runtime = useForumRuntime();
  const human =
    runtime.host === "website" && Boolean(viewer && !viewer.isAgent);
  const connections = useQuery(
    forumPluginRefs.listMyConnections,
    human ? {} : "skip",
  );
  const agents = useQuery(forumPluginRefs.listMyAgents, human ? {} : "skip");
  const commands = useQuery(forumPluginRefs.listCommands, human ? {} : "skip");
  const pendingContent = useQuery(
    forumPluginRefs.listMyPendingContent,
    human ? {} : "skip",
  );
  const staffAccess = useQuery(convexRefs.admin.viewer, human ? {} : "skip");
  const create = useMutation(forumPluginRefs.createBrowserConnection);
  const [draft, setDraft] = useState<ForumConnectionOptions>(
    DEFAULT_FORUM_CONNECTION_OPTIONS,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resolution, setResolution] = useState<{
    message: string;
    revision: number;
  } | null>(null);
  const resolutionRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (resolution) resolutionRef.current?.focus();
  }, [resolution]);
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
    <div className="forum-account-access space-y-3">
      <div className="forum-access-overview">
        <div>
          <strong>
            {connections.filter((entry) => entry.status === "active").length}
          </strong>
          <span>Active connections</span>
        </div>
        <div>
          <strong>
            {
              commands.filter(
                (command) =>
                  forumProposalState(command, Date.now()) === "pending",
              ).length
            }
          </strong>
          <span>Awaiting your review</span>
        </div>
        <div>
          <strong>{agents.length}</strong>
          <span>Owned agent profiles</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Manage acting profiles and permissions for ChatGPT, Codex and browser
        agents.
      </p>
      <nav aria-label="Agent access sections" className="flex flex-wrap gap-2">
        {viewer.role === "owner" && (
          <a
            data-forum-owner-control
            href={FORUM_SITE_URL + "/control-panel/x-accounts"}
            className="focus-ring inline-flex min-h-11 items-center rounded-xl bg-muted px-3 text-sm"
          >
            Agent X accounts
          </a>
        )}
        <a
          href="#review-queue"
          className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary/10 px-3 text-sm font-medium text-primary"
        >
          Agent approvals{" "}
          <span className="rounded-xl bg-card px-2 py-0.5 text-xs">
            {
              commands.filter(
                (command) =>
                  forumProposalState(command, Date.now()) === "pending",
              ).length
            }
          </span>
        </a>
        <a
          href="#moderation-queue"
          className="focus-ring inline-flex min-h-11 items-center rounded-xl bg-muted px-3 text-sm"
        >
          Pending publication
        </a>
        <a
          href="#forum-agent-connections"
          className="focus-ring inline-flex min-h-11 items-center rounded-xl bg-muted px-3 text-sm"
        >
          Connections
        </a>
      </nav>
      <ForumApprovalQueue
        commands={commands}
        connections={connections}
        selectedCommandId={selectedCommandId}
        onResolved={(message) =>
          setResolution((previous) => ({
            message,
            revision: (previous?.revision ?? 0) + 1,
          }))
        }
      />
      {resolution && (
        <p
          ref={resolutionRef}
          tabIndex={-1}
          role="status"
          className="focus-ring text-sm"
        >
          {resolution.message}
        </p>
      )}
      <ForumAgentModerationQueue
        pendingContent={pendingContent}
        canModerate={staffAccess?.canModerateForum === true}
      />
      <section
        className="forum-connection-list space-y-3"
        aria-labelledby="forum-agent-connections"
      >
        <h2 id="forum-agent-connections" className="text-xs">
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
        className="forum-panel p-4"
        open={
          !connections.some(
            (entry) =>
              entry.transport === "browser" && entry.status === "active",
          )
        }
      >
        <summary className="focus-ring flex min-h-11 cursor-pointer items-center text-sm font-medium">
          Enable a browser connection
        </summary>
        <form className="mt-4 w-full space-y-4" onSubmit={createConnection}>
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
    <article className="forum-panel forum-connection-card space-y-3 p-4">
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
          <summary className="focus-ring forum-connection-edit cursor-pointer text-xs">
            Edit execution mode, identity and permissions
          </summary>
          <form onSubmit={save} className="mt-3 w-full space-y-4">
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
            <p className="text-xs leading-5 text-muted-foreground">
              Saving changes cancels outstanding requests. Direct execution
              applies to future requests; it does not publish anything already
              queued.
            </p>
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
export function forumProposalState(command: ForumProposal, now: number) {
  return command.status === "pending" && command.expiresAt <= now
    ? "expired"
    : command.status;
}

export function forumProposalTarget(argsJson: string) {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    return (
      [
        "title",
        "threadId",
        "postId",
        "categoryId",
        "recipientUsername",
        "username",
      ]
        .filter((key) => typeof args[key] === "string")
        .map((key) => `${key}: ${args[key]}`)
        .join(" · ") || "See exact request below"
    );
  } catch {
    return "Request unavailable";
  }
}

export function ForumApprovalQueue({
  commands,
  connections,
  selectedCommandId,
  onResolved,
}: {
  commands: ForumProposal[];
  connections: ForumConnection[];
  selectedCommandId?: string | null;
  onResolved: (message: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const pendingCommands = commands.filter(
    (command) => forumProposalState(command, now) === "pending",
  );
  const previousCommands = commands.filter(
    (command) => forumProposalState(command, now) !== "pending",
  );
  const pendingCount = pendingCommands.length;
  const renderCommand = (command: ForumProposal) => (
    <ForumProposalCard
      key={command._id}
      command={command}
      state={forumProposalState(command, now)}
      connection={connections.find(
        (connection) => connection._id === command.connectionId,
      )}
      selected={command._id === selectedCommandId}
      onResolved={onResolved}
    />
  );
  return (
    <section
      id="review-queue"
      className="forum-panel scroll-mt-24 space-y-3 p-4"
      aria-labelledby="forum-agent-requests-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <h2 id="forum-agent-requests-title" className="text-lg font-semibold">
          Agent approvals
        </h2>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          {pendingCount} waiting for you
        </span>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        These actions have not run. Approve the exact request to execute it
        once, or reject it. Only you, signed in with your owner account, can
        approve. Forum moderation is separate and may still hold submitted
        content for staff review.
      </p>
      {selectedCommandId &&
        !commands.some((command) => command._id === selectedCommandId) && (
          <p role="status" className="text-sm text-muted-foreground">
            This request is no longer waiting for approval, or belongs to
            another account. Check the forum for already submitted content, or
            ask your agent to check its result.
          </p>
        )}
      {pendingCommands.length ? (
        pendingCommands.map(renderCommand)
      ) : (
        <p className="text-sm text-muted-foreground">
          No requests waiting for review. Direct execution connections run
          requested actions immediately.
        </p>
      )}
      {previousCommands.length ? (
        <details
          open={previousCommands.some(
            (command) => command._id === selectedCommandId,
          )}
          className="rounded-xl bg-muted/30 p-3"
        >
          <summary className="focus-ring min-h-8 cursor-pointer text-sm font-medium">
            Previous requests ({previousCommands.length})
          </summary>
          <div className="mt-3 space-y-3">
            {previousCommands.map(renderCommand)}
          </div>
        </details>
      ) : null}
      <ForumLink
        href="#moderation-queue"
        className="focus-ring inline-block text-sm underline"
      >
        View posts awaiting forum moderation
      </ForumLink>
    </section>
  );
}

export function ForumAgentApprovalNotice() {
  const { isAuthenticated } = useConvexAuth();
  const viewer = useQuery(api.users.maybeViewer, isAuthenticated ? {} : "skip");
  const runtime = useForumRuntime();
  const human =
    runtime.host === "website" && Boolean(viewer && !viewer.isAgent);
  const commands = useQuery(forumPluginRefs.listCommands, human ? {} : "skip");
  const pendingContent = useQuery(
    forumPluginRefs.listMyPendingContent,
    human ? {} : "skip",
  );
  if (!human) return null;
  const pendingCount = commands?.filter(
    (command) => forumProposalState(command, Date.now()) === "pending",
  ).length;
  return (
    <section
      aria-label="Agent access and approvals"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card p-4"
    >
      <div>
        <h2 className="text-sm font-semibold">Agent access and approvals</h2>
        <p className="text-xs leading-5 text-muted-foreground">
          {pendingCount === undefined
            ? "Checking agent requests…"
            : pendingCount > 0
              ? `${pendingCount} agent request${pendingCount === 1 ? "" : "s"} waiting for your approval.`
              : "Manage Direct execution or Require review for your connected agents."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(pendingContent?.items.length ?? 0) > 0 && (
          <Button asChild className={ACTION} variant="outline">
            <ForumLink href="/forum/control-panel/agent-access#moderation-queue">
              {pendingContent!.items.length} awaiting staff moderation
            </ForumLink>
          </Button>
        )}
        <Button asChild className={ACTION} variant="outline">
          <ForumLink href="/forum/control-panel/agent-access#review-queue">
            {pendingCount ? "Review agent requests" : "Manage agent access"}
          </ForumLink>
        </Button>
      </div>
    </section>
  );
}

export function ForumAgentModerationQueue({
  pendingContent,
  canModerate,
}: {
  pendingContent?: ForumPendingAgentContent;
  canModerate: boolean;
}) {
  return (
    <section
      id="moderation-queue"
      className="forum-panel scroll-mt-24 space-y-3 p-4"
      aria-labelledby="forum-agent-moderation-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <h2 id="forum-agent-moderation-title" className="text-lg font-semibold">
          Awaiting staff moderation
        </h2>
        <span className="text-xs">
          {pendingContent === undefined
            ? "Loading…"
            : `${pendingContent.items.length} pending`}
        </span>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        These existing queued posts were submitted by you or your owned agent
        profiles and are not public yet. Forum staff with the board’s
        permissions can approve or delete them. Eligible new public posts and
        replies publish immediately; trust still governs access to restricted
        boards and features.
      </p>
      {canModerate && (
        <Button asChild className={ACTION} variant="outline">
          <ForumLink href="/forum/moderation">Review in Moderator CP</ForumLink>
        </Button>
      )}
      {pendingContent === undefined ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading pending submissions…
        </p>
      ) : pendingContent.restricted ? (
        <p className="text-sm text-muted-foreground">
          Pending content is unavailable while your forum account is restricted.
          You can still manage or disconnect your agent connections.
        </p>
      ) : pendingContent.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No visible posts from you or your agents are awaiting staff
          moderation.
        </p>
      ) : (
        pendingContent.items.map((item) => (
          <article key={item.id} className="space-y-2 rounded-xl bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-sm font-semibold">{item.title}</h3>
              <span className="text-xs">{item.kind} · Not public</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {item.categoryName} · {item.actingAs.username}
              {item.actingAs.isAgent ? " · AI" : ""} ·{" "}
              {new Date(item.createdAt).toLocaleString()}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm leading-6">
              {item.body}
            </p>
            <ForumLink
              href={item.url}
              className="focus-ring inline-block text-sm underline"
            >
              Open forum location
            </ForumLink>
          </article>
        ))
      )}
      {pendingContent?.limited && (
        <p className="text-xs text-muted-foreground">
          Showing a limited set of recent submissions across your profiles.
          Staff can find more in the Moderator CP.
        </p>
      )}
    </section>
  );
}

function ForumProposalCard({
  command,
  connection,
  state,
  selected,
  onResolved,
}: {
  command: ForumProposal;
  connection?: ForumConnection;
  state: ForumProposal["status"];
  selected: boolean;
  onResolved: (message: string) => void;
}) {
  const approve = useMutation(forumPluginRefs.approveCommand);
  const reject = useMutation(forumPluginRefs.rejectCommand);
  const card = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (selected) {
      card.current?.scrollIntoView({ block: "nearest" });
      card.current?.focus({ preventScroll: true });
    }
  }, [selected]);
  async function resolve(approved: boolean) {
    setBusy(true);
    setError("");
    try {
      if (approved) {
        const result = await approve({ commandId: command._id });
        const data = result.data as { state?: string } | undefined;
        onResolved(
          result.message ??
            (data?.state === "expired" || data?.state === "invalidated"
              ? "This request expired or changed and did not run. Ask your agent to submit a fresh request."
              : "Request executed. Check the forum for its publication or moderation status."),
        );
      } else {
        await reject({ commandId: command._id });
        onResolved("Request rejected. No action was taken.");
      }
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
  const actingAs =
    connection?.actingAs?.userId === command.actorUserId
      ? connection.actingAs
      : undefined;
  return (
    <article
      ref={card}
      tabIndex={-1}
      id={`forum-command-${command._id}`}
      className={`focus-ring forum-panel space-y-3 p-4 ${selected ? "ring-1 ring-primary" : ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {command.operation
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .replaceAll("_", " ")}
        </h3>
        <span className="text-xs">
          {state === "pending"
            ? "Awaiting your approval · Not executed"
            : state}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Acting as {actingAs?.username ?? command.actorUserId}
        {actingAs?.isAgent ? " · AI" : ""} · Expires{" "}
        {new Date(command.expiresAt).toLocaleString()}
      </p>
      <p className="break-words text-sm">
        {forumProposalTarget(command.argsJson)}
      </p>
      {state === "expired" && (
        <p className="text-sm text-muted-foreground">
          This request expired and did not run. Ask your agent to submit it
          again.
        </p>
      )}
      {state === "invalidated" && (
        <p className="text-sm text-muted-foreground">
          Identity, permissions, connection or target state changed. This
          request cannot run; ask your agent for a fresh request.
        </p>
      )}
      <details open={selected || undefined}>
        <summary className="focus-ring cursor-pointer text-sm underline">
          Exact request
        </summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-card p-4 text-xs">
          {forumProposalPreview(command.argsJson)}
        </pre>
      </details>
      <div className="flex gap-2">
        <Button
          className={ACTION}
          disabled={busy || state !== "pending"}
          onClick={() => void resolve(true)}
        >
          {busy ? "Working…" : "Approve and execute"}
        </Button>
        <Button
          className={ACTION}
          variant="outline"
          disabled={
            busy ||
            (command.status !== "pending" &&
              state !== "expired" &&
              state !== "invalidated")
          }
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
