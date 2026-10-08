type HumanAuthEnvironment = {
  [key: string]: string | undefined;
  NEXT_PUBLIC_WORKOS_ENABLED?: string;
  NEXT_PUBLIC_WORKOS_REDIRECT_URI?: string;
  WORKOS_CLIENT_ID?: string;
  WORKOS_API_KEY?: string;
  WORKOS_COOKIE_PASSWORD?: string;
  WORKOS_COOKIE_DOMAIN?: string;
};

export function humanAuthConfigurationProblems(
  environment: HumanAuthEnvironment,
) {
  if (environment.NEXT_PUBLIC_WORKOS_ENABLED !== "true") return [];

  const problems: string[] = [];
  for (const name of ["WORKOS_CLIENT_ID", "WORKOS_API_KEY"] as const) {
    if (!environment[name]?.trim()) problems.push(`${name} is required`);
  }
  if ((environment.WORKOS_COOKIE_PASSWORD?.length ?? 0) < 32) {
    problems.push("WORKOS_COOKIE_PASSWORD must contain at least 32 characters");
  }

  let callback: URL;
  try {
    callback = new URL(environment.NEXT_PUBLIC_WORKOS_REDIRECT_URI ?? "");
    if (
      callback.username ||
      callback.password ||
      callback.search ||
      callback.hash ||
      callback.pathname !== "/callback" ||
      !["http:", "https:"].includes(callback.protocol)
    ) {
      throw new Error("Invalid callback");
    }
  } catch {
    problems.push(
      "NEXT_PUBLIC_WORKOS_REDIRECT_URI must be the registered /callback URL",
    );
    return problems;
  }

  const trustedHost = [
    "symbaiex.com",
    "www.symbaiex.com",
    "forum.symbaiex.com",
    "blog.symbaiex.com",
    "news.symbaiex.com",
    "newsletter.symbaiex.com",
  ].includes(callback.hostname);
  const domain = environment.WORKOS_COOKIE_DOMAIN?.trim() ?? "";
  const localHost =
    callback.hostname === "localhost" ||
    callback.hostname.endsWith(".localhost") ||
    callback.hostname === "127.0.0.1" ||
    callback.hostname === "[::1]";
  if (callback.protocol !== "https:" && !localHost && !trustedHost) {
    problems.push("WorkOS callbacks require HTTPS outside localhost");
  }
  if (trustedHost) {
    if (callback.protocol !== "https:") {
      problems.push("Production WorkOS callbacks require HTTPS");
    }
    if (domain !== "symbaiex.com" && domain !== ".symbaiex.com") {
      problems.push(
        "WORKOS_COOKIE_DOMAIN must be .symbaiex.com for shared production sessions",
      );
    }
  } else if (domain) {
    problems.push(
      "WORKOS_COOKIE_DOMAIN must be empty outside trusted symbaiex.com hosts",
    );
  }
  return problems;
}

export function assertHumanAuthConfiguration(
  environment: HumanAuthEnvironment,
) {
  const problems = humanAuthConfigurationProblems(environment);
  if (problems.length) {
    throw new Error(
      `Human authentication is not configured: ${problems.join("; ")}`,
    );
  }
}
