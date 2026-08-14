"use client";

import dynamic from "next/dynamic";
import { reportAppError } from "@/components/app-error-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  convexRefs,
  type AdminApiKeyRecord,
  type AdminCommentRecord,
  type AdminInteractionRecord,
  type AdminOverviewRecord,
  type ConvexPostRecord,
} from "@/lib/convex-refs";
import { compactNumber, formatDate } from "@/lib/format";
import {
  adminSectionHref,
  ownerOnlyAdminSections,
  type AdminSectionId,
} from "@/lib/admin-sections";
import { cn } from "@/lib/utils";
import { asRoute } from "@/lib/typed-route";
import { useMutation, useQuery } from "convex/react";
import {
  Activity,
  BarChart3,
  Copy,
  FileText,
  Gauge,
  ImagePlus,
  KeyRound,
  Mail,
  MessageSquare,
  MousePointer2,
  PanelsTopLeft,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  UsersRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { toast } from "sonner";

const AdminPanelLoading = () => (
  <div className="border-y border-row-border py-6 font-mono text-xs uppercase text-muted-foreground">
    Loading admin panel
  </div>
);

const AdminAiChat = dynamic(
  () => import("@/components/admin-ai-chat").then((module) => module.AdminAiChat),
  { loading: AdminPanelLoading, ssr: false },
);
const AdminAnalytics = dynamic(
  () =>
    import("@/components/admin-analytics").then(
      (module) => module.AdminAnalytics,
    ),
  { loading: AdminPanelLoading, ssr: false },
);
const AdminContactRequests = dynamic(
  () =>
    import("@/components/admin-contact-requests").then(
      (module) => module.AdminContactRequests,
    ),
  { loading: AdminPanelLoading, ssr: false },
);
const AdminForum = dynamic(
  () => import("@/components/admin-forum").then((module) => module.AdminForum),
  { loading: AdminPanelLoading, ssr: false },
);
const AdminSiteContent = dynamic(
  () =>
    import("@/components/admin-site-content").then(
      (module) => module.AdminSiteContent,
    ),
  { loading: AdminPanelLoading, ssr: false },
);
const AdminNewsletter = dynamic(
  () =>
    import("@/components/admin-newsletter").then(
      (module) => module.AdminNewsletter,
    ),
  { loading: AdminPanelLoading, ssr: false },
);
const AdminSystemLogs = dynamic(
  () =>
    import("@/components/admin-system-logs").then(
      (module) => module.AdminSystemLogs,
    ),
  { loading: AdminPanelLoading, ssr: false },
);
const AdminTelemetry = dynamic(
  () =>
    import("@/components/admin-telemetry").then(
      (module) => module.AdminTelemetry,
    ),
  { loading: AdminPanelLoading, ssr: false },
);
const AdminUsers = dynamic(
  () => import("@/components/admin-users").then((module) => module.AdminUsers),
  { loading: AdminPanelLoading, ssr: false },
);

type PostForm = {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  tags: string;
  status: "draft" | "published";
  publishedAt: string;
  readingMinutes: number;
  featured: boolean;
  imageUrl: string;
  imageAlt: string;
  imageCredit: string;
};

type AdminTabId = AdminSectionId;

type AdminTab = {
  id: AdminTabId;
  label: string;
  note: string;
  count?: number;
  icon: LucideIcon;
};

type AdminEntityType =
  | AdminCommentRecord["entityType"]
  | AdminInteractionRecord["entityType"];

const blankPost: PostForm = {
  slug: "",
  title: "",
  excerpt: "",
  body: "",
  tags: "",
  status: "draft",
  publishedAt: new Date().toISOString().slice(0, 10),
  readingMinutes: 4,
  featured: false,
  imageUrl: "",
  imageAlt: "",
  imageCredit: "",
};

const adminApiRoutes = [
  {
    method: "GET",
    path: "/api/admin/posts",
    detail: "List posts for external publishing tools.",
  },
  {
    method: "POST",
    path: "/api/admin/posts",
    detail: "Create or update a post from a writer workflow.",
  },
  {
    method: "GET",
    path: "/api/admin/posts/[slug]",
    detail: "Fetch one post by slug.",
  },
  {
    method: "PATCH",
    path: "/api/admin/posts/[slug]",
    detail: "Patch one post by slug.",
  },
  {
    method: "DELETE",
    path: "/api/admin/posts/[slug]",
    detail: "Delete one post by slug.",
  },
  {
    method: "GET",
    path: "/api/admin/interactions",
    detail: "Inspect comments and interactions by entity filters.",
  },
  {
    method: "GET",
    path: "/api/admin/newsletter/subscribers",
    detail: "Export newsletter subscribers for admin tooling.",
  },
  {
    method: "GET",
    path: "/api/admin/newsletter/issues",
    detail: "List newsletter issues.",
  },
  {
    method: "POST",
    path: "/api/admin/newsletter/issues",
    detail: "Create or update a newsletter issue.",
  },
  {
    method: "POST",
    path: "/api/admin/newsletter/issues/[slug]/test",
    detail: "Send a test issue to one inbox.",
  },
  {
    method: "POST",
    path: "/api/admin/newsletter/issues/[slug]/schedule",
    detail: "Schedule a newsletter issue.",
  },
  {
    method: "POST",
    path: "/api/admin/newsletter/issues/[slug]/send",
    detail: "Send a newsletter issue immediately.",
  },
] as const;

export function AdminDashboard({
  initialTab = "overview",
}: {
  initialTab?: AdminSectionId;
}) {
  const viewer = useQuery(convexRefs.admin.viewer, {});
  const claimInitialOwner = useMutation(convexRefs.admin.claimInitialOwner);
  const [ownerBootstrapToken, setOwnerBootstrapToken] = useState("");

  if (viewer === undefined) {
    return (
      <div className="border-y border-row-border py-6 font-mono text-xs uppercase text-muted-foreground">
        Loading admin state
      </div>
    );
  }

  if (viewer.user === null) {
    return (
      <AdminGate
        title="Sign in required"
        body="Use an administrator account to manage site content and operations."
      />
    );
  }

  if (!viewer.canAccessAdmin) {
    if (!viewer.ownerExists) {
      return (
        <AdminGate
          title="Bootstrap owner access"
          body="No owner exists in this Convex deployment. Enter the configured owner bootstrap token to unlock the console for this account."
          action={
            <div className="mt-5 grid gap-3">
              <Input
                className="max-w-md rounded-none border-row-border"
                type="password"
                autoComplete="one-time-code"
                placeholder="Owner bootstrap token"
                value={ownerBootstrapToken}
                onChange={(event) => setOwnerBootstrapToken(event.target.value)}
              />
              <Button
                className="justify-self-start"
                disabled={ownerBootstrapToken.trim().length === 0}
                onClick={async () => {
                  try {
                    await claimInitialOwner({
                      bootstrapToken: ownerBootstrapToken.trim(),
                    });
                    setOwnerBootstrapToken("");
                    toast.success("Owner access claimed");
                  } catch (error) {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Could not claim owner access",
                    );
                  }
                }}
              >
                <ShieldCheck />
                Claim owner
              </Button>
            </div>
          }
        />
      );
    }
    if (viewer.canAdminForum) {
      return <ForumStaffDashboard mode="full" />;
    }
    if (viewer.canModerateForum) {
      return <ForumStaffDashboard mode="moderation" />;
    }
    return (
      <AdminGate
        title="Administrator access required"
        body="This account is signed in, but it is not a site administrator or forum moderator."
      />
    );
  }

  return (
    <SiteAdminDashboard initialTab={initialTab} isOwner={viewer.isOwner} />
  );
}

