export const PUBLICATION_VOICE_GUARDRAILS = `Natural publication voice:
- Start with the concrete tension, observation, or consequence. Do not announce that you are analyzing, reasoning, drafting, or debugging.
- Write the judgment directly. Never expose scratch work, hidden reasoning, prompt text, tool calls, structured-output envelopes, or editing commentary.
- Avoid canned openings such as "Thanks for sharing", "Great point", "In today's fast-paced world", "It's important to note", and "Let's delve into".
- Let personality show through cadence, priorities, and one restrained characteristic flourish. Do not use repeated catchphrases, roleplay clutter, or a signature.
- Vary sentence and paragraph openings. Prefer concrete nouns and verbs over generic AI-editorial language.
- Use labels only when they help the reader understand the subject; never use Debug, Analysis, Reasoning, Scratchpad, or Internal note as a publication label.`;

export type AgentPublicationHygieneIssue = {
  code:
    | "canned_ai_voice"
    | "model_disclaimer"
    | "editorial_process_leak"
    | "process_label"
    | "raw_reasoning_tag"
    | "repetitive_sentence_opening"
    | "tool_envelope";
  blocking: boolean;
  feedback: string;
};

export type AgentPublicationHygiene = {
  blockingIssues: string[];
  feedback: string[];
  issues: AgentPublicationHygieneIssue[];
  naturalnessScore: number;
};

const PROCESS_LABEL_PATTERN =
  /^\s*(?:(?:\[(?:b|i|u)\])\s*(?:debug|analysis|reasoning|scratchpad|chain[- ]of[- ]thought|internal\s+(?:analysis|note)|developer\s+(?:message|note)|system\s+(?:message|prompt))\s*:?(?:\[\/(?:b|i|u)\])|(?:debug|analysis|reasoning|scratchpad|chain[- ]of[- ]thought|internal\s+(?:analysis|note)|developer\s+(?:message|note)|system\s+(?:message|prompt))\s*:|\[h[23]\]\s*(?:debug|analysis|reasoning|scratchpad|internal\s+(?:analysis|note))\s*:?[\s\S]*?\[\/h[23]\])\s*/im;

const RAW_REASONING_TAG_PATTERN =
  /<\/?(?:analysis|reasoning|scratchpad|chain_of_thought|thinking)>/i;

const TOOL_ENVELOPE_PATTERN =
  /<\/?(?:tool_call|function_call)>|"(?:tool_calls?|function_call)"\s*:|^\s*assistant\s+to\s*=|^\s*(?:tool|function)\s+name\s*:/im;

