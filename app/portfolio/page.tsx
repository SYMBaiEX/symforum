import { MarkdownContent } from "@/components/markdown-content";
import { PortfolioProjectMark } from "@/components/portfolio-project-mark";
import { StructuredData } from "@/components/structured-data";
import {
  type GithubPortfolioMetrics,
  type GithubPortfolioProjectMetric,
} from "@/lib/github-portfolio";
import { getCachedGithubPortfolioMetrics } from "@/lib/portfolio-metrics";
import { safeExternalUrl } from "@/lib/safe-url";
import { breadcrumbStructuredData, AUTHOR_NAME } from "@/lib/seo";
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
    <article className="page-frame page-frame-dense">
      <StructuredData
        data={[
          {
            "@type": "CollectionPage",
            name: page?.title ?? "Portfolio",
            description: page?.heroBody,
            url: primarySiteUrl("/portfolio"),
            author: { "@type": "Person", name: AUTHOR_NAME },
            hasPart: projects.map((project) => ({
              "@type": "CreativeWork",
              name: project.name,
              url: primarySiteUrl(
                `/portfolio/${encodeURIComponent(project.slug)}`,
              ),
              description: project.summary,
            })),
          },
          breadcrumbStructuredData([
            { name: "Home", url: primarySiteUrl("/") },
            { name: "Portfolio", url: primarySiteUrl("/portfolio") },
          ]),
        ]}
      />
      <header className="grid border-y border-row-border md:grid-cols-12">
        <div className="py-7 md:col-span-5 md:py-9 md:pr-8">
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <span className="size-2 bg-[var(--accent-magenta)]" />
            Selected work
          </p>
          <h1 className="mt-5 text-5xl font-bold leading-none tracking-[-0.055em] sm:text-6xl">
            {page?.heroHeading ?? "Portfolio"}
          </h1>
        </div>

        <div className="flex flex-col justify-between border-t border-row-border py-7 md:col-span-7 md:border-l md:border-t-0 md:py-9 md:pl-8">
          <p className="max-w-3xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
            {page?.heroBody ??
              "A working record of systems built, contributed to, and shipped."}
          </p>
          <a
            href={githubMetrics.profile.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring mt-6 inline-flex w-fit items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] hover:text-primary"
          >
            GitHub / {githubMetrics.profile.login}
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </a>
        </div>
      </header>

      <GithubMetricStrip metrics={githubMetrics} />

      <section className="pt-9 md:pt-12">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Work index
            </p>
            <h2 className="mt-1.5 text-2xl font-semibold tracking-tight">
              Projects
            </h2>
          </div>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            {String(projects.length).padStart(2, "0")} total
          </p>
        </div>

        <div className="grid border-l border-t border-row-border md:grid-cols-2">
          {projects.map((project) => (
            <ProjectCard
              key={project.slug}
              metric={metricForProject(project, githubMetrics)}
              project={project}
            />
          ))}
        </div>
      </section>

      {page?.body ? (
        <details className="group mt-10 border-y border-row-border">
          <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-mono text-[10px] uppercase tracking-[0.12em] marker:content-none">
            Portfolio notes
            <Plus
              aria-hidden="true"
              className="size-3.5 transition-transform group-open:rotate-45"
            />
          </summary>
          <div className="border-t border-row-border py-7">
            <MarkdownContent
              className="markdown-compact max-w-3xl"
              content={page.body}
            />
          </div>
        </details>
      ) : null}
    </article>
  );
}

function GithubMetricStrip({ metrics }: { metrics: GithubPortfolioMetrics }) {
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
    <section aria-label="GitHub activity snapshot">
      <div className="grid grid-cols-2 border-b border-row-border md:grid-cols-4">
        {metricItems.map((item, index) => (
          <div
            key={item.label}
            className={`min-w-0 py-4 ${
              index % 2 === 0 ? "border-r border-row-border" : ""
            } ${index < 2 ? "border-b border-row-border md:border-b-0" : ""} ${
              index < 3 ? "md:border-r md:border-row-border" : ""
            } ${index > 0 ? "md:pl-5" : ""} ${index < 3 ? "md:pr-5" : ""}`}
          >
            <p className="text-2xl font-semibold leading-none tracking-tight">
              {item.value}
            </p>
            <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              {item.label}
            </p>
          </div>
        ))}
      </div>
      {updatedLabel ? (
        <p className="pt-2 text-right font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
          GitHub snapshot / {updatedLabel}
        </p>
      ) : null}
    </section>
  );
}

function ProjectCard({
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
      className="focus-ring group relative grid gap-4 border-b border-r border-row-border p-4 transition-colors hover:bg-muted/35 sm:grid-cols-[4rem_minmax(0,1fr)] md:p-5"
    >
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 h-1 w-10 ${projectAccentClass(
          project.order,
        )}`}
      />

      <PortfolioProjectMark
        name={project.name}
        imageUrl={project.imageUrl ?? metric?.avatarUrl}
        imageAlt={project.imageAlt}
        order={project.order}
      />

      <div className="min-w-0">
        <div className="flex items-start justify-between gap-4">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
            {String(project.order).padStart(2, "0")} / {project.type}
          </p>
          <ArrowUpRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
          />
        </div>

        <h3 className="mt-3 text-2xl font-semibold leading-none tracking-[-0.035em] group-hover:text-primary">
          {project.name}
        </h3>
        <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">
          {project.summary}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-row-border pt-3">
          <span className="font-mono text-[9px] uppercase tracking-[0.1em]">
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

function projectAccentClass(order: number) {
  if (order % 3 === 0) {
    return "bg-[var(--accent-canary)]";
  }
  if (order % 2 === 0) {
    return "bg-[var(--accent-cyan)]";
  }
  return "bg-[var(--accent-magenta)]";
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
