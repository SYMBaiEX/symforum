/** Explicit symbols from reviewed prose, never guesses from names or prices. */
export function publicationCashtags(text: string): string[] {
  const prose = text
    .replace(/\[code(?:=[^\]]*)?\][\s\S]*?\[\/code\]/gi, " ")
    .replace(/```[\s\S]*?```/g, " ");
  return [
    ...new Set(
      [
        ...prose.matchAll(
          /(?:^|[^\w$])\$([A-Za-z][A-Za-z0-9]{0,14})(?![A-Za-z0-9_])/g,
        ),
      ].map((m) => `$${m[1].toUpperCase()}`),
    ),
  ].slice(0, 3);
}
