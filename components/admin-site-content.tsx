/* eslint-disable @next/next/no-img-element */
"use client";

import { reportAppError } from "@/components/app-error-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  convexRefs,
  type PortfolioProjectRecord,
  type SitePageRecord,
} from "@/lib/convex-refs";
import {
  defaultPortfolioProjects,
  defaultSitePages,
} from "@/lib/site-content-defaults";
import { safeImageUrl } from "@/lib/safe-url";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { FileText, Plus, Save, Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

type SitePageForm = {
  slug: string;
  title: string;
  subtitle: string;
  heroHeading: string;
  heroBody: string;
  body: string;
  status: "draft" | "published";
  imageUrl: string;
  imageAlt: string;
  imageCredit: string;
};

type PortfolioProjectForm = {
  slug: string;
  name: string;
  type: string;
  role: string;
  timeframe: string;
  summary: string;
  problem: string;
  approach: string;
  outcome: string;
  status: "draft" | "published" | "archived";
  order: number;
  tags: string;
  imageUrl: string;
  imageAlt: string;
  homepageUrl: string;
  repoUrl: string;
  writeupUrl: string;
};

const blankPage: SitePageForm = {
  slug: "",
  title: "",
  subtitle: "",
  heroHeading: "",
  heroBody: "",
  body: "",
  status: "draft",
  imageUrl: "",
  imageAlt: "",
  imageCredit: "",
};

const blankProject: PortfolioProjectForm = {
  slug: "",
  name: "",
  type: "",
  role: "",
  timeframe: "",
  summary: "",
  problem: "",
  approach: "",
  outcome: "",
  status: "draft",
  order: 10,
  tags: "",
  imageUrl: "",
  imageAlt: "",
  homepageUrl: "",
  repoUrl: "",
  writeupUrl: "",
};

export function AdminSiteContent() {
  const pages = useQuery(convexRefs.admin.listSitePages, {});
  const projects = useQuery(convexRefs.admin.listPortfolioProjects, {});
  const upsertPage = useMutation(convexRefs.admin.upsertSitePage);
  const deletePage = useMutation(convexRefs.admin.deleteSitePage);
  const upsertProject = useMutation(convexRefs.admin.upsertPortfolioProject);
  const deleteProject = useMutation(convexRefs.admin.deletePortfolioProject);
  const [pageForm, setPageForm] = useState<SitePageForm>(() =>
    pageToForm(defaultSitePages[0] ?? blankPage),
  );
  const [projectForm, setProjectForm] = useState<PortfolioProjectForm>(() =>
    projectToForm(defaultPortfolioProjects[0] ?? blankProject),
  );

  const pageRows = pages ?? [];
  const projectRows = projects ?? [];
  const pagePreview = safeImageUrl(pageForm.imageUrl);
  const projectPreview = safeImageUrl(projectForm.imageUrl);

  async function savePage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await upsertPage({
        page: {
          slug: pageForm.slug.trim() || undefined,
          title: pageForm.title,
          subtitle: pageForm.subtitle,
          heroHeading: pageForm.heroHeading,
          heroBody: pageForm.heroBody,
          body: pageForm.body,
          status: pageForm.status,
          imageUrl: pageForm.imageUrl.trim() || undefined,
          imageAlt: pageForm.imageAlt.trim() || undefined,
          imageCredit: pageForm.imageCredit.trim() || undefined,
        },
      });
      toast.success("Page saved");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-content",
        eventType: "page_save_failed",
        component: "AdminSiteContent",
        action: "admin:upsertSitePage",
        metadata: { slug: pageForm.slug },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not save page",
      );
    }
  }

  async function removePage(slug: string) {
    if (!window.confirm(`Delete page ${slug}?`)) {
      return;
    }
    try {
      await deletePage({ slug });
      if (pageForm.slug === slug) {
        setPageForm(blankPage);
      }
      toast.success("Page deleted");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-content",
        eventType: "page_delete_failed",
        component: "AdminSiteContent",
        action: "admin:deleteSitePage",
        metadata: { slug },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not delete page",
      );
    }
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await upsertProject({
        project: {
          slug: projectForm.slug.trim() || undefined,
          name: projectForm.name,
          type: projectForm.type,
          role: projectForm.role,
          timeframe: projectForm.timeframe,
          summary: projectForm.summary,
          problem: projectForm.problem,
          approach: projectForm.approach,
          outcome: projectForm.outcome,
          status: projectForm.status,
          order: Number(projectForm.order),
          tags: projectForm.tags.split(","),
          imageUrl: projectForm.imageUrl.trim() || undefined,
          imageAlt: projectForm.imageAlt.trim() || undefined,
          homepageUrl: projectForm.homepageUrl.trim() || undefined,
          repoUrl: projectForm.repoUrl.trim() || undefined,
          writeupUrl: projectForm.writeupUrl.trim() || undefined,
        },
      });
      toast.success("Project saved");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-content",
        eventType: "project_save_failed",
        component: "AdminSiteContent",
        action: "admin:upsertPortfolioProject",
        metadata: { slug: projectForm.slug },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not save project",
      );
    }
  }

  async function removeProject(slug: string) {
    if (!window.confirm(`Delete project ${slug}?`)) {
      return;
    }
    try {
      await deleteProject({ slug });
      if (projectForm.slug === slug) {
        setProjectForm(blankProject);
      }
      toast.success("Project deleted");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-content",
        eventType: "project_delete_failed",
        component: "AdminSiteContent",
        action: "admin:deletePortfolioProject",
        metadata: { slug },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not delete project",
      );
    }
  }

  return (
    <section className="mt-10 border-y border-row-border py-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Site content
          </p>
          <h2 className="mt-2 text-3xl font-semibold md:text-4xl">
            About and portfolio
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setPageForm(pageToForm(defaultSitePages[0]))}
          >
            <FileText />
            About draft
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setPageForm(pageToForm(defaultSitePages[1]))}
          >
            <FileText />
            Portfolio intro
          </Button>
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-2">
        <div className="grid gap-5">
          <ContentList
            title="Pages"
            rows={pageRows}
            loading={pages === undefined}
            activeSlug={pageForm.slug}
            emptyText="No managed pages yet. Save the drafts above to override the static fallbacks."
            onNew={() => setPageForm(blankPage)}
            onSeed={() => setPageForm(pageToForm(defaultSitePages[0]))}
            onSelect={(page) => setPageForm(pageToForm(page))}
            onDelete={removePage}
            getTitle={(page) => page.title}
            getMeta={(page) => `${page.slug} / ${page.status}`}
          />

          <form onSubmit={savePage} className="grid gap-3">
            <EditorBar label="Page editor" />
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Title">
                <Input
                  value={pageForm.title}
                  onChange={(event) =>
                    setPageForm({ ...pageForm, title: event.target.value })
                  }
                  required
                />
              </Field>
              <Field label="Slug">
                <Input
                  value={pageForm.slug}
                  onChange={(event) =>
                    setPageForm({ ...pageForm, slug: event.target.value })
                  }
                  placeholder="about"
                />
              </Field>
            </div>
            <Field label="Subtitle">
              <Input
                value={pageForm.subtitle}
                onChange={(event) =>
                  setPageForm({ ...pageForm, subtitle: event.target.value })
                }
                required
              />
            </Field>
            <Field label="Hero heading">
              <Input
                value={pageForm.heroHeading}
                onChange={(event) =>
                  setPageForm({ ...pageForm, heroHeading: event.target.value })
                }
                required
              />
            </Field>
            <Field label="Hero body">
              <Textarea
                value={pageForm.heroBody}
                onChange={(event) =>
                  setPageForm({ ...pageForm, heroBody: event.target.value })
                }
                rows={4}
                required
              />
            </Field>
            <Field label="Markdown body">
              <Textarea
                value={pageForm.body}
                onChange={(event) =>
                  setPageForm({ ...pageForm, body: event.target.value })
                }
                rows={14}
                required
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Image URL">
                <Input
                  value={pageForm.imageUrl}
                  onChange={(event) =>
                    setPageForm({ ...pageForm, imageUrl: event.target.value })
                  }
                />
              </Field>
              <Field label="Image alt">
                <Input
                  value={pageForm.imageAlt}
                  onChange={(event) =>
                    setPageForm({ ...pageForm, imageAlt: event.target.value })
                  }
                />
              </Field>
              <Field label="Credit">
                <Input
                  value={pageForm.imageCredit}
                  onChange={(event) =>
                    setPageForm({
                      ...pageForm,
                      imageCredit: event.target.value,
                    })
                  }
                />
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <Field label="Status">
                <select
                  className="h-10 border border-input bg-background px-3 text-sm"
                  value={pageForm.status}
                  onChange={(event) =>
                    setPageForm({
                      ...pageForm,
                      status: event.target.value as "draft" | "published",
                    })
                  }
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </Field>
              <Button type="submit">
                <Save />
                Save page
              </Button>
            </div>
            {pagePreview ? (
              <img
                src={pagePreview}
                alt={pageForm.imageAlt || "Page preview"}
                className="aspect-[16/9] w-full border border-row-border object-cover"
              />
            ) : null}
          </form>
        </div>

        <div className="grid gap-5">
          <ContentList
            title="Projects"
            rows={projectRows}
            loading={projects === undefined}
            activeSlug={projectForm.slug}
            emptyText="No projects yet. Load a default project or create a new one."
            onNew={() => setProjectForm(blankProject)}
            onSeed={() =>
              setProjectForm(projectToForm(defaultPortfolioProjects[0]))
            }
            onSelect={(project) => setProjectForm(projectToForm(project))}
            onDelete={removeProject}
            getTitle={(project) => project.name}
            getMeta={(project) =>
              `${String(project.order).padStart(2, "0")} / ${project.slug} / ${
                project.status
              }`
            }
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {defaultPortfolioProjects.map((project) => (
              <Button
                key={project.slug}
                type="button"
                variant="outline"
                onClick={() => setProjectForm(projectToForm(project))}
              >
                {project.name}
              </Button>
            ))}
          </div>

          <form onSubmit={saveProject} className="grid gap-3">
            <EditorBar label="Project editor" />
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name">
                <Input
                  value={projectForm.name}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      name: event.target.value,
                    })
                  }
                  required
                />
              </Field>
              <Field label="Slug">
                <Input
                  value={projectForm.slug}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      slug: event.target.value,
                    })
                  }
                />
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Type">
                <Input
                  value={projectForm.type}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      type: event.target.value,
                    })
                  }
                  required
                />
              </Field>
              <Field label="Role">
                <Input
                  value={projectForm.role}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      role: event.target.value,
                    })
                  }
                  required
                />
              </Field>
              <Field label="Timeframe">
                <Input
                  value={projectForm.timeframe}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      timeframe: event.target.value,
                    })
                  }
                  required
                />
              </Field>
            </div>
            <Field label="Summary">
              <Textarea
                value={projectForm.summary}
                onChange={(event) =>
                  setProjectForm({
                    ...projectForm,
                    summary: event.target.value,
                  })
                }
                rows={3}
                required
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Problem">
                <Textarea
                  value={projectForm.problem}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      problem: event.target.value,
                    })
                  }
                  rows={5}
                  required
                />
              </Field>
              <Field label="Approach">
                <Textarea
                  value={projectForm.approach}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      approach: event.target.value,
                    })
                  }
                  rows={5}
                  required
                />
              </Field>
              <Field label="Outcome">
                <Textarea
                  value={projectForm.outcome}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      outcome: event.target.value,
                    })
                  }
                  rows={5}
                  required
                />
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Order">
                <Input
                  type="number"
                  min={1}
                  max={9999}
                  value={projectForm.order}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      order: Number(event.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Tags">
                <Input
                  value={projectForm.tags}
                  placeholder="ai, open-source"
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      tags: event.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Status">
                <select
                  className="h-10 border border-input bg-background px-3 text-sm"
                  value={projectForm.status}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      status: event.target.value as
                        | "draft"
                        | "published"
                        | "archived",
                    })
                  }
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </Field>
              <div className="flex items-end">
                <Button type="submit" className="w-full">
                  <Save />
                  Save project
                </Button>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Image URL">
                <Input
                  value={projectForm.imageUrl}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      imageUrl: event.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Image alt">
                <Input
                  value={projectForm.imageAlt}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      imageAlt: event.target.value,
                    })
                  }
                />
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Homepage">
                <Input
                  value={projectForm.homepageUrl}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      homepageUrl: event.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Repo">
                <Input
                  value={projectForm.repoUrl}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      repoUrl: event.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Writeup">
                <Input
                  value={projectForm.writeupUrl}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      writeupUrl: event.target.value,
                    })
                  }
                />
              </Field>
            </div>
            {projectPreview ? (
              <img
                src={projectPreview}
                alt={projectForm.imageAlt || "Project preview"}
                className="aspect-[16/9] w-full border border-row-border object-cover"
              />
            ) : null}
          </form>
        </div>
      </div>
    </section>
  );
}

