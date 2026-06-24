/* eslint-disable @next/next/no-img-element */
import { MarkdownContent } from "@/components/markdown-content";
import { SiteShell } from "@/components/site-shell";
import { Badge } from "@/components/ui/badge";
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
  const [featured, ...remainingProjects] = projects;

  return (
    <SiteShell>
      <article className="mx-auto max-w-7xl px-4 py-9 md:px-8 md:py-14">
        <section className="grid gap-6 md:grid-cols-12 md:items-end md:gap-8">
          <aside className="font-mono text-[11px] uppercase text-muted-foreground md:col-span-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 md:block">
              <span>Portfolio / selected work</span>
            </div>
          </aside>
          <div className="md:col-span-7">
            <h1 className="break-words text-4xl font-bold leading-[0.92] text-balance sm:text-5xl md:text-7xl lg:text-8xl">
              {page?.heroHeading ?? "Portfolio"}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground md:mt-6 md:text-lg md:leading-8">
              {page?.heroBody}
            </p>
          </div>
        </section>

        <GithubMetricStrip metrics={githubMetrics} />

        <section className="grid gap-6 py-8 md:grid-cols-12 md:gap-8 md:py-12">
          <div className="font-mono text-[11px] uppercase text-muted-foreground md:col-span-3">
            Overview
          </div>
          <div className="md:col-span-7">
            <MarkdownContent content={page?.body ?? ""} />
          </div>
        </section>

        {featured ? (
          <FeaturedProject
            project={featured}
            metric={metricForProject(featured, githubMetrics)}
          />
        ) : null}

        <section className="pt-8 md:pt-12">
          <div className="mb-4 grid gap-2 md:mb-5 md:grid-cols-12 md:gap-3">
            <div className="font-mono text-[11px] uppercase text-muted-foreground md:col-span-3">
              Index
            </div>
            <h2 className="text-3xl font-semibold md:col-span-9 md:text-5xl">
              Contributions and projects
            </h2>
          </div>
          <div>
            {remainingProjects.map((project) => (
              <ProjectRow
                key={project.slug}
                project={project}
                metric={metricForProject(project, githubMetrics)}
              />
            ))}
            {remainingProjects.length === 0 && featured ? (
              <ProjectRow
                project={featured}
                metric={metricForProject(featured, githubMetrics)}
              />
            ) : null}
          </div>
        </section>
      </article>
    </SiteShell>
  );
}

function GithubMetricStrip({ metrics }: { metrics: GithubPortfolioMetrics }) {
  const metricItems = [
    {
      label: "Indexed commits",
      value: formatCount(metrics.totals.indexedCommits),
    },
    { label: "Authored PRs", value: formatCount(metrics.totals.authoredPrs) },
    { label: "Public repos", value: formatCount(metrics.totals.publicRepos) },
    { label: "Non-forks", value: formatCount(metrics.totals.nonForkRepos) },
    { label: "Followers", value: formatCount(metrics.totals.followers) },
  ];

  return (
    <section className="grid gap-4 py-7 md:grid-cols-12 md:gap-8 md:py-9">
      <div className="font-mono text-[11px] uppercase text-muted-foreground md:col-span-3">
        Live GitHub / {metrics.profile.login}
      </div>
      <div className="grid gap-3 sm:grid-cols-3 md:col-span-9 lg:grid-cols-5">
        {metricItems.map((item) => (
          <div key={item.label} className="min-w-0">
            <div className="text-3xl font-semibold leading-none md:text-4xl">
              {item.value}
            </div>
            <div className="mt-2 font-mono text-[11px] uppercase text-muted-foreground">
              {item.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeaturedProject({
  project,
  metric,
}: {
  project: PortfolioProjectRecord;
  metric: GithubPortfolioProjectMetric | null;
}) {
  const imageUrl = safeImageUrl(project.imageUrl);
  return (
    <section className="grid gap-6 py-8 md:grid-cols-12 md:items-center md:gap-8 md:py-10">
      <div className="font-mono text-[11px] uppercase text-muted-foreground md:col-span-3">
        Featured / {project.type}
      </div>
      <div className="md:col-span-5">
        <h2 className="text-3xl font-bold leading-none text-balance sm:text-4xl md:text-6xl">
          {project.name}
        </h2>
        <p className="mt-3 text-base leading-7 text-muted-foreground md:mt-4 md:text-lg md:leading-8">
          {project.summary}
        </p>
        <ProjectLinks project={project} className="mt-5 md:mt-6" />
      </div>
      <figure className="md:col-span-4">
        <ProjectVisual
          name={project.name}
          imageUrl={imageUrl ?? metric?.avatarUrl}
          imageAlt={project.imageAlt ?? `${project.name} project asset`}
        />
        {metric ? (
          <figcaption className="mt-2 font-mono text-[11px] uppercase text-muted-foreground">
            {metric.fullName}
            {metric.prsAuthored ? ` / ${metric.prsAuthored} PRs` : ""}
            {metric.stars !== undefined
              ? ` / ${formatCount(metric.stars)} stars`
              : ""}
          </figcaption>
        ) : null}
      </figure>
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
  const imageUrl = safeImageUrl(project.imageUrl);
  return (
    <div className="grid gap-3 py-4 transition-colors hover:bg-muted/35 md:grid-cols-12 md:items-center md:gap-6 md:py-5">
      <div className="font-mono text-[11px] uppercase text-muted-foreground md:col-span-2">
        <div>{String(project.order).padStart(2, "0")}</div>
        <div className="mt-1">{project.timeframe}</div>
      </div>
      <div className="md:col-span-2">
        <ProjectVisual
          name={project.name}
          imageUrl={imageUrl ?? metric?.avatarUrl}
          imageAlt={project.imageAlt ?? `${project.name} project asset`}
          compact
        />
      </div>
      <div className="min-w-0 md:col-span-5">
        <h3 className="text-2xl font-semibold leading-tight text-balance">
          {project.name}
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground md:text-base">
          {project.summary}
        </p>
        <p className="mt-3 font-mono text-[11px] uppercase text-muted-foreground">
          {project.role}
        </p>
        {metric ? (
          <p className="mt-1 font-mono text-[11px] uppercase text-muted-foreground">
            {metric.fullName}
            {metric.prsAuthored ? ` / ${metric.prsAuthored} PRs` : ""}
            {metric.stars !== undefined
              ? ` / ${formatCount(metric.stars)} stars`
              : ""}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 md:col-span-3 md:items-end">
        <div className="flex flex-wrap gap-1 md:justify-end">
          {project.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
        <ProjectLinks project={project} />
      </div>
    </div>
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
    <div className={`flex flex-wrap gap-2 ${className ?? ""}`}>
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

function ProjectVisual({
  name,
  imageUrl,
  imageAlt,
  compact = false,
}: {
  name: string;
  imageUrl?: string;
  imageAlt?: string;
  compact?: boolean;
}) {
  if (imageUrl) {
    return (
      <div
        className={`grid place-items-center border border-row-border bg-card/50 ${
          compact ? "aspect-[16/10]" : "aspect-[16/10]"
        }`}
      >
        <img
          src={imageUrl}
          alt={imageAlt ?? name}
          className="size-[58%] object-contain"
        />
      </div>
    );
  }

  return (
    <div
      aria-label={`${name} visual placeholder`}
      className={`grid border border-row-border bg-muted/40 font-mono text-[11px] uppercase text-muted-foreground ${
        compact ? "aspect-[16/10]" : "aspect-[16/10]"
      }`}
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
