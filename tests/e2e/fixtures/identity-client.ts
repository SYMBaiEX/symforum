// UI fixture only. No real auth provider, credentials, or production endpoint.
export const identityClient = {
  getSession: async () =>
    new URLSearchParams(window.location.search).has("sessionfail")
      ? { data: null, error: { message: "Fixture only" } }
      : { data: { user: { id: "fixture-user" } }, error: null },
  linkSocial: async () => ({}),
  signIn: { social: async () => ({}) },
};
export async function identityRequest<T>(
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetch("/api/identity" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Fixture request failed");
  return response.json();
}
