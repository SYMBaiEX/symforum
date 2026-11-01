"use client";

import { useAction } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ProviderUsageSnapshot,
  ProviderCounterId,
} from "@/lib/provider-usage-model";
import { FORUM_READ_POLICY } from "@/lib/forum-read-policy";

const refreshSnapshot = makeFunctionReference<
  "action",
  Record<string, never>,
  ProviderUsageSnapshot
>("forumProviderUsage:snapshot");
const labels: Record<ProviderCounterId, string> = {
  "helius-rpc": "RPC · shared request guard",
  "helius-send": "RPC · send-method sublimit",
  "helius-daily": "RPC · daily credit allowance",
  "helius-rolling": "RPC · rolling credit allowance",
  dexscreener: "DEX Screener · request guard",
  geckoterminal: "GeckoTerminal · request guard",
};
const count = (value: number) => new Intl.NumberFormat("en-US").format(value);
const utc = (value: number) =>
  `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" }).format(value)} UTC`;
function SnapshotTime({ value }: { value: number }) {
  return <time dateTime={new Date(value).toISOString()}>{utc(value)}</time>;
}

/** Mounted only by the existing site-admin dashboard; the server rechecks access. */
export function ProviderUsagePanel() {
  const refresh = useAction(refreshSnapshot);
  const [snapshot, setSnapshot] = useState<ProviderUsageSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const sequence = useRef(0),
    inFlight = useRef(false);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  async function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    const request = ++sequence.current;
    setBusy(true);
    setError(false);
    try {
      const value = await refresh({});
      if (request === sequence.current) setSnapshot(value);
    } catch {
      if (request === sequence.current) {
        setSnapshot(null);
        setError(true);
      }
    } finally {
      inFlight.current = false;
      if (request === sequence.current) setBusy(false);
    }
  }
  return (
    <section
      className="min-w-0 space-y-5 [overflow-wrap:anywhere]"
      aria-labelledby="provider-usage-heading"
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
            Operator / read-only
          </p>
          <h2
            id="provider-usage-heading"
            className="mt-2 text-2xl font-semibold tracking-tight"
          >
            Provider usage
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Known application reservations, not your providers’ billing totals.
            Failed, aborted or uncertain transport can remain charged; these
            counters do not prove successful requests.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="!h-auto !min-h-11 max-w-full whitespace-normal px-4 py-2"
          onClick={() => void load()}
          disabled={busy}
        >
          <RefreshCw aria-hidden="true" />
          {busy ? "Reading snapshot…" : "Refresh snapshot"}
        </Button>
      </header>
      <p
        role="status"
        aria-live="polite"
        className="text-sm leading-6 text-muted-foreground"
      >
        {busy ? (
          "Reading existing counters. No provider request is made."
        ) : snapshot ? (
          <>
            Snapshot: <SnapshotTime value={snapshot.asOf} />. It stays frozen
            until you refresh.
          </>
        ) : (
          "Refresh to read the existing allowance counters. Nothing is loaded automatically."
        )}
      </p>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 p-4 text-sm leading-6"
        >
          Usage snapshot unavailable. Current administrator access and backend
          readiness are checked on every refresh. No provider request was made.
        </div>
      )}
      {snapshot && (
        <>
          {!snapshot.complete && (
            <p
              className="rounded-xl border border-row-border p-4 text-sm leading-6"
              role="status"
            >
              Partial snapshot. A counter could not be read or validated;
              unavailable values and eligibility stay unknown, not zero.
            </p>
          )}
          <ul
            aria-label="Known application allowance counters"
            className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3"
          >
            {snapshot.counters.map((row) => (
              <li
                key={row.id}
                className="min-w-0 rounded-2xl border border-row-border bg-card p-4"
              >
                <h3 className="text-sm font-semibold">{labels[row.id]}</h3>
                <p className="mt-3 font-mono text-2xl font-semibold tabular-nums">
                  {row.used === null ? "Unavailable" : count(row.used)}{" "}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    / {count(row.limit)} {row.unit}
                  </span>
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {row.eligibleAt === null ? (
                    "Next single-unit eligibility is unknown."
                  ) : row.eligibleAt <= snapshot.asOf ? (
                    "A single unit was eligible at this snapshot."
                  ) : (
                    <>
                      Next single-unit eligibility:{" "}
                      <SnapshotTime value={row.eligibleAt} />.
                    </>
                  )}{" "}
                  Availability is not guaranteed.
                </p>
                <details className="mt-3 min-w-0 border-t border-row-border pt-2">
                  <summary className="focus-ring flex min-h-11 cursor-pointer items-center text-sm font-medium">
                    Covered ledger window
                  </summary>
                  <div className="space-y-2 py-2 text-sm leading-6 text-muted-foreground">
                    <p>
                      From <SnapshotTime value={row.windowStart} />
                      <br />
                      to <SnapshotTime value={row.windowEnd} />.
                    </p>
                    <p>
                      {row.id === "helius-rolling"
                        ? "33 UTC day buckets conservatively cover every rolling 32-day credit window; the current day is only observed through the snapshot time."
                        : row.id === "helius-daily"
                          ? "Current UTC day reservations through the snapshot time. No future requests are assumed."
                          : "Current and previous fixed buckets conservatively enforce the request limit. This is not an exact provider sliding-window report."}
                    </p>
                    <p>
                      Zero means no reservations recorded for this covered
                      application window, not zero account usage.
                    </p>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
      <aside
        className="min-w-0 rounded-2xl border border-row-border p-4 text-sm leading-6 text-muted-foreground"
        aria-label="Coverage and configured ceilings"
      >
        <h3 className="font-semibold text-foreground">
          What this does not measure
        </h3>
        <p className="mt-2">
          Historical denials are not recorded. Total account consumption,
          external applications and the separately hosted broadcast caller are
          unknown. No provider keys, account bodies, wallet histories or private
          jobs are exposed.
        </p>
        <p className="mt-2">
          Other configured ceilings, <strong>usage unmeasured here</strong>:
          terminal {count(FORUM_READ_POLICY.terminalDailyUnits)} units/day;
          shared network {count(FORUM_READ_POLICY.commerceDailyUnits)}{" "}
          units/day; Jupiter main {FORUM_READ_POLICY.jupiter.requestsPerWindow}
          /minute and keyless{" "}
          {FORUM_READ_POLICY.jupiter.keylessRequestsPerWindow}/minute; Tracker{" "}
          {FORUM_READ_POLICY.tracker.dailyRequests}/day,{" "}
          {FORUM_READ_POLICY.tracker.dailyCandles} candle calls/day and{" "}
          {count(FORUM_READ_POLICY.tracker.rollingRequests)} per rolling{" "}
          {FORUM_READ_POLICY.tracker.rollingDays} days.
        </p>
        <p className="mt-2">
          These are configured application ceilings, not verified plan
          entitlements or remaining credits. Refresh only reads existing
          metadata; it cannot reset counters, increase limits or release a hold.
        </p>
      </aside>
    </section>
  );
}
