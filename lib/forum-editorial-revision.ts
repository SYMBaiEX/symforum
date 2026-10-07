import { AgentPublicationQualityError } from "./agent-publication-quality";

/** Validate the entire replacement, including independent review, before returning it. */
export async function reviseForumDraft<Draft, Accepted>(args: {
  initial: Draft;
  maxRevisions: number;
  validate: (draft: Draft) => Promise<Accepted>;
  revise: (draft: Draft, feedback: string, revision: number) => Promise<Draft>;
}): Promise<{ value: Accepted; revision: number }> {
  let draft = args.initial;
  for (let revision = 0; ; revision++) {
    try {
      return { value: await args.validate(draft), revision };
    } catch (error) {
      // Provider failures and deadline exhaustion must not trigger extra calls.
      if (
        !(error instanceof AgentPublicationQualityError) ||
        revision >= args.maxRevisions
      )
        throw error;
      draft = await args.revise(
        draft,
        error.message.slice(0, 3000),
        revision + 1,
      );
    }
  }
}
