type StyleOption = {
  key: string;
  instruction: string;
};

export type ForumAgentStyleVariation = {
  key: string;
  openingMove: string;
  rhetoricalPosture: string;
  cadence: string;
  evidenceEmphasis: string;
  interactionEnergy: string;
};

const OPENING_MOVES = [
  {
    key: "scene",
    instruction:
      "open on a concrete scenario that makes the stakes immediately visible",
  },
  {
    key: "tension",
    instruction: "open on the central tension between two reasonable goals",
  },
  {
    key: "signal",
    instruction:
      "open with one surprising source-backed signal, then explain why it matters",
  },
  {
    key: "claim",
    instruction:
      "open with a direct, defensible claim instead of introductory throat-clearing",
  },
  {
    key: "failure",
    instruction:
      "open at the failure mode or edge case that reveals the deeper issue",
  },
  {
    key: "question",
    instruction:
      "open with a compact question that the evidence can actually answer",
  },
  {
    key: "contrast",
    instruction:
      "open with a before-and-after or expectation-versus-reality contrast",
  },
  {
    key: "decision",
    instruction:
      "open at the practical decision a reader is likely trying to make",
  },
  {
    key: "myth",
    instruction:
      "open by correcting a plausible misconception without using a cheap gotcha",
  },
  {
    key: "artifact",
    instruction:
      "open by closely observing a concrete artifact, behavior, interface, or pattern",
  },
] as const satisfies readonly StyleOption[];

const RHETORICAL_POSTURES = [
  {
    key: "explorer",
    instruction:
      "take an exploratory posture that keeps multiple explanations alive until the evidence separates them",
  },
  {
    key: "contrarian",
    instruction:
      "take a constructive contrarian posture and pressure-test the most comfortable assumption",
  },
  {
    key: "forensic",
    instruction:
      "take a forensic posture that reconstructs how the outcome emerged step by step",
  },
  {
    key: "advisor",
    instruction:
      "take a pragmatic advisor posture focused on what a reader should do next",
  },
  {
    key: "synthesizer",
    instruction:
      "take a synthesizing posture that connects several signals into one useful model",
  },
  {
    key: "comparator",
    instruction:
      "take a comparative posture that makes tradeoffs legible without forcing a universal winner",
  },
  {
    key: "risk",
    instruction:
      "take a risk-sensitive posture that examines downside, reversibility, and guardrails",
  },
  {
    key: "teacher",
    instruction:
      "take a teaching posture that builds from a clear mental model to the harder implication",
  },
  {
    key: "facilitator",
    instruction:
      "take a decision-facilitator posture that separates facts, preferences, and constraints",
  },
  {
    key: "systems",
    instruction:
      "take a systems posture that follows incentives, feedback loops, and second-order effects",
  },
] as const satisfies readonly StyleOption[];

const CADENCE_SHIFTS = [
  {
    key: "snap-then-depth",
    instruction:
      "use a very short opening beat, then settle into measured explanatory paragraphs",
  },
  {
    key: "alternating",
    instruction: "alternate compact assertions with denser evidence paragraphs",
  },
  {
    key: "bullet-led",
    instruction:
      "move briskly and let one strong list carry the center of the post",
  },
  {
    key: "narrative-turn",
    instruction: "begin narratively, then make a clean turn into analysis",
  },
  {
    key: "questions",
    instruction:
      "use occasional question-led transitions to move between sections",
  },
  {
    key: "measured",
    instruction:
      "favor medium-length sentences with one or two terse lines for emphasis",
  },
  {
    key: "crescendo",
    instruction:
      "build gradually from context toward the strongest implication near the end",
  },
  {
    key: "dense",
    instruction:
      "keep the prose concise and high-information without becoming abrupt",
  },
  {
    key: "aside",
    instruction:
      "allow one brief conversational aside, then return quickly to the evidence",
  },
  {
    key: "definition-first",
    instruction:
      "define the key term or boundary early, then write with increasing speed",
  },
] as const satisfies readonly StyleOption[];

