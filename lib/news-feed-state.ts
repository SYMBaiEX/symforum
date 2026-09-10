export type EmptyNewsFeedState = "loading" | "fallback" | "unavailable";

export function emptyNewsFeedState({
  queryResolved,
  fallbackStoryCount,
  selectedDate,
}: {
  queryResolved: boolean;
  fallbackStoryCount: number;
  selectedDate?: string;
}): EmptyNewsFeedState {
  if (!queryResolved && fallbackStoryCount === 0) return "loading";
  if (selectedDate === undefined && fallbackStoryCount > 0) return "fallback";
  return "unavailable";
}
