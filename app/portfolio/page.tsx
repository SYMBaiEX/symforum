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
import { ArrowUpRight, ExternalLink, Github } from "lucide-react";
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
      <p className="mx-auto mt-4 max-w-2xl text-center text-xs leading-5 text-muted-foreground">
        {primaryMetric.detail}
      </p>
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
  const repoLabel = metric
    ? [
        metric.fullName,
        metric.prsAuthored ? `${metric.prsAuthored} PRs` : null,
        metric.stars !== undefined ? `${formatCount(metric.stars)} stars` : null,
      ]
        .filter(Boolean)
        .join(" / ")
    : repoPathLabel(project.repoUrl) ?? project.type;

  return (
    <article
      className="group grid gap-2 py-2 transition-colors hover:bg-muted/25 sm:grid-cols-[2.25rem_minmax(0,1fr)] sm:items-center sm:gap-3 md:grid-cols-[2.25rem_minmax(9rem,0.72fr)_minmax(0,1.45fr)_minmax(12rem,0.8fr)_auto] md:px-2"
      data-portfolio-project-row
    >
      <div className="flex items-center justify-between gap-3 sm:block">
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
          href={`/portfolio/${project.slug}`}
          className="focus-ring inline-flex max-w-full text-base font-semibold leading-tight hover:text-primary md:text-lg"
        >
          <span className="truncate">{project.name}</span>
        </Link>
        <p className="mt-1 truncate font-mono text-[10px] uppercase text-muted-foreground">
          {project.type} / {project.timeframe}
        </p>
      </div>
      <p className="min-w-0 text-sm leading-5 text-muted-foreground md:line-clamp-2">
        {project.summary}
      </p>
      <div className="min-w-0 font-mono text-[10px] uppercase text-muted-foreground">
        <p className="truncate">{project.role}</p>
        <p className="mt-1 truncate">{repoLabel}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
        <Button asChild size="sm" variant="outline">
          <Link href={`/portfolio/${project.slug}`}>
            Details
            <ArrowUpRight data-icon="inline-end" />
          </Link>
        </Button>
        <div className="hidden lg:block">
          <ProjectLinks project={project} />
        </div>
      </div>
    </article>
  );
}

function ProjectLinks({
  project,
  className,
}: {
  project: PortfolioProjectRecord;
  className?: string;
}) {
  const links = [
    {
      href: safeExternalUrl(project.homepageUrl),
      label: "Site",
      Icon: ExternalLink,
    },
    { href: safeExternalUrl(project.repoUrl), label: "Repo", Icon: Github },
    {
      href: safeExternalUrl(project.writeupUrl),
      label: "Writeup",
      Icon: ArrowUpRight,
    },
  ].filter(
    (link): link is { href: string; label: string; Icon: typeof Github } =>
      Boolean(link.href),
  );

  if (links.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ""}`}>
      {links.map(({ href, label, Icon }) => (
        <Button key={`${label}-${href}`} asChild size="sm" variant="outline">
          <Link href={href} target="_blank" rel="noopener noreferrer">
            <Icon data-icon="inline-start" />
            {label}
          </Link>
        </Button>
      ))}
    </div>
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
  const key =
    slug === "playhyperia"
      ? "hyperia"
      : slug === "elizaos" ||
          slug === "babylon" ||
          slug === "opencontroller" ||
          slug === "hyperia"
        ? slug
        : null;
  return key
    ? (metrics.projects.find((metric) => metric.key === key) ?? null)
    : null;
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
