"use client";

import { reportAppError } from "@/components/app-error-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  convexRefs,
  type DailyNewsletterRunRecord,
  type DailyNewsletterSettingsRecord,
  type NewsletterSendLogRecord,
  type NewsletterEditorialAnalyticsRecord,
  type NewsletterIssueRecord,
  type NewsletterSubscriberRecord,
} from "@/lib/convex-refs";
import {
  parseEditorialNewsletterPayload,
  type EditorialNewsletterPayload,
} from "@/convex/newsletterPayload";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { CalendarClock, Send, TestTube2 } from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

type IssueForm = {
  slug: string;
  subject: string;
  previewText: string;
  body: string;
  linkedPostSlug: string;
};

type IssueFilter = "all" | NewsletterIssueRecord["status"];
type SubscriberFilter = "all" | NewsletterSubscriberRecord["status"];
type DailySettingsForm = Omit<DailyNewsletterSettingsRecord, "cron">;

const ISSUE_FILTERS: IssueFilter[] = [
  "all",
  "draft",
  "scheduled",
  "sent",
  "failed",
  "cancelled",
];

const SUBSCRIBER_FILTERS: SubscriberFilter[] = [
  "all",
  "confirmed",
  "pending",
  "unsubscribed",
  "bounced",
];

const blankIssue: IssueForm = {
  slug: "",
  subject: "",
  previewText: "",
  body: "",
  linkedPostSlug: "",
};

