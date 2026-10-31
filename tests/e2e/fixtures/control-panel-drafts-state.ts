import { useSyncExternalStore } from "react";
import { forumRefs, type MyForumProfileRecord, type ForumNotificationPreferencesRecord } from "../../../components/forum/forum-refs";

function profile(userId: string): MyForumProfileRecord {
  return { userId, username: userId, signature: "", customTitle: "", showSignatures: true, bio: `${userId} biography`, birthday: "", location: "", timeZone: "UTC", websiteUrl: "", threadCount: 0, postCount: 0, reputationScore: 0, rank: "Member", trusted: true, activeWarningCount: 0, activeWarningPoints: 0 };
}
function preferences(userId: string): ForumNotificationPreferencesRecord {
  return { userId, inAppReplies: true, inAppNewThreads: true, inAppMentions: true, emailReplies: false, emailNewThreads: false, emailDestinationAvailable: true, emailDeliveryEnabled: false };
}
let state = { isAuthenticated: true, isLoading: false, profile: profile("member-a"), preferences: preferences("member-a") };
const listeners = new Set<() => void>();
export function update(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
function useSnapshot() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => state);
}
export const calls: { kind: "profile" | "notifications"; owner: string; payload: unknown; resolve: () => void; reject: () => void }[] = [];
export const reads: string[] = [];
export function useConvexAuth() {
  const value = useSnapshot();
  return { isAuthenticated: value.isAuthenticated, isLoading: value.isLoading };
}
export function useQuery(ref: unknown, args: unknown) {
  const value = useSnapshot();
  if (args === "skip") return undefined;
  if (!value.isAuthenticated) throw new Error("Private query after logout");
  if (ref === forumRefs.getMyForumProfile) { reads.push("profile"); return value.profile; }
  if (ref === forumRefs.getMyForumNotificationPreferences) { reads.push("preferences"); return value.preferences; }
  if (ref === forumRefs.listMyPendingForumContent) return { threads: [], posts: [] };
  if (ref === forumRefs.listMyForumWarnings || ref === forumRefs.listMyForumReputationHistory || ref === forumRefs.listMyForumRelationships) return [];
  throw new Error("Unexpected query");
}
export function useMutation(ref: unknown) {
  const kind = ref === forumRefs.updateMyForumProfile ? "profile" : ref === forumRefs.updateMyForumNotificationPreferences ? "notifications" : null;
  return (payload: unknown) => {
    if (!kind) throw new Error("Unexpected mutation");
    return new Promise<void>((resolve, reject) => calls.push({ kind, owner: state.profile.userId, payload, resolve, reject: () => reject(new Error("Fixture save failed")) }));
  };
}
export const usePathname = () => "/forum/control-panel";
export const useForumHash = () => "";
export function account(userId: string, delayedPreferences = false) {
  update({ isAuthenticated: true, isLoading: false, profile: profile(userId), ...(delayedPreferences ? {} : { preferences: preferences(userId) }) });
}
export function changeProfile(patch: Partial<MyForumProfileRecord>) { update({ profile: { ...state.profile, ...patch } }); }
export function changePreferences(patch: Partial<ForumNotificationPreferencesRecord>) { update({ preferences: { ...state.preferences, ...patch } }); }
