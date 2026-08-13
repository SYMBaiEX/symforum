const GITHUB_USER = "SYMBaiEX";
const CACHE_SECONDS = 60 * 60;
type NextFetchInit = RequestInit & { next?: { revalidate: number } };

type GithubUser = {
  login: string;
  name: string | null;
  bio: string | null;
  created_at: string;
  public_repos: number;
  followers: number;
  following: number;
  avatar_url: string;
  html_url: string;
  location: string | null;
  twitter_username: string | null;
};

type GithubRepo = {
  name: string;
  full_name: string;
  fork: boolean;
  description: string | null;
  html_url: string;
  homepage: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  pushed_at: string | null;
  topics?: string[];
  owner: {
    avatar_url: string;
  };
};

type GithubSearch = {
  total_count: number;
  incomplete_results?: boolean;
};

type CommitMetric = {
  value: number;
  label: string;
  detail: string;
  source: "github-graphql" | "github-rest-search" | "fallback";
  includesPrivate: boolean;
  live: boolean;
};

type ContributionActivityMetric = {
  value: number;
  label: string;
  detail: string;
  source: "github-contribution-graph" | "fallback";
  live: boolean;
};

type ContributionActivityResponse = {
  total: Record<string, number>;
};

type GraphqlContributionResponse = {
  data?: {
    user?: {
      contributionsCollection: {
        totalCommitContributions: number;
        restrictedContributionsCount: number;
      };
    };
  };
  errors?: { message: string }[];
};

export type GithubPortfolioProjectMetric = {
  key: string;
  label: string;
  fullName: string;
  repoUrl: string;
  avatarUrl: string;
  description?: string;
  forks?: number;
  language?: string;
  pushedAt?: string;
  stars?: number;
  prsAuthored?: number;
};

export type GithubPortfolioMetrics = {
  updatedAt: string;
  profile: {
    login: string;
    name: string;
    bio: string;
    avatarUrl: string;
    profileUrl: string;
    location: string;
    twitter: string;
  };
  totals: {
    publicRepos: number;
    ownedRepos: number;
    nonForkRepos: number;
    followers: number;
    authoredPrs: number;
    indexedCommits: number;
  };
  commitMetric: CommitMetric;
  contributionActivity?: ContributionActivityMetric;
  projects: GithubPortfolioProjectMetric[];
};

