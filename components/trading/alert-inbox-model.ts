import type { TokenAlert } from "./terminal-api";

export type AlertDirectionFilter = "all" | "above" | "below";

/** Partition only the already returned owner-scoped sample; never infer totals. */
export function loadedAlertInbox(
  alerts: readonly TokenAlert[] | undefined,
  direction: AlertDirectionFilter,
) {
  if (alerts === undefined) return null;
  const unread = alerts.filter((alert) => alert.acknowledged === false);
  const read = alerts.filter((alert) => alert.acknowledged === true);
  return {
    loadedCount: alerts.length,
    unread,
    read,
    visibleUnread:
      direction === "all"
        ? unread
        : unread.filter((alert) => alert.direction === direction),
  };
}
