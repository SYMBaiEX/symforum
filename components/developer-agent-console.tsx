"use client";

import { SignInPanel } from "@/components/signin-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { convexRefs, type AgentScope } from "@/lib/convex-refs";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { toast } from "sonner";

const WEBHOOK_EVENT_TYPES = [
  "evidence.document.changed",
  "evidence.research.completed",
  "evidence.export.completed",
  "evidence.benchmark.completed",
  "evidence.claim.verified",
  "evidence.usage.threshold_reached",
  "evidence.usage.budget_reached",
  "evidence.entitlement.status_changed",
] as const;

export function DeveloperAgentConsole() {
  const viewer = useQuery(convexRefs.users.maybeViewer, {});
  const status = useQuery(
    convexRefs.agentIdentity.listMyAgentConsoleStatus,
    viewer && !viewer.isAgent ? {} : "skip",
  );
  const revokeAgent = useMutation(convexRefs.agentIdentity.revokeAgent);
  const rotateAgentKey = useMutation(convexRefs.agentIdentity.rotateAgentKey);
  const configureQuota = useMutation(convexRefs.agentQuota.configureAgentQuota);
  const webhookAvailability = useQuery(
    convexRefs.evidenceWebhooks.availability,
    viewer && !viewer.isAgent ? {} : "skip",
  );
  const webhooks = useQuery(
    convexRefs.evidenceWebhooks.list,
    viewer && !viewer.isAgent ? {} : "skip",
  );
  const createWebhook = useMutation(convexRefs.evidenceWebhooks.create);
  const setWebhookStatus = useMutation(convexRefs.evidenceWebhooks.setStatus);
  const rotateWebhookSecret = useMutation(convexRefs.evidenceWebhooks.rotate);
  const replayWebhookDelivery = useMutation(convexRefs.evidenceWebhooks.replay);
  const sendWebhookTest = useMutation(convexRefs.evidenceWebhooks.test);
  const [rotatingAgentId, setRotatingAgentId] = useState<string | null>(null);
  const [configuringAgentId, setConfiguringAgentId] = useState<string | null>(
    null,
  );
  const [newPublicKey, setNewPublicKey] = useState("");
  const [monthlyLimitUnits, setMonthlyLimitUnits] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [webhookKey, setWebhookKey] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEventTypes, setWebhookEventTypes] = useState<string[]>([
    "evidence.document.changed",
  ]);
  const [selectedWebhookKey, setSelectedWebhookKey] = useState<string | null>(
    null,
  );
  const [oneTimeWebhookSecret, setOneTimeWebhookSecret] = useState<
    string | null
  >(null);
  const webhookHealth = useQuery(
    convexRefs.evidenceWebhooks.health,
    viewer && !viewer.isAgent && selectedWebhookKey
      ? { subscriptionKey: selectedWebhookKey }
      : "skip",
  );
  const webhookHistory = useQuery(
    convexRefs.evidenceWebhooks.history,
    viewer && !viewer.isAgent && selectedWebhookKey
      ? { subscriptionKey: selectedWebhookKey, limit: 20 }
      : "skip",
  );

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

  async function createSubscription() {
    const subscriptionKey = webhookKey.trim();
    const url = webhookUrl.trim();
    if (!subscriptionKey || !url || webhookEventTypes.length === 0) {
      toast.error("Choose a key, an allowlisted HTTPS URL, and an event type.");
      return;
    }
    setPending("webhook:create");
    try {
      const created = await createWebhook({
        subscriptionKey,
        url,
        eventTypes: webhookEventTypes,
      });
      setWebhookKey("");
      setWebhookUrl("");
      setSelectedWebhookKey(created.subscriptionKey);
      setOneTimeWebhookSecret(created.signingSecret ?? null);
      toast.success("Webhook subscription created.");
    } catch (error) {
      toast.error(errorMessage(error, "The webhook could not be created."));
    } finally {
      setPending(null);
    }
  }

  async function changeWebhookStatus(
    subscriptionKey: string,
    status: "active" | "paused" | "revoked",
  ) {
    if (
      status === "revoked" &&
      !window.confirm(`Revoke ${subscriptionKey}? It cannot be reactivated.`)
    )
      return;
    setPending(`webhook:status:${subscriptionKey}`);
    try {
      await setWebhookStatus({ subscriptionKey, status });
      toast.success(`${subscriptionKey} is now ${status}.`);
    } catch (error) {
      toast.error(
        errorMessage(error, "The webhook status could not be updated."),
      );
    } finally {
      setPending(null);
    }
  }

  async function rotateSecret(subscriptionKey: string) {
    if (
      !window.confirm(
        "Rotate this signing secret? Existing receivers must be updated immediately.",
      )
    )
      return;
    setPending(`webhook:rotate:${subscriptionKey}`);
    try {
      const result = await rotateWebhookSecret({ subscriptionKey });
      setOneTimeWebhookSecret(result.signingSecret ?? null);
      toast.success("New signing secret created. Save it now.");
    } catch (error) {
      toast.error(
        errorMessage(error, "The signing secret could not be rotated."),
      );
    } finally {
      setPending(null);
    }
  }

  async function sendTest(subscriptionKey: string, eventType: string) {
    setPending(`webhook:test:${subscriptionKey}`);
    try {
      await sendWebhookTest({ subscriptionKey, eventType });
      toast.success("Test delivery queued.");
    } catch (error) {
      toast.error(
        errorMessage(error, "The test delivery could not be queued."),
      );
    } finally {
      setPending(null);
    }
  }

  async function replayDelivery(subscriptionKey: string, eventKey: string) {
    setPending(`webhook:replay:${eventKey}`);
    try {
      await replayWebhookDelivery({ subscriptionKey, eventKey });
      toast.success("Delivery replay queued.");
    } catch (error) {
      toast.error(errorMessage(error, "The delivery cannot be replayed."));
    } finally {
      setPending(null);
    }
  }

  async function copySecret() {
    if (!oneTimeWebhookSecret) return;
    try {
      await navigator.clipboard.writeText(oneTimeWebhookSecret);
      toast.success("Signing secret copied. Store it in a secret manager now.");
    } catch {
      toast.error("Clipboard access was unavailable. Copy the value manually.");
    }
  }

  function downloadSecret() {
    if (!oneTimeWebhookSecret) return;
    const blob = new Blob([`${oneTimeWebhookSecret}\n`], {
      type: "text/plain;charset=utf-8",
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = "symbaiex-webhook-signing-secret.txt";
    anchor.click();
    URL.revokeObjectURL(objectUrl);
    toast.success(
      "Secret downloaded. Move it into a secret manager, then delete the file.",
    );
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
      <section className="space-y-4 border border-row-border bg-card p-5">
        <div>
          <h2 className="text-xl font-semibold">Evidence webhooks</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Deliveries are HMAC-SHA256 signed. Destinations must be exact,
            operator-approved HTTPS hosts; signing secrets are shown once and
            are never retained in this console.
          </p>
        </div>
        {webhookAvailability === undefined ? (
          <div className="h-16 animate-pulse bg-muted/30" />
        ) : !webhookAvailability.enabled ? (
          <p className="border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-6 text-muted-foreground">
            Webhook delivery is disabled until an operator configures an exact
            destination-host allowlist. Existing secrets and destinations are
            not exposed.
          </p>
        ) : (
          <>
            {oneTimeWebhookSecret ? (
              <div className="space-y-3 border border-amber-500/40 bg-amber-500/10 p-4">
                <p className="text-sm font-semibold">
                  Save this signing secret now
                </p>
                <p className="text-sm leading-6 text-muted-foreground">
                  It cannot be recovered after you close this notice. Do not
                  paste it into chat, tickets, source control, or a URL.
                </p>
                <Input readOnly value={oneTimeWebhookSecret} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void copySecret()}
                    size="sm"
                    type="button"
                  >
                    Copy secret
                  </Button>
                  <Button
                    onClick={downloadSecret}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Download once
                  </Button>
                  <Button
                    onClick={() => setOneTimeWebhookSecret(null)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    I saved it — dismiss
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="grid gap-3 border border-row-border bg-background/50 p-3 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium">
                Subscription key
                <Input
                  autoComplete="off"
                  maxLength={96}
                  onChange={(event) => setWebhookKey(event.target.value)}
                  placeholder="research-events"
                  value={webhookKey}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium">
                Allowlisted HTTPS receiver
                <Input
                  autoComplete="off"
                  inputMode="url"
                  onChange={(event) => setWebhookUrl(event.target.value)}
                  placeholder="https://hooks.example.com/symbaiex"
                  value={webhookUrl}
                />
              </label>
              <fieldset className="md:col-span-2">
                <legend className="text-sm font-medium">Events</legend>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                  {WEBHOOK_EVENT_TYPES.map((eventType) => (
                    <label className="flex items-center gap-2" key={eventType}>
                      <input
                        checked={webhookEventTypes.includes(eventType)}
                        onChange={(event) =>
                          setWebhookEventTypes((current) =>
                            event.target.checked
                              ? [...current, eventType]
                              : current.filter((value) => value !== eventType),
                          )
                        }
                        type="checkbox"
                      />
                      {eventType}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="md:col-span-2">
                <Button
                  disabled={pending !== null || webhookEventTypes.length === 0}
                  onClick={() => void createSubscription()}
                  size="sm"
                  type="button"
                >
                  {pending === "webhook:create"
                    ? "Creating…"
                    : "Create webhook"}
                </Button>
              </div>
            </div>
            {webhooks === undefined ? (
              <div className="h-24 animate-pulse bg-muted/30" />
            ) : webhooks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No webhook subscriptions yet.
              </p>
            ) : (
              <div className="space-y-3">
                {webhooks.map((webhook) => (
                  <div
                    className="space-y-3 border border-row-border p-3"
                    key={webhook.subscriptionKey}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{webhook.subscriptionKey}</p>
                        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                          {webhook.url}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {webhook.status} · {webhook.eventTypes.join(", ")}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={pending !== null}
                          onClick={() =>
                            setSelectedWebhookKey(webhook.subscriptionKey)
                          }
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Inspect
                        </Button>
                        {webhook.status === "active" ? (
                          <Button
                            disabled={pending !== null}
                            onClick={() =>
                              void changeWebhookStatus(
                                webhook.subscriptionKey,
                                "paused",
                              )
                            }
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            Pause
                          </Button>
                        ) : null}
                        {webhook.status === "paused" ? (
                          <Button
                            disabled={pending !== null}
                            onClick={() =>
                              void changeWebhookStatus(
                                webhook.subscriptionKey,
                                "active",
                              )
                            }
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            Resume
                          </Button>
                        ) : null}
                        {webhook.status !== "revoked" ? (
                          <Button
                            disabled={pending !== null}
                            onClick={() =>
                              void changeWebhookStatus(
                                webhook.subscriptionKey,
                                "revoked",
                              )
                            }
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            Revoke
                          </Button>
                        ) : null}
                        {webhook.status !== "revoked" ? (
                          <Button
                            disabled={pending !== null}
                            onClick={() =>
                              void rotateSecret(webhook.subscriptionKey)
                            }
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            Rotate secret
                          </Button>
                        ) : null}
                        {webhook.status === "active" ? (
                          <Button
                            disabled={pending !== null}
                            onClick={() =>
                              void sendTest(
                                webhook.subscriptionKey,
                                webhook.eventTypes[0] ??
                                  "evidence.document.changed",
                              )
                            }
                            size="sm"
                            type="button"
                          >
                            Send test
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {selectedWebhookKey ? (
              <div className="space-y-3 border border-row-border bg-background/50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">
                    {selectedWebhookKey} delivery history
                  </h3>
                  <Button
                    onClick={() => setSelectedWebhookKey(null)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Close
                  </Button>
                </div>
                {webhookHealth ? (
                  <p className="text-sm text-muted-foreground">
                    Delivered {webhookHealth.delivered} · pending{" "}
                    {webhookHealth.pending} · failed {webhookHealth.failed} ·
                    dead letter {webhookHealth.deadLetter}
                  </p>
                ) : (
                  <div className="h-5 animate-pulse bg-muted/30" />
                )}
                {webhookHistory === undefined ? (
                  <div className="h-24 animate-pulse bg-muted/30" />
                ) : webhookHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No delivery history yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {webhookHistory.map((delivery) => (
                      <div
                        className="flex flex-wrap items-center justify-between gap-2 border border-row-border p-2 text-xs"
                        key={delivery.eventKey}
                      >
                        <span className="break-all font-mono">
                          {delivery.eventKey}
                        </span>
                        <span>
                          {delivery.status} · attempt {delivery.attempt}
                          {delivery.responseCode
                            ? ` · HTTP ${delivery.responseCode}`
                            : ""}
                        </span>
                        {delivery.status === "dead_letter" ||
                        delivery.status === "failed" ? (
                          <Button
                            disabled={pending !== null}
                            onClick={() =>
                              void replayDelivery(
                                selectedWebhookKey,
                                delivery.eventKey,
                              )
                            }
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            Replay
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}
      </section>
      {status.truncated ? (
        <p className="text-sm text-muted-foreground" role="status">
          Showing your 50 most recently enrolled agents.
        </p>
      ) : null}
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
