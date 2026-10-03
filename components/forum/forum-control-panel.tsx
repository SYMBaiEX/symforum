"use client";

import { ForumAgentApprovalNotice } from "./forum-agent-access";

import { asRoute } from "@/lib/typed-route";

import { reportAppError } from "@/components/app-error-surface";
import {
  formatForumDateTime,
  forumMemberProfilePath,
  forumPath,
  forumPostPath,
  forumRefs,
  type ForumNotificationPreferencesRecord,
  type ForumRelationshipRecord,
  type ForumReputationHistoryRecord,
  type MyForumProfileRecord,
  type ForumWarningRecord,
  type PendingForumContentRecord,
} from "@/components/forum/forum-refs";
import {
  ForumAvatar,
  ForumBody,
  ForumLink,
  ForumLoading,
  ForumMetricBar,
  ForumStatusBox,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isAuthRequiredError, userFacingError } from "@/lib/auth-errors";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useConvexAuth, useMutation } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type ForumNotificationPreferencesDraft = Pick<
  ForumNotificationPreferencesRecord,
  | "inAppReplies"
  | "inAppNewThreads"
  | "inAppMentions"
  | "emailReplies"
  | "emailNewThreads"
>;

const DEFAULT_NOTIFICATION_PREFERENCES_DRAFT: ForumNotificationPreferencesDraft =
  {
    inAppReplies: true,
    inAppNewThreads: true,
    inAppMentions: true,
    emailReplies: false,
    emailNewThreads: false,
  };

const FORUM_TIME_ZONE_OPTIONS = [
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
] as const;

export function ForumControlPanel({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <ForumStatusBox
        title="Local forum disabled"
        body="Convex is not configured locally, so forum profile settings cannot load."
        accent="cyan"
      />
    );
  }

  return <LiveForumControlPanel />;
}

