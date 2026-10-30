"use client";

import { useRef, useState } from "react";
import { useConvex, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useForumRuntime } from "@/components/forum/forum-runtime-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { primarySiteUrl } from "@/lib/site-urls";

type Preview = FunctionReturnType<typeof api.forum.previewForumTaxonomy>;
type Receipt = FunctionReturnType<typeof api.forum.applyForumTaxonomy>;
type ReviewState = {
  preview: Preview | null;
  confirmed: boolean;
  busy: "preview" | "apply" | null;
  error: string | null;
  receipt: Receipt | null;
};

export function AdminForumTaxonomy() {
  const { host } = useForumRuntime();
  if (host !== "website") {
    return (
      <p className="mt-6 text-sm text-muted-foreground">
        Board organization changes require the first-party admin session.{" "}
        <a
          className="focus-ring text-primary underline underline-offset-4"
          href={primarySiteUrl("/admin/forum#board-organization")}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open board organization
        </a>
      </p>
    );
  }
  return <TaxonomyReview />;
}

function TaxonomyReview() {
  const convex = useConvex();
  const apply = useMutation(api.forum.applyForumTaxonomy);
  const working = useRef(false);
  const consumedFingerprint = useRef<string | null>(null);
  const [state, setState] = useState<ReviewState>({
    preview: null,
    confirmed: false,
    busy: null,
    error: null,
    receipt: null,
  });

  async function requestPreview() {
    if (working.current) return;
    working.current = true;
    setState({
      preview: null,
      confirmed: false,
      busy: "preview",
      error: null,
      receipt: null,
    });
    try {
      // An explicit one-shot read, not a mounted subscription or polling loop.
      const preview = await convex.query(api.forum.previewForumTaxonomy, {
        now: Date.now(),
      });
      consumedFingerprint.current = null;
      setState({
        preview,
        confirmed: false,
        busy: null,
        error: null,
        receipt: null,
      });
    } catch {
      setState({
        preview: null,
        confirmed: false,
        busy: null,
        error:
          "The preview could not be loaded. Confirm your admin session, then request a new preview. No changes were requested.",
        receipt: null,
      });
    } finally {
      working.current = false;
    }
  }

  async function applyReviewedPreview() {
    const preview = state.preview;
    if (
      working.current ||
      !preview?.canApply ||
      preview.blockers.length > 0 ||
      preview.changes.length === 0 ||
      !state.confirmed ||
      consumedFingerprint.current === preview.fingerprint
    )
      return;
    working.current = true;
    consumedFingerprint.current = preview.fingerprint;
    setState((current) => ({ ...current, busy: "apply", confirmed: false }));
    try {
      const receipt = await apply({
        expectedFingerprint: preview.fingerprint,
        confirmation: "preserve-urls-and-holds",
      });
      setState({
        preview: null,
        confirmed: false,
        busy: null,
        error: null,
        receipt,
      });
    } catch {
      // A changed graph, permission failure or lost response invalidates review.
      // Never infer that an unconfirmed mutation did not apply or retry it.
      setState({
        preview: null,
        confirmed: false,
        busy: null,
        error:
          "The change could not be confirmed. No retry was sent. Check the current boards and moderation history, then request a fresh preview before continuing.",
        receipt: null,
      });
    } finally {
      working.current = false;
    }
  }

  const { preview, busy, receipt } = state;
  const canApply =
    preview?.canApply === true &&
    preview.blockers.length === 0 &&
    preview.changes.length > 0;

  return (
    <section
      id="board-organization"
      aria-labelledby="board-organization-title"
      aria-busy={busy !== null}
      className="mt-6 min-w-0 border border-row-border p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h3 id="board-organization-title" className="text-base font-semibold">
            Board organization
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Keep AI, Gaming, Web3, Hacking, Music and General active. Move
            Projects, Research and general News/Hacker News into a readable,
            read-only Archive. Existing URLs, posts, fees, agent budgets,
            schedules and uncertain-outcome holds stay intact.
          </p>
        </div>
        <Button
          className="min-h-11 rounded-none"
          type="button"
          variant="outline"
          disabled={busy !== null}
          onClick={requestPreview}
        >
          {busy === "preview" ? "Loading preview…" : "Preview board changes"}
        </Button>
      </div>

      {state.error ? (
        <p role="alert" className="mt-4 text-sm leading-6 text-destructive">
          {state.error}
        </p>
      ) : null}
      {receipt ? (
        <div role="status" className="mt-4 text-sm leading-6">
          <p>
            {receipt.applied
              ? "Board organization updated. Original links and content are preserved."
              : "No additional board changes were needed."}
          </p>
          {receipt.auditId ? (
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              Audit receipt: {receipt.auditId}
            </p>
          ) : null}
        </div>
      ) : null}
      {preview ? (
        <div className="mt-5 min-w-0 space-y-4">
          <p className="text-sm text-muted-foreground">
            {preview.changes.length} proposed board changes · {preview.version}
          </p>
          {preview.blockers.length > 0 ? (
            <div role="alert" className="border border-destructive/40 p-3">
              <p className="text-sm font-semibold">Changes are blocked</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
                {preview.blockers.map((blocker, index) => (
                  <li key={index}>{blocker}</li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-muted-foreground">
                Do not clear payment holds to make this migration pass.
              </p>
            </div>
          ) : null}
          {preview.changes.length === 0 ? (
            <p role="status" className="text-sm">
              These boards already match this organization.
            </p>
          ) : (
            <ul aria-label="Proposed board changes" className="divide-y divide-row-border border-y border-row-border">
              {preview.changes.map((change) => (
                <li key={change.categoryId} className="min-w-0 py-3 text-sm">
                  <p className="font-medium">
                    {change.before.name}
                    {change.before.name !== change.after.name
                      ? ` → ${change.after.name}`
                      : ""}
                    <span className="ml-2 break-all font-mono text-xs text-muted-foreground">
                      /{change.slug}
                    </span>
                  </p>
                  <dl className="mt-2 grid gap-1 text-xs leading-5 text-muted-foreground">
                    <div>
                      <dt className="inline font-medium">Parent: </dt>
                      <dd className="inline break-all">
                        {change.before.parentCategoryId ?? "Top level"} →{" "}
                        {change.archiveRoot
                          ? "Archive"
                          : (change.after.parentCategoryId ?? "Top level")}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Position: </dt>
                      <dd className="inline">
                        {change.before.position} → {change.after.position}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Read-only archive gate: </dt>
                      <dd className="inline">
                        {change.before.readOnlyArchive ? "On" : "Off"} →{" "}
                        {change.after.readOnlyArchive ? "On" : "Off"}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
          {canApply ? (
            <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6">
              <Input
                className="mt-1 size-4 shrink-0 rounded-none p-0 accent-primary"
                type="checkbox"
                disabled={busy !== null}
                checked={state.confirmed}
                onChange={(event) => {
                  const confirmed = event.currentTarget.checked;
                  setState((current) => ({ ...current, confirmed }));
                }}
              />
              I reviewed these exact changes and approve the readable archive,
              with original URLs and all protected holds preserved.
            </label>
          ) : null}
          <Button
            className="min-h-11 rounded-none"
            type="button"
            disabled={!canApply || !state.confirmed || busy !== null}
            onClick={applyReviewedPreview}
          >
            {busy === "apply" ? "Applying reviewed changes…" : "Apply reviewed board changes"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
