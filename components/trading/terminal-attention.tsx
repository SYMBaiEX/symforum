"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";

export type TerminalAttentionTarget = "receipts" | "research" | "community";
type Attention = { target: TerminalAttentionTarget; count: number };
type Reports = Readonly<Record<string, Attention>>;
type Report = (
  id: string,
  target: TerminalAttentionTarget,
  count: number,
) => void;

const EMPTY: readonly Attention[] = [];
const ReportContext = createContext<Report>(() => {});
const SnapshotContext = createContext<readonly Attention[]>(EMPTY);

// Presentation metadata only. Existing receipt owners report known protected
// counts; this neither queries operation records nor decides whether to retry.
export function terminalAttentionReducer(
  reports: Reports,
  { id, target, count }: Attention & { id: string },
): Reports {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (!safeCount) {
    if (!(id in reports)) return reports;
    const next = { ...reports };
    delete next[id];
    return next;
  }
  if (reports[id]?.target === target && reports[id].count === safeCount)
    return reports;
  return { ...reports, [id]: { target, count: safeCount } };
}

export function terminalAttentionSnapshot(
  reports: Reports,
): readonly Attention[] {
  const targets: TerminalAttentionTarget[] = [
    "receipts",
    "research",
    "community",
  ];
  return targets.flatMap((target) => {
    // A history and its live dialog may describe the same operations. Do not
    // add their counts together or imply this is a complete account audit.
    const count = Math.max(
      0,
      ...Object.values(reports)
        .filter((report) => report.target === target)
        .map((report) => report.count),
    );
    return count ? [{ target, count }] : [];
  });
}

export function TerminalAttentionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [reports, dispatch] = useReducer(terminalAttentionReducer, {});
  const report = useCallback<Report>((id, target, count) => {
    dispatch({ id, target, count });
  }, []);
  const snapshot = useMemo(() => terminalAttentionSnapshot(reports), [reports]);
  return (
    <ReportContext.Provider value={report}>
      <SnapshotContext.Provider value={snapshot}>
        {children}
      </SnapshotContext.Provider>
    </ReportContext.Provider>
  );
}

export function useTerminalAttentionSnapshot() {
  return useContext(SnapshotContext);
}

/** No-op outside the terminal. Reporting never changes a payment or its hold. */
export function useTerminalAttention(
  target: TerminalAttentionTarget,
  count: number,
) {
  const report = useContext(ReportContext);
  const id = useId();
  useEffect(() => {
    report(id, target, count);
    return () => report(id, target, 0);
  }, [count, id, report, target]);
}
