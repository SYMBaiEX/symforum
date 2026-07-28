import { MarkdownContent } from "@/components/markdown-content";
import { PortfolioProjectMark } from "@/components/portfolio-project-mark";
import {
  type GithubPortfolioMetrics,
  type GithubPortfolioProjectMetric,
} from "@/lib/github-portfolio";
import { getCachedGithubPortfolioMetrics } from "@/lib/portfolio-metrics";
import { safeExternalUrl } from "@/lib/safe-url";
import { getPortfolioProjects, getSitePage } from "@/lib/site-content";
import type { PortfolioProjectRecord } from "@/lib/site-content-defaults";
import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight, Plus } from "lucide-react";
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";

export const revalidate = 300;

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
    getCachedGithubPortfolioMetrics(),
  ]);

  return (
    <article className="page-frame page-frame-dense">
      <header className="relative overflow-hidden border-y border-row-border">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.055] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:2.5rem_2.5rem]"
        />
        <div className="relative grid md:grid-cols-12">
          <div className="flex min-h-[19rem] flex-col justify-between px-1 py-7 sm:min-h-[23rem] md:col-span-7 md:px-6 md:py-10 lg:col-span-8">
            <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span className="h-2 w-2 bg-[var(--accent-magenta)]" />
              Selected systems / public work
            </div>
            <h1 className="mt-10 break-words text-[clamp(3.8rem,12vw,9.5rem)] font-bold leading-[0.76] tracking-[-0.075em]">
              {page?.heroHeading ?? "Portfolio"}
            </h1>
            <p className="mt-7 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              AI systems · open source · protocols · product engineering
            </p>
          </div>

          <div className="flex flex-col justify-between border-t border-row-border bg-background/75 p-5 backdrop-blur-sm md:col-span-5 md:border-l md:border-t-0 md:p-7 lg:col-span-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Practice / 01
              </p>
              <p className="mt-5 max-w-xl text-lg leading-8 text-balance md:text-xl">
                {page?.heroBody ??
                  "A working record of systems built, contributed to, and shipped."}
              </p>
            </div>
            <a
              href={githubMetrics.profile.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring mt-8 inline-flex items-center justify-between border-t border-row-border pt-4 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors hover:text-primary"
            >
              GitHub / {githubMetrics.profile.login}
              <ArrowUpRight aria-hidden="true" className="size-4" />
            </a>
          </div>
        </div>
      </header>

      <GithubMetricStrip metrics={githubMetrics} />

      <section className="pt-12 md:pt-16">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Work index
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
              Selected systems
            </h2>
          </div>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            {String(projects.length).padStart(2, "0")} entries
          </p>
        </div>

        <div className="grid border-l border-t border-row-border md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project, index) => (
            <ProjectCard
              featured={index === 0}
              key={project.slug}
              metric={metricForProject(project, githubMetrics)}
              project={project}
            />
          ))}
        </div>
      </section>

      {page?.body ? (
        <details className="group mt-12 border-y border-row-border md:mt-16">
          <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-4 py-5 font-mono text-[11px] uppercase tracking-[0.14em] marker:content-none">
            Read the portfolio notes
            <Plus
              aria-hidden="true"
              className="size-4 transition-transform duration-300 group-open:rotate-45"
            />
          </summary>
          <div className="grid border-t border-row-border py-7 md:grid-cols-12 md:py-10">
            <div className="md:col-span-8 md:col-start-3">
              <MarkdownContent
                className="markdown-compact"
                content={page.body}
              />
            </div>
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
      accent: "var(--accent-magenta)",
    },
    {
      label: "Authored PRs",
      value: formatCount(metrics.totals.authoredPrs),
      accent: "var(--accent-cyan)",
    },
    {
      label: "Public repos",
      value: formatCount(metrics.totals.publicRepos),
      accent: "var(--accent-canary)",
    },
    {
      label: "Followers",
      value: formatCount(metrics.totals.followers),
      accent: "currentColor",
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
      aria-label="GitHub activity snapshot"
      className="grid border-b border-row-border sm:grid-cols-2 md:grid-cols-[repeat(4,minmax(0,1fr))_minmax(13rem,1.35fr)]"
    >
      {metricItems.map((item) => (
        <div
          key={item.label}
          className="relative min-w-0 border-r border-row-border px-3 py-5 md:px-4"
        >
          <span
            aria-hidden="true"
            className="absolute left-0 top-0 h-1 w-10"
            style={{ backgroundColor: item.accent }}
          />
          <p className="text-2xl font-semibold leading-none tracking-tight md:text-3xl">
            {item.value}
          </p>
          <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground md:text-[10px]">
            {item.label}
          </p>
        </div>
      ))}
      <div className="col-span-2 flex min-w-0 flex-col justify-between gap-3 px-3 py-5 sm:col-span-2 md:col-span-1 md:px-4">
        <p className="font-mono text-[9px] uppercase leading-5 tracking-[0.12em] text-muted-foreground md:text-[10px]">
          {primaryMetric.detail}
        </p>
        {updatedLabel ? (
          <p className="font-mono text-[9px] uppercase tracking-[0.12em]">
            Snapshot / {updatedLabel}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ProjectCard({
  project,
  metric,
  featured,
}: {
  project: PortfolioProjectRecord;
  metric: GithubPortfolioProjectMetric | null;
  featured: boolean;
}) {
  const projectHref = `/portfolio/${project.slug}`;
  const accent = projectAccent(project.order);

  return (
    <Link
      href={projectHref}
      prefetch
      aria-label={`Open ${project.name} project`}
      className={cn(
        "focus-ring group relative flex min-h-[22rem] flex-col overflow-hidden border-b border-r border-row-border bg-background/35 p-5 transition-colors duration-300 hover:bg-muted/45 md:p-6",
        featured &&
          "min-h-[26rem] md:col-span-2 md:grid md:grid-cols-[minmax(0,1fr)_minmax(13rem,0.48fr)] md:gap-10 lg:col-span-2",
      )}
      style={{ "--project-accent": accent } as CSSProperties}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1 origin-left scale-x-[0.12] bg-[var(--project-accent)] transition-transform duration-500 group-hover:scale-x-100"
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {String(project.order).padStart(2, "0")} / {project.type}
          </p>
          <ArrowDownRight
            aria-hidden="true"
            className="size-5 shrink-0 transition-transform duration-300 group-hover:-rotate-45 group-hover:text-primary"
          />
        </div>

        <div className="mt-auto pt-12">
          <PortfolioProjectMark
            name={project.name}
            imageUrl={project.imageUrl ?? metric?.avatarUrl}
            imageAlt={project.imageAlt}
            order={project.order}
          />
          <h3
            className={cn(
              "mt-5 break-words text-3xl font-semibold leading-[0.92] tracking-[-0.04em] group-hover:text-primary",
              featured && "sm:text-4xl md:text-5xl",
            )}
          >
            {project.name}
          </h3>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base md:leading-7">
            {project.summary}
          </p>
        </div>
      </div>

      <div
        className={cn(
          "mt-8 hidden min-w-0 flex-col justify-end border-t border-row-border pt-4 sm:flex",
          featured && "md:mt-0 md:border-l md:border-t-0 md:pl-6 md:pt-0",
        )}
      >
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          Role
        </p>
        <p className="mt-2 text-sm leading-6">{project.role}</p>

        <p className="mt-6 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          Proof
        </p>
        <p className="mt-2 truncate font-mono text-[10px] uppercase leading-5">
          {projectProof(project, metric)}
        </p>

        <div className="mt-7 flex flex-wrap gap-1.5">
          {project.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="border border-row-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground"
            >
              {tag}
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

function projectAccent(order: number) {
  if (order % 3 === 0) {
    return "var(--accent-canary)";
  }
  if (order % 2 === 0) {
    return "var(--accent-cyan)";
  }
  return "var(--accent-magenta)";
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
