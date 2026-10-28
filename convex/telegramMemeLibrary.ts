"use node";
import sharp from "sharp";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import { renderMeme } from "../lib/telegram-meme-image";
import {
  MEME_TEMPLATES,
  RESERVE_CAPTIONS,
  RESERVE_GIFS,
  memegenUrl,
} from "../lib/telegram-meme-library";
import { readMemeSource as read } from "../lib/telegram-meme-source";
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
async function json(url: string): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await read(url, 1_000_000)));
}
async function refreshSources(ctx: ActionCtx) {
  const [memegen, imgflip] = await Promise.allSettled([
    json("https://api.memegen.link/templates/"),
    json("https://api.imgflip.com/get_memes"),
  ]);
  const catalog =
    memegen.status === "fulfilled" && Array.isArray(memegen.value)
      ? memegen.value
      : [];
  const popularity =
    imgflip.status === "fulfilled" &&
    object(imgflip.value) &&
    object(imgflip.value.data) &&
    Array.isArray(imgflip.value.data.memes)
      ? imgflip.value.data.memes
      : [];
  const installed = await ctx.runQuery(internal.telegramMemeData.library, {});
  const ranks: Array<{ key: string; rank: number }> = [];
  let added = 0;
  for (const t of MEME_TEMPLATES) {
    const key = `memegen:${t.id}`;
    const rank = popularity.findIndex((x) => object(x) && x.id === t.imgflipId);
    ranks.push({
      key,
      rank: rank < 0 ? 1000 + MEME_TEMPLATES.indexOf(t) : rank,
    });
    if (installed.templates.some((x) => x.key === key)) continue;
    const found = catalog.find((x) => object(x) && x.id === t.id);
    if (
      !object(found) ||
      found.blank !== `https://api.memegen.link/images/${t.id}.jpg`
    )
      continue;
    try {
      const bytes = await read(String(found.blank), 3_000_000);
      const meta = await sharp(bytes, {
        limitInputPixels: 20_000_000,
      }).metadata();
      if (
        !meta.width ||
        !meta.height ||
        meta.width < 64 ||
        meta.height < 64 ||
        meta.width > 4096 ||
        meta.height > 4096
      )
        continue;
      const storageId = await ctx.storage.store(
        new Blob([bytes], { type: "image/jpeg" }),
      );
      await ctx.runMutation(internal.telegramMemeData.installTemplate, {
        key,
        name: t.name,
        description: t.description,
        storageId,
        sourceUrl: `https://memegen.link/#${t.id}`,
        rank: ranks.at(-1)!.rank,
      });
      added++;
    } catch {
      /* The existing cache and reserve remain available. */
    }
  }
  await ctx.runMutation(internal.telegramMemeData.sourceHealth, {
    ranks,
    ...(!catalog.length
      ? { error: "memegen_catalog_unavailable" }
      : !popularity.length
        ? { error: "imgflip_popularity_unavailable" }
        : {}),
  });
  return added;
}
export const refresh = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx) => await refreshSources(ctx),
});
export const seed = internalAction({
  args: {},
  returns: v.object({
    reserve: v.number(),
    templates: v.number(),
    gifs: v.number(),
  }),
  handler: async (
    ctx,
  ): Promise<{ reserve: number; templates: number; gifs: number }> => {
    const library = await ctx.runQuery(internal.telegramMemeData.library, {}),
      keys = new Set(library.assets.map((a) => a.key));
    const url = await ctx.runQuery(internal.telegramMemes.art, {});
    if (!url) throw Error("atlas_missing");
    const r = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) throw Error("atlas_missing");
    const atlas = new Uint8Array(await r.arrayBuffer());
    let reserve = 0,
      gifs = 0;
    for (let i = 0; i < RESERVE_CAPTIONS.length; i++) {
      const key = `reserve:original:v1:${i}`;
      if (keys.has(key)) continue;
      const [top, bottom] = RESERVE_CAPTIONS[i];
      const image = await renderMeme(atlas, i, top, bottom),
        storageId = await ctx.storage.store(
          new Blob([Uint8Array.from(image)], { type: "image/png" }),
        );
      await ctx.runMutation(internal.telegramMemeData.installAsset, {
        key,
        kind: "reserve",
        media: "photo",
        storageId,
        text: `TOP: ${top}\nBOTTOM: ${bottom}`,
      });
      reserve++;
    }
    for (const gif of RESERVE_GIFS) {
      const key = `reserve:gif:v1:${gif.id}`;
      if (keys.has(key)) continue;
      try {
        const sourceUrl = memegenUrl(gif.id, gif.top, gif.bottom, true),
          image = await read(sourceUrl, 5_000_000);
        const meta = await sharp(image, {
          limitInputPixels: 20_000_000,
        }).metadata();
        if (
          meta.format !== "gif" ||
          !meta.pages ||
          meta.pages < 2 ||
          meta.pages > 100
        )
          continue;
        const storageId = await ctx.storage.store(
          new Blob([image], { type: "image/gif" }),
        );
        await ctx.runMutation(internal.telegramMemeData.installAsset, {
          key,
          kind: "reserve",
          media: "animation",
          storageId,
          text: `TOP: ${gif.top}\nBOTTOM: ${gif.bottom}`,
          sourceName: `Classic GIF via Memegen: ${gif.id}`,
          sourceUrl,
        });
        gifs++;
      } catch {
        /* No unavailable external GIF can create an empty posting slot. */
      }
    }
    return { reserve, templates: await refreshSources(ctx), gifs };
  },
});
