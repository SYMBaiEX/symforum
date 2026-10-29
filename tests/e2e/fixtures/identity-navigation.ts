export function usePathname() {
  return new URLSearchParams(window.location.search).has("protected")
    ? "/account/connections"
    : "/signin";
}
