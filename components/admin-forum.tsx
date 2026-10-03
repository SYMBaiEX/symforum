"use client";

import styles from "./admin-forum.module.css";

import { reportAppError } from "@/components/app-error-surface";
import { FORUM_CALENDAR_TIME_ZONE } from "@/components/forum/forum-refs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  convexRefs,
  type AdminForumContentEditRecord,
  type AdminForumAnnouncementRecord,
  type AdminForumBoardRulesRecord,
  type AdminForumCalendarEventRecord,
  type AdminForumCategoryRecord,
  type AdminForumHelpDocumentRecord,
  type AdminForumModerationEventRecord,
  type AdminForumOverviewRecord,
  type AdminForumPostRecord,
  type AdminForumReportRecord,
  type AdminForumThreadRecord,
  type AdminForumThreadPrefixRecord,
  type AdminForumWarningRecord,
  type ForumCategoryModeratorRecord,
  type ForumCategoryKind,
  type ForumCategoryStatus,
  type ForumCategoryViewAccess,
  type ForumCategoryWriteAccess,
  type ForumCalendarEventStatus,
  type ForumPageStatus,
  type ForumPollRecord,
  type ForumPollStatus,
  type ForumPostStatus,
  type ForumReportStatus,
  type ForumThreadPrefixStatus,
  type ForumThreadStatus,
  type ForumWarningStatus,
} from "@/lib/convex-refs";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowDown,
  ArrowUp,
  Lock,
  MoveRight,
  Pin,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  useMemo,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  type SelectHTMLAttributes,
} from "react";
import { toast } from "sonner";

export type ForumCategoryRecord = AdminForumCategoryRecord;
export type ForumThreadRecord = AdminForumThreadRecord;
export type ForumThreadPrefixRecord = AdminForumThreadPrefixRecord;
export type ForumAnnouncementRecord = AdminForumAnnouncementRecord;
export type ForumCalendarEventRecord = AdminForumCalendarEventRecord;
export type ForumHelpDocumentRecord = AdminForumHelpDocumentRecord;
export type ForumBoardRulesRecord = AdminForumBoardRulesRecord;
export type ForumPostRecord = AdminForumPostRecord;
export type ForumReportRecord = AdminForumReportRecord;
export type ForumOverviewRecord = AdminForumOverviewRecord;
export type ForumModerationEventRecord = AdminForumModerationEventRecord;
export type ForumWarningRecord = AdminForumWarningRecord;

type CategoryForm = {
  categoryId?: string;
  slug: string;
  name: string;
  description: string;
  kind: ForumCategoryKind;
  parentCategoryId?: string;
  status: ForumCategoryStatus;
  viewAccess: ForumCategoryViewAccess;
  threadAccess: ForumCategoryWriteAccess;
  replyAccess: ForumCategoryWriteAccess;
  pollAccess: ForumCategoryWriteAccess;
  position: number;
};

type PrefixForm = {
  prefixId?: string;
  categoryId?: string;
  slug: string;
  label: string;
  description: string;
  color: string;
  status: ForumThreadPrefixStatus;
  position: number;
};

type AnnouncementForm = {
  announcementId?: string;
  categoryId?: string;
  slug: string;
  title: string;
  body: string;
  status: ForumPageStatus;
  position: number;
};

type HelpDocumentForm = {
  helpDocumentId?: string;
  slug: string;
  title: string;
  body: string;
  status: ForumPageStatus;
  position: number;
};

type CalendarEventForm = {
  eventId?: string;
  slug: string;
  title: string;
  body: string;
  status: ForumCalendarEventStatus;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
};

type RulesForm = {
  rulesId?: string;
  categoryId?: string;
  title: string;
  body: string;
  status: ForumPageStatus;
};

const emptyCategories: ForumCategoryRecord[] = [];
const emptyPrefixes: ForumThreadPrefixRecord[] = [];
const emptyAnnouncements: ForumAnnouncementRecord[] = [];
const emptyCalendarEvents: ForumCalendarEventRecord[] = [];
const emptyHelpDocuments: ForumHelpDocumentRecord[] = [];
const emptyBoardRules: ForumBoardRulesRecord[] = [];
const emptyThreads: ForumThreadRecord[] = [];
const emptyPosts: ForumPostRecord[] = [];
const emptyReports: ForumReportRecord[] = [];
const emptyModerationEvents: ForumModerationEventRecord[] = [];

const blankCategoryForm: CategoryForm = {
  slug: "",
  name: "",
  description: "",
  kind: "board",
  status: "active",
  viewAccess: "public",
  threadAccess: "trusted",
  replyAccess: "trusted",
  pollAccess: "trusted",
  position: 10,
};

const blankPrefixForm: PrefixForm = {
  slug: "",
  label: "",
  description: "",
  color: "#ff3ea5",
  status: "active",
  position: 10,
};

const blankAnnouncementForm: AnnouncementForm = {
  slug: "",
  title: "",
  body: "",
  status: "active",
  position: 10,
};

const blankHelpDocumentForm: HelpDocumentForm = {
  slug: "",
  title: "",
  body: "",
  status: "active",
  position: 10,
};

const blankCalendarEventForm: CalendarEventForm = {
  slug: "",
  title: "",
  body: "",
  status: "active",
  startsAt: "",
  endsAt: "",
  allDay: false,
};

const blankRulesForm: RulesForm = {
  title: "Board rules",
  body: "",
  status: "active",
};

export const adminForumOverviewRef = convexRefs.admin.forumOverview;
const adminListCategoriesRef = convexRefs.admin.listForumCategories;
const adminListThreadPrefixesRef = convexRefs.admin.listForumThreadPrefixes;
const adminListAnnouncementsRef = convexRefs.admin.listForumAnnouncements;
const adminListHelpDocumentsRef = convexRefs.admin.listForumHelpDocuments;
const adminListCalendarEventsRef = convexRefs.admin.listForumCalendarEvents;
const adminListBoardRulesRef = convexRefs.admin.listForumBoardRules;
const adminUpsertCategoryRef = convexRefs.admin.upsertForumCategory;
const adminAssignCategoryModeratorRef =
  convexRefs.admin.assignForumCategoryModerator;
const adminRemoveCategoryModeratorRef =
  convexRefs.admin.removeForumCategoryModerator;
const adminUpsertThreadPrefixRef = convexRefs.admin.upsertForumThreadPrefix;
const adminUpsertAnnouncementRef = convexRefs.admin.upsertForumAnnouncement;
const adminUpsertHelpDocumentRef = convexRefs.admin.upsertForumHelpDocument;
const adminUpsertCalendarEventRef = convexRefs.admin.upsertForumCalendarEvent;
const adminUpsertBoardRulesRef = convexRefs.admin.upsertForumBoardRules;
const adminReorderCategoriesRef = convexRefs.admin.reorderForumCategories;
const adminListThreadsRef = convexRefs.admin.listForumThreads;
const adminListPostsRef = convexRefs.admin.listForumPosts;
const adminMoveThreadRef = convexRefs.admin.moveForumThread;
const adminMovePostsRef = convexRefs.admin.moveForumPosts;
const adminSplitPostsRef = convexRefs.admin.splitForumPosts;
const adminMergeThreadRef = convexRefs.admin.mergeForumThread;
const adminSetThreadStateRef = convexRefs.admin.updateForumThreadModeration;
const adminSetPostStateRef = convexRefs.admin.updateForumPostModeration;
const adminListReportsRef = convexRefs.admin.listForumReports;
const adminListModerationEventsRef = convexRefs.admin.listForumModerationEvents;
const adminUpdateReportRef = convexRefs.admin.updateForumReportStatus;
const adminListWarningsRef = convexRefs.admin.listForumWarnings;
const adminIssueWarningRef = convexRefs.admin.issueForumWarning;
const adminUpdateWarningStatusRef = convexRefs.admin.updateForumWarningStatus;
const adminGetThreadRef = convexRefs.admin.getForumThread;
const adminListContentEditsRef = convexRefs.admin.listForumContentEdits;
const adminUpdatePollRef = convexRefs.admin.updateForumPollStatus;
const ensureDefaultCategoriesRef =
  convexRefs.admin.ensureDefaultForumCategories;

type AdminThreadDetailResult = {
  category: AdminForumCategoryRecord;
  thread: AdminForumThreadRecord;
  poll: ForumPollRecord | null;
  replies: {
    page: AdminForumPostRecord[];
    isDone: boolean;
    continueCursor: string;
  };
  focusPost: AdminForumPostRecord | null;
};

type AdminForumMode = "full" | "moderation";

