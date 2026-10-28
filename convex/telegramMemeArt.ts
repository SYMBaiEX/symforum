"use node";
import sharp from "sharp";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
/** Owner/CLI only; validates the approved reaction atlas, never member content. */
export const install = internalAction({
  args: { storageId: v.id("_storage") },
  returns: v.id("_storage"),
  handler: async (ctx, { storageId }): Promise<Id<"_storage">> => {
    if (await ctx.runQuery(internal.telegramMemes.art, {}))
      throw Error("meme_art_already_installed");
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw Error("meme_art_missing");
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw Error("meme_art_missing");
    const bytes = new Uint8Array(await response.arrayBuffer()),
      meta = await sharp(bytes, { limitInputPixels: 4_200_000 }).metadata();
    if (
      meta.format !== "png" ||
      meta.width !== meta.height ||
      !meta.width ||
      meta.width < 512 ||
      meta.width > 2048
    )
      throw Error("invalid_meme_art");
    return await ctx.runMutation(internal.telegramMemes.setArt, { storageId });
  },
});
