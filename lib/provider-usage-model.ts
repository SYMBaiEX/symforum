import { FORUM_READ_POLICY } from "./forum-read-policy";

const DAY = 86_400_000;
const mod = (value: number, width: number) => ((value % width) + width) % width;
export type ProviderCounterId =
  | "helius-rpc"
  | "helius-send"
  | "helius-daily"
  | "helius-rolling"
  | "dexscreener"
  | "geckoterminal";
export type ProviderUsageSnapshot = {
  asOf: number;
  complete: boolean;
  scope: "application-reservations";
  accountUsageKnown: false;
  denialHistoryRecorded: false;
  counters: Array<{
    id: ProviderCounterId;
    used: number | null;
    limit: number;
    unit: "requests" | "credits";
    windowStart: number;
    windowEnd: number;
    eligibleAt: number | null;
  }>;
};
export type ProviderLedgerRequest = {
  name: "forumProviderBurstV1" | "forumProviderCreditsV1";
  key: string;
  config: {
    kind: "fixed window";
    rate: number;
    capacity: number;
    period: number;
    start: number;
  };
  expectedStart: number;
};
export type ProviderLedgerState = { ts: number; value: number } | null;
const groups = [
  {
    id: "helius-rpc" as const,
    key: "helius",
    limit: FORUM_READ_POLICY.helius.requestsPerWindow,
    width: FORUM_READ_POLICY.helius.windowMs,
  },
  {
    id: "helius-send" as const,
    key: "helius-send",
    limit: FORUM_READ_POLICY.helius.sendRequestsPerWindow,
    width: FORUM_READ_POLICY.helius.sendWindowMs,
  },
  {
    id: "dexscreener" as const,
    key: "dexscreener",
    limit: FORUM_READ_POLICY.dexscreener.requestsPerWindow,
    width: FORUM_READ_POLICY.dexscreener.windowMs,
  },
  {
    id: "geckoterminal" as const,
    key: "geckoterminal",
    limit: FORUM_READ_POLICY.geckoterminal.requestsPerWindow,
    width: FORUM_READ_POLICY.geckoterminal.windowMs,
  },
];

/** Exactly 41 existing component keys; no scans, new counters or consumption. */
export function providerLedgerRequests(asOf: number): ProviderLedgerRequest[] {
  if (!Number.isSafeInteger(asOf) || asOf <= 0)
    throw Error("Invalid snapshot time.");
  const requests = groups.flatMap(({ key, limit, width }) =>
    [0, 1].map((offset) => {
      const bucket = Math.floor(asOf / width) - offset;
      const slot = mod(bucket, 2);
      return {
        name: "forumProviderBurstV1" as const,
        key: `${key}:${slot}`,
        config: {
          kind: "fixed window" as const,
          rate: limit,
          capacity: limit,
          period: 2 * width,
          start: slot * width,
        },
        expectedStart: bucket * width,
      };
    }),
  );
  const slots = FORUM_READ_POLICY.helius.rollingDays + 1;
  const day = Math.floor(asOf / DAY);
  return [
    ...requests,
    ...Array.from({ length: slots }, (_, offset) => {
      const date = day - offset,
        slot = mod(date, slots),
        limit = FORUM_READ_POLICY.helius.dailyCredits;
      return {
        name: "forumProviderCreditsV1" as const,
        key: `helius:${slot}`,
        config: {
          kind: "fixed window" as const,
          rate: limit,
          capacity: limit,
          period: slots * DAY,
          start: slot * DAY,
        },
        expectedStart: date * DAY,
      };
    }),
  ];
}

function reserved(
  request: ProviderLedgerRequest,
  state: ProviderLedgerState,
): number | null {
  if (
    !state ||
    !Number.isSafeInteger(state.ts) ||
    state.ts < 0 ||
    state.ts > request.expectedStart ||
    !Number.isSafeInteger(state.value) ||
    state.value < 0 ||
    state.value > request.config.capacity
  )
    return null;
  // getValue returns raw stored balance/time, not a balance advanced to now.
  // An absent row (ts=0) or prior rotation has no recorded use in this cycle.
  return state.ts === request.expectedStart
    ? request.config.capacity - state.value
    : 0;
}

/** Pure projection of one auth-checked, server-timed component snapshot. */
export function providerUsageSnapshot(
  asOf: number,
  states: readonly ProviderLedgerState[],
): ProviderUsageSnapshot {
  const requests = providerLedgerRequests(asOf);
  if (states.length !== requests.length)
    throw Error("A complete bounded read set is required.");
  const values = requests.map((request, i) => reserved(request, states[i]!));
  const counters: ProviderUsageSnapshot["counters"] = groups.map(
    ({ id, limit, width }, index) => {
      const current = values[index * 2],
        previous = values[index * 2 + 1];
      const bucket = Math.floor(asOf / width);
      const used =
        current === null || previous === null ? null : current! + previous!;
      return {
        id,
        used,
        limit,
        unit: "requests",
        windowStart: (bucket - 1) * width,
        windowEnd: (bucket + 1) * width,
        eligibleAt:
          used === null
            ? null
            : used < limit
              ? asOf
              : (bucket + (current! < limit ? 1 : 2)) * width,
      };
    },
  );
  const credits = values.slice(8),
    day = Math.floor(asOf / DAY),
    daily = credits[0]!;
  const total = credits.some((value) => value === null)
    ? null
    : credits.reduce<number>((sum, value) => sum + value!, 0);
  const dailyEligible =
    daily === null
      ? null
      : daily < FORUM_READ_POLICY.helius.dailyCredits
        ? asOf
        : (day + 1) * DAY;
  let rollingEligible: number | null = total === null ? null : asOf;
  if (total !== null && total >= FORUM_READ_POLICY.helius.rollingCredits) {
    let remaining = total;
    for (let offset = credits.length - 1; offset >= 0; offset--) {
      remaining -= credits[offset]!;
      rollingEligible = (day - offset + credits.length) * DAY;
      if (remaining < FORUM_READ_POLICY.helius.rollingCredits) break;
    }
  }
  const creditEligibility =
    dailyEligible === null || rollingEligible === null
      ? null
      : Math.max(dailyEligible, rollingEligible);
  const rpc = counters[0]!,
    send = counters[1]!;
  rpc.eligibleAt =
    rpc.eligibleAt === null || creditEligibility === null
      ? null
      : Math.max(rpc.eligibleAt, creditEligibility);
  send.eligibleAt =
    send.eligibleAt === null || rpc.eligibleAt === null
      ? null
      : Math.max(send.eligibleAt, rpc.eligibleAt);
  counters.push(
    {
      id: "helius-daily",
      used: daily,
      limit: FORUM_READ_POLICY.helius.dailyCredits,
      unit: "credits",
      windowStart: day * DAY,
      windowEnd: (day + 1) * DAY,
      eligibleAt: dailyEligible,
    },
    {
      id: "helius-rolling",
      used: total,
      limit: FORUM_READ_POLICY.helius.rollingCredits,
      unit: "credits",
      windowStart: (day - FORUM_READ_POLICY.helius.rollingDays) * DAY,
      windowEnd: (day + 1) * DAY,
      eligibleAt: rollingEligible,
    },
  );
  return {
    asOf,
    complete: values.every((value) => value !== null),
    scope: "application-reservations",
    accountUsageKnown: false,
    denialHistoryRecorded: false,
    counters,
  };
}
