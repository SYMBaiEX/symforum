"use client";
import { installation } from "@/lib/installation";
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";

/** Rendered inside the human-owner account console only. Server checks remain authoritative. */
export function ForumAlphaPublisher() {
  const data = useQuery(api.forumAlphaDistribution.dashboard, {});
  const begin = useAction(api.xAgentConnect.begin);
  const disconnect = useMutation(api.xAgentAccounts.disconnect);
  const verify = useMutation(api.forumAlphaDistribution.verifyProject);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [handle, setHandle] = useState("");
  const [proof, setProof] = useState("");
  if (!data) return null;
  return (
    <section
      className="forum-panel space-y-4 p-5"
      aria-labelledby="alpha-publisher"
    >
      <h2 id="alpha-publisher" className="text-lg font-semibold">
        Forum Alpha · @{installation.x.accounts.symforum || "publisher"}
      </h2>
      <p className="text-sm text-muted-foreground">
        Fresh reviewed Forum discoveries go to the dedicated Telegram topic
        first. Selected highlights can reach @{installation.x.accounts.symforum || "publisher"} after {data.leadMinutes}{" "}
        minutes, at most six per day and two hours apart. NyX keeps her own
        feed. This does not change your Typefully queue or manual posts.
      </p>
      <p className="text-sm">
        {data.enabled
          ? "Telegram distribution enabled."
          : "Telegram distribution awaiting operator activation."}{" "}
        {data.brandConnected
          ? `@${installation.x.accounts.symforum} verified and ready.`
          : `Connect @${installation.x.accounts.symforum || "publisher"} to enable X delivery.`}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setNotice("");
            void begin({
              agentSlug: "symforum",
              expectedUsername: installation.x.accounts.symforum,
            }).then(
              (r) => window.location.assign(r.authorizationUrl),
              () => {
                setNotice(
                  "Connection could not start. Sign in as the human Forum owner.",
                );
                setBusy(false);
              },
            );
          }}
        >
          Connect @{installation.x.accounts.symforum || "publisher"} publisher
        </Button>
        {data.brandConnected && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void disconnect({ agentSlug: "symforum" })
                .then(
                  () =>
                    setNotice("X coverage paused. Telegram remains separate."),
                  () => setNotice("Could not confirm pause."),
                )
                .finally(() => setBusy(false));
            }}
          >
            Pause X coverage
          </Button>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer">Verify a project tag</summary>
        <p className="mt-3 text-muted-foreground">
          Check that the original project website links this X account. A story
          must cite that website host or explicitly name the verified project to
          use its tag. Verification expires after 30 days. News sites and token
          metadata are not project identity proof.
        </p>
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void verify({
              name: name || undefined,
              host,
              username: handle.replace(/^@/, ""),
              proofUrl: proof,
            })
              .then(
                () => setNotice("Project tag saved."),
                () =>
                  setNotice(
                    "Use a project website URL, its exact host and a valid X username.",
                  ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <label className="block">
            Full project name (optional)
            <input
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ondo Finance"
              className="focus-ring ml-2 rounded border bg-background p-2"
            />
          </label>
          <label className="block">
            Original project host
            <input
              required
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="project.org"
              className="focus-ring ml-2 rounded border bg-background p-2"
            />
          </label>
          <label className="block">
            Official X username
            <input
              required
              value={handle}
              maxLength={16}
              onChange={(e) => setHandle(e.target.value)}
              className="focus-ring ml-2 rounded border bg-background p-2"
            />
          </label>
          <label className="block">
            Website page linking the account
            <input
              required
              type="url"
              value={proof}
              onChange={(e) => setProof(e.target.value)}
              className="focus-ring ml-2 rounded border bg-background p-2"
            />
          </label>
          <Button disabled={busy} type="submit">
            Save verified project tag
          </Button>
        </form>
      </details>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {!!data.deliveries.length && (
        <ul className="space-y-2 text-sm">
          {data.deliveries.map((d) => (
            <li key={d.id}>
              {d.title}
              <span className="block text-muted-foreground">
                Telegram: {d.telegramStatus} · X: {d.xStatus}
                {d.issue ? ` · ${d.issue}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
