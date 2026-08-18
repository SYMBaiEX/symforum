"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SignInPanel } from "@/components/signin-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { convexRefs, type AgentScope } from "@/lib/convex-refs";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const ORGANIZATION_ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "developer", label: "Developer" },
  { value: "auditor", label: "Auditor" },
] as const;

const AGENT_SCOPE_OPTIONS: Array<{
  value: AgentScope;
  label: string;
  detail: string;
}> = [
  { value: "forum", label: "Forum", detail: "Public forum participation." },
  {
    value: "newsletter",
    label: "Newsletter",
    detail: "Newsletter subscription management.",
  },
  {
    value: "interactions",
    label: "Interactions",
    detail: "Votes and saves on supported content.",
  },
  {
    value: "comments",
    label: "Comments",
    detail: "Comment publishing and edits.",
  },
  {
    value: "evidence",
    label: "Research API",
    detail: "Evidence search, jobs, and exports.",
  },
];

const USERNAME_LOOKUP_PATTERN = /^sym-\d{1,8}$|^[a-z0-9][a-z0-9_-]{2,31}$/i;

export function DeveloperOrganizationConsole() {
  const organizationsApi = (api as any).organizations;
  const viewer = useQuery(convexRefs.users.maybeViewer, {});
  const organizations = useQuery(
    organizationsApi.listMine,
    viewer && !viewer.isAgent ? {} : "skip",
  );
  const pendingInvites = useQuery(
    organizationsApi.listMyPendingInvites,
    viewer && !viewer.isAgent ? { limit: 20 } : "skip",
  );
  const agentStatus = useQuery(
    convexRefs.agentIdentity.listMyAgentConsoleStatus,
    viewer && !viewer.isAgent ? {} : "skip",
  );

  const createOrganization = useMutation(organizationsApi.create);
  const acceptInvite = useMutation(organizationsApi.acceptInvite);
  const inviteMember = useMutation(organizationsApi.inviteMember);
  const revokeInvite = useMutation(organizationsApi.revokeInvite);
  const setMemberRole = useMutation(organizationsApi.setMemberRole);
  const transferOwnership = useMutation(organizationsApi.transferOwnership);
  const removeMember = useMutation(organizationsApi.removeMember);
  const createProject = useMutation(organizationsApi.createProject);
  const setProjectAllowedScopes = useMutation(
    organizationsApi.setProjectAllowedScopes,
  );
  const createServiceAccount = useMutation(
    organizationsApi.createServiceAccount,
  );
  const revokeServiceAccount = useMutation(
    organizationsApi.revokeServiceAccount,
  );
  const setBudget = useMutation(organizationsApi.setBudget);

  const [selectedOrganizationId, setSelectedOrganizationId] = useState<
    Id<"organizations"> | null
  >(null);
  const activeOrganizationId =
    selectedOrganizationId ?? organizations?.[0]?.organizationId ?? null;
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [organizationBudgetUsd, setOrganizationBudgetUsd] = useState("0");
  const [inviteUsernameValue, setInviteUsernameValue] = useState("");
  const [inviteRole, setInviteRole] = useState<
    (typeof ORGANIZATION_ROLE_OPTIONS)[number]["value"]
  >("developer");
  const [projectKey, setProjectKey] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectScopes, setProjectScopes] = useState<AgentScope[]>(["evidence"]);
  const [selectedProjectId, setSelectedProjectId] = useState<
    Id<"organizationProjects"> | null
  >(null);
  const [editingProjectId, setEditingProjectId] = useState<
    Id<"organizationProjects"> | null
  >(null);
  const [editingProjectScopes, setEditingProjectScopes] = useState<AgentScope[]>(
    [],
  );
  const [serviceAccountProjectId, setServiceAccountProjectId] = useState<
    Id<"organizationProjects"> | null
  >(null);
  const [serviceAccountAgentId, setServiceAccountAgentId] = useState("");
  const [serviceAccountName, setServiceAccountName] = useState("");
  const [serviceAccountScopes, setServiceAccountScopes] = useState<AgentScope[]>(
    [],
  );
  const [budgetUsdValue, setBudgetUsdValue] = useState("0");
  const [pending, setPending] = useState<string | null>(null);
  const organizationConsole = useQuery(
    organizationsApi.getConsole,
    viewer && !viewer.isAgent && activeOrganizationId
      ? { organizationId: activeOrganizationId }
      : "skip",
  );

  const normalizedInviteUsername = inviteLookupCandidate(inviteUsernameValue);
  const inviteLookup = useQuery(
    organizationsApi.lookupInviteeByUsername,
    viewer &&
      !viewer.isAgent &&
      activeOrganizationId &&
      organizationConsole?.permissions.canInviteMember &&
      normalizedInviteUsername !== null
      ? {
          organizationId: activeOrganizationId,
          username: normalizedInviteUsername,
        }
      : "skip",
  );

  useEffect(() => {
    if (organizations === undefined || organizations.length === 0) {
      if (selectedOrganizationId !== null) setSelectedOrganizationId(null);
      return;
    }
    if (
      selectedOrganizationId === null ||
      !organizations.some(
        (organization: any) =>
          organization.organizationId === selectedOrganizationId,
      )
    ) {
      setSelectedOrganizationId(organizations[0].organizationId);
    }
  }, [organizations, selectedOrganizationId]);

  useEffect(() => {
    if (organizationConsole === undefined) return;
    setBudgetUsdValue(microsToUsdInput(organizationConsole.budget.limitMicros));
    if (
      organizationConsole.projects.length > 0 &&
      (selectedProjectId === null ||
        !organizationConsole.projects.some(
          (project: any) => project.projectId === selectedProjectId,
        ))
    ) {
      setSelectedProjectId(organizationConsole.projects[0].projectId);
    }
    if (
      organizationConsole.projects.length > 0 &&
      (serviceAccountProjectId === null ||
        !organizationConsole.projects.some(
          (project: any) => project.projectId === serviceAccountProjectId,
        ))
    ) {
      setServiceAccountProjectId(organizationConsole.projects[0].projectId);
    }
    if (
      editingProjectId !== null &&
      !organizationConsole.projects.some(
        (project: any) => project.projectId === editingProjectId,
      )
    ) {
      setEditingProjectId(null);
      setEditingProjectScopes([]);
    }
  }, [
    editingProjectId,
    organizationConsole,
    selectedProjectId,
    serviceAccountProjectId,
  ]);

  const serviceAccountProject =
    organizationConsole?.projects.find(
      (project: any) => project.projectId === serviceAccountProjectId,
    ) ?? null;

  const activeOwnedAgents = useMemo(
    () => (agentStatus?.agents ?? []).filter((agent) => agent.status === "active"),
    [agentStatus],
  );

  const selectedOwnedAgent =
    activeOwnedAgents.find((agent) => agent.agentId === serviceAccountAgentId) ??
    null;

  const recommendedServiceScopes = useMemo(() => {
    if (serviceAccountProject === null || selectedOwnedAgent === null) return [];
    return selectedOwnedAgent.scopes.filter((scope) =>
      serviceAccountProject.allowedAgentScopes.includes(scope),
    );
  }, [selectedOwnedAgent, serviceAccountProject]);

  useEffect(() => {
    if (recommendedServiceScopes.length === 0) {
      setServiceAccountScopes([]);
      return;
    }
    setServiceAccountScopes((current) => {
      const validCurrent = current.filter((scope) =>
        recommendedServiceScopes.includes(scope),
      );
      return validCurrent.length > 0
        ? validCurrent
        : [...recommendedServiceScopes];
    });
  }, [recommendedServiceScopes]);

  if (viewer === undefined) {
    return <div className="h-72 animate-pulse border border-row-border bg-card" />;
  }
  if (viewer === null) {
    return (
      <section className="max-w-xl space-y-4 border border-row-border bg-card p-5">
        <h2 className="text-xl font-semibold">Sign in to manage organizations</h2>
        <p className="text-sm leading-7 text-muted-foreground">
          This console is limited to your first-party human account.
        </p>
        <SignInPanel />
      </section>
    );
  }
  if (viewer.isAgent) {
    return (
      <section className="max-w-xl border border-row-border bg-card p-5">
        <h2 className="text-xl font-semibold">Human account required</h2>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          Enrolled agents cannot manage organizations, projects, or shared
          budgets. Sign in with the human account that owns the organization.
        </p>
      </section>
    );
  }

  async function submitCreateOrganization() {
    const slug = organizationSlug.trim();
    const name = organizationName.trim();
    const monthlyBudgetMicros = usdToMicros(organizationBudgetUsd);
    if (!slug || !name || monthlyBudgetMicros === null) {
      toast.error("Enter a slug, a name, and a valid monthly USD budget.");
      return;
    }
    setPending("organization:create");
    try {
      const created = await createOrganization({
        slug,
        name,
        monthlyBudgetMicros,
      });
      setOrganizationSlug("");
      setOrganizationName("");
      setOrganizationBudgetUsd("0");
      setSelectedOrganizationId(created.organizationId);
      toast.success("Organization created.");
    } catch (error) {
      toast.error(
        errorMessage(error, "The organization could not be created."),
      );
    } finally {
      setPending(null);
    }
  }

  async function submitAcceptInvite(inviteId: Id<"organizationInvites">) {
    setPending(`invite:accept:${String(inviteId)}`);
    try {
      const result = await acceptInvite({ inviteId });
      setSelectedOrganizationId(result.organizationId);
      toast.success("Invite accepted.");
    } catch (error) {
      toast.error(errorMessage(error, "The invite could not be accepted."));
    } finally {
      setPending(null);
    }
  }

  async function submitInvite() {
    if (
      activeOrganizationId === null ||
      organizationConsole === undefined ||
      !organizationConsole.permissions.canInviteMember
    ) {
      toast.error("Invite access is unavailable.");
      return;
    }
    if (normalizedInviteUsername === null) {
      toast.error("Enter a valid exact SYM username.");
      return;
    }
    if (inviteLookup === null || inviteLookup === undefined) {
      toast.error("That human account was not found.");
      return;
    }
    setPending(`invite:create:${inviteLookup.userId}`);
    try {
      await inviteMember({
        organizationId: activeOrganizationId,
        inviteeUserId: inviteLookup.userId,
        role: inviteRole,
      });
      setInviteUsernameValue("");
      setInviteRole("developer");
      toast.success("Invite sent.");
    } catch (error) {
      toast.error(errorMessage(error, "The invite could not be created."));
    } finally {
      setPending(null);
    }
  }

  async function submitRevokeInvite(inviteId: Id<"organizationInvites">) {
    setPending(`invite:revoke:${String(inviteId)}`);
    try {
      await revokeInvite({ inviteId });
      toast.success("Invite revoked.");
    } catch (error) {
      toast.error(errorMessage(error, "The invite could not be revoked."));
    } finally {
      setPending(null);
    }
  }

  async function submitSetRole(
    userId: Id<"users">,
    role: (typeof ORGANIZATION_ROLE_OPTIONS)[number]["value"],
  ) {
    if (activeOrganizationId === null) return;
    setPending(`member:role:${String(userId)}`);
    try {
      await setMemberRole({ organizationId: activeOrganizationId, userId, role });
      toast.success("Member role updated.");
    } catch (error) {
      toast.error(errorMessage(error, "The member role could not be updated."));
    } finally {
      setPending(null);
    }
  }

  async function submitTransferOwnership(userId: Id<"users">, name: string) {
    if (activeOrganizationId === null) return;
    if (!window.confirm(`Transfer ownership to ${name}?`)) return;
    setPending(`member:owner:${String(userId)}`);
    try {
      await transferOwnership({
        organizationId: activeOrganizationId,
        targetUserId: userId,
      });
      toast.success("Ownership transferred.");
    } catch (error) {
      toast.error(errorMessage(error, "Ownership could not be transferred."));
    } finally {
      setPending(null);
    }
  }

  async function submitRemoveMember(userId: Id<"users">, name: string) {
    if (activeOrganizationId === null) return;
    if (!window.confirm(`Remove ${name} from this organization?`)) return;
    setPending(`member:remove:${String(userId)}`);
    try {
      await removeMember({ organizationId: activeOrganizationId, userId });
      toast.success("Member removed.");
    } catch (error) {
      toast.error(errorMessage(error, "The member could not be removed."));
    } finally {
      setPending(null);
    }
  }

  async function submitCreateProject() {
    if (activeOrganizationId === null) return;
    const key = projectKey.trim();
    const name = projectName.trim();
    if (!key || !name) {
      toast.error("Enter a project key and name.");
      return;
    }
    setPending("project:create");
    try {
      const created = await createProject({
        organizationId: activeOrganizationId,
        projectKey: key,
        name,
        allowedAgentScopes: projectScopes,
      });
      setProjectKey("");
      setProjectName("");
      setProjectScopes(["evidence"]);
      setSelectedProjectId(created.projectId);
      setServiceAccountProjectId(created.projectId);
      toast.success("Project created.");
    } catch (error) {
      toast.error(errorMessage(error, "The project could not be created."));
    } finally {
      setPending(null);
    }
  }

  async function submitProjectScopeUpdate() {
    if (editingProjectId === null) return;
    setPending(`project:scopes:${String(editingProjectId)}`);
    try {
      await setProjectAllowedScopes({
        projectId: editingProjectId,
        allowedAgentScopes: editingProjectScopes,
      });
      setEditingProjectId(null);
      setEditingProjectScopes([]);
      toast.success("Project scopes updated.");
    } catch (error) {
      toast.error(
        errorMessage(error, "The project scopes could not be updated."),
      );
    } finally {
      setPending(null);
    }
  }

  async function submitCreateServiceAccount() {
    if (serviceAccountProject === null || selectedOwnedAgent === null) {
      toast.error("Choose a project and an enrolled agent.");
      return;
    }
    const name = serviceAccountName.trim();
    if (!name || serviceAccountScopes.length === 0) {
      toast.error("Enter a service-account name and at least one scope.");
      return;
    }
    setPending(`service:create:${serviceAccountProject.projectId}`);
    try {
      await createServiceAccount({
        projectId: serviceAccountProject.projectId,
        agentId: selectedOwnedAgent.agentId,
        name,
        allowedScopes: serviceAccountScopes,
      });
      setServiceAccountName("");
      toast.success("Service account created.");
    } catch (error) {
      toast.error(
        errorMessage(error, "The service account could not be created."),
      );
    } finally {
      setPending(null);
    }
  }

  async function submitRevokeServiceAccount(
    serviceAccountId: Id<"organizationServiceAccounts">,
    name: string,
  ) {
    if (!window.confirm(`Revoke ${name}?`)) return;
    setPending(`service:revoke:${String(serviceAccountId)}`);
    try {
      await revokeServiceAccount({ serviceAccountId });
      toast.success("Service account revoked.");
    } catch (error) {
      toast.error(
        errorMessage(error, "The service account could not be revoked."),
      );
    } finally {
      setPending(null);
    }
  }

  async function submitBudgetUpdate() {
    if (activeOrganizationId === null) return;
    const monthlyLimitMicros = usdToMicros(budgetUsdValue);
    if (monthlyLimitMicros === null) {
      toast.error("Enter a valid USD budget.");
      return;
    }
    setPending("budget:update");
    try {
      await setBudget({ organizationId: activeOrganizationId, monthlyLimitMicros });
      toast.success("Budget updated.");
    } catch (error) {
      toast.error(errorMessage(error, "The budget could not be updated."));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4 border border-row-border bg-card p-5">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            First-party organizations
          </p>
          <h2 className="mt-2 text-xl font-semibold">
            Human-managed tenants and service accounts
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
            This surface stays private to the signed-in human account. It uses
            the existing organization, project, budget, and service-account
            mutations without advertising a public organization API.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="space-y-3 border border-row-border bg-background/50 p-4">
            <h3 className="font-semibold">Create organization</h3>
            <label className="flex flex-col gap-2 text-sm">
              Slug
              <Input
                value={organizationSlug}
                onChange={(event) => setOrganizationSlug(event.target.value)}
                placeholder="acme-research"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              Name
              <Input
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                placeholder="Acme Research"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              Monthly USD budget
              <Input
                value={organizationBudgetUsd}
                onChange={(event) => setOrganizationBudgetUsd(event.target.value)}
                inputMode="decimal"
                placeholder="25.00"
              />
            </label>
            <Button
              disabled={pending === "organization:create"}
              onClick={() => void submitCreateOrganization()}
              type="button"
            >
              {pending === "organization:create" ? "Creating..." : "Create organization"}
            </Button>
          </div>

          <div className="space-y-3 border border-row-border bg-background/50 p-4">
            <h3 className="font-semibold">Pending invites</h3>
            {pendingInvites === undefined ? (
              <div className="h-16 animate-pulse bg-muted/30" />
            ) : pendingInvites.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No pending invites for this account.
              </p>
            ) : (
              <div className="space-y-2">
                {pendingInvites.map((invite: any) => (
                  <div
                    className="flex items-center justify-between gap-3 border border-row-border p-3"
                    key={invite.inviteId}
                  >
                    <div>
                      <p className="font-medium">{invite.organizationName}</p>
                      <p className="text-xs text-muted-foreground">
                        {invite.role} · expires{" "}
                        {new Date(invite.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      disabled={pending === `invite:accept:${String(invite.inviteId)}`}
                      onClick={() => void submitAcceptInvite(invite.inviteId)}
                      size="sm"
                      type="button"
                    >
                      Accept
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-4 border border-row-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Organization detail</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Review memberships, projects, service accounts, budget spend, and
              audit history for one organization.
            </p>
          </div>
          {organizations === undefined ? (
            <div className="h-10 w-48 animate-pulse bg-muted/30" />
          ) : organizations.length === 0 ? null : (
            <select
              className="h-10 min-w-56 border border-row-border bg-background px-3 text-sm"
              onChange={(event) =>
                setSelectedOrganizationId(
                  event.target.value as Id<"organizations">,
                )
              }
              value={activeOrganizationId ?? ""}
            >
              {organizations.map((organization: any) => (
                <option
                  key={organization.organizationId}
                  value={organization.organizationId}
                >
                  {organization.name} · {organization.role}
                </option>
              ))}
            </select>
          )}
        </div>

        {organizations !== undefined && organizations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Create or accept an organization before managing shared projects and
            service accounts.
          </p>
        ) : organizationConsole === undefined ? (
          <div className="h-72 animate-pulse border border-row-border bg-background/50" />
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-4">
              <SummaryCard
                label="Role"
                value={organizationConsole.organization.role}
                detail={organizationConsole.organization.slug}
              />
              <SummaryCard
                label="Members"
                value={String(organizationConsole.members.length)}
                detail={`${organizationConsole.invites.length} pending invite${organizationConsole.invites.length === 1 ? "" : "s"}`}
              />
              <SummaryCard
                label="Projects"
                value={String(organizationConsole.projects.length)}
                detail={`${organizationConsole.serviceAccounts.length} active service account${organizationConsole.serviceAccounts.length === 1 ? "" : "s"}`}
              />
              <SummaryCard
                label="Budget"
                value={formatUsd(organizationConsole.budget.spentMicros)}
                detail={`${formatUsd(organizationConsole.budget.remainingMicros)} remaining`}
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <section className="space-y-3 border border-row-border bg-background/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">Members</h3>
                  <p className="text-xs text-muted-foreground">
                    {organizationConsole.organization.name}
                  </p>
                </div>
                {organizationConsole.members.map((member: any) => (
                  <div
                    className="space-y-3 border border-row-border p-3"
                    key={member.membershipId}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{member.name}</p>
                        <p className="text-xs text-muted-foreground">
                          @{member.username}
                          {member.isCurrentActor ? " · you" : ""}
                        </p>
                      </div>
                      <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                        {member.role}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Joined {new Date(member.joinedAt).toLocaleDateString()}
                    </p>
                    {organizationConsole.permissions.canTransferOwnership &&
                    member.role !== "owner" ? (
                      <div className="flex flex-wrap gap-2">
                        <select
                          className="h-9 min-w-36 border border-row-border bg-background px-3 text-sm"
                          defaultValue={member.role}
                          onChange={(event) => {
                            const role = event.target.value as
                              (typeof ORGANIZATION_ROLE_OPTIONS)[number]["value"];
                            void submitSetRole(member.userId, role);
                          }}
                        >
                          {ORGANIZATION_ROLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <Button
                          onClick={() =>
                            void submitTransferOwnership(member.userId, member.name)
                          }
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Transfer ownership
                        </Button>
                      </div>
                    ) : null}
                    {organizationConsole.permissions.canManageMembers &&
                    member.role !== "owner" ? (
                      <Button
                        disabled={pending === `member:remove:${String(member.userId)}`}
                        onClick={() => void submitRemoveMember(member.userId, member.name)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Remove member
                      </Button>
                    ) : null}
                  </div>
                ))}
              </section>

              <section className="space-y-3 border border-row-border bg-background/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">Invites and budget</h3>
                  <p className="text-xs text-muted-foreground">
                    Month {organizationConsole.budget.monthKey}
                  </p>
                </div>
                {organizationConsole.permissions.canInviteMember ? (
                  <div className="space-y-3 border border-row-border p-3">
                    <p className="text-sm font-medium">Invite member</p>
                    <label className="flex flex-col gap-2 text-sm">
                      Exact SYM username
                      <Input
                        value={inviteUsernameValue}
                        onChange={(event) =>
                          setInviteUsernameValue(event.target.value)
                        }
                        placeholder="member"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-sm">
                      Role
                      <select
                        className="h-10 border border-row-border bg-background px-3 text-sm"
                        onChange={(event) =>
                          setInviteRole(
                            event.target.value as (typeof ORGANIZATION_ROLE_OPTIONS)[number]["value"],
                          )
                        }
                        value={inviteRole}
                      >
                        {ORGANIZATION_ROLE_OPTIONS.filter(
                          (option) =>
                            option.value !== "admin" ||
                            organizationConsole.permissions.canInviteAdmin,
                        ).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="text-xs text-muted-foreground">
                      {inviteLookup
                        ? `Resolved to ${inviteLookup.name} (@${inviteLookup.username}).`
                        : normalizedInviteUsername === null
                          ? "Use an exact existing username; agents cannot be invited."
                          : "No matching human account found yet."}
                    </p>
                    <Button
                      disabled={pending?.startsWith("invite:create:") ?? false}
                      onClick={() => void submitInvite()}
                      type="button"
                    >
                      Send invite
                    </Button>
                  </div>
                ) : null}
                {organizationConsole.permissions.canSetBudget ? (
                  <div className="space-y-3 border border-row-border p-3">
                    <p className="text-sm font-medium">Shared monthly budget</p>
                    <label className="flex flex-col gap-2 text-sm">
                      Monthly USD limit
                      <Input
                        value={budgetUsdValue}
                        onChange={(event) => setBudgetUsdValue(event.target.value)}
                        inputMode="decimal"
                      />
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Spent {formatUsd(organizationConsole.budget.spentMicros)} of{" "}
                      {formatUsd(organizationConsole.budget.limitMicros)}.
                    </p>
                    <Button
                      disabled={pending === "budget:update"}
                      onClick={() => void submitBudgetUpdate()}
                      type="button"
                    >
                      Update budget
                    </Button>
                  </div>
                ) : null}
                {organizationConsole.invites.length > 0 ? (
                  <div className="space-y-2">
                    {organizationConsole.invites.map((invite: any) => (
                      <div
                        className="flex items-center justify-between gap-3 border border-row-border p-3"
                        key={invite.inviteId}
                      >
                        <div>
                          <p className="font-medium">{invite.inviteeName}</p>
                          <p className="text-xs text-muted-foreground">
                            @{invite.inviteeUsername} · {invite.role}
                          </p>
                        </div>
                        <Button
                          disabled={
                            pending === `invite:revoke:${String(invite.inviteId)}`
                          }
                          onClick={() => void submitRevokeInvite(invite.inviteId)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Revoke
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No pending invites for this organization.
                  </p>
                )}
              </section>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
              <section className="space-y-4 border border-row-border bg-background/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">Projects</h3>
                  <p className="text-xs text-muted-foreground">
                    Shared scope boundaries
                  </p>
                </div>
                {organizationConsole.permissions.canCreateProjects ? (
                  <div className="space-y-3 border border-row-border p-3">
                    <p className="text-sm font-medium">Create project</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-2 text-sm">
                        Project key
                        <Input
                          value={projectKey}
                          onChange={(event) => setProjectKey(event.target.value)}
                          placeholder="research"
                        />
                      </label>
                      <label className="flex flex-col gap-2 text-sm">
                        Name
                        <Input
                          value={projectName}
                          onChange={(event) => setProjectName(event.target.value)}
                          placeholder="Research"
                        />
                      </label>
                    </div>
                    <ScopeChooser
                      onChange={setProjectScopes}
                      selected={projectScopes}
                      title="Allowed agent scopes"
                    />
                    <Button
                      disabled={pending === "project:create"}
                      onClick={() => void submitCreateProject()}
                      type="button"
                    >
                      Create project
                    </Button>
                  </div>
                ) : null}
                {organizationConsole.projects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No projects yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {organizationConsole.projects.map((project: any) => (
                      <div
                        className="space-y-3 border border-row-border p-3"
                        key={project.projectId}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">{project.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {project.projectKey}
                            </p>
                          </div>
                          <Button
                            onClick={() => {
                              setSelectedProjectId(project.projectId);
                              setEditingProjectId(project.projectId);
                              setEditingProjectScopes([...project.allowedAgentScopes]);
                            }}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            {editingProjectId === project.projectId
                              ? "Editing"
                              : "Edit scopes"}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Scopes: {project.allowedAgentScopes.join(", ") || "none"}
                        </p>
                        {editingProjectId === project.projectId &&
                        organizationConsole.permissions.canManageProjectScopes ? (
                          <div className="space-y-3 border border-row-border bg-card p-3">
                            <ScopeChooser
                              onChange={setEditingProjectScopes}
                              selected={editingProjectScopes}
                              title="Updated scopes"
                            />
                            <div className="flex gap-2">
                              <Button
                                disabled={
                                  pending === `project:scopes:${String(project.projectId)}`
                                }
                                onClick={() => void submitProjectScopeUpdate()}
                                size="sm"
                                type="button"
                              >
                                Save scopes
                              </Button>
                              <Button
                                onClick={() => {
                                  setEditingProjectId(null);
                                  setEditingProjectScopes([]);
                                }}
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-4 border border-row-border bg-background/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">Service accounts</h3>
                  <p className="text-xs text-muted-foreground">
                    Active human-owned agent bindings
                  </p>
                </div>
                {organizationConsole.permissions.canManageServiceAccounts ? (
                  <div className="space-y-3 border border-row-border p-3">
                    <p className="text-sm font-medium">Create service account</p>
                    <label className="flex flex-col gap-2 text-sm">
                      Project
                      <select
                        className="h-10 border border-row-border bg-background px-3 text-sm"
                        onChange={(event) =>
                          setServiceAccountProjectId(
                            event.target.value as Id<"organizationProjects">,
                          )
                        }
                        value={serviceAccountProjectId ?? ""}
                      >
                        {organizationConsole.projects.map((project: any) => (
                          <option key={project.projectId} value={project.projectId}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-2 text-sm">
                      Owner-enrolled agent
                      <select
                        className="h-10 border border-row-border bg-background px-3 text-sm"
                        onChange={(event) =>
                          setServiceAccountAgentId(event.target.value)
                        }
                        value={serviceAccountAgentId}
                      >
                        <option value="">Choose an agent</option>
                        {activeOwnedAgents.map((agent) => (
                          <option key={agent.agentId} value={agent.agentId}>
                            {agent.agentId}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-2 text-sm">
                      Service-account name
                      <Input
                        value={serviceAccountName}
                        onChange={(event) => setServiceAccountName(event.target.value)}
                        placeholder="Research crawler"
                      />
                    </label>
                    <ScopeChooser
                      details={false}
                      onChange={setServiceAccountScopes}
                      selected={serviceAccountScopes}
                      title="Allowed scopes"
                      whitelist={recommendedServiceScopes}
                    />
                    <p className="text-xs text-muted-foreground">
                      Only scopes allowed by both the selected project and the
                      selected enrolled agent can be bound here.
                    </p>
                    <Button
                      disabled={pending?.startsWith("service:create:") ?? false}
                      onClick={() => void submitCreateServiceAccount()}
                      type="button"
                    >
                      Create service account
                    </Button>
                  </div>
                ) : null}

                {organizationConsole.serviceAccounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No active service accounts yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {organizationConsole.serviceAccounts.map((serviceAccount: any) => (
                      <div
                        className="space-y-2 border border-row-border p-3"
                        key={serviceAccount.serviceAccountId}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">{serviceAccount.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {serviceAccount.projectName} · {serviceAccount.agentId}
                            </p>
                          </div>
                          {organizationConsole.permissions.canManageServiceAccounts ? (
                            <Button
                              disabled={
                                pending ===
                                `service:revoke:${String(
                                  serviceAccount.serviceAccountId,
                                )}`
                              }
                              onClick={() =>
                                void submitRevokeServiceAccount(
                                  serviceAccount.serviceAccountId,
                                  serviceAccount.name,
                                )
                              }
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              Revoke
                            </Button>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Owner {serviceAccount.ownerName} · scopes{" "}
                          {serviceAccount.allowedScopes.join(", ") || "none"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <section className="space-y-3 border border-row-border bg-background/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">Recent usage</h3>
                  <p className="text-xs text-muted-foreground">
                    {organizationConsole.budget.monthKey}
                  </p>
                </div>
                {organizationConsole.usage.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No shared usage has been recorded this month.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {organizationConsole.usage.map((row: any) => (
                      <div
                        className="flex items-center justify-between gap-3 border border-row-border p-3"
                        key={row.usageId}
                      >
                        <div>
                          <p className="font-medium">{row.projectName}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.serviceAccountName} · {row.scope}
                          </p>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <p className="font-mono text-foreground">
                            {formatUsd(row.amountMicros)}
                          </p>
                          <p>after {formatUsd(row.spentAfterMicros)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-3 border border-row-border bg-background/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">Audit trail</h3>
                  <p className="text-xs text-muted-foreground">
                    Human-only management log
                  </p>
                </div>
                {organizationConsole.audit.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No audit records yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {organizationConsole.audit.map((row: any) => (
                      <div
                        className="space-y-1 border border-row-border p-3"
                        key={row.auditId}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium">{row.eventType}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(row.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {row.actorName}
                          {row.targetUserName ? ` -> ${row.targetUserName}` : ""}
                          {row.projectName ? ` · ${row.projectName}` : ""}
                          {row.serviceAccountName
                            ? ` · ${row.serviceAccountName}`
                            : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ScopeChooser({
  title,
  selected,
  onChange,
  whitelist,
  details = true,
}: {
  title: string;
  selected: AgentScope[];
  onChange: (value: AgentScope[]) => void;
  whitelist?: AgentScope[];
  details?: boolean;
}) {
  const options =
    whitelist === undefined
      ? AGENT_SCOPE_OPTIONS
      : AGENT_SCOPE_OPTIONS.filter((option) => whitelist.includes(option.value));

  function toggle(scope: AgentScope) {
    onChange(
      selected.includes(scope)
        ? selected.filter((value) => value !== scope)
        : [...selected, scope],
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      <div className="grid gap-2">
        {options.map((option) => (
          <label
            className="flex items-start gap-3 border border-row-border p-2 text-sm"
            key={option.value}
          >
            <input
              checked={selected.includes(option.value)}
              className="mt-1"
              onChange={() => toggle(option.value)}
              type="checkbox"
            />
            <span>
              <span className="font-medium">{option.label}</span>
              {details ? (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {option.detail}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border border-row-border bg-background/50 p-3">
      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function usdToMicros(value: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const micros = Math.round(amount * 1_000_000);
  return Number.isSafeInteger(micros) ? micros : null;
}

function microsToUsdInput(value: number) {
  return (value / 1_000_000).toFixed(2);
}

function formatUsd(value: number) {
  return `$${(value / 1_000_000).toFixed(2)}`;
}

function inviteLookupCandidate(value: string) {
  const candidate = value.trim().toLowerCase();
  if (!USERNAME_LOOKUP_PATTERN.test(candidate)) return null;
  return candidate;
}

function errorMessage(error: unknown, fallback: string) {
  const data = error instanceof ConvexError ? error.data : null;
  if (typeof data === "string" && data.length > 0) return data;
  if (
    data &&
    typeof data === "object" &&
    "message" in data &&
    typeof data.message === "string" &&
    data.message.length > 0
  ) {
    return data.message;
  }
  return fallback;
}
