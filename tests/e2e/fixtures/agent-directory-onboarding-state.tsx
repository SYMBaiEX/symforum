import {
  forwardRef,
  useEffect,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
} from "react";
import { forumRefs } from "../../../components/forum/forum-refs";
export { ForumLink } from "../../../components/forum/forum-link";

const initial = new URLSearchParams(location.search);
const scenario = initial.get("scenario") ?? "guest";
const reads: unknown[] = [],
  navigations: string[] = [],
  forbidden: string[] = [];
const listeners = new Set<() => void>();
const example = {
  slug: "fixture-agent",
  name: "Fixture Agent",
  username: "fixture_agent",
  title: "Public research contributor",
  bio: "A source-linked AI contributor.",
  location: "Research desk",
  voice: "Careful and concise",
  dailyPostTarget: 2,
};
let roster: (typeof example)[] | undefined =
  scenario === "loading" ? undefined : scenario === "empty" ? [] : [example];
export const fixture = {
  reads,
  navigations,
  forbidden,
  setRoster(mode: "empty" | "ready" | "long") {
    roster =
      mode === "empty"
        ? []
        : [
            {
              ...example,
              ...(mode === "long"
                ? {
                    name: "VeryLongPublicAgentName".repeat(5),
                    username: "public_handle_".repeat(8),
                    voice: "VeryLongVoiceDescription".repeat(8),
                  }
                : {}),
            },
          ];
    listeners.forEach((listener) => listener());
  },
};
declare global {
  interface Window {
    agentDirectory: typeof fixture;
  }
}
window.agentDirectory = fixture;
export const useConvexAuth = () => ({
  isAuthenticated: scenario === "member",
  isLoading: scenario === "loading",
});
export const usePathname = () => location.pathname;
export function useQuery(ref: unknown, args: unknown) {
  if (ref !== forumRefs.listPublicAgents) {
    forbidden.push("query");
    throw Error("Unexpected read");
  }
  const key = JSON.stringify(args);
  useEffect(() => {
    reads.push(JSON.parse(key));
  }, [key]);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => roster,
  );
}
const deny = () => {
  forbidden.push("write or provider");
  throw Error("No write or provider operation allowed");
};
export const useMutation = deny,
  useAction = deny,
  useConvex = deny;
const Link = forwardRef<
  HTMLAnchorElement,
  AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }
>(function InertLink({ prefetch, onClick, ...props }, ref) {
  return (
    <a
      {...props}
      ref={ref}
      data-fixture-prefetch={String(prefetch)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) navigations.push(String(props.href));
        event.preventDefault();
      }}
    />
  );
});
export default Link;
// These inert leaves mirror the existing status classes, without importing unrelated private hook owners.
export const ForumLoading = ({ label }: { label: string }) => (
  <p role="status">{label}</p>
);
export const ForumAvatar = ({
  name,
  className,
}: {
  name: string;
  className?: string;
}) => (
  <span className={className} aria-label={`${name} portrait`}>
    AI
  </span>
);
export const ForumStatusBox = ({
  title,
  body,
}: {
  title: string;
  body: string;
  accent?: string;
}) => (
  <div className="forum-status-box py-4">
    <p className="forum-status-title text-sm font-semibold text-foreground">
      {title}
    </p>
    <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
      {body}
    </p>
  </div>
);
export function preventExternalNavigation(event: MouseEvent) {
  const anchor = (event.target as Element)?.closest("a");
  if (event.defaultPrevented || !anchor) return;
  navigations.push(anchor.href);
  event.preventDefault();
}
document.addEventListener("click", preventExternalNavigation);
