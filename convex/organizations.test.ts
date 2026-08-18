/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

const organizations = {
  listMine: makeFunctionReference<"query", any, any>("organizations:listMine"),
  get: makeFunctionReference<"query", any, any>("organizations:get"),
  create: makeFunctionReference<"mutation", any, any>("organizations:create"),
  listMembers: makeFunctionReference<"query", any, any>(
    "organizations:listMembers",
  ),
  listInvites: makeFunctionReference<"query", any, any>(
    "organizations:listInvites",
  ),
  listMyPendingInvites: makeFunctionReference<"query", any, any>(
    "organizations:listMyPendingInvites",
  ),
  inviteMember: makeFunctionReference<"mutation", any, any>(
    "organizations:inviteMember",
  ),
  acceptInvite: makeFunctionReference<"mutation", any, any>(
    "organizations:acceptInvite",
  ),
  revokeInvite: makeFunctionReference<"mutation", any, any>(
    "organizations:revokeInvite",
  ),
  setMemberRole: makeFunctionReference<"mutation", any, any>(
    "organizations:setMemberRole",
  ),
  transferOwnership: makeFunctionReference<"mutation", any, any>(
    "organizations:transferOwnership",
  ),
  removeMember: makeFunctionReference<"mutation", any, any>(
    "organizations:removeMember",
  ),
  createProject: makeFunctionReference<"mutation", any, any>(
    "organizations:createProject",
  ),
  listProjects: makeFunctionReference<"query", any, any>(
    "organizations:listProjects",
  ),
  setProjectAllowedScopes: makeFunctionReference<"mutation", any, any>(
    "organizations:setProjectAllowedScopes",
  ),
  createServiceAccount: makeFunctionReference<"mutation", any, any>(
    "organizations:createServiceAccount",
  ),
  listServiceAccounts: makeFunctionReference<"query", any, any>(
    "organizations:listServiceAccounts",
  ),
  revokeServiceAccount: makeFunctionReference<"mutation", any, any>(
    "organizations:revokeServiceAccount",
  ),
  setBudget: makeFunctionReference<"mutation", any, any>(
    "organizations:setBudget",
  ),
  getBudget: makeFunctionReference<"query", any, any>(
    "organizations:getBudget",
  ),
  recordServiceAccountUsage: makeFunctionReference<"mutation", any, any>(
    "organizations:recordServiceAccountUsage",
  ),
  listUsage: makeFunctionReference<"query", any, any>(
    "organizations:listUsage",
  ),
  listAuditLog: makeFunctionReference<"query", any, any>(
    "organizations:listAuditLog",
  ),
} as const;

function setup() {
  return convexTest(schema, modules);
}

function monthKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function seedUsers(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const ownerOne = await ctx.db.insert("users", {
      name: "Owner One",
      username: "owner-one",
      usernameNormalized: "owner-one",
      role: "reader",
    });
    const ownerTwo = await ctx.db.insert("users", {
      name: "Owner Two",
      username: "owner-two",
      usernameNormalized: "owner-two",
      role: "reader",
    });
    const member = await ctx.db.insert("users", {
      name: "Member",
      username: "member",
      usernameNormalized: "member",
      role: "reader",
    });
    const outsider = await ctx.db.insert("users", {
      name: "Outsider",
      username: "outsider",
      usernameNormalized: "outsider",
      role: "reader",
    });
    return { ownerOne, ownerTwo, member, outsider };
  });
}

async function seedAgent(
  t: ReturnType<typeof setup>,
  ownerUserId: Id<"users">,
  agentId: string,
  scopes: Array<
    "forum" | "newsletter" | "interactions" | "comments" | "evidence"
  > = ["evidence"],
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: agentId,
      username: agentId,
      usernameNormalized: agentId,
      role: "reader",
      isAgent: true,
      agentSlug: agentId,
      agentStatus: "active",
      agentScopes: scopes,
      agentKeyVersion: 1,
      agentEnrolledAt: now,
    });
    const identityId = await ctx.db.insert("agentIdentities", {
      agentId,
      userId,
      ownerUserId,
      publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      scopes,
      status: "active",
      keyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, identityId };
  });
}

async function createOrganization(
  t: ReturnType<typeof setup>,
  ownerId: Id<"users">,
  slug: string,
  monthlyBudgetMicros = 10_000,
) {
  return await t
    .withIdentity({ subject: ownerId })
    .mutation(organizations.create, {
      slug,
      name: `${slug} organization`,
      monthlyBudgetMicros,
    });
}

