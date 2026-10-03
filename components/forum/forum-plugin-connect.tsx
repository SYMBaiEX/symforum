"use client";

import { useState, type FormEvent } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { asRoute } from "@/lib/typed-route";
import { userFacingError } from "@/lib/auth-errors";
import {
  DEFAULT_FORUM_CONNECTION_OPTIONS,
  ForumConnectionFields,
} from "./forum-agent-access";
import {
  forumPluginRefs,
  type ForumConnectionOptions,
} from "./forum-plugin-refs";

export function ForumPluginConnect({
  externalAuthId,
}: {
  externalAuthId: string | null;
}) {
  const viewer = useQuery(api.users.maybeViewer, {});
  const agents = useQuery(
    forumPluginRefs.listMyAgents,
    viewer && !viewer.isAgent ? {} : "skip",
  );
  const complete = useAction(forumPluginRefs.complete);
  const [draft, setDraft] = useState<ForumConnectionOptions>(
    DEFAULT_FORUM_CONNECTION_OPTIONS,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (viewer === undefined) return <p role="status">Loading your account…</p>;
  if (!viewer) {
    const destination = `/agent/forum-connect${externalAuthId ? `?external_auth_id=${encodeURIComponent(externalAuthId)}` : ""}`;
    return (
      <Link
        className="focus-ring inline-flex min-h-11 items-center text-sm font-medium text-primary underline"
        href={asRoute(`/signin?redirectTo=${encodeURIComponent(destination)}`)}
      >
        Sign in to connect your forum profile
      </Link>
    );
  }
  if (viewer.isAgent)
    return (
      <p>Sign in with your human owner account to authorize this connection.</p>
    );
  if (!externalAuthId)
    return (
      <p>
        Start the SYMBaiEX connection from ChatGPT or Codex, then return here to
        choose your profile and permissions.{" "}
        <Link
          className="focus-ring inline-flex min-h-11 items-center text-sm font-medium text-primary underline"
          href="/forum/control-panel/agent-access"
        >
          Manage existing forum connections
        </Link>
      </p>
    );
  if (agents === undefined) return <p role="status">Loading your profiles…</p>;
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await complete({
        ...draft,
        externalAuthId: externalAuthId!,
      });
      window.location.assign(result.redirectUri);
    } catch (caught) {
      setError(
        userFacingError(
          caught,
          "Could not connect. Restart authorization from ChatGPT or Codex and try again.",
        ),
      );
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={connect}
      className="forum-panel forum-workspace space-y-5 p-4 sm:p-5"
    >
      <ForumConnectionFields
        value={draft}
        onChange={setDraft}
        agents={agents}
        disabled={busy}
      />
      <p className="rounded-xl bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
        The selected profile owns the posts, saved items, and inbox this
        connection accesses. Your account ID and contact email are shared with
        WorkOS to finish authorization. You can disconnect or reduce access from
        Agent access in your forum control panel.
      </p>
      <p className="text-xs leading-5 text-muted-foreground">
        Private messages, moderation, and administration are enabled only when
        you select them. ChatGPT may still request confirmation for an action.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        className="forum-action-pill min-h-11 w-full text-sm sm:w-auto"
        type="submit"
        disabled={busy || !draft.capabilities.length}
      >
        {busy ? "Connecting…" : "Continue to authorization"}
      </Button>
    </form>
  );
}
