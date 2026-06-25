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
  type UserRole,
} from "@/lib/convex-refs";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

const roles: UserRole[] = ["owner", "admin", "reader"];
const roleFilters = ["all", ...roles] as const;
const profileFilters = [
  "all",
  "needs-attention",
  "complete",
  "auto-handle",
  "missing-contact",
  "missing-bio",
] as const;

type RoleFilter = (typeof roleFilters)[number];
type ProfileFilter = (typeof profileFilters)[number];
type UserSort = "joined-desc" | "joined-asc" | "role" | "name-asc";

export function AdminUsers() {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [profileFilter, setProfileFilter] = useState<ProfileFilter>("all");
  const [sort, setSort] = useState<UserSort>("joined-desc");
  const [pendingRoles, setPendingRoles] = useState<Record<string, UserRole>>(
    {},
  );
  const users = useQuery(convexRefs.admin.listUsers, {});
  const updateRole = useMutation(convexRefs.admin.updateUserRole);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const allUsers = useMemo(() => users ?? [], [users]);

  const summary = useMemo(() => {
    return allUsers.reduce(
      (totals, user) => {
        const role = user.role ?? "reader";
        totals.total += 1;
        totals[role] += 1;
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
      .filter((user) => matchesProfileFilter(user, profileFilter))
      .sort((left, right) => compareUsers(left, right, sort));
  }, [allUsers, deferredQuery, profileFilter, roleFilter, sort]);

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

      <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1.4fr)_11rem_13rem_11rem]">
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

      <div className="mt-4 grid gap-3 font-mono text-[10px] uppercase text-muted-foreground md:grid-cols-4">
        <Metric label="Total" value={summary.total} />
        <Metric
          label="Owners / Admins"
          value={`${summary.owner} / ${summary.admin}`}
        />
        <Metric label="Readers" value={summary.reader} />
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
          profileFilter !== "all" ||
          sort !== "joined-desc") &&
        users !== undefined ? (
          <Button
            className="h-7 rounded-none px-2 font-mono text-[10px] uppercase"
            onClick={() => {
              setQuery("");
              setRoleFilter("all");
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
            pending={Boolean(pendingRoles[user._id])}
            role={pendingRoles[user._id] ?? user.role ?? "reader"}
            user={user}
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
  pending,
  role,
  user,
  onRoleChange,
}: {
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
        {publicHandle ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/u/${publicHandle}`}>View</Link>
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

function matchesQuery(user: AdminUserRecord, query: string) {
  if (!query) {
    return true;
  }

  return [
    user.username,
    user.usernameNormalized,
    user.name,
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
