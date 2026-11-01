import {
  useMemo,
  useSyncExternalStore,
  forwardRef,
  type AnchorHTMLAttributes,
} from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import {
  Link as NativeLink,
  getRoute,
} from "../../../components/forum/plugin-adapter/router";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
};
const snapshot = () => location.href;
export const state = {
  reads: [] as string[],
  routes: [] as string[],
  forbidden: [] as string[],
  get nativeRoute() {
    return getRoute();
  },
};
// Only the real native router is exercised; no SDK/host bridge is connected.
export const forumHost = {
  openLink(href: string) {
    state.forbidden.push(`native-external:${href}`);
    throw new Error("Native external/auth calls are denied");
  },
};
Object.assign(window, { __signinContext: state });
export function usePathname() {
  return new URL(useSyncExternalStore(subscribe, snapshot)).pathname;
}
export function useSearchParams() {
  const href = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => new URL(href).searchParams, [href]);
}
export function useQuery(ref: FunctionReference<"query">, args: unknown) {
  const name = getFunctionName(ref);
  if (!["forum:getMyForumNavState", "forum:overview"].includes(name)) {
    state.forbidden.push(name);
    throw new Error(`Unexpected read ${name}`);
  }
  if (!state.reads.includes(name)) state.reads.push(name);
  if (JSON.stringify(args) !== "{}")
    throw new Error("Unexpected read arguments");
  return name === "forum:overview"
    ? { categories: [], sections: [] }
    : {
        authenticated: false,
        username: null,
        trusted: false,
        unreadPrivateMessages: 0,
        unreadNotifications: 0,
      };
}
const Link = forwardRef<
  HTMLAnchorElement,
  AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }
>(function LocalLink({ prefetch: _prefetch, onClick, ...props }, ref) {
  // next/image is an inert visual only; no image network request is admitted.
  if ("src" in props)
    return (
      <span
        role="img"
        aria-label={"alt" in props ? String(props.alt) : ""}
        className={props.className}
      />
    );
  return (
    <FixtureLink
      {...props}
      ref={ref}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (new URLSearchParams(location.search).get("fixtureNative") !== "1")
          event.preventDefault();
        state.routes.push(event.currentTarget.getAttribute("href")!);
      }}
    />
  );
});
const FixtureLink = forwardRef<
  HTMLAnchorElement,
  AnchorHTMLAttributes<HTMLAnchorElement>
>(function FixtureLink(props, ref) {
  return new URLSearchParams(location.search).get("fixtureNative") === "1" ? (
    <NativeLink {...props} href={props.href!} ref={ref} />
  ) : (
    <a {...props} ref={ref} />
  );
});
export default Link;
export function useTheme() {
  return { theme: "dark", setTheme: () => {} };
}
export function Image(props: { src: string; alt: string; className?: string }) {
  return <span className={props.className} role="img" aria-label={props.alt} />;
}
