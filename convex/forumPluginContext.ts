import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { ForumPluginPrincipal } from "./forumPluginPrincipal";

const contextKey = Symbol("server-resolved-forum-plugin-principal");
const userKey = Symbol("server-resolved-forum-plugin-user");
type Context = (MutationCtx | QueryCtx) & {
  [contextKey]?: ForumPluginPrincipal;
};
type PrincipalUser = Doc<"users"> & { [userKey]?: ForumPluginPrincipal };

/** Only validated principal resolvers create this context; never accept it over the wire. */
export function withForumPluginPrincipal<C extends MutationCtx | QueryCtx>(
  ctx: C,
  principal: ForumPluginPrincipal,
): C {
  return Object.assign(Object.create(Object.getPrototypeOf(ctx)), ctx, {
    [contextKey]: principal,
  });
}
export function forumPluginPrincipal(ctx: MutationCtx | QueryCtx) {
  return (ctx as Context)[contextKey] ?? null;
}
export function principalForumUser(
  principal: ForumPluginPrincipal,
  civic = false,
): Doc<"users"> {
  return Object.assign({}, civic ? principal.owner : principal.actor, {
    [userKey]: principal,
  });
}
export function forumUserPrincipal(user: Doc<"users"> | null | undefined) {
  return (user as PrincipalUser | null | undefined)?.[userKey] ?? null;
}
