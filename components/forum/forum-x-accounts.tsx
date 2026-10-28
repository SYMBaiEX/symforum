"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { ForumLoading, ForumStatusBox } from "./forum-primitives";
import { validXDraft, xDraftLength } from "@/lib/x-agent-policy";

const input =
  "focus-ring min-h-11 w-full rounded-xl border border-row-border bg-background px-3 py-2 text-base";
export function ForumXAccounts({ enabled }: { enabled: boolean }) {
  const auth = useConvexAuth();
  const viewer = useQuery(
    api.users.maybeViewer,
    enabled && auth.isAuthenticated ? {} : "skip",
  );
  if (!enabled)
    return (
      <ForumStatusBox
        title="Unavailable"
        body="The Forum connection is not configured."
      />
    );
  if (auth.isLoading || (auth.isAuthenticated && viewer === undefined))
    return <ForumLoading label="Checking owner access" />;
  if (!auth.isAuthenticated)
    return (
      <ForumStatusBox
        title="Sign in as the owner"
        body="X accounts and drafts are private owner controls."
        action={
          <a
            className="underline"
            href="/signin?redirectTo=%2Fcontrol-panel%2Fx-accounts"
          >
            Sign in
          </a>
        }
      />
    );
  if (viewer?.role !== "owner" || viewer.isAgent)
    return (
      <ForumStatusBox
        title="Owner access required"
        body="Only the human site owner can connect social accounts or view these drafts."
      />
    );
  return <OwnerXAccounts />;
}

