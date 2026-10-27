export const MEME_TOPIC_ID = 13;
export const MEME_INTERVAL_MS = 18 * 60_000;
const reactions = [
  "triumphant cosmic confidence beside a laptop",
  "deadpan exhaustion at a laptop surrounded by coffee cups",
  "comic panic in front of a smoking server rack",
  "smug galaxy-brain diagram overthinking",
];
const themes = [
  "an AI agent confidently overcomplicating a tiny task",
  "a developer announcing a quick fix",
  "a group chat reinventing an issue tracker",
  "one person actually reading the documentation",
  "a weekend side project becoming infrastructure",
  "staring at a chart instead of doing the dishes",
  "a deploy that worked locally",
  "solving a bug by adding another layer",
  "a perfectly normal open-source dependency tree",
  "discovering the TODO is from yourself",
];
export function memePrompt(slot: number) {
  return `Write one original, funny two-part internet meme caption for the SYMBaiEX Forum Dank Memes topic. You are Belle, the openly labeled AI meme host. The selected original robot-moth reaction image shows: ${reactions[slot % 4]}. Topic seed: ${themes[Math.floor(slot / 4) % themes.length]}. Use developer, AI, open-source, online-community or harmless crypto-culture absurdity. Be specific, dry, playful and surprising; avoid bland inspirational copy. You may use casual slang and mild swearing. No slurs, targeted harassment, political persuasion, sexual content, fabricated personal experience, factual project claims, real-time prices, trading advice, buying pressure, returns or fake engagement. No URLs, mentions, hashtags, CTAs, explanations or signing off. Use only printable English ASCII in the captions. Each half must be 1-80 characters. Return the text field with exactly two lines: TOP: your setup\nBOTTOM: your punchline. Read prior confirmed memes in this dedicated thread and make a different joke, not just different wording.`;
}
export function parseMeme(text: string) {
  const m = /^TOP:\s*([^\r\n]+)\r?\nBOTTOM:\s*([^\r\n]+)$/i.exec(text.trim());
  if (!m) throw Error("invalid_meme_caption");
  const [top, bottom] = m.slice(1).map((s) => s.trim());
  if (
    [top, bottom].some(
      (s) =>
        s.length < 1 ||
        s.length > 80 ||
        /[^\x20-\x7e]/.test(s) ||
        /https?:|www\.|[@#]/i.test(s),
    )
  )
    throw Error("invalid_meme_caption");
  return { top, bottom };
}
/** A conservative deduplication fingerprint. A collision skips a post. */
export function memeFingerprint(text: string) {
  let h = 14695981039346656037n;
  for (const c of text.toLowerCase().replace(/[^a-z0-9]/g, "")) {
    h ^= BigInt(c.charCodeAt(0));
    h = BigInt.asUintN(64, h * 1099511628211n);
  }
  return h.toString(16);
}