export function AdminForum({ mode = "full" }: { mode?: AdminForumMode } = {}) {
  const moderationOnly = mode === "moderation";
  const overview = useQuery(adminForumOverviewRef, {});
  const categories = useQuery(
    adminListCategoriesRef,
    moderationOnly ? "skip" : { includeArchived: true },
  );
  const prefixes = useQuery(
    adminListThreadPrefixesRef,
    moderationOnly ? "skip" : { includeArchived: true },
  );
  const announcements = useQuery(
    adminListAnnouncementsRef,
    moderationOnly ? "skip" : { includeArchived: true },
  );
  const helpDocuments = useQuery(
    adminListHelpDocumentsRef,
    moderationOnly ? "skip" : { includeArchived: true },
  );
  const calendarEvents = useQuery(
    adminListCalendarEventsRef,
    moderationOnly ? "skip" : { includeArchived: true },
  );
  const boardRules = useQuery(
    adminListBoardRulesRef,
    moderationOnly ? "skip" : { includeArchived: true },
  );
  const [threadCategoryFilter, setThreadCategoryFilter] = useState("all");
  const [threadStatusFilter, setThreadStatusFilter] = useState("pending");
  const [postStatusFilter, setPostStatusFilter] = useState<
    "all" | ForumPostStatus
  >("pending");
  const [reportStatusFilter, setReportStatusFilter] = useState<
    "all" | ForumReportStatus
  >("open");
  const [auditCategoryFilter, setAuditCategoryFilter] = useState("all");
  const threadQueryArgs = useMemo(
    () => ({
      ...(threadCategoryFilter === "all"
        ? {}
        : { categoryId: threadCategoryFilter }),
      ...(isForumThreadStatus(threadStatusFilter)
        ? { status: threadStatusFilter }
        : {}),
    }),
    [threadCategoryFilter, threadStatusFilter],
  );
  const threads = useQuery(adminListThreadsRef, threadQueryArgs);
  const postQueryArgs = useMemo(
    () => ({
      ...(postStatusFilter === "all" ? {} : { status: postStatusFilter }),
      limit: 24,
    }),
    [postStatusFilter],
  );
  const posts = useQuery(adminListPostsRef, postQueryArgs);
  const reportQueryArgs = useMemo(
    () => ({
      ...(reportStatusFilter === "all" ? {} : { status: reportStatusFilter }),
      limit: 24,
    }),
    [reportStatusFilter],
  );
  const auditQueryArgs = useMemo(
    () => ({
      ...(auditCategoryFilter === "all"
        ? {}
        : { categoryId: auditCategoryFilter }),
      limit: 24,
    }),
    [auditCategoryFilter],
  );
  const reports = useQuery(adminListReportsRef, reportQueryArgs);
  const moderationEvents = useQuery(
    adminListModerationEventsRef,
    auditQueryArgs,
  );
  const upsertCategory = useMutation(adminUpsertCategoryRef);
  const assignCategoryModerator = useMutation(adminAssignCategoryModeratorRef);
  const removeCategoryModerator = useMutation(adminRemoveCategoryModeratorRef);
  const upsertThreadPrefix = useMutation(adminUpsertThreadPrefixRef);
  const upsertAnnouncement = useMutation(adminUpsertAnnouncementRef);
  const upsertHelpDocument = useMutation(adminUpsertHelpDocumentRef);
  const upsertCalendarEvent = useMutation(adminUpsertCalendarEventRef);
  const upsertBoardRules = useMutation(adminUpsertBoardRulesRef);
  const reorderCategories = useMutation(adminReorderCategoriesRef);
  const setThreadState = useMutation(adminSetThreadStateRef);
  const moveThread = useMutation(adminMoveThreadRef);
  const movePosts = useMutation(adminMovePostsRef);
  const splitPosts = useMutation(adminSplitPostsRef);
  const mergeThread = useMutation(adminMergeThreadRef);
  const setPostState = useMutation(adminSetPostStateRef);
  const updateReportStatus = useMutation(adminUpdateReportRef);
  const updatePollStatus = useMutation(adminUpdatePollRef);
  const ensureDefaultCategories = useMutation(ensureDefaultCategoriesRef);
  const [categoryForm, setCategoryForm] =
    useState<CategoryForm>(blankCategoryForm);
  const [categoryModeratorUsername, setCategoryModeratorUsername] =
    useState("");
  const [prefixForm, setPrefixForm] = useState<PrefixForm>(blankPrefixForm);
  const [announcementForm, setAnnouncementForm] = useState<AnnouncementForm>(
    blankAnnouncementForm,
  );
  const [helpDocumentForm, setHelpDocumentForm] = useState<HelpDocumentForm>(
    blankHelpDocumentForm,
  );
  const [calendarEventForm, setCalendarEventForm] = useState<CalendarEventForm>(
    blankCalendarEventForm,
  );
  const [rulesForm, setRulesForm] = useState<RulesForm>(blankRulesForm);
  const [threadReasons, setThreadReasons] = useState<Record<string, string>>(
    {},
  );
  const [threadMoveTargets, setThreadMoveTargets] = useState<
    Record<string, string>
  >({});
  const [postReasons, setPostReasons] = useState<Record<string, string>>({});
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  const [selectedPostIds, setSelectedPostIds] = useState<string[]>([]);
  const [threadBulkReason, setThreadBulkReason] = useState("");
  const [threadMergeTargetThreadId, setThreadMergeTargetThreadId] =
    useState("");
  const [postBulkReason, setPostBulkReason] = useState("");
  const [postMoveTargetThreadId, setPostMoveTargetThreadId] = useState("");
  const [postSplitTargetCategoryId, setPostSplitTargetCategoryId] =
    useState("");
  const [postSplitTitle, setPostSplitTitle] = useState("");
  const [threadBulkPending, setThreadBulkPending] = useState(false);
  const [postBulkPending, setPostBulkPending] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [reportNoteDrafts, setReportNoteDrafts] = useState<
    Record<string, string>
  >({});
  const categoryNameRef = useRef<HTMLInputElement | null>(null);
  const reportInspectorHeadingRef = useRef<HTMLParagraphElement | null>(null);
  const reportInspectTriggerRef = useRef<HTMLButtonElement | null>(null);

  const categoryRows = useMemo(
    () => categories ?? overview?.categories ?? emptyCategories,
    [categories, overview?.categories],
  );
  const prefixRows = prefixes ?? emptyPrefixes;
  const announcementRows = announcements ?? emptyAnnouncements;
  const calendarEventRows = calendarEvents ?? emptyCalendarEvents;
  const helpDocumentRows = helpDocuments ?? emptyHelpDocuments;
  const boardRulesRows = boardRules ?? emptyBoardRules;
  const recentPosts =
    posts ??
    // Overview posts are mixed-status; moderation queues must wait for listForumPosts.
    (moderationOnly ? emptyPosts : (overview?.recentPosts ?? emptyPosts));
  const postMetricCount =
    overview?.totals?.posts ??
    overview?.recentPosts?.length ??
    recentPosts.length;
  const reportRows = reports ?? emptyReports;
  const moderationEventRows = moderationEvents ?? emptyModerationEvents;
  const selectedReport =
    selectedReportId === null
      ? null
      : (reportRows.find((report) => report._id === selectedReportId) ?? null);
  const selectedThreadDetail = useQuery(
    adminGetThreadRef,
    selectedReport?.threadId
      ? {
          threadId: selectedReport.threadId,
          paginationOpts: { numItems: 25, cursor: null },
          ...(selectedReport.postId
            ? { focusPostId: selectedReport.postId }
            : {}),
        }
      : "skip",
  ) as AdminThreadDetailResult | undefined;
  const selectedSlug = categoryForm.slug.trim();
  const existingCategory =
    categoryForm.categoryId !== undefined
      ? (categoryRows.find(
          (category) => category._id === categoryForm.categoryId,
        ) ?? null)
      : (categoryRows.find((category) => category.slug === selectedSlug) ??
        null);
  const existingPrefix =
    prefixForm.prefixId === undefined
      ? null
      : (prefixRows.find((prefix) => prefix._id === prefixForm.prefixId) ??
        null);
  const existingAnnouncement =
    announcementForm.announcementId === undefined
      ? null
      : (announcementRows.find(
          (announcement) =>
            announcement._id === announcementForm.announcementId,
        ) ?? null);
  const existingHelpDocument =
    helpDocumentForm.helpDocumentId === undefined
      ? null
      : (helpDocumentRows.find(
          (document) => document._id === helpDocumentForm.helpDocumentId,
        ) ?? null);
  const existingCalendarEvent =
    calendarEventForm.eventId === undefined
      ? null
      : (calendarEventRows.find(
          (event) => event._id === calendarEventForm.eventId,
        ) ?? null);
  const existingRules =
    rulesForm.rulesId === undefined
      ? null
      : (boardRulesRows.find((rules) => rules._id === rulesForm.rulesId) ??
        null);
  const sortedCategories = useMemo(
    () =>
      [...categoryRows].sort((left, right) => {
        const positionDelta = left.position - right.position;
        if (positionDelta !== 0) {
          return positionDelta;
        }
        return left.name.localeCompare(right.name);
      }),
    [categoryRows],
  );
  const sortedPrefixes = useMemo(
    () =>
      [...prefixRows].sort((left, right) => {
        const categoryDelta = (left.categoryName ?? "").localeCompare(
          right.categoryName ?? "",
        );
        if (categoryDelta !== 0) {
          return categoryDelta;
        }
        const positionDelta = (left.position ?? 0) - (right.position ?? 0);
        return positionDelta === 0
          ? left.label.localeCompare(right.label)
          : positionDelta;
      }),
    [prefixRows],
  );
  const sortedAnnouncements = useMemo(
    () =>
      [...announcementRows].sort((left, right) => {
        const categoryDelta = (left.categoryName ?? "").localeCompare(
          right.categoryName ?? "",
        );
        if (categoryDelta !== 0) {
          return categoryDelta;
        }
        const positionDelta = left.position - right.position;
        return positionDelta === 0
          ? left.title.localeCompare(right.title)
          : positionDelta;
      }),
    [announcementRows],
  );
  const sortedHelpDocuments = useMemo(
    () =>
      [...helpDocumentRows].sort((left, right) => {
        const positionDelta = left.position - right.position;
        return positionDelta === 0
          ? left.title.localeCompare(right.title)
          : positionDelta;
      }),
    [helpDocumentRows],
  );
  const sortedCalendarEvents = useMemo(
    () =>
      [...calendarEventRows].sort((left, right) => {
        const startsDelta = right.startsAt - left.startsAt;
        return startsDelta === 0
          ? left.title.localeCompare(right.title)
          : startsDelta;
      }),
    [calendarEventRows],
  );
  const sortedBoardRules = useMemo(
    () =>
      [...boardRulesRows].sort((left, right) => {
        const categoryDelta = (left.categoryName ?? "").localeCompare(
          right.categoryName ?? "",
        );
        if (categoryDelta !== 0) {
          return categoryDelta;
        }
        return right.updatedAt - left.updatedAt;
      }),
    [boardRulesRows],
  );
  const categoriesById = useMemo(
    () => new Map(sortedCategories.map((category) => [category._id, category])),
    [sortedCategories],
  );
  const boardCategories = useMemo(
    () => sortedCategories.filter((category) => category.kind !== "section"),
    [sortedCategories],
  );
  const moveBoardCategories = useMemo(
    () =>
      sortedCategories.filter((category) =>
        canHostVisibleThreadCategory(category, categoriesById),
      ),
    [categoriesById, sortedCategories],
  );
  const parentCategoryOptions = useMemo(
    () =>
      sortedCategories.filter(
        (category) =>
          category._id !== categoryForm.categoryId &&
          !isDescendantCategory(
            category,
            categoryForm.categoryId,
            categoriesById,
          ) &&
          isParentableForumCategory(category, categoriesById),
      ),
    [categoriesById, categoryForm.categoryId, sortedCategories],
  );
  const threadRows = useMemo(() => {
    if (threads) {
      return threads;
    }
    if (threadCategoryFilter === "all" && threadStatusFilter === "all") {
      return overview?.recentThreads ?? emptyThreads;
    }
    return emptyThreads;
  }, [
    overview?.recentThreads,
    threadCategoryFilter,
    threadStatusFilter,
    threads,
  ]);
  const selectedThreadIdSet = useMemo(
    () => new Set(selectedThreadIds),
    [selectedThreadIds],
  );
  const selectedPostIdSet = useMemo(
    () => new Set(selectedPostIds),
    [selectedPostIds],
  );
  const allVisibleThreadsSelected =
    threadRows.length > 0 &&
    threadRows.every((thread) => selectedThreadIdSet.has(thread._id));
  const allVisiblePostsSelected =
    recentPosts.length > 0 &&
    recentPosts.every((post) => selectedPostIdSet.has(post._id));
  const threadStatusOptions: ForumThreadStatus[] = [
    "active",
    "pending",
    "locked",
    "hidden",
    "deleted",
  ];
  const postStatusOptions: ForumPostStatus[] = [
    "pending",
    "active",
    "hidden",
    "deleted",
  ];

  useEffect(() => {
    const visibleThreadIds = new Set(threadRows.map((thread) => thread._id));
    setSelectedThreadIds((current) => {
      const next = current.filter((threadId) => visibleThreadIds.has(threadId));
      return next.length === current.length ? current : next;
    });
  }, [threadRows]);

  useEffect(() => {
    const visiblePostIds = new Set(recentPosts.map((post) => post._id));
    setSelectedPostIds((current) => {
      const next = current.filter((postId) => visiblePostIds.has(postId));
      return next.length === current.length ? current : next;
    });
  }, [recentPosts]);

  useEffect(() => {
    if (
      selectedReportId !== null &&
      reports !== undefined &&
      !reportRows.some((report) => report._id === selectedReportId)
    ) {
      setSelectedReportId(null);
    }
  }, [reportRows, reports, selectedReportId]);

  useEffect(() => {
    if (selectedReportId === null) {
      return;
    }
    window.requestAnimationFrame(() => {
      reportInspectorHeadingRef.current?.focus();
    });
  }, [selectedReportId, selectedThreadDetail]);

  function focusCategoryName() {
    window.requestAnimationFrame(() => {
      categoryNameRef.current?.focus();
      categoryNameRef.current?.select();
    });
  }

  function loadCategoryForm(category: ForumCategoryRecord | CategoryForm) {
    setCategoryForm(categoryToForm(category));
    setCategoryModeratorUsername("");
    focusCategoryName();
  }

  function loadPrefixForm(prefix: ForumThreadPrefixRecord | PrefixForm) {
    setPrefixForm(prefixToForm(prefix));
  }

  function loadAnnouncementForm(
    announcement: ForumAnnouncementRecord | AnnouncementForm,
  ) {
    setAnnouncementForm(announcementToForm(announcement));
  }

  function loadHelpDocumentForm(
    document: ForumHelpDocumentRecord | HelpDocumentForm,
  ) {
    setHelpDocumentForm(helpDocumentToForm(document));
  }

  function loadCalendarEventForm(
    event: ForumCalendarEventRecord | CalendarEventForm,
  ) {
    setCalendarEventForm(calendarEventToForm(event));
  }

  function loadRulesForm(rules: ForumBoardRulesRecord | RulesForm) {
    setRulesForm(rulesToForm(rules));
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const saved = await upsertCategory({
        categoryId: existingCategory?._id,
        slug: categoryForm.slug.trim() || undefined,
        name: categoryForm.name.trim(),
        description: categoryForm.description.trim(),
        kind: categoryForm.kind,
        parentCategoryId:
          categoryForm.kind === "section"
            ? undefined
            : categoryForm.parentCategoryId,
        status: categoryForm.status,
        viewAccess: categoryForm.viewAccess,
        threadAccess: categoryForm.threadAccess,
        replyAccess: categoryForm.replyAccess,
        pollAccess: categoryForm.pollAccess,
        position: Number(categoryForm.position),
      });
      setCategoryForm(categoryToForm(saved));
      toast.success(existingCategory ? "Category updated" : "Category created");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "category_save_failed",
        component: "AdminForum",
        action: "forum:upsertForumCategory",
        entityType: "forumCategory",
        entityId: existingCategory?._id,
        metadata: { slug: categoryForm.slug.trim() || undefined },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not save category",
      );
    }
  }

  async function assignModeratorToCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (existingCategory === null || existingCategory.kind !== "board") {
      toast.error("Choose a saved board first");
      return;
    }
    const username = categoryModeratorUsername.trim();
    if (username.length === 0) {
      toast.error("Enter a forum username");
      return;
    }
    try {
      const result = await assignCategoryModerator({
        categoryId: existingCategory._id,
        username,
      });
      setCategoryForm(categoryToForm(result.category));
      setCategoryModeratorUsername("");
      toast.success(
        result.assigned
          ? `${result.moderator.displayName} assigned`
          : `${result.moderator.displayName} is already assigned`,
      );
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "category_moderator_assign_failed",
        component: "AdminForum",
        action: "forum:assignCategoryModerator",
        entityType: "forumCategory",
        entityId: existingCategory._id,
        metadata: { username },
        notify: false,
      });
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not assign board moderator",
      );
    }
  }

  async function removeModeratorFromCategory(
    moderator: ForumCategoryModeratorRecord,
  ) {
    try {
      const result = await removeCategoryModerator({
        moderatorId: moderator._id,
      });
      if (result.category !== null) {
        setCategoryForm(categoryToForm(result.category));
      }
      toast.success(`${moderator.displayName} removed`);
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "category_moderator_remove_failed",
        component: "AdminForum",
        action: "forum:removeCategoryModerator",
        entityType: "forumCategoryModerator",
        entityId: moderator._id,
        metadata: { userId: moderator.userId },
        notify: false,
      });
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not remove board moderator",
      );
    }
  }

  async function savePrefix(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const saved = await upsertThreadPrefix({
        prefixId: prefixForm.prefixId,
        categoryId: prefixForm.categoryId,
        slug: prefixForm.slug.trim(),
        label: prefixForm.label.trim(),
        description: prefixForm.description.trim() || undefined,
        color: prefixForm.color.trim() || undefined,
        status: prefixForm.status,
        position: Number(prefixForm.position),
      });
      setPrefixForm(prefixToForm(saved));
      toastPrefixSyncResult(
        saved,
        existingPrefix ? "Prefix updated" : "Prefix created",
      );
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "thread_prefix_save_failed",
        component: "AdminForum",
        action: "forum:upsertThreadPrefixAdmin",
        entityType: "forumThreadPrefix",
        entityId: prefixForm.prefixId,
        metadata: { slug: prefixForm.slug.trim() || undefined },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not save prefix",
      );
    }
  }

  async function updatePrefixState(
    prefix: ForumThreadPrefixRecord,
    status: ForumThreadPrefixStatus,
  ) {
    try {
      const saved = await upsertThreadPrefix({
        prefixId: prefix._id,
        categoryId: prefix.categoryId,
        slug: prefix.slug,
        label: prefix.label,
        description: prefix.description,
        color: prefix.color,
        status,
        position: prefix.position,
      });
      if (prefixForm.prefixId === prefix._id) {
        setPrefixForm(prefixToForm(saved));
      }
      toastPrefixSyncResult(saved, `Prefix marked ${status}`);
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "thread_prefix_status_failed",
        component: "AdminForum",
        action: "forum:upsertThreadPrefixAdmin",
        entityType: "forumThreadPrefix",
        entityId: prefix._id,
        metadata: { status },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not update prefix",
      );
    }
  }

  async function saveAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const saved = await upsertAnnouncement({
        announcementId: announcementForm.announcementId,
        categoryId: announcementForm.categoryId,
        slug: announcementForm.slug.trim(),
        title: announcementForm.title.trim(),
        body: announcementForm.body.trim(),
        status: announcementForm.status,
        position: Number(announcementForm.position),
      });
      setAnnouncementForm(announcementToForm(saved));
      toast.success(
        existingAnnouncement ? "Announcement updated" : "Announcement created",
      );
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "forum_announcement_save_failed",
        component: "AdminForum",
        action: "forum:upsertAnnouncementAdmin",
        entityType: "forumAnnouncement",
        entityId: announcementForm.announcementId,
        metadata: { slug: announcementForm.slug.trim() || undefined },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not save announcement",
      );
    }
  }

  async function updateAnnouncementState(
    announcement: ForumAnnouncementRecord,
    status: ForumPageStatus,
  ) {
    try {
      const saved = await upsertAnnouncement({
        announcementId: announcement._id,
        categoryId: announcement.categoryId,
        slug: announcement.slug,
        title: announcement.title,
        body: announcement.body,
        status,
        position: announcement.position,
      });
      if (announcementForm.announcementId === announcement._id) {
        setAnnouncementForm(announcementToForm(saved));
      }
      toast.success(`Announcement marked ${status}`);
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "forum_announcement_status_failed",
        component: "AdminForum",
        action: "forum:upsertAnnouncementAdmin",
        entityType: "forumAnnouncement",
        entityId: announcement._id,
        metadata: { status },
        notify: false,
      });
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update announcement",
      );
    }
  }

  async function saveHelpDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const saved = await upsertHelpDocument({
        helpDocumentId: helpDocumentForm.helpDocumentId,
        slug: helpDocumentForm.slug.trim(),
        title: helpDocumentForm.title.trim(),
        body: helpDocumentForm.body.trim(),
        status: helpDocumentForm.status,
        position: Number(helpDocumentForm.position),
      });
      setHelpDocumentForm(helpDocumentToForm(saved));
      toast.success(
        existingHelpDocument
          ? "Help document updated"
          : "Help document created",
      );
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "forum_help_document_save_failed",
        component: "AdminForum",
        action: "forum:upsertHelpDocumentAdmin",
        entityType: "forumHelpDocument",
        entityId: helpDocumentForm.helpDocumentId,
        metadata: { slug: helpDocumentForm.slug.trim() || undefined },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not save help document",
      );
    }
  }

  async function updateHelpDocumentState(
    document: ForumHelpDocumentRecord,
    status: ForumPageStatus,
  ) {
    try {
      const saved = await upsertHelpDocument({
        helpDocumentId: document._id,
        slug: document.slug,
        title: document.title,
        body: document.body,
        status,
        position: document.position,
      });
      if (helpDocumentForm.helpDocumentId === document._id) {
        setHelpDocumentForm(helpDocumentToForm(saved));
      }
      toast.success(`Help document marked ${status}`);
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "forum_help_document_status_failed",
        component: "AdminForum",
        action: "forum:upsertHelpDocumentAdmin",
        entityType: "forumHelpDocument",
        entityId: document._id,
        metadata: { status },
        notify: false,
      });
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update help document",
      );
    }
  }

  async function saveCalendarEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const startsAt = parseDateTimeInput(calendarEventForm.startsAt);
    const endsAt = parseOptionalDateTimeInput(calendarEventForm.endsAt);
    if (startsAt === null) {
      toast.error("Choose a valid start date");
      return;
    }
    if (endsAt === null) {
      toast.error("Choose a valid end date");
      return;
    }

    try {
      const saved = await upsertCalendarEvent({
        eventId: calendarEventForm.eventId,
        slug: calendarEventForm.slug.trim(),
        title: calendarEventForm.title.trim(),
        body: calendarEventForm.body.trim(),
        status: calendarEventForm.status,
        startsAt,
        ...(endsAt === undefined ? {} : { endsAt }),
        allDay: calendarEventForm.allDay,
      });
      setCalendarEventForm(calendarEventToForm(saved));
      toast.success(
        existingCalendarEvent
          ? "Calendar event updated"
          : "Calendar event created",
      );
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "forum_calendar_event_save_failed",
        component: "AdminForum",
        action: "forum:upsertCalendarEventAdmin",
        entityType: "forumCalendarEvent",
        entityId: calendarEventForm.eventId,
        metadata: { slug: calendarEventForm.slug.trim() || undefined },
        notify: false,
      });
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save calendar event",
      );
    }
  }

  async function updateCalendarEventState(
    event: ForumCalendarEventRecord,
    status: ForumCalendarEventStatus,
  ) {
    try {
      const saved = await upsertCalendarEvent({
        eventId: event._id,
        slug: event.slug,
        title: event.title,
        body: event.body,
        status,
        startsAt: event.startsAt,
        ...(event.endsAt === undefined ? {} : { endsAt: event.endsAt }),
        allDay: event.allDay,
      });
      if (calendarEventForm.eventId === event._id) {
        setCalendarEventForm(calendarEventToForm(saved));
      }
      toast.success(`Calendar event marked ${status}`);
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "forum_calendar_event_status_failed",
        component: "AdminForum",
        action: "forum:upsertCalendarEventAdmin",
        entityType: "forumCalendarEvent",
        entityId: event._id,
        metadata: { status },
        notify: false,
      });
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update calendar event",
      );
    }
  }

  async function saveRules(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rulesForm.categoryId) {
      toast.error("Choose a board for these rules");
      return;
    }
    try {
      const saved = await upsertBoardRules({
        rulesId: rulesForm.rulesId,
        categoryId: rulesForm.categoryId,
        title: rulesForm.title.trim(),
        body: rulesForm.body.trim(),
        status: rulesForm.status,
      });
      setRulesForm(rulesToForm(saved));
      toast.success(
        existingRules ? "Board rules updated" : "Board rules created",
      );
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "forum_board_rules_save_failed",
        component: "AdminForum",
        action: "forum:upsertBoardRulesAdmin",
        entityType: "forumBoardRules",
        entityId: rulesForm.rulesId,
        metadata: { categoryId: rulesForm.categoryId },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not save board rules",
      );
    }
  }

  async function updateRulesState(
    rules: ForumBoardRulesRecord,
    status: ForumPageStatus,
  ) {
    try {
      const saved = await upsertBoardRules({
        rulesId: rules._id,
        categoryId: rules.categoryId,
        title: rules.title,
        body: rules.body,
        status,
      });
      if (rulesForm.rulesId === rules._id) {
        setRulesForm(rulesToForm(saved));
      }
      toast.success(`Board rules marked ${status}`);
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "forum_board_rules_status_failed",
        component: "AdminForum",
        action: "forum:upsertBoardRulesAdmin",
        entityType: "forumBoardRules",
        entityId: rules._id,
        metadata: { status },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not update rules",
      );
    }
  }

  async function updateCategoryState(
    category: ForumCategoryRecord,
    status: ForumCategoryStatus,
  ) {
    try {
      await upsertCategory({
        categoryId: category._id,
        slug: category.slug,
        name: category.name,
        description: category.description,
        kind: category.kind,
        parentCategoryId: category.parentCategoryId,
        status,
        viewAccess: category.viewAccess,
        threadAccess: category.threadAccess,
        replyAccess: category.replyAccess,
        pollAccess: category.pollAccess,
        position: category.position,
      });
      if (selectedSlug === category.slug) {
        setCategoryForm((current) => ({ ...current, status }));
      }
      toast.success(`Category marked ${status}`);
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "category_status_failed",
        component: "AdminForum",
        action: "forum:upsertForumCategory",
        entityType: "forumCategory",
        entityId: category._id,
        metadata: { status },
        notify: false,
      });
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update category status",
      );
    }
  }

  async function moveCategory(
    category: ForumCategoryRecord,
    direction: -1 | 1,
  ) {
    const index = sortedCategories.findIndex(
      (item) => item._id === category._id,
    );
    const swapWith = sortedCategories[index + direction];
    if (index < 0 || !swapWith) {
      return;
    }

    try {
      const categoryIds = sortedCategories.map((item) => item._id);
      [categoryIds[index], categoryIds[index + direction]] = [
        categoryIds[index + direction],
        categoryIds[index],
      ];
      await reorderCategories({ categoryIds });
      toast.success("Category order updated");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "category_reorder_failed",
        component: "AdminForum",
        action: "forum:reorderForumCategories",
        entityType: "forumCategory",
        entityId: category._id,
        metadata: { direction },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not reorder category",
      );
    }
  }

  async function seedCategories() {
    try {
      await ensureDefaultCategories({});
      toast.success("Default categories seeded");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "forum_seed_failed",
        component: "AdminForum",
        action: "forum:ensureDefaultForumCategories",
        notify: false,
      });
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not seed default categories",
      );
    }
  }

  async function updateThread(
    thread: ForumThreadRecord,
    patch: {
      status?: ForumThreadStatus;
      pinned?: boolean;
    },
  ) {
    try {
      await setThreadState({
        threadId: thread._id,
        ...patch,
        moderationReason: threadReason(thread._id) || undefined,
      });
      clearThreadReason(thread._id);
      toast.success("Thread updated");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "thread_update_failed",
        component: "AdminForum",
        action: "forum:updateForumThreadModeration",
        entityType: "forumThread",
        entityId: thread._id,
        metadata: patch,
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not update thread",
      );
    }
  }

  async function removeThread(thread: ForumThreadRecord) {
    if (!window.confirm(`Delete thread "${thread.title}"?`)) {
      return;
    }
    await updateThread(thread, { status: "deleted" });
  }

  async function moveThreadToCategory(thread: ForumThreadRecord) {
    const targetCategoryId = threadMoveTargets[thread._id] ?? "";
    const targetCategory = categoriesById.get(targetCategoryId);
    if (!targetCategory || targetCategory._id === thread.categoryId) {
      toast.error("Choose a different active board first");
      return;
    }

    try {
      await moveThread({
        threadId: thread._id,
        targetCategoryId: targetCategory._id,
        moderationReason: threadReason(thread._id) || undefined,
      });
      clearThreadMoveTarget(thread._id);
      clearThreadReason(thread._id);
      toast.success(`Thread moved to ${targetCategory.name}`);
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "thread_move_failed",
        component: "AdminForum",
        action: "forum:moveForumThread",
        entityType: "forumThread",
        entityId: thread._id,
        metadata: { targetCategoryId: targetCategory._id },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not move thread",
      );
    }
  }

  async function updatePost(post: ForumPostRecord, status: ForumPostStatus) {
    try {
      await setPostState({
        postId: post._id,
        status,
        moderationReason: postReason(post._id) || undefined,
      });
      clearPostReason(post._id);
      toast.success("Post updated");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "post_update_failed",
        component: "AdminForum",
        action: "forum:updateForumPostModeration",
        entityType: "forumPost",
        entityId: post._id,
        metadata: { status },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not update post",
      );
    }
  }

  async function removePost(post: ForumPostRecord) {
    if (!window.confirm(`Delete post in "${post.threadTitle ?? "thread"}"?`)) {
      return;
    }
    await updatePost(post, "deleted");
  }

  function setThreadSelected(threadId: string, selected: boolean) {
    setSelectedThreadIds((current) => {
      if (selected) {
        return current.includes(threadId) ? current : [...current, threadId];
      }
      return current.filter((id) => id !== threadId);
    });
  }

  function setPostSelected(postId: string, selected: boolean) {
    setSelectedPostIds((current) => {
      if (selected) {
        return current.includes(postId) ? current : [...current, postId];
      }
      return current.filter((id) => id !== postId);
    });
  }

  function setAllVisibleThreadsSelected(selected: boolean) {
    const visibleIds = threadRows.map((thread) => thread._id);
    const visibleIdSet = new Set(visibleIds);
    setSelectedThreadIds((current) => {
      if (!selected) {
        return current.filter((id) => !visibleIdSet.has(id));
      }
      return Array.from(new Set([...current, ...visibleIds]));
    });
  }

  function setAllVisiblePostsSelected(selected: boolean) {
    const visibleIds = recentPosts.map((post) => post._id);
    const visibleIdSet = new Set(visibleIds);
    setSelectedPostIds((current) => {
      if (!selected) {
        return current.filter((id) => !visibleIdSet.has(id));
      }
      return Array.from(new Set([...current, ...visibleIds]));
    });
  }

  async function updateSelectedThreads(
    patch: {
      status?: ForumThreadStatus;
      pinned?: boolean;
    },
    label: string,
    options: {
      confirm?: (count: number) => string;
      eligible?: (thread: ForumThreadRecord) => boolean;
    } = {},
  ) {
    const selectedThreads = threadRows.filter((thread) =>
      selectedThreadIdSet.has(thread._id),
    );
    if (selectedThreads.length === 0) {
      toast.error("Select at least one thread first");
      return;
    }

    const targets = options.eligible
      ? selectedThreads.filter(options.eligible)
      : selectedThreads;
    const skipped = selectedThreads.length - targets.length;
    if (targets.length === 0) {
      toast.error("No selected threads are eligible for that action");
      return;
    }
    if (options.confirm && !window.confirm(options.confirm(targets.length))) {
      return;
    }

    const moderationReason = threadBulkReason.trim() || undefined;
    const failed: Array<{ id: string; message: string }> = [];
    const succeededIds: string[] = [];

    setThreadBulkPending(true);
    try {
      for (const thread of targets) {
        try {
          await setThreadState({
            threadId: thread._id,
            ...patch,
            moderationReason,
          });
          clearThreadReason(thread._id);
          succeededIds.push(thread._id);
        } catch (error) {
          failed.push({
            id: thread._id,
            message:
              error instanceof Error ? error.message : "Unknown thread error",
          });
        }
      }

      const succeededIdSet = new Set(succeededIds);
      setSelectedThreadIds((current) =>
        current.filter((id) => !succeededIdSet.has(id)),
      );

      if (failed.length === 0) {
        setThreadBulkReason("");
        toast.success(
          `${label} ${succeededIds.length} thread${
            succeededIds.length === 1 ? "" : "s"
          }${skipped > 0 ? `, skipped ${skipped}` : ""}`,
        );
      } else {
        reportAppError(new Error("Bulk thread moderation failed"), {
          scope: "admin-forum",
          eventType: "thread_bulk_update_failed",
          component: "AdminForum",
          action: "forum:updateForumThreadModeration:bulk",
          metadata: {
            failed,
            patch,
            skipped,
            succeeded: succeededIds.length,
          },
          notify: false,
        });
        toast.error(
          `${label}: ${succeededIds.length} updated, ${failed.length} failed${
            skipped > 0 ? `, ${skipped} skipped` : ""
          }`,
        );
      }
    } finally {
      setThreadBulkPending(false);
    }
  }

  async function mergeSelectedThreadIntoTarget() {
    const targetThreadId = threadMergeTargetThreadId.trim();
    if (targetThreadId.length === 0) {
      toast.error("Enter a target thread id first");
      return;
    }

    const selectedThreads = threadRows.filter((thread) =>
      selectedThreadIdSet.has(thread._id),
    );
    if (selectedThreads.length !== 1) {
      toast.error("Select exactly one source thread to merge");
      return;
    }

    const sourceThread = selectedThreads[0]!;
    if (sourceThread._id === targetThreadId) {
      toast.error("Choose a different target thread");
      return;
    }
    if (sourceThread.status !== "active" && sourceThread.status !== "locked") {
      toast.error("Only active or locked source threads can merge");
      return;
    }
    if (
      !window.confirm(`Merge "${sourceThread.title}" into ${targetThreadId}?`)
    ) {
      return;
    }

    setThreadBulkPending(true);
    try {
      const result = await mergeThread({
        sourceThreadId: sourceThread._id,
        targetThreadId,
        moderationReason: threadBulkReason.trim() || undefined,
      });
      setSelectedThreadIds((current) =>
        current.filter((id) => id !== sourceThread._id),
      );
      setThreadMergeTargetThreadId("");
      setThreadBulkReason("");
      toast.success(
        `Merged ${result.merged} post${
          result.merged === 1 ? "" : "s"
        } into "${result.targetThread.title}"`,
      );
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "thread_merge_failed",
        component: "AdminForum",
        action: "forum:mergeForumThread",
        entityType: "forumThread",
        entityId: sourceThread._id,
        metadata: {
          sourceThreadId: sourceThread._id,
          targetThreadId,
        },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not merge thread",
      );
    } finally {
      setThreadBulkPending(false);
    }
  }

  async function updateSelectedPosts(
    status: ForumPostStatus,
    label: string,
    options: {
      confirm?: (count: number) => string;
      eligible?: (post: ForumPostRecord) => boolean;
    } = {},
  ) {
    const selectedPosts = recentPosts.filter((post) =>
      selectedPostIdSet.has(post._id),
    );
    if (selectedPosts.length === 0) {
      toast.error("Select at least one reply first");
      return;
    }

    const targets = options.eligible
      ? selectedPosts.filter(options.eligible)
      : selectedPosts;
    const skipped = selectedPosts.length - targets.length;
    if (targets.length === 0) {
      toast.error("No selected replies are eligible for that action");
      return;
    }
    if (options.confirm && !window.confirm(options.confirm(targets.length))) {
      return;
    }

    const moderationReason = postBulkReason.trim() || undefined;
    const failed: Array<{ id: string; message: string }> = [];
    const succeededIds: string[] = [];

    setPostBulkPending(true);
    try {
      for (const post of targets) {
        try {
          await setPostState({
            postId: post._id,
            status,
            moderationReason,
          });
          clearPostReason(post._id);
          succeededIds.push(post._id);
        } catch (error) {
          failed.push({
            id: post._id,
            message:
              error instanceof Error ? error.message : "Unknown reply error",
          });
        }
      }

      const succeededIdSet = new Set(succeededIds);
      setSelectedPostIds((current) =>
        current.filter((id) => !succeededIdSet.has(id)),
      );

      if (failed.length === 0) {
        setPostBulkReason("");
        toast.success(
          `${label} ${succeededIds.length} repl${
            succeededIds.length === 1 ? "y" : "ies"
          }${skipped > 0 ? `, skipped ${skipped}` : ""}`,
        );
      } else {
        reportAppError(new Error("Bulk reply moderation failed"), {
          scope: "admin-forum",
          eventType: "post_bulk_update_failed",
          component: "AdminForum",
          action: "forum:updateForumPostModeration:bulk",
          metadata: {
            failed,
            skipped,
            status,
            succeeded: succeededIds.length,
          },
          notify: false,
        });
        toast.error(
          `${label}: ${succeededIds.length} updated, ${failed.length} failed${
            skipped > 0 ? `, ${skipped} skipped` : ""
          }`,
        );
      }
    } finally {
      setPostBulkPending(false);
    }
  }

  async function splitSelectedPostsIntoThread() {
    const targetCategoryId = postSplitTargetCategoryId.trim();
    const title = postSplitTitle.trim();
    if (targetCategoryId.length === 0) {
      toast.error("Choose a target board first");
      return;
    }
    if (title.length === 0) {
      toast.error("Enter a title for the new thread");
      return;
    }

    const selectedPosts = recentPosts.filter((post) =>
      selectedPostIdSet.has(post._id),
    );
    if (selectedPosts.length === 0) {
      toast.error("Select at least one reply first");
      return;
    }

    const targets = selectedPosts.filter((post) => post.status === "active");
    const skipped = selectedPosts.length - targets.length;
    if (targets.length === 0) {
      toast.error("No selected active replies can be split");
      return;
    }
    if (new Set(targets.map((post) => post.threadId)).size !== 1) {
      toast.error("Split replies from one source thread at a time");
      return;
    }
    if (
      !window.confirm(
        `Split ${targets.length} selected repl${
          targets.length === 1 ? "y" : "ies"
        } into "${title}"?`,
      )
    ) {
      return;
    }

    setPostBulkPending(true);
    try {
      const result = await splitPosts({
        postIds: targets.map((post) => post._id),
        targetCategoryId,
        title,
        moderationReason: postBulkReason.trim() || undefined,
      });
      const splitIdSet = new Set(result.postIds);
      setSelectedPostIds((current) =>
        current.filter((id) => !splitIdSet.has(id)),
      );
      setPostSplitTargetCategoryId("");
      setPostSplitTitle("");
      setPostBulkReason("");
      toast.success(
        `Split ${result.split} repl${
          result.split === 1 ? "y" : "ies"
        } into "${result.newThread.title}"${
          skipped > 0 ? `, skipped ${skipped}` : ""
        }`,
      );
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "post_bulk_split_failed",
        component: "AdminForum",
        action: "forum:splitForumPosts",
        metadata: {
          postIds: targets.map((post) => post._id),
          skipped,
          targetCategoryId,
          title,
        },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not split replies",
      );
    } finally {
      setPostBulkPending(false);
    }
  }

  async function moveSelectedPostsToThread() {
    const targetThreadId = postMoveTargetThreadId.trim();
    if (targetThreadId.length === 0) {
      toast.error("Enter a target thread id first");
      return;
    }

    const selectedPosts = recentPosts.filter((post) =>
      selectedPostIdSet.has(post._id),
    );
    if (selectedPosts.length === 0) {
      toast.error("Select at least one reply first");
      return;
    }

    const targets = selectedPosts.filter(
      (post) => post.status === "active" && post.threadId !== targetThreadId,
    );
    const skipped = selectedPosts.length - targets.length;
    if (targets.length === 0) {
      toast.error("No selected active replies can move to that thread");
      return;
    }
    if (
      !window.confirm(
        `Move ${targets.length} selected repl${
          targets.length === 1 ? "y" : "ies"
        } to ${targetThreadId}?`,
      )
    ) {
      return;
    }

    setPostBulkPending(true);
    try {
      const result = await movePosts({
        postIds: targets.map((post) => post._id),
        targetThreadId,
        moderationReason: postBulkReason.trim() || undefined,
      });
      const movedIdSet = new Set(result.postIds);
      setSelectedPostIds((current) =>
        current.filter((id) => !movedIdSet.has(id)),
      );
      setPostMoveTargetThreadId("");
      setPostBulkReason("");
      toast.success(
        `Moved ${result.moved} repl${result.moved === 1 ? "y" : "ies"}${
          skipped > 0 ? `, skipped ${skipped}` : ""
        }`,
      );
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "post_bulk_move_failed",
        component: "AdminForum",
        action: "forum:moveForumPosts",
        metadata: {
          postIds: targets.map((post) => post._id),
          skipped,
          targetThreadId,
        },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not move replies",
      );
    } finally {
      setPostBulkPending(false);
    }
  }

  function closeReportInspector() {
    setSelectedReportId(null);
    window.requestAnimationFrame(() => {
      reportInspectTriggerRef.current?.focus();
    });
  }

  function inspectReport(
    report: ForumReportRecord,
    trigger?: HTMLButtonElement | null,
  ) {
    reportInspectTriggerRef.current = trigger ?? null;
    setSelectedReportId(report._id);
    setReportNoteDrafts((current) => ({
      ...current,
      [report._id]: current[report._id] ?? report.moderationNote ?? "",
    }));
  }

  async function updateReport(
    report: ForumReportRecord,
    status: ForumReportStatus,
    moderationNote = reportNoteDrafts[report._id] ??
      report.moderationNote ??
      "",
  ) {
    try {
      const result = await updateReportStatus({
        reportId: report._id,
        status,
        moderationNote,
      });
      setReportNoteDrafts((current) => ({
        ...current,
        [report._id]: result.report.moderationNote ?? "",
      }));
      if (selectedReportId === null) {
        setSelectedReportId(report._id);
      }
      toast.success(`Report marked ${status}`);
      return true;
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "report_update_failed",
        component: "AdminForum",
        action: "forum:updateForumReportStatus",
        entityType: "forumReport",
        entityId: report._id,
        metadata: { status },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not update report",
      );
      return false;
    }
  }

  async function updatePoll(poll: ForumPollRecord, status: ForumPollStatus) {
    try {
      await updatePollStatus({ pollId: poll._id, status });
      toast.success(`Poll marked ${status}`);
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "poll_update_failed",
        component: "AdminForum",
        action: "forum:updateForumPollStatus",
        entityType: "forumPoll",
        entityId: poll._id,
        metadata: { status },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not update poll",
      );
    }
  }

  function threadReason(threadId: string) {
    return threadReasons[threadId]?.trim() ?? "";
  }

  function setThreadReason(threadId: string, value: string) {
    setThreadReasons((current) => ({ ...current, [threadId]: value }));
  }

  function clearThreadReason(threadId: string) {
    setThreadReasons((current) => {
      const next = { ...current };
      delete next[threadId];
      return next;
    });
  }

  function setThreadMoveTarget(threadId: string, value: string) {
    setThreadMoveTargets((current) => ({ ...current, [threadId]: value }));
  }

  function clearThreadMoveTarget(threadId: string) {
    setThreadMoveTargets((current) => {
      const next = { ...current };
      delete next[threadId];
      return next;
    });
  }

  function postReason(postId: string) {
    return postReasons[postId]?.trim() ?? "";
  }

  function setPostReason(postId: string, value: string) {
    setPostReasons((current) => ({ ...current, [postId]: value }));
  }

  function clearPostReason(postId: string) {
    setPostReasons((current) => {
      const next = { ...current };
      delete next[postId];
      return next;
    });
  }

  return (
    <section
      className={
        moderationOnly
          ? styles.moderation
          : "mt-10 border-y border-row-border py-6"
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase text-muted-foreground">
            {moderationOnly ? "Moderator CP" : "Forum"}
          </p>
          <h2 className="mt-1 text-2xl font-semibold">
            {moderationOnly ? "Moderation controls" : "Board management"}
          </h2>
        </div>
        {!moderationOnly ? (
          <div className="flex flex-wrap gap-2">
            <Button
              className="rounded-none"
              size="sm"
              type="button"
              variant="outline"
              onClick={() => {
                setCategoryForm(blankCategoryForm);
                setCategoryModeratorUsername("");
                focusCategoryName();
              }}
            >
              <Plus />
              New category
            </Button>
            <Button
              className="rounded-none"
              size="sm"
              type="button"
              variant="outline"
              onClick={seedCategories}
            >
              <RefreshCw />
              Seed defaults
            </Button>
          </div>
        ) : null}
      </div>

      {moderationOnly ? (
        <nav
          aria-label="Moderation queues"
          className="mt-4 flex flex-wrap gap-2"
        >
          {[
            ["threads", "Threads"],
            ["replies", "Replies"],
            ["reports", "Reports"],
            ["history", "History"],
          ].map(([id, label]) => (
            <a
              key={id}
              className="focus-ring inline-flex min-h-11 items-center rounded-sm bg-muted px-3 text-sm font-medium hover:bg-primary/10 hover:text-primary"
              href={`#moderation-${id}`}
            >
              {label}
            </a>
          ))}
        </nav>
      ) : null}

      <div className="mt-5 grid gap-3 font-mono text-[10px] uppercase text-muted-foreground md:grid-cols-5">
        <Metric
          label="Categories"
          value={overview?.totals?.categories ?? categoryRows.length}
        />
        <Metric
          label="Threads"
          value={overview?.totals?.threads ?? threadRows.length}
        />
        <Metric label="Posts" value={postMetricCount} />
        <Metric
          label="Pending"
          value={`${overview?.totals?.pendingThreads ?? 0}T / ${
            overview?.totals?.pendingPosts ?? 0
          }P`}
        />
        <Metric
          label="Hidden"
          value={`${overview?.totals?.hiddenThreads ?? 0}T / ${
            overview?.totals?.hiddenPosts ?? 0
          }P`}
        />
      </div>

      {!moderationOnly ? (
        <>
          <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.2fr)]">
            <section className="border-y border-row-border py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-xs uppercase text-muted-foreground">
                    Help / FAQ
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Maintain native help desk topics for the public forum.
                  </p>
                </div>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  {sortedHelpDocuments.length} total
                </p>
              </div>
              <div className="mt-4 divide-y divide-row-border">
                {sortedHelpDocuments.map((document) => {
                  const selected =
                    helpDocumentForm.helpDocumentId === document._id;
                  return (
                    <div
                      className={cn(
                        "grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]",
                        selected ? "bg-muted/35" : null,
                      )}
                      key={document._id}
                    >
                      <button
                        aria-pressed={selected}
                        className="min-w-0 text-left"
                        onClick={() => loadHelpDocumentForm(document)}
                        type="button"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{document.title}</p>
                          <StatusBadge status={document.status} />
                        </div>
                        <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
                          {document.slug} • pos {document.position} • updated{" "}
                          {formatShortDate(document.updatedAt)}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                          {document.body}
                        </p>
                      </button>
                      <Button
                        className="rounded-none px-2 font-mono text-[10px] uppercase"
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() =>
                          updateHelpDocumentState(
                            document,
                            document.status === "archived"
                              ? "active"
                              : "archived",
                          )
                        }
                      >
                        {document.status === "archived" ? "Restore" : "Archive"}
                      </Button>
                    </div>
                  );
                })}
                {helpDocuments === undefined ? (
                  <StatusLine>Loading help documents</StatusLine>
                ) : null}
                {helpDocuments !== undefined &&
                sortedHelpDocuments.length === 0 ? (
                  <StatusLine>No help documents yet</StatusLine>
                ) : null}
              </div>
            </section>

            <section className="border-y border-row-border py-4">
              <form className="grid gap-4" onSubmit={saveHelpDocument}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs uppercase text-muted-foreground">
                      Help editor
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      FAQ copy renders as a native forum help document.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="rounded-none font-mono text-[10px] uppercase"
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={() => setHelpDocumentForm(blankHelpDocumentForm)}
                    >
                      <Plus />
                      New
                    </Button>
                    <Button className="rounded-none" size="sm" type="submit">
                      <Save />
                      Save
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Title">
                    <Input
                      className="rounded-none"
                      maxLength={120}
                      required
                      value={helpDocumentForm.title}
                      onChange={(event) =>
                        setHelpDocumentForm((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Slug">
                    <Input
                      className="rounded-none"
                      placeholder="posting-guide"
                      required
                      value={helpDocumentForm.slug}
                      onChange={(event) =>
                        setHelpDocumentForm((current) => ({
                          ...current,
                          slug: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Status">
                    <NativeSelect
                      className="rounded-none"
                      value={helpDocumentForm.status}
                      onChange={(event) =>
                        setHelpDocumentForm((current) => ({
                          ...current,
                          status: event.target.value as ForumPageStatus,
                        }))
                      }
                    >
                      <option value="active">Active</option>
                      <option value="archived">Archived</option>
                    </NativeSelect>
                  </Field>
                  <Field label="Position">
                    <Input
                      className="rounded-none"
                      min={0}
                      step={1}
                      type="number"
                      value={helpDocumentForm.position}
                      onChange={(event) =>
                        setHelpDocumentForm((current) => ({
                          ...current,
                          position: Number(event.target.value),
                        }))
                      }
                    />
                  </Field>
                </div>

                <Field label="Body">
                  <Textarea
                    className="rounded-none"
                    rows={6}
                    required
                    value={helpDocumentForm.body}
                    onChange={(event) =>
                      setHelpDocumentForm((current) => ({
                        ...current,
                        body: event.target.value,
                      }))
                    }
                  />
                </Field>
              </form>
            </section>
          </div>

          <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.2fr)]">
            <section className="border-y border-row-border py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-xs uppercase text-muted-foreground">
                    Calendar
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Maintain public forum events for the old board calendar.
                  </p>
                </div>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  {sortedCalendarEvents.length} total
                </p>
              </div>
              <div className="mt-4 divide-y divide-row-border">
                {sortedCalendarEvents.map((event) => {
                  const selected = calendarEventForm.eventId === event._id;
                  return (
                    <div
                      className={cn(
                        "grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]",
                        selected ? "bg-muted/35" : null,
                      )}
                      key={event._id}
                    >
                      <button
                        aria-pressed={selected}
                        className="min-w-0 text-left"
                        onClick={() => loadCalendarEventForm(event)}
                        type="button"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{event.title}</p>
                          <StatusBadge status={event.status} />
                          {event.allDay ? (
                            <StatusBadge status="all-day" />
                          ) : null}
                        </div>
                        <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
                          {event.slug} •{" "}
                          {formatCalendarAdminDateTime(event.startsAt)} •{" "}
                          {event.month}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                          {event.body}
                        </p>
                      </button>
                      <Button
                        className="rounded-none px-2 font-mono text-[10px] uppercase"
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() =>
                          updateCalendarEventState(
                            event,
                            event.status === "archived" ? "active" : "archived",
                          )
                        }
                      >
                        {event.status === "archived" ? "Restore" : "Archive"}
                      </Button>
                    </div>
                  );
                })}
                {calendarEvents === undefined ? (
                  <StatusLine>Loading calendar events</StatusLine>
                ) : null}
                {calendarEvents !== undefined &&
                sortedCalendarEvents.length === 0 ? (
                  <StatusLine>No calendar events yet</StatusLine>
                ) : null}
              </div>
            </section>

            <section className="border-y border-row-border py-4">
              <form className="grid gap-4" onSubmit={saveCalendarEvent}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs uppercase text-muted-foreground">
                      Event editor
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Event copy renders on the public forum calendar.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="rounded-none font-mono text-[10px] uppercase"
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setCalendarEventForm(blankCalendarEventForm)
                      }
                    >
                      <Plus />
                      New
                    </Button>
                    <Button className="rounded-none" size="sm" type="submit">
                      <Save />
                      Save
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Title">
                    <Input
                      className="rounded-none"
                      maxLength={120}
                      required
                      value={calendarEventForm.title}
                      onChange={(event) =>
                        setCalendarEventForm((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Slug">
                    <Input
                      className="rounded-none"
                      placeholder="forum-meetup"
                      required
                      value={calendarEventForm.slug}
                      onChange={(event) =>
                        setCalendarEventForm((current) => ({
                          ...current,
                          slug: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Status">
                    <NativeSelect
                      className="rounded-none"
                      value={calendarEventForm.status}
                      onChange={(event) =>
                        setCalendarEventForm((current) => ({
                          ...current,
                          status: event.target
                            .value as ForumCalendarEventStatus,
                        }))
                      }
                    >
                      <option value="active">Active</option>
                      <option value="archived">Archived</option>
                    </NativeSelect>
                  </Field>
                  <Field label="All day">
                    <label className="flex h-10 items-center gap-2 border border-row-border px-3 font-mono text-[10px] uppercase text-muted-foreground">
                      <input
                        checked={calendarEventForm.allDay}
                        type="checkbox"
                        onChange={(event) =>
                          setCalendarEventForm((current) => ({
                            ...current,
                            allDay: event.target.checked,
                          }))
                        }
                      />
                      All day event
                    </label>
                  </Field>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Starts">
                    <Input
                      className="rounded-none"
                      required
                      type="datetime-local"
                      value={calendarEventForm.startsAt}
                      onChange={(event) =>
                        setCalendarEventForm((current) => ({
                          ...current,
                          startsAt: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Ends">
                    <Input
                      className="rounded-none"
                      type="datetime-local"
                      value={calendarEventForm.endsAt}
                      onChange={(event) =>
                        setCalendarEventForm((current) => ({
                          ...current,
                          endsAt: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>

                <Field label="Body">
                  <Textarea
                    className="rounded-none"
                    rows={6}
                    required
                    value={calendarEventForm.body}
                    onChange={(event) =>
                      setCalendarEventForm((current) => ({
                        ...current,
                        body: event.target.value,
                      }))
                    }
                  />
                </Field>
              </form>
            </section>
          </div>

          <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.2fr)]">
            <section className="border-y border-row-border py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-xs uppercase text-muted-foreground">
                    Categories
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Create, archive, and reorder board groups.
                  </p>
                </div>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  {sortedCategories.length} total
                </p>
              </div>
              <div className="mt-4 divide-y divide-row-border">
                {sortedCategories.map((category, index) => {
                  const kind = category.kind ?? "board";
                  const pathLabel = forumCategoryPathLabel(
                    category,
                    categoriesById,
                  );

                  return (
                    <div
                      key={category._id}
                      className={cn(
                        "grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]",
                        selectedSlug === category.slug ? "bg-muted/35" : null,
                        kind === "section"
                          ? "border-l-2 border-primary pl-3"
                          : null,
                        category.parentCategoryId ? "pl-5" : null,
                      )}
                    >
                      <button
                        aria-pressed={selectedSlug === category.slug}
                        className="min-w-0 text-left"
                        onClick={() => loadCategoryForm(category)}
                        type="button"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="line-clamp-2 text-base font-semibold">
                            {category.name}
                          </p>
                          <StatusBadge status={kind} />
                          <StatusBadge status={category.status} />
                          <StatusBadge status={`view:${category.viewAccess}`} />
                          {kind === "board" ? (
                            <StatusBadge
                              status={`post:${category.threadAccess}`}
                            />
                          ) : null}
                          {kind === "board" &&
                          category.moderators.length > 0 ? (
                            <StatusBadge
                              status={`mods:${category.moderators.length}`}
                            />
                          ) : null}
                        </div>
                        <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
                          {pathLabel} • pos {category.position}
                          {kind === "board"
                            ? ` • replies ${category.replyAccess} • polls ${category.pollAccess}`
                            : " • header only"}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                          {category.description?.trim() || "No description"}
                        </p>
                      </button>
                      <div className="flex items-start justify-end gap-1">
                        <IconButton
                          ariaLabel={`Move ${category.name} up`}
                          disabled={index === 0}
                          icon={ArrowUp}
                          onClick={() => moveCategory(category, -1)}
                        />
                        <IconButton
                          ariaLabel={`Move ${category.name} down`}
                          disabled={index === sortedCategories.length - 1}
                          icon={ArrowDown}
                          onClick={() => moveCategory(category, 1)}
                        />
                        <Button
                          className="rounded-none px-2 font-mono text-[10px] uppercase"
                          size="sm"
                          type="button"
                          variant="outline"
                          onClick={() =>
                            updateCategoryState(
                              category,
                              category.status === "archived"
                                ? "active"
                                : "archived",
                            )
                          }
                        >
                          {category.status === "archived"
                            ? "Restore"
                            : "Archive"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {categories === undefined && overview === undefined ? (
                  <StatusLine>Loading categories</StatusLine>
                ) : null}
                {categories !== undefined && sortedCategories.length === 0 ? (
                  <StatusLine>No categories yet</StatusLine>
                ) : null}
              </div>
            </section>

            <section className="border-y border-row-border py-4">
              <form className="grid gap-4" onSubmit={saveCategory}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs uppercase text-muted-foreground">
                      Category editor
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Edit the selected board or create a new one.
                    </p>
                  </div>
                  <Button className="rounded-none" size="sm" type="submit">
                    <Save />
                    Save
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Name">
                    <Input
                      ref={categoryNameRef}
                      className="rounded-none"
                      required
                      value={categoryForm.name}
                      onChange={(event) =>
                        setCategoryForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Slug">
                    <Input
                      className="rounded-none"
                      placeholder="auto-from-name"
                      value={categoryForm.slug}
                      onChange={(event) =>
                        setCategoryForm((current) => ({
                          ...current,
                          slug: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>

                <Field label="Description">
                  <Textarea
                    className="rounded-none"
                    rows={4}
                    value={categoryForm.description}
                    onChange={(event) =>
                      setCategoryForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                  />
                </Field>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Type">
                    <NativeSelect
                      className="rounded-none"
                      value={categoryForm.kind}
                      onChange={(event) =>
                        setCategoryForm((current) => {
                          const kind = event.target.value as ForumCategoryKind;
                          return {
                            ...current,
                            kind,
                            parentCategoryId:
                              kind === "section"
                                ? undefined
                                : current.parentCategoryId,
                          };
                        })
                      }
                    >
                      <option value="board">Board</option>
                      <option value="section">Section header</option>
                    </NativeSelect>
                  </Field>
                  <Field label="Parent">
                    <NativeSelect
                      className="rounded-none"
                      disabled={categoryForm.kind === "section"}
                      value={categoryForm.parentCategoryId ?? "none"}
                      onChange={(event) =>
                        setCategoryForm((current) => ({
                          ...current,
                          parentCategoryId:
                            event.target.value === "none"
                              ? undefined
                              : event.target.value,
                        }))
                      }
                    >
                      <option value="none">Top level</option>
                      {parentCategoryOptions.map((category) => (
                        <option key={category._id} value={category._id}>
                          {forumCategoryPathLabel(category, categoriesById)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Status">
                    <NativeSelect
                      className="rounded-none"
                      value={categoryForm.status}
                      onChange={(event) =>
                        setCategoryForm((current) => ({
                          ...current,
                          status: event.target.value as ForumCategoryStatus,
                        }))
                      }
                    >
                      <option value="active">Active</option>
                      <option value="archived">Archived</option>
                      {categoryForm.status !== "active" &&
                      categoryForm.status !== "archived" ? (
                        <option value={categoryForm.status}>
                          {categoryForm.status}
                        </option>
                      ) : null}
                    </NativeSelect>
                  </Field>
                  <Field label="Position">
                    <Input
                      className="rounded-none"
                      min={0}
                      step={1}
                      type="number"
                      value={categoryForm.position}
                      onChange={(event) =>
                        setCategoryForm((current) => ({
                          ...current,
                          position: Number(event.target.value),
                        }))
                      }
                    />
                  </Field>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="View access">
                    <NativeSelect
                      className="rounded-none"
                      value={categoryForm.viewAccess}
                      onChange={(event) =>
                        setCategoryForm((current) => ({
                          ...current,
                          viewAccess: event.target
                            .value as ForumCategoryViewAccess,
                        }))
                      }
                    >
                      <option value="public">Public</option>
                      <option value="members">Members only</option>
                      <option value="trusted">Trusted members</option>
                      <option value="staff">Staff only</option>
                    </NativeSelect>
                  </Field>
                  <Field label="Start threads">
                    <NativeSelect
                      className="rounded-none"
                      value={categoryForm.threadAccess}
                      onChange={(event) =>
                        setCategoryForm((current) => ({
                          ...current,
                          threadAccess: event.target
                            .value as ForumCategoryWriteAccess,
                        }))
                      }
                    >
                      <option value="members">Members</option>
                      <option value="trusted">Trusted members</option>
                      <option value="staff">Staff only</option>
                      <option value="closed">Closed</option>
                    </NativeSelect>
                  </Field>
                  <Field label="Replies">
                    <NativeSelect
                      className="rounded-none"
                      value={categoryForm.replyAccess}
                      onChange={(event) =>
                        setCategoryForm((current) => ({
                          ...current,
                          replyAccess: event.target
                            .value as ForumCategoryWriteAccess,
                        }))
                      }
                    >
                      <option value="members">Members</option>
                      <option value="trusted">Trusted members</option>
                      <option value="staff">Staff only</option>
                      <option value="closed">Closed</option>
                    </NativeSelect>
                  </Field>
                  <Field label="Poll votes">
                    <NativeSelect
                      className="rounded-none"
                      value={categoryForm.pollAccess}
                      onChange={(event) =>
                        setCategoryForm((current) => ({
                          ...current,
                          pollAccess: event.target
                            .value as ForumCategoryWriteAccess,
                        }))
                      }
                    >
                      <option value="members">Members</option>
                      <option value="trusted">Trusted members</option>
                      <option value="staff">Staff only</option>
                      <option value="closed">Closed</option>
                    </NativeSelect>
                  </Field>
                </div>
              </form>
              <div className="mt-5 border-t border-row-border pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs uppercase text-muted-foreground">
                      Board moderators
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Assign existing forum members to moderate this board.
                    </p>
                  </div>
                  {existingCategory?.kind === "board" ? (
                    <StatusBadge
                      status={`assigned:${existingCategory.moderators.length}`}
                    />
                  ) : null}
                </div>
                {existingCategory?.kind === "board" ? (
                  <>
                    <form
                      className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]"
                      onSubmit={assignModeratorToCategory}
                    >
                      <Input
                        className="rounded-none"
                        placeholder="forum username"
                        value={categoryModeratorUsername}
                        onChange={(event) =>
                          setCategoryModeratorUsername(event.target.value)
                        }
                      />
                      <Button className="rounded-none" size="sm" type="submit">
                        <Plus />
                        Assign
                      </Button>
                    </form>
                    <div className="mt-4 divide-y divide-row-border">
                      {existingCategory.moderators.map((moderator) => (
                        <div
                          className="flex flex-wrap items-center justify-between gap-3 py-2"
                          key={moderator._id}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-semibold">
                              {moderator.displayName}
                            </p>
                            <p className="font-mono text-[10px] uppercase text-muted-foreground">
                              {moderator.username ?? moderator.userId} •
                              assigned {formatShortDate(moderator.assignedAt)}
                            </p>
                          </div>
                          <Button
                            className="rounded-none px-2 font-mono text-[10px] uppercase"
                            size="sm"
                            type="button"
                            variant="outline"
                            onClick={() =>
                              removeModeratorFromCategory(moderator)
                            }
                          >
                            <Trash2 />
                            Remove
                          </Button>
                        </div>
                      ))}
                      {existingCategory.moderators.length === 0 ? (
                        <StatusLine>No board moderators assigned</StatusLine>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <StatusLine>
                    Save a board before assigning moderators
                  </StatusLine>
                )}
              </div>
            </section>
          </div>

          <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.2fr)]">
            <section className="border-y border-row-border py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-xs uppercase text-muted-foreground">
                    Thread prefixes
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Manage bracket labels used before thread titles.
                  </p>
                </div>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  {sortedPrefixes.length} total
                </p>
              </div>
              <div className="mt-4 divide-y divide-row-border">
                {sortedPrefixes.map((prefix) => {
                  const selected = prefixForm.prefixId === prefix._id;
                  return (
                    <div
                      key={prefix._id}
                      className={cn(
                        "grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]",
                        selected ? "bg-muted/35" : null,
                      )}
                    >
                      <button
                        aria-pressed={selected}
                        className="min-w-0 text-left"
                        onClick={() => loadPrefixForm(prefix)}
                        type="button"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <PrefixLabel prefix={prefix} />
                          <StatusBadge status={prefix.status} />
                          <StatusBadge
                            status={prefix.categoryName ? "board" : "global"}
                          />
                        </div>
                        <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
                          {prefix.categoryName ?? "All boards"} • {prefix.slug}{" "}
                          • pos {prefix.position}
                        </p>
                        {prefix.description ? (
                          <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                            {prefix.description}
                          </p>
                        ) : null}
                      </button>
                      <Button
                        className="rounded-none px-2 font-mono text-[10px] uppercase"
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() =>
                          updatePrefixState(
                            prefix,
                            prefix.status === "archived"
                              ? "active"
                              : "archived",
                          )
                        }
                      >
                        {prefix.status === "archived" ? "Restore" : "Archive"}
                      </Button>
                    </div>
                  );
                })}
                {prefixes === undefined ? (
                  <StatusLine>Loading prefixes</StatusLine>
                ) : null}
                {prefixes !== undefined && sortedPrefixes.length === 0 ? (
                  <StatusLine>No prefixes yet</StatusLine>
                ) : null}
              </div>
            </section>

            <section className="border-y border-row-border py-4">
              <form className="grid gap-4" onSubmit={savePrefix}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs uppercase text-muted-foreground">
                      Prefix editor
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Create global labels or scope labels to one board.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="rounded-none font-mono text-[10px] uppercase"
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={() => setPrefixForm(blankPrefixForm)}
                    >
                      <Plus />
                      New
                    </Button>
                    <Button className="rounded-none" size="sm" type="submit">
                      <Save />
                      Save
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Label">
                    <Input
                      className="rounded-none"
                      maxLength={24}
                      required
                      value={prefixForm.label}
                      onChange={(event) =>
                        setPrefixForm((current) => ({
                          ...current,
                          label: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Slug">
                    <Input
                      className="rounded-none"
                      placeholder="release"
                      required
                      value={prefixForm.slug}
                      onChange={(event) =>
                        setPrefixForm((current) => ({
                          ...current,
                          slug: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Scope">
                    <NativeSelect
                      className="rounded-none"
                      value={prefixForm.categoryId ?? "global"}
                      onChange={(event) =>
                        setPrefixForm((current) => ({
                          ...current,
                          categoryId:
                            event.target.value === "global"
                              ? undefined
                              : event.target.value,
                        }))
                      }
                    >
                      <option value="global">All boards</option>
                      {boardCategories.map((category) => (
                        <option key={category._id} value={category._id}>
                          {forumCategoryPathLabel(category, categoriesById)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Status">
                    <NativeSelect
                      className="rounded-none"
                      value={prefixForm.status}
                      onChange={(event) =>
                        setPrefixForm((current) => ({
                          ...current,
                          status: event.target.value as ForumThreadPrefixStatus,
                        }))
                      }
                    >
                      <option value="active">Active</option>
                      <option value="archived">Archived</option>
                    </NativeSelect>
                  </Field>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Color">
                    <Input
                      className="rounded-none font-mono"
                      pattern="#[0-9a-fA-F]{6}"
                      placeholder="#ff3ea5"
                      value={prefixForm.color}
                      onChange={(event) =>
                        setPrefixForm((current) => ({
                          ...current,
                          color: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Position">
                    <Input
                      className="rounded-none"
                      min={0}
                      step={1}
                      type="number"
                      value={prefixForm.position}
                      onChange={(event) =>
                        setPrefixForm((current) => ({
                          ...current,
                          position: Number(event.target.value),
                        }))
                      }
                    />
                  </Field>
                </div>

                <Field label="Description">
                  <Textarea
                    className="rounded-none"
                    rows={3}
                    value={prefixForm.description}
                    onChange={(event) =>
                      setPrefixForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                  />
                </Field>
              </form>
            </section>
          </div>

          <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.2fr)]">
            <section className="border-y border-row-border py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-xs uppercase text-muted-foreground">
                    Announcements
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Publish global bulletins or board-scoped notices.
                  </p>
                </div>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  {sortedAnnouncements.length} total
                </p>
              </div>
              <div className="mt-4 divide-y divide-row-border">
                {sortedAnnouncements.map((announcement) => {
                  const selected =
                    announcementForm.announcementId === announcement._id;
                  return (
                    <div
                      className={cn(
                        "grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]",
                        selected ? "bg-muted/35" : null,
                      )}
                      key={announcement._id}
                    >
                      <button
                        aria-pressed={selected}
                        className="min-w-0 text-left"
                        onClick={() => loadAnnouncementForm(announcement)}
                        type="button"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{announcement.title}</p>
                          <StatusBadge status={announcement.status} />
                          <StatusBadge
                            status={
                              announcement.categoryName ? "board" : "global"
                            }
                          />
                        </div>
                        <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
                          {announcement.categoryName ?? "All boards"} •{" "}
                          {announcement.slug} • pos {announcement.position}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                          {announcement.body}
                        </p>
                      </button>
                      <Button
                        className="rounded-none px-2 font-mono text-[10px] uppercase"
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() =>
                          updateAnnouncementState(
                            announcement,
                            announcement.status === "archived"
                              ? "active"
                              : "archived",
                          )
                        }
                      >
                        {announcement.status === "archived"
                          ? "Restore"
                          : "Archive"}
                      </Button>
                    </div>
                  );
                })}
                {announcements === undefined ? (
                  <StatusLine>Loading announcements</StatusLine>
                ) : null}
                {announcements !== undefined &&
                sortedAnnouncements.length === 0 ? (
                  <StatusLine>No announcements yet</StatusLine>
                ) : null}
              </div>
            </section>

            <section className="border-y border-row-border py-4">
              <form className="grid gap-4" onSubmit={saveAnnouncement}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs uppercase text-muted-foreground">
                      Announcement editor
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      BBCode-style copy renders in the public forum bulletin
                      area.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="rounded-none font-mono text-[10px] uppercase"
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={() => setAnnouncementForm(blankAnnouncementForm)}
                    >
                      <Plus />
                      New
                    </Button>
                    <Button className="rounded-none" size="sm" type="submit">
                      <Save />
                      Save
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Title">
                    <Input
                      className="rounded-none"
                      maxLength={120}
                      required
                      value={announcementForm.title}
                      onChange={(event) =>
                        setAnnouncementForm((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Slug">
                    <Input
                      className="rounded-none"
                      placeholder="site-news"
                      required
                      value={announcementForm.slug}
                      onChange={(event) =>
                        setAnnouncementForm((current) => ({
                          ...current,
                          slug: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="Scope">
                    <NativeSelect
                      className="rounded-none"
                      value={announcementForm.categoryId ?? "global"}
                      onChange={(event) =>
                        setAnnouncementForm((current) => ({
                          ...current,
                          categoryId:
                            event.target.value === "global"
                              ? undefined
                              : event.target.value,
                        }))
                      }
                    >
                      <option value="global">All boards</option>
                      {boardCategories.map((category) => (
                        <option key={category._id} value={category._id}>
                          {forumCategoryPathLabel(category, categoriesById)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Status">
                    <NativeSelect
                      className="rounded-none"
                      value={announcementForm.status}
                      onChange={(event) =>
                        setAnnouncementForm((current) => ({
                          ...current,
                          status: event.target.value as ForumPageStatus,
                        }))
                      }
                    >
                      <option value="active">Active</option>
                      <option value="archived">Archived</option>
                    </NativeSelect>
                  </Field>
                  <Field label="Position">
                    <Input
                      className="rounded-none"
                      min={0}
                      step={1}
                      type="number"
                      value={announcementForm.position}
                      onChange={(event) =>
                        setAnnouncementForm((current) => ({
                          ...current,
                          position: Number(event.target.value),
                        }))
                      }
                    />
                  </Field>
                </div>

                <Field label="Body">
                  <Textarea
                    className="rounded-none"
                    rows={6}
                    required
                    value={announcementForm.body}
                    onChange={(event) =>
                      setAnnouncementForm((current) => ({
                        ...current,
                        body: event.target.value,
                      }))
                    }
                  />
                </Field>
              </form>
            </section>
          </div>

          <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.2fr)]">
            <section className="border-y border-row-border py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-xs uppercase text-muted-foreground">
                    Board rules
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Manage one active rules panel per board.
                  </p>
                </div>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  {sortedBoardRules.length} total
                </p>
              </div>
              <div className="mt-4 divide-y divide-row-border">
                {sortedBoardRules.map((rules) => {
                  const selected = rulesForm.rulesId === rules._id;
                  return (
                    <div
                      className={cn(
                        "grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]",
                        selected ? "bg-muted/35" : null,
                      )}
                      key={rules._id}
                    >
                      <button
                        aria-pressed={selected}
                        className="min-w-0 text-left"
                        onClick={() => loadRulesForm(rules)}
                        type="button"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{rules.title}</p>
                          <StatusBadge status={rules.status} />
                        </div>
                        <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
                          {rules.categoryName ??
                            rules.categorySlug ??
                            "Unknown board"}{" "}
                          • updated {formatShortDate(rules.updatedAt)}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                          {rules.body}
                        </p>
                      </button>
                      <Button
                        className="rounded-none px-2 font-mono text-[10px] uppercase"
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() =>
                          updateRulesState(
                            rules,
                            rules.status === "archived" ? "active" : "archived",
                          )
                        }
                      >
                        {rules.status === "archived" ? "Restore" : "Archive"}
                      </Button>
                    </div>
                  );
                })}
                {boardRules === undefined ? (
                  <StatusLine>Loading board rules</StatusLine>
                ) : null}
                {boardRules !== undefined && sortedBoardRules.length === 0 ? (
                  <StatusLine>No board rules yet</StatusLine>
                ) : null}
              </div>
            </section>

            <section className="border-y border-row-border py-4">
              <form className="grid gap-4" onSubmit={saveRules}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs uppercase text-muted-foreground">
                      Rules editor
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Rules appear on the board index and inside threads.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="rounded-none font-mono text-[10px] uppercase"
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={() => setRulesForm(blankRulesForm)}
                    >
                      <Plus />
                      New
                    </Button>
                    <Button className="rounded-none" size="sm" type="submit">
                      <Save />
                      Save
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Board">
                    <NativeSelect
                      className="rounded-none"
                      required
                      value={rulesForm.categoryId ?? ""}
                      onChange={(event) =>
                        setRulesForm((current) => ({
                          ...current,
                          categoryId: event.target.value || undefined,
                        }))
                      }
                    >
                      <option value="">Choose board</option>
                      {boardCategories.map((category) => (
                        <option key={category._id} value={category._id}>
                          {forumCategoryPathLabel(category, categoriesById)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Status">
                    <NativeSelect
                      className="rounded-none"
                      value={rulesForm.status}
                      onChange={(event) =>
                        setRulesForm((current) => ({
                          ...current,
                          status: event.target.value as ForumPageStatus,
                        }))
                      }
                    >
                      <option value="active">Active</option>
                      <option value="archived">Archived</option>
                    </NativeSelect>
                  </Field>
                </div>

                <Field label="Title">
                  <Input
                    className="rounded-none"
                    maxLength={120}
                    required
                    value={rulesForm.title}
                    onChange={(event) =>
                      setRulesForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                  />
                </Field>

                <Field label="Rules">
                  <Textarea
                    className="rounded-none"
                    rows={7}
                    required
                    value={rulesForm.body}
                    onChange={(event) =>
                      setRulesForm((current) => ({
                        ...current,
                        body: event.target.value,
                      }))
                    }
                  />
                </Field>
              </form>
            </section>
          </div>
        </>
      ) : null}

      <section
        id={moderationOnly ? "moderation-threads" : undefined}
        className="mt-8 border-y border-row-border py-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase text-muted-foreground">
              Thread queue
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Approve, pin, lock, hide, or delete threads from the moderation
              queue.
            </p>
          </div>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            {threads === undefined ? "Loading" : `${threadRows.length} in view`}
          </p>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
          <Field label="Exact board">
            <NativeSelect
              className="rounded-none"
              value={threadCategoryFilter}
              onChange={(event) => setThreadCategoryFilter(event.target.value)}
            >
              <option value="all">All boards</option>
              {boardCategories.map((category) => (
                <option key={category._id} value={category._id}>
                  {forumCategoryPathLabel(category, categoriesById)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Status">
            <NativeSelect
              className="rounded-none"
              value={threadStatusFilter}
              onChange={(event) => setThreadStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              {threadStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
              {threadStatusOptions.length === 0 ? (
                <>
                  <option value="pending">pending</option>
                  <option value="active">active</option>
                  <option value="locked">locked</option>
                  <option value="hidden">hidden</option>
                  <option value="deleted">deleted</option>
                </>
              ) : null}
            </NativeSelect>
          </Field>
        </div>

        <div className="mt-4 grid gap-3 border border-row-border bg-muted/20 p-3 md:grid-cols-[auto_minmax(0,1fr)] xl:grid-cols-[auto_minmax(0,1fr)_minmax(13rem,0.7fr)_auto] xl:items-end">
          <label className="flex items-center gap-2 font-mono text-[10px] uppercase text-muted-foreground">
            <input
              aria-label="Select all visible threads"
              checked={allVisibleThreadsSelected}
              className="size-4 accent-primary"
              disabled={threadRows.length === 0 || threadBulkPending}
              type="checkbox"
              onChange={(event) =>
                setAllVisibleThreadsSelected(event.target.checked)
              }
            />
            {selectedThreadIds.length} selected
          </label>
          <Field label="Bulk reason">
            <Input
              className="rounded-none"
              disabled={threadBulkPending}
              maxLength={180}
              placeholder="Optional reason applied to selected threads"
              value={threadBulkReason}
              onChange={(event) => setThreadBulkReason(event.target.value)}
            />
          </Field>
          <Field label="Merge target thread ID">
            <Input
              className="rounded-none"
              disabled={threadBulkPending}
              placeholder="forumThreads id"
              value={threadMergeTargetThreadId}
              onChange={(event) =>
                setThreadMergeTargetThreadId(event.target.value)
              }
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <ActionButton
              disabled={threadBulkPending || selectedThreadIds.length === 0}
              label="Approve/restore"
              onClick={() =>
                updateSelectedThreads({ status: "active" }, "Restored")
              }
            />
            <ActionButton
              disabled={threadBulkPending || selectedThreadIds.length === 0}
              label="Hide"
              onClick={() =>
                updateSelectedThreads({ status: "hidden" }, "Hidden", {
                  eligible: (thread) =>
                    thread.status !== "deleted" && thread.status !== "pending",
                })
              }
            />
            <ActionButton
              disabled={threadBulkPending || selectedThreadIds.length === 0}
              icon={Lock}
              label="Lock"
              onClick={() =>
                updateSelectedThreads({ status: "locked" }, "Locked", {
                  eligible: (thread) =>
                    thread.status !== "deleted" && thread.status !== "pending",
                })
              }
            />
            <ActionButton
              disabled={threadBulkPending || selectedThreadIds.length === 0}
              icon={Pin}
              label="Pin"
              onClick={() =>
                updateSelectedThreads({ pinned: true }, "Pinned", {
                  eligible: (thread) =>
                    thread.status !== "deleted" && thread.status !== "pending",
                })
              }
            />
            <ActionButton
              disabled={threadBulkPending || selectedThreadIds.length === 0}
              label="Unpin"
              onClick={() =>
                updateSelectedThreads({ pinned: false }, "Unpinned", {
                  eligible: (thread) =>
                    thread.status !== "deleted" && thread.status !== "pending",
                })
              }
            />
            <ActionButton
              disabled={threadBulkPending || selectedThreadIds.length === 0}
              icon={Trash2}
              label="Delete"
              onClick={() =>
                updateSelectedThreads({ status: "deleted" }, "Deleted", {
                  confirm: (count) =>
                    `Delete ${count} selected thread${count === 1 ? "" : "s"}?`,
                  eligible: (thread) => thread.status !== "deleted",
                })
              }
            />
            <ActionButton
              disabled={
                threadBulkPending ||
                selectedThreadIds.length !== 1 ||
                threadMergeTargetThreadId.trim().length === 0
              }
              icon={MoveRight}
              label="Merge"
              onClick={mergeSelectedThreadIntoTarget}
            />
          </div>
        </div>

        <div className="mt-4 divide-y divide-row-border">
          {threadRows.map((thread) => (
            <ThreadRow
              key={thread._id}
              categoriesById={categoriesById}
              moveCategories={moveBoardCategories}
              moveTargetCategoryId={threadMoveTargets[thread._id] ?? ""}
              reason={threadReasons[thread._id] ?? ""}
              selected={selectedThreadIdSet.has(thread._id)}
              thread={thread}
              onDelete={() => removeThread(thread)}
              onMove={() => moveThreadToCategory(thread)}
              onMoveTargetChange={(value) =>
                setThreadMoveTarget(thread._id, value)
              }
              onReasonChange={(value) => setThreadReason(thread._id, value)}
              onRestore={() => updateThread(thread, { status: "active" })}
              onSelectedChange={(selected) =>
                setThreadSelected(thread._id, selected)
              }
              onToggleHidden={() =>
                updateThread(thread, {
                  status: thread.status === "hidden" ? "active" : "hidden",
                })
              }
              onToggleLocked={() =>
                updateThread(thread, {
                  status: thread.status === "locked" ? "active" : "locked",
                })
              }
              onTogglePinned={() =>
                updateThread(thread, { pinned: !Boolean(thread.pinned) })
              }
            />
          ))}
          {threads === undefined && overview === undefined ? (
            <StatusLine>Loading threads</StatusLine>
          ) : null}
          {threads !== undefined && threadRows.length === 0 ? (
            <StatusLine>No threads match the current filters</StatusLine>
          ) : null}
        </div>
      </section>

      <section
        id={moderationOnly ? "moderation-replies" : undefined}
        className="mt-8 border-y border-row-border py-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase text-muted-foreground">
              Reply queue
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Approve, hide, or delete replies without leaving the moderation
              console.
            </p>
          </div>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            {posts === undefined ? "Loading" : `${recentPosts.length} in view`}
          </p>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
          <div />
          <Field label="Reply status">
            <NativeSelect
              className="rounded-none"
              value={postStatusFilter}
              onChange={(event) =>
                setPostStatusFilter(
                  event.target.value as "all" | ForumPostStatus,
                )
              }
            >
              <option value="pending">pending</option>
              <option value="all">All statuses</option>
              {postStatusOptions
                .filter((status) => status !== "pending")
                .map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
            </NativeSelect>
          </Field>
        </div>

        <div className="mt-4 grid gap-3 border border-row-border bg-muted/20 p-3 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-end xl:grid-cols-[auto_minmax(0,1fr)_minmax(12rem,0.8fr)_minmax(12rem,0.8fr)_minmax(13rem,1fr)_auto]">
          <label className="flex items-center gap-2 font-mono text-[10px] uppercase text-muted-foreground">
            <input
              aria-label="Select all visible replies"
              checked={allVisiblePostsSelected}
              className="size-4 accent-primary"
              disabled={recentPosts.length === 0 || postBulkPending}
              type="checkbox"
              onChange={(event) =>
                setAllVisiblePostsSelected(event.target.checked)
              }
            />
            {selectedPostIds.length} selected
          </label>
          <Field label="Bulk reason">
            <Input
              className="rounded-none"
              disabled={postBulkPending}
              maxLength={180}
              placeholder="Optional reason applied to selected replies"
              value={postBulkReason}
              onChange={(event) => setPostBulkReason(event.target.value)}
            />
          </Field>
          <Field label="Target thread ID">
            <Input
              className="rounded-none"
              disabled={postBulkPending}
              placeholder="forumThreads id"
              value={postMoveTargetThreadId}
              onChange={(event) =>
                setPostMoveTargetThreadId(event.target.value)
              }
            />
          </Field>
          <Field label="Split board">
            <NativeSelect
              className="rounded-none"
              disabled={postBulkPending}
              value={postSplitTargetCategoryId}
              onChange={(event) =>
                setPostSplitTargetCategoryId(event.target.value)
              }
            >
              <option value="">Choose board</option>
              {moveBoardCategories.map((category) => (
                <option key={category._id} value={category._id}>
                  {forumCategoryPathLabel(category, categoriesById)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Split title">
            <Input
              className="rounded-none"
              disabled={postBulkPending}
              maxLength={160}
              placeholder="New thread title"
              value={postSplitTitle}
              onChange={(event) => setPostSplitTitle(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <ActionButton
              disabled={postBulkPending || selectedPostIds.length === 0}
              label="Approve/restore"
              onClick={() => updateSelectedPosts("active", "Restored")}
            />
            <ActionButton
              disabled={postBulkPending || selectedPostIds.length === 0}
              label="Hide"
              onClick={() =>
                updateSelectedPosts("hidden", "Hidden", {
                  eligible: (post) =>
                    post.status !== "deleted" && post.status !== "pending",
                })
              }
            />
            <ActionButton
              disabled={postBulkPending || selectedPostIds.length === 0}
              icon={Trash2}
              label="Delete"
              onClick={() =>
                updateSelectedPosts("deleted", "Deleted", {
                  confirm: (count) =>
                    `Delete ${count} selected repl${
                      count === 1 ? "y" : "ies"
                    }?`,
                  eligible: (post) => post.status !== "deleted",
                })
              }
            />
            <ActionButton
              disabled={
                postBulkPending ||
                selectedPostIds.length === 0 ||
                postMoveTargetThreadId.trim().length === 0
              }
              icon={MoveRight}
              label="Move"
              onClick={moveSelectedPostsToThread}
            />
            <ActionButton
              disabled={
                postBulkPending ||
                selectedPostIds.length === 0 ||
                postSplitTargetCategoryId.trim().length === 0 ||
                postSplitTitle.trim().length === 0
              }
              icon={Plus}
              label="Split"
              onClick={splitSelectedPostsIntoThread}
            />
          </div>
        </div>

        <div className="mt-4 divide-y divide-row-border">
          {recentPosts.map((post) => (
            <PostRow
              key={post._id}
              post={post}
              reason={postReasons[post._id] ?? ""}
              selected={selectedPostIdSet.has(post._id)}
              onDelete={() => removePost(post)}
              onReasonChange={(value) => setPostReason(post._id, value)}
              onRestore={() => updatePost(post, "active")}
              onSelectedChange={(selected) =>
                setPostSelected(post._id, selected)
              }
              onToggleHidden={() =>
                updatePost(post, post.status === "hidden" ? "active" : "hidden")
              }
            />
          ))}
          {posts === undefined ? (
            <StatusLine>Loading replies</StatusLine>
          ) : null}
          {posts !== undefined && recentPosts.length === 0 ? (
            <StatusLine>No replies match the current filters</StatusLine>
          ) : null}
        </div>
      </section>

      <section
        id={moderationOnly ? "moderation-reports" : undefined}
        className="mt-8 border-y border-row-border py-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase text-muted-foreground">
              Reports
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Review member reports from thread and reply action bars.
            </p>
          </div>
          <Field label="Report status">
            <NativeSelect
              className="rounded-none"
              value={reportStatusFilter}
              onChange={(event) =>
                setReportStatusFilter(
                  event.target.value as "all" | ForumReportStatus,
                )
              }
            >
              <option value="open">Open</option>
              <option value="reviewed">Reviewed</option>
              <option value="dismissed">Dismissed</option>
              <option value="all">All</option>
            </NativeSelect>
          </Field>
        </div>

        <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
          <div className="divide-y divide-row-border">
            {reportRows.map((report) => (
              <ReportRow
                key={report._id}
                report={report}
                selected={selectedReportId === report._id}
                onDismiss={() => updateReport(report, "dismissed")}
                onInspect={(trigger) => inspectReport(report, trigger)}
                onReopen={() => updateReport(report, "open")}
                onReview={() => updateReport(report, "reviewed")}
              />
            ))}
            {reports === undefined ? (
              <StatusLine>Loading reports</StatusLine>
            ) : null}
            {reports !== undefined && reportRows.length === 0 ? (
              <StatusLine>No reports match the current filter</StatusLine>
            ) : null}
          </div>
          <ReportDrilldownPanel
            headingRef={reportInspectorHeadingRef}
            noteDraft={
              selectedReport === null
                ? ""
                : (reportNoteDrafts[selectedReport._id] ??
                  selectedReport.moderationNote ??
                  "")
            }
            report={selectedReport}
            threadDetail={selectedThreadDetail}
            onClose={closeReportInspector}
            onDismiss={(report, note) =>
              updateReport(report, "dismissed", note)
            }
            onNoteChange={(reportId, value) =>
              setReportNoteDrafts((current) => ({
                ...current,
                [reportId]: value,
              }))
            }
            onPollStatusChange={updatePoll}
            onReopen={(report, note) => updateReport(report, "open", note)}
            onReview={(report, note) => updateReport(report, "reviewed", note)}
          />
        </div>
      </section>

      <section
        id={moderationOnly ? "moderation-history" : undefined}
        className="mt-8 border-y border-row-border py-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase text-muted-foreground">
              Audit trail
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Append-only record of board, report, poll, thread, and reply
              actions.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Exact audit board">
              <NativeSelect
                className="rounded-none"
                value={auditCategoryFilter}
                onChange={(event) => setAuditCategoryFilter(event.target.value)}
              >
                <option value="all">All categories</option>
                {boardCategories.map((category) => (
                  <option key={category._id} value={category._id}>
                    {forumCategoryPathLabel(category, categoriesById)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              {moderationEvents === undefined
                ? "Loading"
                : `${moderationEventRows.length} recent`}
            </p>
          </div>
        </div>

        <div className="mt-4 divide-y divide-row-border">
          {moderationEventRows.map((event) => (
            <ModerationEventRow event={event} key={event._id} />
          ))}
          {moderationEvents === undefined ? (
            <StatusLine>Loading audit trail</StatusLine>
          ) : null}
          {moderationEvents !== undefined &&
          moderationEventRows.length === 0 ? (
            <StatusLine>No moderation events recorded yet</StatusLine>
          ) : null}
        </div>
      </section>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-xl font-semibold text-foreground">{value}</p>
      <p>{label}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span className="font-mono text-[10px] uppercase text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
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
        "h-9 border border-input bg-background px-3 font-mono text-xs uppercase",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

function StatusLine({ children }: { children: ReactNode }) {
  return (
    <p
      aria-live="polite"
      className="py-4 font-mono text-xs uppercase text-muted-foreground"
      role="status"
    >
      {children}
    </p>
  );
}

function ActionButton({
  ariaPressed,
  buttonRef,
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  ariaPressed?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  disabled?: boolean;
  icon?: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-pressed={ariaPressed}
      className="rounded-none px-2 font-mono text-[10px] uppercase"
      disabled={disabled}
      ref={buttonRef}
      size="sm"
      type="button"
      variant="outline"
      onClick={onClick}
    >
      {Icon ? <Icon /> : null}
      {label}
    </Button>
  );
}

function ThreadRow({
  categoriesById,
  moveCategories,
  moveTargetCategoryId,
  reason,
  selected,
  thread,
  onDelete,
  onMove,
  onMoveTargetChange,
  onReasonChange,
  onRestore,
  onSelectedChange,
  onToggleHidden,
  onToggleLocked,
  onTogglePinned,
}: {
  categoriesById: Map<string, ForumCategoryRecord>;
  moveCategories: ForumCategoryRecord[];
  moveTargetCategoryId: string;
  reason: string;
  selected: boolean;
  thread: ForumThreadRecord;
  onDelete: () => void;
  onMove: () => void;
  onMoveTargetChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onRestore: () => void;
  onSelectedChange: (selected: boolean) => void;
  onToggleHidden: () => void;
  onToggleLocked: () => void;
  onTogglePinned: () => void;
}) {
  const deleted = thread.status === "deleted";
  const pending = thread.status === "pending";
  const locked = thread.status === "locked";
  const targetOptions = moveCategories.filter(
    (category) => category._id !== thread.categoryId,
  );

  return (
    <article className="grid gap-4 py-4 lg:grid-cols-[auto_minmax(0,1.2fr)_minmax(18rem,0.95fr)]">
      <label className="flex items-start pt-1">
        <span className="sr-only">Select thread {thread.title}</span>
        <input
          checked={selected}
          className="size-4 accent-primary"
          type="checkbox"
          onChange={(event) => onSelectedChange(event.target.checked)}
        />
      </label>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {thread.prefix ? <PrefixLabel prefix={thread.prefix} /> : null}
          <h3 className="truncate text-base font-semibold">{thread.title}</h3>
          <StatusBadge status={thread.status} />
          {thread.pinned ? <StatusBadge status="pinned" /> : null}
          {locked ? <StatusBadge status="locked" /> : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase text-muted-foreground">
          <span>
            {thread.categoryName ?? thread.categorySlug ?? "No category"}
          </span>
          <span>{thread.author ?? "Unknown author"}</span>
          <span>
            {formatShortDate(
              thread.updatedAt ??
                thread.lastPostAt ??
                thread.createdAt ??
                thread._creationTime,
            )}
          </span>
          <span>{thread.replyCount ?? 0} replies</span>
        </div>
        {thread.moderationReason?.trim() ? (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Last reason: {thread.moderationReason.trim()}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <Input
          aria-label={`Moderation reason for ${thread.title}`}
          className="rounded-none"
          placeholder="Moderation reason"
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
        />
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <NativeSelect
            aria-label={`Move ${thread.title} to board`}
            className="rounded-none"
            disabled={deleted || pending || targetOptions.length === 0}
            value={moveTargetCategoryId}
            onChange={(event) => onMoveTargetChange(event.target.value)}
          >
            <option value="">Move to board</option>
            {targetOptions.map((category) => (
              <option key={category._id} value={category._id}>
                {forumCategoryPathLabel(category, categoriesById)}
              </option>
            ))}
          </NativeSelect>
          <ActionButton
            disabled={deleted || pending || moveTargetCategoryId.length === 0}
            icon={MoveRight}
            label="Move"
            onClick={onMove}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {pending ? (
            <ActionButton label="Approve" onClick={onRestore} />
          ) : null}
          {deleted ? (
            <ActionButton label="Restore" onClick={onRestore} />
          ) : null}
          <ActionButton
            disabled={deleted || pending}
            icon={Pin}
            label={thread.pinned ? "Unpin" : "Pin"}
            onClick={onTogglePinned}
          />
          <ActionButton
            disabled={deleted || pending}
            icon={Lock}
            label={locked ? "Unlock" : "Lock"}
            onClick={onToggleLocked}
          />
          <ActionButton
            disabled={deleted || pending}
            label={thread.status === "hidden" ? "Show" : "Hide"}
            onClick={onToggleHidden}
          />
          <ActionButton
            disabled={deleted}
            icon={Trash2}
            label="Delete"
            onClick={onDelete}
          />
        </div>
      </div>
    </article>
  );
}

function PostRow({
  post,
  reason,
  selected,
  onDelete,
  onReasonChange,
  onRestore,
  onSelectedChange,
  onToggleHidden,
}: {
  post: ForumPostRecord;
  reason: string;
  selected: boolean;
  onDelete: () => void;
  onReasonChange: (value: string) => void;
  onRestore: () => void;
  onSelectedChange: (selected: boolean) => void;
  onToggleHidden: () => void;
}) {
  const deleted = post.status === "deleted";
  const pending = post.status === "pending";

  return (
    <article className="grid gap-4 py-4 lg:grid-cols-[auto_minmax(0,1.2fr)_minmax(18rem,0.95fr)]">
      <label className="flex items-start pt-1">
        <span className="sr-only">
          Select reply in {post.threadTitle ?? "thread"}
        </span>
        <input
          checked={selected}
          className="size-4 accent-primary"
          type="checkbox"
          onChange={(event) => onSelectedChange(event.target.checked)}
        />
      </label>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-base font-semibold">
            {post.threadTitle ?? "Thread reply"}
          </p>
          <StatusBadge status={post.status} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase text-muted-foreground">
          <span>{post.categorySlug ?? "No category"}</span>
          <span>{post.author ?? "Unknown author"}</span>
          <span>{formatShortDate(post.updatedAt ?? post.createdAt ?? 0)}</span>
        </div>
        <p className="mt-3 line-clamp-4 text-sm leading-6 text-muted-foreground">
          {post.excerpt?.trim() || post.body?.trim() || "No preview"}
        </p>
        {post.moderationReason?.trim() ? (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Last reason: {post.moderationReason.trim()}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <Input
          aria-label={`Moderation reason for post ${post._id}`}
          className="rounded-none"
          placeholder="Moderation reason"
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {pending ? (
            <ActionButton label="Approve" onClick={onRestore} />
          ) : null}
          {deleted ? (
            <ActionButton label="Restore" onClick={onRestore} />
          ) : null}
          <ActionButton
            disabled={deleted || pending}
            label={post.status === "hidden" ? "Show" : "Hide"}
            onClick={onToggleHidden}
          />
          <ActionButton
            disabled={deleted}
            icon={Trash2}
            label="Delete"
            onClick={onDelete}
          />
        </div>
      </div>
    </article>
  );
}

function ReportRow({
  report,
  selected,
  onDismiss,
  onInspect,
  onReopen,
  onReview,
}: {
  report: ForumReportRecord;
  selected: boolean;
  onDismiss: () => void;
  onInspect: (trigger: HTMLButtonElement | null) => void;
  onReopen: () => void;
  onReview: () => void;
}) {
  const closed = report.status !== "open";
  const inspectButtonRef = useRef<HTMLButtonElement | null>(null);

  return (
    <article
      className={cn(
        "grid gap-4 border-l-2 border-transparent py-4 pl-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.95fr)]",
        selected && "border-l-primary bg-muted/25",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {report.threadPrefix ? (
            <PrefixLabel prefix={report.threadPrefix} />
          ) : null}
          <p className="truncate text-base font-semibold">
            {report.threadTitle ?? "Forum report"}
          </p>
          <StatusBadge status={report.status} />
          <StatusBadge status={report.entityType} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase text-muted-foreground">
          <span>
            {report.entityType === "privateMessage"
              ? "Private message"
              : (report.categoryName ?? report.categorySlug ?? "No category")}
          </span>
          <span>{report.reporter}</span>
          {report.targetUser ? <span>Target {report.targetUser}</span> : null}
          {report.targetActiveWarningCount > 0 ? (
            <span>
              Warnings {report.targetActiveWarningCount} /{" "}
              {report.targetActiveWarningPoints} pts
            </span>
          ) : null}
          <span>{formatShortDate(report.createdAt)}</span>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Reason: {report.reason}
        </p>
        {report.details?.trim() ? (
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
            {report.details.trim()}
          </p>
        ) : null}
        {report.excerpt?.trim() ? (
          <p className="mt-2 line-clamp-2 border-l-2 border-row-border pl-3 text-sm leading-6 text-muted-foreground">
            {report.excerpt.trim()}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap content-start gap-2">
        <ActionButton
          ariaPressed={selected}
          buttonRef={inspectButtonRef}
          label={selected ? "Selected" : "Inspect"}
          onClick={() => onInspect(inspectButtonRef.current)}
        />
        <ActionButton
          disabled={report.status === "reviewed"}
          label="Reviewed"
          onClick={onReview}
        />
        <ActionButton
          disabled={report.status === "dismissed"}
          label="Dismiss"
          onClick={onDismiss}
        />
        <ActionButton disabled={!closed} label="Reopen" onClick={onReopen} />
      </div>
    </article>
  );
}

function ReportDrilldownPanel({
  headingRef,
  noteDraft,
  report,
  threadDetail,
  onClose,
  onDismiss,
  onNoteChange,
  onPollStatusChange,
  onReopen,
  onReview,
}: {
  headingRef: RefObject<HTMLParagraphElement | null>;
  noteDraft: string;
  report: ForumReportRecord | null;
  threadDetail: AdminThreadDetailResult | undefined;
  onClose: () => void;
  onDismiss: (report: ForumReportRecord, note: string) => Promise<boolean>;
  onNoteChange: (reportId: string, value: string) => void;
  onPollStatusChange: (poll: ForumPollRecord, status: ForumPollStatus) => void;
  onReopen: (report: ForumReportRecord, note: string) => Promise<boolean>;
  onReview: (report: ForumReportRecord, note: string) => Promise<boolean>;
}) {
  const [pendingStatus, setPendingStatus] = useState<ForumReportStatus | null>(
    null,
  );
  const [isSubmittingStatus, setIsSubmittingStatus] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [warningPoints, setWarningPoints] = useState("1");
  const [warningReason, setWarningReason] = useState("");
  const [warningNote, setWarningNote] = useState("");
  const [isIssuingWarning, setIsIssuingWarning] = useState(false);
  const [pendingWarningId, setPendingWarningId] = useState<string | null>(null);
  const threadBodyRef = useRef<HTMLElement | null>(null);
  const reportedReplyRef = useRef<HTMLElement | null>(null);
  const noteFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const issueWarning = useMutation(adminIssueWarningRef);
  const updateWarningStatus = useMutation(adminUpdateWarningStatusRef);
  const warningHistory = useQuery(
    adminListWarningsRef,
    report?.targetUserId
      ? { targetUserId: report.targetUserId, limit: 6 }
      : "skip",
  );
  const contentEdits = useQuery(
    adminListContentEditsRef,
    report?.threadId
      ? {
          threadId: report.threadId,
          ...(report.postId ? { postId: report.postId } : {}),
          limit: 8,
        }
      : "skip",
  );

  useEffect(() => {
    setPendingStatus(null);
    setIsSubmittingStatus(false);
    setStatusMessage(null);
  }, [report?._id]);

  useEffect(() => {
    setWarningPoints("1");
    setWarningReason(report?.reason ?? "");
    setWarningNote("");
    setIsIssuingWarning(false);
    setPendingWarningId(null);
  }, [report?._id, report?.reason]);

  if (report === null) {
    return (
      <aside className="border border-row-border p-4">
        <p className="font-mono text-xs uppercase text-muted-foreground">
          Report inspector
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Select a report to inspect the thread, reply context, poll state, and
          moderation note.
        </p>
      </aside>
    );
  }

  const currentReport = report;
  const snapshotBody = report.snapshotBody?.trim();
  const snapshotTitle = report.snapshotTitle?.trim();

  function focusPanelSection(target: HTMLElement | null, message: string) {
    if (!target) {
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    window.requestAnimationFrame(() => {
      target.focus();
    });
    setStatusMessage(message);
  }

  function requestStatusChange(status: ForumReportStatus) {
    setPendingStatus(status);
    setStatusMessage(
      `Confirm marking this report ${status}. The current moderation note will be saved with that change.`,
    );
  }

  async function confirmStatusChange() {
    if (pendingStatus === null) {
      return;
    }
    const handlers: Record<
      ForumReportStatus,
      (report: ForumReportRecord, note: string) => Promise<boolean>
    > = {
      dismissed: onDismiss,
      open: onReopen,
      reviewed: onReview,
    };
    setIsSubmittingStatus(true);
    setStatusMessage(`Updating report to ${pendingStatus}...`);
    try {
      const updated = await handlers[pendingStatus](currentReport, noteDraft);
      if (updated) {
        setStatusMessage(`Report marked ${pendingStatus}.`);
        setPendingStatus(null);
      } else {
        setStatusMessage(
          "Could not update report. Check the toast and try again.",
        );
      }
    } finally {
      setIsSubmittingStatus(false);
    }
  }

  async function submitWarning() {
    if (!currentReport.targetUserId) {
      setStatusMessage("This report no longer has a warning target.");
      return;
    }
    const points = Number(warningPoints);
    if (!Number.isInteger(points) || points < 1 || points > 10) {
      setStatusMessage("Warning points must be a whole number from 1 to 10.");
      return;
    }
    if (warningReason.trim().length < 3) {
      setStatusMessage("Add a warning reason before issuing points.");
      return;
    }

    setIsIssuingWarning(true);
    setStatusMessage("Issuing warning...");
    try {
      const result = await issueWarning({
        targetUserId: currentReport.targetUserId,
        reportId: currentReport._id,
        points,
        reason: warningReason.trim(),
        moderationNote: warningNote.trim() || noteDraft.trim() || undefined,
      });
      onNoteChange(
        currentReport._id,
        result.report?.moderationNote ?? noteDraft,
      );
      setWarningNote("");
      setPendingStatus(null);
      setStatusMessage(
        `Issued ${result.warning.points} warning point${
          result.warning.points === 1 ? "" : "s"
        } to ${result.warning.targetUser}.`,
      );
      toast.success("Forum warning issued");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "warning_issue_failed",
        component: "ReportDrilldownPanel",
        action: "forum:issueForumWarning",
        entityType: "forumReport",
        entityId: currentReport._id,
        notify: false,
      });
      setStatusMessage(
        error instanceof Error ? error.message : "Could not issue warning.",
      );
      toast.error(
        error instanceof Error ? error.message : "Could not issue warning",
      );
    } finally {
      setIsIssuingWarning(false);
    }
  }

  async function changeWarningStatus(
    warning: ForumWarningRecord,
    status: ForumWarningStatus,
  ) {
    setPendingWarningId(warning._id);
    setStatusMessage(`Updating warning to ${status}...`);
    try {
      await updateWarningStatus({
        warningId: warning._id,
        status,
        moderationNote: warning.moderationNote,
      });
      setStatusMessage(`Warning marked ${status}.`);
      toast.success(`Warning marked ${status}`);
    } catch (error) {
      reportAppError(error, {
        scope: "admin-forum",
        eventType: "warning_update_failed",
        component: "ReportDrilldownPanel",
        action: "forum:updateForumWarningStatus",
        entityType: "forumWarning",
        entityId: warning._id,
        notify: false,
      });
      setStatusMessage(
        error instanceof Error ? error.message : "Could not update warning.",
      );
      toast.error(
        error instanceof Error ? error.message : "Could not update warning",
      );
    } finally {
      setPendingWarningId(null);
    }
  }

  if (report.entityType === "privateMessage") {
    return (
      <aside className="border border-row-border p-4 xl:sticky xl:top-24">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p
              className="focus-ring font-mono text-xs uppercase text-muted-foreground"
              ref={headingRef}
              tabIndex={-1}
            >
              Report inspector
            </p>
            <h3 className="mt-1 text-lg font-semibold">
              {snapshotTitle ?? report.threadTitle ?? "Private message"}
            </h3>
          </div>
          <Button
            className="h-8 rounded-none font-mono text-[10px] uppercase"
            size="sm"
            type="button"
            variant="outline"
            onClick={onClose}
          >
            Close
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <StatusBadge status={report.status} />
          <StatusBadge status={report.entityType} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton
            label="Jump to note"
            onClick={() =>
              focusPanelSection(
                noteFieldRef.current,
                "Jumped to moderation note.",
              )
            }
          />
        </div>

        <div className="mt-4 grid gap-2 font-mono text-[10px] uppercase text-muted-foreground">
          <span>Private message</span>
          <span>Reported by {report.reporter}</span>
          {report.targetUser ? <span>Target {report.targetUser}</span> : null}
          <span>Opened {formatShortDate(report.createdAt)}</span>
          {report.reviewedAt ? (
            <span>
              Reviewed {formatShortDate(report.reviewedAt)}
              {report.reviewer ? ` by ${report.reviewer}` : ""}
            </span>
          ) : null}
          {report.snapshotAuthor ? (
            <span>From {report.snapshotAuthor}</span>
          ) : null}
          {report.snapshotCreatedAt ? (
            <span>Sent {formatShortDate(report.snapshotCreatedAt)}</span>
          ) : null}
          {report.messageId ? (
            <span>Message {shortId(report.messageId)}</span>
          ) : null}
        </div>

        <section className="mt-4 border border-row-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Reported snapshot
            </p>
            <StatusBadge status="frozen" />
          </div>
          {snapshotTitle ? (
            <p className="mt-2 text-sm font-semibold">{snapshotTitle}</p>
          ) : null}
          <p className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-row-border pl-3 text-sm leading-6 text-muted-foreground">
            {snapshotBody ??
              report.excerpt?.trim() ??
              "No message body snapshot."}
          </p>
        </section>

        <section className="mt-4 border border-row-border p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase text-muted-foreground">
                Warning level
              </p>
              <p className="mt-1 text-sm font-semibold">
                {report.targetUser ?? "No target member"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                status={`${report.targetActiveWarningCount} active`}
              />
              <StatusBadge status={`${report.targetActiveWarningPoints} pts`} />
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[5rem_minmax(0,1fr)]">
            <Field label="Points">
              <Input
                className="mt-2 rounded-none"
                disabled={!report.targetUserId || isIssuingWarning}
                min={1}
                max={10}
                type="number"
                value={warningPoints}
                onChange={(event) => setWarningPoints(event.target.value)}
              />
            </Field>
            <Field label="Reason">
              <Input
                className="mt-2 rounded-none"
                disabled={!report.targetUserId || isIssuingWarning}
                placeholder="Rule violation or moderation reason"
                value={warningReason}
                onChange={(event) => setWarningReason(event.target.value)}
              />
            </Field>
          </div>
          <Field label="Warning note">
            <Textarea
              className="mt-2 rounded-none"
              disabled={!report.targetUserId || isIssuingWarning}
              placeholder="Optional private note for this warning"
              rows={3}
              value={warningNote}
              onChange={(event) => setWarningNote(event.target.value)}
            />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton
              disabled={!report.targetUserId || isIssuingWarning}
              label={isIssuingWarning ? "Issuing..." : "Issue warning"}
              onClick={() => {
                void submitWarning();
              }}
            />
          </div>
          <div className="mt-4 border-t border-row-border pt-3">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Recent warnings
            </p>
            {warningHistory === undefined && report.targetUserId ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Loading warnings...
              </p>
            ) : warningHistory && warningHistory.length > 0 ? (
              <div className="mt-2 divide-y divide-row-border">
                {warningHistory.map((warning) => (
                  <ForumWarningRow
                    key={warning._id}
                    pending={pendingWarningId === warning._id}
                    warning={warning}
                    onStatusChange={(status) => {
                      void changeWarningStatus(warning, status);
                    }}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                No warnings recorded for this member.
              </p>
            )}
          </div>
        </section>

        <Field label="Moderation note">
          <Textarea
            className="mt-4 rounded-none"
            placeholder="Record what you reviewed or why this report was dismissed."
            ref={noteFieldRef}
            rows={4}
            value={noteDraft}
            onChange={(event) => onNoteChange(report._id, event.target.value)}
          />
        </Field>

        <div className="mt-4 border border-row-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={report.status} />
            {pendingStatus ? (
              <StatusBadge status={`pending:${pendingStatus}`} />
            ) : null}
            {isSubmittingStatus ? <StatusBadge status="saving" /> : null}
          </div>
          <p
            aria-live="polite"
            className="mt-2 text-sm leading-6 text-muted-foreground"
            role="status"
          >
            {statusMessage ?? "Choose a report action below."}
          </p>
          {pendingStatus ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionButton
                disabled={isSubmittingStatus}
                label={`Confirm ${pendingStatus}`}
                onClick={() => {
                  void confirmStatusChange();
                }}
              />
              <ActionButton
                disabled={isSubmittingStatus}
                label="Cancel"
                onClick={() => {
                  setPendingStatus(null);
                  setStatusMessage("Report status change canceled.");
                }}
              />
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton
            disabled={isSubmittingStatus || report.status === "reviewed"}
            label="Reviewed"
            onClick={() => requestStatusChange("reviewed")}
          />
          <ActionButton
            disabled={isSubmittingStatus || report.status === "dismissed"}
            label="Dismiss"
            onClick={() => requestStatusChange("dismissed")}
          />
          <ActionButton
            disabled={isSubmittingStatus || report.status === "open"}
            label="Reopen"
            onClick={() => requestStatusChange("open")}
          />
        </div>
      </aside>
    );
  }

  if (threadDetail === undefined) {
    return (
      <aside className="border border-row-border p-4">
        <p
          className="focus-ring font-mono text-xs uppercase text-muted-foreground"
          ref={headingRef}
          tabIndex={-1}
        >
          Report inspector
        </p>
        <StatusLine>Loading thread context</StatusLine>
      </aside>
    );
  }

  const reportedPost = threadDetail.replies.page.find(
    (post) => post._id === report.postId,
  );
  const focusedReportedPost =
    reportedPost ?? threadDetail.focusPost ?? undefined;
  const reportedPostIsAvailable =
    report.postId === undefined || focusedReportedPost !== undefined;
  const reportedPostIsInPage = reportedPost !== undefined;
  const threadHighlighted = report.entityType === "thread";
  const poll = threadDetail.poll;

  return (
    <aside className="border border-row-border p-4 xl:sticky xl:top-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p
            className="focus-ring font-mono text-xs uppercase text-muted-foreground"
            ref={headingRef}
            tabIndex={-1}
          >
            Report inspector
          </p>
          <h3 className="mt-1 text-lg font-semibold">
            {threadDetail.thread.title}
          </h3>
        </div>
        <Button
          className="h-8 rounded-none font-mono text-[10px] uppercase"
          size="sm"
          type="button"
          variant="outline"
          onClick={onClose}
        >
          Close
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <StatusBadge status={report.status} />
        <StatusBadge status={report.entityType} />
        <StatusBadge status={threadDetail.thread.status} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton
          label="Jump to thread"
          onClick={() =>
            focusPanelSection(threadBodyRef.current, "Jumped to thread body.")
          }
        />
        <ActionButton
          disabled={!report.postId || !reportedPostIsAvailable}
          label="Jump to reported reply"
          onClick={() =>
            focusPanelSection(
              reportedReplyRef.current,
              "Jumped to the reported reply.",
            )
          }
        />
        <ActionButton
          label="Jump to note"
          onClick={() =>
            focusPanelSection(
              noteFieldRef.current,
              "Jumped to moderation note.",
            )
          }
        />
      </div>

      <div className="mt-4 grid gap-2 font-mono text-[10px] uppercase text-muted-foreground">
        <span>{threadDetail.category.name}</span>
        <span>Reported by {report.reporter}</span>
        <span>Opened {formatShortDate(report.createdAt)}</span>
        {report.reviewedAt ? (
          <span>
            Reviewed {formatShortDate(report.reviewedAt)}
            {report.reviewer ? ` by ${report.reviewer}` : ""}
          </span>
        ) : null}
        {report.postNumber ? (
          <span>
            Reported reply #{report.postNumber}
            {report.postPage ? ` on page ${report.postPage}` : ""}
          </span>
        ) : null}
      </div>

      {snapshotBody ? (
        <section className="mt-4 border border-row-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Reported snapshot
            </p>
            <StatusBadge status="frozen" />
          </div>
          {snapshotTitle ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {report.threadPrefix ? (
                <PrefixLabel prefix={report.threadPrefix} />
              ) : null}
              <p className="text-sm font-semibold">{snapshotTitle}</p>
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10px] uppercase text-muted-foreground">
            {report.snapshotAuthor ? (
              <span>{report.snapshotAuthor}</span>
            ) : null}
            {report.snapshotPostNumber ? (
              <span>Reply #{report.snapshotPostNumber}</span>
            ) : null}
            {report.snapshotCreatedAt ? (
              <span>{formatShortDate(report.snapshotCreatedAt)}</span>
            ) : null}
          </div>
          <p className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-row-border pl-3 text-sm leading-6 text-muted-foreground">
            {snapshotBody}
          </p>
        </section>
      ) : null}

      <ContentEditHistoryPanel edits={contentEdits} report={report} />

      <section className="mt-4 border border-row-border p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Warning level
            </p>
            <p className="mt-1 text-sm font-semibold">
              {report.targetUser ?? "No target member"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={`${report.targetActiveWarningCount} active`} />
            <StatusBadge status={`${report.targetActiveWarningPoints} pts`} />
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[5rem_minmax(0,1fr)]">
          <Field label="Points">
            <Input
              className="mt-2 rounded-none"
              disabled={!report.targetUserId || isIssuingWarning}
              min={1}
              max={10}
              type="number"
              value={warningPoints}
              onChange={(event) => setWarningPoints(event.target.value)}
            />
          </Field>
          <Field label="Reason">
            <Input
              className="mt-2 rounded-none"
              disabled={!report.targetUserId || isIssuingWarning}
              placeholder="Rule violation or moderation reason"
              value={warningReason}
              onChange={(event) => setWarningReason(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Warning note">
          <Textarea
            className="mt-2 rounded-none"
            disabled={!report.targetUserId || isIssuingWarning}
            placeholder="Optional private note for this warning"
            rows={3}
            value={warningNote}
            onChange={(event) => setWarningNote(event.target.value)}
          />
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionButton
            disabled={!report.targetUserId || isIssuingWarning}
            label={isIssuingWarning ? "Issuing..." : "Issue warning"}
            onClick={() => {
              void submitWarning();
            }}
          />
        </div>
        <div className="mt-4 border-t border-row-border pt-3">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Recent warnings
          </p>
          {warningHistory === undefined && report.targetUserId ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Loading warnings...
            </p>
          ) : warningHistory && warningHistory.length > 0 ? (
            <div className="mt-2 divide-y divide-row-border">
              {warningHistory.map((warning) => (
                <ForumWarningRow
                  key={warning._id}
                  pending={pendingWarningId === warning._id}
                  warning={warning}
                  onStatusChange={(status) => {
                    void changeWarningStatus(warning, status);
                  }}
                />
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No warnings recorded for this member.
            </p>
          )}
        </div>
      </section>

      <section
        className={cn(
          "focus-ring mt-5 border border-row-border p-3",
          threadHighlighted && "border-primary",
        )}
        ref={threadBodyRef}
        tabIndex={-1}
      >
        <p className="font-mono text-[10px] uppercase text-muted-foreground">
          Thread body
        </p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
          {threadDetail.thread.body?.trim() || "No thread body loaded."}
        </p>
      </section>

      {poll ? (
        <section className="mt-4 border border-row-border p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase text-muted-foreground">
                Poll
              </p>
              <p className="mt-1 text-sm font-semibold">{poll.question}</p>
            </div>
            <StatusBadge status={poll.status} />
          </div>
          <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
            {poll.options.map((option) => (
              <div
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3"
                key={option._id}
              >
                <span className="truncate">{option.label}</span>
                <span>{option.voteCount} votes</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton
              disabled={poll.status === "open"}
              label="Open poll"
              onClick={() => onPollStatusChange(poll, "open")}
            />
            <ActionButton
              disabled={poll.status === "closed"}
              label="Close poll"
              onClick={() => onPollStatusChange(poll, "closed")}
            />
          </div>
        </section>
      ) : null}

      {focusedReportedPost && !reportedPostIsInPage ? (
        <section
          className="focus-ring mt-4 border border-primary bg-muted/20 p-3"
          ref={reportedReplyRef}
          tabIndex={-1}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Reported reply #{focusedReportedPost.postNumber ?? "?"} /{" "}
              {focusedReportedPost.author}
            </p>
            <StatusBadge status={focusedReportedPost.status} />
            <StatusBadge status="reported" />
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
            {focusedReportedPost.body}
          </p>
        </section>
      ) : null}

      <section className="mt-4 border border-row-border">
        <div className="border-b border-row-border px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground">
          Replies
        </div>
        <div className="max-h-[28rem] divide-y divide-row-border overflow-y-auto">
          {threadDetail.replies.page.map((post) => {
            const highlighted = post._id === report.postId;
            return (
              <article
                className={cn(
                  "focus-ring p-3",
                  highlighted && "border-l-2 border-primary bg-muted/25",
                )}
                key={post._id}
                ref={highlighted ? reportedReplyRef : null}
                tabIndex={highlighted ? -1 : undefined}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-[10px] uppercase text-muted-foreground">
                    #{post.postNumber ?? "?"} / {post.author}
                  </p>
                  <StatusBadge status={post.status} />
                  {highlighted ? <StatusBadge status="reported" /> : null}
                </div>
                <p className="mt-2 line-clamp-5 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                  {post.body}
                </p>
              </article>
            );
          })}
          {threadDetail.replies.page.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              No replies loaded.
            </p>
          ) : null}
        </div>
        {!threadDetail.replies.isDone ? (
          <p className="border-t border-row-border px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground">
            More replies exist; this inspector loads the first page for context.
          </p>
        ) : null}
        {!reportedPostIsAvailable ? (
          <p className="border-t border-primary px-3 py-2 font-mono text-[10px] uppercase text-primary">
            Reported reply could not be loaded.
          </p>
        ) : null}
      </section>

      <Field label="Moderation note">
        <Textarea
          className="mt-4 rounded-none"
          placeholder="Record what you reviewed or why this report was dismissed."
          ref={noteFieldRef}
          rows={4}
          value={noteDraft}
          onChange={(event) => onNoteChange(report._id, event.target.value)}
        />
      </Field>

      <div className="mt-4 border border-row-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={report.status} />
          {pendingStatus ? (
            <StatusBadge status={`pending:${pendingStatus}`} />
          ) : null}
          {isSubmittingStatus ? <StatusBadge status="saving" /> : null}
        </div>
        <p
          aria-live="polite"
          className="mt-2 text-sm leading-6 text-muted-foreground"
          role="status"
        >
          {statusMessage ?? "Choose a report action below."}
        </p>
        {pendingStatus ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton
              disabled={isSubmittingStatus}
              label={`Confirm ${pendingStatus}`}
              onClick={() => {
                void confirmStatusChange();
              }}
            />
            <ActionButton
              disabled={isSubmittingStatus}
              label="Cancel"
              onClick={() => {
                setPendingStatus(null);
                setStatusMessage("Report status change canceled.");
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton
          disabled={isSubmittingStatus || report.status === "reviewed"}
          label="Reviewed"
          onClick={() => requestStatusChange("reviewed")}
        />
        <ActionButton
          disabled={isSubmittingStatus || report.status === "dismissed"}
          label="Dismiss"
          onClick={() => requestStatusChange("dismissed")}
        />
        <ActionButton
          disabled={isSubmittingStatus || report.status === "open"}
          label="Reopen"
          onClick={() => requestStatusChange("open")}
        />
      </div>
    </aside>
  );
}

function ForumWarningRow({
  pending,
  warning,
  onStatusChange,
}: {
  pending: boolean;
  warning: ForumWarningRecord;
  onStatusChange: (status: ForumWarningStatus) => void;
}) {
  const canRevoke = warning.status === "active";
  const canRestore = warning.status === "revoked";

  return (
    <article className="grid gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={warning.status} />
        <StatusBadge status={`${warning.points} pts`} />
        {warning.expiresAt ? (
          <StatusBadge
            status={`expires ${formatShortDate(warning.expiresAt)}`}
          />
        ) : null}
      </div>
      <p className="text-sm font-medium">{warning.reason}</p>
      <p className="font-mono text-[10px] uppercase text-muted-foreground">
        Issued by {warning.actor} / {formatShortDate(warning.createdAt)}
      </p>
      {warning.moderationNote ? (
        <p className="text-sm leading-6 text-muted-foreground">
          {warning.moderationNote}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canRevoke ? (
          <ActionButton
            disabled={pending}
            label={pending ? "Saving..." : "Revoke"}
            onClick={() => onStatusChange("revoked")}
          />
        ) : null}
        {canRestore ? (
          <ActionButton
            disabled={pending}
            label={pending ? "Saving..." : "Restore"}
            onClick={() => onStatusChange("active")}
          />
        ) : null}
      </div>
    </article>
  );
}

function ContentEditHistoryPanel({
  edits,
  report,
}: {
  edits: AdminForumContentEditRecord[] | undefined;
  report: ForumReportRecord;
}) {
  return (
    <section className="mt-4 border border-row-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Edit history
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {report.postId ? "Reported reply edits" : "Thread and reply edits"}
          </p>
        </div>
        <StatusBadge
          status={edits === undefined ? "loading" : `${edits.length} edits`}
        />
      </div>
      {edits === undefined ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Loading edit history...
        </p>
      ) : edits.length > 0 ? (
        <div className="mt-3 divide-y divide-row-border">
          {edits.map((edit) => (
            <article className="grid gap-3 py-3" key={edit._id}>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={edit.entityType} />
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  {formatShortDate(edit.createdAt)} / {edit.actor}
                </p>
              </div>
              {edit.editReason ? (
                <p className="text-sm font-medium">{edit.editReason}</p>
              ) : null}
              {edit.previousTitle || edit.nextTitle ? (
                <div className="grid gap-2 text-sm text-muted-foreground">
                  <p className="line-clamp-1">
                    Before title: {edit.previousTitle ?? "(unchanged)"}
                  </p>
                  <p className="line-clamp-1">
                    After title: {edit.nextTitle ?? "(unchanged)"}
                  </p>
                </div>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="min-w-0 border border-row-border p-2">
                  <p className="font-mono text-[10px] uppercase text-muted-foreground">
                    Before
                  </p>
                  <p className="mt-1 line-clamp-5 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                    {compactBodyPreview(edit.previousBody)}
                  </p>
                </div>
                <div className="min-w-0 border border-row-border p-2">
                  <p className="font-mono text-[10px] uppercase text-muted-foreground">
                    After
                  </p>
                  <p className="mt-1 line-clamp-5 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                    {compactBodyPreview(edit.nextBody)}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          No edits recorded for this target.
        </p>
      )}
    </section>
  );
}

function ModerationEventRow({ event }: { event: ForumModerationEventRecord }) {
  const target = event.threadTitle ?? event.categoryName ?? event.entityId;
  const metadata = moderationMetadataSummary(event.metadataJson);

  return (
    <article className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_14rem] lg:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-base font-semibold">
            {formatEventType(event.eventType)}
          </p>
          <StatusBadge status={event.entityType} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase text-muted-foreground">
          <span>{event.actor}</span>
          <span>{event.categoryName ?? event.categorySlug ?? "Forum"}</span>
          <span>{formatShortDate(event.createdAt)}</span>
        </div>
        <p className="mt-2 truncate text-sm text-muted-foreground">
          Target: {target}
        </p>
        {metadata ? (
          <p className="mt-2 line-clamp-2 break-words font-mono text-[10px] uppercase text-muted-foreground">
            {metadata}
          </p>
        ) : null}
      </div>
      <div className="grid gap-1 font-mono text-[10px] uppercase text-muted-foreground lg:text-right">
        {event.threadId ? <span>Thread {shortId(event.threadId)}</span> : null}
        {event.postId ? <span>Post {shortId(event.postId)}</span> : null}
        {event.reportId ? <span>Report {shortId(event.reportId)}</span> : null}
        {event.pollId ? <span>Poll {shortId(event.pollId)}</span> : null}
      </div>
    </article>
  );
}

function IconButton({
  ariaLabel,
  disabled,
  icon: Icon,
  onClick,
}: {
  ariaLabel: string;
  disabled?: boolean;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={ariaLabel}
      className="rounded-none"
      disabled={disabled}
      size="icon"
      type="button"
      variant="ghost"
      onClick={onClick}
    >
      <Icon />
    </Button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone: "default" | "outline" | "secondary" =
    status === "deleted"
      ? "secondary"
      : status === "hidden" || status === "archived"
        ? "outline"
        : "default";

  return (
    <Badge
      className={cn(
        "rounded-none font-mono text-[10px] uppercase",
        tone === "outline" ? "text-muted-foreground" : null,
      )}
      variant={tone}
    >
      {status}
    </Badge>
  );
}

function PrefixLabel({
  prefix,
}: {
  prefix: { label: string; color?: string };
}) {
  return (
    <span
      className="inline-flex min-h-5 items-center border border-row-border px-1.5 font-mono text-[10px] uppercase leading-none text-muted-foreground"
      style={
        prefix.color
          ? { borderColor: prefix.color, color: prefix.color }
          : undefined
      }
    >
      [{prefix.label}]
    </span>
  );
}

function toastPrefixSyncResult(
  prefix: Pick<ForumThreadPrefixRecord, "syncedThreads" | "syncTruncated">,
  successMessage: string,
) {
  if (prefix.syncTruncated === true) {
    toast.warning(
      `${successMessage}, but only ${prefix.syncedThreads ?? 0} existing thread snapshots were synced. Run a backfill before treating older threads as fully updated.`,
    );
    return;
  }
  toast.success(successMessage);
}

function forumCategoryPathLabel(
  category: ForumCategoryRecord,
  categoriesById: Map<string, ForumCategoryRecord>,
) {
  const names = [category.name];
  let parentId = category.parentCategoryId;
  for (let depth = 0; depth < 4 && parentId !== undefined; depth += 1) {
    const parent = categoriesById.get(parentId);
    if (!parent) {
      break;
    }
    names.unshift(parent.name);
    parentId = parent.parentCategoryId;
  }
  return `${names.join(" / ")} /${category.slug}`;
}

function isDescendantCategory(
  candidate: ForumCategoryRecord,
  categoryId: string | undefined,
  categoriesById: Map<string, ForumCategoryRecord>,
) {
  if (categoryId === undefined) {
    return false;
  }
  let parentId = candidate.parentCategoryId;
  for (let depth = 0; depth < 10 && parentId !== undefined; depth += 1) {
    if (parentId === categoryId) {
      return true;
    }
    parentId = categoriesById.get(parentId)?.parentCategoryId;
  }
  return false;
}

function isParentableForumCategory(
  category: ForumCategoryRecord,
  categoriesById: Map<string, ForumCategoryRecord>,
) {
  if (category.kind === "section") {
    return true;
  }
  if (category.parentCategoryId === undefined) {
    return true;
  }
  const parent = categoriesById.get(category.parentCategoryId);
  return parent === undefined || parent.kind === "section";
}

function canHostVisibleThreadCategory(
  category: ForumCategoryRecord,
  categoriesById: Map<string, ForumCategoryRecord>,
) {
  if (category.kind === "section" || category.status !== "active") {
    return false;
  }

  const categoryRank = categoryViewAccessRank(category.viewAccess);
  let parentId = category.parentCategoryId;
  for (let depth = 0; depth < 10 && parentId !== undefined; depth += 1) {
    const parent = categoriesById.get(parentId);
    if (!parent || parent.status !== "active") {
      return false;
    }
    if (categoryViewAccessRank(parent.viewAccess) > categoryRank) {
      return false;
    }
    parentId = parent.parentCategoryId;
  }
  return parentId === undefined;
}

function categoryViewAccessRank(access: ForumCategoryViewAccess) {
  switch (access) {
    case "public":
      return 0;
    case "members":
      return 1;
    case "trusted":
      return 2;
    case "staff":
      return 3;
  }
}

function categoryToForm(
  category: ForumCategoryRecord | CategoryForm,
): CategoryForm {
  return {
    categoryId: "_id" in category ? category._id : category.categoryId,
    slug: category.slug,
    name: category.name,
    description: category.description ?? "",
    kind: category.kind ?? "board",
    parentCategoryId: category.parentCategoryId,
    status: category.status,
    viewAccess: category.viewAccess ?? "public",
    threadAccess: category.threadAccess ?? "trusted",
    replyAccess: category.replyAccess ?? "trusted",
    pollAccess: category.pollAccess ?? "trusted",
    position: category.position,
  };
}

function prefixToForm(
  prefix: ForumThreadPrefixRecord | PrefixForm,
): PrefixForm {
  return {
    prefixId: "_id" in prefix ? prefix._id : prefix.prefixId,
    categoryId: prefix.categoryId,
    slug: prefix.slug,
    label: prefix.label,
    description: prefix.description ?? "",
    color: prefix.color ?? "",
    status: prefix.status ?? "active",
    position: prefix.position ?? 10,
  };
}

function announcementToForm(
  announcement: ForumAnnouncementRecord | AnnouncementForm,
): AnnouncementForm {
  return {
    announcementId:
      "_id" in announcement ? announcement._id : announcement.announcementId,
    categoryId: announcement.categoryId,
    slug: announcement.slug,
    title: announcement.title,
    body: announcement.body,
    status: announcement.status ?? "active",
    position: announcement.position ?? 10,
  };
}

function helpDocumentToForm(
  document: ForumHelpDocumentRecord | HelpDocumentForm,
): HelpDocumentForm {
  return {
    helpDocumentId: "_id" in document ? document._id : document.helpDocumentId,
    slug: document.slug,
    title: document.title,
    body: document.body,
    status: document.status ?? "active",
    position: document.position ?? 10,
  };
}

function calendarEventToForm(
  event: ForumCalendarEventRecord | CalendarEventForm,
): CalendarEventForm {
  return {
    eventId: "_id" in event ? event._id : event.eventId,
    slug: event.slug,
    title: event.title,
    body: event.body,
    status: event.status ?? "active",
    startsAt:
      typeof event.startsAt === "number"
        ? dateTimeInputValue(event.startsAt)
        : event.startsAt,
    endsAt:
      typeof event.endsAt === "number"
        ? dateTimeInputValue(event.endsAt)
        : (event.endsAt ?? ""),
    allDay: event.allDay ?? false,
  };
}

function rulesToForm(rules: ForumBoardRulesRecord | RulesForm): RulesForm {
  return {
    rulesId: "_id" in rules ? rules._id : rules.rulesId,
    categoryId: rules.categoryId,
    title: rules.title,
    body: rules.body,
    status: rules.status ?? "active",
  };
}

function dateTimeInputValue(timestamp: number) {
  const parts = forumCalendarDateTimeParts(timestamp);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function parseDateTimeInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, yearValue, monthValue, dayValue, hourValue, minuteValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  if (
    year < 1970 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const wallTimeUtc = Date.UTC(year, month - 1, day, hour, minute);
  const wallDate = new Date(wallTimeUtc);
  if (
    wallDate.getUTCFullYear() !== year ||
    wallDate.getUTCMonth() !== month - 1 ||
    wallDate.getUTCDate() !== day ||
    wallDate.getUTCHours() !== hour ||
    wallDate.getUTCMinutes() !== minute
  ) {
    return null;
  }

  let timestamp = wallTimeUtc - forumCalendarTimeZoneOffsetMs(wallTimeUtc);
  timestamp = wallTimeUtc - forumCalendarTimeZoneOffsetMs(timestamp);
  return dateTimeInputValue(timestamp) === trimmed ? timestamp : null;
}

function parseOptionalDateTimeInput(value: string) {
  if (!value.trim()) {
    return undefined;
  }
  return parseDateTimeInput(value);
}

function formatShortDate(timestamp: number) {
  if (!timestamp) {
    return "No timestamp";
  }
  return formatDate(new Date(timestamp).toISOString());
}

function formatCalendarAdminDateTime(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: FORUM_CALENDAR_TIME_ZONE,
  }).format(new Date(timestamp));
}

function forumCalendarTimeZoneOffsetMs(timestamp: number) {
  const parts = forumCalendarDateTimeParts(timestamp);
  return (
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    ) - timestamp
  );
}

function forumCalendarDateTimeParts(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: FORUM_CALENDAR_TIME_ZONE,
    year: "numeric",
  }).formatToParts(new Date(timestamp));

  return {
    day: partValue(parts, "day"),
    hour: partValue(parts, "hour"),
    minute: partValue(parts, "minute"),
    month: partValue(parts, "month"),
    year: partValue(parts, "year").padStart(4, "0"),
  };
}

function partValue(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
) {
  return parts.find((part) => part.type === type)?.value ?? "00";
}

function compactBodyPreview(value: string) {
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : "(empty)";
}

function formatEventType(value: string) {
  return value
    .replace(/^forum_/, "")
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function moderationMetadataSummary(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.entries(parsed)
      .filter(([, item]) => item !== null && item !== undefined && item !== "")
      .slice(0, 6)
      .map(([key, item]) => `${key}: ${String(item)}`)
      .join(" / ");
  } catch {
    return value;
  }
}

function shortId(value: string) {
  return value.slice(-6);
}

function isForumThreadStatus(value: string): value is ForumThreadStatus {
  return (
    value === "pending" ||
    value === "active" ||
    value === "locked" ||
    value === "hidden" ||
    value === "deleted"
  );
}
