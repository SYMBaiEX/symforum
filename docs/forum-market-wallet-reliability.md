# Markets freshness and wallet-link recovery

## What changed

The ordinary Bags.fm and Pump.fun source jobs were not blocked. Both kept their
hourly cadence; an empty eligible Bags result was a successful scan, not a failed
request. Their rotating cohorts naturally exceed the existing fifteen-minute
freshness window between scans. Neither historical model holds nor freshness
thresholds were changed to hide that limitation.

Markets now requests a shared public display refresh only while its website pane
is visible, online and foregrounded. The server chooses at most thirty recent,
previously admitted scout mints, with fair representation of both platforms.
One bounded Dexscreener batch serves all viewers; filters and local sorts cannot
select another provider cohort or create per-token fanout.

Admission reserves one unit from each unchanged 100/day terminal and 1,000/day
shared commerce allowance. A stricter 48/day refresh-only ceiling preserves
headroom for the existing wallet, chart and risk readers. There is no paid plan,
new agent schedule, Tracker allowance increase, model call or automatic transport
retry. This is budget-dependent active-view refresh, not a promise of a 24/7
tick feed or complete market coverage.

The ten-minute admission fence is written before I/O. Losing a response or
expiring the short worker lease cannot reopen that intent. Only an explicitly
typed pre-I/O burst deferral permits a short retry; actual and uncertain attempts
keep their full fence. Missing pools, malformed responses and exhausted quotas
remain unavailable or stale rather than turning into zero prices or new dates.

Refreshed prices, market cap, liquidity, volume and change have separate source
and check-time metadata. Holder counts, scout source rank and original observation
times are untouched. Refresh cannot extend the original 24-hour discovery
allowlist, generate alerts, alter agent evidence, authorize a swap or modify an
uncertain operation. FDV is never substituted for market cap.

Wallet linking still requires a sign-in from the preceding five minutes. The
client previously replaced that rejection with a generic error; it now provides
an explicit same-account reauthentication path and accurate link wording. No
automatic account switching, merging, signing or session-freshness extension is
introduced. A fresh Ed25519 integration proof preserves the owner and existing
session, while replayed nonces remain rejected. The user's specific extension
session was not used for automated acceptance.

The companion utility pass adds exact-mint alert navigation without marking an
alert read, owner-only affiliation editing with retained drafts, and read-only
cancelled-work history using existing backend permissions and lifecycle rules.

## Verification boundaries

Root integration verification includes the complete unit/backend and isolated
browser suites, application and Convex types, lint, five site builds, native UI
parity, secret-scanner controls and a production-target dry run. Fixtures do not
make real wallet payments, invoke models or replay held operations.

The dependency audit still reports two moderate transitive advisories in the
unchanged root and Eliza worker lockfiles; the gateway audit is clean. These
findings were not suppressed or reported as resolved. No application-controlled
untrusted-pattern path was confirmed during the bounded source review; that is
not proof of universal non-reachability. A dependency remediation requires a
separate compatibility review rather than a blanket major-version override.

Production acceptance requires the deployed shared-cache receipt, real public
market rows with independent timestamps, quota accounting and a comparison of
historical hold/settings fingerprints. HTTP availability alone is insufficient.
Real wallet payments and x402 settlement remain separate human-controlled
acceptance; research charging stays disabled until its existing activation gates
are satisfied.
