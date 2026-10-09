import { MarkdownContent } from "@/components/markdown-content";
import { PortfolioProjectMark } from "@/components/portfolio-project-mark";
import { PrimaryPageSurface } from "@/components/primary-page-surface";
import { StructuredData } from "@/components/structured-data";
import {
  ForumBodyGrid,
  ForumSectionHeader,
} from "@/components/forum/forum-layout-primitives";
import {
  type GithubPortfolioMetrics,
  type GithubPortfolioProjectMetric,
} from "@/lib/github-portfolio";
import { getCachedGithubPortfolioMetrics } from "@/lib/portfolio-metrics";
import { safeExternalUrl } from "@/lib/safe-url";
import { breadcrumbStructuredData } from "@/lib/seo";
import { primarySiteUrl } from "@/lib/site-urls";
import { getPortfolioProjects, getSitePage } from "@/lib/site-content";
import type { PortfolioProjectRecord } from "@/lib/site-content-defaults";
import { ArrowUpRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const page = await getSitePage("portfolio");
  return {
    title: page?.title ?? "Portfolio",
    description: page?.heroBody,
    alternates: { canonical: "/portfolio" },
    openGraph: {
      type: "website",
      url: primarySiteUrl("/portfolio"),
      title: page?.title ?? "Portfolio",
      description: page?.heroBody,
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: "SYMBaIEX portfolio index and project archive.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: page?.title ?? "Portfolio",
      description:
        page?.heroBody ??
        "A working record of systems built, contributed to, and shipped.",
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: "SYMBaIEX portfolio index and project archive.",
        },
      ],
    },
  };
}

export default async function PortfolioPage() {
  const [page, projects, githubMetrics] = await Promise.all([
    getSitePage("portfolio"),
    getPortfolioProjects(),
    getCachedGithubPortfolioMetrics(),
  ]);

  return (
    <PrimaryPageSurface>
      <article className="page-frame page-frame-dense">
        <StructuredData
          data={[
            {
              "@type": "CollectionPage",
              "@id": `${primarySiteUrl("/portfolio")}#collection`,
              name: page?.title ?? "Portfolio",
              description: page?.heroBody,
              url: primarySiteUrl("/portfolio"),
              author: { "@id": `${primarySiteUrl("/about")}#austin-hamilton` },
              mainEntity: {
                "@type": "ItemList",
                "@id": `${primarySiteUrl("/portfolio")}#projects`,
                numberOfItems: projects.length,
                itemListElement: projects.map((project, index) => ({
                  "@type": "ListItem",
                  position: index + 1,
                  item: {
                    "@type": "CreativeWork",
                    "@id": `${primarySiteUrl(`/portfolio/${encodeURIComponent(project.slug)}`)}#work`,
                    name: project.name,
                    url: primarySiteUrl(
                      `/portfolio/${encodeURIComponent(project.slug)}`,
                    ),
                    description: project.summary,
                  },
                })),
              },
            },
            breadcrumbStructuredData([
              { name: "Home", url: primarySiteUrl("/") },
              { name: "Portfolio", url: primarySiteUrl("/portfolio") },
            ]),
          ]}
        />
        <ForumBodyGrid
          mobileSidebarLabel="GitHub activity"
          sidebar={<GithubMetricPanel metrics={githubMetrics} />}
        >
          <header
            className="forum-panel p-4 sm:p-5"
            aria-labelledby="portfolio-heading"
          >
            <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <span className="size-2 bg-[var(--accent-magenta)]" />
              Selected work
            </p>
            <h1
              id="portfolio-heading"
              className="mt-2 text-4xl font-bold leading-none tracking-[-0.05em] text-balance sm:text-5xl"
            >
              {page?.heroHeading ?? "Portfolio"}
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base md:leading-7">
              {page?.heroBody ??
                "A working record of systems built, contributed to, and shipped."}
            </p>
            <a
              href={githubMetrics.profile.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="forum-action-pill focus-ring inline-flex items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground mt-4 w-fit"
            >
              GitHub / {githubMetrics.profile.login}
              <ArrowUpRight aria-hidden="true" className="size-3.5" />
            </a>
          </header>

          <section
            className="forum-panel overflow-hidden !p-0"
            aria-labelledby="portfolio-projects-heading"
          >
            <ForumSectionHeader
              title="Work index"
              id="portfolio-projects-heading"
            >
              <span className="font-mono text-[10px] uppercase">
                {String(projects.length).padStart(2, "0")} projects
              </span>
            </ForumSectionHeader>
            {projects.length > 0 ? (
              <ol className="divide-y divide-row-border">
                {projects.map((project) => (
                  <li key={project.slug}>
                    <ProjectRow
                      metric={metricForProject(project, githubMetrics)}
                      project={project}
                    />
                  </li>
                ))}
              </ol>
            ) : (
              <p className="border-t border-row-border px-4 py-6 text-sm text-muted-foreground">
                No projects are published yet.
              </p>
            )}
          </section>

          {page?.body ? (
            <details className="forum-panel group overflow-hidden !p-0">
              <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] marker:content-none">
                Portfolio notes
                <Plus
                  aria-hidden="true"
                  className="size-3.5 transition-transform group-open:rotate-45"
                />
              </summary>
              <div className="border-t border-row-border px-4 py-5 sm:px-5">
                <MarkdownContent
                  className="markdown-compact max-w-3xl"
                  content={page.body}
                />
              </div>
            </details>
          ) : null}
        </ForumBodyGrid>
      </article>
    </PrimaryPageSurface>
  );
}