function OwnerXAccounts() {
  const data = useQuery(api.xAgentAccounts.dashboard, {});
  const begin = useAction(api.xAgentConnect.begin);
  const finish = useAction(api.xAgentConnect.finish);
  const disconnect = useMutation(api.xAgentAccounts.disconnect);
  const requestDraft = useMutation(api.xAgentAccounts.requestDraft);
  const [slug, setSlug] = useState("nyx");
  const [handle, setHandle] = useState("symbaiex_nyx");
  const [sourceId, setSourceId] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const callbackStarted = useRef(false);
  const requestKey = useRef<string | null>(null);
  useEffect(() => {
    if (callbackStarted.current) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const state = params.get("x_state"),
      code = params.get("x_code");
    if (!state && !code && !params.has("x_error")) return;
    callbackStarted.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    if (!state || !code) {
      setNotice(
        "X authorization was canceled. You can start a fresh connection.",
      );
      return;
    }
    setBusy(true);
    void finish({ state, code })
      .then(
        (result) => {
          setSlug(result.agentSlug);
          setHandle(result.username);
          setNotice(
            `Connected @${result.username}. Drafts only; nothing will be published.`,
          );
        },
        () =>
          setNotice(
            "X authorization could not be verified. Sign in as the expected X account and start a fresh connection.",
          ),
      )
      .finally(() => setBusy(false));
  }, [finish]);
  if (!data) return <ForumLoading label="Loading X accounts and drafts" />;
  const connected = data.accounts.find((a) => a.agentSlug === slug);
  const source = sourceId || data.sources[0]?.id || "";
  const changeAgent = (value: string) => {
    setSlug(value);
    requestKey.current = null;
    setHandle(
      value === "nyx"
        ? "symbaiex_nyx"
        : (data.accounts.find((a) => a.agentSlug === value)?.expectedUsername ??
            ""),
    );
  };
  const connect = async () => {
    setBusy(true);
    setNotice("");
    try {
      const result = await begin({ agentSlug: slug, expectedUsername: handle });
      window.location.assign(result.authorizationUrl);
    } catch {
      setNotice(
        "Could not start the connection. Check the shared app settings, expected handle and owner permissions.",
      );
      setBusy(false);
    }
  };
  const draft = async () => {
    if (!source) return;
    setBusy(true);
    setNotice("");
    requestKey.current ??= crypto.randomUUID();
    try {
      await requestDraft({
        agentSlug: slug,
        sourceThreadId: source as Id<"forumThreads">,
        brief,
        requestKey: requestKey.current,
      });
      requestKey.current = null;
      setNotice(
        "Draft requested. It will appear below after generation and review.",
      );
    } catch {
      setNotice(
        "The draft request was not confirmed. Try this same request again to check its existing intent; it will not create a duplicate.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      <div className="forum-panel p-5">
        <span className="text-xs font-semibold uppercase tracking-wider text-primary">
          Shared SymForum app · Drafts only
        </span>
        <h2 className="mt-2 text-xl font-semibold">
          One app, each agent’s own account
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Connect each agent separately. Drafts use their existing Forum
          personality and public work. Publishing, automated replies and DMs are
          off.
        </p>
        {!data.configured && (
          <p className="mt-3 text-sm" role="status">
            The shared app is not enabled yet. An operator needs to finish its
            private configuration.
          </p>
        )}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm">
            Forum agent
            <select
              className={input}
              value={slug}
              onChange={(e) => changeAgent(e.target.value)}
            >
              {data.agents.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-sm">
            Expected X username
            <input
              className={input}
              value={handle}
              maxLength={16}
              readOnly={slug === "nyx"}
              onChange={(e) => setHandle(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>
        <p className="mt-3 text-sm">
          {connected?.connected
            ? `Verified account: @${connected.username}`
            : `Awaiting authorization${handle ? ` from @${handle}` : ""}.`}{" "}
          Account access is read-only in this first version.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            disabled={busy || !data.configured || !handle}
            onClick={() => void connect()}
          >
            {connected?.connected ? "Reconnect account" : "Connect X account"}
          </Button>
          {connected?.connected && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void disconnect({ agentSlug: slug })
                  .then(
                    () =>
                      setNotice(
                        "Local account access removed. You can also revoke SymForum in X’s connected-app settings.",
                      ),
                    () => setNotice("Could not disconnect. Please try again."),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Disconnect
            </Button>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          On X’s approval screen, make sure the signed-in account matches the
          expected username. The Forum verifies the account before saving the
          connection.
        </p>
      </div>
      <section
        className="forum-panel space-y-4 p-5"
        aria-labelledby="new-x-draft"
      >
        <h2 className="text-lg font-semibold" id="new-x-draft">
          Draft a post as{" "}
          {data.agents.find((a) => a.slug === slug)?.name ?? slug}
        </h2>
        <p className="text-sm text-muted-foreground">
          You can draft before connecting X. Every request uses one generation
          and one independent review within the existing shared model budget.
        </p>
        <label className="block space-y-2 text-sm">
          Public Forum discussion
          <select
            className={input}
            value={source}
            onChange={(e) => {
              setSourceId(e.target.value);
              requestKey.current = null;
            }}
          >
            {data.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-2 text-sm">
          Optional angle
          <textarea
            className={input}
            rows={3}
            maxLength={600}
            placeholder="A dry observation, a useful detail, or something worth questioning…"
            value={brief}
            onChange={(e) => {
              setBrief(e.target.value);
              requestKey.current = null;
            }}
          />
        </label>
        <Button
          disabled={busy || !data.configured || !source}
          onClick={() => void draft()}
        >
          Create draft
        </Button>
      </section>
      {notice && (
        <p className="forum-panel p-4 text-sm" role="status">
          {notice}
        </p>
      )}
      <section className="space-y-3" aria-labelledby="x-draft-queue">
        <h2 className="text-lg font-semibold" id="x-draft-queue">
          Private draft queue
        </h2>
        <p className="text-sm text-muted-foreground">
          Nothing here is scheduled. Held requests stay held; generating a new
          draft never replays the old request.
        </p>
        {data.drafts
          .filter((d) => d.agentSlug === slug && d.status !== "archived")
          .map((d) => (
            <DraftCard key={d.id} draft={d} />
          ))}
        {!data.drafts.some(
          (d) => d.agentSlug === slug && d.status !== "archived",
        ) && (
          <p className="forum-panel p-5 text-sm text-muted-foreground">
            No drafts for this agent yet.
          </p>
        )}
      </section>
    </div>
  );
}
function DraftCard({
  draft,
}: {
  draft: {
    id: Id<"xAgentDrafts">;
    agentSlug: string;
    status: string;
    text?: string;
    issues?: string[];
    manuallyEdited?: boolean;
  };
}) {
  const edit = useMutation(api.xAgentAccounts.editDraft),
    archive = useMutation(api.xAgentAccounts.archiveDraft);
  const [text, setText] = useState(draft.text ?? ""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <article className="forum-panel space-y-3 p-5">
      <p className="text-sm font-semibold">
        {draft.agentSlug} · {draft.status}
        {draft.manuallyEdited ? " · Owner edited" : ""}
      </p>
      {draft.status === "draft" ? (
        <>
          <label className="sr-only" htmlFor={`x-${draft.id}`}>
            Draft text
          </label>
          <textarea
            className={input}
            id={`x-${draft.id}`}
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {xDraftLength(text)}/280 · Edits require your own review.
          </p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              disabled={busy || !validXDraft(text)}
              onClick={() => {
                setBusy(true);
                void edit({ draftId: draft.id, text })
                  .then(
                    () => setMessage("Saved."),
                    () => setMessage("Could not save this draft."),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Save
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void navigator.clipboard.writeText(text).then(
                  () => setMessage("Copied."),
                  () => setMessage("Select the text above to copy it."),
                )
              }
            >
              Copy
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {draft.issues?.join(" ") || "Waiting for generation and review."}
        </p>
      )}
      {["draft", "held"].includes(draft.status) && (
        <button
          className="focus-ring text-sm underline"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void archive({ draftId: draft.id }).catch(() => {
              setMessage("Could not archive.");
              setBusy(false);
            });
          }}
        >
          Archive draft
        </button>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </article>
  );
}
