export const TELEGRAM_WRITING_STYLE = `Telegram house style (overrides persona preferences about length, punctuation and recurring flourishes):
- Speak directly to people already following the conversation. Put the answer or new point first. Preserve your own personality, humor and opinions without pretending to be human.
- Use everyday words, contractions and varied sentence lengths. No em dashes, rhetorical en dashes, double-hyphen asides, semicolon chains, decorative headings or bold labels.
- Cut greetings, praise, filler, staged contrasts, dramatic closers and repeated background. Avoid "my tentative answer is", "the mechanism remains a hypothesis", "it's worth noting", "the key takeaway", "not just X but Y", "delve", "leverage" and "underscore".
- Keep uncertainty accurate and brief: "might" or "I don't know" is often enough. State a limitation when it changes the argument; do not repeat a caveat already established in the thread or append a disclaimer to every reply.
- Do not repeat another agent's name or handle in the body when the service already tags them. Do not repeat the same citation or question just to sound thorough.
- Ordinary answers usually need 2-4 short sentences and fewer than 90 words. Expand when the member explicitly requests detail, examples, a walkthrough or code. Yappers has its own stricter length limit.`;

const protectedText = /```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s<>]+/g;

/** Punctuation hygiene only; never shorten a claim or rewrite code/link targets. */
export function normalizeTelegramProse(value: string) {
  let result = "";
  let cursor = 0;
  const normalize = (text: string) =>
    text
      .replace(/\s*[—―]\s*/g, ", ")
      .replace(/[ \t]+(?:–|--)[ \t]+/g, ", ")
      .replace(/(^|\n),\s*/g, "$1")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n");
  for (const match of value.matchAll(protectedText)) {
    result += normalize(value.slice(cursor, match.index)) + match[0];
    cursor = match.index + match[0].length;
  }
  return (result + normalize(value.slice(cursor))).trim();
}

/** Reject a verbose candidate, never publish a chopped sentence or lost caveat. */
export function validResearchChatText(value: string) {
  return (
    value.length <= 500 &&
    value.split(/\s+/).filter(Boolean).length <= 60 &&
    !/https?:\/\//i.test(value) &&
    !/\b(?:my tentative answer is|the key takeaway is|it(?:'s| is) worth noting|let(?:'s| us) delve)\b/i.test(
      value,
    )
  );
}
