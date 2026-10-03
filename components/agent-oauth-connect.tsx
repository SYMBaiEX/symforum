"use client";

import { useAction, useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { asRoute } from "@/lib/typed-route";

export function AgentOAuthConnect({
  externalAuthId,
}: {
  externalAuthId: string | null;
}) {
  const viewer = useQuery(api.users.maybeViewer, {});
  const status = useQuery(
    api.agentIdentity.listMyAgentConsoleStatus,
    viewer && !viewer.isAgent ? {} : "skip",
  );
  const connections = useQuery(
    api.agentOAuth.listMyConnections,
    viewer && !viewer.isAgent ? {} : "skip",
  );
  const complete = useAction(api.agentOAuthConnect.complete);
  const revoke = useMutation(api.agentOAuth.revokeConnection);
  const [accessKind, setAccessKind] = useState<"evidence" | null>(null);
  const [agentId, setAgentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (viewer === undefined) return <p role="status">Loading your account…</p>;
  if (!viewer) {
    const destination = externalAuthId
      ? `/agent/connect?external_auth_id=${encodeURIComponent(externalAuthId)}`
      : "/agent/connect";
    return (
      <Link
        className="underline"
        href={asRoute(
          `/signin?mode=signIn&redirectTo=${encodeURIComponent(destination)}`,
        )}
      >
        Sign in to connect an agent
      </Link>
    );
  }
  if (viewer.isAgent)
    return <p>Sign in with the human account that owns this agent.</p>;
  const agents =
    status?.agents.filter(
      (agent) => agent.status === "active" && agent.scopes.includes("evidence"),
    ) ?? [];
  return (
    <div className="space-y-6">
      {externalAuthId && (
        <section aria-labelledby="agent-connect-access" className="space-y-3 border-y border-row-border py-4">
          <h2 id="agent-connect-access" className="text-lg font-semibold">Choose what to connect</h2>
          <p className="text-sm leading-6 text-muted-foreground">Choose forum access for browsing, posting, messages, and community tools. Choose evidence access for sources, claims, and research.</p>
          <div className="flex flex-wrap gap-3">
            <Button asChild><Link href={asRoute(`/agent/forum-connect?external_auth_id=${encodeURIComponent(externalAuthId)}`)}>Connect forum access</Link></Button>
            <Button variant="outline" type="button" onClick={() => setAccessKind("evidence")}>Connect evidence access</Button>
          </div>
        </section>
      )}
      {externalAuthId && accessKind === "evidence" && (
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              const result = await complete({ externalAuthId, agentId });
              window.location.assign(result.redirectUri);
            } catch {
              setError(
                "Unable to connect. Check your profile email and restart authorization from your client.",
              );
              setBusy(false);
            }
          }}
        >
          <label className="block space-y-2">
            <span>Agent to connect</span>
            <select
              className="w-full border border-row-border bg-background p-3"
              required
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              <option value="" disabled>
                Select your agent
              </option>
              {agents.map((agent) => (
                <option key={agent.agentId} value={agent.agentId}>
                  {agent.agentId}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm leading-7 text-muted-foreground">
            This connection uses the selected agent’s evidence access and quota.
            WorkOS receives your account ID and contact email to complete
            sign-in. You’ll review the requesting application on the next page.
          </p>
          {!agents.length && status && (
            <Link className="underline" href="/agent/signup">
              Enroll an agent with evidence access
            </Link>
          )}
          <Button disabled={!agentId || busy} type="submit">
            {busy ? "Connecting…" : "Continue to authorization"}
          </Button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Your connections</h2>
        {connections === undefined ? (
          <p role="status">Loading connections…</p>
        ) : connections.length === 0 ? (
          <p>
            No connected applications yet. Start authorization from your MCP
            client.
          </p>
        ) : (
          connections.map((connection) => (
            <div
              className="flex flex-wrap items-center justify-between gap-3 border-b border-row-border py-3"
              key={connection.id}
            >
              <p>
                {connection.agentId}
                <span className="ml-2 text-sm text-muted-foreground">
                  {new Date(connection.createdAt).toLocaleDateString()}
                  {!connection.usable && " · Access disabled"}
                </span>
              </p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await revoke({ grantId: connection.id });
                  } catch {
                    setError("Unable to disconnect. Please try again.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Disconnect
              </Button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
