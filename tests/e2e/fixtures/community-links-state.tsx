import { forwardRef, type AnchorHTMLAttributes } from "react";
const params = new URLSearchParams(location.search);
export const evidence = { forbidden: [] as string[], auth: 0 };
declare global {
  interface Window {
    communityLinkEvidence: typeof evidence;
  }
}
window.communityLinkEvidence = evidence;
export function usePathname() {
  return location.pathname;
}
export function useSearchParams() {
  return new URLSearchParams(location.search);
}
export function useConvexAuth() {
  evidence.auth++;
  return {
    isAuthenticated: params.get("session") === "member",
    isLoading: params.get("session") === "loading",
  };
}
function deny() {
  evidence.forbidden.push("query, mutation, provider or financial operation");
  throw Error("No live or private operation allowed");
}
export const useQuery = deny,
  useMutation = deny,
  useAction = deny;
export function ThemeToggle() {
  return <button type="button">Theme</button>;
}
export function SiteSurfaceSwitcher() {
  return null;
}
export function BlogNavigation() {
  return null;
}
export function NewsNavigation() {
  return null;
}
export function NewsletterNavigation() {
  return null;
}
export function WebVitalsReporter() {
  return null;
}
export function AnalyticsTracker() {
  return null;
}
export function AppErrorSurface() {
  return null;
}
const Link = forwardRef<
  HTMLAnchorElement,
  AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }
>(function InertLink({ prefetch: _prefetch, ...props }, ref) {
  return <a {...props} ref={ref} />;
});
export default Link;
