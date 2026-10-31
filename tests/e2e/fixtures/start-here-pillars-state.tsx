import { forwardRef, type AnchorHTMLAttributes } from "react";

export const calls = {
  auth: 0,
  navigation: [] as string[],
  readingNavigation: 0,
};
Object.assign(window, { pillarCalls: calls });
window.addEventListener("forum:reading-navigation", () => {
  calls.readingNavigation++;
});
export function usePathname() {
  return location.pathname;
}
export function useConvexAuth() {
  calls.auth++;
  const scenario = new URLSearchParams(location.search).get("scenario");
  return {
    isAuthenticated: scenario === "member",
    isLoading: scenario === "loading",
  };
}
const denied = () => {
  throw Error("No query, authentication mutation, or write is admitted");
};
export const useQuery = denied,
  useMutation = denied,
  useAction = denied;
const Link = forwardRef<
  HTMLAnchorElement,
  AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }
>(function FixtureLink({ prefetch, onClick, ...props }, ref) {
  return (
    <a
      {...props}
      ref={ref}
      data-fixture-prefetch={String(prefetch)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) calls.navigation.push(String(props.href));
        event.preventDefault();
      }}
    />
  );
});
export default Link;
