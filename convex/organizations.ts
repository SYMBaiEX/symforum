import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  agentScopeValidator,
  isActiveAgentUser,
  requireAgentScope,
  requireAuthenticatedUser,
  type AgentScope,
} from "./authz";

const MAX_ORGANIZATIONS_PER_USER = 20;
const MAX_MEMBERS_PER_ORGANIZATION = 200;
const MAX_PENDING_INVITES_PER_ORGANIZATION = 100;
const MAX_PROJECTS_PER_ORGANIZATION = 100;
const MAX_SERVICE_ACCOUNTS_PER_ORGANIZATION = 100;
const MAX_SERVICE_ACCOUNTS_PER_PROJECT = 100;
const MAX_AUDIT_RESULTS = 200;
const MAX_USAGE_RESULTS = 200;
const MAX_BUDGET_MICROS = 100_000_000_000;
const MAX_CHARGE_MICROS = 1_000_000_000;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export const organizationRoleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("developer"),
  v.literal("auditor"),
);
const inviteRoleValidator = v.union(
  v.literal("admin"),
  v.literal("developer"),
  v.literal("auditor"),
);

type OrganizationRole = Doc<"organizationMembers">["role"];
type DatabaseCtx = QueryCtx | MutationCtx;
type HumanActor = Doc<"users"> & { isAgent?: false | undefined };

type AuditEvent =
  | "organization_created"
  | "member_invited"
  | "invite_accepted"
  | "invite_revoked"
  | "member_role_changed"
  | "owner_transferred"
  | "member_removed"
  | "project_created"
  | "project_scopes_changed"
  | "service_account_created"
  | "service_account_revoked"
  | "budget_changed";

function organizationError(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

function cleanName(value: string, field: string, maximum: number) {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (
    cleaned.length < 2 ||
    cleaned.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(cleaned)
  ) {
    organizationError(
      "INVALID_ORGANIZATION_VALUE",
      `${field} must be between 2 and ${maximum} printable characters.`,
    );
  }
  return cleaned;
}

function identifier(value: string, field: string, maximum: number) {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < 2 ||
    normalized.length > maximum ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(normalized)
  ) {
    organizationError(
      "INVALID_ORGANIZATION_VALUE",
      `${field} must be a bounded lowercase identifier.`,
    );
  }
  return normalized;
}

function idempotencyKey(value: string) {
  const normalized = value.trim();
  if (
    normalized.length < 8 ||
    normalized.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)
  ) {
    organizationError(
      "INVALID_IDEMPOTENCY_KEY",
      "idempotencyKey must be 8-128 URL-safe characters.",
    );
  }
  return normalized;
}

