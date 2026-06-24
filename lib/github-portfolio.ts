const GITHUB_USER = "SYMBaiEX";
const CACHE_SECONDS = 60 * 60;

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
  key: "elizaos" | "babylon" | "hyperia" | "opencontroller";
  label: string;
  fullName: string;
  repoUrl: string;
  avatarUrl: string;
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
  ],
};

export async function getGithubPortfolioMetrics(): Promise<GithubPortfolioMetrics> {
  try {
    const [
      user,
      repos,
      authoredPrs,
      indexedCommits,
      contributionActivity,
      elizaPrs,
      babylonPrs,
      hyperiaPrs,
      elizaRepo,
      babylonRepo,
      hyperiaRepo,
      openControllerRepo,
    ] = await Promise.all([
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
    ]);

    const ownedRepos = Array.isArray(repos) ? repos.length : user.public_repos;
    const nonForkRepos = Array.isArray(repos)
      ? repos.filter((repo) => !repo.fork).length
      : fallbackGithubPortfolioMetrics.totals.nonForkRepos;
    const commitMetric =
      (await getAuthenticatedCommitMetric(user).catch((error) => {
        console.warn("Falling back to public GitHub commit metric", error);
        return null;
      })) ?? publicCommitMetric(indexedCommits.total_count);

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
      ],
    };
  } catch (error) {
    console.warn("Falling back to static GitHub portfolio metrics", error);
    return fallbackGithubPortfolioMetrics;
  }
}

async function githubJson<T>(
  url: string,
  accept = "application/vnd.github+json",
) {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "symbaiex-blog",
    },
    next: { revalidate: CACHE_SECONDS },
  });
  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${url}`);
  }
  return (await response.json()) as T;
}

async function getAuthenticatedCommitMetric(
  user: GithubUser,
): Promise<CommitMetric | null> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
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
  const value = yearlyTotals.reduce(
    (total, year) => total + year.totalCommitContributions,
    0,
  );
  const restricted = yearlyTotals.reduce(
    (total, year) => total + year.restrictedContributionsCount,
    0,
  );

  return {
    value,
    label: "Private + public commits",
    detail:
      restricted > 0
        ? `GitHub GraphQL across ${years.length} yearly windows; ${restricted} restricted contributions counted by GitHub.`
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
  const response = await fetch("https://api.github.com/graphql", {
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
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL request failed: ${response.status}`);
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

async function getPublicContributionActivity(): Promise<ContributionActivityMetric | null> {
  const response = await fetch(
    `https://github-contributions-api.jogruber.de/v4/${GITHUB_USER}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "symbaiex-blog",
      },
      next: { revalidate: CACHE_SECONDS },
    },
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
    detail:
      "",
    source: "github-contribution-graph",
    live: true,
  };
}

function publicCommitMetric(value: number): CommitMetric {
  return {
    value,
    label: "Public commits",
    detail:
      "Live GitHub REST commit search. Add GITHUB_TOKEN or GH_TOKEN for private + public commit contributions.",
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
    fullName: repo.full_name,
    repoUrl: repo.html_url,
    avatarUrl: repo.owner.avatar_url,
    stars: repo.stargazers_count,
    prsAuthored,
  };
}
