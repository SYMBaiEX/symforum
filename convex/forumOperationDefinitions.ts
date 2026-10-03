import type { ObjectType, PropertyValidators, Validator } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type Definition<C, A extends PropertyValidators, R> = {
  args: A;
  returns?: Validator<R, "required", string>;
  handler: (ctx: C, args: ObjectType<A>) => R | Promise<R>;
};
export function defineForumQuery<A extends PropertyValidators, R>(
  definition: Definition<QueryCtx, A, R>,
) {
  return definition;
}
export function defineForumMutation<A extends PropertyValidators, R>(
  definition: Definition<MutationCtx, A, R>,
) {
  return definition;
}
