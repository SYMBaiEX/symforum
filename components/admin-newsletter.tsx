"use client";

import { reportAppError } from "@/components/app-error-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  convexRefs,
  type NewsletterIssueRecord,
  type NewsletterSubscriberRecord,
} from "@/lib/convex-refs";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { CalendarClock, Send, TestTube2 } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

type IssueForm = {
  slug: string;
  subject: string;
  previewText: string;
  body: string;
  linkedPostSlug: string;
  scheduledAt: string;
};

const blankIssue: IssueForm = {
  slug: "",
  subject: "",
  previewText: "",
  body: "",
  linkedPostSlug: "",
  scheduledAt: "",
};

export function AdminNewsletter() {
  const subscribers = useQuery(convexRefs.admin.listNewsletterSubscribers, {});
  const issues = useQuery(convexRefs.admin.listNewsletterIssues, {});
  const upsertIssue = useMutation(convexRefs.admin.upsertNewsletterIssue);
  const sendTest = useMutation(convexRefs.admin.sendNewsletterIssueTest);
  const sendNow = useMutation(convexRefs.admin.sendNewsletterIssueNow);
  const scheduleIssue = useMutation(convexRefs.admin.scheduleNewsletterIssue);
  const [form, setForm] = useState<IssueForm>(blankIssue);
  const [testEmail, setTestEmail] = useState("solsymbaiex@gmail.com");

  const subscriberRows = useMemo(() => subscribers ?? [], [subscribers]);
  const issueRows = useMemo(() => issues ?? [], [issues]);
  const selectedSlug = form.slug.trim();

  async function saveIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const saved = await upsertIssue({ issue: formToIssue(form) });
      if (saved) {
        setForm(issueToForm(saved));
      }
      toast.success("Newsletter issue saved");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-newsletter",
        eventType: "issue_save_failed",
        component: "AdminNewsletter",
        action: "newsletter:upsertAdminIssue",
        metadata: { slug: form.slug },
        notify: false,
      });
      toast.error(error instanceof Error ? error.message : "Could not save issue");
    }
  }

  async function testIssue() {
    if (!selectedSlug) {
      toast.error("Save the issue before sending a test");
      return;
    }
    try {
      await sendTest({ slug: selectedSlug, to: testEmail });
      toast.success("Test email queued");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-newsletter",
        eventType: "issue_test_failed",
        component: "AdminNewsletter",
        action: "newsletter:sendAdminIssueTest",
        metadata: { slug: selectedSlug },
        notify: false,
      });
      toast.error(error instanceof Error ? error.message : "Could not send test");
    }
  }

  async function sendIssueNow() {
    if (!selectedSlug) {
      toast.error("Save the issue first");
      return;
    }
    if (!window.confirm(`Send ${selectedSlug} to confirmed subscribers?`)) {
      return;
    }
    try {
      await sendNow({ slug: selectedSlug });
      toast.success("Newsletter send queued");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-newsletter",
        eventType: "issue_send_failed",
        component: "AdminNewsletter",
        action: "newsletter:sendAdminIssueNow",
        metadata: { slug: selectedSlug },
        notify: false,
      });
      toast.error(error instanceof Error ? error.message : "Could not send issue");
    }
  }

  async function scheduleSelectedIssue() {
    if (!selectedSlug || !form.scheduledAt) {
      toast.error("Pick an issue and a schedule time");
      return;
    }
    try {
      await scheduleIssue({
        slug: selectedSlug,
        scheduledAt: new Date(form.scheduledAt).getTime(),
      });
      toast.success("Newsletter issue scheduled");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-newsletter",
        eventType: "issue_schedule_failed",
        component: "AdminNewsletter",
        action: "newsletter:scheduleAdminIssue",
        metadata: { slug: selectedSlug },
        notify: false,
      });
      toast.error(error instanceof Error ? error.message : "Could not schedule issue");
    }
  }

  return (
    <section className="mt-10 grid gap-8 lg:grid-cols-12">
      <div className="lg:col-span-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase text-muted-foreground">
              Newsletter
            </p>
            <h2 className="mt-1 text-2xl font-semibold">Issues</h2>
          </div>
          <Button size="sm" variant="outline" onClick={() => setForm(blankIssue)}>
            New
          </Button>
        </div>
        <div className="mt-5 grid gap-2">
          {issueRows.map((issue) => (
            <IssueButton
              active={issue.slug === selectedSlug}
              issue={issue}
              key={issue._id}
              onSelect={() => setForm(issueToForm(issue))}
            />
          ))}
          {issues === undefined ? <StatusLine>Loading issues</StatusLine> : null}
          {issues?.length === 0 ? <StatusLine>No issues yet</StatusLine> : null}
        </div>
      </div>

      <form onSubmit={saveIssue} className="lg:col-span-5">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Editor
          </p>
          <Button type="submit" size="sm">
            Save
          </Button>
        </div>
        <div className="mt-4 grid gap-3">
          <Field label="Subject">
            <Input
              value={form.subject}
              onChange={(event) =>
                setForm({ ...form, subject: event.target.value })
              }
              required
            />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Slug">
              <Input
                value={form.slug}
                onChange={(event) =>
                  setForm({ ...form, slug: event.target.value })
                }
                placeholder="auto-from-subject"
              />
            </Field>
            <Field label="Linked post">
              <Input
                value={form.linkedPostSlug}
                onChange={(event) =>
                  setForm({ ...form, linkedPostSlug: event.target.value })
                }
                placeholder="optional-post-slug"
              />
            </Field>
          </div>
          <Field label="Preview">
            <Input
              value={form.previewText}
              onChange={(event) =>
                setForm({ ...form, previewText: event.target.value })
              }
              required
            />
          </Field>
          <Field label="Markdown body">
            <Textarea
              value={form.body}
              onChange={(event) => setForm({ ...form, body: event.target.value })}
              rows={10}
              required
            />
          </Field>
        </div>
      </form>

      <aside className="lg:col-span-3">
        <p className="font-mono text-xs uppercase text-muted-foreground">
          Controls
        </p>
        <div className="mt-4 grid gap-2">
          <Input
            value={testEmail}
            onChange={(event) => setTestEmail(event.target.value)}
            placeholder="test@domain.com"
          />
          <Button size="sm" variant="outline" onClick={testIssue}>
            <TestTube2 aria-hidden="true" />
            Send test
          </Button>
          <Input
            type="datetime-local"
            value={form.scheduledAt}
            onChange={(event) =>
              setForm({ ...form, scheduledAt: event.target.value })
            }
          />
          <Button size="sm" variant="outline" onClick={scheduleSelectedIssue}>
            <CalendarClock aria-hidden="true" />
            Schedule
          </Button>
          <Button size="sm" onClick={sendIssueNow}>
            <Send aria-hidden="true" />
            Send now
          </Button>
        </div>
        <SubscriberSummary subscribers={subscriberRows} />
      </aside>
    </section>
  );
}