export const fallbackGithubPortfolioMetrics: GithubPortfolioMetrics = {
  updatedAt: "2026-06-24T00:00:00.000Z",
  profile: {
    login: GITHUB_USER,
    name: "SYMBiEX",
    bio: "Building in Web3, AI, gaming, and agentic systems.",
    avatarUrl: "https://avatars.githubusercontent.com/u/192078165?v=4",
    profileUrl: "https://github.com/SYMBaiEX",
    location: "Birmingham, AL",
    twitter: "SYMBiEX",
  },
  totals: {
    publicRepos: 65,
    ownedRepos: 65,
    nonForkRepos: 17,
    followers: 28,
    authoredPrs: 267,
    indexedCommits: 5148,
  },
  commitMetric: {
    value: 5148,
    label: "Public commits",
    detail: "Fallback from the last verified GitHub commit search.",
    source: "fallback",
    includesPrivate: false,
    live: false,
  },
  contributionActivity: {
    value: 7454,
    label: "Contribution activity",
    detail: "Fallback from the public GitHub contribution graph.",
    source: "fallback",
    live: false,
  },
  projects: [
    {
      key: "elizaos",
      label: "ElizaOS",
      fullName: "elizaOS/eliza",
      repoUrl: "https://github.com/elizaOS/eliza",
      avatarUrl: "https://avatars.githubusercontent.com/u/186240462?v=4",
      stars: 18637,
      prsAuthored: 13,
    },
    {
      key: "babylon",
      label: "Babylon",
      fullName: "BabylonSocial/babylon",
      repoUrl: "https://github.com/BabylonSocial/babylon",
      avatarUrl: "https://avatars.githubusercontent.com/u/246782978?v=4",
      stars: 73,
      prsAuthored: 159,
    },
    {
      key: "hyperia",
      label: "Hyperia",
      fullName: "PlayHyperia/hyperforge",
      repoUrl: "https://github.com/PlayHyperia/hyperforge",
      avatarUrl: "https://avatars.githubusercontent.com/u/236725603?v=4",
      stars: 89,
      prsAuthored: 42,
    },
    {
      key: "opencontroller",
      label: "OpenController",
      fullName: "SYMBaiEX/OpenController",
      repoUrl: "https://github.com/SYMBaiEX/OpenController",
      avatarUrl: "https://avatars.githubusercontent.com/u/192078165?v=4",
      stars: 2,
    },
    {
      key: "gitshipt",
      label: "GitShipt",
      fullName: "SYMBaiEX/GitShipt",
      repoUrl: "https://github.com/SYMBaiEX/GitShipt",
      avatarUrl: "https://avatars.githubusercontent.com/u/192078165?v=4",
      language: "TypeScript",
      stars: 4,
    },
    {
      key: "symindx",
      label: "SYMindX",
      fullName: "SYMBaiEX/SYMindX",
      repoUrl: "https://github.com/SYMBaiEX/SYMindX",
      avatarUrl: "https://avatars.githubusercontent.com/u/192078165?v=4",
      language: "TypeScript",
      stars: 9,
    },
    {
      key: "arklib",
      label: "ArkLib",
      fullName: "lalalune/ArkLib",
      repoUrl: "https://github.com/lalalune/ArkLib",
      avatarUrl: "https://avatars.githubusercontent.com/u/18633264?v=4",
      language: "Lean",
      stars: 5,
    },
  ],
};

export async function getGithubPortfolioMetrics(options?: {
  allowFallback?: boolean;
}): Promise<GithubPortfolioMetrics> {
  try {
    const [user, repos, authoredPrs, indexedCommits] = await Promise.all([
      githubJson<GithubUser>(`https://api.github.com/users/${GITHUB_USER}`),
      githubJson<GithubRepo[]>(
        `https://api.github.com/users/${GITHUB_USER}/repos?per_page=100&type=owner`,
      ),
      githubJson<GithubSearch>(
        `https://api.github.com/search/issues?q=author:${GITHUB_USER}+type:pr`,
      ),
      githubJson<GithubSearch>(
        `https://api.github.com/search/commits?q=author:${GITHUB_USER}`,
        "application/vnd.github.cloak-preview+json",
      ),
    ]);
    const [
      contributionActivity,
      elizaPrs,
      babylonPrs,
      hyperiaPrs,
      elizaRepo,
      babylonRepo,
      hyperiaRepo,
      openControllerRepo,
      arkLibRepo,
      authenticatedCommitMetric,
    ] = await Promise.all([
      getPublicContributionActivity().catch(() => null),
      githubJson<GithubSearch>(
        `https://api.github.com/search/issues?q=author:${GITHUB_USER}+type:pr+repo:elizaOS/eliza`,
      ),
      githubJson<GithubSearch>(
        `https://api.github.com/search/issues?q=author:${GITHUB_USER}+type:pr+repo:BabylonSocial/babylon`,
      ),
      githubJson<GithubSearch>(
        `https://api.github.com/search/issues?q=author:${GITHUB_USER}+type:pr+repo:PlayHyperia/hyperforge`,
      ),
      githubJson<GithubRepo>("https://api.github.com/repos/elizaOS/eliza"),
      githubJson<GithubRepo>(
        "https://api.github.com/repos/BabylonSocial/babylon",
      ),
      githubJson<GithubRepo>(
        "https://api.github.com/repos/PlayHyperia/hyperforge",
      ),
      githubJson<GithubRepo>(
        "https://api.github.com/repos/SYMBaiEX/OpenController",
      ),
      githubJson<GithubRepo>(
        "https://api.github.com/repos/lalalune/ArkLib",
      ).catch(() => null),
      getAuthenticatedCommitMetric(user).catch((error) => {
        console.warn("Falling back to public GitHub commit metric", error);
        return null;
      }),
    ]);

    const ownedRepos = Array.isArray(repos) ? repos.length : user.public_repos;
    const nonForkRepos = Array.isArray(repos)
      ? repos.filter((repo) => !repo.fork).length
      : fallbackGithubPortfolioMetrics.totals.nonForkRepos;
    const commitMetric =
      authenticatedCommitMetric ??
      publicCommitMetric(indexedCommits.total_count);

    return {
      updatedAt: new Date().toISOString(),
      profile: {
        login: user.login,
        name: user.name ?? fallbackGithubPortfolioMetrics.profile.name,
        bio: user.bio ?? fallbackGithubPortfolioMetrics.profile.bio,
        avatarUrl: user.avatar_url,
        profileUrl: user.html_url,
        location: user.location ?? "",
        twitter: user.twitter_username ?? "",
      },
      totals: {
        publicRepos: user.public_repos,
        ownedRepos,
        nonForkRepos,
        followers: user.followers,
        authoredPrs: authoredPrs.total_count,
        indexedCommits: indexedCommits.total_count,
      },
      commitMetric,
      contributionActivity: contributionActivity ?? undefined,
      projects: [
        projectMetric("elizaos", "ElizaOS", elizaRepo, elizaPrs.total_count),
        projectMetric(
          "babylon",
          "Babylon",
          babylonRepo,
          babylonPrs.total_count,
        ),
        projectMetric(
          "hyperia",
          "Hyperia",
          hyperiaRepo,
          hyperiaPrs.total_count,
        ),
        projectMetric("opencontroller", "OpenController", openControllerRepo),
        ...ownedProjectMetrics(repos),
        ...(arkLibRepo ? [projectMetric("arklib", "ArkLib", arkLibRepo)] : []),
      ].filter(
        (metric, index, allMetrics) =>
          allMetrics.findIndex((item) => item.key === metric.key) === index,
      ),
    };
  } catch (error) {
    if (options?.allowFallback === false) {
      throw error;
    }
    console.warn("Falling back to static GitHub portfolio metrics", error);
    return fallbackGithubPortfolioMetrics;
  }
}

