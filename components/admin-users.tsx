"use client";

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
import {
  convexRefs,
  type AdminUserRecord,
  type ForumAccountStatus,
  type ForumRole,
  type UserRole,
} from "@/lib/convex-refs";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

const roles: UserRole[] = ["owner", "admin", "reader"];
const forumRoleOptions = ["none", "moderator", "admin"] as const;
const roleFilters = ["all", ...roles] as const;
const forumRoleFilters = ["all", ...forumRoleOptions] as const;
const FORUM_SUSPENSION_MS = 7 * 24 * 60 * 60 * 1_000;
const profileFilters = [
  "all",
  "needs-attention",
  "complete",
  "auto-handle",
  "missing-contact",
  "missing-bio",
] as const;

type RoleFilter = (typeof roleFilters)[number];
type ForumRoleFilter = (typeof forumRoleFilters)[number];
type ProfileFilter = (typeof profileFilters)[number];
type UserSort = "joined-desc" | "joined-asc" | "role" | "name-asc";

export function AdminUsers() {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [forumRoleFilter, setForumRoleFilter] =
    useState<ForumRoleFilter>("all");
  const [profileFilter, setProfileFilter] = useState<ProfileFilter>("all");
  const [sort, setSort] = useState<UserSort>("joined-desc");
  const [pendingRoles, setPendingRoles] = useState<Record<string, UserRole>>(
    {},
  );
  const [pendingForumRoles, setPendingForumRoles] = useState<
    Record<string, ForumRole | "none">
  >({});
  const [pendingForumTrust, setPendingForumTrust] = useState<Record<string, boolean>>(
    {},
  );
  const [pendingForumStatus, setPendingForumStatus] = useState<
    Record<string, ForumAccountStatus>
  >({});
  const users = useQuery(convexRefs.admin.listUsers, {});
  const updateRole = useMutation(convexRefs.admin.updateUserRole);
  const updateForumRole = useMutation(convexRefs.admin.updateUserForumRole);
  const updateForumTrust = useMutation(convexRefs.admin.updateUserForumTrust);
  const updateForumStatus = useMutation(convexRefs.admin.updateUserForumStatus);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const allUsers = useMemo(() => users ?? [], [users]);

  const summary = useMemo(() => {
    return allUsers.reduce(
      (totals, user) => {
        const role = user.role ?? "reader";
        totals.total += 1;
        totals[role] += 1;
        if (isForumTrusted(user)) {
          totals.forumTrusted += 1;
        }
        if (user.forumRole === "moderator") {
          totals.forumModerators += 1;
        }
        if (user.forumRole === "admin") {
          totals.forumAdmins += 1;
        }
        if (getForumAccountStatus(user) === "suspended") {
          totals.forumSuspended += 1;
        }
        if (getForumAccountStatus(user) === "banned") {
          totals.forumBanned += 1;
        }
        if (profileNeedsAttention(user)) {
          totals.needsAttention += 1;
        }
        return totals;
      },
      {
        total: 0,
        owner: 0,
        admin: 0,
        reader: 0,
        forumTrusted: 0,
        forumModerators: 0,
        forumAdmins: 0,
        forumSuspended: 0,
        forumBanned: 0,
        needsAttention: 0,
      },
    );
  }, [allUsers]);

  const filteredUsers = useMemo(() => {
    return [...allUsers]
      .filter((user) => matchesQuery(user, deferredQuery))
      .filter((user) => {
        const role = user.role ?? "reader";
        return roleFilter === "all" ? true : role === roleFilter;
      })
      .filter((user) => {
        const forumRole = user.forumRole ?? "none";
        return forumRoleFilter === "all" ? true : forumRole === forumRoleFilter;
      })
      .filter((user) => matchesProfileFilter(user, profileFilter))
      .sort((left, right) => compareUsers(left, right, sort));
  }, [allUsers, deferredQuery, forumRoleFilter, profileFilter, roleFilter, sort]);

  async function setRole(user: AdminUserRecord, role: UserRole) {
    const currentRole = pendingRoles[user._id] ?? user.role ?? "reader";
    if (currentRole === role) {
      return;
    }

    setPendingRoles((current) => ({ ...current, [user._id]: role }));
    try {
      await updateRole({ userId: user._id, role });
      toast.success("Role updated");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-users",
        eventType: "role_update_failed",
        component: "AdminUsers",
        action: "admin:updateUserRole",
        entityType: "user",
        entityId: user._id,
        metadata: { role },
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Could not update role",
      );
    } finally {
      setPendingRoles((current) => {
        const next = { ...current };
        delete next[user._id];
        return next;
      });
    }
  }

  async function setForumTrust(user: AdminUserRecord, trusted: boolean) {
    const currentTrusted = pendingForumTrust[user._id] ?? isForumTrusted(user);
    if (currentTrusted === trusted) {
      return;
    }

    setPendingForumTrust((current) => ({ ...current, [user._id]: trusted }));
    try {
      await updateForumTrust({ userId: user._id, trusted });
      toast.success(trusted ? "Forum trust granted" : "Forum trust revoked");
    } catch (error) {
      reportAppError(error, {
        scope: "admin-users",
        eventType: "forum_trust_update_failed",
        component: "AdminUsers",
        action: "admin:updateUserForumTrust",
        entityType: "user",
        entityId: user._id,
        metadata: { trusted },
        notify: false,
      });
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update forum trust",
      );
    } finally {
      setPendingForumTrust((current) => {
        const next = { ...current };
        delete next[user._id];
        return next;
      });
    }
  }

  async function setForumRole(
    user: AdminUserRecord,
    forumRole: ForumRole | "none",
  ) {
    const currentRole =
      pendingForumRoles[user._id] ?? user.forumRole ?? "none";
    if (currentRole === forumRole) {
      return;
    }

    setPendingForumRoles((current) => ({ ...current, [user._id]: forumRole }));
    try {
      await updateForumRole({
        userId: user._id,
        forumRole: forumRole === "none" ? null : forumRole,
      });
      toast.success(
        forumRole === "none" ? "Forum staff cleared" : "Forum staff updated",
      );
    } catch (error) {
      reportAppError(error, {
        scope: "admin-users",
        eventType: "forum_role_update_failed",
        component: "AdminUsers",
        action: "admin:updateUserForumRole",
        entityType: "user",
        entityId: user._id,
        metadata: { forumRole },
        notify: false,
      });
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update forum staff role",
      );
    } finally {
      setPendingForumRoles((current) => {
        const next = { ...current };
        delete next[user._id];
        return next;
      });
    }
  }

  async function setForumStatus(
    user: AdminUserRecord,
    status: ForumAccountStatus,
  ) {
    const currentStatus = pendingForumStatus[user._id] ?? getForumAccountStatus(user);
    if (currentStatus === status) {
      return;
    }

    setPendingForumStatus((current) => ({ ...current, [user._id]: status }));
    try {
      await updateForumStatus({
        userId: user._id,
        status,
        ...(status === "suspended"
          ? {
              reason: "Owner dashboard suspension",
              suspendedUntil: Date.now() + FORUM_SUSPENSION_MS,
            }
          : {}),
        ...(status === "banned" ? { reason: "Owner dashboard ban" } : {}),
      });
      toast.success(
        status === "active"
          ? "Forum status cleared"
          : status === "suspended"
            ? "Forum user suspended"
            : "Forum user banned",
      );
    } catch (error) {
      reportAppError(error, {
        scope: "admin-users",
        eventType: "forum_status_update_failed",
        component: "AdminUsers",
        action: "admin:updateUserForumStatus",
        entityType: "user",
        entityId: user._id,
        metadata: { status },
        notify: false,
      });
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update forum status",
      );
    } finally {
      setPendingForumStatus((current) => {
        const next = { ...current };
        delete next[user._id];
        return next;
      });
    }
  }

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Users
          </p>
          <h2 className="mt-1 text-2xl font-semibold">Access control</h2>
        </div>
        <p className="font-mono text-[10px] uppercase text-muted-foreground">
          Owner gated / role based
        </p>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1.4fr)_11rem_11rem_13rem_11rem]">
        <label className="grid gap-2">
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            Search
          </span>
          <Input
            aria-label="Search users"
            className="h-9 rounded-none font-mono text-xs"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Handle, email, name, id"
            type="search"
            value={query}
          />
        </label>
        <LabeledSelect
          label="Role filter"
          onValueChange={(value) => setRoleFilter(value as RoleFilter)}
          value={roleFilter}
        >
          {roleFilters.map((option) => (
            <SelectItem
              key={option}
              value={option}
              className="rounded-none font-mono text-[10px] uppercase"
            >
              {option.replace("-", " ")}
            </SelectItem>
          ))}
        </LabeledSelect>
        <LabeledSelect
          label="Forum role"
          onValueChange={(value) =>
            setForumRoleFilter(value as ForumRoleFilter)
          }
          value={forumRoleFilter}
        >
          {forumRoleFilters.map((option) => (
            <SelectItem
              key={option}
              value={option}
              className="rounded-none font-mono text-[10px] uppercase"
            >
              {option.replace("-", " ")}
            </SelectItem>
          ))}
        </LabeledSelect>
        <LabeledSelect
          label="Profile filter"
          onValueChange={(value) => setProfileFilter(value as ProfileFilter)}
          value={profileFilter}
        >
          {profileFilters.map((option) => (
            <SelectItem
              key={option}
              value={option}
              className="rounded-none font-mono text-[10px] uppercase"
            >
              {option.replace("-", " ")}
            </SelectItem>
          ))}
        </LabeledSelect>
        <LabeledSelect
          label="Sort"
          onValueChange={(value) => setSort(value as UserSort)}
          value={sort}
        >
          <SelectItem
            value="joined-desc"
            className="rounded-none font-mono text-[10px] uppercase"
          >
            Newest first
          </SelectItem>
          <SelectItem
            value="joined-asc"
            className="rounded-none font-mono text-[10px] uppercase"
          >
            Oldest first
          </SelectItem>
          <SelectItem
            value="role"
            className="rounded-none font-mono text-[10px] uppercase"
          >
            Role priority
          </SelectItem>
          <SelectItem
            value="name-asc"
            className="rounded-none font-mono text-[10px] uppercase"
          >
            Handle A-Z
          </SelectItem>
        </LabeledSelect>
      </div>

      <div className="mt-4 grid gap-3 font-mono text-[10px] uppercase text-muted-foreground md:grid-cols-7">
        <Metric label="Total" value={summary.total} />
        <Metric
          label="Owners / Admins"
          value={`${summary.owner} / ${summary.admin}`}
        />
        <Metric label="Readers" value={summary.reader} />
        <Metric
          label="Forum staff"
          value={`${summary.forumModerators} / ${summary.forumAdmins}`}
        />
        <Metric label="Forum trusted" value={summary.forumTrusted} />
        <Metric
          label="Forum limited"
          value={`${summary.forumSuspended} / ${summary.forumBanned}`}
        />
        <Metric label="Needs attention" value={summary.needsAttention} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase text-muted-foreground">
        <p>
          {users === undefined
            ? "Loading directory"
            : `${filteredUsers.length} of ${summary.total} users in view`}
        </p>
        {(query ||
          roleFilter !== "all" ||
          forumRoleFilter !== "all" ||
          profileFilter !== "all" ||
          sort !== "joined-desc") &&
        users !== undefined ? (
          <Button
            className="h-7 rounded-none px-2 font-mono text-[10px] uppercase"
            onClick={() => {
              setQuery("");
              setRoleFilter("all");
              setForumRoleFilter("all");
              setProfileFilter("all");
              setSort("joined-desc");
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Reset view
          </Button>
        ) : null}
      </div>

      <div className="mt-5 grid gap-1">
        {filteredUsers.map((user) => (
          <UserRow
            key={user._id}
            pending={
              Boolean(pendingRoles[user._id]) ||
              Boolean(pendingForumRoles[user._id]) ||
              Object.prototype.hasOwnProperty.call(pendingForumTrust, user._id) ||
              Object.prototype.hasOwnProperty.call(pendingForumStatus, user._id)
            }
            role={pendingRoles[user._id] ?? user.role ?? "reader"}
            forumRole={pendingForumRoles[user._id] ?? user.forumRole ?? "none"}
            forumStatus={
              pendingForumStatus[user._id] ?? getForumAccountStatus(user)
            }
            forumTrusted={
              pendingForumTrust[user._id] ?? isForumTrusted(user)
            }
            user={user}
            onForumRoleChange={(forumRole) => setForumRole(user, forumRole)}
            onForumStatusChange={(status) => setForumStatus(user, status)}
            onForumTrustChange={(trusted) => setForumTrust(user, trusted)}
            onRoleChange={(role) => setRole(user, role)}
          />
        ))}
        {users === undefined ? <StatusLine>Loading users</StatusLine> : null}
        {users?.length === 0 ? <StatusLine>No users found</StatusLine> : null}
        {users !== undefined &&
        users.length > 0 &&
        filteredUsers.length === 0 ? (
          <StatusLine>No users match the current filters</StatusLine>
        ) : null}
      </div>
    </section>
  );
}

