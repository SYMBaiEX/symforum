"use client";

import { AdminAnalytics } from "@/components/admin-analytics";
import { AdminSiteContent } from "@/components/admin-site-content";
import { AdminNewsletter } from "@/components/admin-newsletter";
import { AdminSystemLogs } from "@/components/admin-system-logs";
import { AdminUsers } from "@/components/admin-users";
import { reportAppError } from "@/components/app-error-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  convexRefs,
  type AdminApiKeyRecord,
  type AdminOverviewRecord,
  type ConvexPostRecord,
} from "@/lib/convex-refs";
import { compactNumber, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { Copy, KeyRound, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

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

export function AdminDashboard() {
  const viewer = useQuery(convexRefs.admin.viewer, {});
  const claimInitialOwner = useMutation(convexRefs.admin.claimInitialOwner);

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
        body="Use the owner username to manage posts, activity, and API keys."
      />
    );
  }

  if (!viewer.isOwner) {
    if (!viewer.ownerExists) {
      return (
        <AdminGate
          title="Claim owner access"
          body="No owner exists in this Convex deployment. Claim this account as the initial owner to unlock the console."
          action={
            <Button
              className="mt-5"
              onClick={async () => {
                try {
                  await claimInitialOwner({});
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
          }
        />
      );
    }
    return (
      <AdminGate
        title="Owner access required"
        body="This account is signed in, but it is not the blog owner."
      />
    );
  }

  return <OwnerDashboard />;
}

function OwnerDashboard() {
  const overview = useQuery(convexRefs.admin.overview, {});
  const posts = useQuery(convexRefs.admin.listPosts, {});
  const apiKeys = useQuery(convexRefs.admin.listApiKeys, {});
  const upsertPost = useMutation(convexRefs.admin.upsertPost);
  const deletePost = useMutation(convexRefs.admin.deletePost);
  const createApiKey = useMutation(convexRefs.admin.createApiKey);
  const revokeApiKey = useMutation(convexRefs.admin.revokeApiKey);
  const deleteComment = useMutation(convexRefs.admin.deleteComment);
  const deleteInteraction = useMutation(convexRefs.admin.deleteInteraction);
  const [form, setForm] = useState<PostForm>(blankPost);
  const [apiKeyName, setApiKeyName] = useState("Blog writer");
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const selectedSlug = form.slug.trim();
  const sortedPosts = posts ?? [];
  const activity = overview?.recentInteractions ?? [];
  const comments = overview?.recentComments ?? [];

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
      <AdminCommandCenter overview={overview} />
      <AdminSectionNav />
      <div id="posts" className="grid scroll-mt-24 gap-8 lg:grid-cols-12">
        <section className="lg:col-span-4">
          <div className="flex items-center justify-between border-y border-row-border py-3">
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
          <div className="divide-y divide-row-border">
            {sortedPosts.map((post) => (
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
          </div>
        </section>

        <section className="lg:col-span-5">
          <form onSubmit={savePost} className="border-y border-row-border py-4">
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
              <Field label="Markdown body">
                <Textarea
                  value={form.body}
                  onChange={(event) =>
                    setForm({ ...form, body: event.target.value })
                  }
                  rows={12}
                  required
                />
              </Field>
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
                  <select
                    className="h-10 border border-input bg-background px-3 text-sm"
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
                  </select>
                </Field>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Image URL">
                  <Input
                    value={form.imageUrl}
                    onChange={(event) =>
                      setForm({ ...form, imageUrl: event.target.value })
                    }
                  />
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

        <aside className="flex flex-col gap-8 lg:col-span-3">
          <section id="api" className="scroll-mt-24 border-y border-row-border py-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-xs uppercase text-muted-foreground">
                API keys
              </p>
              <KeyRound className="size-4 text-muted-foreground" />
            </div>
            <div className="mt-4 flex gap-2">
              <Input
                value={apiKeyName}
                onChange={(event) => setApiKeyName(event.target.value)}
              />
              <Button type="button" variant="outline" onClick={issueApiKey}>
                Issue
              </Button>
            </div>
            {createdToken ? (
              <div className="mt-3 border border-row-border p-3">
                <p className="break-all font-mono text-xs">{createdToken}</p>
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

          <section className="border-y border-row-border py-4">
            <p className="font-mono text-xs uppercase text-muted-foreground">
              Integration
            </p>
            <div className="mt-4 space-y-2 font-mono text-[11px] uppercase text-muted-foreground">
              <p>GET /api/admin/posts</p>
              <p>POST /api/admin/posts</p>
              <p>GET /api/admin/posts/[slug]</p>
              <p>PATCH /api/admin/posts/[slug]</p>
              <p>DELETE /api/admin/posts/[slug]</p>
              <p>GET /api/admin/interactions</p>
              <p>GET /api/admin/newsletter/subscribers</p>
              <p>GET /api/admin/newsletter/issues</p>
              <p>POST /api/admin/newsletter/issues</p>
              <p>POST /api/admin/newsletter/issues/[slug]/test</p>
              <p>POST /api/admin/newsletter/issues/[slug]/schedule</p>
              <p>POST /api/admin/newsletter/issues/[slug]/send</p>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Send{" "}
              <code className="font-mono">Authorization: Bearer token</code>{" "}
              from your writing software.
            </p>
          </section>

          <section className="border-y border-row-border py-4">
            <p className="font-mono text-xs uppercase text-muted-foreground">
              Recent comments
            </p>
            <div className="mt-3 divide-y divide-row-border">
              {comments.map((comment) => (
                <div key={comment._id} className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-mono text-[11px] uppercase text-muted-foreground">
                      {comment.author} / {comment.entityType}
                    </p>
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
                  <p className="mt-1 line-clamp-3 text-sm leading-6">
                    {comment.status === "deleted"
                      ? "Comment deleted"
                      : comment.body}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="border-y border-row-border py-4">
            <p className="font-mono text-xs uppercase text-muted-foreground">
              Recent interactions
            </p>
            <div className="mt-3 divide-y divide-row-border">
              {activity.map((item) => (
                <div key={item._id} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{item.entityId}</p>
                    <p className="font-mono text-[11px] uppercase text-muted-foreground">
                      {item.author} / vote {item.vote} /{" "}
                      {item.saved ? "saved" : "not saved"}
                    </p>
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
            </div>
          </section>
        </aside>
      </div>
      <div id="analytics" className="scroll-mt-24">
        <AdminAnalytics />
      </div>
      <div id="users" className="scroll-mt-24">
        <AdminUsers />
      </div>
      <div id="logs" className="scroll-mt-24">
        <AdminSystemLogs />
      </div>
      <div id="newsletter" className="scroll-mt-24">
        <AdminNewsletter />
      </div>
      <div id="site-content" className="scroll-mt-24">
        <AdminSiteContent />
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
            <p className="mt-1 truncate text-xs text-muted-foreground">{note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function AdminSectionNav() {
  const sections = [
    ["Posts", "#posts"],
    ["Analytics", "#analytics"],
    ["Users", "#users"],
    ["Logs", "#logs"],
    ["Newsletter", "#newsletter"],
    ["Content", "#site-content"],
    ["API", "#api"],
  ] as const;

  return (
    <nav className="mb-8 flex flex-wrap gap-1 font-mono text-[10px] uppercase">
      {sections.map(([label, href]) => (
        <Button asChild className="h-7 px-2" key={href} size="sm" variant="outline">
          <Link href={href}>{label}</Link>
        </Button>
      ))}
    </nav>
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
    <label className="flex flex-col gap-2 text-sm font-medium">
      <span className="font-mono text-[11px] uppercase text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
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
        </div>
        <p className="mt-1 font-mono text-[11px] uppercase text-muted-foreground">
          {formatDate(new Date(post.publishedAt).toISOString())} / {post.slug}
        </p>
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
  const rows = useMemo(() => apiKeys ?? [], [apiKeys]);
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
          <p className="mt-1 font-mono text-[11px] uppercase text-muted-foreground">
            Last used{" "}
            {key.lastUsedAt
              ? formatDate(new Date(key.lastUsedAt).toISOString())
              : "never"}
          </p>
        </div>
      ))}
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
