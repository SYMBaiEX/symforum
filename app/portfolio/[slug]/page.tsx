/* eslint-disable @next/next/no-img-element */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { safeExternalUrl, safeImageUrl } from "@/lib/safe-url";
import {
  getPortfolioProject,
  getPortfolioProjects,
} from "@/lib/site-content";
import type { PortfolioProjectRecord } from "@/lib/site-content-defaults";
import { ArrowLeft, ArrowUpRight, ExternalLink, Github } from "lucide-react";
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
  const project = await getPortfolioProject(slug);
  if (!project) {
    notFound();
  }

  return (
    <article className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_16rem] md:gap-12">
        <div className="min-w-0">
          <Button asChild size="sm" variant="outline">
            <Link href="/portfolio">
              <ArrowLeft data-icon="inline-start" />
              Portfolio
            </Link>
          </Button>

          <p className="mt-8 font-mono text-[11px] uppercase text-muted-foreground">
            {project.type}
          </p>
          <h1 className="mt-2 max-w-4xl break-words text-4xl font-bold leading-none text-balance md:text-6xl">
            {project.name}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
            {project.summary}
          </p>

          <ProjectLinks className="mt-5" project={project} />

          <section className="mt-10 grid gap-7 md:grid-cols-3">
            <ProjectDetail label="Problem" value={project.problem} />
            <ProjectDetail label="Approach" value={project.approach} />
            <ProjectDetail label="Outcome" value={project.outcome} />
          </section>
        </div>

        <aside className="md:pt-20">
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
