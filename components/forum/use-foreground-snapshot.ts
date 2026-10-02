"use client";

import { useCallback, useEffect, useState } from "react";

const DEFAULT_REFRESH_INTERVAL_MS = 120_000;
const DEFAULT_REFRESH_JITTER_MS = 15_000;

type Snapshot<T> = {
  key: string | number;
  data: T;
  refreshedAt: number;
};

type SnapshotError = { key: string | number };

export function useForegroundSnapshot<T>(
  key: string | number,
  load: () => Promise<T>,
  options: {
    refreshIntervalMs?: number;
    refreshJitterMs?: number;
    onError?: (error: unknown) => void;
  } = {},
) {
  const onError = options.onError;
  const refreshIntervalMs =
    options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  const refreshJitterMs = options.refreshJitterMs ?? DEFAULT_REFRESH_JITTER_MS;
  const [snapshot, setSnapshot] = useState<Snapshot<T>>();
  const [snapshotError, setSnapshotError] = useState<SnapshotError>();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requestInFlight = false;

    const clearTimer = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    const scheduleRefresh = () => {
      clearTimer();
      if (cancelled || document.visibilityState !== "visible") return;
      timer = setTimeout(
        refresh,
        refreshIntervalMs + Math.floor(Math.random() * refreshJitterMs),
      );
    };

    const refresh = () => {
      if (
        cancelled ||
        document.visibilityState !== "visible" ||
        requestInFlight
      ) {
        return;
      }
      requestInFlight = true;
      setSnapshotError(undefined);
      void load()
        .then(
          (data) => {
            if (cancelled) return;
            setSnapshot({ key, data, refreshedAt: Date.now() });
          },
          (error: unknown) => {
            if (cancelled) return;
            setSnapshotError({ key });
            onError?.(error);
          },
        )
        .finally(() => {
          requestInFlight = false;
          scheduleRefresh();
        });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      } else {
        clearTimer();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    refresh();
    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [key, load, onError, refreshIntervalMs, refreshJitterMs, refreshKey]);

  return {
    snapshot: snapshot?.key === key ? snapshot : undefined,
    refreshError: snapshotError?.key === key,
    refreshNow: useCallback(() => setRefreshKey((value) => value + 1), []),
  };
}