describe("organization tenant foundation", () => {
  test("derives the human principal and denies every cross-organization read and mutation", async () => {
    const t = setup();
    const users = await seedUsers(t);
    const first = await createOrganization(t, users.ownerOne, "first-org");
    const second = await createOrganization(t, users.ownerTwo, "second-org");
    const ownerOne = t.withIdentity({ subject: users.ownerOne });
    const ownerTwo = t.withIdentity({ subject: users.ownerTwo });

    await expect(
      t.mutation(organizations.create, {
        slug: "anonymous-org",
        name: "Anonymous organization",
      }),
    ).rejects.toThrow();
    expect(await ownerOne.query(organizations.listMine, {})).toMatchObject([
      { organizationId: first.organizationId, role: "owner" },
    ]);
    expect(await ownerTwo.query(organizations.listMine, {})).toMatchObject([
      { organizationId: second.organizationId, role: "owner" },
    ]);
    await expect(
      ownerTwo.query(organizations.get, {
        organizationId: first.organizationId,
      }),
    ).rejects.toThrow();
    await expect(
      ownerTwo.query(organizations.listMembers, {
        organizationId: first.organizationId,
      }),
    ).rejects.toThrow();
    await expect(
      ownerTwo.mutation(organizations.setBudget, {
        organizationId: first.organizationId,
        monthlyLimitMicros: 500_000,
      }),
    ).rejects.toThrow();
    await expect(
      ownerTwo.mutation(organizations.createProject, {
        organizationId: first.organizationId,
        projectKey: "intrusion",
        name: "Intrusion",
        allowedAgentScopes: ["evidence"],
      }),
    ).rejects.toThrow();

    const agent = await seedAgent(t, users.ownerOne, "not-a-human");
    await expect(
      t.withIdentity({ subject: agent.userId }).mutation(organizations.create, {
        slug: "agent-org",
        name: "Agent organization",
      }),
    ).rejects.toThrow();
  });

  test("enforces invite targeting, role hierarchy, sole-owner transfer, and owner removal invariants", async () => {
    const t = setup();
    const users = await seedUsers(t);
    const created = await createOrganization(t, users.ownerOne, "role-org");
    const owner = t.withIdentity({ subject: users.ownerOne });
    const member = t.withIdentity({ subject: users.member });
    const outsider = t.withIdentity({ subject: users.outsider });

    const invite = await owner.mutation(organizations.inviteMember, {
      organizationId: created.organizationId,
      inviteeUserId: users.member,
      role: "developer",
    });
    await expect(
      member.query(organizations.listMyPendingInvites, {}),
    ).resolves.toMatchObject([
      {
        inviteId: invite.inviteId,
        organizationId: created.organizationId,
        role: "developer",
      },
    ]);
    await expect(
      outsider.query(organizations.listMyPendingInvites, {}),
    ).resolves.toEqual([]);
    await expect(
      outsider.mutation(organizations.acceptInvite, {
        inviteId: invite.inviteId,
      }),
    ).rejects.toThrow();
    await member.mutation(organizations.acceptInvite, {
      inviteId: invite.inviteId,
    });
    await expect(
      member.mutation(organizations.inviteMember, {
        organizationId: created.organizationId,
        inviteeUserId: users.outsider,
        role: "auditor",
      }),
    ).rejects.toThrow();
    await owner.mutation(organizations.setMemberRole, {
      organizationId: created.organizationId,
      userId: users.member,
      role: "admin",
    });
    await owner.mutation(organizations.transferOwnership, {
      organizationId: created.organizationId,
      targetUserId: users.member,
    });
    await expect(
      owner.mutation(organizations.transferOwnership, {
        organizationId: created.organizationId,
        targetUserId: users.ownerOne,
      }),
    ).rejects.toThrow();
    await expect(
      member.mutation(organizations.removeMember, {
        organizationId: created.organizationId,
        userId: users.member,
      }),
    ).rejects.toThrow();

    const members = await member.query(organizations.listMembers, {
      organizationId: created.organizationId,
    });
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: users.ownerOne, role: "admin" }),
        expect.objectContaining({ userId: users.member, role: "owner" }),
      ]),
    );
    const events = await member.query(organizations.listAuditLog, {
      organizationId: created.organizationId,
      limit: 50,
    });
    expect(
      events.map((event: { eventType: string }) => event.eventType),
    ).toEqual(
      expect.arrayContaining([
        "organization_created",
        "budget_changed",
        "member_invited",
        "invite_accepted",
        "member_role_changed",
        "owner_transferred",
      ]),
    );
  });

  test("binds an owned Ed25519 agent to one project and shares a hard organization budget", async () => {
    const t = setup();
    const users = await seedUsers(t);
    const created = await createOrganization(
      t,
      users.ownerOne,
      "usage-org",
      1_000,
    );
    const owner = t.withIdentity({ subject: users.ownerOne });
    const foreignOwner = t.withIdentity({ subject: users.ownerTwo });
    const firstAgent = await seedAgent(t, users.ownerOne, "usage-agent-one", [
      "evidence",
      "forum",
    ]);
    const secondAgent = await seedAgent(t, users.ownerOne, "usage-agent-two", [
      "evidence",
    ]);
    const foreignAgent = await seedAgent(t, users.ownerTwo, "foreign-agent", [
      "evidence",
    ]);
    const firstProject = await owner.mutation(organizations.createProject, {
      organizationId: created.organizationId,
      projectKey: "research",
      name: "Research",
      allowedAgentScopes: ["evidence"],
    });
    const secondProject = await owner.mutation(organizations.createProject, {
      organizationId: created.organizationId,
      projectKey: "benchmarks",
      name: "Benchmarks",
      allowedAgentScopes: ["evidence"],
    });
    const firstService = await owner.mutation(
      organizations.createServiceAccount,
      {
        projectId: firstProject.projectId,
        agentId: "usage-agent-one",
        name: "Research service",
        allowedScopes: ["evidence"],
      },
    );
    await owner.mutation(organizations.createServiceAccount, {
      projectId: secondProject.projectId,
      agentId: "usage-agent-two",
      name: "Benchmark service",
      allowedScopes: ["evidence"],
    });
    await expect(
      owner.mutation(organizations.createServiceAccount, {
        projectId: firstProject.projectId,
        agentId: "foreign-agent",
        name: "Foreign service",
        allowedScopes: ["evidence"],
      }),
    ).rejects.toThrow();
    await expect(
      foreignOwner.query(organizations.listServiceAccounts, {
        projectId: firstProject.projectId,
      }),
    ).rejects.toThrow();

    const agentOne = t.withIdentity({ subject: firstAgent.userId });
    const agentTwo = t.withIdentity({ subject: secondAgent.userId });
    const firstCharge = await agentOne.mutation(
      organizations.recordServiceAccountUsage,
      {
        scope: "evidence",
        amountMicros: 600,
        idempotencyKey: "usage-request-0001",
      },
    );
    expect(firstCharge).toMatchObject({
      organizationId: created.organizationId,
      projectId: firstProject.projectId,
      amountMicros: 600,
      spentAfterMicros: 600,
      idempotent: false,
    });
    await expect(
      agentOne.mutation(organizations.recordServiceAccountUsage, {
        scope: "evidence",
        amountMicros: 600,
        idempotencyKey: "usage-request-0001",
      }),
    ).resolves.toMatchObject({ spentAfterMicros: 600, idempotent: true });
    await expect(
      agentOne.mutation(organizations.recordServiceAccountUsage, {
        scope: "evidence",
        amountMicros: 601,
        idempotencyKey: "usage-request-0001",
      }),
    ).rejects.toThrow();
    await expect(
      t
        .withIdentity({ subject: foreignAgent.userId })
        .mutation(organizations.recordServiceAccountUsage, {
          scope: "evidence",
          amountMicros: 1,
          idempotencyKey: "foreign-request-0001",
        }),
    ).rejects.toThrow();
    await agentTwo.mutation(organizations.recordServiceAccountUsage, {
      scope: "evidence",
      amountMicros: 400,
      idempotencyKey: "usage-request-0002",
    });
    await expect(
      agentOne.mutation(organizations.recordServiceAccountUsage, {
        scope: "evidence",
        amountMicros: 1,
        idempotencyKey: "usage-request-0003",
      }),
    ).rejects.toThrow();
    await expect(
      agentOne.mutation(organizations.recordServiceAccountUsage, {
        scope: "forum",
        amountMicros: 1,
        idempotencyKey: "usage-request-0004",
      }),
    ).rejects.toThrow();

    expect(
      await owner.query(organizations.getBudget, {
        organizationId: created.organizationId,
        monthKey: monthKey(),
      }),
    ).toMatchObject({ limitMicros: 1_000, spentMicros: 1_000 });
    expect(
      await owner.query(organizations.listUsage, {
        organizationId: created.organizationId,
        monthKey: monthKey(),
      }),
    ).toHaveLength(2);
    await owner.mutation(organizations.revokeServiceAccount, {
      serviceAccountId: firstService.serviceAccountId,
    });
    await expect(
      agentOne.mutation(organizations.recordServiceAccountUsage, {
        scope: "evidence",
        amountMicros: 1,
        idempotencyKey: "usage-request-0005",
      }),
    ).rejects.toThrow();
  });

  test("scope narrowing and global identity revocation fail closed", async () => {
    const t = setup();
    const users = await seedUsers(t);
    const created = await createOrganization(
      t,
      users.ownerOne,
      "scope-org",
      5_000,
    );
    const owner = t.withIdentity({ subject: users.ownerOne });
    const agent = await seedAgent(t, users.ownerOne, "scope-agent", [
      "evidence",
      "forum",
    ]);
    const project = await owner.mutation(organizations.createProject, {
      organizationId: created.organizationId,
      projectKey: "scope-project",
      name: "Scope project",
      allowedAgentScopes: ["evidence", "forum"],
    });
    await owner.mutation(organizations.createServiceAccount, {
      projectId: project.projectId,
      agentId: "scope-agent",
      name: "Scope service",
      allowedScopes: ["evidence", "forum"],
    });
    const principal = t.withIdentity({ subject: agent.userId });
    await owner.mutation(organizations.setProjectAllowedScopes, {
      projectId: project.projectId,
      allowedAgentScopes: ["evidence"],
    });
    await expect(
      principal.mutation(organizations.recordServiceAccountUsage, {
        scope: "forum",
        amountMicros: 1,
        idempotencyKey: "scope-request-0001",
      }),
    ).rejects.toThrow();
    await t.run(async (ctx) => {
      await ctx.db.patch("agentIdentities", agent.identityId, {
        status: "revoked",
        revokedAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await expect(
      principal.mutation(organizations.recordServiceAccountUsage, {
        scope: "evidence",
        amountMicros: 1,
        idempotencyKey: "scope-request-0002",
      }),
    ).rejects.toThrow();
  });

  test("removing a member also revokes every service account owned by that member", async () => {
    const t = setup();
    const users = await seedUsers(t);
    const created = await createOrganization(
      t,
      users.ownerOne,
      "removal-org",
      5_000,
    );
    const owner = t.withIdentity({ subject: users.ownerOne });
    const member = t.withIdentity({ subject: users.member });
    const invite = await owner.mutation(organizations.inviteMember, {
      organizationId: created.organizationId,
      inviteeUserId: users.member,
      role: "developer",
    });
    await member.mutation(organizations.acceptInvite, {
      inviteId: invite.inviteId,
    });
    await owner.mutation(organizations.setMemberRole, {
      organizationId: created.organizationId,
      userId: users.member,
      role: "admin",
    });
    const project = await owner.mutation(organizations.createProject, {
      organizationId: created.organizationId,
      projectKey: "member-service",
      name: "Member service",
      allowedAgentScopes: ["evidence"],
    });
    const agent = await seedAgent(t, users.member, "member-agent", [
      "evidence",
    ]);
    await member.mutation(organizations.createServiceAccount, {
      projectId: project.projectId,
      agentId: "member-agent",
      name: "Member-owned service",
      allowedScopes: ["evidence"],
    });
    await expect(
      owner.mutation(organizations.removeMember, {
        organizationId: created.organizationId,
        userId: users.member,
      }),
    ).resolves.toMatchObject({ removed: true, revokedServiceAccounts: 1 });
    await expect(
      t
        .withIdentity({ subject: agent.userId })
        .mutation(organizations.recordServiceAccountUsage, {
          scope: "evidence",
          amountMicros: 1,
          idempotencyKey: "removed-request-0001",
        }),
    ).rejects.toThrow();
    const events = await owner.query(organizations.listAuditLog, {
      organizationId: created.organizationId,
      limit: 50,
    });
    expect(
      events.map((event: { eventType: string }) => event.eventType),
    ).toEqual(
      expect.arrayContaining(["service_account_revoked", "member_removed"]),
    );
  });
});