export function AdminNewsletter() {
  const subscribers = useQuery(convexRefs.admin.listNewsletterSubscribers, {});
  const issues = useQuery(convexRefs.admin.listNewsletterIssues, {});
  const dailySettings = useQuery(convexRefs.admin.dailyNewsletterSettings, {});
  const dailyRuns = useQuery(convexRefs.admin.listDailyNewsletterRuns, {});
  const dailySendLogs = useQuery(convexRefs.admin.listNewsletterSendLogs, {});
  const editorialAnalytics = useQuery(
    convexRefs.admin.newsletterEditorialAnalytics,
    {},
  );
  const upsertIssue = useMutation(convexRefs.admin.upsertNewsletterIssue);
  const sendTest = useMutation(convexRefs.admin.sendNewsletterIssueTest);
  const sendNow = useMutation(convexRefs.admin.sendNewsletterIssueNow);
  const scheduleIssue = useMutation(convexRefs.admin.scheduleNewsletterIssue);
  const cancelIssue = useMutation(convexRefs.admin.cancelNewsletterIssue);
  const updateDailySettings = useMutation(
    convexRefs.admin.updateDailyNewsletterSettings,
  );
  const queueDailyNewsletter = useMutation(
    convexRefs.admin.queueDailyNewsletter,
  );
  const queueWeeklyFieldNote = useMutation(
    convexRefs.admin.queueWeeklyFieldNote,
  );
  const [form, setForm] = useState<IssueForm>(blankIssue);
  const [dailyForm, setDailyForm] = useState<DailySettingsForm>({
    enabled: true,
    testMode: false,
    reviewRequired: false,
    weeklyEnabled: true,
    weeklyReviewRequired: false,
    timeZone: "America/Chicago",
    sendTimeLocal: "07:15",
    maxIndexedArticles: 40,
    maxNewsletterStories: 8,
    siteUrl: "https://symbaiex.com",
  });
  const [scheduleAt, setScheduleAt] = useState("");
  const [testEmail, setTestEmail] = useState("solsymbaiex@gmail.com");
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("all");
  const [subscriberFilter, setSubscriberFilter] =
    useState<SubscriberFilter>("all");

  useEffect(() => {
    if (!dailySettings) {
      return;
    }
    setDailyForm({
      enabled: dailySettings.enabled,
      testMode: dailySettings.testMode,
      reviewRequired: dailySettings.reviewRequired,
      weeklyEnabled: dailySettings.weeklyEnabled,
      weeklyReviewRequired: dailySettings.weeklyReviewRequired,
      timeZone: dailySettings.timeZone,
      sendTimeLocal: dailySettings.sendTimeLocal,
      maxIndexedArticles: dailySettings.maxIndexedArticles,
      maxNewsletterStories: dailySettings.maxNewsletterStories,
      siteUrl: dailySettings.siteUrl,
    });
  }, [dailySettings]);

  const subscriberRows = useMemo(() => subscribers ?? [], [subscribers]);
  const issueRows = useMemo(() => issues ?? [], [issues]);
  const dailyRunRows = useMemo(() => dailyRuns ?? [], [dailyRuns]);
  const dailySendLogRows = useMemo(() => dailySendLogs ?? [], [dailySendLogs]);
  const selectedSlug = form.slug.trim();
  const selectedIssue = useMemo(
    () => issueRows.find((issue) => issue.slug === selectedSlug) ?? null,
    [issueRows, selectedSlug],
  );
  const selectedEditorialPayload = useMemo(
    () => parseEditorialNewsletterPayload(form.body),
    [form.body],
  );
  const confirmedSubscribers = subscriberRows.filter(
    (row) => row.status === "confirmed",
  ).length;
  const filteredIssues = useMemo(
    () =>
      issueRows.filter((issue) =>
        issueFilter === "all" ? true : issue.status === issueFilter,
      ),
    [issueFilter, issueRows],
  );
  const filteredSubscribers = useMemo(
    () =>
      subscriberRows.filter((subscriber) =>
        subscriberFilter === "all"
          ? true
          : subscriber.status === subscriberFilter,
      ),
    [subscriberFilter, subscriberRows],
  );
  const issueCounts = useMemo(
    () => countIssuesByStatus(issueRows),
    [issueRows],
  );
  const subscriberCounts = useMemo(
    () => countSubscribersByStatus(subscriberRows),
    [subscriberRows],
  );
  const syncCounts = useMemo(
    () => countSubscribersBySync(subscriberRows),
    [subscriberRows],
  );
  const canRunIssueActions = selectedIssue !== null;
  const canSendNow = selectedIssue !== null && selectedIssue.status !== "sent";
  const canCancel =
    selectedIssue !== null &&
    selectedIssue.status !== "sent" &&
    selectedIssue.status !== "cancelled";
  const canSchedule =
    selectedIssue !== null &&
    selectedIssue.status !== "sent" &&
    scheduleAt.trim().length > 0;

  function resetDraft() {
    setForm(blankIssue);
    setScheduleAt("");
  }

  function selectIssue(issue: NewsletterIssueRecord) {
    setForm(issueToForm(issue));
    setScheduleAt(
      issue.scheduledAt ? timestampToLocalInput(issue.scheduledAt) : "",
    );
  }

  async function saveIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const saved = await upsertIssue({
        issue: formToIssue(form, selectedIssue?.status),
      });
      if (saved) {
        selectIssue(saved);
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
      toast.error(
        error instanceof Error ? error.message : "Could not save issue",
      );
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
      toast.error(
        error instanceof Error ? error.message : "Could not send test",
      );
    }
  }

  async function sendIssueNow() {
    if (!selectedSlug) {
      toast.error("Save the issue first");
      return;
    }
    if (
      !window.confirm(
        `Queue ${selectedSlug} for ${confirmedSubscribers} confirmed subscriber${
          confirmedSubscribers === 1 ? "" : "s"
        }?`,
      )
    ) {
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
      toast.error(
        error instanceof Error ? error.message : "Could not send issue",
      );
    }
  }

  async function scheduleSelectedIssue() {
    if (!selectedSlug || !scheduleAt) {
      toast.error("Pick an issue and a schedule time");
      return;
    }
    try {
      await scheduleIssue({
        slug: selectedSlug,
        scheduledAt: new Date(scheduleAt).getTime(),
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
      toast.error(
        error instanceof Error ? error.message : "Could not schedule issue",
      );
    }
  }

  async function cancelSelectedIssue() {
    if (!selectedSlug) {
      toast.error("Pick an issue first");
      return;
    }
    if (!window.confirm(`Cancel scheduled delivery for ${selectedSlug}?`)) {
      return;
    }
    try {
      await cancelIssue({ slug: selectedSlug });
      toast.success("Scheduled issue cancelled");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-newsletter",
        eventType: "issue_cancel_failed",
        component: "AdminNewsletter",
        action: "newsletter:cancelAdminIssue",
        metadata: { slug: selectedSlug },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not cancel issue",
      );
    }
  }

  async function saveDailySettings() {
    try {
      const updated = await updateDailySettings(dailyForm);
      setDailyForm({
        enabled: updated.enabled,
        testMode: updated.testMode,
        reviewRequired: updated.reviewRequired,
        weeklyEnabled: updated.weeklyEnabled,
        weeklyReviewRequired: updated.weeklyReviewRequired,
        timeZone: updated.timeZone,
        sendTimeLocal: updated.sendTimeLocal,
        maxIndexedArticles: updated.maxIndexedArticles,
        maxNewsletterStories: updated.maxNewsletterStories,
        siteUrl: updated.siteUrl,
      });
      toast.success("Daily newsletter settings saved");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-newsletter",
        eventType: "daily_settings_failed",
        component: "AdminNewsletter",
        action: "dailyNewsletter:updateAdminSettings",
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not save settings",
      );
    }
  }

  async function queueDailyRun(testMode: boolean) {
    try {
      await queueDailyNewsletter({
        force: true,
        sendEnabled: testMode ? false : dailyForm.enabled,
        testMode,
      });
      toast.success(testMode ? "Daily dry run queued" : "Daily send queued");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-newsletter",
        eventType: "daily_queue_failed",
        component: "AdminNewsletter",
        action: "dailyNewsletter:queueAdminDailyNewsletter",
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not queue daily run",
      );
    }
  }

  async function queueWeeklyRun() {
    try {
      await queueWeeklyFieldNote({ force: true });
      toast.success("Weekly field note draft queued");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-newsletter",
        eventType: "weekly_queue_failed",
        component: "AdminNewsletter",
        action: "dailyNewsletter:queueAdminWeeklyFieldNote",
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not queue weekly draft",
      );
    }
  }

  return (
    <>
      <DailyAutomationPanel
        logs={dailySendLogRows}
        onQueueLive={() => queueDailyRun(false)}
        onQueueTest={() => queueDailyRun(true)}
        onQueueWeekly={queueWeeklyRun}
        onSave={saveDailySettings}
        runs={dailyRunRows}
        settings={dailySettings}
        value={dailyForm}
        onChange={setDailyForm}
      />
      <EditorialAnalyticsPanel rows={editorialAnalytics ?? []} />
      <section className="mt-6 grid gap-6 xl:grid-cols-12">
        <div className="xl:col-span-4">
          <div className="rounded-xl border bg-background p-4 sm:p-5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase text-muted-foreground">
                  Newsletter
                </p>
                <h2 className="mt-1 text-2xl font-semibold">Issues</h2>
              </div>
              <Button size="sm" variant="outline" onClick={resetDraft}>
                New
              </Button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {ISSUE_FILTERS.map((filter) => (
                <FilterChip
                  active={issueFilter === filter}
                  key={filter}
                  onClick={() => setIssueFilter(filter)}
                >
                  {labelFromFilter(filter)}{" "}
                  <span className="text-muted-foreground">
                    {filter === "all"
                      ? issueRows.length
                      : (issueCounts[filter] ?? 0)}
                  </span>
                </FilterChip>
              ))}
            </div>
            <div className="mt-4 grid max-h-[28rem] gap-2 overflow-y-auto pr-1">
              {filteredIssues.map((issue) => (
                <IssueButton
                  active={issue.slug === selectedSlug}
                  issue={issue}
                  key={issue._id}
                  onSelect={() => selectIssue(issue)}
                />
              ))}
              {issues === undefined ? (
                <StatusLine>Loading issues</StatusLine>
              ) : null}
              {issues?.length === 0 ? (
                <StatusLine>No issues yet</StatusLine>
              ) : null}
              {issues !== undefined &&
              issues.length > 0 &&
              filteredIssues.length === 0 ? (
                <StatusLine>No issues match this filter</StatusLine>
              ) : null}
            </div>
          </div>
        </div>

        <form onSubmit={saveIssue} className="xl:col-span-5">
          <div className="rounded-xl border bg-background p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase text-muted-foreground">
                  Editor
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold">
                    {selectedIssue ? selectedIssue.subject : "New issue"}
                  </h3>
                  {selectedIssue ? (
                    <IssueStatusBadge status={selectedIssue.status} />
                  ) : (
                    <Badge variant="outline">Unsaved</Badge>
                  )}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {selectedIssue
                    ? `Updated ${formatDateTime(selectedIssue.updatedAt)}`
                    : "Draft the editorial content here, then use delivery controls once it is saved."}
                </p>
              </div>
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
              <Field
                label={
                  selectedEditorialPayload
                    ? "Generated editorial package"
                    : "Markdown body"
                }
              >
                <Textarea
                  value={form.body}
                  onChange={(event) =>
                    setForm({ ...form, body: event.target.value })
                  }
                  rows={14}
                  required
                />
              </Field>
              {selectedEditorialPayload ? (
                <EditorialDraftPreview
                  payload={selectedEditorialPayload}
                  slug={selectedIssue?.slug}
                />
              ) : null}
            </div>
          </div>
        </form>

        <div className="grid gap-6 xl:col-span-3">
          <aside className="rounded-xl border bg-background p-4 sm:p-5">
            <p className="font-mono text-xs uppercase text-muted-foreground">
              Delivery
            </p>
            <div className="mt-4 rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono uppercase">
                  {selectedIssue?.slug || "unsaved"}
                </Badge>
                {selectedIssue ? (
                  <IssueStatusBadge status={selectedIssue.status} />
                ) : null}
              </div>
              <p className="mt-2 text-sm font-medium">
                {selectedIssue?.subject ||
                  "Save an issue to unlock send controls"}
              </p>
              <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                <ControlFact
                  label="Audience"
                  value={`${confirmedSubscribers} confirmed / ${subscriberRows.length} total`}
                />
                <ControlFact
                  label="Scheduled"
                  value={
                    selectedIssue?.scheduledAt
                      ? formatDateTime(selectedIssue.scheduledAt)
                      : "Not scheduled"
                  }
                />
                <ControlFact
                  label="Sent"
                  value={
                    selectedIssue?.sentAt
                      ? formatDateTime(selectedIssue.sentAt)
                      : "Not sent"
                  }
                />
              </div>
              {selectedIssue?.errorMessage ? (
                <p className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {selectedIssue.errorMessage}
                </p>
              ) : null}
            </div>

            <div className="mt-4 grid gap-4">
              <Field label="Test recipient">
                <Input
                  value={testEmail}
                  onChange={(event) => setTestEmail(event.target.value)}
                  placeholder="test@domain.com"
                />
              </Field>
              <Button
                size="sm"
                variant="outline"
                onClick={testIssue}
                disabled={!canRunIssueActions}
              >
                <TestTube2 aria-hidden="true" />
                Send test
              </Button>

              <Field label="Schedule send">
                <Input
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(event) => setScheduleAt(event.target.value)}
                />
              </Field>
              <p className="-mt-2 text-xs text-muted-foreground">
                Uses your local timezone in the browser. Saving the editor does
                not queue delivery.
              </p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={scheduleSelectedIssue}
                  disabled={!canSchedule}
                >
                  <CalendarClock aria-hidden="true" />
                  Schedule
                </Button>
                <Button size="sm" onClick={sendIssueNow} disabled={!canSendNow}>
                  <Send aria-hidden="true" />
                  {selectedIssue?.status === "scheduled"
                    ? "Send immediately"
                    : "Send now"}
                </Button>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={cancelSelectedIssue}
                disabled={!canCancel}
              >
                Cancel schedule
              </Button>
            </div>
          </aside>

          <SubscriberSummary
            counts={subscriberCounts}
            filter={subscriberFilter}
            filteredSubscribers={filteredSubscribers}
            onFilterChange={setSubscriberFilter}
            subscribers={subscriberRows}
            syncCounts={syncCounts}
          />
        </div>
      </section>
    </>
  );
}

