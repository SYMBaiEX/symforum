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
import { FileSearch, FileText, Plus, Save, Search, Trash2 } from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { toast } from "sonner";

type SitePageForm = {
  slug: string;
  title: string;
  subtitle: string;
  heroHeading: string;
  heroBody: string;
  body: string;
  status: "draft" | "published";
  showImage: boolean;
  imageUrl: string;
  imageLightUrl: string;
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

type PageStatusFilter = SitePageForm["status"] | "all";
type ProjectStatusFilter = PortfolioProjectForm["status"] | "all";

const emptyPages: SitePageRecord[] = [];
const emptyProjects: PortfolioProjectRecord[] = [];

const blankPage: SitePageForm = {
  slug: "",
  title: "",
  subtitle: "",
  heroHeading: "",
  heroBody: "",
  body: "",
  status: "draft",
  showImage: false,
  imageUrl: "",
  imageLightUrl: "",
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
  const [pageSearch, setPageSearch] = useState("");
  const [pageStatusFilter, setPageStatusFilter] =
    useState<PageStatusFilter>("all");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilter, setProjectStatusFilter] =
    useState<ProjectStatusFilter>("all");
  const [projectTypeFilter, setProjectTypeFilter] = useState("all");
  const pageTitleRef = useRef<HTMLInputElement>(null);
  const projectNameRef = useRef<HTMLInputElement>(null);

  const pageRows = pages ?? emptyPages;
  const projectRows = projects ?? emptyProjects;
  const pagePreview =
    safeImageUrl(pageForm.imageUrl) ?? safeImageUrl(pageForm.imageLightUrl);
  const projectPreview = safeImageUrl(projectForm.imageUrl);
  const pageSlug = pageForm.slug.trim();
  const projectSlug = projectForm.slug.trim();
  const existingPage = pageRows.find((page) => page.slug === pageSlug) ?? null;
  const existingProject =
    projectRows.find((project) => project.slug === projectSlug) ?? null;
  const pageHasFilters =
    pageSearch.trim().length > 0 || pageStatusFilter !== "all";
  const projectHasFilters =
    projectSearch.trim().length > 0 ||
    projectStatusFilter !== "all" ||
    projectTypeFilter !== "all";

  const projectTypeOptions = useMemo(
    () => [
      "all",
      ...Array.from(
        new Set(
          projectRows
            .map((project) => project.type.trim())
            .filter((type) => type.length > 0),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    ],
    [projectRows],
  );

  const filteredPages = useMemo(() => {
    const query = pageSearch.trim().toLowerCase();
    return pageRows.filter((page) => {
      if (pageStatusFilter !== "all" && page.status !== pageStatusFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [
        page.slug,
        page.title,
        page.subtitle,
        page.heroHeading,
        page.heroBody,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [pageRows, pageSearch, pageStatusFilter]);

  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    return projectRows.filter((project) => {
      if (
        projectStatusFilter !== "all" &&
        project.status !== projectStatusFilter
      ) {
        return false;
      }
      if (
        projectTypeFilter !== "all" &&
        project.type.toLowerCase() !== projectTypeFilter.toLowerCase()
      ) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [
        project.slug,
        project.name,
        project.type,
        project.role,
        project.timeframe,
        project.summary,
        project.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [projectRows, projectSearch, projectStatusFilter, projectTypeFilter]);

  function focusField(
    ref: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  ) {
    window.requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
  }

  function loadPageForm(
    nextPage: SitePageRecord | (typeof defaultSitePages)[number] | SitePageForm,
  ) {
    setPageForm(pageToForm(nextPage));
    focusField(pageTitleRef);
  }

  function loadProjectForm(
    nextProject:
      | PortfolioProjectRecord
      | (typeof defaultPortfolioProjects)[number]
      | PortfolioProjectForm,
  ) {
    setProjectForm(projectToForm(nextProject));
    focusField(projectNameRef);
  }

  async function savePage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await upsertPage({
        page: {
          slug: pageSlug || undefined,
          title: pageForm.title,
          subtitle: pageForm.subtitle,
          heroHeading: pageForm.heroHeading,
          heroBody: pageForm.heroBody,
          body: pageForm.body,
          status: pageForm.status,
          showImage: pageForm.showImage,
          imageUrl: pageForm.imageUrl.trim() || undefined,
          imageLightUrl: pageForm.imageLightUrl.trim() || undefined,
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
        loadPageForm(blankPage);
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
          slug: projectSlug || undefined,
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
          tags: projectForm.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
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
        loadProjectForm(blankProject);
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
            onClick={() => loadPageForm(defaultSitePages[0])}
          >
            <FileText />
            About draft
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => loadPageForm(defaultSitePages[1])}
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
            rows={filteredPages}
            totalRows={pageRows.length}
            loading={pages === undefined}
            activeSlug={pageForm.slug}
            emptyText="No managed pages yet. Save one of the built-in drafts to override the static fallback content."
            filteredEmptyText="No pages match the active search or status filter."
            hasFiltersApplied={pageHasFilters}
            controls={
              <>
                <label className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={pageSearch}
                    onChange={(event) => setPageSearch(event.target.value)}
                    placeholder="Search title, slug, hero copy"
                    className="pl-9"
                    aria-label="Search pages"
                  />
                </label>
                <select
                  className="h-10 min-w-[140px] border border-input bg-background px-3 text-sm"
                  value={pageStatusFilter}
                  onChange={(event) =>
                    setPageStatusFilter(event.target.value as PageStatusFilter)
                  }
                  aria-label="Filter pages by status"
                >
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </>
            }
            onClearFilters={() => {
              setPageSearch("");
              setPageStatusFilter("all");
            }}
            onNew={() => loadPageForm(blankPage)}
            onSeed={() => loadPageForm(defaultSitePages[0])}
            onSelect={loadPageForm}
            onDelete={removePage}
            getTitle={(page) => page.title}
            getDescription={(page) => page.subtitle}
            getMeta={(page) => `${page.slug} / ${page.status}`}
          />

          <form onSubmit={savePage} className="grid gap-3">
            <EditorBar
              label="Page editor"
              title={pageForm.title || "Untitled page"}
              slug={pageSlug}
              status={pageForm.status}
              savedState={
                existingPage
                  ? "Editing saved page"
                  : pageSlug || pageForm.title.trim()
                    ? "New page draft"
                    : "Blank page draft"
              }
            />
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Title">
                <Input
                  ref={pageTitleRef}
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
            <label className="flex items-center gap-2 font-mono text-xs uppercase text-muted-foreground">
              <input
                type="checkbox"
                checked={pageForm.showImage}
                onChange={(event) =>
                  setPageForm({
                    ...pageForm,
                    showImage: event.target.checked,
                  })
                }
              />
              Show image on public page
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Dark image URL">
                <Input
                  value={pageForm.imageUrl}
                  onChange={(event) =>
                    setPageForm({ ...pageForm, imageUrl: event.target.value })
                  }
                />
              </Field>
              <Field label="Light image URL">
                <Input
                  value={pageForm.imageLightUrl}
                  onChange={(event) =>
                    setPageForm({
                      ...pageForm,
                      imageLightUrl: event.target.value,
                    })
                  }
                />
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
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
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    existingPage
                      ? loadPageForm(existingPage)
                      : loadPageForm(blankPage)
                  }
                >
                  Reset
                </Button>
                <Button type="submit">
                  <Save />
                  Save page
                </Button>
              </div>
            </div>
            {pageForm.showImage && pagePreview ? (
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
            rows={filteredProjects}
            totalRows={projectRows.length}
            loading={projects === undefined}
            activeSlug={projectForm.slug}
            emptyText="No projects yet. Load a default project or create a new one."
            filteredEmptyText="No projects match the active search or filters."
            hasFiltersApplied={projectHasFilters}
            controls={
              <>
                <label className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={projectSearch}
                    onChange={(event) => setProjectSearch(event.target.value)}
                    placeholder="Search name, slug, tags, role"
                    className="pl-9"
                    aria-label="Search projects"
                  />
                </label>
                <select
                  className="h-10 min-w-[140px] border border-input bg-background px-3 text-sm"
                  value={projectStatusFilter}
                  onChange={(event) =>
                    setProjectStatusFilter(
                      event.target.value as ProjectStatusFilter,
                    )
                  }
                  aria-label="Filter projects by status"
                >
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
                <select
                  className="h-10 min-w-[140px] border border-input bg-background px-3 text-sm"
                  value={projectTypeFilter}
                  onChange={(event) => setProjectTypeFilter(event.target.value)}
                  aria-label="Filter projects by type"
                >
                  {projectTypeOptions.map((type) => (
                    <option key={type} value={type}>
                      {type === "all" ? "All types" : type}
                    </option>
                  ))}
                </select>
              </>
            }
            onClearFilters={() => {
              setProjectSearch("");
              setProjectStatusFilter("all");
              setProjectTypeFilter("all");
            }}
            onNew={() => loadProjectForm(blankProject)}
            onSeed={() => loadProjectForm(defaultPortfolioProjects[0])}
            onSelect={loadProjectForm}
            onDelete={removeProject}
            getTitle={(project) => project.name}
            getDescription={(project) =>
              [project.type, project.role, project.timeframe]
                .filter(Boolean)
                .join(" / ")
            }
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
                onClick={() => loadProjectForm(project)}
              >
                {project.name}
              </Button>
            ))}
          </div>

          <form onSubmit={saveProject} className="grid gap-3">
            <EditorBar
              label="Project editor"
              title={projectForm.name || "Untitled project"}
              slug={projectSlug}
              status={projectForm.status}
              savedState={
                existingProject
                  ? "Editing saved project"
                  : projectSlug || projectForm.name.trim()
                    ? "New project draft"
                    : "Blank project draft"
              }
            />
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name">
                <Input
                  ref={projectNameRef}
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
              <div className="flex items-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    existingProject
                      ? loadProjectForm(existingProject)
                      : loadProjectForm(blankProject)
                  }
                >
                  Reset
                </Button>
                <Button type="submit" className="w-full">
                  <Save />
                  Save project
                </Button>
              </div>
            </div>
            {projectForm.tags.trim() ? (
              <div className="flex flex-wrap gap-2">
                {projectForm.tags
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean)
                  .map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
              </div>
            ) : null}
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
  totalRows,
  loading,
  activeSlug,
  emptyText,
  filteredEmptyText,
  hasFiltersApplied,
  controls,
  onClearFilters,
  onNew,
  onSeed,
  onSelect,
  onDelete,
  getTitle,
  getDescription,
  getMeta,
}: {
  title: string;
  rows: T[];
  totalRows: number;
  loading: boolean;
  activeSlug: string;
  emptyText: string;
  filteredEmptyText: string;
  hasFiltersApplied: boolean;
  controls: ReactNode;
  onClearFilters: () => void;
  onNew: () => void;
  onSeed: () => void;
  onSelect: (row: T) => void;
  onDelete: (slug: string) => Promise<void>;
  getTitle: (row: T) => string;
  getDescription?: (row: T) => string;
  getMeta: (row: T) => string;
}) {
  return (
    <div className="border-y border-row-border py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase text-muted-foreground">
            {title}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? `Loading ${title.toLowerCase()}`
              : hasFiltersApplied
                ? `${rows.length} of ${totalRows} shown`
                : `${totalRows} total`}
          </p>
        </div>
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
      <div className="mt-3 flex flex-wrap gap-2">{controls}</div>
      {hasFiltersApplied ? (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-dashed border-row-border px-3 py-2 text-xs text-muted-foreground">
          <span>Filters are active.</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClearFilters}
          >
            Clear
          </Button>
        </div>
      ) : null}
      <div className="mt-3 divide-y divide-row-border">
        {loading
          ? Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`${title}-loading-${index}`}
                className="grid grid-cols-[1fr_auto] gap-3 py-2.5"
                aria-hidden="true"
              >
                <div className="space-y-2">
                  <div className="h-4 w-40 animate-pulse bg-muted" />
                  <div className="h-3 w-56 animate-pulse bg-muted/70" />
                </div>
                <div className="h-9 w-9 animate-pulse rounded-sm bg-muted" />
              </div>
            ))
          : null}
        {rows.map((row) => (
          <div
            key={row.slug}
            className={cn(
              "grid grid-cols-[1fr_auto] gap-3 py-2.5",
              row.slug === activeSlug
                ? "border-l-2 border-foreground bg-muted/35 pl-2"
                : null,
            )}
          >
            <button
              type="button"
              className="min-w-0 rounded-sm px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onSelect(row)}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-semibold">
                  {getTitle(row)}
                </h3>
                <Badge variant="outline">{row.slug}</Badge>
              </div>
              {getDescription ? (
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {getDescription(row)}
                </p>
              ) : null}
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
        {!loading && rows.length === 0 ? (
          <div className="flex items-start gap-3 py-5 text-sm leading-6 text-muted-foreground">
            <FileSearch className="mt-0.5 size-4 shrink-0" />
            <div>{hasFiltersApplied ? filteredEmptyText : emptyText}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EditorBar({
  label,
  title,
  slug,
  status,
  savedState,
}: {
  label: string;
  title: string;
  slug: string;
  status: string;
  savedState: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-y border-row-border py-3">
      <div>
        <p className="font-mono text-xs uppercase text-muted-foreground">
          {label}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{title}</span>
          <Badge variant="outline">{slug || "new"}</Badge>
          <Badge variant="outline">{status}</Badge>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{savedState}</p>
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
    showImage: page.showImage ?? false,
    imageUrl: page.imageUrl ?? "",
    imageLightUrl: page.imageLightUrl ?? "",
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
