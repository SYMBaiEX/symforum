/** Search only already-loaded public handles; never resolve a payment recipient. */
export function filterTipRecipients<T extends { username: string }>(
  rows: readonly T[],
  input: string,
): readonly T[] {
  const query = input.trim().replace(/^@/, "").toLowerCase();
  return query
    ? rows.filter((row) => row.username.toLowerCase().includes(query))
    : rows;
}