async function githubJson<T>(
  url: string,
  accept = "application/vnd.github+json",
) {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const init: NextFetchInit = {
    headers: {
      Accept: accept,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "symbaiex-blog",
    },
    next: { revalidate: CACHE_SECONDS },
  };
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(await githubErrorMessage(response, url));
  }
  return (await response.json()) as T;
}

async function getAuthenticatedCommitMetric(
  user: GithubUser,
): Promise<CommitMetric | null> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    console.warn(
      "GITHUB_TOKEN/GH_TOKEN not set; commit metric covers public commits only",
    );
    return null;
  }

  const currentYear = new Date().getUTCFullYear();
  const startYear = new Date(user.created_at).getUTCFullYear();
  const years = Array.from(
    { length: currentYear - startYear + 1 },
    (_, index) => startYear + index,
  );

  const yearlyTotals = await Promise.all(
    years.map((year) => githubContributionYear(token, year)),
  );
  const visibleCommits = yearlyTotals.reduce(
    (total, year) => total + year.totalCommitContributions,
    0,
  );
  const restricted = yearlyTotals.reduce(
    (total, year) => total + year.restrictedContributionsCount,
    0,
  );
  const value = visibleCommits + restricted;

  return {
    value,
    label: restricted > 0 ? "Private + public activity" : "Public commits",
    detail:
      restricted > 0
        ? `GitHub GraphQL across ${years.length} yearly windows; ${visibleCommits} visible commit contributions plus ${restricted} restricted contributions.`
        : `GitHub GraphQL across ${years.length} yearly windows.`,
    source: "github-graphql",
    includesPrivate: true,
    live: true,
  };
}