function LiveForumControlPanel() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const pathname = usePathname();
  const profile = useQuery(
    forumRefs.getMyForumProfile,
    isAuthenticated ? {} : "skip",
  );
  const notificationPreferences = useQuery(
    forumRefs.getMyForumNotificationPreferences,
    isAuthenticated ? {} : "skip",
  );
  const warnings = useQuery(
    forumRefs.listMyForumWarnings,
    isAuthenticated ? { limit: 12 } : "skip",
  );
  const pendingContent = useQuery(
    forumRefs.listMyPendingForumContent,
    isAuthenticated ? { limit: 12 } : "skip",
  );
  const receivedReputation = useQuery(
    forumRefs.listMyForumReputationHistory,
    isAuthenticated ? { direction: "received", limit: 6 } : "skip",
  );
  const givenReputation = useQuery(
    forumRefs.listMyForumReputationHistory,
    isAuthenticated ? { direction: "given", limit: 6 } : "skip",
  );
  const updateProfile = useMutation(forumRefs.updateMyForumProfile);
  const updateNotificationPreferences = useMutation(
    forumRefs.updateMyForumNotificationPreferences,
  );
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bio, setBio] = useState("");
  const [birthday, setBirthday] = useState("");
  const [signature, setSignature] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [location, setLocation] = useState("");
  const [showSignatures, setShowSignatures] = useState(true);
  const [timeZone, setTimeZone] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [notificationDraft, setNotificationDraft] =
    useState<ForumNotificationPreferencesDraft>(
      DEFAULT_NOTIFICATION_PREFERENCES_DRAFT,
    );
  const [notificationPending, setNotificationPending] = useState(false);
  const [notificationSaved, setNotificationSaved] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const hasSignaturePreview = signature.trim().length > 0;
  const signInHref = `/signin?${new URLSearchParams({
    redirectTo: pathname ?? "/forum/control-panel",
  }).toString()}`;

  useEffect(() => {
    if (!profile) {
      return;
    }
    setAvatarUrl(profile.avatarUrl ?? "");
    setBio(profile.bio);
    setBirthday(profile.birthday);
    setSignature(profile.signature);
    setCustomTitle(profile.customTitle);
    setLocation(profile.location);
    setShowSignatures(profile.showSignatures);
    setTimeZone(profile.timeZone);
    setWebsiteUrl(profile.websiteUrl);
  }, [profile]);

  useEffect(() => {
    if (!notificationPreferences) {
      return;
    }
    setNotificationDraft({
      inAppReplies: notificationPreferences.inAppReplies,
      inAppNewThreads: notificationPreferences.inAppNewThreads,
      inAppMentions: notificationPreferences.inAppMentions,
      emailReplies: notificationPreferences.emailReplies,
      emailNewThreads: notificationPreferences.emailNewThreads,
    });
  }, [notificationPreferences]);

  if (isLoading) {
    return <ForumLoading label="Checking forum session" variant="ucp" />;
  }

  if (!isAuthenticated) {
    return (
      <ForumStatusBox
        title="Sign in required"
        body="Use a SYM handle to edit your forum title, signature, and display settings."
        action={
          <Button asChild className="rounded-xl text-xs" variant="outline">
            <Link href={asRoute(signInHref)}>Sign in</Link>
          </Button>
        }
      />
    );
  }

  if (profile === undefined) {
    return <ForumLoading label="Syncing forum control panel" variant="ucp" />;
  }

  const pendingContentCount =
    pendingContent === undefined
      ? undefined
      : pendingContent.threads.length + pendingContent.posts.length;
  const reputationEntriesCount =
    receivedReputation === undefined || givenReputation === undefined
      ? undefined
      : receivedReputation.length + givenReputation.length;

  async function saveProfile() {
    setPending(true);
    setSaved(false);
    setError("");
    try {
      await updateProfile({
        avatarUrl: avatarUrl.trim() || undefined,
        bio: bio.trim() || undefined,
        birthday: birthday.trim() || undefined,
        customTitle: customTitle.trim() || undefined,
        location: location.trim() || undefined,
        signature: signature.trim() || undefined,
        showSignatures,
        timeZone: timeZone.trim() || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
      });
      setSaved(true);
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setError("Sign in again to save forum profile settings.");
        return;
      }
      reportAppError(caught, {
        scope: "forum",
        eventType: "forum_profile_update_failed",
        component: "ForumControlPanel",
        action: "forum:updateMyForumProfile",
        notify: false,
      });
      setError(userFacingError(caught, "Could not save forum profile"));
    } finally {
      setPending(false);
    }
  }

  async function saveNotificationPreferences() {
    setNotificationPending(true);
    setNotificationSaved(false);
    setNotificationError("");
    try {
      await updateNotificationPreferences(notificationDraft);
      setNotificationSaved(true);
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        setNotificationError(
          "Sign in again to save forum notification settings.",
        );
        return;
      }
      reportAppError(caught, {
        scope: "forum",
        eventType: "forum_notification_preferences_update_failed",
        component: "ForumControlPanel",
        action: "forum:updateMyForumNotificationPreferences",
        notify: false,
      });
      setNotificationError(
        userFacingError(caught, "Could not save notification settings"),
      );
    } finally {
      setNotificationPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <ForumMetricBar
        items={[
          { label: "Rank", value: profile.rank },
          { label: "Threads", value: profile.threadCount },
          { label: "Posts", value: profile.postCount },
          {
            label: "Reputation",
            value: `${profile.reputationScore > 0 ? "+" : ""}${profile.reputationScore}`,
          },
        ]}
      />
      <ForumAgentApprovalNotice />
      <ForumControlPanelDirectory
        notificationPreferences={notificationPreferences}
        pendingContentCount={pendingContentCount}
        profile={profile}
        reputationEntriesCount={reputationEntriesCount}
        warnings={warnings}
      />
      <section className="grid gap-3 2xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="forum-panel scroll-mt-24 p-4" id="ucp-profile">
          <ForumProfileForm
            profile={profile}
            avatarUrl={avatarUrl}
            bio={bio}
            customTitle={customTitle}
            birthday={birthday}
            location={location}
            timeZone={timeZone}
            websiteUrl={websiteUrl}
            onAvatarUrlChange={(value) => {
              setAvatarUrl(value);
              setSaved(false);
            }}
            onBioChange={(value) => {
              setBio(value);
              setSaved(false);
            }}
            onCustomTitleChange={(value) => {
              setCustomTitle(value);
              setSaved(false);
            }}
            onBirthdayChange={(value) => {
              setBirthday(value);
              setSaved(false);
            }}
            onLocationChange={(value) => {
              setLocation(value);
              setSaved(false);
            }}
            signature={signature}
            onSignatureChange={(value) => {
              setSignature(value);
              setSaved(false);
            }}
            showSignatures={showSignatures}
            onShowSignaturesChange={(value) => {
              setShowSignatures(value);
              setSaved(false);
            }}
            onTimeZoneChange={(value) => {
              setTimeZone(value);
              setSaved(false);
            }}
            onWebsiteUrlChange={(value) => {
              setWebsiteUrl(value);
              setSaved(false);
            }}
          />
          {error ? (
            <p
              className="mt-3 rounded-xl bg-card p-4 text-sm text-muted-foreground"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          {saved ? (
            <p
              aria-live="polite"
              className="mt-3 rounded-xl bg-card p-4 text-xs text-muted-foreground"
              role="status"
            >
              Forum profile saved
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button asChild className="rounded-xl text-xs" variant="outline">
              <ForumLink href="/forum/subscriptions" prefetch>
                Subscriptions
              </ForumLink>
            </Button>
            <Button
              className="rounded-xl text-xs"
              type="button"
              disabled={pending}
              onClick={saveProfile}
            >
              {pending ? "Saving..." : "Save profile"}
            </Button>
          </div>
        </div>
        <div className="grid gap-3">
          <ForumAccessPanel profile={profile} />
          <ForumNotificationPreferencesPanel
            draft={notificationDraft}
            error={notificationError}
            pending={notificationPending}
            preferences={notificationPreferences}
            saved={notificationSaved}
            onChange={(patch) => {
              setNotificationDraft((current) => ({ ...current, ...patch }));
              setNotificationSaved(false);
              setNotificationError("");
            }}
            onSave={saveNotificationPreferences}
          />
          <ForumRelationshipsPanel trusted={profile.trusted} />
          <ForumReputationHistoryPanel
            given={givenReputation}
            received={receivedReputation}
          />
          <ForumPendingContentPanel pendingContent={pendingContent} />
          <ForumWarningHistory profile={profile} warnings={warnings} />
          <section className="forum-panel scroll-mt-24 p-4" id="ucp-signature">
            <div className="flex flex-wrap items-start justify-between gap-3 pb-3">
              <div>
                <p className="text-xs text-muted-foreground">
                  Signature preview
                </p>
                <h2 className="mt-2 text-lg font-semibold">Author rail</h2>
              </div>
              <span className="rounded-xl bg-muted px-2 py-1 text-xs text-muted-foreground">
                {showSignatures ? "Shown on posts" : "Hidden on posts"}
              </span>
            </div>
            <div className="mt-3 rounded-xl bg-card p-4">
              {hasSignaturePreview ? (
                <ForumBody
                  body={signature}
                  className={
                    showSignatures
                      ? "text-xs leading-6 text-muted-foreground md:text-sm"
                      : "text-xs leading-6 text-muted-foreground opacity-60 md:text-sm"
                  }
                />
              ) : (
                <p className="text-sm leading-6 text-muted-foreground">
                  Empty signature.
                </p>
              )}
            </div>
            {!showSignatures ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Signatures are currently disabled on your posts.
              </p>
            ) : null}
          </section>
        </div>
      </section>
    </div>
  );
}

function ForumControlPanelDirectory({
  notificationPreferences,
  pendingContentCount,
  profile,
  reputationEntriesCount,
  warnings,
}: {
  notificationPreferences: ForumNotificationPreferencesRecord | undefined;
  pendingContentCount: number | undefined;
  profile: MyForumProfileRecord;
  reputationEntriesCount: number | undefined;
  warnings: ForumWarningRecord[] | undefined;
}) {
  const warningSummary = forumWarningSummary(warnings, profile);
  const navItems = [
    {
      href: "#ucp-profile",
      label: "Profile",
      meta: profile.username,
    },
    {
      href: "#ucp-access",
      label: "Access",
      meta: profile.trusted ? "Trusted" : "Pending",
    },
    {
      href: "#ucp-notifications",
      label: "Alerts",
      meta: forumNotificationDirectoryLabel(notificationPreferences),
    },
    {
      href: "#ucp-lists",
      label: "Buddies / ignore",
      meta: profile.trusted ? "Buddy / ignore" : "Locked",
    },
    {
      href: "#ucp-reputation",
      label: "Reputation",
      meta:
        reputationEntriesCount === undefined
          ? "Syncing"
          : `${reputationEntriesCount} shown`,
    },
    {
      href: "#ucp-queue",
      label: "Pending posts",
      meta:
        pendingContentCount === undefined
          ? "Syncing"
          : `${pendingContentCount} pending`,
    },
    {
      href: "#ucp-warnings",
      label: "Warnings",
      meta: `${warningSummary.activeCount} active / ${warningSummary.activePoints} pts`,
      attention: warningSummary.activePoints > 0,
    },
    {
      href: "#ucp-signature",
      label: "Signature",
      meta: profile.showSignatures ? "Visible" : "Hidden",
    },
  ];

  return (
    <details className="forum-panel min-w-0" id="ucp-index">
      <summary className="focus-ring cursor-pointer px-4 py-3 text-sm font-semibold">
        Jump to settings{" "}
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {navItems.length} sections
          {pendingContentCount ? ` · ${pendingContentCount} pending posts` : ""}
          {warningSummary.activeCount
            ? ` · ${warningSummary.activeCount} warnings`
            : ""}
        </span>
      </summary>
      <nav
        aria-label="Settings sections"
        className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4"
      >
        {navItems.map((item) => (
          <a
            className="focus-ring group min-h-11 min-w-0 rounded-xl bg-muted/35 px-3 py-2 hover:bg-primary/5"
            href={item.href}
            key={item.href}
          >
            <span className="block text-sm font-medium text-foreground">
              {item.label}
            </span>
            <span
              className={
                item.attention
                  ? "mt-1 block break-words text-xs font-semibold leading-5 text-foreground"
                  : "mt-1 block break-words text-xs leading-5 text-muted-foreground"
              }
            >
              {item.meta}
            </span>
          </a>
        ))}
      </nav>
    </details>
  );
}

function forumNotificationDirectoryLabel(
  preferences: ForumNotificationPreferencesRecord | undefined,
) {
  if (preferences === undefined) {
    return "Syncing";
  }

  const activeChannels = [
    preferences.inAppReplies,
    preferences.inAppNewThreads,
    preferences.inAppMentions,
    preferences.emailReplies,
    preferences.emailNewThreads,
  ].filter(Boolean).length;
  const deliveryLabel = preferences.emailDestinationAvailable
    ? preferences.emailDeliveryEnabled
      ? "email live"
      : "queue"
    : "no email";

  return `${activeChannels}/5 on / ${deliveryLabel}`;
}

function ForumProfileForm({
  avatarUrl,
  bio,
  birthday,
  customTitle,
  location,
  onAvatarUrlChange,
  onBioChange,
  onBirthdayChange,
  onCustomTitleChange,
  onLocationChange,
  onShowSignaturesChange,
  onSignatureChange,
  onTimeZoneChange,
  onWebsiteUrlChange,
  profile,
  showSignatures,
  signature,
  timeZone,
  websiteUrl,
}: {
  avatarUrl: string;
  bio: string;
  birthday: string;
  customTitle: string;
  location: string;
  onAvatarUrlChange: (value: string) => void;
  onBioChange: (value: string) => void;
  onBirthdayChange: (value: string) => void;
  onCustomTitleChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onShowSignaturesChange: (value: boolean) => void;
  onSignatureChange: (value: string) => void;
  onTimeZoneChange: (value: string) => void;
  onWebsiteUrlChange: (value: string) => void;
  profile: MyForumProfileRecord;
  showSignatures: boolean;
  signature: string;
  timeZone: string;
  websiteUrl: string;
}) {
  return (
    <div className="grid gap-5">
      <div>
        <p className="text-xs text-muted-foreground">Signed in as</p>
        <p className="mt-1 text-xl font-semibold">{profile.username}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-xl bg-muted px-2 py-1 text-xs text-muted-foreground">
            {profile.trusted ? "Trusted member" : "Forum access pending"}
          </span>
        </div>
      </div>
      <div className="grid gap-3 rounded-xl bg-card p-4 md:grid-cols-[5rem_minmax(0,1fr)]">
        <ForumAvatar
          alt={`${profile.username} avatar`}
          className="size-20"
          name={profile.username}
          src={avatarUrl || profile.authAvatarUrl}
        />
        <div className="grid gap-3">
          <label className="grid gap-2">
            <span className="text-xs text-muted-foreground">Avatar URL</span>
            <Input
              value={avatarUrl}
              maxLength={500}
              onChange={(event) => onAvatarUrlChange(event.target.value)}
              placeholder={profile.authAvatarUrl ?? "https://..."}
              className="rounded-xl border-row-border"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-xs text-muted-foreground">Website</span>
            <Input
              value={websiteUrl}
              maxLength={240}
              onChange={(event) => onWebsiteUrlChange(event.target.value)}
              placeholder="https://symbaiex.com"
              className="rounded-xl border-row-border"
            />
          </label>
        </div>
      </div>
      <label className="grid gap-2">
        <span className="text-xs text-muted-foreground">Custom title</span>
        <Input
          value={customTitle}
          maxLength={40}
          onChange={(event) => onCustomTitleChange(event.target.value)}
          placeholder={profile.rank}
          className="rounded-xl border-row-border"
        />
      </label>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-2">
          <span className="text-xs text-muted-foreground">Location</span>
          <Input
            value={location}
            maxLength={80}
            onChange={(event) => onLocationChange(event.target.value)}
            placeholder="Austin, TX"
            className="rounded-xl border-row-border"
          />
        </label>
        <label className="grid gap-2">
          <span className="text-xs text-muted-foreground">Birthday</span>
          <Input
            value={birthday}
            maxLength={10}
            onChange={(event) => onBirthdayChange(event.target.value)}
            placeholder="YYYY-MM-DD"
            className="rounded-xl border-row-border"
          />
        </label>
        <label className="grid gap-2">
          <span className="text-xs text-muted-foreground">Timezone</span>
          <select
            className="focus-ring h-10 rounded-xl border border-row-border bg-background px-3 text-sm outline-none"
            value={timeZone}
            onChange={(event) => onTimeZoneChange(event.target.value)}
          >
            <option value="">Use site default</option>
            {FORUM_TIME_ZONE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-2">
        <span className="text-xs text-muted-foreground">Bio</span>
        <Textarea
          value={bio}
          maxLength={800}
          rows={4}
          onChange={(event) => onBioChange(event.target.value)}
          placeholder="Old web profile blurb, project notes, links, or whatever belongs under your handle."
          className="rounded-xl border-row-border"
        />
        <span className="text-xs leading-5 text-muted-foreground">
          {bio.length}/800 characters
        </span>
      </label>
      <label className="grid gap-2">
        <span className="text-xs text-muted-foreground">Signature</span>
        <Textarea
          value={signature}
          maxLength={900}
          rows={7}
          onChange={(event) => onSignatureChange(event.target.value)}
          placeholder="[b]Build notes[/b]\nhttps://symbaiex.com"
          className="rounded-xl border-row-border"
        />
        <span className="text-xs leading-5 text-muted-foreground">
          {signature.length}/900 characters
        </span>
      </label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          className="size-4 rounded-xl border-row-border accent-primary"
          type="checkbox"
          checked={showSignatures}
          onChange={(event) => onShowSignaturesChange(event.target.checked)}
        />
        Show signatures on my posts
      </label>
    </div>
  );
}

function ForumNotificationPreferencesPanel({
  draft,
  error,
  onChange,
  onSave,
  pending,
  preferences,
  saved,
}: {
  draft: ForumNotificationPreferencesDraft;
  error: string;
  onChange: (patch: Partial<ForumNotificationPreferencesDraft>) => void;
  onSave: () => void;
  pending: boolean;
  preferences: ForumNotificationPreferencesRecord | undefined;
  saved: boolean;
}) {
  const loading = preferences === undefined;
  const emailAvailable = preferences?.emailDestinationAvailable === true;
  const emailDeliveryEnabled = preferences?.emailDeliveryEnabled === true;
  const emailLabel = preferences?.emailDestinationLabel ?? "No email on file";
  const emailMeta = emailAvailable
    ? `${emailLabel} / ${
        emailDeliveryEnabled ? "sending enabled" : "queue only"
      }`
    : "Add an email first";
  const disableEmailReplies = loading || !emailAvailable;
  const disableEmailNewThreads = loading || !emailAvailable;

  return (
    <section className="forum-panel scroll-mt-24 p-4" id="ucp-notifications">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3">
        <div>
          <p className="text-xs text-muted-foreground">Notifications</p>
          <h2 className="mt-2 text-lg font-semibold">Forum alerts</h2>
        </div>
        <span className="rounded-xl bg-muted px-2 py-1 text-xs text-muted-foreground">
          {loading
            ? "Syncing"
            : emailAvailable
              ? emailDeliveryEnabled
                ? "Email live"
                : "Queue only"
              : "No email"}
        </span>
      </div>
      <div className="mt-3 space-y-1 rounded-xl bg-muted/20">
        <ForumNotificationToggle
          checked={draft.inAppReplies}
          disabled={loading}
          label="In-app replies"
          meta="Watched threads"
          onChange={(value) => onChange({ inAppReplies: value })}
        />
        <ForumNotificationToggle
          checked={draft.inAppNewThreads}
          disabled={loading}
          label="In-app new threads"
          meta="Watched boards"
          onChange={(value) => onChange({ inAppNewThreads: value })}
        />
        <ForumNotificationToggle
          checked={draft.inAppMentions}
          disabled={loading}
          label="In-app mentions"
          meta="Direct @handle alerts"
          onChange={(value) => onChange({ inAppMentions: value })}
        />
        <ForumNotificationToggle
          checked={draft.emailReplies}
          disabled={disableEmailReplies}
          label="Email replies"
          meta={emailMeta}
          onChange={(value) => onChange({ emailReplies: value })}
        />
        <ForumNotificationToggle
          checked={draft.emailNewThreads}
          disabled={disableEmailNewThreads}
          label="Email new threads"
          meta={emailMeta}
          onChange={(value) => onChange({ emailNewThreads: value })}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="rounded-xl bg-muted px-2 py-1">
          {emailDeliveryEnabled
            ? "Email sending enabled"
            : "Email sending disabled"}
        </span>
        <span className="rounded-xl bg-muted px-2 py-1">
          {emailAvailable ? "Email queued" : "No destination"}
        </span>
      </div>
      {error ? (
        <p className="mt-3 rounded-xl bg-card p-4 text-sm text-muted-foreground">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p
          aria-live="polite"
          className="mt-3 rounded-xl bg-card p-4 text-xs text-muted-foreground"
          role="status"
        >
          Notification settings saved
        </p>
      ) : null}
      <div className="mt-3 flex justify-end">
        <Button
          className="rounded-xl text-xs"
          type="button"
          disabled={pending || loading}
          onClick={onSave}
        >
          {pending ? "Saving..." : "Save notifications"}
        </Button>
      </div>
    </section>
  );
}

function ForumNotificationToggle({
  checked,
  disabled,
  label,
  meta,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  meta: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 bg-background p-3">
      <input
        className="size-4 rounded-xl border-row-border accent-primary disabled:opacity-50"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-5">{label}</span>
        <span className="mt-1 block break-words text-xs text-muted-foreground">
          {disabled && !checked ? "Unavailable" : meta}
        </span>
      </span>
    </label>
  );
}

type ForumRelationshipKind = "buddy" | "ignore";

function ForumRelationshipsPanel({ trusted }: { trusted: boolean }) {
  const relationships = useQuery(
    forumRefs.listMyForumRelationships,
    trusted ? { limit: 100 } : "skip",
  );
  const updateRelationship = useMutation(forumRefs.updateForumRelationship);
  const [username, setUsername] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function changeRelationship(
    kind: ForumRelationshipKind,
    enabled: boolean,
    targetUsername = username,
  ) {
    const normalizedUsername = targetUsername.trim();
    if (normalizedUsername.length === 0) {
      setError("Add a username first.");
      return;
    }

    setPendingKey(
      `${kind}:${normalizedUsername}:${enabled ? "add" : "remove"}`,
    );
    setNotice("");
    setError("");
    try {
      await updateRelationship({
        username: normalizedUsername,
        kind,
        enabled,
      });
      if (enabled) {
        setUsername("");
      }
      setNotice(
        enabled
          ? `${normalizedUsername} added to ${kind === "buddy" ? "buddies" : "ignored members"}.`
          : `${normalizedUsername} removed.`,
      );
    } catch (caught) {
      reportAppError(caught, {
        scope: "forum",
        eventType: "forum_relationship_update_failed",
        component: "ForumRelationshipsPanel",
        action: "forum:updateForumRelationship",
        notify: false,
      });
      setError(userFacingError(caught, "Could not update member list"));
    } finally {
      setPendingKey(null);
    }
  }

  if (!trusted) {
    return (
      <section className="forum-panel scroll-mt-24 p-4" id="ucp-lists">
        <p className="text-xs text-muted-foreground">User lists</p>
        <h2 className="mt-2 text-lg font-semibold">Locked</h2>
      </section>
    );
  }

  const buddies = relationships?.buddies ?? [];
  const ignored = relationships?.ignored ?? [];

  return (
    <section className="forum-panel scroll-mt-24 p-4" id="ucp-lists">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3">
        <div>
          <p className="text-xs text-muted-foreground">User lists</p>
          <h2 className="mt-2 text-lg font-semibold">Buddies / ignore</h2>
        </div>
        <span className="rounded-xl bg-muted px-2 py-1 text-xs text-muted-foreground">
          {relationships === undefined
            ? "Syncing"
            : `${buddies.length} / ${ignored.length}`}
        </span>
      </div>
      <div className="mt-3 grid gap-3">
        <label className="grid gap-2">
          <span className="text-xs text-muted-foreground">Username</span>
          <Input
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              setError("");
              setNotice("");
            }}
            placeholder="sym-austin"
            className="rounded-xl border-row-border"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            className="rounded-xl text-xs"
            type="button"
            disabled={pendingKey !== null || relationships === undefined}
            onClick={() => {
              void changeRelationship("buddy", true);
            }}
          >
            Add buddy
          </Button>
          <Button
            className="rounded-xl text-xs"
            type="button"
            variant="outline"
            disabled={pendingKey !== null || relationships === undefined}
            onClick={() => {
              void changeRelationship("ignore", true);
            }}
          >
            Ignore
          </Button>
        </div>
        {error ? (
          <p className="rounded-xl bg-card p-4 text-sm text-muted-foreground">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="rounded-xl bg-card p-4 text-xs text-muted-foreground">
            {notice}
          </p>
        ) : null}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
        <ForumRelationshipList
          kind="buddy"
          pendingKey={pendingKey}
          records={relationships === undefined ? undefined : buddies}
          title="Buddies"
          onRemove={(record) =>
            changeRelationship(record.kind, false, record.username)
          }
        />
        <ForumRelationshipList
          kind="ignore"
          pendingKey={pendingKey}
          records={relationships === undefined ? undefined : ignored}
          title="Ignored"
          onRemove={(record) =>
            changeRelationship(record.kind, false, record.username)
          }
        />
      </div>
    </section>
  );
}

function ForumRelationshipList({
  kind,
  onRemove,
  pendingKey,
  records,
  title,
}: {
  kind: ForumRelationshipKind;
  onRemove: (record: ForumRelationshipRecord) => void;
  pendingKey: string | null;
  records: ForumRelationshipRecord[] | undefined;
  title: string;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2">
        <h3 className="text-xs text-muted-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {records === undefined ? "..." : records.length}
        </span>
      </div>
      {records === undefined ? (
        <p className="p-3 text-sm leading-6 text-muted-foreground">
          Loading members...
        </p>
      ) : records.length === 0 ? (
        <p className="p-3 text-sm leading-6 text-muted-foreground">
          No {kind === "buddy" ? "buddies" : "ignored members"} yet.
        </p>
      ) : (
        <div className="space-y-1">
          {records.map((record) => (
            <ForumRelationshipRow
              key={record._id}
              pending={pendingKey === `${kind}:${record.username}:remove`}
              record={record}
              onRemove={() => onRemove(record)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ForumRelationshipRow({
  onRemove,
  pending,
  record,
}: {
  onRemove: () => void;
  pending: boolean;
  record: ForumRelationshipRecord;
}) {
  return (
    <article className="grid gap-3 bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <ForumLink
            className="focus-ring break-words font-semibold hover:text-primary"
            href={forumMemberProfilePath(record.username)}
            prefetch
          >
            {record.displayName}
          </ForumLink>
          <p className="mt-1 text-xs text-muted-foreground">
            {record.rank} / {record.postCount} posts
          </p>
        </div>
        <Button
          className="rounded-xl text-xs"
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onRemove}
        >
          {pending ? "Removing..." : "Remove"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Added {formatForumDateTime(record.createdAt)}
      </p>
    </article>
  );
}

function ForumReputationHistoryPanel({
  given,
  received,
}: {
  given: ForumReputationHistoryRecord[] | undefined;
  received: ForumReputationHistoryRecord[] | undefined;
}) {
  const totalShown =
    given === undefined || received === undefined
      ? undefined
      : given.length + received.length;

  return (
    <section className="forum-panel scroll-mt-24 p-4" id="ucp-reputation">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3">
        <div>
          <p className="text-xs text-muted-foreground">Reputation</p>
          <h2 className="mt-2 text-lg font-semibold">Member ledger</h2>
        </div>
        <span className="rounded-xl bg-muted px-2 py-1 text-xs text-muted-foreground">
          {totalShown === undefined ? "Syncing" : `${totalShown} shown`}
        </span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
        <ForumReputationHistoryColumn
          direction="received"
          records={received}
          title="Received"
        />
        <ForumReputationHistoryColumn
          direction="given"
          records={given}
          title="Given"
        />
      </div>
    </section>
  );
}

function ForumReputationHistoryColumn({
  direction,
  records,
  title,
}: {
  direction: "received" | "given";
  records: ForumReputationHistoryRecord[] | undefined;
  title: string;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2">
        <h3 className="text-xs text-muted-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {records === undefined ? "..." : records.length}
        </span>
      </div>
      {records === undefined ? (
        <p className="p-3 text-sm leading-6 text-muted-foreground">
          Loading reputation...
        </p>
      ) : records.length === 0 ? (
        <p className="p-3 text-sm leading-6 text-muted-foreground">
          No reputation entries yet.
        </p>
      ) : (
        <div className="space-y-1">
          {records.map((record) => (
            <ForumReputationHistoryRow
              direction={direction}
              key={record._id}
              record={record}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ForumReputationHistoryRow({
  direction,
  record,
}: {
  direction: "received" | "given";
  record: ForumReputationHistoryRecord;
}) {
  const href = forumReputationContextHref(record);
  const memberLabel =
    direction === "received"
      ? `From ${record.fromUsername}`
      : `To ${record.toUsername}`;
  const scoreLabel = `${record.score > 0 ? "+" : ""}${record.score}`;

  return (
    <article className="grid gap-2 bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              record.score > 0
                ? "rounded-xl bg-muted px-2 py-1 text-xs text-foreground"
                : "rounded-xl bg-muted px-2 py-1 text-xs text-muted-foreground"
            }
          >
            {scoreLabel}
          </span>
          <span className="text-xs text-muted-foreground">{memberLabel}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {formatForumDateTime(record.createdAt)}
        </span>
      </div>
      {record.comment ? (
        <p className="text-sm leading-6 text-foreground">{record.comment}</p>
      ) : null}
      <ForumLink
        className="focus-ring text-xs text-muted-foreground hover:text-foreground"
        href={href}
        prefetch
      >
        {forumReputationContextLabel(record)}
      </ForumLink>
    </article>
  );
}

function forumReputationContextHref(record: ForumReputationHistoryRecord) {
  return forumPostPath(
    record.categorySlug,
    record.threadSlug,
    record.postNumber,
    record.postPage,
  );
}

function forumReputationContextLabel(record: ForumReputationHistoryRecord) {
  if (record.postNumber !== undefined) {
    return `${record.threadTitle} / #${record.postNumber}`;
  }
  return record.threadTitle;
}

function ForumPendingContentPanel({
  pendingContent,
}: {
  pendingContent: PendingForumContentRecord | undefined;
}) {
  const entries =
    pendingContent === undefined
      ? []
      : [
          ...pendingContent.threads.map((thread) => ({
            id: thread._id,
            type: "Thread",
            title: thread.title,
            excerpt: thread.excerpt,
            href: thread.categorySlug ? forumPath(thread.categorySlug) : null,
            context: thread.categoryName ?? "Board unavailable",
            createdAt: thread.createdAt,
          })),
          ...pendingContent.posts.map((post) => ({
            id: post._id,
            type: "Reply",
            title: post.threadTitle ?? "Pending reply",
            excerpt: post.excerpt,
            href:
              post.categorySlug && post.threadSlug
                ? forumPath(post.categorySlug, post.threadSlug)
                : null,
            context: post.categoryName ?? "Thread unavailable",
            createdAt: post.createdAt,
          })),
        ].sort((left, right) => right.createdAt - left.createdAt);

  return (
    <section className="forum-panel scroll-mt-24 p-4" id="ucp-queue">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3">
        <div>
          <p className="text-xs text-muted-foreground">Moderation queue</p>
          <h2 className="mt-2 text-lg font-semibold">
            Awaiting staff moderation
          </h2>
        </div>
        <span className="rounded-xl bg-muted px-2 py-1 text-xs text-muted-foreground">
          {pendingContent === undefined
            ? "Syncing"
            : `${entries.length} pending`}
        </span>
      </div>
      {pendingContent === undefined ? (
        <p className="mt-3 text-sm leading-5 text-muted-foreground">
          Loading pending submissions...
        </p>
      ) : entries.length === 0 ? (
        <p className="mt-3 text-sm leading-5 text-muted-foreground">
          No threads or replies are waiting on moderation.
        </p>
      ) : (
        <div className="mt-3 space-y-1 rounded-xl bg-muted/20">
          {entries.map((entry) => (
            <article className="grid gap-2 bg-background p-3" key={entry.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-xl bg-muted px-2 py-1 text-xs text-muted-foreground">
                  {entry.type}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatForumDateTime(entry.createdAt)}
                </span>
              </div>
              <p className="text-sm font-semibold leading-6">{entry.title}</p>
              <p className="text-sm leading-6 text-muted-foreground">
                {entry.excerpt}
              </p>
              {entry.href ? (
                <ForumLink
                  className="focus-ring text-xs text-muted-foreground hover:text-foreground"
                  href={entry.href}
                  prefetch
                >
                  {entry.context}
                </ForumLink>
              ) : (
                <p className="text-xs text-muted-foreground">{entry.context}</p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ForumWarningHistory({
  profile,
  warnings,
}: {
  profile: MyForumProfileRecord;
  warnings: ForumWarningRecord[] | undefined;
}) {
  const summary = forumWarningSummary(warnings, profile);

  return (
    <section className="forum-panel scroll-mt-24 p-4" id="ucp-warnings">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3">
        <div>
          <p className="text-xs text-muted-foreground">Warning history</p>
          <h2 className="mt-2 text-lg font-semibold">Account notices</h2>
        </div>
        <span className="rounded-xl bg-muted px-2 py-1 text-xs text-muted-foreground">
          {warnings === undefined ? "Syncing" : `${summary.shownTotal} shown`}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 bg-transparent text-xs text-muted-foreground sm:grid-cols-5">
        <ForumWarningSummaryCell
          label="Active"
          value={summary.activeCount.toString()}
          emphasized={summary.activeCount > 0}
        />
        <ForumWarningSummaryCell
          label="Points"
          value={summary.activePoints.toString()}
          emphasized={summary.activePoints > 0}
        />
        <ForumWarningSummaryCell
          label="Shown"
          value={summary.shownTotal === undefined ? "..." : summary.shownTotal}
        />
        <ForumWarningSummaryCell
          label="Expired"
          value={
            summary.expiredShown === undefined ? "..." : summary.expiredShown
          }
        />
        <ForumWarningSummaryCell
          label="Revoked"
          value={
            summary.revokedShown === undefined ? "..." : summary.revokedShown
          }
        />
      </div>
      {warnings === undefined ? (
        <p className="mt-3 text-sm leading-5 text-muted-foreground">
          Loading account notices...
        </p>
      ) : warnings.length === 0 ? (
        <p className="mt-3 text-sm leading-5 text-muted-foreground">
          No forum warnings on this account.
        </p>
      ) : (
        <div className="mt-3 space-y-1 rounded-xl bg-muted/20">
          {warnings.map((warning) => (
            <ForumWarningRow key={warning._id} warning={warning} />
          ))}
        </div>
      )}
    </section>
  );
}

function forumWarningSummary(
  warnings: ForumWarningRecord[] | undefined,
  profile: MyForumProfileRecord,
) {
  if (warnings === undefined) {
    return {
      activeCount: profile.activeWarningCount,
      activePoints: profile.activeWarningPoints,
      expiredShown: undefined,
      revokedShown: undefined,
      shownTotal: undefined,
    };
  }

  return {
    activeCount: profile.activeWarningCount,
    activePoints: profile.activeWarningPoints,
    expiredShown: warnings.filter((warning) => warning.status === "expired")
      .length,
    revokedShown: warnings.filter((warning) => warning.status === "revoked")
      .length,
    shownTotal: warnings.length,
  };
}

function ForumWarningSummaryCell({
  emphasized = false,
  label,
  value,
}: {
  emphasized?: boolean;
  label: string;
  value: number | string;
}) {
  return (
    <div className="bg-background px-3 py-2">
      <p>{label}</p>
      <p
        className={
          emphasized
            ? "mt-1 text-sm font-semibold text-foreground"
            : "mt-1 text-sm text-foreground"
        }
      >
        {value}
      </p>
    </div>
  );
}

function ForumWarningRow({ warning }: { warning: ForumWarningRecord }) {
  const termLabel =
    warning.status === "revoked"
      ? "Revoked"
      : warning.expiresAt
        ? warning.active
          ? "Expires"
          : "Expired"
        : "No expiry";
  const termDate =
    warning.status === "revoked"
      ? formatForumDateTime(warning.revokedAt)
      : warning.expiresAt
        ? formatForumDateTime(warning.expiresAt)
        : null;
  const statusLabel =
    warning.status === "active"
      ? "Active"
      : warning.status === "revoked"
        ? "Revoked"
        : "Expired";
  const statusClassName =
    warning.status === "active"
      ? "mt-1 text-foreground"
      : "mt-1 text-muted-foreground";

  return (
    <article className="bg-background">
      <div className="grid gap-2 bg-transparent text-xs text-muted-foreground sm:grid-cols-5">
        <div className="bg-background px-3 py-2">
          <p>Status</p>
          <p className={statusClassName}>{statusLabel}</p>
        </div>
        <div className="bg-background px-3 py-2">
          <p>Points</p>
          <p className="mt-1 text-foreground">{warning.points}</p>
        </div>
        <div className="bg-background px-3 py-2">
          <p>Issued</p>
          <p className="mt-1 text-foreground">
            {formatForumDateTime(warning.createdAt)}
          </p>
        </div>
        <div className="bg-background px-3 py-2">
          <p>By</p>
          <p className="mt-1 break-words text-foreground">
            {warning.moderator}
          </p>
        </div>
        <div className="bg-background px-3 py-2">
          <p>Term</p>
          <p className="mt-1 text-foreground">{termLabel}</p>
          {termDate ? (
            <p className="mt-1 text-muted-foreground">{termDate}</p>
          ) : null}
        </div>
      </div>
      <div className="grid gap-3 p-3">
        <p className="text-sm leading-6 text-foreground">{warning.reason}</p>
        <ForumWarningContextLinks warning={warning} />
      </div>
    </article>
  );
}

function ForumWarningContextLinks({
  warning,
}: {
  warning: ForumWarningRecord;
}) {
  const href = forumWarningContextHref(warning);
  const boardHref = warning.categorySlug
    ? forumPath(warning.categorySlug)
    : null;
  const contextScope = forumWarningContextScope(warning);
  const contextLabel = forumWarningContextLabel(warning);
  const boardLabel = warning.categoryName ?? warning.categorySlug;

  return (
    <div className="grid gap-2 pt-3 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-xl bg-muted px-2 py-1">{contextScope}</span>
        {href ? (
          <ForumLink
            className="focus-ring min-w-0 break-words hover:text-foreground"
            href={href}
            prefetch
          >
            {contextLabel}
          </ForumLink>
        ) : (
          <span className="min-w-0 break-words">{contextLabel}</span>
        )}
      </div>
      {boardHref && warning.threadSlug ? (
        <ForumLink
          className="focus-ring w-fit hover:text-foreground"
          href={boardHref}
          prefetch
        >
          Board: {boardLabel}
        </ForumLink>
      ) : null}
    </div>
  );
}

function forumWarningContextHref(warning: ForumWarningRecord) {
  if (!warning.categorySlug) {
    return null;
  }
  if (!warning.threadSlug) {
    return forumPath(warning.categorySlug);
  }
  return forumPostPath(
    warning.categorySlug,
    warning.threadSlug,
    warning.postNumber,
    warning.postPage,
  );
}

function forumWarningContextScope(warning: ForumWarningRecord) {
  if (warning.postNumber !== undefined) {
    return `Post #${warning.postNumber}`;
  }
  if (warning.threadSlug) {
    return "Thread";
  }
  if (warning.categorySlug) {
    return "Board";
  }
  return "Context";
}

function forumWarningContextLabel(warning: ForumWarningRecord) {
  if (warning.threadTitle && warning.postNumber !== undefined) {
    return warning.threadTitle;
  }
  if (warning.threadTitle) {
    return warning.threadTitle;
  }
  return warning.categoryName ?? "Context unavailable";
}

function ForumAccessPanel({ profile }: { profile: MyForumProfileRecord }) {
  const { trusted, activeWarningCount, activeWarningPoints } = profile;
  return (
    <section className="forum-panel scroll-mt-24 p-4" id="ucp-access">
      <p className="text-xs text-muted-foreground">Forum access</p>
      <h2 className="mt-2 text-lg font-semibold">
        {trusted ? "Trusted member" : "Approval pending"}
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-2 bg-transparent text-xs text-muted-foreground">
        <div className="bg-background px-3 py-3">
          <p>Status</p>
          <p className="mt-1 text-foreground">
            {trusted ? "Approved" : "Waiting"}
          </p>
        </div>
        <div className="bg-background px-3 py-3">
          <p>Private msgs</p>
          <p className="mt-1 text-foreground">
            {trusted ? "Enabled" : "Locked"}
          </p>
        </div>
        <div className="bg-background px-3 py-3">
          <p>Warnings</p>
          <p className="mt-1 text-foreground">{activeWarningCount}</p>
        </div>
        <div className="bg-background px-3 py-3">
          <p>Points</p>
          <p className="mt-1 text-foreground">{activeWarningPoints}</p>
        </div>
      </div>
      {activeWarningPoints > 0 ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Limited by active warnings.
        </p>
      ) : null}
    </section>
  );
}
