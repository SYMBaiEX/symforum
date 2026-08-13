import { CommentsPanel } from "@/components/comments-panel";
import { PortfolioProjectMark } from "@/components/portfolio-project-mark";
import { StructuredData } from "@/components/structured-data";
import { safeExternalUrl } from "@/lib/safe-url";
import { breadcrumbStructuredData } from "@/lib/seo";
import { primarySiteUrl } from "@/lib/site-urls";
import { asRoute } from "@/lib/typed-route";
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
  const canonical = project
    ? primarySiteUrl(`/portfolio/${encodeURIComponent(project.slug)}`)
    : primarySiteUrl(`/portfolio/${encodeURIComponent(slug)}`);
  return {
    title: project?.name ?? "Project",
    description: project?.summary ?? "Portfolio project",
    alternates: { canonical },
    robots: project ? undefined : { index: false, follow: false },
    openGraph: project
      ? {
          type: "article",
          url: canonical,
          title: project.name,
          description: project.summary,
        }
      : undefined,
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
      <StructuredData
        data={[
          {
            "@type": "CreativeWork",
            "@id": `${primarySiteUrl(`/portfolio/${encodeURIComponent(project.slug)}`)}#work`,
            name: project.name,
            description: project.summary,
            url: primarySiteUrl(
              `/portfolio/${encodeURIComponent(project.slug)}`,
            ),
            author: { "@id": `${primarySiteUrl("/about")}#austin-hamilton` },
            mainEntityOfPage: {
              "@id": primarySiteUrl(
                `/portfolio/${encodeURIComponent(project.slug)}`,
              ),
            },
            genre: project.type,
            keywords: project.tags,
            sameAs: [
              project.homepageUrl,
              project.repoUrl,
              project.writeupUrl,
            ].filter(Boolean),
          },
          breadcrumbStructuredData([
            { name: "Home", url: primarySiteUrl("/") },
            { name: "Portfolio", url: primarySiteUrl("/portfolio") },
            {
              name: project.name,
              url: primarySiteUrl(
                `/portfolio/${encodeURIComponent(project.slug)}`,
              ),
            },
          ]),
        ]}
      />
      <nav
        aria-label="Portfolio breadcrumb"
        className="mb-4 flex items-center justify-between gap-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
      >
        <Link
          href="/portfolio"
          prefetch
          className="focus-ring inline-flex items-center gap-2 hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          Portfolio
        </Link>
        <span>
          {String(projectIndex + 1).padStart(2, "0")} /{" "}
          {String(projects.length).padStart(2, "0")}
        </span>
      </nav>

      <header className="grid border-y border-row-border md:grid-cols-12">
        <div className="py-7 md:col-span-8 md:py-9 md:pr-8">
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <span className="size-2 bg-[var(--accent-magenta)]" />
            {project.type}
          </p>
          <h1 className="mt-5 max-w-4xl break-words text-5xl font-bold leading-none tracking-[-0.055em] sm:text-6xl">
            {project.name}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
            {project.summary}
          </p>
          <ProjectLinks className="mt-6" project={project} />
        </div>

        <aside className="border-t border-row-border py-7 md:col-span-4 md:border-l md:border-t-0 md:py-9 md:pl-8">
          <PortfolioProjectMark
            name={project.name}
            imageUrl={project.imageUrl}
            imageAlt={project.imageAlt}
            order={project.order}
          />
          <dl className="mt-6 grid grid-cols-2 gap-x-5 gap-y-5 border-t border-row-border pt-5">
            <ProjectFact label="Role" value={project.role} />
            <ProjectFact label="Scope" value={project.timeframe} />
            {repoPath ? (
              <div className="col-span-2 min-w-0">
                <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                  Source
                </dt>
                <dd className="mt-1.5 truncate font-mono text-[10px] uppercase">
                  {repoPath}
                </dd>
              </div>
            ) : null}
          </dl>
        </aside>
      </header>

      {project.tags.length > 0 ? (
        <div className="flex flex-wrap gap-x-4 gap-y-2 border-b border-row-border py-3 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
          {project.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      ) : null}

      <section className="pt-9 md:pt-12">
        <h2 className="mb-4 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Project overview
        </h2>
        <div className="grid border-l border-t border-row-border md:grid-cols-3">
          <ProjectDetail label="Problem" value={project.problem} />
          <ProjectDetail label="Approach" value={project.approach} />
          <ProjectDetail label="Outcome" value={project.outcome} />
        </div>
      </section>

      <ProjectPager previous={previousProject} next={nextProject} />

      {commentsEnabled ? (
        <section className="mt-10 border-t border-row-border pt-6">
          <h2 className="mb-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Comments
          </h2>
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
      className="mt-10 grid border-l border-t border-row-border md:grid-cols-2"
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
      href={asRoute(href)}
      prefetch
      className={`focus-ring group flex items-center gap-3 border-b border-r border-row-border p-4 transition-colors hover:bg-muted/35 ${
        isPrevious ? "justify-start" : "justify-end text-right"
      }`}
    >
      {isPrevious ? (
        <ArrowLeft
          aria-hidden="true"
          className="size-4 transition-transform group-hover:-translate-x-0.5"
        />
      ) : null}
      <span className="min-w-0">
        <span className="block font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
          {isPrevious ? "Previous project" : "Next project"}
        </span>
        <span className="mt-1 block truncate text-sm font-semibold group-hover:text-primary">
          {label}
        </span>
      </span>
      {!isPrevious ? (
        <ArrowRight
          aria-hidden="true"
          className="size-4 transition-transform group-hover:translate-x-0.5"
        />
      ) : null}
    </Link>
  );
}

function ProjectDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-r border-row-border p-5">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </h3>
      <p className="mt-3 text-sm leading-6 md:text-base md:leading-7">
        {value}
      </p>
    </div>
  );
}

function ProjectFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1.5 text-sm leading-5">{value}</dd>
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
    <div className={`flex flex-wrap gap-1.5 ${className ?? ""}`}>
      {links.map(({ href, label, Icon }) => (
        <a
          key={`${label}-${href}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring inline-flex h-8 items-center gap-1.5 border border-row-border px-2.5 font-mono text-[10px] uppercase transition-colors hover:bg-muted/40 hover:text-primary"
        >
          <Icon aria-hidden="true" className="size-3.5" />
          {label}
        </a>
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
