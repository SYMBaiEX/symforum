export default function Loading() {
  // Avoid a global streaming skeleton on forum routes; the real page already
  // provides readable no-JS fallback content and lighter client status.
  return null;
}