const EVIDENCE_EMPHASES = [
  {
    key: "primary",
    instruction:
      "center the strongest primary-source claim and distinguish it from commentary",
  },
  {
    key: "caveat",
    instruction:
      "give the strongest caveat unusual prominence instead of burying it",
  },
  {
    key: "matrix",
    instruction:
      "organize the core evidence as a compact comparison across meaningful dimensions",
  },
  {
    key: "causal",
    instruction:
      "make the causal chain explicit and flag where it becomes inference",
  },
  {
    key: "boundaries",
    instruction:
      "emphasize boundary conditions: where the conclusion applies and where it does not",
  },
  {
    key: "counterexample",
    instruction:
      "use the best supported counterexample to sharpen rather than derail the conclusion",
  },
  {
    key: "timeline",
    instruction:
      "emphasize sequence and timing so readers can see what changed and in what order",
  },
  {
    key: "implementation",
    instruction:
      "give implementation details more weight than broad positioning language",
  },
  {
    key: "stakeholders",
    instruction:
      "trace how the evidence affects different users, builders, maintainers, or operators",
  },
  {
    key: "uncertainty",
    instruction:
      "surface uncertainty explicitly and separate knowns, likely inferences, and open questions",
  },
] as const satisfies readonly StyleOption[];

const INTERACTION_ENERGIES = [
  {
    key: "warm",
    instruction:
      "close with a warm invitation that makes partial answers welcome",
  },
  {
    key: "challenge",
    instruction:
      "close with a pointed but fair challenge to the reader's default assumption",
  },
  {
    key: "workshop",
    instruction:
      "close like a collaborative workshop, asking readers to improve the proposed approach",
  },
  {
    key: "reflective",
    instruction:
      "close with a reflective question that rewards a considered answer",
  },
  {
    key: "choice",
    instruction:
      "close with a concrete choice between two defensible paths and ask what constraint decides it",
  },
  {
    key: "review",
    instruction:
      "close by requesting peer review of the weakest part of the reasoning",
  },
  {
    key: "scenario",
    instruction:
      "close with a small scenario and ask how the reader would respond",
  },
  {
    key: "ranking",
    instruction:
      "close by asking readers to rank the next action, risk, or priority",
  },
  {
    key: "falsify",
    instruction:
      "close by asking what observation would falsify the post's working conclusion",
  },
  {
    key: "boundary",
    instruction: "close by asking where the advice stops being useful or safe",
  },
] as const satisfies readonly StyleOption[];

export function forumAgentStyleVariation(
  agentSlug: string,
  runDate: string,
  slot: number,
): ForumAgentStyleVariation {
  const seed = `${agentSlug}:${runDate}:${slot}`;
  const openingMove = pick(OPENING_MOVES, seed, "opening");
  const rhetoricalPosture = pick(
    RHETORICAL_POSTURES,
    seed,
    "rhetorical-posture",
  );
  const cadence = pick(CADENCE_SHIFTS, seed, "cadence");
  const evidenceEmphasis = pick(EVIDENCE_EMPHASES, seed, "evidence");
  const interactionEnergy = pick(INTERACTION_ENERGIES, seed, "interaction");

  return {
    key: [
      openingMove.key,
      rhetoricalPosture.key,
      cadence.key,
      evidenceEmphasis.key,
      interactionEnergy.key,
    ].join("-"),
    openingMove: openingMove.instruction,
    rhetoricalPosture: rhetoricalPosture.instruction,
    cadence: cadence.instruction,
    evidenceEmphasis: evidenceEmphasis.instruction,
    interactionEnergy: interactionEnergy.instruction,
  };
}

export function forumAgentStyleVariationSummary(
  variation: ForumAgentStyleVariation,
) {
  return `Opening move: ${variation.openingMove}. Rhetorical posture: ${variation.rhetoricalPosture}. Cadence shift: ${variation.cadence}. Evidence emphasis: ${variation.evidenceEmphasis}. Interaction energy: ${variation.interactionEnergy}.`;
}

function pick<T extends StyleOption>(
  options: readonly T[],
  seed: string,
  dimension: string,
) {
  return options[stableHash(`${dimension}:${seed}`) % options.length];
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
