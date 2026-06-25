"use client";

import { reportAppError } from "@/components/app-error-surface";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { convexRefs, type AdminUserRecord, type UserRole } from "@/lib/convex-refs";
import { formatDate } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { toast } from "sonner";

const roles: UserRole[] = ["owner", "admin", "reader"];

export function AdminUsers() {
  const users = useQuery(convexRefs.admin.listUsers, {});
  const updateRole = useMutation(convexRefs.admin.updateUserRole);

  async function setRole(user: AdminUserRecord, role: UserRole) {
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
      toast.error(error instanceof Error ? error.message : "Could not update role");
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

      <div className="mt-5 grid gap-1">
        {(users ?? []).map((user) => (
          <UserRow
            key={user._id}
            user={user}
            onRoleChange={(role) => setRole(user, role)}
          />
        ))}
        {users === undefined ? <StatusLine>Loading users</StatusLine> : null}
        {users?.length === 0 ? <StatusLine>No users found</StatusLine> : null}
      </div>
    </section>
  );
}

function UserRow({
  user,
  onRoleChange,
}: {
  user: AdminUserRecord;
  onRoleChange: (role: UserRole) => void;
}) {
  const handle = user.usernameNormalized ?? user.username ?? user.name ?? user._id;
  const role = user.role ?? "reader";

  return (
    <article className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_13rem_9rem] md:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <p className="truncate text-base font-semibold">{user.username ?? handle}</p>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            {user.usernameSource ?? "profile"}
          </p>
        </div>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {user.contactEmail ?? user.email ?? "No contact email"}
        </p>
      </div>
      <div className="font-mono text-[10px] uppercase text-muted-foreground">
        <p>Joined {formatDate(user.onboardedAt ?? user._creationTime)}</p>
        {user.roleAssignedAt ? (
          <p>Role set {formatDate(user.roleAssignedAt)}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2 md:justify-end">
        <Select value={role} onValueChange={(value) => onRoleChange(value as UserRole)}>
          <SelectTrigger className="h-8 rounded-none font-mono text-[10px] uppercase">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles.map((nextRole) => (
              <SelectItem key={nextRole} value={nextRole}>
                {nextRole}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button asChild size="sm" variant="outline">
          <Link href={`/u/${handle}`}>View</Link>
        </Button>
      </div>
    </article>
  );
}

function StatusLine({ children }: { children: ReactNode }) {
  return (
    <p className="py-3 font-mono text-xs uppercase text-muted-foreground">
      {children}
    </p>
  );
}
