/* eslint-disable @next/next/no-img-element */
import { MarkdownContent } from "@/components/markdown-content";
import { SiteShell } from "@/components/site-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  const [page, projects] = await Promise.all([
    getSitePage("portfolio"),
    getPortfolioProjects(),
  ]);
  const [featured, ...remainingProjects] = projects;

  return (
    <SiteShell>
      <article className="mx-auto max-w-7xl px-4 py-14 md:px-8 md:py-24">
        <section className="grid gap-8 border-y border-row-border py-6 md:grid-cols-12 md:items-end md:py-9">
          <aside className="font-mono text-[11px] uppercase text-muted-foreground md:col-span-3">
            Portfolio / selected work
          </aside>
          <div className="md:col-span-7">
            <h1 className="break-words text-5xl font-bold leading-[0.9] text-balance md:text-7xl lg:text-8xl">
              {page?.heroHeading ?? "Portfolio"}
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-muted-foreground md:text-xl">
              {page?.heroBody}
            </p>
          </div>
        </section>

        <section className="grid gap-8 py-10 md:grid-cols-12 md:py-14">
          <div className="font-mono text-[11px] uppercase text-muted-foreground md:col-span-3">
            Overview
          </div>
          <div className="md:col-span-7">
            <MarkdownContent content={page?.body ?? ""} />
          </div>
        </section>

        {featured ? <FeaturedProject project={featured} /> : null}

        <section className="pt-10 md:pt-14">
          <div className="mb-5 grid gap-3 md:grid-cols-12">
            <div className="font-mono text-[11px] uppercase text-muted-foreground md:col-span-3">
              Index
            </div>
            <h2 className="text-3xl font-semibold md:col-span-9 md:text-5xl">
              Contributions and projects
            </h2>
          </div>
          <div>
            {remainingProjects.map((project) => (
              <ProjectRow key={project.slug} project={project} />
            ))}
            {remainingProjects.length === 0 && featured ? (
              <ProjectRow project={featured} />
            ) : null}
          </div>
        </section>
      </article>
    </SiteShell>
  );
}

function FeaturedProject({ project }: { project: PortfolioProjectRecord }) {
  const imageUrl = safeImageUrl(project.imageUrl);
  return (
    <section className="grid gap-8 border-y border-row-border py-8 md:grid-cols-12 md:items-center md:py-10">
      <div className="font-mono text-[11px] uppercase text-muted-foreground md:col-span-3">
        Featured / {project.type}
      </div>
      <div className="md:col-span-5">
        <h2 className="text-4xl font-bold leading-none text-balance md:text-6xl">
          {project.name}
        </h2>
        <p className="mt-4 text-lg leading-8 text-muted-foreground">
          {project.summary}
        </p>
        <ProjectLinks project={project} className="mt-6" />
      </div>
      <figure className="md:col-span-4">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={project.imageAlt ?? project.name}
            className="aspect-[16/10] w-full border border-row-border object-cover"
          />
        ) : (
          <ProjectPlaceholder name={project.name} />
        )}
      </figure>
    </section>
  );
}

function ProjectRow({ project }: { project: PortfolioProjectRecord }) {
  const imageUrl = safeImageUrl(project.imageUrl);
  return (
    <div className="grid gap-4 py-5 transition-colors hover:bg-muted/35 md:grid-cols-12 md:items-center md:gap-6">
      <div className="font-mono text-[11px] uppercase text-muted-foreground md:col-span-2">
        <div>{String(project.order).padStart(2, "0")}</div>
        <div className="mt-1">{project.timeframe}</div>
      </div>
      <div className="md:col-span-2">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={project.imageAlt ?? project.name}
            className="aspect-[16/10] w-full border border-row-border object-cover"
          />
        ) : (
          <ProjectPlaceholder name={project.name} compact />
        )}
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
        <Button key={href} asChild size="sm" variant="outline">
          <Link href={href} target="_blank" rel="noopener noreferrer">
            <Icon data-icon="inline-start" />
            {label}
          </Link>
        </Button>
      ))}
    </div>
  );
}

function ProjectPlaceholder({
  name,
  compact = false,
}: {
  name: string;
  compact?: boolean;
}) {
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