async function githubContributionYear(token: string, year: number) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const from = `${year}-01-01T00:00:00Z`;
  const to =
    year === currentYear ? now.toISOString() : `${year}-12-31T23:59:59Z`;
  const init: NextFetchInit = {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "symbaiex-blog",
    },
    body: JSON.stringify({
      query: `
        query CommitContributions($login: String!, $from: DateTime!, $to: DateTime!) {
          user(login: $login) {
            contributionsCollection(from: $from, to: $to) {
              totalCommitContributions
              restrictedContributionsCount
            }
          }
        }
      `,
      variables: {
        from,
        login: GITHUB_USER,
        to,
      },
    }),
    next: { revalidate: CACHE_SECONDS },
  };
  const response = await fetch("https://api.github.com/graphql", init);

  if (!response.ok) {
    throw new Error(
      await githubErrorMessage(response, "https://api.github.com/graphql"),
    );
  }

  const payload = (await response.json()) as GraphqlContributionResponse;
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }
  const collection = payload.data?.user?.contributionsCollection;
  if (!collection) {
    throw new Error("GitHub GraphQL did not return contributions");
  }
  return collection;
}

async function githubErrorMessage(response: Response, url: string) {
  let providerMessage = "";
  try {
    const payload = (await response.clone().json()) as { message?: string };
    providerMessage = payload.message ? `: ${payload.message}` : "";
  } catch {
    providerMessage = "";
  }

  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");
  const resetText = reset
    ? `; resets ${new Date(Number(reset) * 1000).toISOString()}`
    : "";
  const remainingText = remaining ? `; remaining ${remaining}` : "";

  return `GitHub request failed: ${response.status} ${url}${providerMessage}${remainingText}${resetText}`;
}

async function getPublicContributionActivity(): Promise<ContributionActivityMetric | null> {
  const init: NextFetchInit = {
    headers: {
      Accept: "application/json",
      "User-Agent": "symbaiex-blog",
    },
    next: { revalidate: CACHE_SECONDS },
  };
  const response = await fetch(
    `https://github-contributions-api.jogruber.de/v4/${GITHUB_USER}`,
    init,
  );
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as ContributionActivityResponse;
  const value = Object.values(payload.total).reduce(
    (total, yearValue) => total + yearValue,
    0,
  );
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return {
    value,
    label: "Contribution activity",
    detail: "Live public GitHub contribution graph.",
    source: "github-contribution-graph",
    live: true,
  };
}

function publicCommitMetric(value: number): CommitMetric {
  return {
    value,
    label: "Public commits",
    detail: "Live GitHub REST search of public commits.",
    source: "github-rest-search",
    includesPrivate: false,
    live: true,
  };
}

function projectMetric(
  key: GithubPortfolioProjectMetric["key"],
  label: string,
  repo: GithubRepo,
  prsAuthored?: number,
): GithubPortfolioProjectMetric {
  return {
    key,
    label,
    description: repo.description ?? undefined,
    forks: repo.forks_count,
    fullName: repo.full_name,
    language: repo.language ?? undefined,
    pushedAt: repo.pushed_at ?? undefined,
    repoUrl: repo.html_url,
    avatarUrl: repo.owner.avatar_url,
    stars: repo.stargazers_count,
    prsAuthored,
  };
}

function ownedProjectMetrics(repos: GithubRepo[]) {
  const projectRepos = [
    ["gitshipt", "GitShipt", "SYMBaiEX/GitShipt"],
    ["symindx", "SYMindX", "SYMBaiEX/SYMindX"],
    ["doolittle", "doolittle", "SYMBaiEX/doolittle"],
    ["symlog", "SYMLog", "SYMBaiEX/SYMLog"],
    ["pod-protocol", "PoD Protocol", "SYMBaiEX/PoD-Protocol"],
  ] as const;
  const reposByFullName = new Map(
    repos.map((repo) => [repo.full_name.toLowerCase(), repo]),
  );

  return projectRepos.flatMap(([key, label, fullName]) => {
    const repo = reposByFullName.get(fullName.toLowerCase());
    return repo ? [projectMetric(key, label, repo)] : [];
  });
}