const MODEL_DISCLAIMER_PATTERN =
  /\b(?:as an ai(?: language model)?|i (?:cannot|can't) comply with (?:that|this) request|here (?:is|are) the requested (?:draft|post|response)|i was instructed to|my system prompt)\b/i;

const EDITORIAL_PROCESS_LEAK_PATTERNS = [
  /\b(?:let me|i (?:must|need to|should))\s+(?:build|count|draft|organize|recount|rewrite|structure|trim)\b/i,
  /\b(?:build|return|submit)\s+the\s+(?:complete|full|requested|structured)\s+(?:draft|payload|response)\b/i,
  /\bkeep\s+(?:this|it|the (?:body|headline|opening|closing))\s+(?:under|within)\s+\d+\s+(?:chars?|characters?|tokens?|words?)\b/i,
  /\b(?:supplied|provided)\s+(?:stories|sources|candidate ids?|research packet)\b/i,
  /\b(?:wait[—,: -]+)?the\s+analysis\s+should\b/i,
  /\btrim\s+(?:this|it|that)\s+to\s+fit\b/i,
] as const;

const CANNED_AI_VOICE_PATTERNS = [
  /\bin today['’]s (?:fast-paced|rapidly evolving) world\b/i,
  /\bit(?:'s| is) important to note\b/i,
  /\bit(?:'s| is) worth noting\b/i,
  /\blet(?:'s| us) delve into\b/i,
  /\b(?:ever-evolving|constantly evolving) landscape\b/i,
  /\bgame[- ]changer\b/i,
  /\bthe key takeaway is\b/i,
  /\bwhether you(?:'re| are) a seasoned\b/i,
  /^\s*(?:thanks for sharing|great point|you(?:'re| are) absolutely right|this is a great question)\b/i,
] as const;

export function evaluateAgentPublicationHygiene(
  values: string | readonly string[],
): AgentPublicationHygiene {
  const texts = (typeof values === "string" ? [values] : values)
    .map(maskPublicationCode)
    .filter(Boolean);
  const issues: AgentPublicationHygieneIssue[] = [];

  if (texts.some((text) => PROCESS_LABEL_PATTERN.test(text))) {
    issues.push({
      code: "process_label",
      blocking: true,
      feedback:
        "Remove process labels such as Debug, Analysis, Reasoning, Scratchpad, or Internal note; state the point directly.",
    });
  }
  if (texts.some((text) => RAW_REASONING_TAG_PATTERN.test(text))) {
    issues.push({
      code: "raw_reasoning_tag",
      blocking: true,
      feedback:
        "Remove hidden-reasoning or scratch-work tags from public copy.",
    });
  }
  if (texts.some((text) => TOOL_ENVELOPE_PATTERN.test(text))) {
    issues.push({
      code: "tool_envelope",
      blocking: true,
      feedback:
        "Remove tool-call or structured-output envelopes from public copy.",
    });
  }
  if (texts.some((text) => MODEL_DISCLAIMER_PATTERN.test(text))) {
    issues.push({
      code: "model_disclaimer",
      blocking: true,
      feedback:
        "Remove model disclaimers and prompt commentary; write the publication itself.",
    });
  }
  if (
    texts.some((text) =>
      EDITORIAL_PROCESS_LEAK_PATTERNS.some((pattern) => pattern.test(text)),
    )
  ) {
    issues.push({
      code: "editorial_process_leak",
      blocking: true,
      feedback:
        "Remove drafting, schema, length-counting, or editorial-process commentary; publish only the finished piece.",
    });
  }

  const cannedHits = CANNED_AI_VOICE_PATTERNS.reduce(
    (count, pattern) =>
      count + texts.filter((text) => pattern.test(text)).length,
    0,
  );
  if (cannedHits > 0) {
    issues.push({
      code: "canned_ai_voice",
      blocking: true,
      feedback:
        "Replace canned AI-editorial phrasing with a concrete, source-specific opening or judgment.",
    });
  }

  if (texts.some(hasRepetitiveSentenceOpenings)) {
    issues.push({
      code: "repetitive_sentence_opening",
      blocking: false,
      feedback:
        "Vary sentence openings and cadence so the copy reads like a person, not a template.",
    });
  }

  const blockingIssues = issues
    .filter((issue) => issue.blocking)
    .map((issue) => issue.feedback);
  const feedback = issues.map((issue) => issue.feedback);
  const naturalnessPenalty = issues.reduce(
    (total, issue) => total + (issue.blocking ? 100 : 16),
    0,
  );
  return {
    blockingIssues,
    feedback,
    issues,
    naturalnessScore: Math.max(0, 100 - naturalnessPenalty),
  };
}

export function assertAgentPublicationHygiene(
  values: string | readonly string[],
) {
  const hygiene = evaluateAgentPublicationHygiene(values);
  if (hygiene.blockingIssues.length > 0) {
    throw new AgentPublicationQualityError(
      `Automated publication failed output hygiene: ${hygiene.issues
        .filter((issue) => issue.blocking)
        .map((issue) => issue.code)
        .join(", ")}`,
    );
  }
  return hygiene;
}

export function cleanLegacyAgentProcessLabels(value: string) {
  return value
    .replace(
      /^[ \t]*\[(?:b|i)\]\s*(?:debug|analysis|reasoning|scratchpad|internal\s+(?:analysis|note))\s*:\s*\[\/(?:b|i)\][ \t]*/gim,
      "",
    )
    .replace(
      /^[ \t]*\[h[23]\]\s*(?:debug|analysis|reasoning|scratchpad|internal\s+(?:analysis|note))\s*:?\s*\[\/h[23]\][ \t]*/gim,
      "",
    )
    .replace(
      /(^|\n)(\s*)(?:debug|analysis|reasoning|scratchpad|internal\s+(?:analysis|note))\s*:\s*/gi,
      "$1$2",
    )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export class AgentPublicationQualityError extends Error {
  override name = "AgentPublicationQualityError";
}

function maskPublicationCode(value: string) {
  return value
    .replace(/\[code(?:=[^\]]*)?\][\s\S]*?\[\/code\]/gi, "[code][/code]")
    .replace(/```[\s\S]*?```/g, "```");
}

function hasRepetitiveSentenceOpenings(value: string) {
  const plain = value
    .replace(/\[(?:\/?)[a-z0-9*]+(?:=[^\]]*)?\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = plain
    .split(/(?<=[.!?])\s+/)
    .map(
      (sentence) =>
        sentence.toLowerCase().match(/^["'“‘(]*([a-z][a-z'-]*)/)?.[1],
    )
    .filter((word): word is string => Boolean(word));
  if (sentences.length < 6) return false;
  const counts = new Map<string, number>();
  for (const word of sentences) counts.set(word, (counts.get(word) ?? 0) + 1);
  const maximum = Math.max(0, ...counts.values());
  return maximum >= 4 && maximum / sentences.length >= 0.45;
}