function IssueButton({
  active,
  issue,
  onSelect,
}: {
  active: boolean;
  issue: NewsletterIssueRecord;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "grid gap-1 px-2 py-2 text-left hover:bg-muted/35",
        active ? "bg-muted/35" : null,
      )}
    >
      <span className="truncate text-sm font-semibold">{issue.subject}</span>
      <span className="font-mono text-[10px] uppercase text-muted-foreground">
        {issue.status} / {formatDate(issue.updatedAt)}
      </span>
    </button>
  );
}

function SubscriberSummary({
  subscribers,
}: {
  subscribers: NewsletterSubscriberRecord[];
}) {
  const confirmed = subscribers.filter((row) => row.status === "confirmed").length;
  return (
    <div className="mt-8">
      <p className="font-mono text-xs uppercase text-muted-foreground">
        Subscribers
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 font-mono text-xs uppercase">
        <div>
          <p className="text-2xl font-semibold">{confirmed}</p>
          <p className="text-muted-foreground">Confirmed</p>
        </div>
        <div>
          <p className="text-2xl font-semibold">{subscribers.length}</p>
          <p className="text-muted-foreground">Total</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {subscribers.slice(0, 8).map((subscriber) => (
          <div
            key={subscriber._id}
            className="grid gap-1 font-mono text-[10px] uppercase text-muted-foreground"
          >
            <span className="truncate">{subscriber.email}</span>
            <span>
              {subscriber.status} / {subscriber.resendSyncStatus}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-mono text-[11px] uppercase text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function StatusLine({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-xs uppercase text-muted-foreground">
      {children}
    </p>
  );
}

function formToIssue(form: IssueForm) {
  return {
    slug: form.slug.trim() || undefined,
    subject: form.subject,
    previewText: form.previewText,
    body: form.body,
    linkedPostSlug: form.linkedPostSlug.trim() || undefined,
    scheduledAt: form.scheduledAt
      ? new Date(form.scheduledAt).getTime()
      : undefined,
  };
}

function issueToForm(issue: NewsletterIssueRecord): IssueForm {
  return {
    slug: issue.slug,
    subject: issue.subject,
    previewText: issue.previewText,
    body: issue.body,
    linkedPostSlug: issue.linkedPostSlug ?? "",
    scheduledAt: issue.scheduledAt
      ? new Date(issue.scheduledAt).toISOString().slice(0, 16)
      : "",
  };
}