function GithubMetricPanel({ metrics }: { metrics: GithubPortfolioMetrics }) {
  const primaryMetric =
    metrics.commitMetric.includesPrivate || !metrics.contributionActivity
      ? metrics.commitMetric
      : metrics.contributionActivity;
  const metricItems = [
    {
      label:
        primaryMetric === metrics.contributionActivity ? "Activity" : "Commits",
      value: formatCount(primaryMetric.value),
    },
    {
      label: "Authored PRs",
      value: formatCount(metrics.totals.authoredPrs),
    },
    {
      label: "Public repos",
      value: formatCount(metrics.totals.publicRepos),
    },
    {
      label: "Followers",
      value: formatCount(metrics.totals.followers),
    },
  ];
  const updatedAtMs = Date.parse(metrics.updatedAt);
  const updatedLabel = Number.isNaN(updatedAtMs)
    ? null
    : new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date(updatedAtMs));

  return (
    <section
      className="forum-panel overflow-hidden !p-0"
      aria-labelledby="github-activity-heading"
    >
      <ForumSectionHeader title="GitHub activity" id="github-activity-heading">
        {updatedLabel ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.08em]">
            Snapshot / {updatedLabel}
          </span>
        ) : null}
      </ForumSectionHeader>
      <dl className="grid grid-cols-2 border-t border-row-border">
        {metricItems.map((item, index) => (
          <div
            key={item.label}
            className={`min-w-0 p-3 ${
              index % 2 === 0 ? "border-r border-row-border" : ""
            } ${index < 2 ? "border-b border-row-border" : ""}`}
          >
            <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              {item.label}
            </dt>
            <dd className="mt-2 text-2xl font-semibold leading-none tracking-tight">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ProjectRow({
  project,
  metric,
}: {
  project: PortfolioProjectRecord;
  metric: GithubPortfolioProjectMetric | null;
}) {
  return (
    <Link
      href={`/portfolio/${project.slug}`}
      prefetch
      aria-label={`Open ${project.name} project`}
      className="focus-ring forum-list-row group grid min-w-0 grid-cols-[4rem_minmax(0,1fr)_auto] items-start gap-3 p-3 sm:gap-4 sm:p-4"
    >
      <PortfolioProjectMark
        name={project.name}
        imageUrl={project.imageUrl ?? metric?.avatarUrl}
        imageAlt={project.imageAlt}
        order={project.order}
      />

      <div className="min-w-0">
        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
          {String(project.order).padStart(2, "0")} / {project.type}
        </p>

        <h3 className="mt-1 text-xl font-semibold leading-tight tracking-[-0.03em] group-hover:text-primary sm:text-2xl">
          {project.name}
        </h3>
        <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">
          {project.summary}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-row-border pt-3">
          <span className="max-w-full truncate font-mono text-[9px] uppercase tracking-[0.1em]">
            {projectProof(project, metric)}
          </span>
          {project.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground"
            >
              #{tag}
            </span>
          ))}
        </div>
      </div>
      <ArrowUpRight
        aria-hidden="true"
        className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
      />
    </Link>
  );
}

function metricForProject(
  project: PortfolioProjectRecord,
  metrics: GithubPortfolioMetrics,
) {
  const slug = project.slug.toLowerCase();
  const key = slug === "playhyperia" ? "hyperia" : slug;
  const projectRepoPath = repoPathLabel(project.repoUrl)?.toLowerCase();

  return (
    metrics.projects.find((metric) => {
      const metricRepoPath = repoPathLabel(metric.repoUrl)?.toLowerCase();
      return (
        metric.key === key ||
        (projectRepoPath !== undefined && metricRepoPath === projectRepoPath)
      );
    }) ?? null
  );
}

function projectProof(
  project: PortfolioProjectRecord,
  metric: GithubPortfolioProjectMetric | null,
) {
  if (metric?.prsAuthored) {
    return `${formatCount(metric.prsAuthored)} authored ${
      metric.prsAuthored === 1 ? "PR" : "PRs"
    }`;
  }
  if (metric?.stars !== undefined) {
    return `${formatCount(metric.stars)} GitHub ${
      metric.stars === 1 ? "star" : "stars"
    }`;
  }
  return repoPathLabel(project.repoUrl) ?? project.timeframe;
}

function formatCount(value: number) {
  return Intl.NumberFormat("en", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function repoPathLabel(value: string | undefined) {
  const safeUrl = safeExternalUrl(value);
  if (!safeUrl) {
    return null;
  }

  return new URL(safeUrl).pathname.replace(/^\//, "");
}
