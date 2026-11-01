/** Public paging state only. It carries no wallet, author grants, or write authority. */
export type DirectoryPage<T> = {
  page: T[];
  continueCursor: string;
  isDone: boolean;
  pageStatus?: "SplitRequired" | "SplitRecommended" | null;
  splitCursor?: string | null;
};
export type DirectoryRequest = {
  generation: number;
  requestId: number;
  cursor: string | null;
};
export type DirectoryState<T> = {
  scope: string;
  generation: number;
  seedCursor: string | null;
  seedIdentity: string;
  rows: T[];
  cursor: string | null;
  isDone: boolean;
  requestId: number;
  pending: DirectoryRequest | null;
  visited: (string | null)[];
  error: string | null;
  blocked: boolean;
  pageSize: number;
};
export const PROJECT_PAGE_OPTIONS = {
  numItems: 12,
  maximumRowsRead: 24,
  maximumBytesRead: 262144,
} as const;
export function directoryPageIdentity<T extends { projectId: string }>(
  first?: DirectoryPage<T>,
) {
  return JSON.stringify(
    first
      ? [
          first.continueCursor,
          first.isDone,
          first.pageStatus ?? null,
          first.page.map((row) => row.projectId),
        ]
      : null,
  );
}
export function directoryState<T extends { projectId: string }>(
  scope: string,
  first?: DirectoryPage<T>,
  generation = 0,
): DirectoryState<T> {
  const limited = Boolean(first?.pageStatus);
  return {
    scope,
    generation,
    seedCursor: first?.continueCursor ?? null,
    seedIdentity: directoryPageIdentity(first),
    rows: [],
    cursor: limited ? null : (first?.continueCursor ?? null),
    isDone: limited ? false : (first?.isDone ?? false),
    requestId: 0,
    pending: null,
    visited: [],
    error: limited ? pageLimitMessage : null,
    blocked: limited,
    pageSize: PROJECT_PAGE_OPTIONS.numItems,
  };
}
const pageLimitMessage =
  "This project page reached its read limit. Loaded hubs are kept; try a smaller page.";
export function mergeDirectoryRows<T extends { projectId: string }>(
  first: T[],
  later: T[],
): T[] {
  const rows = new Map<string, T>();
  for (const row of [...first, ...later])
    if (!rows.has(row.projectId)) rows.set(row.projectId, row);
  return [...rows.values()];
}
export function requestDirectoryPage<T>(
  state: DirectoryState<T>,
): DirectoryState<T> {
  if (
    state.pending ||
    state.isDone ||
    state.seedCursor === null ||
    (state.blocked && state.pageSize === 1)
  )
    return state;
  const requestId = state.requestId + 1;
  return {
    ...state,
    requestId,
    error: null,
    pageSize: state.blocked
      ? Math.max(1, Math.floor(state.pageSize / 2))
      : state.pageSize,
    pending: { generation: state.generation, requestId, cursor: state.cursor },
  };
}
function currentRequest<T>(
  state: DirectoryState<T>,
  request: DirectoryRequest,
) {
  return (
    state.pending?.generation === request.generation &&
    state.generation === request.generation &&
    state.pending.requestId === request.requestId &&
    state.pending.cursor === request.cursor
  );
}
export function receiveDirectoryPage<T extends { projectId: string }>(
  state: DirectoryState<T>,
  request: DirectoryRequest,
  page: DirectoryPage<T>,
): DirectoryState<T> {
  if (!currentRequest(state, request)) return state;
  if (page.pageStatus)
    return {
      ...state,
      pending: null,
      blocked: true,
      error:
        state.pageSize === 1
          ? "This project page still exceeds its read limit. Loaded hubs are kept; reload the directory to retry."
          : pageLimitMessage,
    };
  const blocked =
    !page.isDone &&
    (!page.continueCursor ||
      page.continueCursor === request.cursor ||
      state.visited.includes(page.continueCursor));
  return {
    ...state,
    rows: mergeDirectoryRows(state.rows, page.page),
    cursor: page.continueCursor,
    isDone: page.isDone,
    pending: null,
    visited: [...state.visited, request.cursor],
    blocked,
    pageSize: blocked ? 1 : state.pageSize,
    error: blocked
      ? "The project cursor did not advance. Reload this directory to continue."
      : null,
  };
}
export function failDirectoryPage<T>(
  state: DirectoryState<T>,
  request: DirectoryRequest,
): DirectoryState<T> {
  return currentRequest(state, request)
    ? {
        ...state,
        pending: null,
        error:
          "More project hubs could not load. Your loaded hubs are kept. Try again.",
      }
    : state;
}