function EditorialAnalyticsPanel({
  rows,
}: {
  rows: NewsletterEditorialAnalyticsRecord[];
}) {
  const sent = rows.filter((row) => row.status === "sent");
  const delivered = sent.reduce((sum, row) => sum + row.delivered, 0);
  const opened = sent.reduce((sum, row) => sum + row.opened, 0);
  const clicked = sent.reduce((sum, row) => sum + row.clicked, 0);
  const replies = sent.reduce((sum, row) => sum + row.forumReplies, 0);
  const saves = sent.reduce((sum, row) => sum + row.saves, 0);
  return (
    <section className="mt-6 rounded-xl border bg-background p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Editorial performance
          </p>
          <h2 className="mt-1 text-2xl font-semibold">
            Quality and reader signal
          </h2>
        </div>
        <p className="max-w-xl text-xs leading-5 text-muted-foreground">
          Opens are provider-reported and can be incomplete. On-site clicks,
          archive reads, and forum replies are first-party signals.
        </p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <MetricTile label="Delivered" value={delivered} />
        <MetricTile label="Reported opens" value={opened} />
        <MetricTile label="Tracked clicks" value={clicked} />
        <MetricTile label="Forum replies" value={replies} />
        <MetricTile label="Story saves" value={saves} />
      </div>
      <div className="mt-4 max-h-72 overflow-y-auto border-y border-row-border">
        {rows.slice(0, 20).map((row) => (
          <div
            className="grid gap-2 border-b border-row-border py-3 text-xs last:border-b-0 md:grid-cols-[minmax(0,1fr)_5rem_repeat(5,4.2rem)] md:items-center"
            key={row.issueId}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{row.subject}</p>
              <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
                {row.edition?.replaceAll("-", " ") ?? "manual"} / {row.status}
              </p>
            </div>
            <span className="font-mono text-muted-foreground">
              Q {row.qualityScore ?? "—"}
            </span>
            <AnalyticsFact label="Delivered" value={row.delivered} />
            <AnalyticsFact label="Opens" value={row.opened} />
            <AnalyticsFact label="Clicks" value={row.clicked} />
            <AnalyticsFact label="Replies" value={row.forumReplies} />
            <AnalyticsFact label="Saves" value={row.saves} />
          </div>
        ))}
        {rows.length === 0 ? (
          <div className="py-5">
            <StatusLine>No editorial analytics yet</StatusLine>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AnalyticsFact({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex justify-between gap-2 md:block">
      <span className="font-mono text-[9px] uppercase text-muted-foreground md:block">
        {label}
      </span>
      <span className="font-medium md:mt-1 md:block">{value}</span>
    </span>
  );
}

function EditorialDraftPreview({
  payload,
  slug,
}: {
  payload: EditorialNewsletterPayload;
  slug?: string;
}) {
  return (
    <div className="border border-row-border bg-muted/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase text-accent-canary">
          Rendered review
        </p>
        <div className="flex flex-wrap gap-2 font-mono text-[10px] uppercase text-muted-foreground">
          <span>Quality {payload.quality.score}/100</span>
          <span>/</span>
          <span>{payload.stories.length} sources</span>
          <span>/</span>
          <span>{payload.edition.replaceAll("-", " ")}</span>
        </div>
      </div>
      <h4 className="mt-3 text-xl font-semibold">{payload.headline}</h4>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {payload.dek}
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {payload.stories.map((story) => (
          <div className="border border-row-border p-3" key={story.hnItemId}>
            <p className="line-clamp-2 text-sm font-medium">{story.title}</p>
            <p className="mt-2 font-mono text-[9px] uppercase text-muted-foreground">
              {story.host ?? "HN"} / signal {story.signalScore}
            </p>
          </div>
        ))}
      </div>
      {slug ? (
        <p className="mt-3 text-xs text-muted-foreground">
          The public archive URL becomes /newsletter/{slug} after this issue is
          sent.
        </p>
      ) : null}
    </div>
  );
}

function DailyAutomationPanel({
  logs,
  onChange,
  onQueueLive,
  onQueueTest,
  onQueueWeekly,
  onSave,
  runs,
  settings,
  value,
}: {
  logs: NewsletterSendLogRecord[];
  onChange: (value: DailySettingsForm) => void;
  onQueueLive: () => void;
  onQueueTest: () => void;
  onQueueWeekly: () => void;
  onSave: () => void;
  runs: DailyNewsletterRunRecord[];
  settings: DailyNewsletterSettingsRecord | undefined;
  value: DailySettingsForm;
}) {
  const latestRun = runs[0];
  const latestLog = logs[0];
  return (
    <section className="mt-10 grid gap-4 rounded-xl border bg-background p-4 sm:p-5 xl:grid-cols-[1.2fr_0.8fr]">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase text-muted-foreground">
              Daily automation
            </p>
            <h2 className="mt-1 text-2xl font-semibold">
              Belle editorial desk
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onQueueTest}>
              Draft daily
            </Button>
            <Button size="sm" variant="outline" onClick={onQueueWeekly}>
              Draft weekly
            </Button>
            <Button size="sm" onClick={onQueueLive}>
              Run daily
            </Button>
          </div>
        </div>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          Convex refreshes Hacker News at{" "}
          {settings?.cron.hnRefreshUtc ?? "0 11 * * *"} UTC and checks the
          newsletter schedule with{" "}
          {settings?.cron.scheduleCheckUtc ?? "*/15 * * * *"}. Belle researches
          the indexed source packet, writes a source-linked editorial package,
          and sends it automatically after it passes the quality gate. Weekly
          field notes run at{" "}
          {settings?.cron.weeklyFieldNoteUtc ?? "30 13 * * 0"} UTC. Review holds
          are emergency brakes, not required approvals.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <ToggleField
            checked={value.enabled}
            label="Sending enabled"
            onChange={(enabled) => onChange({ ...value, enabled })}
          />
          <ToggleField
            checked={value.testMode}
            label="Test mode"
            onChange={(testMode) => onChange({ ...value, testMode })}
          />
          <ToggleField
            checked={value.reviewRequired}
            label="Hold daily for review"
            onChange={(reviewRequired) =>
              onChange({ ...value, reviewRequired })
            }
          />
          <ToggleField
            checked={value.weeklyEnabled}
            label="Weekly enabled"
            onChange={(weeklyEnabled) => onChange({ ...value, weeklyEnabled })}
          />
          <ToggleField
            checked={value.weeklyReviewRequired}
            label="Hold weekly for review"
            onChange={(weeklyReviewRequired) =>
              onChange({ ...value, weeklyReviewRequired })
            }
          />
          <Field label="Timezone">
            <Input
              value={value.timeZone}
              onChange={(event) =>
                onChange({ ...value, timeZone: event.target.value })
              }
            />
          </Field>
          <Field label="Daily send time">
            <Input
              type="time"
              value={value.sendTimeLocal}
              onChange={(event) =>
                onChange({ ...value, sendTimeLocal: event.target.value })
              }
            />
          </Field>
          <Field label="Indexed stories">
            <Input
              type="number"
              min={5}
              max={100}
              value={value.maxIndexedArticles}
              onChange={(event) =>
                onChange({
                  ...value,
                  maxIndexedArticles: Number(event.target.value),
                })
              }
            />
          </Field>
          <Field label="Site URL">
            <Input
              value={value.siteUrl}
              onChange={(event) =>
                onChange({ ...value, siteUrl: event.target.value })
              }
            />
          </Field>
        </div>
        <Button className="mt-4" size="sm" onClick={onSave}>
          Save automation
        </Button>
      </div>
      <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 text-sm">
        <p className="font-mono text-[11px] uppercase text-muted-foreground">
          Latest run
        </p>
        {latestRun ? (
          <>
            <ControlFact label="Date" value={latestRun.runDate} />
            <ControlFact label="Status" value={latestRun.status} />
            <ControlFact label="Mode" value={latestRun.mode} />
            <ControlFact
              label="Stories"
              value={`${latestRun.topStoryIds.length}/${latestRun.storyCount}`}
            />
            <ControlFact
              label="Quality"
              value={
                latestRun.qualityScore === undefined
                  ? "Pending"
                  : `${latestRun.qualityScore}/100`
              }
            />
            <ControlFact
              label="AI tokens"
              value={
                latestRun.inputTokens === undefined
                  ? "Pending"
                  : `${latestRun.inputTokens.toLocaleString()} in / ${(latestRun.outputTokens ?? 0).toLocaleString()} out`
              }
            />
            <ControlFact
              label="Started"
              value={formatDateTime(latestRun.startedAt)}
            />
            {latestRun.errorMessage ? (
              <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {latestRun.errorMessage}
              </p>
            ) : null}
          </>
        ) : (
          <StatusLine>No daily runs recorded yet</StatusLine>
        )}
        {latestLog ? (
          <p className="border-t pt-3 text-xs text-muted-foreground">
            Last send log: {latestLog.status} on{" "}
            {formatDateTime(latestLog.createdAt)}
          </p>
        ) : null}
      </div>
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
        "rounded-lg border p-3 text-left transition hover:border-foreground/30 hover:bg-muted/20",
        active ? "border-foreground/40 bg-muted/30" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{issue.subject}</p>
          <p className="mt-1 truncate font-mono text-[11px] uppercase text-muted-foreground">
            {issue.slug}
          </p>
        </div>
        <IssueStatusBadge status={issue.status} />
      </div>
      <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
        {issue.edition ? (
          <span>
            {issue.edition.replaceAll("-", " ")}
            {issue.qualityScore === undefined
              ? ""
              : ` / quality ${issue.qualityScore}`}
          </span>
        ) : null}
        <span>Updated {formatDate(issue.updatedAt)}</span>
        <span>
          {issue.sentAt
            ? `Sent ${formatDate(issue.sentAt)}`
            : issue.scheduledAt
              ? `Scheduled ${formatDateTime(issue.scheduledAt)}`
              : "Not scheduled"}
        </span>
      </div>
      {issue.errorMessage ? (
        <p className="mt-3 line-clamp-2 text-xs text-destructive">
          {issue.errorMessage}
        </p>
      ) : null}
    </button>
  );
}

function SubscriberSummary({
  counts,
  filter,
  filteredSubscribers,
  onFilterChange,
  subscribers,
  syncCounts,
}: {
  counts: Record<NewsletterSubscriberRecord["status"], number>;
  filter: SubscriberFilter;
  filteredSubscribers: NewsletterSubscriberRecord[];
  onFilterChange: (filter: SubscriberFilter) => void;
  subscribers: NewsletterSubscriberRecord[];
  syncCounts: Record<NewsletterSubscriberRecord["resendSyncStatus"], number>;
}) {
  return (
    <aside className="rounded-xl border bg-background p-4 sm:p-5">
      <p className="font-mono text-xs uppercase text-muted-foreground">
        Subscribers
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 xl:grid-cols-2">
        <MetricTile label="Confirmed" value={counts.confirmed} />
        <MetricTile label="Pending" value={counts.pending} />
        <MetricTile label="Unsubscribed" value={counts.unsubscribed} />
        <MetricTile label="Bounced" value={counts.bounced} />
      </div>
      <div className="mt-4 rounded-lg border bg-muted/20 p-3">
        <p className="font-mono text-[11px] uppercase text-muted-foreground">
          Resend sync
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <ControlFact label="Synced" value={syncCounts.synced} />
          <ControlFact label="Idle" value={syncCounts.idle} />
          <ControlFact label="Failed" value={syncCounts.failed} />
          <ControlFact label="No config" value={syncCounts.not_configured} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {SUBSCRIBER_FILTERS.map((value) => (
          <FilterChip
            active={filter === value}
            key={value}
            onClick={() => onFilterChange(value)}
          >
            {labelFromFilter(value)}{" "}
            <span className="text-muted-foreground">
              {value === "all" ? subscribers.length : (counts[value] ?? 0)}
            </span>
          </FilterChip>
        ))}
      </div>
      <div className="mt-4 grid max-h-[28rem] gap-2 overflow-y-auto pr-1">
        {filteredSubscribers.slice(0, 24).map((subscriber) => (
          <div
            key={subscriber._id}
            className="rounded-lg border p-3 text-sm transition hover:bg-muted/20"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 flex-1 truncate font-medium">
                {subscriber.email}
              </p>
              <div className="flex flex-wrap gap-2">
                <SubscriberStatusBadge status={subscriber.status} />
                <SyncStatusBadge status={subscriber.resendSyncStatus} />
              </div>
            </div>
            <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
              <span>Source {subscriber.source}</span>
              <span>
                Topics{" "}
                {[
                  subscriber.dailyOptIn ? "daily" : null,
                  subscriber.weeklyOptIn ? "weekly" : null,
                ]
                  .filter(Boolean)
                  .join(" + ") || "none"}
              </span>
              <span>{subscriberLifecycleLabel(subscriber)}</span>
            </div>
            {subscriber.resendError ? (
              <p className="mt-3 line-clamp-2 text-xs text-destructive">
                {subscriber.resendError}
              </p>
            ) : null}
          </div>
        ))}
        {subscribers.length === 0 ? (
          <StatusLine>No subscribers yet</StatusLine>
        ) : null}
        {subscribers.length > 0 && filteredSubscribers.length === 0 ? (
          <StatusLine>No subscribers match this filter</StatusLine>
        ) : null}
      </div>
      {filteredSubscribers.length > 24 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Showing the newest 24 matching subscribers.
        </p>
      ) : null}
    </aside>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-mono text-[11px] uppercase text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function ToggleField({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-10 items-center justify-between gap-3 border px-3 py-2 text-sm">
      <span className="font-mono text-[11px] uppercase text-muted-foreground">
        {label}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-primary"
      />
    </label>
  );
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 font-mono text-[11px] uppercase transition",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-lg font-semibold">{value}</p>
      <p className="font-mono text-[11px] uppercase text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function ControlFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-mono uppercase text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{value}</span>
    </div>
  );
}

function IssueStatusBadge({
  status,
}: {
  status: NewsletterIssueRecord["status"];
}) {
  const badge = issueStatusBadgeProps(status);
  return (
    <Badge
      variant={badge.variant}
      className={cn("font-mono uppercase", badge.className)}
    >
      {status}
    </Badge>
  );
}

function SubscriberStatusBadge({
  status,
}: {
  status: NewsletterSubscriberRecord["status"];
}) {
  const badge = subscriberStatusBadgeProps(status);
  return (
    <Badge
      variant={badge.variant}
      className={cn("font-mono uppercase", badge.className)}
    >
      {status}
    </Badge>
  );
}

function SyncStatusBadge({
  status,
}: {
  status: NewsletterSubscriberRecord["resendSyncStatus"];
}) {
  const badge = syncStatusBadgeProps(status);
  return (
    <Badge
      variant={badge.variant}
      className={cn("font-mono uppercase", badge.className)}
    >
      {status.replaceAll("_", " ")}
    </Badge>
  );
}

function StatusLine({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-xs uppercase text-muted-foreground">
      {children}
    </p>
  );
}

function formToIssue(
  form: IssueForm,
  status: NewsletterIssueRecord["status"] | undefined,
) {
  return {
    slug: form.slug.trim() || undefined,
    subject: form.subject,
    previewText: form.previewText,
    body: form.body,
    linkedPostSlug: form.linkedPostSlug.trim() || undefined,
    status,
  };
}

function issueToForm(issue: NewsletterIssueRecord): IssueForm {
  return {
    slug: issue.slug,
    subject: issue.subject,
    previewText: issue.previewText,
    body: issue.body,
    linkedPostSlug: issue.linkedPostSlug ?? "",
  };
}

function labelFromFilter(value: IssueFilter | SubscriberFilter) {
  return value === "all" ? "all" : value.replaceAll("_", " ");
}

function countIssuesByStatus(issues: NewsletterIssueRecord[]) {
  return issues.reduce<Record<NewsletterIssueRecord["status"], number>>(
    (acc, issue) => {
      acc[issue.status] += 1;
      return acc;
    },
    { draft: 0, scheduled: 0, sent: 0, cancelled: 0, failed: 0 },
  );
}

function countSubscribersByStatus(subscribers: NewsletterSubscriberRecord[]) {
  return subscribers.reduce<
    Record<NewsletterSubscriberRecord["status"], number>
  >(
    (acc, subscriber) => {
      acc[subscriber.status] += 1;
      return acc;
    },
    { pending: 0, confirmed: 0, unsubscribed: 0, bounced: 0 },
  );
}

function countSubscribersBySync(subscribers: NewsletterSubscriberRecord[]) {
  return subscribers.reduce<
    Record<NewsletterSubscriberRecord["resendSyncStatus"], number>
  >(
    (acc, subscriber) => {
      acc[subscriber.resendSyncStatus] += 1;
      return acc;
    },
    { idle: 0, synced: 0, failed: 0, not_configured: 0 },
  );
}

function subscriberLifecycleLabel(subscriber: NewsletterSubscriberRecord) {
  if (subscriber.status === "confirmed" && subscriber.confirmedAt) {
    return `Confirmed ${formatDateTime(subscriber.confirmedAt)}`;
  }
  if (subscriber.status === "unsubscribed" && subscriber.unsubscribedAt) {
    return `Unsubscribed ${formatDateTime(subscriber.unsubscribedAt)}`;
  }
  return `Created ${formatDateTime(subscriber.createdAt)}`;
}

function timestampToLocalInput(value: number) {
  const date = new Date(value);
  const timezoneOffset = date.getTimezoneOffset();
  return new Date(date.getTime() - timezoneOffset * 60_000)
    .toISOString()
    .slice(0, 16);
}

function formatDateTime(value: number) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function issueStatusBadgeProps(status: NewsletterIssueRecord["status"]) {
  switch (status) {
    case "sent":
      return { variant: "default" as const };
    case "scheduled":
      return {
        variant: "outline" as const,
        className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
      };
    case "failed":
      return { variant: "destructive" as const };
    case "cancelled":
      return {
        variant: "outline" as const,
        className: "border-border bg-muted text-muted-foreground",
      };
    default:
      return { variant: "secondary" as const };
  }
}

function subscriberStatusBadgeProps(
  status: NewsletterSubscriberRecord["status"],
) {
  switch (status) {
    case "confirmed":
      return { variant: "default" as const };
    case "pending":
      return { variant: "secondary" as const };
    case "bounced":
      return { variant: "destructive" as const };
    case "unsubscribed":
      return {
        variant: "outline" as const,
        className: "border-border bg-muted text-muted-foreground",
      };
  }
}

function syncStatusBadgeProps(
  status: NewsletterSubscriberRecord["resendSyncStatus"],
) {
  switch (status) {
    case "synced":
      return { variant: "default" as const };
    case "failed":
      return { variant: "destructive" as const };
    case "not_configured":
      return {
        variant: "outline" as const,
        className: "border-border bg-muted text-muted-foreground",
      };
    default:
      return { variant: "secondary" as const };
  }
}
