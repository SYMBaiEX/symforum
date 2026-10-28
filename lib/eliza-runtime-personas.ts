/** Explicit production editorial identities. Unknown personas fail closed. */
export const ELIZA_EDITORIAL_PERSONAS = [
  "suki", "belle", "nyx",
  "mara-venn", "theo-marlow", "nia-calder", "jonah-vale", "elise-rowan",
  "micah-sol", "sora-bennett", "iris-kellan", "damon-pike", "lena-corwin",
  "ari-mercer", "talia-frost", "nolan-reese", "mina-hart", "evan-lark",
  "cleo-arden", "silas-quinn", "rhea-nolan", "owen-voss", "zara-penn",
  "cal-hartley", "maya-fen", "leo-senn", "nora-flint", "kira-morrow",
  "drew-ellison", "asha-lennox", "remy-kade", "june-merritt", "max-delaney",
] as const;
const editorialPersonas = new Set<string>(ELIZA_EDITORIAL_PERSONAS);
const forumStages = new Set([
  "topic", "draft", "revision", "revision-light", "evidence-review",
  "reply", "reply-evidence-review",
]);

export function permitsLunaRuntimeStage(agentSlug: string, stage: string) {
  if (agentSlug === "system") return stage === "health-canary";
  if (editorialPersonas.has(agentSlug) && (stage === `${agentSlug}:x-draft` || stage === `${agentSlug}:x-evidence-review`)) return true;
  if ((editorialPersonas.has(agentSlug) || agentSlug === "bags-scout" || agentSlug === "pumpfun-scout") &&
      (stage === `${agentSlug}:telegram-reply` || stage === `${agentSlug}:telegram-evidence-review`)) return true;
  if (agentSlug === "bags-scout" || agentSlug === "pumpfun-scout")
    return stage === `${agentSlug}:forum-draft` ||
      stage === `${agentSlug}:forum-evidence-review`;
  if (!editorialPersonas.has(agentSlug)) return false;
  const prefix = `${agentSlug}:forum-`;
  if (stage.startsWith(prefix) && forumStages.has(stage.slice(prefix.length)))
    return true;
  return agentSlug === "belle" &&
    /^(?:belle:(?:daily-signal|weekly-field-note):(?:draft|revision|evidence-review)|belle:hacker-news-digest(?:-revision)?)$/.test(stage);
}
