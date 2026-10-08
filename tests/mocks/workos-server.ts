export async function authkit() {
  return { headers: new Headers(), session: null };
}

export function applyResponseHeaders(response: Response) {
  return response;
}

export function partitionAuthkitHeaders() {
  return { requestHeaders: new Headers(), responseHeaders: new Headers() };
}

export function getSignInUrl() {
  return Promise.resolve("https://auth.example.test/sign-in");
}

export function getSignUpUrl() {
  return Promise.resolve("https://auth.example.test/sign-up");
}

export function handleAuth() {
  return () => new Response(null, { status: 204 });
}

export function withAuth() {
  return Promise.resolve(null);
}
