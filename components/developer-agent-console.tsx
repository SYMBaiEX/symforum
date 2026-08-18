"use client";

import { SignInPanel } from "@/components/signin-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { convexRefs, type AgentScope } from "@/lib/convex-refs";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { toast } from "sonner";

export function DeveloperAgentConsole() {
  const viewer = useQuery(convexRefs.users.maybeViewer, {});
  const status = useQuery(
    convexRefs.agentIdentity.listMyAgentConsoleStatus,
    viewer && !viewer.isAgent ? {} : "skip",
  );
  const revokeAgent = useMutation(convexRefs.agentIdentity.revokeAgent);
  const rotateAgentKey = useMutation(convexRefs.agentIdentity.rotateAgentKey);
  const configureQuota = useMutation(convexRefs.agentQuota.configureAgentQuota);
  const [rotatingAgentId, setRotatingAgentId] = useState<string | null>(null);
  const [configuringAgentId, setConfiguringAgentId] = useState<string | null>(
    null,
  );
  const [newPublicKey, setNewPublicKey] = useState("");
  const [monthlyLimitUnits, setMonthlyLimitUnits] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  if (viewer === undefined) {
    return (
      <div className="h-72 animate-pulse border border-row-border bg-card" />
    );
  }
  if (viewer === null) {
    return (
      <section className="max-w-xl space-y-4 border border-row-border bg-card p-5">
        <h2 className="text-xl font-semibold">Sign in to manage your agents</h2>
        <p className="text-sm leading-7 text-muted-foreground">
          This console only shows agents enrolled by your human account.
        </p>
        <SignInPanel />
      </section>
    );
  }
  if (viewer.isAgent) {
    return (
      <section className="max-w-xl border border-row-border bg-card p-5">
        <h2 className="text-xl font-semibold">Human account required</h2>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          Agent credentials cannot access owner controls. Sign in with the human
          account that enrolled this agent.
        </p>
      </section>
    );
  }
  if (status === undefined) {
    return (
      <div className="h-72 animate-pulse border border-row-border bg-card" />
    );
  }

  async function revoke(agentId: string) {
    if (
      !window.confirm(
        `Revoke ${agentId}? Its active credentials will stop working.`,
      )
    )
      return;
    setPending(`revoke:${agentId}`);
    try {
      await revokeAgent({ agentId });
      toast.success(`${agentId} revoked`);
    } catch (error) {
      toast.error(errorMessage(error, "The agent could not be revoked."));
    } finally {
      setPending(null);
    }
  }

  async function rotate(agentId: string, agentScopes: AgentScope[]) {
    const key = newPublicKey.trim();
    if (!key) {
      toast.error("Paste a new Ed25519 public key before rotating.");
      return;
    }
    setPending(`rotate:${agentId}`);
    try {
      await rotateAgentKey({ agentId, newPublicKey: key, scopes: agentScopes });
      setNewPublicKey("");
      setRotatingAgentId(null);
      toast.success(`${agentId} key rotated`);
    } catch (error) {
      toast.error(errorMessage(error, "The agent key could not be rotated."));
    } finally {
      setPending(null);
    }
  }

  async function saveQuota(agentId: string) {
    const value = Number(monthlyLimitUnits);
    if (!Number.isSafeInteger(value) || value < 1) {
      toast.error("Monthly limit must be a positive whole number.");
      return;
    }
    setPending(`quota:${agentId}`);
    try {
      await configureQuota({ agentId, monthlyLimitUnits: value });
      setConfiguringAgentId(null);
      setMonthlyLimitUnits("");
      toast.success(`${agentId} quota updated`);
    } catch (error) {
      toast.error(errorMessage(error, "The agent quota could not be updated."));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="border border-row-border bg-card p-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          UTC month {status.monthKey}
        </p>
        <h2 className="mt-2 text-xl font-semibold">Owner quota</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          {status.ownerQuota.usedUnits} used ·{" "}
          {status.ownerQuota.remainingUnits} remaining · hard cap{" "}
          {status.ownerQuota.hardCapUnits}
        </p>
      </section>
      {status.agents.length === 0 ? (
        <section className="border border-row-border bg-card p-5 text-sm leading-7 text-muted-foreground">
          No agents are enrolled by this account yet. Enroll one from the agent
          setup page.
        </section>
      ) : (
        status.agents.map((agent) => (
          <section
            className="space-y-4 border border-row-border bg-card p-5"
            key={agent.agentId}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{agent.agentId}</h2>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {agent.status} · key v{agent.keyVersion} · public fingerprint{" "}
                  {agent.publicKeyFingerprint}
                </p>
              </div>
              {agent.status === "active" ? (
                <Button
                  disabled={pending !== null}
                  onClick={() => void revoke(agent.agentId)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {pending === `revoke:${agent.agentId}`
                    ? "Revoking…"
                    : "Revoke"}
                </Button>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              Scopes: {agent.scopes.join(", ") || "none"} · quota:{" "}
              {agent.quota.usedUnits}/{agent.quota.monthlyLimitUnits} used (
              {agent.quota.remainingUnits} remaining)
            </p>
            {configuringAgentId === agent.agentId ? (
              <div className="space-y-3 border border-row-border bg-background/50 p-3">
                <label className="flex flex-col gap-2 text-sm font-medium">
                  Per-agent monthly quota
                  <Input
                    inputMode="numeric"
                    min="1"
                    onChange={(event) =>
                      setMonthlyLimitUnits(event.target.value)
                    }
                    type="number"
                    value={monthlyLimitUnits}
                  />
                </label>
                <div className="flex gap-2">
                  <Button
                    disabled={pending !== null}
                    onClick={() => void saveQuota(agent.agentId)}
                    size="sm"
                    type="button"
                  >
                    {pending === `quota:${agent.agentId}`
                      ? "Saving…"
                      : "Save quota"}
                  </Button>
                  <Button
                    disabled={pending !== null}
                    onClick={() => {
                      setConfiguringAgentId(null);
                      setMonthlyLimitUnits("");
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                disabled={pending !== null}
                onClick={() => {
                  setConfiguringAgentId(agent.agentId);
                  setMonthlyLimitUnits(String(agent.quota.monthlyLimitUnits));
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Configure quota
              </Button>
            )}
            {agent.status === "active" ? (
              rotatingAgentId === agent.agentId ? (
                <div className="space-y-3 border border-row-border bg-background/50 p-3">
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Replacement Ed25519 public key (base64url)
                    <Input
                      autoComplete="off"
                      onChange={(event) => setNewPublicKey(event.target.value)}
                      value={newPublicKey}
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button
                      disabled={pending !== null}
                      onClick={() => void rotate(agent.agentId, agent.scopes)}
                      size="sm"
                      type="button"
                    >
                      {pending === `rotate:${agent.agentId}`
                        ? "Rotating…"
                        : "Rotate key"}
                    </Button>
                    <Button
                      disabled={pending !== null}
                      onClick={() => {
                        setRotatingAgentId(null);
                        setNewPublicKey("");
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  disabled={pending !== null}
                  onClick={() => setRotatingAgentId(agent.agentId)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Rotate key
                </Button>
              )
            ) : null}
          </section>
        ))
      )}
    </div>
  );
}

function errorMessage(error: unknown, fallback: string) {
  const data = error instanceof ConvexError ? error.data : null;
  return typeof data === "string" && data.trim() ? data : fallback;
}
