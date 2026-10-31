import {
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  forumRefs,
  type MyForumProfileRecord,
  type ForumNotificationPreferencesRecord,
} from "../../../components/forum/forum-refs";

function profile(userId: string): MyForumProfileRecord {
  return {
    userId,
    username: userId,
    signature: "",
    customTitle: "",
    showSignatures: true,
    bio: "",
    birthday: "",
    location: "",
    timeZone: "UTC",
    websiteUrl: "",
    threadCount: 0,
    postCount: 0,
    reputationScore: 0,
    rank: "Member",
    trusted: true,
    activeWarningCount: 0,
    activeWarningPoints: 0,
  };
}
function preferences(userId: string): ForumNotificationPreferencesRecord {
  return {
    userId,
    inAppReplies: true,
    inAppNewThreads: true,
    inAppMentions: true,
    emailReplies: false,
    emailNewThreads: false,
    emailDestinationAvailable: true,
    emailDeliveryEnabled: false,
  };
}
let state = {
  isAuthenticated: true,
  isLoading: false,
  profile: profile("member-a"),
  preferences: preferences("member-a"),
  relationshipsLoaded: true,
};
const listeners = new Set<() => void>();
export function update(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
function useSnapshot() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
export const calls: {
  owner: string;
  payload: unknown;
  resolve(): void;
  reject(): void;
}[] = [];
export const reports: string[] = [];
export function useConvexAuth() {
  const value = useSnapshot();
  return { isAuthenticated: value.isAuthenticated, isLoading: value.isLoading };
}
export function useQuery(ref: unknown, args: unknown) {
  const value = useSnapshot();
  if (args === "skip") return undefined;
  if (!value.isAuthenticated) throw new Error("Private query after logout");
  if (ref === forumRefs.getMyForumProfile) return value.profile;
  if (ref === forumRefs.getMyForumNotificationPreferences)
    return value.preferences;
  if (ref === forumRefs.listMyPendingForumContent)
    return { threads: [], posts: [] };
  if (
    ref === forumRefs.listMyForumWarnings ||
    ref === forumRefs.listMyForumReputationHistory
  )
    return [];
  if (ref === forumRefs.listMyForumRelationships)
    return value.relationshipsLoaded
      ? {
          buddies: [
            {
              _id: "buddy-1",
              kind: "buddy",
              username: "existing-buddy",
              displayName: "Existing buddy",
              rank: "Member",
              postCount: 2,
              createdAt: 1,
            },
          ],
          ignored: [],
        }
      : undefined;
  throw new Error("Unexpected query");
}
export function useMutation(ref: unknown) {
  return (payload: unknown) => {
    if (ref !== forumRefs.updateForumRelationship)
      throw new Error("Unexpected mutation");
    return new Promise<void>((resolve, reject) =>
      calls.push({
        owner: state.profile.userId,
        payload,
        resolve,
        reject: () => reject(new Error("Fixture member-list failure")),
      }),
    );
  };
}
export function account(userId: string) {
  update({
    isAuthenticated: true,
    isLoading: false,
    profile: profile(userId),
    preferences: preferences(userId),
  });
}
export function trust(trusted: boolean) {
  update({ profile: { ...state.profile, trusted } });
}
export const usePathname = () => "/forum/control-panel";
export const useForumHash = () => "";

// Only transport-heavy leaves are inert; inputs, buttons and SurfaceScope stay real.
export function ForumLink({
  prefetch: _prefetch,
  ...props
}: ComponentProps<"a"> & { prefetch?: boolean }) {
  return <a {...props} />;
}
export default ForumLink;
export function ForumAvatar() {
  return null;
}
export function ForumBody({ body }: { body?: string }) {
  return <div>{body}</div>;
}
export function ForumLoading({ label }: { label: string }) {
  return <p role="status">{label}</p>;
}
export function ForumMetricBar() {
  return null;
}
export function ForumStatusBox({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <section>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </section>
  );
}
export function ForumAgentApprovalNotice() {
  return null;
}
export function reportAppError(
  _caught: unknown,
  metadata: { eventType: string },
) {
  reports.push(metadata.eventType);
}
