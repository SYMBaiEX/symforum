"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { asRoute } from "@/lib/typed-route";
import { Button } from "@/components/ui/button";

export function AgentServiceClaim({
  attemptToken,
}: {
  attemptToken: string | null;
}) {
  const viewer = useQuery(api.users.viewer, {});
  const human = !!viewer && !viewer.isAgent;
  const claim = useQuery(
    api.agentServiceAuth.viewClaim,
    human && attemptToken ? { attemptToken } : "skip",
  );
  const status = useQuery(
    api.agentIdentity.listMyAgentConsoleStatus,
    human ? {} : "skip",
  );
  const registrations = useQuery(
    api.agentServiceAuth.listMyRegistrations,
    human ? {} : "skip",
  );
  const complete = useMutation(api.agentServiceAuth.completeClaim);
  const revoke = useMutation(api.agentServiceAuth.revokeRegistration);
  const revokeAll = useMutation(api.agentServiceAuth.revokeAllMyRegistrations);
  const [code, setCode] = useState("");
  const [agentId, setAgentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (viewer === undefined) return <p role="status">Loading your account…</p>;
  if (!viewer) {
    const destination = `/agent/claim${attemptToken ? `?claim_attempt_token=${encodeURIComponent(attemptToken)}` : ""}`;
    return (
      <Link
        className="underline"
        href={asRoute(
          `/signin?mode=signIn&redirectTo=${encodeURIComponent(destination)}`,
        )}
      >
        Sign in with your existing owner account
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
    <div className="space-y-8">
      {attemptToken &&
        (claim === undefined ? (
          <p role="status">Checking the claim…</p>
        ) : claim === null ? (
          <p role="alert">
            This claim does not match your account. Sign in as the original
            email supplied by your agent.
          </p>
        ) : claim.status === "active" ? (
          <p role="status">
            Approved. Your agent can complete its token exchange. You can
            disconnect it below.
          </p>
        ) : claim.status !== "pending" ? (
          <p role="alert">
            This claim is no longer available. Ask your agent to restart.
          </p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setMessage("");
              try {
                const result = await complete({
                  attemptToken,
                  userCode: code,
                  agentId,
                });
                setMessage(
                  result.ok
                    ? "Approved. Return to your agent; do not send it your password or session."
                    : (result.error ?? "Unable to approve."),
                );
                if (result.ok) setCode("");
              } catch {
                setMessage(
                  "Unable to approve. Check your sign-in and restart the request if needed.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              Signed in for <strong>{claim.email}</strong>. Code expires{" "}
              {new Date(claim.expiresAt).toLocaleString()}.
            </p>
            <label className="block space-y-2">
              <span>Six-digit code supplied by your agent</span>
              <input
                className="w-full border border-row-border bg-background p-3"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ""))
                }
              />
            </label>
            <label className="block space-y-2">
              <span>Your evidence agent</span>
              <select
                className="w-full border border-row-border bg-background p-3"
                required
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
              >
                <option value="" disabled>
                  Select an agent
                </option>
                {agents.map((agent) => (
                  <option key={agent.agentId} value={agent.agentId}>
                    {agent.agentId}
                  </option>
                ))}
              </select>
            </label>
            {status && !agents.length && (
              <p>
                There is no eligible agent.{" "}
                <Link href="/agent/signup" className="underline">
                  Enroll an evidence agent
                </Link>{" "}
                separately, then return here.
              </p>
            )}
            <Button
              type="submit"
              disabled={busy || code.length !== 6 || !agentId}
            >
              {busy ? "Approving…" : "Approve evidence access for one hour"}
            </Button>
          </form>
        ))}
      {message && (
        <p role="status" aria-live="polite">
          {message}
        </p>
      )}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">
          Your service-auth registrations
        </h2>
        {registrations === undefined ? (
          <p role="status">Loading registrations…</p>
        ) : registrations.length === 0 ? (
          <p>No active registrations.</p>
        ) : (
          <>
            <ul className="space-y-4">
              {registrations.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-row-border py-3"
                >
                  <span>
                    {row.agentId}
                    <span className="block text-sm text-muted-foreground">
                      Expires {new Date(row.expiresAt).toLocaleString()}
                    </span>
                  </span>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await revoke({ registrationId: row.id });
                        setMessage(
                          "Registration disconnected. All its credentials are invalid.",
                        );
                      } catch {
                        setMessage("Unable to disconnect. Try again.");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Disconnect
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                if (
                  !window.confirm(
                    "Disconnect all service-auth registrations? Existing WorkOS and Ed25519 connections are unchanged.",
                  )
                )
                  return;
                setBusy(true);
                try {
                  await revokeAll({});
                  setMessage("All service-auth registrations disconnected.");
                } catch {
                  setMessage("Unable to disconnect. Try again.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Disconnect all service-auth registrations
            </Button>
          </>
        )}
      </section>
    </div>
  );
}