function ContentList<T extends { slug: string }>({
  title,
  rows,
  loading,
  activeSlug,
  emptyText,
  onNew,
  onSeed,
  onSelect,
  onDelete,
  getTitle,
  getMeta,
}: {
  title: string;
  rows: T[];
  loading: boolean;
  activeSlug: string;
  emptyText: string;
  onNew: () => void;
  onSeed: () => void;
  onSelect: (row: T) => void;
  onDelete: (slug: string) => Promise<void>;
  getTitle: (row: T) => string;
  getMeta: (row: T) => string;
}) {
  return (
    <div className="border-y border-row-border py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs uppercase text-muted-foreground">
          {title}
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onSeed}>
            <Plus />
            Draft
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onNew}>
            <Plus />
            New
          </Button>
        </div>
      </div>
      <div className="mt-3 divide-y divide-row-border">
        {rows.map((row) => (
          <div
            key={row.slug}
            className={cn(
              "grid grid-cols-[1fr_auto] gap-3 py-3",
              row.slug === activeSlug ? "bg-muted/35" : null,
            )}
          >
            <button
              type="button"
              className="min-w-0 text-left"
              onClick={() => onSelect(row)}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-semibold">
                  {getTitle(row)}
                </h3>
                <Badge variant="outline">{row.slug}</Badge>
              </div>
              <p className="mt-1 font-mono text-[11px] uppercase text-muted-foreground">
                {getMeta(row)}
              </p>
            </button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onDelete(row.slug)}
              aria-label={`Delete ${getTitle(row)}`}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        {loading ? (
          <div className="py-5 font-mono text-xs uppercase text-muted-foreground">
            Loading {title.toLowerCase()}
          </div>
        ) : null}
        {!loading && rows.length === 0 ? (
          <div className="py-5 text-sm leading-6 text-muted-foreground">
            {emptyText}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EditorBar({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-y border-row-border py-3">
      <p className="font-mono text-xs uppercase text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      <span className="font-mono text-[11px] uppercase text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function pageToForm(
  page: SitePageRecord | (typeof defaultSitePages)[number] | SitePageForm,
): SitePageForm {
  return {
    slug: page.slug,
    title: page.title,
    subtitle: page.subtitle,
    heroHeading: page.heroHeading,
    heroBody: page.heroBody,
    body: page.body,
    status: page.status,
    imageUrl: page.imageUrl ?? "",
    imageAlt: page.imageAlt ?? "",
    imageCredit: page.imageCredit ?? "",
  };
}

function projectToForm(
  project:
    | PortfolioProjectRecord
    | (typeof defaultPortfolioProjects)[number]
    | PortfolioProjectForm,
): PortfolioProjectForm {
  return {
    slug: project.slug,
    name: project.name,
    type: project.type,
    role: project.role,
    timeframe: project.timeframe,
    summary: project.summary,
    problem: project.problem,
    approach: project.approach,
    outcome: project.outcome,
    status: project.status,
    order: project.order,
    tags: Array.isArray(project.tags) ? project.tags.join(", ") : project.tags,
    imageUrl: project.imageUrl ?? "",
    imageAlt: project.imageAlt ?? "",
    homepageUrl: project.homepageUrl ?? "",
    repoUrl: project.repoUrl ?? "",
    writeupUrl: project.writeupUrl ?? "",
  };
}
