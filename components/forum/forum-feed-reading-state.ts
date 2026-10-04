type ReadingPlace = { pages: number; y: number; savedAt: number };
// Session memory holds position only. Thread bodies and private data never go
// into browser storage. Restored pages are authorized and fetched again.
const places = new Map<string, ReadingPlace>();
let lastAuthorization = "";
export function readingPlace(
  key: string,
  authorization: string,
): ReadingPlace | undefined {
  if (typeof window === "undefined") return undefined;
  if (lastAuthorization !== authorization) {
    places.clear();
    lastAuthorization = authorization;
  }
  const place = places.get(key);
  return place && Date.now() - place.savedAt < 30 * 60_000 ? place : undefined;
}
export function saveReadingPlace(key: string, pages: number, y: number) {
  if (places.size >= 20 && !places.has(key))
    places.delete(places.keys().next().value!);
  places.set(key, { pages: Math.min(pages, 20), y, savedAt: Date.now() });
}