function UserRow({
  forumRole,
  forumStatus,
  forumTrusted,
  onForumRoleChange,
  onForumStatusChange,
  onForumTrustChange,
  pending,
  role,
  user,
  onRoleChange,
}: {
  forumRole: ForumRole | "none";
  forumStatus: ForumAccountStatus;
  forumTrusted: boolean;
  onForumRoleChange: (forumRole: ForumRole | "none") => void;
  onForumStatusChange: (status: ForumAccountStatus) => void;
  onForumTrustChange: (trusted: boolean) => void;
  pending: boolean;
  role: UserRole;
  user: AdminUserRecord;
  onRoleChange: (role: UserRole) => void;
}) {
  const handle =
    user.usernameNormalized ?? user.username ?? user.name ?? user._id;
  const publicHandle = user.usernameNormalized ?? user.username ?? null;
  const contactEmail = user.contactEmail ?? user.email ?? null;
  const signals = getProfileSignals(user);
  const legacyForumAdmin = role === "owner" || role === "admin";
  const staffTrusted = legacyForumAdmin || forumRole !== "none";

  return (
    <article
      aria-busy={pending}
      className={cn(
        "grid gap-3 border-t border-border/70 py-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_12rem]",
        pending ? "opacity-70" : null,
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="truncate text-base font-semibold">
            {user.username ?? user.name ?? handle}
          </p>
          <RoleBadge role={role} />
          <ForumRoleBadge forumRole={forumRole} legacy={legacyForumAdmin} />
          <Badge
            variant={forumTrusted ? "default" : "outline"}
            className={cn(
              "rounded-none font-mono text-[10px] uppercase",
              forumTrusted ? null : "text-muted-foreground",
            )}
          >
            {forumTrusted ? "Forum trusted" : "Forum gated"}
          </Badge>
          <ForumStatusBadge status={forumStatus} />
          {pending ? (
            <Badge
              variant="outline"
              className="rounded-none font-mono text-[10px] uppercase text-muted-foreground"
            >
              Updating
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 truncate font-mono text-[10px] uppercase text-muted-foreground">
          {publicHandle ? `/u/${publicHandle}` : "No public handle"}
        </p>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {contactEmail ?? "No contact email"}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {signals.map((signal) => (
            <Badge
              key={signal.label}
              variant={signal.variant}
              className={cn(
                "rounded-none font-mono text-[10px] uppercase",
                signal.dim ? "text-muted-foreground" : null,
              )}
            >
              {signal.label}
            </Badge>
          ))}
        </div>
      </div>
      <div className="grid gap-2 font-mono text-[10px] uppercase text-muted-foreground">
        <p>Joined {formatDate(user.onboardedAt ?? user._creationTime)}</p>
        {user.roleAssignedAt ? (
          <p>Role set {formatDate(user.roleAssignedAt)}</p>
        ) : (
          <p>Role timestamp unavailable</p>
        )}
        {legacyForumAdmin ? (
          <p>Forum admin via site role</p>
        ) : forumRole !== "none" && user.forumRoleAssignedAt ? (
          <p>Forum role set {formatDate(user.forumRoleAssignedAt)}</p>
        ) : (
          <p>No forum staff role</p>
        )}
        {forumTrusted && user.forumTrustedAt ? (
          <p>Forum trusted {formatDate(user.forumTrustedAt)}</p>
        ) : user.forumTrustRevokedAt ? (
          <p>Forum revoked {formatDate(user.forumTrustRevokedAt)}</p>
        ) : (
          <p>Forum trust not granted</p>
        )}
        {forumStatus === "suspended" && user.forumSuspendedUntil ? (
          <p>Suspended until {formatDate(user.forumSuspendedUntil)}</p>
        ) : forumStatus === "banned" && user.forumBannedAt ? (
          <p>Banned {formatDate(user.forumBannedAt)}</p>
        ) : (
          <p>Forum account active</p>
        )}
        {user.forumSuspendedReason || user.forumBannedReason ? (
          <p className="line-clamp-1 normal-case">
            {user.forumSuspendedReason ?? user.forumBannedReason}
          </p>
        ) : null}
        {user.bio?.trim() ? (
          <p className="line-clamp-2 normal-case text-sm">{user.bio.trim()}</p>
        ) : (
          <p>No bio saved</p>
        )}
      </div>
      <div className="flex items-center gap-2 md:justify-end md:self-start">
        <Select
          disabled={pending}
          value={role}
          onValueChange={(value) => onRoleChange(value as UserRole)}
        >
          <SelectTrigger
            aria-label={`Set role for ${user.username ?? user.name ?? handle}`}
            className="h-8 rounded-none font-mono text-[10px] uppercase"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles.map((nextRole) => (
              <SelectItem
                key={nextRole}
                value={nextRole}
                className="rounded-none font-mono text-[10px] uppercase"
              >
                {nextRole}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          disabled={pending}
          value={forumRole}
          onValueChange={(value) =>
            onForumRoleChange(value as ForumRole | "none")
          }
        >
          <SelectTrigger
            aria-label={`Set forum role for ${
              user.username ?? user.name ?? handle
            }`}
            className="h-8 rounded-none font-mono text-[10px] uppercase"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {forumRoleOptions.map((option) => (
              <SelectItem
                key={option}
                value={option}
                disabled={legacyForumAdmin && option !== "none"}
                className="rounded-none font-mono text-[10px] uppercase"
              >
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          disabled={pending || staffTrusted}
          size="sm"
          type="button"
          variant="outline"
          onClick={() => onForumTrustChange(!forumTrusted)}
        >
          {staffTrusted
            ? "Staff trusted"
            : forumTrusted
              ? "Revoke forum"
              : "Trust forum"}
        </Button>
        {forumStatus === "active" ? (
          <Button
            disabled={pending || legacyForumAdmin}
            size="sm"
            type="button"
            variant="outline"
            onClick={() => onForumStatusChange("suspended")}
          >
            Suspend 7d
          </Button>
        ) : (
          <Button
            disabled={pending || legacyForumAdmin}
            size="sm"
            type="button"
            variant="outline"
            onClick={() => onForumStatusChange("active")}
          >
            Clear forum
          </Button>
        )}
        {forumStatus !== "banned" ? (
          <Button
            disabled={pending || legacyForumAdmin}
            size="sm"
            type="button"
            variant="outline"
            onClick={() => onForumStatusChange("banned")}
          >
            Ban
          </Button>
        ) : null}
        {publicHandle ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/u/${publicHandle}`} prefetch>
              View
            </Link>
          </Button>
        ) : (
          <Button disabled size="sm" variant="outline">
            View
          </Button>
        )}
      </div>
    </article>
  );
}

function LabeledSelect({
  children,
  label,
  onValueChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="grid gap-2">
      <span className="font-mono text-[10px] uppercase text-muted-foreground">
        {label}
      </span>
      <Select onValueChange={onValueChange} value={value}>
        <SelectTrigger
          aria-label={label}
          className="h-9 rounded-none font-mono text-[10px] uppercase"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
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

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <Badge
      variant={role === "owner" ? "default" : "outline"}
      className={cn(
        "rounded-none font-mono text-[10px] uppercase",
        role === "reader" ? "text-muted-foreground" : null,
      )}
    >
      {role}
    </Badge>
  );
}

function ForumRoleBadge({
  forumRole,
  legacy,
}: {
  forumRole: ForumRole | "none";
  legacy: boolean;
}) {
  if (legacy) {
    return (
      <Badge className="rounded-none font-mono text-[10px] uppercase">
        Forum admin
      </Badge>
    );
  }
  if (forumRole === "none") {
    return null;
  }

  return (
    <Badge
      variant={forumRole === "admin" ? "default" : "outline"}
      className="rounded-none font-mono text-[10px] uppercase"
    >
      Forum {forumRole}
    </Badge>
  );
}

function ForumStatusBadge({ status }: { status: ForumAccountStatus }) {
  if (status === "active") {
    return null;
  }

  return (
    <Badge
      variant={status === "banned" ? "destructive" : "secondary"}
      className="rounded-none font-mono text-[10px] uppercase"
    >
      {status === "banned" ? "Forum banned" : "Forum suspended"}
    </Badge>
  );
}

function StatusLine({ children }: { children: ReactNode }) {
  return (
    <p className="py-3 font-mono text-xs uppercase text-muted-foreground">
      {children}
    </p>
  );
}

function getProfileSignals(user: AdminUserRecord) {
  const hasBio = Boolean(user.bio?.trim());
  const hasContact = Boolean((user.contactEmail ?? user.email)?.trim());
  return [
    {
      label: user.usernameSource === "auto" ? "Random SYM" : "Chosen handle",
      variant: "outline" as const,
      dim: user.usernameSource === "auto",
    },
    {
      label: hasContact ? "Contact ready" : "No contact",
      variant: hasContact ? ("outline" as const) : ("secondary" as const),
      dim: !hasContact,
    },
    {
      label: hasBio ? "Bio saved" : "No bio",
      variant: hasBio ? ("outline" as const) : ("secondary" as const),
      dim: !hasBio,
    },
  ];
}

function profileNeedsAttention(user: AdminUserRecord) {
  return (
    user.usernameSource === "auto" ||
    !(user.contactEmail ?? user.email)?.trim() ||
    !user.bio?.trim()
  );
}

function isForumTrusted(user: AdminUserRecord) {
  if (user.role === "owner" || user.role === "admin") {
    return true;
  }
  if (getForumAccountStatus(user) !== "active") {
    return false;
  }
  if (user.forumRole === "moderator" || user.forumRole === "admin") {
    return true;
  }
  return user.forumTrustedAt !== undefined && user.forumTrustRevokedAt === undefined;
}

function getForumAccountStatus(user: AdminUserRecord): ForumAccountStatus {
  if (user.forumBannedAt !== undefined) {
    return "banned";
  }
  if (
    user.forumSuspendedUntil !== undefined &&
    user.forumSuspendedUntil > Date.now()
  ) {
    return "suspended";
  }
  return "active";
}

function matchesQuery(user: AdminUserRecord, query: string) {
  if (!query) {
    return true;
  }

  return [
    user.username,
    user.usernameNormalized,
    user.name,
    user.forumRole,
    user.contactEmail,
    user.email,
    user._id,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(query));
}

function matchesProfileFilter(user: AdminUserRecord, filter: ProfileFilter) {
  const hasBio = Boolean(user.bio?.trim());
  const hasContact = Boolean((user.contactEmail ?? user.email)?.trim());

  switch (filter) {
    case "all":
      return true;
    case "needs-attention":
      return profileNeedsAttention(user);
    case "complete":
      return !profileNeedsAttention(user);
    case "auto-handle":
      return user.usernameSource === "auto";
    case "missing-contact":
      return !hasContact;
    case "missing-bio":
      return !hasBio;
    default:
      return true;
  }
}

function compareUsers(
  left: AdminUserRecord,
  right: AdminUserRecord,
  sort: UserSort,
) {
  switch (sort) {
    case "joined-asc":
      return getJoinedAt(left) - getJoinedAt(right);
    case "role":
      return (
        rolePriority(left.role ?? "reader") -
          rolePriority(right.role ?? "reader") || compareHandles(left, right)
      );
    case "name-asc":
      return compareHandles(left, right);
    case "joined-desc":
    default:
      return getJoinedAt(right) - getJoinedAt(left);
  }
}

function compareHandles(left: AdminUserRecord, right: AdminUserRecord) {
  return getSortableHandle(left).localeCompare(getSortableHandle(right));
}

function getSortableHandle(user: AdminUserRecord) {
  return (
    user.usernameNormalized ??
    user.username ??
    user.name ??
    user._id
  ).toLowerCase();
}

function getJoinedAt(user: AdminUserRecord) {
  return user.onboardedAt ?? user._creationTime;
}

function rolePriority(role: UserRole) {
  switch (role) {
    case "owner":
      return 0;
    case "admin":
      return 1;
    case "reader":
    default:
      return 2;
  }
}
