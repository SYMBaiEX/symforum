/* eslint-disable @next/next/no-img-element */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { safeExternalUrl, safeImageUrl } from "@/lib/safe-url";
import {
  getPortfolioProject,
  getPortfolioProjects,
} from "@/lib/site-content";
import type { PortfolioProjectRecord } from "@/lib/site-content-defaults";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ExternalLink,
  Github,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  const projects = await getPortfolioProjects();
  return projects.map((project) => ({ slug: project.slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const project = await getPortfolioProject(slug);
  return {
    title: project?.name ?? "Project",
    description: project?.summary ?? "Portfolio project",
  };
}

export default async function PortfolioProjectPage({ params }: PageProps) {
  const { slug } = await params;
  const projects = await getPortfolioProjects();
  const projectIndex = projects.findIndex((item) => item.slug === slug);
  if (projectIndex === -1) {
    notFound();
  }
  const project = projects[projectIndex];
  const previousProject =
    projects.length > 1
      ? projects[(projectIndex - 1 + projects.length) % projects.length]
      : null;
  const nextProject =
    projects.length > 1 ? projects[(projectIndex + 1) % projects.length] : null;
  const repoPath = repoPathLabel(project.repoUrl);

  return (
    <article className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_16rem] md:gap-12">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase text-muted-foreground">
            <Link href="/portfolio" className="focus-ring hover:text-foreground">
              Portfolio
            </Link>
            <span>/</span>
            <span>
              {String(projectIndex + 1).padStart(2, "0")} of{" "}
              {String(projects.length).padStart(2, "0")}
            </span>
          </div>

          <p className="mt-7 font-mono text-[11px] uppercase text-muted-foreground">
            {project.type}
          </p>
          <h1 className="mt-2 max-w-4xl break-words text-4xl font-bold leading-none text-balance md:text-5xl">
            {project.name}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
            {project.summary}
          </p>

          <ProjectLinks className="mt-5" project={project} />

          <section className="mt-9 grid gap-6 md:grid-cols-3">
            <ProjectDetail label="Problem" value={project.problem} />
            <ProjectDetail label="Approach" value={project.approach} />
            <ProjectDetail label="Outcome" value={project.outcome} />
          </section>

          <ProjectPager previous={previousProject} next={nextProject} />
        </div>

        <aside className="md:pt-16">
          <ProjectMark
            name={project.name}
            imageUrl={safeImageUrl(project.imageUrl)}
            imageAlt={project.imageAlt}
          />
          <dl className="mt-5 grid gap-4 font-mono text-[11px] uppercase">
            <div>
              <dt className="text-muted-foreground">Role</dt>
              <dd className="mt-1 text-foreground">{project.role}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Window</dt>
              <dd className="mt-1 text-foreground">{project.timeframe}</dd>
            </div>
            {repoPath ? (
              <div>
                <dt className="text-muted-foreground">Source</dt>
                <dd className="mt-1 truncate text-foreground">
                  {repoPath}
                </dd>
              </div>
            ) : null}
            {project.tags.length > 0 ? (
              <div>
                <dt className="text-muted-foreground">Tags</dt>
                <dd className="mt-2 flex flex-wrap gap-1">
                  {project.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
        </aside>
      </div>
    </article>
  );
}

function ProjectPager({
  previous,
  next,
}: {
  previous: PortfolioProjectRecord | null;
  next: PortfolioProjectRecord | null;
}) {
  if (!previous && !next) {
    return null;
  }

  return (
    <nav
      aria-label="Project navigation"
      className="mt-10 grid gap-2 md:grid-cols-2"
    >
      {previous ? (
        <ProjectPagerLink
          direction="previous"
          href={`/portfolio/${previous.slug}`}
          label={previous.name}
        />
      ) : null}
      {next ? (
        <ProjectPagerLink
          direction="next"
          href={`/portfolio/${next.slug}`}
          label={next.name}
        />
      ) : null}
    </nav>
  );
}

function ProjectPagerLink({
  direction,
  href,
  label,
}: {
  direction: "previous" | "next";
  href: string;
  label: string;
}) {
  const isPrevious = direction === "previous";

  return (
    <Link
      href={href}
      className={`focus-ring group flex items-center gap-3 py-3 transition-colors hover:bg-muted/25 ${
        isPrevious ? "justify-start" : "justify-end text-right"
      }`}
    >
      {isPrevious ? <ArrowLeft aria-hidden="true" /> : null}
      <span className="min-w-0">
        <span className="block font-mono text-[10px] uppercase text-muted-foreground">
          {isPrevious ? "Previous" : "Next"}
        </span>
        <span className="block truncate text-sm font-semibold group-hover:text-primary">
          {label}
        </span>
      </span>
      {!isPrevious ? <ArrowRight aria-hidden="true" /> : null}
    </Link>
  );
}

function ProjectDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <h2 className="font-mono text-[11px] uppercase text-muted-foreground">
        {label}
      </h2>
      <p className="mt-2 text-sm leading-6">{value}</p>
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
      <div className="grid size-20 place-items-center">
        <img
          src={imageUrl}
          alt={imageAlt ?? name}
          className="size-16 object-contain"
        />
      </div>
    );
  }

  return (
    <div
      aria-label={`${name} visual placeholder`}
      className="grid size-20 font-mono text-[11px] uppercase text-muted-foreground"
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

function repoPathLabel(value: string | undefined) {
  const safeUrl = safeExternalUrl(value);
  if (!safeUrl) {
    return null;
  }

  return new URL(safeUrl).pathname.replace(/^\//, "");
}
