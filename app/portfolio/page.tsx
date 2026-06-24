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

  return (
    <SiteShell>
      <article className="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-12">
        <section className="grid gap-6 md:grid-cols-12 md:items-start md:gap-8">
          <div className="md:col-span-5">
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
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {projects.map((project) => (
              <ProjectSignalCard
                key={project.slug}
                project={project}
                metric={metricForProject(project, githubMetrics)}
              />
            ))}
          </div>
        </section>
      </article>
    </SiteShell>
  );
}

function GithubMetricStrip({ metrics }: { metrics: GithubPortfolioMetrics }) {
  const metricItems = [
    {
      detail: metrics.commitMetric.detail,
      label: metrics.commitMetric.label,
      value: formatCount(metrics.commitMetric.value),
    },
    metrics.contributionActivity
      ? {
          detail: metrics.contributionActivity.detail,
          label: metrics.contributionActivity.label,
          value: formatCount(metrics.contributionActivity.value),
        }
      : null,
    { label: "Authored PRs", value: formatCount(metrics.totals.authoredPrs) },
    { label: "Public repos", value: formatCount(metrics.totals.publicRepos) },
    { label: "Followers", value: formatCount(metrics.totals.followers) },
  ].filter(
    (item): item is { detail?: string; label: string; value: string } =>
      item !== null,
  );

  return (
    <section className="md:col-span-7">
      <div className="mb-3 flex items-center justify-between gap-3 font-mono text-[11px] uppercase text-muted-foreground">
        <span>Live GitHub / {metrics.profile.login}</span>
        <span>{new Date(metrics.updatedAt).toLocaleDateString("en")}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {metricItems.map((item) => (
          <div
            key={item.label}
            className="min-h-28 border border-row-border bg-card/45 p-3"
          >
            <div className="text-2xl font-semibold leading-none">
              {item.value}
            </div>
            <div className="mt-2 font-mono text-[11px] uppercase text-muted-foreground">
              {item.label}
            </div>
            {item.detail ? (
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                {item.detail}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function ProjectSignalCard({
  project,
  metric,
}: {
  project: PortfolioProjectRecord;
  metric: GithubPortfolioProjectMetric | null;
}) {
  const imageUrl = safeImageUrl(project.imageUrl);
  return (
    <article className="group flex min-h-[22rem] flex-col justify-between border border-row-border bg-card/35 p-4 transition-colors hover:bg-muted/35">
      <div>
        <div className="mb-5 flex items-start justify-between gap-3">
          <ProjectMark
            name={project.name}
            imageUrl={imageUrl ?? metric?.avatarUrl}
            imageAlt={project.imageAlt ?? `${project.name} project asset`}
          />
          <div className="text-right font-mono text-[11px] uppercase text-muted-foreground">
            <div>{String(project.order).padStart(2, "0")}</div>
            <div>{project.timeframe}</div>
          </div>
        </div>
        <h3 className="text-xl font-semibold leading-tight text-balance md:text-2xl">
          {project.name}
        </h3>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {project.summary}
        </p>
        {metric ? (
          <p className="mt-4 font-mono text-[11px] uppercase text-muted-foreground">
            {metric.fullName}
            {metric.prsAuthored ? ` / ${metric.prsAuthored} PRs` : ""}
            {metric.stars !== undefined
              ? ` / ${formatCount(metric.stars)} stars`
              : ""}
          </p>
        ) : null}
      </div>
      <div className="mt-5">
        <p className="mb-3 font-mono text-[11px] uppercase text-muted-foreground">
          {project.role}
        </p>
        <div className="mb-4 flex flex-wrap gap-1">
          {project.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
        <ProjectLinks project={project} />
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
      <div className="grid size-14 shrink-0 place-items-center border border-row-border bg-background/70">
        <img
          src={imageUrl}
          alt={imageAlt ?? name}
          className="size-8 object-contain"
        />
      </div>
    );
  }

  return (
    <div
      aria-label={`${name} visual placeholder`}
      className="grid size-14 shrink-0 border border-row-border bg-muted/40 font-mono text-[11px] uppercase text-muted-foreground"
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
