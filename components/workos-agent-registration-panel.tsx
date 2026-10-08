"use client";

import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { toast } from "sonner";

const enabled =
  process.env.NEXT_PUBLIC_WORKOS_AGENT_REGISTRATION_ENABLED === "true";

export function WorkOSAgentRegistrationPanel() {
  const { user, loading } = useAuth();
  const registrations = useQuery(
    api.agentIdentity.listMyWorkOSAgentRegistrations,
    enabled ? {} : "skip",
  );
  const linkRegistration = useMutation(
    api.agentIdentity.linkMyWorkOSAgentRegistration,
  );
  const revokeRegistration = useMutation(
    api.agentIdentity.revokeMyWorkOSAgentRegistration,
  );
  const [agentId, setAgentId] = useState("");
  const [registrationId, setRegistrationId] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  if (!enabled) return null;

  async function link() {
    setPending("link");
    try {
      const result = await linkRegistration({
        agentId: agentId.trim(),
        registrationId: registrationId.trim(),
      });
      setAgentId("");
      setRegistrationId("");
      toast.success(`WorkOS registration linked to ${result.agentId}.`);
    } catch (error) {
      toast.error(errorMessage(error, "The WorkOS registration could not be linked."));
    } finally {
      setPending(null);
    }
  }

  async function revoke(registration: string) {
    if (!window.confirm(`Revoke WorkOS registration ${registration}?`)) return;
    setPending(`revoke:${registration}`);
    try {
      await revokeRegistration({ registrationId: registration });
      toast.success("WorkOS registration revoked. Its access to SYMBaiEX stops immediately.");
    } catch (error) {
      toast.error(errorMessage(error, "The WorkOS registration could not be revoked."));
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="space-y-4 border border-row-border bg-card p-5">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          WorkOS Agent Registration
        </p>
        <h2 className="mt-2 text-xl font-semibold">Link a claimed agent</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Complete WorkOS’s service-auth claim flow, then link its
          <code className="mx-1">agent_reg_…</code> ID to an active evidence
          agent you own. Use short-lived access tokens for the evidence resource.
          Never paste a token, refresh token, or API key here.
        </p>
      </div>
      {!user && !loading ? (
        <p className="border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-6 text-muted-foreground">
          Sign in with your linked WorkOS account before linking or revoking a
          registration.
        </p>
      ) : null}
      <form
        className="grid gap-3 md:grid-cols-[1fr_1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void link();
        }}
      >
        <label className="flex flex-col gap-2 text-sm font-medium">
          Existing evidence agent ID
          <Input
            autoComplete="off"
            onChange={(event) => setAgentId(event.target.value)}
            pattern="[a-z0-9][a-z0-9._-]{1,63}"
            required
            value={agentId}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          WorkOS registration ID
          <Input
            autoComplete="off"
            onChange={(event) => setRegistrationId(event.target.value)}
            pattern="agent_reg_[A-Za-z0-9]{8,64}"
            placeholder="agent_reg_…"
            required
            value={registrationId}
          />
        </label>
        <div className="flex items-end">
          <Button
            className="w-full md:w-auto"
            disabled={pending !== null || !user || loading}
            type="submit"
          >
            {pending === "link" ? "Linking…" : "Link registration"}
          </Button>
        </div>
      </form>
      {registrations === undefined ? (
        <div className="h-12 animate-pulse bg-muted/30" />
      ) : registrations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No WorkOS registrations are linked.</p>
      ) : (
        <ul className="divide-y divide-row-border border-y border-row-border">
          {registrations.map((registration) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              key={registration.registrationId}
            >
              <div className="min-w-0">
                <p className="font-medium">{registration.agentId}</p>
                <code className="break-all text-xs text-muted-foreground">
                  {registration.registrationId}
                </code>
                <span className="ml-2 text-xs text-muted-foreground">
                  {registration.status}
                </span>
              </div>
              {registration.status === "active" ? (
                <Button
                  disabled={pending !== null}
                  onClick={() => void revoke(registration.registrationId)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {pending === `revoke:${registration.registrationId}`
                    ? "Revoking…"
                    : "Revoke"}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (
      typeof data === "object" &&
      data !== null &&
      "message" in data &&
      typeof data.message === "string"
    )
      return data.message;
    if (typeof data === "string" && data.length > 0) return data;
  }
  return fallback;
}
