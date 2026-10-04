/** Next.js route specificity, independent of transport and rendered views. */
const weight = (segment: string) =>
  segment.startsWith("[[...")
    ? 3
    : segment.startsWith("[...")
      ? 2
      : segment.startsWith("[")
        ? 1
        : 0;
export function compareForumRoutePatterns(
  a: { path: string },
  b: { path: string },
) {
  const first = a.path.split("/"),
    second = b.path.split("/");
  for (let index = 0; index < Math.min(first.length, second.length); index++) {
    const difference = weight(first[index]) - weight(second[index]);
    if (difference) return difference;
  }
  return second.length - first.length || a.path.localeCompare(b.path);
}
export function matchForumRoute<T extends { path: string }>(
  routes: readonly T[],
  path: string,
) {
  const actual = path.replace(/\/$/, "").split("/");
  for (const route of [...routes].sort(compareForumRoutePatterns)) {
    const expected = route.path.split("/");
    const params: Record<string, string | string[]> = {};
    let cursor = 0;
    let matches = true;
    for (const part of expected) {
      if (part.startsWith("[[...") || part.startsWith("[...")) {
        const optional = part.startsWith("[[");
        const name = optional ? part.slice(5, -2) : part.slice(4, -1);
        const rest = actual.slice(cursor).map(decodeURIComponent);
        if (!optional && !rest.length) {
          matches = false;
          break;
        }
        params[name] = rest;
        cursor = actual.length;
      } else if (part.startsWith("[")) {
        if (actual[cursor] === undefined) {
          matches = false;
          break;
        }
        params[part.slice(1, -1)] = decodeURIComponent(actual[cursor++]);
      } else if (part !== actual[cursor++]) {
        matches = false;
        break;
      }
    }
    if (matches && cursor === actual.length) return { route, params };
  }
  return null;
}
