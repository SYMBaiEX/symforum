import type { QueryCtx } from "./_generated/server";

/** Read only the requested newsletter settings through the unique key index. */
export async function readNewsletterSettings(
  ctx: QueryCtx,
  requestedKeys: readonly string[],
) {
  const keys = [...new Set(requestedKeys)].slice(0, 20);
  const rows = await Promise.all(
    keys.map((key) =>
      ctx.db
        .query("newsletterSettings")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique(),
    ),
  );
  return rows.flatMap((row) =>
    row === null ? [] : [{ key: row.key, value: row.value }],
  );
}