function ForumStaffDashboard({ mode }: { mode: "full" | "moderation" }) {
  const moderationOnly = mode === "moderation";
  return (
    <div className="space-y-6">
      <section className="border-y border-row-border py-5">
        <p className="font-mono text-xs uppercase text-muted-foreground">
          {moderationOnly ? "Forum moderation" : "Forum admin"}
        </p>
        <h2 className="mt-3 text-3xl font-semibold">
          {moderationOnly ? "Moderator console" : "Forum admin console"}
        </h2>
        <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
          {moderationOnly
            ? "This account can review queues, reports, warnings, polls, and moderation logs. Owner-only site publishing and board management stay hidden."
            : "This account can manage forum boards, pages, prefixes, rules, and moderation queues. Owner-only site publishing stays hidden."}
        </p>
      </section>
      <AdminForum mode={mode} />
    </div>
  );
}

function SiteAdminDashboard({
  initialTab,
  isOwner,
}: {
  initialTab: AdminSectionId;
  isOwner: boolean;
}) {
  const router = useRouter();
  const activeTab =
    !isOwner && ownerOnlyAdminSections.has(initialTab)
      ? "overview"
      : initialTab;
  const overview = useQuery(convexRefs.admin.overview, {});
  const forumOverview = useQuery(
    convexRefs.admin.forumOverview,
    activeTab === "forum" ? {} : "skip",
  );
  const posts = useQuery(
    convexRefs.admin.listPosts,
    activeTab === "posts" ? {} : "skip",
  );
  const apiKeys = useQuery(
    convexRefs.admin.listApiKeys,
    isOwner && (activeTab === "overview" || activeTab === "api")
      ? {}
      : "skip",
  );
  const adminComments = useQuery(
    convexRefs.admin.listComments,
    activeTab === "comments" ? {} : "skip",
  );
  const adminInteractions = useQuery(
    convexRefs.admin.listInteractions,
    activeTab === "interactions" ? {} : "skip",
  );
  const upsertPost = useMutation(convexRefs.admin.upsertPost);
  const deletePost = useMutation(convexRefs.admin.deletePost);
  const generateUploadUrl = useMutation(convexRefs.admin.generateUploadUrl);
  const resolveStorageUrl = useMutation(convexRefs.admin.resolveStorageUrl);
  const createApiKey = useMutation(convexRefs.admin.createApiKey);
  const revokeApiKey = useMutation(convexRefs.admin.revokeApiKey);
  const deleteComment = useMutation(convexRefs.admin.deleteComment);
  const deleteInteraction = useMutation(convexRefs.admin.deleteInteraction);
  const [form, setForm] = useState<PostForm>(blankPost);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const coverImageInputRef = useRef<HTMLInputElement | null>(null);
  const bodyImageInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingImageTarget, setUploadingImageTarget] = useState<
    "cover" | "body" | null
  >(null);
  const [apiKeyName, setApiKeyName] = useState("Blog writer");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const navigateToTab = (tab: AdminTabId) => {
    router.push(adminSectionHref(tab));
  };
  const [postSearch, setPostSearch] = useState("");
  const [postStatusFilter, setPostStatusFilter] = useState<
    "all" | ConvexPostRecord["status"]
  >("all");
  const [commentSearch, setCommentSearch] = useState("");
  const [commentEntityFilter, setCommentEntityFilter] = useState<
    "all" | AdminCommentRecord["entityType"]
  >("all");
  const [commentStatusFilter, setCommentStatusFilter] = useState<
    "all" | NonNullable<AdminCommentRecord["status"]>
  >("all");
  const [interactionSearch, setInteractionSearch] = useState("");
  const [interactionEntityFilter, setInteractionEntityFilter] = useState<
    "all" | AdminInteractionRecord["entityType"]
  >("all");
  const [interactionStateFilter, setInteractionStateFilter] = useState<
    "all" | "saved" | "unsaved" | "upvoted" | "downvoted" | "neutral"
  >("all");

  const selectedSlug = form.slug.trim();
  const sortedPosts = useMemo(
    () =>
      [...(posts ?? [])].sort(
        (left, right) => right.publishedAt - left.publishedAt,
      ),
    [posts],
  );
  const activity = useMemo(
    () => adminInteractions ?? overview?.recentInteractions ?? [],
    [adminInteractions, overview?.recentInteractions],
  );
  const comments = useMemo(
    () => adminComments ?? overview?.recentComments ?? [],
    [adminComments, overview?.recentComments],
  );
  const activeApiKeys = useMemo(
    () => (apiKeys ?? []).filter((key) => !key.revokedAt),
    [apiKeys],
  );
  const postSearchValue = postSearch.trim().toLowerCase();
  const filteredPosts = useMemo(() => {
    return sortedPosts.filter((post) => {
      const matchesStatus =
        postStatusFilter === "all" || post.status === postStatusFilter;
      const matchesSearch =
        postSearchValue.length === 0 ||
        [post.title, post.slug, post.excerpt, post.tags.join(" "), post.status]
          .join(" ")
          .toLowerCase()
          .includes(postSearchValue);
      return matchesStatus && matchesSearch;
    });
  }, [postSearchValue, postStatusFilter, sortedPosts]);
  const commentSearchValue = commentSearch.trim().toLowerCase();
  const filteredComments = useMemo(() => {
    return comments.filter((comment) => {
      const status = comment.status ?? "active";
      const matchesEntity =
        commentEntityFilter === "all" ||
        comment.entityType === commentEntityFilter;
      const matchesStatus =
        commentStatusFilter === "all" || status === commentStatusFilter;
      const matchesSearch =
        commentSearchValue.length === 0 ||
        [
          comment.author,
          comment.entityId,
          comment.body,
          status,
          comment.entityType,
        ]
          .join(" ")
          .toLowerCase()
          .includes(commentSearchValue);
      return matchesEntity && matchesStatus && matchesSearch;
    });
  }, [commentEntityFilter, commentSearchValue, commentStatusFilter, comments]);
  const interactionSearchValue = interactionSearch.trim().toLowerCase();
  const filteredInteractions = useMemo(() => {
    return activity.filter((item) => {
      const matchesEntity =
        interactionEntityFilter === "all" ||
        item.entityType === interactionEntityFilter;
      const matchesState =
        interactionStateFilter === "all" ||
        (interactionStateFilter === "saved" && item.saved) ||
        (interactionStateFilter === "unsaved" && !item.saved) ||
        (interactionStateFilter === "upvoted" && item.vote > 0) ||
        (interactionStateFilter === "downvoted" && item.vote < 0) ||
        (interactionStateFilter === "neutral" && item.vote === 0);
      const matchesSearch =
        interactionSearchValue.length === 0 ||
        [item.author, item.entityId, item.entityType, String(item.vote)]
          .join(" ")
          .toLowerCase()
          .includes(interactionSearchValue);
      return matchesEntity && matchesState && matchesSearch;
    });
  }, [
    activity,
    interactionEntityFilter,
    interactionSearchValue,
    interactionStateFilter,
  ]);
  const tabs = useMemo<AdminTab[]>(
    () =>
      [
        {
          id: "overview",
          label: "Overview",
          note: "Command desk",
          count: overview?.totals.openSystemLogs ?? 0,
          icon: PanelsTopLeft,
        },
        {
          id: "forum",
          label: "Forum",
          note: "Boards + mods",
          count:
            forumOverview?.totals?.threads ??
            forumOverview?.recentThreads.length ??
            forumOverview?.totals?.categories ??
            0,
          icon: MessageSquare,
        },
        {
          id: "posts",
          label: "Posts",
          note: "Write archive",
          count: overview?.totals.posts ?? sortedPosts.length,
          icon: FileText,
        },
        {
          id: "api",
          label: "API",
          note: "Keys + routes",
          count: apiKeys?.filter((key) => !key.revokedAt).length ?? 0,
          icon: KeyRound,
        },
        {
          id: "comments",
          label: "Comments",
          note: "Moderation",
          count: comments.length,
          icon: MessageSquare,
        },
        {
          id: "interactions",
          label: "Interactions",
          note: "Votes + saves",
          count: activity.length,
          icon: MousePointer2,
        },
        {
          id: "analytics",
          label: "Analytics",
          note: "Convex events",
          count: overview?.totals.analyticsEventsSample ?? 0,
          icon: BarChart3,
        },
        {
          id: "users",
          label: "Users",
          note: "Roles",
          count: overview?.totals.users ?? 0,
          icon: UsersRound,
        },
        {
          id: "logs",
          label: "Logs",
          note: "Errors",
          count: overview?.totals.openSystemLogs ?? 0,
          icon: Activity,
        },
        {
          id: "newsletter",
          label: "Newsletter",
          note: "Issues + subs",
          count: overview?.totals.confirmedSubscribers ?? 0,
          icon: Mail,
        },
        {
          id: "contact",
          label: "Contact",
          note: "Inbound",
          count: overview?.totals.openContactRequests ?? 0,
          icon: Mail,
        },
        {
          id: "content",
          label: "Content",
          note: "Pages + projects",
          count:
            (overview?.totals.sitePages ?? 0) +
            (overview?.totals.portfolioProjects ?? 0),
          icon: Wrench,
        },
        {
          id: "ai",
          label: "AI",
          note: "Operator",
          icon: Wrench,
        },
        {
          id: "telemetry",
          label: "Telemetry",
          note: "OpenRouter + agents",
          icon: Gauge,
        },
      ].filter(
        (tab): tab is AdminTab =>
          isOwner || !["api", "users", "ai", "telemetry"].includes(tab.id),
      ),
    [
      activity.length,
      apiKeys,
      comments.length,
      forumOverview,
      isOwner,
      overview,
      sortedPosts.length,
    ],
  );

  async function savePost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await upsertPost({
        post: {
          slug: form.slug.trim() || undefined,
          title: form.title,
          excerpt: form.excerpt,
          body: form.body,
          tags: form.tags.split(","),
          status: form.status,
          publishedAt: new Date(`${form.publishedAt}T12:00:00`).getTime(),
          readingMinutes: Number(form.readingMinutes),
          featured: form.featured,
          imageUrl: form.imageUrl.trim() || undefined,
          imageAlt: form.imageAlt.trim() || undefined,
          imageCredit: form.imageCredit.trim() || undefined,
        },
      });
      toast.success("Post saved");
    } catch (error) {
      reportAppError(error, {
        scope: "admin",
        eventType: "post_save_failed",
        component: "AdminDashboard",
        action: "admin:upsertPost",
        metadata: { slug: form.slug.trim() || undefined },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not save post",
      );
    }
  }

  async function uploadPostImage(file: File) {
    if (!file.type.toLowerCase().startsWith("image/")) {
      throw new Error("Choose an image file");
    }
    if (file.size > 8 * 1024 * 1024) {
      throw new Error("Image is too large (max 8 MB)");
    }

    const uploadUrl = await generateUploadUrl({});
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!uploadResponse.ok) {
      throw new Error("Could not upload image to storage");
    }

    const { storageId } = (await uploadResponse.json()) as {
      storageId?: string;
    };
    if (!storageId) {
      throw new Error("Storage did not return an image id");
    }

    const url = await resolveStorageUrl({ storageId });
    if (!url) {
      throw new Error("Could not resolve uploaded image URL");
    }
    return url;
  }

  async function handleCoverImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setUploadingImageTarget("cover");
    try {
      const url = await uploadPostImage(file);
      const fallbackAlt = imageAltFromFilename(file.name);
      setForm((current) => ({
        ...current,
        imageUrl: url,
        imageAlt: current.imageAlt || fallbackAlt,
      }));
      toast.success("Cover image uploaded");
    } catch (error) {
      reportAppError(error, {
        scope: "admin",
        eventType: "post_cover_image_upload_failed",
        component: "AdminDashboard",
        action: "admin:uploadCoverImage",
        metadata: { fileName: file.name, fileSize: file.size },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not upload image",
      );
    } finally {
      setUploadingImageTarget(null);
    }
  }

  async function handleBodyImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setUploadingImageTarget("body");
    try {
      const url = await uploadPostImage(file);
      insertBodyImageMarkdown(url, imageAltFromFilename(file.name));
      toast.success("Image inserted into body");
    } catch (error) {
      reportAppError(error, {
        scope: "admin",
        eventType: "post_body_image_upload_failed",
        component: "AdminDashboard",
        action: "admin:uploadBodyImage",
        metadata: { fileName: file.name, fileSize: file.size },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not insert image",
      );
    } finally {
      setUploadingImageTarget(null);
    }
  }

  function insertBodyImageMarkdown(url: string, alt: string) {
    const textarea = bodyTextareaRef.current;
    const body = form.body;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? start;
    const before = body.slice(0, start);
    const after = body.slice(end);
    const markdown = `![${escapeMarkdownAlt(alt)}](${url})`;
    const leading = before.length > 0 && !before.endsWith("\n") ? "\n\n" : "";
    const trailing = after.length > 0 && !after.startsWith("\n") ? "\n\n" : "";
    const nextBody = `${before}${leading}${markdown}${trailing}${after}`;
    const cursor = `${before}${leading}${markdown}`.length;

    setForm({ ...form, body: nextBody });
    window.requestAnimationFrame(() => {
      bodyTextareaRef.current?.focus();
      bodyTextareaRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  async function removePost(slug: string) {
    if (!window.confirm(`Delete ${slug}?`)) {
      return;
    }
    try {
      await deletePost({ slug });
      if (selectedSlug === slug) {
        setForm(blankPost);
      }
      toast.success("Post deleted");
    } catch (error) {
      reportAppError(error, {
        scope: "admin",
        eventType: "post_delete_failed",
        component: "AdminDashboard",
        action: "admin:deletePost",
        metadata: { slug },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not delete post",
      );
    }
  }

  async function issueApiKey() {
    try {
      const token = createToken();
      const tokenHash = await sha256Hex(token);
      await createApiKey({
        name: apiKeyName,
        tokenHash,
        tokenPreview: `${token.slice(0, 12)}...${token.slice(-6)}`,
      });
      setCreatedToken(token);
      toast.success("API key created");
    } catch (error) {
      reportAppError(error, {
        scope: "admin",
        eventType: "api_key_create_failed",
        component: "AdminDashboard",
        action: "admin:createApiKey",
        metadata: { name: apiKeyName },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not create key",
      );
    }
  }

  return (
    <>
      <AdminTabChrome
        activeTab={activeTab}
        onChange={navigateToTab}
        tabs={tabs}
      />

      <div className="min-h-[42rem]">
        {activeTab === "overview" ? (
          <AdminOverviewPanel
            activeApiKeys={activeApiKeys.length}
            overview={overview}
            onCreatePost={() => {
              setForm(blankPost);
              navigateToTab("posts");
            }}
            tabs={tabs}
            onChange={navigateToTab}
          />
        ) : null}

        {activeTab === "forum" ? <AdminForum /> : null}

        {activeTab === "posts" ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(17rem,0.85fr)_minmax(0,1.6fr)]">
            <section>
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-mono text-xs uppercase text-muted-foreground">
                    Posts
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {overview?.totals.publishedPosts ?? 0} published /{" "}
                    {overview?.totals.posts ?? sortedPosts.length} total
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setForm(blankPost)}
                >
                  <Plus />
                  New
                </Button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_11rem]">
                <Field label="Search archive">
                  <Input
                    value={postSearch}
                    placeholder="title, slug, tag"
                    onChange={(event) => setPostSearch(event.target.value)}
                  />
                </Field>
                <Field label="Status">
                  <NativeSelect
                    value={postStatusFilter}
                    onChange={(event) =>
                      setPostStatusFilter(
                        event.target.value as
                          | "all"
                          | ConvexPostRecord["status"],
                      )
                    }
                  >
                    <option value="all">All statuses</option>
                    <option value="draft">Drafts</option>
                    <option value="published">Published</option>
                  </NativeSelect>
                </Field>
              </div>
              <p className="mt-3 font-mono text-[11px] uppercase text-muted-foreground">
                Showing {filteredPosts.length} of {sortedPosts.length}
              </p>
              <div className="mt-2 divide-y divide-row-border">
                {filteredPosts.map((post) => (
                  <PostListItem
                    key={post._id}
                    post={post}
                    active={post.slug === selectedSlug}
                    onSelect={() => setForm(postToForm(post))}
                    onDelete={() => removePost(post.slug)}
                  />
                ))}
                {posts === undefined ? (
                  <div className="py-5 font-mono text-xs uppercase text-muted-foreground">
                    Loading posts
                  </div>
                ) : null}
                {posts?.length === 0 ? (
                  <div className="py-5 font-mono text-xs uppercase text-muted-foreground">
                    No posts yet
                  </div>
                ) : null}
                {posts !== undefined &&
                posts.length > 0 &&
                filteredPosts.length === 0 ? (
                  <div className="py-5 font-mono text-xs uppercase text-muted-foreground">
                    No posts match the current filters
                  </div>
                ) : null}
              </div>
            </section>

            <section>
              <form onSubmit={savePost} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-xs uppercase text-muted-foreground">
                    Editor
                  </p>
                  <Button type="submit" size="sm">
                    <Save />
                    Save
                  </Button>
                </div>
                <div className="mt-5 grid gap-3">
                  <Field label="Title">
                    <Input
                      value={form.title}
                      onChange={(event) =>
                        setForm({ ...form, title: event.target.value })
                      }
                      required
                    />
                  </Field>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Slug">
                      <Input
                        value={form.slug}
                        placeholder="auto-from-title"
                        onChange={(event) =>
                          setForm({ ...form, slug: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Date">
                      <Input
                        type="date"
                        value={form.publishedAt}
                        onChange={(event) =>
                          setForm({ ...form, publishedAt: event.target.value })
                        }
                        required
                      />
                    </Field>
                  </div>
                  <Field label="Excerpt">
                    <Textarea
                      value={form.excerpt}
                      onChange={(event) =>
                        setForm({ ...form, excerpt: event.target.value })
                      }
                      rows={3}
                      required
                    />
                  </Field>
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[11px] uppercase text-muted-foreground">
                        Markdown body
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          ref={bodyImageInputRef}
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={handleBodyImageUpload}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={uploadingImageTarget !== null}
                          onClick={() => bodyImageInputRef.current?.click()}
                        >
                          <ImagePlus aria-hidden="true" />
                          {uploadingImageTarget === "body"
                            ? "Uploading"
                            : "Insert image"}
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      ref={bodyTextareaRef}
                      value={form.body}
                      onChange={(event) =>
                        setForm({ ...form, body: event.target.value })
                      }
                      rows={12}
                      required
                    />
                    <p className="font-mono text-[10px] uppercase text-muted-foreground">
                      Inserts markdown at the cursor.
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field label="Tags">
                      <Input
                        value={form.tags}
                        placeholder="ai, design"
                        onChange={(event) =>
                          setForm({ ...form, tags: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Minutes">
                      <Input
                        type="number"
                        min={1}
                        max={120}
                        value={form.readingMinutes}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            readingMinutes: Number(event.target.value),
                          })
                        }
                      />
                    </Field>
                    <Field label="Status">
                      <NativeSelect
                        value={form.status}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            status: event.target.value as "draft" | "published",
                          })
                        }
                      >
                        <option value="draft">Draft</option>
                        <option value="published">Published</option>
                      </NativeSelect>
                    </Field>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field label="Image URL">
                      <div className="flex gap-2">
                        <Input
                          value={form.imageUrl}
                          onChange={(event) =>
                            setForm({ ...form, imageUrl: event.target.value })
                          }
                        />
                        <input
                          ref={coverImageInputRef}
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={handleCoverImageUpload}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={uploadingImageTarget !== null}
                          onClick={() => coverImageInputRef.current?.click()}
                        >
                          <Upload aria-hidden="true" />
                          {uploadingImageTarget === "cover"
                            ? "Uploading"
                            : "Upload"}
                        </Button>
                      </div>
                    </Field>
                    <Field label="Image alt">
                      <Input
                        value={form.imageAlt}
                        onChange={(event) =>
                          setForm({ ...form, imageAlt: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Credit">
                      <Input
                        value={form.imageCredit}
                        onChange={(event) =>
                          setForm({ ...form, imageCredit: event.target.value })
                        }
                      />
                    </Field>
                  </div>
                  <label className="flex items-center gap-2 font-mono text-xs uppercase text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={form.featured}
                      onChange={(event) =>
                        setForm({ ...form, featured: event.target.checked })
                      }
                    />
                    Featured
                  </label>
                </div>
              </form>
            </section>
          </div>
        ) : null}

        {isOwner && activeTab === "api" ? (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
            <section className="py-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-mono text-xs uppercase text-muted-foreground">
                    API keys
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {activeApiKeys.length} active / {(apiKeys ?? []).length}{" "}
                    total
                  </p>
                </div>
                <KeyRound className="size-4 text-muted-foreground" />
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Input
                  value={apiKeyName}
                  placeholder="Integration name"
                  onChange={(event) => setApiKeyName(event.target.value)}
                />
                <Button type="button" variant="outline" onClick={issueApiKey}>
                  Issue
                </Button>
              </div>
              {createdToken ? (
                <div className="mt-3 border border-row-border p-3">
                  <p className="font-mono text-[10px] uppercase text-muted-foreground">
                    Token shown once
                  </p>
                  <p className="break-all font-mono text-xs">{createdToken}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Store this token in a server-side secret or password
                    manager. Do not ship it in client bundles or public
                    environment variables.
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(createdToken);
                        toast.success("Token copied");
                      } catch (error) {
                        reportAppError(error, {
                          scope: "admin",
                          eventType: "clipboard_failed",
                          component: "AdminDashboard",
                          action: "copy_api_token",
                          notify: false,
                        });
                        toast.error("Could not copy token");
                      }
                    }}
                  >
                    <Copy />
                    Copy token
                  </Button>
                </div>
              ) : null}
              <ApiKeyList
                apiKeys={apiKeys}
                onRevoke={async (keyId) => {
                  try {
                    await revokeApiKey({ keyId });
                    toast.success("API key revoked");
                  } catch (error) {
                    reportAppError(error, {
                      scope: "admin",
                      eventType: "api_key_revoke_failed",
                      component: "AdminDashboard",
                      action: "admin:revokeApiKey",
                      notify: false,
                    });
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Could not revoke key",
                    );
                  }
                }}
              />
            </section>

            <section className="py-3">
              <div className="border border-row-border p-4">
                <p className="font-mono text-xs uppercase text-muted-foreground">
                  Integration
                </p>
                <div className="mt-4 space-y-3">
                  {adminApiRoutes.map((route) => (
                    <div
                      key={`${route.method}-${route.path}`}
                      className="grid gap-1 border-b border-row-border pb-3 last:border-b-0 last:pb-0"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{route.method}</Badge>
                        <code className="font-mono text-[11px]">
                          {route.path}
                        </code>
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {route.detail}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4 border border-row-border p-4">
                <p className="font-mono text-xs uppercase text-muted-foreground">
                  Key safety
                </p>
                <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
                  <p>
                    Send{" "}
                    <code className="font-mono">
                      Authorization: Bearer token
                    </code>{" "}
                    from trusted server-side tooling only.
                  </p>
                  <p>
                    Rotate keys when a workflow changes hands, and revoke any
                    key you cannot account for.
                  </p>
                  <p>
                    Browser requests to admin endpoints will fail without the
                    bearer token header, so keep automation behind your own
                    server or local scripts.
                  </p>
                </div>
                <pre className="mt-4 overflow-x-auto border border-row-border bg-muted/35 p-3 font-mono text-[11px] leading-5 text-foreground">
                  {`curl /api/admin/posts \\
  -H "Authorization: Bearer $SYMBAIEX_ADMIN_TOKEN"`}
                </pre>
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === "comments" ? (
          <section className="py-3">
            <div className="flex flex-col gap-1">
              <p className="font-mono text-xs uppercase text-muted-foreground">
                Comments
              </p>
              <p className="text-sm text-muted-foreground">
                Owner-only moderation stream, capped to the latest 100 records.
              </p>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_11rem_11rem]">
              <Field label="Search">
                <Input
                  value={commentSearch}
                  placeholder="author, entity, body"
                  onChange={(event) => setCommentSearch(event.target.value)}
                />
              </Field>
              <Field label="Entity">
                <NativeSelect
                  value={commentEntityFilter}
                  onChange={(event) =>
                    setCommentEntityFilter(
                      event.target.value as
                        | "all"
                        | AdminCommentRecord["entityType"],
                    )
                  }
                >
                  <option value="all">All entities</option>
                  <option value="post">Posts</option>
                  <option value="hnStory">News stories</option>
                  <option value="portfolioProject">Projects</option>
                </NativeSelect>
              </Field>
              <Field label="Status">
                <NativeSelect
                  value={commentStatusFilter}
                  onChange={(event) =>
                    setCommentStatusFilter(
                      event.target.value as
                        | "all"
                        | NonNullable<AdminCommentRecord["status"]>,
                    )
                  }
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="hidden">Hidden</option>
                  <option value="deleted">Deleted</option>
                </NativeSelect>
              </Field>
            </div>
            <p className="mt-3 font-mono text-[11px] uppercase text-muted-foreground">
              Showing {filteredComments.length} of {comments.length}
            </p>
            <div className="mt-3 divide-y divide-row-border">
              {filteredComments.map((comment) => (
                <div key={comment._id} className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-[11px] uppercase text-muted-foreground">
                          {comment.author}
                        </p>
                        <Badge variant="outline">
                          {comment.status ?? "active"}
                        </Badge>
                        <Badge variant="outline">{comment.entityType}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase text-muted-foreground">
                        <span>{formatShortDate(comment.createdAt)}</span>
                        <span>{comment.entityId}</span>
                        <Link
                          className="text-foreground underline-offset-4 hover:underline"
                          href={entityHref(
                            comment.entityType,
                            comment.entityId,
                          )}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open entity
                        </Link>
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await deleteComment({ commentId: comment._id });
                          toast.success("Comment deleted");
                        } catch (error) {
                          reportAppError(error, {
                            scope: "admin",
                            eventType: "comment_delete_failed",
                            component: "AdminDashboard",
                            action: "admin:deleteComment",
                            entityType: comment.entityType,
                            entityId: comment.entityId,
                            notify: false,
                          });
                          toast.error("Could not delete comment");
                        }
                      }}
                      aria-label="Delete comment"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <p
                    className={cn(
                      "mt-3 line-clamp-4 text-sm leading-6",
                      comment.status === "deleted"
                        ? "text-muted-foreground"
                        : null,
                    )}
                  >
                    {comment.status === "deleted"
                      ? "Comment deleted"
                      : comment.body}
                  </p>
                </div>
              ))}
              {comments.length === 0 ? (
                <div className="py-5 font-mono text-xs uppercase text-muted-foreground">
                  {adminComments === undefined
                    ? "Loading comments"
                    : "No comments"}
                </div>
              ) : null}
              {comments.length > 0 && filteredComments.length === 0 ? (
                <div className="py-5 font-mono text-xs uppercase text-muted-foreground">
                  No comments match the current filters
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeTab === "interactions" ? (
          <section className="py-3">
            <div className="flex flex-col gap-1">
              <p className="font-mono text-xs uppercase text-muted-foreground">
                Interactions
              </p>
              <p className="text-sm text-muted-foreground">
                Owner-only vote and save stream, capped to the latest 100
                records.
              </p>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_11rem_11rem]">
              <Field label="Search">
                <Input
                  value={interactionSearch}
                  placeholder="author, entity, vote"
                  onChange={(event) => setInteractionSearch(event.target.value)}
                />
              </Field>
              <Field label="Entity">
                <NativeSelect
                  value={interactionEntityFilter}
                  onChange={(event) =>
                    setInteractionEntityFilter(
                      event.target.value as
                        | "all"
                        | AdminInteractionRecord["entityType"],
                    )
                  }
                >
                  <option value="all">All entities</option>
                  <option value="post">Posts</option>
                  <option value="hnStory">News stories</option>
                </NativeSelect>
              </Field>
              <Field label="State">
                <NativeSelect
                  value={interactionStateFilter}
                  onChange={(event) =>
                    setInteractionStateFilter(
                      event.target.value as
                        | "all"
                        | "saved"
                        | "unsaved"
                        | "upvoted"
                        | "downvoted"
                        | "neutral",
                    )
                  }
                >
                  <option value="all">All states</option>
                  <option value="saved">Saved</option>
                  <option value="unsaved">Unsaved</option>
                  <option value="upvoted">Upvoted</option>
                  <option value="downvoted">Downvoted</option>
                  <option value="neutral">Neutral vote</option>
                </NativeSelect>
              </Field>
            </div>
            <p className="mt-3 font-mono text-[11px] uppercase text-muted-foreground">
              Showing {filteredInteractions.length} of {activity.length}
            </p>
            <div className="mt-3 divide-y divide-row-border">
              {filteredInteractions.map((item) => (
                <div
                  key={item._id}
                  className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold">
                        {item.entityId}
                      </p>
                      <Badge variant="outline">{item.entityType}</Badge>
                      <Badge variant={item.vote > 0 ? "default" : "outline"}>
                        vote {item.vote}
                      </Badge>
                      <Badge variant={item.saved ? "default" : "outline"}>
                        {item.saved ? "saved" : "not saved"}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase text-muted-foreground">
                      <span>{item.author}</span>
                      <span>{formatShortDate(item.updatedAt)}</span>
                      <Link
                        className="text-foreground underline-offset-4 hover:underline"
                        href={entityHref(item.entityType, item.entityId)}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open entity
                      </Link>
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await deleteInteraction({ interactionId: item._id });
                        toast.success("Interaction deleted");
                      } catch (error) {
                        reportAppError(error, {
                          scope: "admin",
                          eventType: "interaction_delete_failed",
                          component: "AdminDashboard",
                          action: "admin:deleteInteraction",
                          entityType: item.entityType,
                          entityId: item.entityId,
                          notify: false,
                        });
                        toast.error("Could not delete interaction");
                      }
                    }}
                    aria-label="Delete interaction"
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              {activity.length === 0 ? (
                <div className="py-5 font-mono text-xs uppercase text-muted-foreground">
                  {adminInteractions === undefined
                    ? "Loading interactions"
                    : "No interactions"}
                </div>
              ) : null}
              {activity.length > 0 && filteredInteractions.length === 0 ? (
                <div className="py-5 font-mono text-xs uppercase text-muted-foreground">
                  No interactions match the current filters
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeTab === "analytics" ? <AdminAnalytics /> : null}
        {isOwner && activeTab === "users" ? <AdminUsers /> : null}
        {activeTab === "logs" ? <AdminSystemLogs /> : null}
        {activeTab === "newsletter" ? <AdminNewsletter /> : null}
        {activeTab === "contact" ? <AdminContactRequests /> : null}
        {activeTab === "content" ? <AdminSiteContent /> : null}
        {isOwner && activeTab === "ai" ? <AdminAiChat /> : null}
        {isOwner && activeTab === "telemetry" ? <AdminTelemetry /> : null}
      </div>
    </>
  );
}

function AdminCommandCenter({
  overview,
}: {
  overview: AdminOverviewRecord | undefined;
}) {
  const totals = overview?.totals;
  const rows = [
    ["Posts", totals?.publishedPosts ?? 0, `${totals?.posts ?? 0} total`],
    ["Users", totals?.users ?? 0, `${totals?.owners ?? 0} owner`],
    [
      "Newsletter",
      totals?.confirmedSubscribers ?? 0,
      `${totals?.newsletterSubscribers ?? 0} subscribers`,
    ],
    ["Analytics", totals?.analyticsEventsSample ?? 0, "recent events"],
    ["Logs", totals?.openSystemLogs ?? 0, "open issues"],
    ["Projects", totals?.portfolioProjects ?? 0, "portfolio rows"],
  ] as const;

  return (
    <section className="mb-8">
      <div className="grid gap-x-6 gap-y-4 md:grid-cols-3 lg:grid-cols-6">
        {rows.map(([label, value, note]) => (
          <div key={label} className="py-2">
            <p className="text-3xl font-semibold leading-none">
              {compactNumber(value)}
            </p>
            <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
              {label}
            </p>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {note}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function AdminTabChrome({
  activeTab,
  onChange,
  tabs,
}: {
  activeTab: AdminTabId;
  onChange: (tab: AdminTabId) => void;
  tabs: AdminTab[];
}) {
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  return (
    <div className="sticky top-0 z-30 -mx-4 mb-7 border-b border-row-border bg-background/95 px-4 pb-3 pt-2 backdrop-blur md:-mx-8 md:px-8">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            Admin control deck / {active?.note ?? "Operations"}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            {active?.label ?? "Admin"}
          </h1>
        </div>
        <Link
          className="hidden font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground sm:block"
          href="/"
        >
          Exit console ↗
        </Link>
      </div>
      <div className="md:hidden">
        <Select
          value={activeTab}
          onValueChange={(value) => onChange(value as AdminTabId)}
        >
          <SelectTrigger className="h-12 rounded-none font-mono text-xs uppercase">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" className="rounded-none">
            {tabs.map((tab) => (
              <SelectItem key={tab.id} value={tab.id}>
                {tab.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <nav
        aria-label="Admin sections"
        className="scrollbar-none -mx-1 hidden items-stretch gap-1 overflow-x-auto px-1 md:flex"
      >
        {tabs.map((tab) => {
          const selected = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <Link
              aria-current={selected ? "page" : undefined}
              className={cn(
                "group relative flex shrink-0 items-center gap-2 border border-transparent px-3 py-2.5 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                selected
                  ? "border-row-border bg-foreground/[0.06] text-foreground"
                  : "text-muted-foreground hover:border-row-border hover:text-foreground",
              )}
              href={adminSectionHref(tab.id)}
              key={tab.id}
            >
              <Icon className="size-3.5" />
              <span>{tab.label}</span>
              {tab.count !== undefined && tab.count > 0 ? (
                <span
                  className={cn(
                    "font-mono text-[9px]",
                    selected
                      ? "text-foreground/60"
                      : "text-muted-foreground/60",
                  )}
                >
                  {compactNumber(tab.count)}
                </span>
              ) : null}
              <span
                className={cn(
                  "absolute inset-x-2 -bottom-[0.8rem] h-px bg-transparent transition-colors",
                  selected && "bg-emerald-500",
                )}
              />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function AdminOverviewPanel({
  activeApiKeys,
  overview,
  onCreatePost,
  onChange,
  tabs,
}: {
  activeApiKeys: number;
  overview: AdminOverviewRecord | undefined;
  onCreatePost: () => void;
  onChange: (tab: AdminTabId) => void;
  tabs: AdminTab[];
}) {
  const totals = overview?.totals;
  const healthRows = [
    {
      label: "Publishing",
      status: (totals?.publishedPosts ?? 0) > 0 ? "Ready" : "Needs post",
      note: `${totals?.publishedPosts ?? 0} published of ${totals?.posts ?? 0}`,
      tab: "posts" as const,
    },
    {
      label: "API access",
      status: activeApiKeys > 0 ? "Ready" : "Missing key",
      note:
        activeApiKeys > 0
          ? `${activeApiKeys} active automation key${
              activeApiKeys === 1 ? "" : "s"
            }`
          : "Issue an admin key before wiring external tools",
      tab: "api" as const,
    },
    {
      label: "Moderation",
      status:
        (overview?.recentComments.length ?? 0) > 0 ? "Active" : "Quiet sample",
      note: `${overview?.recentComments.length ?? 0} comments / ${
        overview?.recentInteractions.length ?? 0
      } interactions`,
      tab: "comments" as const,
    },
    {
      label: "System logs",
      status: (totals?.openSystemLogs ?? 0) > 0 ? "Review" : "Clear",
      note:
        (totals?.openSystemLogs ?? 0) > 0
          ? `${totals?.openSystemLogs ?? 0} open issue${
              totals?.openSystemLogs === 1 ? "" : "s"
            }`
          : "No open issues in the current sample",
      tab: "logs" as const,
    },
  ] as const;

  return (
    <section>
      <AdminCommandCenter overview={overview} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <section className="border-y border-row-border py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase text-muted-foreground">
                Health
              </p>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                Use this snapshot to move between publishing, moderation, API,
                and ops without expanding the tab chrome.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {healthRows.map((row) => (
              <button
                className="border border-row-border p-3 text-left transition-colors hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                key={row.label}
                onClick={() => onChange(row.tab)}
                type="button"
              >
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  {row.label}
                </p>
                <p className="mt-2 text-lg font-semibold">{row.status}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {row.note}
                </p>
              </button>
            ))}
          </div>
        </section>

        <section className="border-y border-row-border py-4">
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Quick actions
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" onClick={onCreatePost}>
              <Plus />
              New draft
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onChange("api")}
            >
              <KeyRound />
              Issue key
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onChange("comments")}
            >
              <MessageSquare />
              Review comments
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onChange("interactions")}
            >
              <MousePointer2 />
              Review interactions
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onChange("logs")}
            >
              <Activity />
              Open logs
            </Button>
          </div>
          <div className="mt-4 text-sm leading-6 text-muted-foreground">
            <p>
              Posts, comments, and interactions now expose direct open links so
              moderation and verification can happen without leaving the console
              blind.
            </p>
          </div>
        </section>
      </div>
      <div className="mt-6 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {tabs
          .filter((tab) => tab.id !== "overview")
          .map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3 text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                key={tab.id}
                onClick={() => onChange(tab.id)}
                type="button"
              >
                <Icon className="size-4 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {tab.label}
                  </span>
                  <span className="block truncate font-mono text-[10px] uppercase text-muted-foreground">
                    {tab.note}
                  </span>
                </span>
                <span className="font-mono text-[10px] uppercase text-muted-foreground">
                  {compactNumber(tab.count ?? 0)}
                </span>
              </button>
            );
          })}
      </div>
    </section>
  );
}

function AdminGate({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <section className="border-y border-row-border py-8">
      <p className="font-mono text-xs uppercase text-muted-foreground">Admin</p>
      <h2 className="mt-3 text-3xl font-semibold">{title}</h2>
      <p className="mt-3 max-w-xl leading-7 text-muted-foreground">{body}</p>
      {action ?? (
        <Button asChild className="mt-5">
          <Link href="/signin?mode=signIn&redirectTo=/admin">Sign in</Link>
        </Button>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 text-sm font-medium">
      <span className="font-mono text-[11px] uppercase text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function NativeSelect({
  children,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 border border-input bg-background px-3 text-sm",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

function PostListItem({
  post,
  active,
  onSelect,
  onDelete,
}: {
  post: ConvexPostRecord;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_auto] gap-3 py-3",
        active ? "bg-muted/35" : null,
      )}
    >
      <button className="min-w-0 text-left" type="button" onClick={onSelect}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-base font-semibold">{post.title}</h3>
          <Badge variant={post.status === "published" ? "default" : "outline"}>
            {post.status}
          </Badge>
          {post.featured ? <Badge variant="outline">featured</Badge> : null}
        </div>
        <p className="mt-1 font-mono text-[11px] uppercase text-muted-foreground">
          {formatDate(new Date(post.publishedAt).toISOString())} / {post.slug}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase text-muted-foreground">
          <span>{post.readingMinutes} min</span>
          <span>
            {post.tags.length} tag{post.tags.length === 1 ? "" : "s"}
          </span>
          <Link
            className="text-foreground underline-offset-4 hover:underline"
            href={entityHref("post", post.slug)}
            rel="noreferrer"
            target="_blank"
          >
            Open live
          </Link>
        </div>
      </button>
      <Button
        size="icon"
        variant="ghost"
        onClick={onDelete}
        aria-label={`Delete ${post.title}`}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function ApiKeyList({
  apiKeys,
  onRevoke,
}: {
  apiKeys: AdminApiKeyRecord[] | undefined;
  onRevoke: (keyId: string) => Promise<void>;
}) {
  const rows = useMemo(
    () =>
      [...(apiKeys ?? [])].sort(
        (left, right) => right.createdAt - left.createdAt,
      ),
    [apiKeys],
  );
  return (
    <div className="mt-4 divide-y divide-row-border">
      {rows.map((key) => (
        <div key={key._id} className="py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{key.name}</p>
              <p className="font-mono text-[11px] uppercase text-muted-foreground">
                {key.tokenPreview}
              </p>
            </div>
            {key.revokedAt ? (
              <Badge variant="outline">Revoked</Badge>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRevoke(key._id)}
              >
                Revoke
              </Button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase text-muted-foreground">
            <span>Issued {formatShortDate(key.createdAt)}</span>
            <span>by {key.createdBy}</span>
            <span>
              Last used{" "}
              {key.lastUsedAt
                ? formatDate(new Date(key.lastUsedAt).toISOString())
                : "never"}
            </span>
          </div>
        </div>
      ))}
      {rows.length === 0 ? (
        <div className="py-5 font-mono text-xs uppercase text-muted-foreground">
          No API keys yet
        </div>
      ) : null}
    </div>
  );
}

function postToForm(post: ConvexPostRecord): PostForm {
  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    body: post.body,
    tags: post.tags.join(", "),
    status: post.status,
    publishedAt: new Date(post.publishedAt).toISOString().slice(0, 10),
    readingMinutes: post.readingMinutes,
    featured: post.featured,
    imageUrl: post.imageUrl ?? "",
    imageAlt: post.imageAlt ?? "",
    imageCredit: post.imageCredit ?? "",
  };
}

function imageAltFromFilename(filename: string) {
  const clean = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) {
    return "Blog image";
  }
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function escapeMarkdownAlt(value: string) {
  return value.replace(/[\[\]]/g, "");
}

function createToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `symbaiex_${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function entityHref(entityType: AdminEntityType, entityId: string) {
  switch (entityType) {
    case "post":
      return asRoute(`/blog/${entityId}`);
    case "hnStory":
      return asRoute(`/news/${entityId}`);
    case "portfolioProject":
      return asRoute(`/portfolio/${entityId}`);
    default:
      return asRoute("/");
  }
}

function formatShortDate(timestamp: number) {
  return formatDate(new Date(timestamp).toISOString());
}
