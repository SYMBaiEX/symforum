export function usePathname() {
  return new URLSearchParams(window.location.search).has("protected")
    ? "/account/connections"
    : "/signin";
}
export function useSearchParams() {
  return new URLSearchParams(window.location.search);
}
