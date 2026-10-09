import { CommentsPanel } from "@/components/comments-panel";
import { PortfolioProjectMark } from "@/components/portfolio-project-mark";
import { PrimaryPageSurface } from "@/components/primary-page-surface";
import { StructuredData } from "@/components/structured-data";
import {
  ForumBodyGrid,
  ForumSectionHeader,
} from "@/components/forum/forum-layout-primitives";
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
          images: [
            {
              url: `${primarySiteUrl("/")}opengraph-image`,
              alt: `SYMBaiEX portfolio project: ${project.name}`,
            },
          ],
        }
      : undefined,
    twitter: project
      ? {
          card: "summary_large_image",
          title: project.name,
          description: project.summary,
          images: [`${primarySiteUrl("/")}opengraph-image`],
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
    <PrimaryPageSurface>
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
          className="flex items-center justify-between gap-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
        >
          <Link
            href="/portfolio"
            prefetch
            className="forum-action-pill focus-ring inline-flex items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            Portfolio
          </Link>
          <span>
            {String(projectIndex + 1).padStart(2, "0")} /{" "}
            {String(projects.length).padStart(2, "0")}
          </span>
        </nav>

        <ForumBodyGrid
          mobileSidebarLabel="Project details"
          sidebar={
            <section
              className="forum-panel p-4"
              aria-labelledby="project-record-heading"
            >
              <ForumSectionHeader
                title="Project record"
                id="project-record-heading"
              />
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-row-border pt-4">
                <ProjectFact label="Role" value={project.role} />
                <ProjectFact label="Scope" value={project.timeframe} />
                {repoPath ? (
                  <ProjectFact
                    className="col-span-2 min-w-0"
                    label="Source"
                    value={repoPath}
                  />
                ) : null}
              </dl>
              {project.tags.length > 0 ? (
                <div className="mt-4 border-t border-row-border pt-4">
                  <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                    Topics
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
                    {project.tags.map((tag) => (
                      <li
                        key={tag}
                        className="font-mono text-[9px] uppercase tracking-[0.08em]"
                      >
                        #{tag}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          }
        >
          <header
            className="forum-panel overflow-hidden !p-0"
            aria-labelledby="project-heading"
          >
            <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-row-border px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {project.type}
              </p>
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                {String(project.order).padStart(2, "0")} /{" "}
                {String(projects.length).padStart(2, "0")}
              </span>
            </div>
            <div className="px-4 py-5 sm:px-5">
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <h1
                    id="project-heading"
                    className="break-words text-4xl font-bold leading-tight tracking-[-0.045em] text-balance sm:text-5xl"
                  >
                    {project.name}
                  </h1>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base md:leading-7">
                    {project.summary}
                  </p>
                </div>
                <div className="shrink-0">
                  <PortfolioProjectMark
                    name={project.name}
                    imageUrl={project.imageUrl}
                    imageAlt={project.imageAlt}
                    order={project.order}
                  />
                </div>
              </div>
              <ProjectLinks className="mt-4" project={project} />
            </div>
          </header>

          <section
            className="forum-panel overflow-hidden !p-0"
            aria-labelledby="project-overview-heading"
          >
            <ForumSectionHeader
              title="Project overview"
              id="project-overview-heading"
            />
            <div className="divide-y divide-row-border border-t border-row-border">
              <ProjectDetail label="Problem" value={project.problem} />
              <ProjectDetail label="Approach" value={project.approach} />
              <ProjectDetail label="Outcome" value={project.outcome} />
            </div>
          </section>

          <ProjectPager previous={previousProject} next={nextProject} />

          {commentsEnabled ? (
            <section
              className="forum-panel overflow-hidden !p-0"
              aria-labelledby="project-comments-heading"
            >
              <ForumSectionHeader
                title="Comments"
                id="project-comments-heading"
              />
              <div className="border-t border-row-border p-4 sm:p-5">
                <CommentsPanel
                  entityType="portfolioProject"
                  entityId={project.slug}
                  enabled
                />
              </div>
            </section>
          ) : null}
        </ForumBodyGrid>
      </article>
    </PrimaryPageSurface>
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
      className="forum-panel grid overflow-hidden !p-0 md:grid-cols-2"
    >
      {previous ? (
        <ProjectPagerLink
          direction="previous"
          href={`/portfolio/${previous.slug}`}
          label={previous.name}
          className="border-b border-row-border md:border-b-0 md:border-r"
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
  className,
}: {
  direction: "previous" | "next";
  href: string;
  label: string;
  className?: string;
}) {
  const isPrevious = direction === "previous";

  return (
    <Link
      href={asRoute(href)}
      prefetch
      className={`focus-ring forum-list-row group flex min-w-0 items-center gap-3 p-4 ${className ?? ""} ${
        isPrevious ? "justify-start" : "justify-between text-right"
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
    <div className="grid gap-2 px-4 py-4 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4 sm:px-5">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </h3>
      <p className="text-sm leading-6 md:text-base md:leading-7">{value}</p>
    </div>
  );
}

function ProjectFact({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
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
          className="forum-action-pill focus-ring inline-flex items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground"
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
