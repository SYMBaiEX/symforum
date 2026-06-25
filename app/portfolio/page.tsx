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

const PERSONAL_GITHUB_AVATAR_TOKEN = "/u/192078165";

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
      <article className="mx-auto max-w-7xl px-4 py-7 md:px-8 md:py-10">
        <section className="grid gap-7 md:grid-cols-[minmax(0,0.95fr)_minmax(20rem,0.55fr)] md:items-end">
          <div className="max-w-3xl">
            <h1 className="break-words text-3xl font-bold leading-[0.96] text-balance sm:text-4xl md:text-5xl">
              {page?.heroHeading ?? "Portfolio"}
            </h1>
            {page?.heroBody ? (
              <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
                {page.heroBody}
              </p>
            ) : null}
            <div className="mt-5">
              <MarkdownContent
                className="markdown-compact"
                content={page?.body ?? ""}
              />
            </div>
          </div>
          <GithubMetricStrip metrics={githubMetrics} />
        </section>

        <section className="pt-7 md:pt-9">
          <ProjectIndexHeader count={projects.length} />
          <div className="grid gap-0.5">
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
      label:
        primaryMetric === metrics.contributionActivity ? "Activity" : "Commits",
      value: formatCount(primaryMetric.value),
    },
    { label: "PRs", value: formatCount(metrics.totals.authoredPrs) },
    { label: "Repos", value: formatCount(metrics.totals.publicRepos) },
    { label: "Followers", value: formatCount(metrics.totals.followers) },
  ];

  return (
    <section className="w-full max-w-xl md:ml-auto">
      <div className="grid grid-cols-4 gap-2 md:gap-4">
        {metricItems.map((item) => (
          <div key={item.label} className="min-w-0" data-portfolio-metric>
            <div className="text-lg font-semibold leading-none sm:text-xl md:text-2xl">
              {item.value}
            </div>
            <div className="mt-2 truncate font-mono text-[10px] uppercase text-muted-foreground md:text-[11px]">
              {item.label}
            </div>
          </div>
        ))}
      </div>
      {primaryMetric.detail ? (
        <p className="mt-4 max-w-md font-mono text-[10px] uppercase leading-5 text-muted-foreground md:ml-auto md:text-right">
          {primaryMetric.detail}
        </p>
      ) : null}
    </section>
  );
}

function ProjectIndexHeader({ count }: { count: number }) {
  return (
    <div className="mb-2 grid gap-2 font-mono text-[10px] uppercase text-muted-foreground md:grid-cols-[minmax(11rem,0.78fr)_minmax(0,1.55fr)_minmax(11rem,0.72fr)_1.75rem] md:px-2">
      <div className="md:hidden">Work index / {count} projects</div>
      <div className="hidden md:block">Project</div>
      <div className="hidden md:block">Focus</div>
      <div className="hidden md:block md:text-right">Proof</div>
      <div className="hidden md:block" />
    </div>
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
      className="group relative grid grid-cols-[minmax(0,1fr)_1.75rem] gap-x-2 gap-y-1 py-2 transition-colors before:absolute before:bottom-1 before:left-0 before:top-1 before:w-px before:bg-transparent hover:bg-muted/25 hover:before:bg-[var(--accent-magenta)] md:grid-cols-[minmax(11rem,0.78fr)_minmax(0,1.55fr)_minmax(11rem,0.72fr)_1.75rem] md:items-center md:gap-2 md:px-2 md:py-1.5"
      data-portfolio-project-row
    >
      <div className="flex min-w-0 items-center gap-3">
        <ProjectMark
          name={project.name}
          imageUrl={imageUrl ?? metric?.avatarUrl}
          imageAlt={project.imageAlt ?? `${project.name} project asset`}
          order={project.order}
        />
        <Link
          href={projectHref}
          className="focus-ring inline-flex max-w-full text-[0.95rem] font-semibold leading-tight hover:text-primary md:text-base"
        >
          <span className="truncate">{project.name}</span>
        </Link>
      </div>
      <p className="col-span-2 min-w-0 line-clamp-2 text-[0.8125rem] leading-5 text-muted-foreground md:col-auto md:line-clamp-1">
        {project.summary}
      </p>
      <div className="hidden min-w-0 font-mono text-[10px] uppercase text-muted-foreground md:col-auto md:block md:text-right">
        <p className="truncate">{project.role}</p>
        <p className="mt-1 truncate">{repoLabel}</p>
      </div>
      <div className="col-start-2 row-start-1 flex items-center justify-end md:col-auto md:row-auto">
        <Button
          asChild
          className="size-7 rounded-none bg-transparent p-0 text-muted-foreground shadow-none hover:bg-muted/40 group-hover:text-foreground"
          size="icon"
          variant="ghost"
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
  order,
}: {
  name: string;
  imageUrl?: string;
  imageAlt?: string;
  order: number;
}) {
  if (imageUrl && !isPersonalProjectAvatar(imageUrl)) {
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
      aria-label={`${name} project mark`}
      className="relative grid size-8 shrink-0 place-items-center overflow-hidden bg-foreground font-mono text-[10px] font-semibold uppercase text-background"
    >
      <span className="relative z-10">{projectInitials(name)}</span>
      <span className="absolute inset-x-0 bottom-0 h-1 bg-[var(--accent-magenta)]" />
      <span
        className={`absolute right-0 top-0 h-full w-1 ${
          order % 3 === 0
            ? "bg-[var(--accent-canary)]"
            : order % 2 === 0
              ? "bg-[var(--accent-cyan)]"
              : "bg-[var(--accent-magenta)]"
        }`}
      />
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

function isPersonalProjectAvatar(value: string) {
  return value.includes(PERSONAL_GITHUB_AVATAR_TOKEN);
}

function projectInitials(name: string) {
  const compact = name.replace(/[^a-zA-Z0-9]/g, "");
  if (compact.length <= 2) {
    return compact.toUpperCase();
  }
  const capitals = compact.match(/[A-Z0-9]/g)?.join("");
  return (capitals && capitals.length >= 2 ? capitals : compact)
    .slice(0, 2)
    .toUpperCase();
}
