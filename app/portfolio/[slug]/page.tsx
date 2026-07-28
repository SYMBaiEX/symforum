import { CommentsPanel } from "@/components/comments-panel";
import { PortfolioProjectMark } from "@/components/portfolio-project-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { safeExternalUrl } from "@/lib/safe-url";
import { getPortfolioProject, getPortfolioProjects } from "@/lib/site-content";
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
  // Static fallback projects do not exist as valid discussion targets in Convex.
  const commentsEnabled =
    Boolean(process.env.NEXT_PUBLIC_CONVEX_URL) && Boolean(project._id);

  return (
    <article className="page-frame page-frame-dense">
      <nav
        aria-label="Portfolio breadcrumb"
        className="mb-4 flex items-center justify-between gap-4 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
      >
        <Link
          href="/portfolio"
          prefetch
          className="focus-ring inline-flex items-center gap-2 hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          Work index
        </Link>
        <span>
          {String(projectIndex + 1).padStart(2, "0")} /{" "}
          {String(projects.length).padStart(2, "0")}
        </span>
      </nav>

      <header className="relative overflow-hidden border-y border-row-border">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.045] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:2.5rem_2.5rem]"
        />
        <div className="relative grid md:grid-cols-12">
          <div className="flex min-h-[24rem] flex-col justify-between px-1 py-7 md:col-span-8 md:min-h-[30rem] md:px-7 md:py-10">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 bg-[var(--accent-magenta)]" />
                Project dossier
              </span>
              <span>{project.type}</span>
            </div>

            <div className="pt-14">
              <h1 className="max-w-5xl break-words text-[clamp(3.4rem,9vw,8rem)] font-bold leading-[0.8] tracking-[-0.07em]">
                {project.name}
              </h1>
              <p className="mt-7 max-w-3xl text-lg leading-8 text-muted-foreground text-balance md:text-xl md:leading-9">
                {project.summary}
              </p>
            </div>
          </div>

          <aside className="flex flex-col justify-between border-t border-row-border bg-background/75 p-5 backdrop-blur-sm md:col-span-4 md:border-l md:border-t-0 md:p-7">
            <PortfolioProjectMark
              name={project.name}
              imageUrl={project.imageUrl}
              imageAlt={project.imageAlt}
              order={project.order}
              size="hero"
            />

            <div className="mt-10">
              <ProjectLinks project={project} />
              <dl className="mt-7 grid grid-cols-2 gap-x-5 gap-y-6 border-t border-row-border pt-5">
                <ProjectFact label="Role" value={project.role} />
                <ProjectFact label="Scope" value={project.timeframe} />
                {repoPath ? (
                  <div className="col-span-2 min-w-0">
                    <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                      Source
                    </dt>
                    <dd className="mt-2 truncate font-mono text-[10px] uppercase">
                      {repoPath}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </aside>
        </div>
      </header>

      {project.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-b border-row-border py-4">
          <span className="mr-2 self-center font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            Stack / focus
          </span>
          {project.tags.map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className="rounded-none font-mono text-[9px] uppercase tracking-[0.08em]"
            >
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}

      <section className="pt-12 md:pt-16">
        <div className="grid gap-4 md:grid-cols-12 md:items-end">
          <div className="md:col-span-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Case file
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
              From constraint to outcome.
            </h2>
          </div>
          <p className="text-sm leading-6 text-muted-foreground md:col-span-5 md:col-start-8 md:text-base md:leading-7">
            The useful story is the reasoning: what needed to change, how the
            system was shaped, and what the work made possible.
          </p>
        </div>

        <div className="mt-7 border-l border-t border-row-border">
          <ProjectDetail index="01" label="Problem" value={project.problem} />
          <ProjectDetail index="02" label="Approach" value={project.approach} />
          <ProjectDetail index="03" label="Outcome" value={project.outcome} />
        </div>
      </section>

      <ProjectPager previous={previousProject} next={nextProject} />

      {commentsEnabled ? (
        <section className="mt-12 border-t border-row-border pt-7 md:mt-16">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Discussion
              </p>
              <h2 className="mt-2 text-2xl font-semibold">Project thread</h2>
            </div>
          </div>
          <div className="max-w-3xl">
            <CommentsPanel
              entityType="portfolioProject"
              entityId={project.slug}
              enabled
            />
          </div>
        </section>
      ) : null}
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
      className="mt-12 grid border-l border-t border-row-border md:mt-16 md:grid-cols-2"
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
      prefetch
      className={`focus-ring group flex min-h-28 items-center gap-4 border-b border-r border-row-border p-5 transition-colors hover:bg-muted/40 ${
        isPrevious ? "justify-start" : "justify-end text-right"
      }`}
    >
      {isPrevious ? (
        <ArrowLeft
          aria-hidden="true"
          className="size-5 transition-transform group-hover:-translate-x-1"
        />
      ) : null}
      <span className="min-w-0">
        <span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          {isPrevious ? "Previous dossier" : "Next dossier"}
        </span>
        <span className="mt-2 block truncate text-lg font-semibold group-hover:text-primary">
          {label}
        </span>
      </span>
      {!isPrevious ? (
        <ArrowRight
          aria-hidden="true"
          className="size-5 transition-transform group-hover:translate-x-1"
        />
      ) : null}
    </Link>
  );
}

function ProjectDetail({
  index,
  label,
  value,
}: {
  index: string;
  label: string;
  value: string;
}) {
  return (
    <div className="grid border-b border-r border-row-border md:grid-cols-[8rem_minmax(0,1fr)]">
      <div className="border-b border-row-border p-4 md:border-b-0 md:border-r md:p-5">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
          {index}
        </p>
        <h3 className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em]">
          {label}
        </h3>
      </div>
      <p className="max-w-4xl p-4 text-base leading-7 md:p-6 md:text-lg md:leading-8">
        {value}
      </p>
    </div>
  );
}

function ProjectFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-2 text-sm leading-6">{value}</dd>
    </div>
  );
}

function ProjectLinks({ project }: { project: PortfolioProjectRecord }) {
  const links = [
    {
      href: safeExternalUrl(project.homepageUrl),
      label: "Live site",
      Icon: ExternalLink,
    },
    {
      href: safeExternalUrl(project.repoUrl),
      label: "Repository",
      Icon: Github,
    },
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
    <div className="flex flex-wrap gap-1.5">
      {links.map(({ href, label, Icon }) => (
        <Button
          key={`${label}-${href}`}
          asChild
          size="sm"
          variant="outline"
          className="rounded-none"
        >
          <a href={href} target="_blank" rel="noopener noreferrer">
            <Icon data-icon="inline-start" />
            {label}
          </a>
        </Button>
      ))}
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
