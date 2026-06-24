/* eslint-disable @next/next/no-img-element */
import { MarkdownContent } from "@/components/markdown-content";
import { Button } from "@/components/ui/button";
import {
  getGithubPortfolioMetrics,
  type GithubPortfolioMetrics,
  type GithubPortfolioProjectMetric,
} from "@/lib/github-portfolio";
import { safeExternalUrl, safeImageUrl } from "@/lib/safe-url";
import { getPortfolioProjects, getSitePage } from "@/lib/site-content";
import type { PortfolioProjectRecord } from "@/lib/site-content-defaults";
import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getSitePage("portfolio");
  return {
    title: page?.title ?? "Portfolio",
    description: page?.heroBody,
  };
}

export default async function PortfolioPage() {
  const [page, projects, githubMetrics] = await Promise.all([
    getSitePage("portfolio"),
    getPortfolioProjects(),
    getGithubPortfolioMetrics(),
  ]);

  return (
    <>
      <article className="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-12">
        <section>
          <div className="max-w-3xl">
            <h1 className="break-words text-3xl font-bold leading-[0.96] text-balance sm:text-4xl md:text-5xl">
              {page?.heroHeading ?? "Portfolio"}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
              {page?.heroBody}
            </p>
            <div className="mt-5">
              <MarkdownContent
                className="markdown-compact"
                content={page?.body ?? ""}
              />
            </div>
          </div>
          <GithubMetricStrip metrics={githubMetrics} />
        </section>

        <section className="pt-6 md:pt-8">
          <div className="grid gap-1.5">
            {projects.map((project) => (
              <ProjectListRow
                key={project.slug}
                project={project}
                metric={metricForProject(project, githubMetrics)}
              />
            ))}
          </div>
        </section>
      </article>
    </>
  );
}

function GithubMetricStrip({ metrics }: { metrics: GithubPortfolioMetrics }) {
  const primaryMetric =
    metrics.commitMetric.includesPrivate || !metrics.contributionActivity
      ? metrics.commitMetric
      : metrics.contributionActivity;
  const metricItems = [
    {
      detail:
        primaryMetric === metrics.contributionActivity
          ? "Live visible GitHub contribution graph."
          : metrics.commitMetric.detail,
      label: primaryMetric.label,
      value: formatCount(primaryMetric.value),
    },
    { label: "Authored PRs", value: formatCount(metrics.totals.authoredPrs) },
    { label: "Public repos", value: formatCount(metrics.totals.publicRepos) },
    { label: "Followers", value: formatCount(metrics.totals.followers) },
  ];

  return (
    <section className="mx-auto mt-8 max-w-4xl md:mt-10">
      <div className="grid grid-cols-4 gap-2 text-center md:gap-4">
        {metricItems.map((item) => (
          <div key={item.label} className="min-w-0" data-portfolio-metric>
            <div className="text-xl font-semibold leading-none md:text-2xl">
              {item.value}
            </div>
            <div className="mt-2 font-mono text-[11px] uppercase text-muted-foreground">
              {item.label}
            </div>
          </div>
        ))}
      </div>
      {primaryMetric.detail ? (
        <p className="mx-auto mt-4 max-w-2xl text-center text-xs leading-5 text-muted-foreground">
          {primaryMetric.detail}
        </p>
      ) : null}
    </section>
  );
}

function ProjectListRow({
  project,
  metric,
}: {
  project: PortfolioProjectRecord;
  metric: GithubPortfolioProjectMetric | null;
}) {
  const imageUrl = safeImageUrl(project.imageUrl);
  const projectHref = `/portfolio/${project.slug}`;
  const repoLabel = projectMetricLabel(project, metric);

  return (
    <article
      className="group grid gap-2 py-1 transition-colors hover:bg-muted/25 sm:grid-cols-[2rem_minmax(0,1fr)] sm:items-center sm:gap-3 md:grid-cols-[2rem_minmax(8rem,0.65fr)_minmax(0,1.65fr)_minmax(10rem,0.7fr)_2rem] md:px-2"
      data-portfolio-project-row
    >
      <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-start sm:gap-1">
        <div className="font-mono text-[10px] uppercase text-muted-foreground">
          {String(project.order).padStart(2, "0")}
        </div>
        <ProjectMark
          name={project.name}
          imageUrl={imageUrl ?? metric?.avatarUrl}
          imageAlt={project.imageAlt ?? `${project.name} project asset`}
        />
      </div>
      <div className="min-w-0">
        <Link
          href={projectHref}
          className="focus-ring inline-flex max-w-full text-[0.95rem] font-semibold leading-tight hover:text-primary md:text-base"
        >
          <span className="truncate">{project.name}</span>
        </Link>
        <p className="mt-1 truncate font-mono text-[10px] uppercase text-muted-foreground">
          {project.type} / {project.timeframe}
        </p>
      </div>
      <p className="min-w-0 text-[0.8125rem] leading-5 text-muted-foreground md:line-clamp-1">
        {project.summary}
      </p>
      <div className="min-w-0 font-mono text-[10px] uppercase text-muted-foreground">
        <p className="truncate">{project.role}</p>
        <p className="mt-1 truncate">{repoLabel}</p>
      </div>
      <div className="flex items-center justify-end">
        <Button
          asChild
          className="size-6 rounded-none border-row-border bg-transparent p-0 text-muted-foreground shadow-none group-hover:border-foreground group-hover:text-foreground"
          size="icon"
          variant="outline"
        >
          <Link href={projectHref} aria-label={`Open ${project.name}`}>
            <ArrowUpRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </article>
  );
}

function ProjectMark({
  name,
  imageUrl,
  imageAlt,
}: {
  name: string;
  imageUrl?: string;
  imageAlt?: string;
}) {
  if (imageUrl) {
    return (
      <div className="grid size-8 shrink-0 place-items-center">
        <img
          src={imageUrl}
          alt={imageAlt ?? name}
          className="size-6 object-contain"
        />
      </div>
    );
  }

  return (
    <div
      aria-label={`${name} visual placeholder`}
      className="grid size-8 shrink-0 font-mono text-[11px] uppercase text-muted-foreground"
    >
      <div className="grid h-full grid-cols-4">
        <span className="bg-[var(--accent-magenta)]" />
        <span className="bg-foreground" />
        <span className="bg-[var(--accent-cyan)]" />
        <span className="bg-[var(--accent-canary)]" />
      </div>
    </div>
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

function projectMetricLabel(
  project: PortfolioProjectRecord,
  metric: GithubPortfolioProjectMetric | null,
) {
  const parts = metric
    ? [
        metric.fullName,
        metric.language,
        metric.prsAuthored ? `${metric.prsAuthored} PRs` : null,
        metric.stars !== undefined ? `${formatCount(metric.stars)} stars` : null,
        metric.forks ? `${formatCount(metric.forks)} forks` : null,
      ]
    : [repoPathLabel(project.repoUrl) ?? project.type];

  return parts.filter(Boolean).join(" / ");
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