function boundedInteger(
  value: number,
  field: string,
  minimum: number,
  maximum: number,
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    organizationError(
      "INVALID_ORGANIZATION_AMOUNT",
      `${field} must be a safe integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function resultLimit(value: number | undefined, maximum: number) {
  if (value === undefined) return Math.min(50, maximum);
  if (!Number.isSafeInteger(value) || value < 1) {
    organizationError(
      "INVALID_RESULT_LIMIT",
      "limit must be a positive integer.",
    );
  }
  return Math.min(value, maximum);
}

function currentUtcMonthKey(now: number) {
  const date = new Date(now);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function validatedMonthKey(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    organizationError(
      "INVALID_MONTH_KEY",
      "monthKey must use the YYYY-MM UTC format.",
    );
  }
  return value;
}

function normalizeScopes(scopes: AgentScope[], requireOne = false) {
  const unique = [...new Set(scopes)];
  if (unique.length !== scopes.length) {
    organizationError(
      "DUPLICATE_AGENT_SCOPE",
      "Agent scopes must not contain duplicates.",
    );
  }
  if (requireOne && unique.length === 0) {
    organizationError(
      "AGENT_SCOPE_REQUIRED",
      "At least one agent scope is required.",
    );
  }
  return unique;
}

function scopesAreSubset(scopes: AgentScope[], allowed: AgentScope[]) {
  return scopes.every((scope) => allowed.includes(scope));
}

async function requireHumanActor(ctx: DatabaseCtx): Promise<HumanActor> {
  const actor = await requireAuthenticatedUser(ctx);
  if (actor.isAgent === true) {
    organizationError(
      "HUMAN_ACCOUNT_REQUIRED",
      "A human account is required to manage an organization.",
    );
  }
  return actor as HumanActor;
}

async function requireOrganizationMember(
  ctx: DatabaseCtx,
  organizationId: Id<"organizations">,
) {
  const actor = await requireHumanActor(ctx);
  const [organization, membership] = await Promise.all([
    ctx.db.get("organizations", organizationId),
    ctx.db
      .query("organizationMembers")
      .withIndex("by_organizationId_and_userId", (q) =>
        q.eq("organizationId", organizationId).eq("userId", actor._id),
      )
      .unique(),
  ]);
  if (
    organization === null ||
    organization.status !== "active" ||
    membership === null ||
    membership.status !== "active"
  ) {
    organizationError("ORGANIZATION_NOT_FOUND", "Organization was not found.");
  }
  return { actor, organization, membership };
}

async function requireOrganizationAdmin(
  ctx: DatabaseCtx,
  organizationId: Id<"organizations">,
) {
  const access = await requireOrganizationMember(ctx, organizationId);
  if (
    access.membership.role !== "owner" &&
    access.membership.role !== "admin"
  ) {
    organizationError(
      "ORGANIZATION_ADMIN_REQUIRED",
      "Organization administrator access is required.",
    );
  }
  return access;
}

async function requireSoleOwner(
  ctx: DatabaseCtx,
  organizationId: Id<"organizations">,
) {
  const access = await requireOrganizationMember(ctx, organizationId);
  const owners = await ctx.db
    .query("organizationMembers")
    .withIndex("by_organizationId_and_status_and_role", (q) =>
      q
        .eq("organizationId", organizationId)
        .eq("status", "active")
        .eq("role", "owner"),
    )
    .take(2);
  if (
    access.membership.role !== "owner" ||
    owners.length !== 1 ||
    owners[0]._id !== access.membership._id
  ) {
    organizationError(
      "ORGANIZATION_OWNER_INVARIANT",
      "The organization must have exactly one active owner.",
    );
  }
  return access;
}

async function appendAudit(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    eventType: AuditEvent;
    actorUserId: Id<"users">;
    targetUserId?: Id<"users">;
    projectId?: Id<"organizationProjects">;
    serviceAccountId?: Id<"organizationServiceAccounts">;
    previousRole?: OrganizationRole;
    nextRole?: OrganizationRole;
    previousAmountMicros?: number;
    nextAmountMicros?: number;
    createdAt: number;
  },
) {
  await ctx.db.insert("organizationAuditRecords", {
    ...args,
    actorKind: "human",
  });
}

function safeOrganization(
  organization: Doc<"organizations">,
  membership: Doc<"organizationMembers">,
) {
  return {
    organizationId: organization._id,
    slug: organization.slug,
    name: organization.name,
    status: organization.status,
    role: membership.role,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

/** Lists only organizations where the server-derived human principal is active. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireHumanActor(ctx);
    const memberships = await ctx.db
      .query("organizationMembers")
      .withIndex("by_userId_and_status", (q) =>
        q.eq("userId", actor._id).eq("status", "active"),
      )
      .take(MAX_ORGANIZATIONS_PER_USER);
    const organizations = await Promise.all(
      memberships.map(async (membership) => {
        const organization = await ctx.db.get(
          "organizations",
          membership.organizationId,
        );
        if (organization?.status !== "active") return null;
        return safeOrganization(organization, membership);
      }),
    );
    return organizations.filter((row) => row !== null);
  },
});

export const get = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await requireOrganizationMember(ctx, args.organizationId);
    return safeOrganization(access.organization, access.membership);
  },
});

export const create = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    monthlyBudgetMicros: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireHumanActor(ctx);
    const slug = identifier(args.slug, "slug", 64);
    const name = cleanName(args.name, "name", 120);
    const monthlyBudgetMicros = boundedInteger(
      args.monthlyBudgetMicros ?? 0,
      "monthlyBudgetMicros",
      0,
      MAX_BUDGET_MICROS,
    );
    const [existing, memberships] = await Promise.all([
      ctx.db
        .query("organizations")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique(),
      ctx.db
        .query("organizationMembers")
        .withIndex("by_userId_and_status", (q) =>
          q.eq("userId", actor._id).eq("status", "active"),
        )
        .take(MAX_ORGANIZATIONS_PER_USER + 1),
    ]);
    if (existing !== null) {
      organizationError(
        "ORGANIZATION_SLUG_IN_USE",
        "Organization slug is already in use.",
      );
    }
    if (memberships.length >= MAX_ORGANIZATIONS_PER_USER) {
      organizationError(
        "ORGANIZATION_LIMIT",
        `A user may belong to at most ${MAX_ORGANIZATIONS_PER_USER} organizations.`,
      );
    }
    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", {
      slug,
      name,
      status: "active",
      createdByUserId: actor._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("organizationMembers", {
      organizationId,
      userId: actor._id,
      role: "owner",
      status: "active",
      joinedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("organizationBudgets", {
      organizationId,
      monthKey: currentUtcMonthKey(now),
      currency: "USD",
      limitMicros: monthlyBudgetMicros,
      spentMicros: 0,
      createdByUserId: actor._id,
      updatedByUserId: actor._id,
      createdAt: now,
      updatedAt: now,
    });
    await appendAudit(ctx, {
      organizationId,
      eventType: "organization_created",
      actorUserId: actor._id,
      createdAt: now,
    });
    await appendAudit(ctx, {
      organizationId,
      eventType: "budget_changed",
      actorUserId: actor._id,
      previousAmountMicros: 0,
      nextAmountMicros: monthlyBudgetMicros,
      createdAt: now,
    });
    return { organizationId, slug, role: "owner" as const };
  },
});

export const listMembers = query({
  args: {
    organizationId: v.id("organizations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOrganizationMember(ctx, args.organizationId);
    const members = await ctx.db
      .query("organizationMembers")
      .withIndex("by_organizationId_and_status_and_role", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "active"),
      )
      .take(resultLimit(args.limit, MAX_MEMBERS_PER_ORGANIZATION));
    return await Promise.all(
      members.map(async (membership) => {
        const user = await ctx.db.get("users", membership.userId);
        return {
          membershipId: membership._id,
          userId: membership.userId,
          name: user?.name ?? user?.username ?? "Member",
          role: membership.role,
          joinedAt: membership.joinedAt,
        };
      }),
    );
  },
});

export const listInvites = query({
  args: {
    organizationId: v.id("organizations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOrganizationAdmin(ctx, args.organizationId);
    const invites = await ctx.db
      .query("organizationInvites")
      .withIndex("by_organizationId_and_status_and_createdAt", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "pending"),
      )
      .order("desc")
      .take(resultLimit(args.limit, MAX_PENDING_INVITES_PER_ORGANIZATION));
    const rows = await Promise.all(
      invites.map(async (invite) => {
        const invitee = await ctx.db.get("users", invite.inviteeUserId);
        return {
          inviteId: invite._id,
          inviteeUserId: invite.inviteeUserId,
          inviteeName: invitee?.name ?? invitee?.username ?? "Member",
          role: invite.role,
          createdAt: invite.createdAt,
          expiresAt: invite.expiresAt,
        };
      }),
    );
    return rows;
  },
});

/** Lists only invites addressed to the server-derived human principal. */
export const listMyPendingInvites = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireHumanActor(ctx);
    const invites = await ctx.db
      .query("organizationInvites")
      .withIndex("by_inviteeUserId_and_status_and_expiresAt", (q) =>
        q.eq("inviteeUserId", actor._id).eq("status", "pending"),
      )
      .take(resultLimit(args.limit, MAX_ORGANIZATIONS_PER_USER));
    const rows = await Promise.all(
      invites.map(async (invite) => {
        const organization = await ctx.db.get(
          "organizations",
          invite.organizationId,
        );
        if (organization?.status !== "active") return null;
        return {
          inviteId: invite._id,
          organizationId: organization._id,
          organizationSlug: organization.slug,
          organizationName: organization.name,
          role: invite.role,
          createdAt: invite.createdAt,
          expiresAt: invite.expiresAt,
        };
      }),
    );
    return rows.filter((row) => row !== null);
  },
});

export const inviteMember = mutation({
  args: {
    organizationId: v.id("organizations"),
    inviteeUserId: v.id("users"),
    role: inviteRoleValidator,
  },
  handler: async (ctx, args) => {
    const access = await requireOrganizationAdmin(ctx, args.organizationId);
    if (args.role === "admin" && access.membership.role !== "owner") {
      organizationError(
        "ORGANIZATION_OWNER_REQUIRED",
        "Only the organization owner may invite an administrator.",
      );
    }
    const [invitee, existingMembership, existingInvite, pendingInvites] =
      await Promise.all([
        ctx.db.get("users", args.inviteeUserId),
        ctx.db
          .query("organizationMembers")
          .withIndex("by_organizationId_and_userId", (q) =>
            q
              .eq("organizationId", args.organizationId)
              .eq("userId", args.inviteeUserId),
          )
          .unique(),
        ctx.db
          .query("organizationInvites")
          .withIndex("by_organizationId_and_inviteeUserId_and_status", (q) =>
            q
              .eq("organizationId", args.organizationId)
              .eq("inviteeUserId", args.inviteeUserId)
              .eq("status", "pending"),
          )
          .unique(),
        ctx.db
          .query("organizationInvites")
          .withIndex("by_organizationId_and_status_and_createdAt", (q) =>
            q.eq("organizationId", args.organizationId).eq("status", "pending"),
          )
          .take(MAX_PENDING_INVITES_PER_ORGANIZATION + 1),
      ]);
    if (invitee === null || invitee.isAgent === true) {
      organizationError(
        "INVITEE_NOT_FOUND",
        "Only an existing human account may be invited.",
      );
    }
    if (existingMembership?.status === "active") {
      organizationError(
        "ORGANIZATION_MEMBER_EXISTS",
        "This user is already an organization member.",
      );
    }
    const now = Date.now();
    if (existingInvite !== null && existingInvite.expiresAt > now) {
      if (existingInvite.role !== args.role) {
        organizationError(
          "ORGANIZATION_INVITE_EXISTS",
          "A pending invite already exists for this user.",
        );
      }
      return {
        inviteId: existingInvite._id,
        expiresAt: existingInvite.expiresAt,
      };
    }
    if (existingInvite !== null) {
      await ctx.db.patch("organizationInvites", existingInvite._id, {
        status: "revoked",
        revokedAt: now,
        revokedByUserId: access.actor._id,
      });
      await appendAudit(ctx, {
        organizationId: args.organizationId,
        eventType: "invite_revoked",
        actorUserId: access.actor._id,
        targetUserId: existingInvite.inviteeUserId,
        previousRole: existingInvite.role,
        createdAt: now,
      });
    } else if (pendingInvites.length >= MAX_PENDING_INVITES_PER_ORGANIZATION) {
      organizationError(
        "ORGANIZATION_INVITE_LIMIT",
        `An organization may have at most ${MAX_PENDING_INVITES_PER_ORGANIZATION} pending invites.`,
      );
    }
    const inviteId = await ctx.db.insert("organizationInvites", {
      organizationId: args.organizationId,
      inviteeUserId: args.inviteeUserId,
      role: args.role,
      status: "pending",
      createdByUserId: access.actor._id,
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
    });
    await appendAudit(ctx, {
      organizationId: args.organizationId,
      eventType: "member_invited",
      actorUserId: access.actor._id,
      targetUserId: args.inviteeUserId,
      nextRole: args.role,
      createdAt: now,
    });
    return { inviteId, expiresAt: now + INVITE_TTL_MS };
  },
});

export const acceptInvite = mutation({
  args: { inviteId: v.id("organizationInvites") },
  handler: async (ctx, args) => {
    const actor = await requireHumanActor(ctx);
    const invite = await ctx.db.get("organizationInvites", args.inviteId);
    if (
      invite === null ||
      invite.status !== "pending" ||
      invite.inviteeUserId !== actor._id
    ) {
      organizationError("INVITE_NOT_FOUND", "Invite was not found.");
    }
    const organization = await ctx.db.get(
      "organizations",
      invite.organizationId,
    );
    const now = Date.now();
    if (organization?.status !== "active" || invite.expiresAt <= now) {
      organizationError("INVITE_NOT_FOUND", "Invite was not found.");
    }
    const [existingMembership, members, actorMemberships] = await Promise.all([
      ctx.db
        .query("organizationMembers")
        .withIndex("by_organizationId_and_userId", (q) =>
          q.eq("organizationId", invite.organizationId).eq("userId", actor._id),
        )
        .unique(),
      ctx.db
        .query("organizationMembers")
        .withIndex("by_organizationId_and_status_and_role", (q) =>
          q.eq("organizationId", invite.organizationId).eq("status", "active"),
        )
        .take(MAX_MEMBERS_PER_ORGANIZATION + 1),
      ctx.db
        .query("organizationMembers")
        .withIndex("by_userId_and_status", (q) =>
          q.eq("userId", actor._id).eq("status", "active"),
        )
        .take(MAX_ORGANIZATIONS_PER_USER + 1),
    ]);
    if (existingMembership?.status === "active") {
      organizationError(
        "ORGANIZATION_MEMBER_EXISTS",
        "This account is already a member.",
      );
    }
    if (members.length >= MAX_MEMBERS_PER_ORGANIZATION) {
      organizationError(
        "ORGANIZATION_MEMBER_LIMIT",
        `An organization may have at most ${MAX_MEMBERS_PER_ORGANIZATION} active members.`,
      );
    }
    if (actorMemberships.length >= MAX_ORGANIZATIONS_PER_USER) {
      organizationError(
        "ORGANIZATION_LIMIT",
        `A user may belong to at most ${MAX_ORGANIZATIONS_PER_USER} organizations.`,
      );
    }
    let membershipId: Id<"organizationMembers">;
    if (existingMembership === null) {
      membershipId = await ctx.db.insert("organizationMembers", {
        organizationId: invite.organizationId,
        userId: actor._id,
        role: invite.role,
        status: "active",
        joinedAt: now,
        updatedAt: now,
      });
    } else {
      membershipId = existingMembership._id;
      await ctx.db.patch("organizationMembers", membershipId, {
        role: invite.role,
        status: "active",
        joinedAt: now,
        updatedAt: now,
        removedAt: undefined,
        removedByUserId: undefined,
      });
    }
    await ctx.db.patch("organizationInvites", invite._id, {
      status: "accepted",
      acceptedAt: now,
      acceptedByUserId: actor._id,
    });
    await appendAudit(ctx, {
      organizationId: invite.organizationId,
      eventType: "invite_accepted",
      actorUserId: actor._id,
      targetUserId: actor._id,
      nextRole: invite.role,
      createdAt: now,
    });
    return {
      organizationId: invite.organizationId,
      membershipId,
      role: invite.role,
    };
  },
});

export const revokeInvite = mutation({
  args: { inviteId: v.id("organizationInvites") },
  handler: async (ctx, args) => {
    await requireHumanActor(ctx);
    const invite = await ctx.db.get("organizationInvites", args.inviteId);
    if (invite === null || invite.status !== "pending") {
      organizationError("INVITE_NOT_FOUND", "Invite was not found.");
    }
    const access = await requireOrganizationAdmin(ctx, invite.organizationId);
    if (invite.role === "admin" && access.membership.role !== "owner") {
      organizationError(
        "ORGANIZATION_OWNER_REQUIRED",
        "Only the owner may revoke an administrator invite.",
      );
    }
    const now = Date.now();
    await ctx.db.patch("organizationInvites", invite._id, {
      status: "revoked",
      revokedAt: now,
      revokedByUserId: access.actor._id,
    });
    await appendAudit(ctx, {
      organizationId: invite.organizationId,
      eventType: "invite_revoked",
      actorUserId: access.actor._id,
      targetUserId: invite.inviteeUserId,
      previousRole: invite.role,
      createdAt: now,
    });
    return { revoked: true };
  },
});

export const setMemberRole = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    role: inviteRoleValidator,
  },
  handler: async (ctx, args) => {
    const access = await requireSoleOwner(ctx, args.organizationId);
    const target = await ctx.db
      .query("organizationMembers")
      .withIndex("by_organizationId_and_userId", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", args.userId),
      )
      .unique();
    if (
      target === null ||
      target.status !== "active" ||
      target.role === "owner"
    ) {
      organizationError(
        "ORGANIZATION_MEMBER_NOT_FOUND",
        "Organization member was not found.",
      );
    }
    if (target.role === args.role) return { role: target.role };
    const now = Date.now();
    await ctx.db.patch("organizationMembers", target._id, {
      role: args.role,
      updatedAt: now,
    });
    await appendAudit(ctx, {
      organizationId: args.organizationId,
      eventType: "member_role_changed",
      actorUserId: access.actor._id,
      targetUserId: target.userId,
      previousRole: target.role,
      nextRole: args.role,
      createdAt: now,
    });
    return { role: args.role };
  },
});

export const transferOwnership = mutation({
  args: {
    organizationId: v.id("organizations"),
    targetUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const access = await requireSoleOwner(ctx, args.organizationId);
    if (args.targetUserId === access.actor._id) {
      organizationError(
        "OWNER_TRANSFER_INVALID",
        "Ownership must be transferred to another active member.",
      );
    }
    const target = await ctx.db
      .query("organizationMembers")
      .withIndex("by_organizationId_and_userId", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("userId", args.targetUserId),
      )
      .unique();
    if (
      target === null ||
      target.status !== "active" ||
      target.role === "owner"
    ) {
      organizationError(
        "ORGANIZATION_MEMBER_NOT_FOUND",
        "The new owner must be an active non-owner member.",
      );
    }
    const now = Date.now();
    await ctx.db.patch("organizationMembers", access.membership._id, {
      role: "admin",
      updatedAt: now,
    });
    await ctx.db.patch("organizationMembers", target._id, {
      role: "owner",
      updatedAt: now,
    });
    await appendAudit(ctx, {
      organizationId: args.organizationId,
      eventType: "owner_transferred",
      actorUserId: access.actor._id,
      targetUserId: target.userId,
      previousRole: target.role,
      nextRole: "owner",
      createdAt: now,
    });
    return { ownerUserId: target.userId };
  },
});

export const removeMember = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const access = await requireOrganizationMember(ctx, args.organizationId);
    const target = await ctx.db
      .query("organizationMembers")
      .withIndex("by_organizationId_and_userId", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", args.userId),
      )
      .unique();
    if (target === null || target.status !== "active") {
      organizationError(
        "ORGANIZATION_MEMBER_NOT_FOUND",
        "Organization member was not found.",
      );
    }
    if (target.role === "owner") {
      organizationError(
        "OWNER_REMOVAL_FORBIDDEN",
        "Transfer ownership before removing the owner.",
      );
    }
    const removingSelf = target.userId === access.actor._id;
    const permitted =
      removingSelf ||
      access.membership.role === "owner" ||
      (access.membership.role === "admin" &&
        (target.role === "developer" || target.role === "auditor"));
    if (!permitted) {
      organizationError(
        "ORGANIZATION_ADMIN_REQUIRED",
        "This membership cannot be removed by the current principal.",
      );
    }
    const serviceAccounts = await ctx.db
      .query("organizationServiceAccounts")
      .withIndex("by_organizationId_and_ownerUserId_and_status", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("ownerUserId", target.userId)
          .eq("status", "active"),
      )
      .take(MAX_SERVICE_ACCOUNTS_PER_ORGANIZATION + 1);
    if (serviceAccounts.length > MAX_SERVICE_ACCOUNTS_PER_ORGANIZATION) {
      organizationError(
        "SERVICE_ACCOUNT_LIMIT_INVARIANT",
        "Too many service accounts are attached to this membership.",
      );
    }
    const now = Date.now();
    for (const serviceAccount of serviceAccounts) {
      await ctx.db.patch("organizationServiceAccounts", serviceAccount._id, {
        status: "revoked",
        revokedAt: now,
        revokedByUserId: access.actor._id,
        updatedAt: now,
      });
      await appendAudit(ctx, {
        organizationId: args.organizationId,
        eventType: "service_account_revoked",
        actorUserId: access.actor._id,
        targetUserId: target.userId,
        projectId: serviceAccount.projectId,
        serviceAccountId: serviceAccount._id,
        createdAt: now,
      });
    }
    await ctx.db.patch("organizationMembers", target._id, {
      status: "removed",
      removedAt: now,
      removedByUserId: access.actor._id,
      updatedAt: now,
    });
    await appendAudit(ctx, {
      organizationId: args.organizationId,
      eventType: "member_removed",
      actorUserId: access.actor._id,
      targetUserId: target.userId,
      previousRole: target.role,
      createdAt: now,
    });
    return { removed: true, revokedServiceAccounts: serviceAccounts.length };
  },
});

export const createProject = mutation({
  args: {
    organizationId: v.id("organizations"),
    projectKey: v.string(),
    name: v.string(),
    allowedAgentScopes: v.array(agentScopeValidator),
  },
  handler: async (ctx, args) => {
    const access = await requireOrganizationAdmin(ctx, args.organizationId);
    const projectKey = identifier(args.projectKey, "projectKey", 64);
    const name = cleanName(args.name, "name", 120);
    const allowedAgentScopes = normalizeScopes(args.allowedAgentScopes);
    const [existing, projects] = await Promise.all([
      ctx.db
        .query("organizationProjects")
        .withIndex("by_organizationId_and_projectKey", (q) =>
          q
            .eq("organizationId", args.organizationId)
            .eq("projectKey", projectKey),
        )
        .unique(),
      ctx.db
        .query("organizationProjects")
        .withIndex("by_organizationId_and_status_and_updatedAt", (q) =>
          q.eq("organizationId", args.organizationId).eq("status", "active"),
        )
        .take(MAX_PROJECTS_PER_ORGANIZATION + 1),
    ]);
    if (existing !== null) {
      organizationError(
        "PROJECT_KEY_IN_USE",
        "Project key is already in use in this organization.",
      );
    }
    if (projects.length >= MAX_PROJECTS_PER_ORGANIZATION) {
      organizationError(
        "ORGANIZATION_PROJECT_LIMIT",
        `An organization may have at most ${MAX_PROJECTS_PER_ORGANIZATION} active projects.`,
      );
    }
    const now = Date.now();
    const projectId = await ctx.db.insert("organizationProjects", {
      organizationId: args.organizationId,
      projectKey,
      name,
      status: "active",
      allowedAgentScopes,
      createdByUserId: access.actor._id,
      createdAt: now,
      updatedAt: now,
    });
    await appendAudit(ctx, {
      organizationId: args.organizationId,
      eventType: "project_created",
      actorUserId: access.actor._id,
      projectId,
      createdAt: now,
    });
    return { projectId, projectKey, allowedAgentScopes };
  },
});

export const listProjects = query({
  args: {
    organizationId: v.id("organizations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOrganizationMember(ctx, args.organizationId);
    const projects = await ctx.db
      .query("organizationProjects")
      .withIndex("by_organizationId_and_status_and_updatedAt", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "active"),
      )
      .order("desc")
      .take(resultLimit(args.limit, MAX_PROJECTS_PER_ORGANIZATION));
    return projects.map((project) => ({
      projectId: project._id,
      projectKey: project.projectKey,
      name: project.name,
      status: project.status,
      allowedAgentScopes: project.allowedAgentScopes,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }));
  },
});

export const setProjectAllowedScopes = mutation({
  args: {
    projectId: v.id("organizationProjects"),
    allowedAgentScopes: v.array(agentScopeValidator),
  },
  handler: async (ctx, args) => {
    await requireHumanActor(ctx);
    const project = await ctx.db.get("organizationProjects", args.projectId);
    if (project === null || project.status !== "active") {
      organizationError("PROJECT_NOT_FOUND", "Project was not found.");
    }
    const access = await requireOrganizationAdmin(ctx, project.organizationId);
    const allowedAgentScopes = normalizeScopes(args.allowedAgentScopes);
    const serviceAccounts = await ctx.db
      .query("organizationServiceAccounts")
      .withIndex("by_organizationId_and_projectId_and_status", (q) =>
        q
          .eq("organizationId", project.organizationId)
          .eq("projectId", project._id)
          .eq("status", "active"),
      )
      .take(MAX_SERVICE_ACCOUNTS_PER_PROJECT + 1);
    if (serviceAccounts.length > MAX_SERVICE_ACCOUNTS_PER_PROJECT) {
      organizationError(
        "SERVICE_ACCOUNT_LIMIT_INVARIANT",
        "Too many service accounts are attached to this project.",
      );
    }
    const now = Date.now();
    await ctx.db.patch("organizationProjects", project._id, {
      allowedAgentScopes,
      updatedAt: now,
    });
    for (const serviceAccount of serviceAccounts) {
      const narrowed = serviceAccount.allowedScopes.filter((scope) =>
        allowedAgentScopes.includes(scope),
      );
      if (narrowed.length !== serviceAccount.allowedScopes.length) {
        await ctx.db.patch("organizationServiceAccounts", serviceAccount._id, {
          allowedScopes: narrowed,
          updatedAt: now,
        });
      }
    }
    await appendAudit(ctx, {
      organizationId: project.organizationId,
      eventType: "project_scopes_changed",
      actorUserId: access.actor._id,
      projectId: project._id,
      createdAt: now,
    });
    return { projectId: project._id, allowedAgentScopes };
  },
});

export const createServiceAccount = mutation({
  args: {
    projectId: v.id("organizationProjects"),
    agentId: v.string(),
    name: v.string(),
    allowedScopes: v.array(agentScopeValidator),
  },
  handler: async (ctx, args) => {
    await requireHumanActor(ctx);
    const project = await ctx.db.get("organizationProjects", args.projectId);
    if (project === null || project.status !== "active") {
      organizationError("PROJECT_NOT_FOUND", "Project was not found.");
    }
    const access = await requireOrganizationAdmin(ctx, project.organizationId);
    const agentId = identifier(args.agentId, "agentId", 64);
    const name = cleanName(args.name, "name", 120);
    const allowedScopes = normalizeScopes(args.allowedScopes, true);
    const identity = await ctx.db
      .query("agentIdentities")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .unique();
    if (
      identity === null ||
      identity.status !== "active" ||
      identity.ownerUserId !== access.actor._id
    ) {
      organizationError(
        "SERVICE_ACCOUNT_AGENT_DENIED",
        "Only an active agent owned by the current human account may be bound.",
      );
    }
    const agentUser = await ctx.db.get("users", identity.userId);
    if (
      !isActiveAgentUser(agentUser) ||
      agentUser.agentSlug !== identity.agentId ||
      !scopesAreSubset(allowedScopes, project.allowedAgentScopes) ||
      !scopesAreSubset(allowedScopes, identity.scopes) ||
      !scopesAreSubset(allowedScopes, agentUser.agentScopes)
    ) {
      organizationError(
        "SERVICE_ACCOUNT_SCOPE_DENIED",
        "Service-account scopes must be allowed by the project and agent identity.",
      );
    }
    const [existing, organizationAccounts, projectAccounts] = await Promise.all(
      [
        ctx.db
          .query("organizationServiceAccounts")
          .withIndex("by_agentUserId", (q) =>
            q.eq("agentUserId", identity.userId),
          )
          .unique(),
        ctx.db
          .query("organizationServiceAccounts")
          .withIndex("by_organizationId_and_status_and_updatedAt", (q) =>
            q
              .eq("organizationId", project.organizationId)
              .eq("status", "active"),
          )
          .take(MAX_SERVICE_ACCOUNTS_PER_ORGANIZATION + 1),
        ctx.db
          .query("organizationServiceAccounts")
          .withIndex("by_organizationId_and_projectId_and_status", (q) =>
            q
              .eq("organizationId", project.organizationId)
              .eq("projectId", project._id)
              .eq("status", "active"),
          )
          .take(MAX_SERVICE_ACCOUNTS_PER_PROJECT + 1),
      ],
    );
    if (existing !== null) {
      organizationError(
        "SERVICE_ACCOUNT_AGENT_IN_USE",
        "This agent is already bound to a service account.",
      );
    }
    if (organizationAccounts.length >= MAX_SERVICE_ACCOUNTS_PER_ORGANIZATION) {
      organizationError(
        "ORGANIZATION_SERVICE_ACCOUNT_LIMIT",
        `An organization may have at most ${MAX_SERVICE_ACCOUNTS_PER_ORGANIZATION} active service accounts.`,
      );
    }
    if (projectAccounts.length >= MAX_SERVICE_ACCOUNTS_PER_PROJECT) {
      organizationError(
        "PROJECT_SERVICE_ACCOUNT_LIMIT",
        `A project may have at most ${MAX_SERVICE_ACCOUNTS_PER_PROJECT} active service accounts.`,
      );
    }
    const now = Date.now();
    const serviceAccountId = await ctx.db.insert(
      "organizationServiceAccounts",
      {
        organizationId: project.organizationId,
        projectId: project._id,
        agentIdentityId: identity._id,
        agentUserId: identity.userId,
        ownerUserId: access.actor._id,
        name,
        status: "active",
        allowedScopes,
        createdByUserId: access.actor._id,
        createdAt: now,
        updatedAt: now,
      },
    );
    await appendAudit(ctx, {
      organizationId: project.organizationId,
      eventType: "service_account_created",
      actorUserId: access.actor._id,
      projectId: project._id,
      serviceAccountId,
      createdAt: now,
    });
    return { serviceAccountId, projectId: project._id, agentId, allowedScopes };
  },
});

export const listServiceAccounts = query({
  args: {
    projectId: v.id("organizationProjects"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireHumanActor(ctx);
    const project = await ctx.db.get("organizationProjects", args.projectId);
    if (project === null || project.status !== "active") {
      organizationError("PROJECT_NOT_FOUND", "Project was not found.");
    }
    await requireOrganizationMember(ctx, project.organizationId);
    const rows = await ctx.db
      .query("organizationServiceAccounts")
      .withIndex("by_organizationId_and_projectId_and_status", (q) =>
        q
          .eq("organizationId", project.organizationId)
          .eq("projectId", project._id),
      )
      .take(resultLimit(args.limit, MAX_SERVICE_ACCOUNTS_PER_PROJECT));
    return await Promise.all(
      rows.map(async (row) => {
        const identity = await ctx.db.get(
          "agentIdentities",
          row.agentIdentityId,
        );
        return {
          serviceAccountId: row._id,
          projectId: row.projectId,
          agentId: identity?.agentId ?? "revoked",
          name: row.name,
          status: row.status,
          identityActive: identity?.status === "active",
          allowedScopes: row.allowedScopes,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          revokedAt: row.revokedAt ?? null,
        };
      }),
    );
  },
});

export const revokeServiceAccount = mutation({
  args: { serviceAccountId: v.id("organizationServiceAccounts") },
  handler: async (ctx, args) => {
    await requireHumanActor(ctx);
    const serviceAccount = await ctx.db.get(
      "organizationServiceAccounts",
      args.serviceAccountId,
    );
    if (serviceAccount === null) {
      organizationError(
        "SERVICE_ACCOUNT_NOT_FOUND",
        "Service account was not found.",
      );
    }
    const access = await requireOrganizationAdmin(
      ctx,
      serviceAccount.organizationId,
    );
    if (serviceAccount.status === "revoked") return { revoked: true };
    const now = Date.now();
    await ctx.db.patch("organizationServiceAccounts", serviceAccount._id, {
      status: "revoked",
      revokedAt: now,
      revokedByUserId: access.actor._id,
      updatedAt: now,
    });
    await appendAudit(ctx, {
      organizationId: serviceAccount.organizationId,
      eventType: "service_account_revoked",
      actorUserId: access.actor._id,
      projectId: serviceAccount.projectId,
      serviceAccountId: serviceAccount._id,
      createdAt: now,
    });
    return { revoked: true };
  },
});

export const setBudget = mutation({
  args: {
    organizationId: v.id("organizations"),
    monthlyLimitMicros: v.number(),
  },
  handler: async (ctx, args) => {
    const access = await requireSoleOwner(ctx, args.organizationId);
    const monthlyLimitMicros = boundedInteger(
      args.monthlyLimitMicros,
      "monthlyLimitMicros",
      0,
      MAX_BUDGET_MICROS,
    );
    const now = Date.now();
    const monthKey = currentUtcMonthKey(now);
    const budget = await ctx.db
      .query("organizationBudgets")
      .withIndex("by_organizationId_and_monthKey", (q) =>
        q.eq("organizationId", args.organizationId).eq("monthKey", monthKey),
      )
      .unique();
    if (budget !== null && monthlyLimitMicros < budget.spentMicros) {
      organizationError(
        "BUDGET_BELOW_SPEND",
        "The budget cannot be reduced below already-recorded spend.",
      );
    }
    const previousAmountMicros = budget?.limitMicros ?? 0;
    if (budget === null) {
      await ctx.db.insert("organizationBudgets", {
        organizationId: args.organizationId,
        monthKey,
        currency: "USD",
        limitMicros: monthlyLimitMicros,
        spentMicros: 0,
        createdByUserId: access.actor._id,
        updatedByUserId: access.actor._id,
        createdAt: now,
        updatedAt: now,
      });
    } else if (budget.limitMicros !== monthlyLimitMicros) {
      await ctx.db.patch("organizationBudgets", budget._id, {
        limitMicros: monthlyLimitMicros,
        updatedByUserId: access.actor._id,
        updatedAt: now,
      });
    }
    if (previousAmountMicros !== monthlyLimitMicros) {
      await appendAudit(ctx, {
        organizationId: args.organizationId,
        eventType: "budget_changed",
        actorUserId: access.actor._id,
        previousAmountMicros,
        nextAmountMicros: monthlyLimitMicros,
        createdAt: now,
      });
    }
    return {
      monthKey,
      currency: "USD" as const,
      limitMicros: monthlyLimitMicros,
      spentMicros: budget?.spentMicros ?? 0,
    };
  },
});

export const getBudget = query({
  args: {
    organizationId: v.id("organizations"),
    monthKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOrganizationMember(ctx, args.organizationId);
    const monthKey = validatedMonthKey(args.monthKey);
    const budget = await ctx.db
      .query("organizationBudgets")
      .withIndex("by_organizationId_and_monthKey", (q) =>
        q.eq("organizationId", args.organizationId).eq("monthKey", monthKey),
      )
      .unique();
    return {
      monthKey,
      currency: "USD" as const,
      limitMicros: budget?.limitMicros ?? 0,
      spentMicros: budget?.spentMicros ?? 0,
      remainingMicros: Math.max(
        0,
        (budget?.limitMicros ?? 0) - (budget?.spentMicros ?? 0),
      ),
    };
  },
});

/**
 * Records a charge only for the authenticated active service account. The
 * caller cannot select an organization, project, or service account, so a
 * credential can never spend another tenant's budget.
 */
export const recordServiceAccountUsage = mutation({
  args: {
    scope: agentScopeValidator,
    amountMicros: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireAuthenticatedUser(ctx);
    if (!isActiveAgentUser(actor)) {
      organizationError(
        "SERVICE_ACCOUNT_DENIED",
        "An active service-account identity is required.",
      );
    }
    requireAgentScope(actor, args.scope);
    const amountMicros = boundedInteger(
      args.amountMicros,
      "amountMicros",
      1,
      MAX_CHARGE_MICROS,
    );
    const requestKey = idempotencyKey(args.idempotencyKey);
    const serviceAccount = await ctx.db
      .query("organizationServiceAccounts")
      .withIndex("by_agentUserId", (q) => q.eq("agentUserId", actor._id))
      .unique();
    if (serviceAccount === null || serviceAccount.status !== "active") {
      organizationError(
        "SERVICE_ACCOUNT_DENIED",
        "An active service-account identity is required.",
      );
    }
    const [identity, organization, project] = await Promise.all([
      ctx.db.get("agentIdentities", serviceAccount.agentIdentityId),
      ctx.db.get("organizations", serviceAccount.organizationId),
      ctx.db.get("organizationProjects", serviceAccount.projectId),
    ]);
    if (
      identity === null ||
      identity.status !== "active" ||
      identity.userId !== actor._id ||
      identity.ownerUserId !== serviceAccount.ownerUserId ||
      identity.agentId !== actor.agentSlug ||
      organization?.status !== "active" ||
      project?.status !== "active" ||
      project.organizationId !== serviceAccount.organizationId ||
      !serviceAccount.allowedScopes.includes(args.scope) ||
      !project.allowedAgentScopes.includes(args.scope) ||
      !identity.scopes.includes(args.scope)
    ) {
      organizationError(
        "SERVICE_ACCOUNT_DENIED",
        "The service-account binding or requested scope is not active.",
      );
    }
    const existing = await ctx.db
      .query("organizationUsageLedger")
      .withIndex("by_serviceAccountId_and_idempotencyKey", (q) =>
        q
          .eq("serviceAccountId", serviceAccount._id)
          .eq("idempotencyKey", requestKey),
      )
      .unique();
    if (existing !== null) {
      if (
        existing.amountMicros !== amountMicros ||
        existing.scope !== args.scope ||
        existing.organizationId !== serviceAccount.organizationId ||
        existing.projectId !== serviceAccount.projectId
      ) {
        organizationError(
          "USAGE_IDEMPOTENCY_MISMATCH",
          "idempotencyKey was already used for a different charge.",
        );
      }
      return {
        usageId: existing._id,
        organizationId: existing.organizationId,
        projectId: existing.projectId,
        monthKey: existing.monthKey,
        currency: existing.currency,
        amountMicros: existing.amountMicros,
        spentAfterMicros: existing.spentAfterMicros,
        idempotent: true,
      };
    }
    const now = Date.now();
    const monthKey = currentUtcMonthKey(now);
    const budget = await ctx.db
      .query("organizationBudgets")
      .withIndex("by_organizationId_and_monthKey", (q) =>
        q
          .eq("organizationId", serviceAccount.organizationId)
          .eq("monthKey", monthKey),
      )
      .unique();
    if (budget === null || budget.limitMicros === 0) {
      organizationError(
        "ORGANIZATION_SPEND_DISABLED",
        "Organization spend is disabled for the current month.",
      );
    }
    const spentAfterMicros = budget.spentMicros + amountMicros;
    if (
      !Number.isSafeInteger(spentAfterMicros) ||
      spentAfterMicros > budget.limitMicros
    ) {
      organizationError(
        "ORGANIZATION_BUDGET_EXCEEDED",
        "This charge would exceed the shared organization budget.",
      );
    }
    await ctx.db.patch("organizationBudgets", budget._id, {
      spentMicros: spentAfterMicros,
      updatedAt: now,
    });
    const usageId = await ctx.db.insert("organizationUsageLedger", {
      organizationId: serviceAccount.organizationId,
      projectId: serviceAccount.projectId,
      serviceAccountId: serviceAccount._id,
      idempotencyKey: requestKey,
      scope: args.scope,
      amountMicros,
      spentAfterMicros,
      currency: "USD",
      monthKey,
      chargedAt: now,
    });
    return {
      usageId,
      organizationId: serviceAccount.organizationId,
      projectId: serviceAccount.projectId,
      monthKey,
      currency: "USD" as const,
      amountMicros,
      spentAfterMicros,
      idempotent: false,
    };
  },
});

export const listUsage = query({
  args: {
    organizationId: v.id("organizations"),
    monthKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOrganizationMember(ctx, args.organizationId);
    const monthKey = validatedMonthKey(args.monthKey);
    const rows = await ctx.db
      .query("organizationUsageLedger")
      .withIndex("by_organizationId_and_monthKey_and_chargedAt", (q) =>
        q.eq("organizationId", args.organizationId).eq("monthKey", monthKey),
      )
      .order("desc")
      .take(resultLimit(args.limit, MAX_USAGE_RESULTS));
    return rows.map((row) => ({
      usageId: row._id,
      projectId: row.projectId,
      serviceAccountId: row.serviceAccountId,
      scope: row.scope,
      amountMicros: row.amountMicros,
      spentAfterMicros: row.spentAfterMicros,
      currency: row.currency,
      monthKey: row.monthKey,
      chargedAt: row.chargedAt,
    }));
  },
});

export const listAuditLog = query({
  args: {
    organizationId: v.id("organizations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOrganizationMember(ctx, args.organizationId);
    const rows = await ctx.db
      .query("organizationAuditRecords")
      .withIndex("by_organizationId_and_createdAt", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .order("desc")
      .take(resultLimit(args.limit, MAX_AUDIT_RESULTS));
    return rows.map((row) => ({
      auditId: row._id,
      eventType: row.eventType,
      actorUserId: row.actorUserId,
      actorKind: row.actorKind,
      targetUserId: row.targetUserId ?? null,
      projectId: row.projectId ?? null,
      serviceAccountId: row.serviceAccountId ?? null,
      previousRole: row.previousRole ?? null,
      nextRole: row.nextRole ?? null,
      previousAmountMicros: row.previousAmountMicros ?? null,
      nextAmountMicros: row.nextAmountMicros ?? null,
      createdAt: row.createdAt,
    }));
  },
});
