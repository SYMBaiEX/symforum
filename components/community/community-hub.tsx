"use client";

import {
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowUpRight,
  ExternalLink,
  Heart,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CommerceWalletButton,
  CommerceWalletProvider,
  useCommerceIdentity,
  useCommerceWallet,
} from "@/components/swap/commerce-wallet";
import type { CommerceWalletClient } from "@/lib/commerce-wallet-client";
import {
  communityHttpsUrl,
  communityText,
  lamportsToSol,
  solToLamports,
} from "@/lib/forum-community";
import { useForumRuntime } from "@/components/forum/forum-runtime-context";
import { ForumLink } from "@/components/forum/forum-link";
import { forumSiteUrl } from "@/lib/site-urls";
import { useTerminalAttention } from "@/components/trading/terminal-attention";
import styles from "./community-hub.module.css";
import {
  communityHref,
  communityRoute,
  communitySignInHref,
  type CommunitySection,
} from "@/lib/community-navigation";

type Payment = FunctionReturnType<typeof api.forumCommunity.preparePayment>;
type Work = FunctionReturnType<typeof api.forumCommunity.listBounties>[number];
type Project = FunctionReturnType<
  typeof api.forumCommunity.listProjects
>[number];
type AffiliationDraft = { mint: string; claim: Project["claims"][number] };
type Submission = FunctionReturnType<
  typeof api.forumCommunity.listSubmissions
>[number];
type Section = CommunitySection;
const external = { target: "_blank", rel: "noopener noreferrer" } as const;
function safeMessage(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    typeof error.data === "string"
  )
    return error.data;
  return "This action could not complete. Check your connection and try again.";
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}
function useMinute() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 60_000) * 60_000);
    const interval = setInterval(
      () => setNow(Math.floor(Date.now() / 60_000) * 60_000),
      60_000,
    );
    return () => clearInterval(interval);
  }, []);
  return now;
}

export function CommunityHub({
  mint,
  compact = false,
}: {
  mint?: string;
  compact?: boolean;
}) {
  const { host } = useForumRuntime();
  if (host !== "website")
    return (
      <Suspense fallback={<p role="status">Loading community link…</p>}>
        <CommunityHandoff mint={mint} />
      </Suspense>
    );
  return (
    <CommerceWalletProvider>
      <Suspense fallback={<p role="status">Loading community utilities…</p>}>
        <CommunityContent mint={mint} compact={compact} />
      </Suspense>
    </CommerceWalletProvider>
  );
}
function CommunityHandoff({ mint }: { mint?: string }) {
  const route = communityRoute(useSearchParams());
  return (
    <section className={styles.panel}>
      <h2>Community projects and rewards</h2>
      <p className={styles.muted}>
        Open the forum to manage wallet-linked project claims, author tips and
        sponsor-funded work.
      </p>
      <div className={styles.actions}>
        <Button asChild>
          <a
            href={forumSiteUrl(
              communityHref({
                ...route,
                mint: route.invalid ? undefined : (route.mint ?? mint),
              }),
            )}
            {...external}
          >
            Open community <ExternalLink aria-hidden="true" />
          </a>
        </Button>
      </div>
    </section>
  );
}
function CommunityContent({
  mint: suppliedMint,
  compact,
}: {
  mint?: string;
  compact: boolean;
}) {
  const params = useSearchParams();
  const search = params.toString();
  const route = communityRoute(params);
  // The terminal's live selection is local state and can differ from its URL.
  const mint = compact
    ? suppliedMint
    : route.invalid
      ? undefined
      : (route.mint ?? suppliedMint);
  const [section, setSection] = useState<Section>(route.section),
    [previousSearch, setPreviousSearch] = useState(search),
    [receiptsVisited, setReceiptsVisited] = useState(false),
    [payment, setPayment] = useState<Payment | null>(null);
  const client = useCommerceWallet();
  const contentId = useId();
  const sectionLabels = {
    projects: "Project hubs",
    work: "Bounties & research",
    support: "Tips & profile",
    receipts: "Your receipts",
  };
  if (search !== previousSearch) {
    setPreviousSearch(search);
    setSection(route.section);
  }
  if (section === "receipts" && !receiptsVisited) setReceiptsVisited(true);
  function navigate(next: Section) {
    if (compact) {
      const query = new URLSearchParams(window.location.search);
      query.set("section", next);
      window.history.pushState(
        null,
        "",
        `${window.location.pathname}?${query}`,
      );
      setSection(next);
      return;
    }
    const path =
      window.location.pathname === "/forum/community"
        ? "/forum/community"
        : "/community";
    window.history.pushState(
      null,
      "",
      communityHref({ section: next, mint, invalid: false }, path),
    );
    setSection(next);
  }
  function goToReceipts() {
    setReceiptsVisited(true);
    navigate("receipts");
  }
  return (
    <div className={`${styles.hub} ${compact ? styles.compact : ""}`}>
      {route.invalid && (
        <p role="status">
          This community link contains invalid options. Showing the public
          project directory; no payment was opened.
        </p>
      )}
      {!compact && (
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>SYMBaiEX / Community</span>
            <h1>Community utilities</h1>
            <p>
              Meet the builders. Commission useful work. Support the people
              behind the posts.
            </p>
          </div>
          <div className={styles.wallet}>
            <span className={styles.eyebrow}>Your community wallet</span>
            <CommerceWalletButton requiredFeature="solana:signTransaction" />
          </div>
        </header>
      )}
      <nav className={styles.nav} aria-label="Community utilities">
        {(
          [
            ["projects", "Project hubs"],
            ["work", "Bounties & research"],
            ["support", "Tips & profile"],
            ["receipts", "Your receipts"],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            variant="ghost"
            aria-pressed={section === id}
            aria-controls={contentId}
            onClick={() => (id === "receipts" ? goToReceipts() : navigate(id))}
          >
            {label}
          </Button>
        ))}
      </nav>
      <div id={contentId} role="region" aria-label={sectionLabels[section]}>
        {section === "projects" && <Projects mint={mint} client={client} />}
        {section === "work" && (
          <WorkBoard mint={mint} client={client} onPayment={setPayment} />
        )}
        {section === "support" && (
          <Support client={client} compact={compact} onPayment={setPayment} />
        )}
        {/* Do not eagerly load private receipts, but retain the existing
            subscription and known protection notice after their first use. */}
        {receiptsVisited && (
          <div hidden={section !== "receipts"}>
            <Receipts
              onPayment={setPayment}
              signInHref={communitySignInHref({
                section: "receipts",
                mint,
                invalid: false,
              })}
            />
          </div>
        )}
      </div>
      <p className={styles.safetyNote}>
        <ShieldCheck size={15} aria-hidden="true" />
        <span>
          Have an unresolved payment?{" "}
          <button type="button" onClick={goToReceipts}>
            Open your receipts
          </button>{" "}
          to check the same attempt. Never pay again to resolve a missing
          receipt.
        </span>
      </p>
      <PaymentDialog payment={payment} onClose={() => setPayment(null)} />
    </div>
  );
}
function Projects({
  mint,
  client,
}: {
  mint?: string;
  client: CommerceWalletClient | null;
}) {
  const projects = useQuery(api.forumCommunity.listProjects, { mint });
  const { isAuthenticated, isLoading } = useConvexAuth();
  const mine = useQuery(
    api.forumCommunity.getMine,
    isAuthenticated && !isLoading ? { now: 0 } : "skip",
  );
  const authorId = isAuthenticated && !isLoading ? mine?.userId : undefined;
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AffiliationDraft | null>(null);
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement | null>(null);
  const searchDescription = useId();
  const term = search.trim();
  const publicTerm = term.toLowerCase();
  const matches = projects?.filter(
    (project) =>
      !term ||
      project.mint.includes(term) ||
      [
        project.name,
        project.symbol,
        ...project.claims.flatMap((claim) => [claim.username, claim.role]),
      ].some((value) => value.toLowerCase().includes(publicTerm)),
  );
  const creationTrigger = useRef<HTMLButtonElement | null>(null);
  const addProjectTrigger = useRef<HTMLButtonElement | null>(null);
  function openCreation(event: MouseEvent<HTMLButtonElement>) {
    creationTrigger.current = event.currentTarget;
    setEditing(null);
    setCreating(true);
  }
  return (
    <div className={styles.directory}>
      <section className={styles.panel}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>Project hubs</h2>
            <p className={styles.muted}>
              {mint
                ? "A hub for this exact mint, with up to 12 public affiliations."
                : "A recent sample of up to 24 hubs and 12 public affiliations per hub, not a complete directory."}
            </p>
          </div>
          <Button ref={addProjectTrigger} onClick={openCreation}>
            <Plus aria-hidden="true" /> Add project
          </Button>
        </div>
        <div className={styles.projectSearch}>
          <Field label="Search loaded projects">
            <Input
              ref={searchInput}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={projects === undefined}
              aria-describedby={searchDescription}
              placeholder="Name, symbol, exact mint or contributor"
              autoComplete="off"
              spellCheck={false}
              maxLength={256}
            />
          </Field>
          {search.length > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSearch("");
                searchInput.current?.focus();
              }}
            >
              Clear search
            </Button>
          )}
        </div>
        <p id={searchDescription} className={styles.muted}>
          Filters only loaded hubs and their public contributor roles and
          handles. Mint matching is case-sensitive. No additional data is
          fetched.
        </p>
        {projects !== undefined && (
          <p
            className={styles.projectCount}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {matches?.length ?? 0} of {projects.length} loaded{" "}
            {projects.length === 1 ? "project" : "projects"}
            {term
              ? matches?.length === 1
                ? " matches this search."
                : " match this search."
              : " shown."}
          </p>
        )}
        <div className={styles.list}>
          {projects === undefined ? (
            <p className={styles.empty} role="status">
              Loading project hubs…
            </p>
          ) : !projects.length ? (
            <div className={styles.empty}>
              <span className={styles.eyebrow}>Project directory</span>
              <h3>
                {mint
                  ? "This mint has no project hub yet."
                  : "The next project starts here."}
              </h3>
              <p>
                Introduce what you are building, add an exact Solana mint and
                make your role clear to the community.
              </p>
              <Button variant="outline" onClick={openCreation}>
                Add the first affiliation <ArrowUpRight aria-hidden="true" />
              </Button>
            </div>
          ) : matches?.length === 0 ? (
            <div className={styles.empty}>
              <h3>No loaded projects match</h3>
              <p>
                Try another term or clear this local search. Other projects may
                exist outside this recent sample.
              </p>
            </div>
          ) : (
            matches?.map((project) => (
              <article className={styles.item} key={project.projectId}>
                <div className={styles.rowHeading}>
                  <h3>
                    {project.name}{" "}
                    <span className={styles.symbol}>{project.symbol}</span>
                  </h3>
                  <a
                    className={styles.rowLink}
                    href={forumSiteUrl(
                      `/trade?mint=${encodeURIComponent(project.mint)}`,
                    )}
                  >
                    Market & discussion{" "}
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </a>
                </div>
                <div className={styles.mintLine}>
                  <span>Mint</span>
                  <code>{project.mint}</code>
                </div>
                {project.claims.map((claim) => (
                  <div className={styles.claim} key={claim.userId}>
                    <div className={styles.meta}>
                      <strong>@{claim.username}</strong>
                      <span>{claim.role}</span>
                      <span className={styles.badge}>
                        Self-declared affiliation
                      </span>
                    </div>
                    <p className={styles.prose}>{claim.description}</p>
                    {claim.website && (
                      <a
                        className={styles.link}
                        href={claim.website}
                        {...external}
                      >
                        Project website
                      </a>
                    )}
                    {authorId === claim.userId && (
                      <div className={styles.actions}>
                        <Button
                          variant="outline"
                          aria-label={`Edit your affiliation for ${project.name}`}
                          onClick={(event) => {
                            creationTrigger.current = event.currentTarget;
                            setEditing({ mint: project.mint, claim });
                            setCreating(true);
                          }}
                        >
                          Edit your affiliation
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </article>
            ))
          )}
        </div>
      </section>
      <aside className={styles.contextNote}>
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <strong>Identity is not endorsement.</strong>
          <p>
            Affiliations are self-declared. A linked wallet proves wallet
            control, not project ownership or safety. Always verify the exact
            mint.
          </p>
        </div>
      </aside>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent
          data-surface="forum"
          className={styles.creationDialog}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (creationTrigger.current?.isConnected)
              creationTrigger.current.focus();
            else addProjectTrigger.current?.focus();
          }}
        >
          {client ? (
            <ProjectForm
              mint={mint}
              client={client}
              editing={editing}
              authorId={authorId}
              authorLoading={
                isLoading || (isAuthenticated && mine === undefined)
              }
            />
          ) : (
            <DialogHeader>
              <DialogTitle>
                {editing ? "Edit your affiliation" : "Introduce your project"}
              </DialogTitle>
              <DialogDescription>Loading wallet…</DialogDescription>
            </DialogHeader>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function ProjectForm({
  mint,
  client,
  editing,
  authorId,
  authorLoading,
}: {
  mint?: string;
  client: CommerceWalletClient;
  editing: AffiliationDraft | null;
  authorId: Id<"users"> | undefined;
  authorLoading: boolean;
}) {
  const identity = useCommerceIdentity(client, "solana:signTransaction"),
    resolveMint = useAction(api.forumCommerce.resolveMint),
    claim = useMutation(api.forumCommunity.createProjectClaim),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const requirementId = useId();
  const mintNoteId = useId();
  const requestVersion = useRef(0);
  // A resolved mint must not publish a retained edit after the actor/wallet
  // changes or the dialog closes. Live claim updates never reset the draft.
  useEffect(
    () => () => {
      requestVersion.current += 1;
    },
    [
      authorId,
      identity.session?.authUserId,
      identity.connected?.account.address,
      identity.linked,
      identity.isLoading,
    ],
  );
  const ownsClaim = !editing || authorId === editing.claim.userId;
  const requirement =
    editing && authorLoading
      ? "Checking the affiliation author…"
      : !ownsClaim
        ? "Sign in as the affiliation author to save changes. Your draft has been kept."
        : !identity.linked
          ? "Sign in and link the selected wallet to your account before saving a public affiliation."
          : undefined;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form),
      wallet = identity.connected?.account.address;
    if (
      !wallet ||
      !identity.linked ||
      identity.isLoading ||
      !ownsClaim ||
      (editing && authorLoading) ||
      busy
    )
      return;
    const version = requestVersion.current;
    setBusy(true);
    setMessage("");
    try {
      const selected = editing?.mint ?? String(data.get("mint") ?? "").trim();
      await resolveMint({ wallet, mint: selected });
      if (editing && version !== requestVersion.current) {
        setMessage(
          "Your account or wallet changed. Review your affiliation before saving again.",
        );
        return;
      }
      await claim({
        wallet,
        mint: selected,
        role: String(data.get("role") ?? ""),
        description: String(data.get("description") ?? ""),
        website: String(data.get("website") ?? "") || undefined,
      });
      setMessage(
        `Affiliation ${editing ? "updated" : "saved"}. It is labelled self-declared, not verified ownership.`,
      );
    } catch (error) {
      setMessage(safeMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {editing ? "Edit your affiliation" : "Introduce your project"}
        </DialogTitle>
        <DialogDescription>
          Your linked wallet is recorded privately with your claim. Your handle,
          role, description and website are public.
        </DialogDescription>
      </DialogHeader>
      <div className={styles.actions}>
        <CommerceWalletButton
          disabled={busy}
          requiredFeature="solana:signTransaction"
        />
      </div>
      <form className={`${styles.form} ${styles.details}`} onSubmit={submit}>
        <Field label="Exact Solana mint">
          <Input
            name="mint"
            required
            defaultValue={editing?.mint ?? mint}
            readOnly={!!editing}
            disabled={busy}
            aria-describedby={editing ? mintNoteId : undefined}
            spellCheck={false}
            maxLength={44}
          />
        </Field>
        {editing && (
          <p id={mintNoteId} className={styles.muted}>
            The project mint cannot change when editing an affiliation.
          </p>
        )}
        <Field label="Your role">
          <Input
            name="role"
            required
            maxLength={60}
            defaultValue={editing?.claim.role}
            disabled={busy}
            placeholder="Builder, researcher, community contributor…"
          />
        </Field>
        <Field label="What are you building?">
          <Textarea
            name="description"
            required
            minLength={20}
            maxLength={2000}
            defaultValue={editing?.claim.description}
            disabled={busy}
          />
        </Field>
        <Field label="Project website (optional)">
          <Input
            name="website"
            type="url"
            placeholder="https://"
            maxLength={1000}
            defaultValue={editing?.claim.website ?? ""}
            disabled={busy}
          />
        </Field>
        {requirement && (
          <p id={requirementId} className={styles.status}>
            {requirement}
          </p>
        )}
        <Button
          disabled={busy || identity.isLoading || !!requirement}
          type="submit"
          aria-describedby={requirement ? requirementId : undefined}
        >
          {busy
            ? "Checking mint…"
            : editing
              ? "Save affiliation changes"
              : "Save public affiliation"}
        </Button>
        {message && (
          <p className={styles.status} role="status">
            {message}
          </p>
        )}
      </form>
    </>
  );
}
function WorkBoard({
  mint,
  client,
  onPayment,
}: {
  mint?: string;
  client: CommerceWalletClient | null;
  onPayment: (payment: Payment) => void;
}) {
  const [status, setStatus] = useState<
      "open" | "selected" | "paid" | "cancelled"
    >("open"),
    works = useQuery(api.forumCommunity.listBounties, { mint, status });
  const [creating, setCreating] = useState(false);
  const creationTrigger = useRef<HTMLButtonElement | null>(null);
  function openCreation(event: MouseEvent<HTMLButtonElement>) {
    creationTrigger.current = event.currentTarget;
    setCreating(true);
  }
  return (
    <div className={styles.directory}>
      <section className={styles.panel}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>Bounties and research requests</h2>
            <p className={styles.muted}>
              Useful briefs, clear deliverables and direct contributor rewards.
            </p>
          </div>
          <Button onClick={openCreation}>
            <Plus aria-hidden="true" /> Create brief
          </Button>
        </div>
        <div className={styles.filters} aria-label="Filter community work">
          {(["open", "selected", "paid", "cancelled"] as const).map((s) => (
            <Button
              key={s}
              variant={status === s ? "secondary" : "ghost"}
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
            >
              {s === "selected"
                ? "Awaiting payment"
                : s === "paid"
                  ? "Paid"
                  : s === "cancelled"
                    ? "Cancelled"
                    : "Open"}
            </Button>
          ))}
        </div>
        <div className={styles.list}>
          {works === undefined ? (
            <p className={styles.empty} role="status">
              Loading community work…
            </p>
          ) : !works.length ? (
            <div className={styles.empty}>
              <span className={styles.eyebrow}>
                {status === "selected"
                  ? "Awaiting payment"
                  : status === "paid"
                    ? "Verified payments"
                    : status === "cancelled"
                      ? "Cancelled pledges"
                      : "Open briefs"}
              </span>
              <h3>
                No {status === "selected" ? "selected" : status} pledges here.
              </h3>
              <p>
                {status === "paid"
                  ? "Completed rewards appear here only after their finalized payment is verified."
                  : status === "selected"
                    ? "A sponsor-selected deliverable appears here until its reward is verified."
                    : status === "cancelled"
                      ? "Cancelled pledges no longer accept deliverables. Existing payment receipts remain separate."
                      : "Commission a specific task with useful sources, a clear deliverable and acceptance criteria."}
              </p>
              {status === "open" && (
                <Button variant="outline" onClick={openCreation}>
                  Create a community brief <ArrowUpRight aria-hidden="true" />
                </Button>
              )}
            </div>
          ) : (
            works.map((work) => (
              <WorkItem
                key={work.workId}
                work={work}
                client={client}
                onPayment={onPayment}
              />
            ))
          )}
        </div>
      </section>
      <aside className={styles.contextNote}>
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <strong>A pledge, not escrow.</strong>
          <p>
            No funds are held when a brief is published. The sponsor selects a
            deliverable and approves the exact reward in their wallet. Only
            finalized receipts are labelled paid.
          </p>
        </div>
      </aside>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent
          data-surface="forum"
          className={styles.creationDialog}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            creationTrigger.current?.focus();
          }}
        >
          <BountyForm mint={mint} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
function BountyForm({ mint }: { mint?: string }) {
  const { isAuthenticated } = useConvexAuth(),
    create = useMutation(api.forumCommunity.createBounty),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const requirementId = useId();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    setBusy(true);
    setMessage("");
    try {
      await create({
        kind: data.get("kind") === "research" ? "research" : "bounty",
        mint: String(data.get("mint") ?? "").trim() || undefined,
        title: String(data.get("title") ?? ""),
        brief: String(data.get("brief") ?? ""),
        amountLamports: solToLamports(String(data.get("amount") ?? "")),
      });
      form.reset();
      setMessage(
        "Pledge published. No funds have moved or been held in escrow.",
      );
    } catch (error) {
      setMessage(safeMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>Commission useful work</DialogTitle>
        <DialogDescription>
          Publish a clear brief and an unfunded sponsor pledge. No payment is
          requested when you create it.
        </DialogDescription>
      </DialogHeader>
      <form className={styles.form} onSubmit={submit}>
        <Field label="Type">
          <select name="kind" className={styles.select}>
            <option value="bounty">Build or contribute</option>
            <option value="research">Research request</option>
          </select>
        </Field>
        <Field label="Title">
          <Input name="title" required minLength={8} maxLength={120} />
        </Field>
        <Field label="Brief and acceptance criteria">
          <Textarea
            name="brief"
            required
            minLength={40}
            maxLength={5000}
            placeholder="Define the deliverable, sources, deadline and how you will choose a submission."
          />
        </Field>
        <Field label="Sponsor pledge (SOL)">
          <Input
            name="amount"
            required
            inputMode="decimal"
            placeholder="0.01"
          />
        </Field>
        <Field label="Related token mint (optional)">
          <Input
            name="mint"
            defaultValue={mint}
            maxLength={44}
            spellCheck={false}
          />
        </Field>
        <Button
          type="submit"
          disabled={busy || !isAuthenticated}
          aria-describedby={!isAuthenticated ? requirementId : undefined}
        >
          {busy ? "Publishing…" : "Publish unfunded pledge"}
        </Button>
        {!isAuthenticated && (
          <p id={requirementId} className={styles.muted}>
            Sign in to publish a pledge or submit work.
          </p>
        )}
        {message && (
          <p className={styles.status} role="status">
            {message}
          </p>
        )}
      </form>
    </>
  );
}
function WorkItem({
  work,
  client,
  onPayment,
}: {
  work: Work;
  client: CommerceWalletClient | null;
  onPayment: (payment: Payment) => void;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth(),
    mine = useQuery(
      api.forumCommunity.getMine,
      isAuthenticated && !isLoading ? { now: 0 } : "skip",
    ),
    cancel = useMutation(api.forumCommunity.cancelBounty),
    [message, setMessage] = useState("");
  const sponsor = mine?.userId === work.sponsorId;
  return (
    <article className={styles.item}>
      <div className={styles.rowHeading}>
        <div>
          <span className={styles.eyebrow}>
            {work.kind === "research" ? "Research request" : "Bounty"}
          </span>
          <h3>{work.title}</h3>
        </div>
        <div className={styles.reward}>
          <strong>
            {lamportsToSol(work.amountLamports)} <span>SOL</span>
          </strong>
          <span className={styles.badge}>
            {work.status === "paid"
              ? "Finalized payment verified"
              : work.status === "cancelled"
                ? "Cancelled pledge"
                : "Unfunded sponsor pledge"}
          </span>
        </div>
      </div>
      <div className={styles.meta}>By @{work.sponsor}</div>
      <p className={styles.prose}>{work.brief}</p>
      {work.mint && <code className={styles.address}>{work.mint}</code>}
      {isAuthenticated &&
        !isLoading &&
        mine !== undefined &&
        work.status !== "cancelled" && (
          <details className={styles.details}>
            <summary>
              {sponsor
                ? "Review deliverables and approve reward"
                : "Submit or view your deliverable"}
            </summary>
            <SubmissionList
              work={work}
              sponsor={sponsor}
              authorId={mine?.userId}
              client={client}
              onPayment={onPayment}
            />
          </details>
        )}
      {sponsor && ["open", "selected"].includes(work.status) && (
        <div className={styles.actions}>
          <Button
            variant="ghost"
            onClick={() => {
              void cancel({ workId: work.workId }).catch((error) =>
                setMessage(safeMessage(error)),
              );
            }}
          >
            Cancel pledge
          </Button>
        </div>
      )}
      {message && (
        <p role="alert" className={styles.status}>
          {message}
        </p>
      )}
    </article>
  );
}
function SubmissionForm({
  workId,
  saved,
}: {
  workId: Id<"forumCommunityWork">;
  saved?: Submission;
}) {
  const submit = useMutation(api.forumCommunity.claimBounty),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [url, setUrl] = useState(saved?.url ?? ""),
    [summary, setSummary] = useState(saved?.summary ?? ""),
    [awaitingSaved, setAwaitingSaved] = useState<{
      url: string;
      summary: string;
    } | null>(null),
    [baseline, setBaseline] = useState<{
      url: string;
      summary: string;
      previousSaved?: Submission;
      draftUrl: string;
      draftSummary: string;
    }>({
      url: saved?.url ?? "",
      summary: saved?.summary ?? "",
      draftUrl: saved?.url ?? "",
      draftSummary: saved?.summary ?? "",
    });
  const dirty = url !== baseline.draftUrl || summary !== baseline.draftSummary;
  const savedMatchesBaseline =
    saved?.url === baseline.url && saved.summary === baseline.summary;
  // A mutation may resolve before its subscription catches up. That exact
  // pre-save snapshot is not a newer version and must never be loaded back.
  const previousSnapshot =
    saved &&
    baseline.previousSaved &&
    saved.url === baseline.previousSaved.url &&
    saved.summary === baseline.previousSaved.summary &&
    saved.submittedAt === baseline.previousSaved.submittedAt;
  const divergent = Boolean(
    saved && !savedMatchesBaseline && !previousSnapshot,
  );
  // Reconcile only the acknowledgement marker, never the editable draft.
  // Guarded adjustment avoids committing an obsolete synchronization notice.
  if (
    awaitingSaved &&
    saved?.url === awaitingSaved.url &&
    saved.summary === awaitingSaved.summary
  ) {
    setAwaitingSaved(null);
  }
  return (
    <form
      aria-label={saved ? "Edit your deliverable" : "Submit your deliverable"}
      className={`${styles.form} ${styles.details}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || awaitingSaved || divergent || !dirty) return;
        let submitted: { url: string; summary: string };
        try {
          submitted = {
            url: communityHttpsUrl(url),
            summary: communityText(summary, 2000, 20),
          };
        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Check the deliverable link and summary.",
          );
          return;
        }
        setBusy(true);
        setMessage("");
        void submit({
          workId,
          ...submitted,
        })
          .then(() => {
            setBaseline({
              ...submitted,
              draftUrl: url,
              draftSummary: summary,
              previousSaved: saved,
            });
            setAwaitingSaved(submitted);
            setMessage("Submission saved. The sponsor can now review it.");
          })
          .catch((error) => setMessage(safeMessage(error)))
          .finally(() => setBusy(false));
      }}
    >
      {awaitingSaved && (
        <p className={styles.muted} role="status">
          Your save completed. Waiting for the saved version to sync before
          another save. You can keep editing your draft.
        </p>
      )}
      <p className={styles.muted} role="status">
        {dirty
          ? "You have unsaved changes."
          : awaitingSaved
            ? "Saved changes are awaiting subscription confirmation."
            : divergent
              ? "A different version is saved. Load it before saving another edit."
              : saved
                ? "Your deliverable is saved. You can edit it while this pledge is open."
                : "No deliverable saved yet."}
      </p>
      {saved && savedMatchesBaseline && (
        <p className={styles.muted}>
          Last saved{" "}
          <time dateTime={new Date(saved.submittedAt).toISOString()}>
            {new Date(saved.submittedAt).toLocaleString()}
          </time>
          . This is not a reward approval or payment receipt.
        </p>
      )}
      {saved && divergent && (
        <div>
          <p className={styles.muted}>
            The saved version changed. Your current draft has not been replaced.
            Loading the saved version replaces the fields below.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setUrl(saved.url);
              setSummary(saved.summary);
              setAwaitingSaved(null);
              setBaseline({
                url: saved.url,
                summary: saved.summary,
                draftUrl: saved.url,
                draftSummary: saved.summary,
              });
              setMessage("");
            }}
          >
            Load latest saved version
          </Button>
        </div>
      )}
      <Field label="Deliverable link">
        <Input
          name="url"
          type="url"
          required
          placeholder="https://"
          maxLength={1000}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={busy}
        />
      </Field>
      <Field label="What did you deliver?">
        <Textarea
          name="summary"
          required
          minLength={20}
          maxLength={2000}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          disabled={busy}
        />
      </Field>
      <p className={styles.muted}>
        Only you and the sponsor see your submission here. Avoid confidential
        files in public links.
      </p>
      <Button
        disabled={busy || !!awaitingSaved || divergent || !dirty}
        type="submit"
      >
        {busy ? "Saving…" : "Save deliverable"}
      </Button>
      {message && (
        <p role="status" className={styles.status}>
          {message}
        </p>
      )}
    </form>
  );
}
function SubmissionList({
  work,
  sponsor,
  authorId,
  client,
  onPayment,
}: {
  work: Work;
  sponsor: boolean;
  authorId: Id<"users"> | undefined;
  client: CommerceWalletClient | null;
  onPayment: (payment: Payment) => void;
}) {
  const rows = useQuery(api.forumCommunity.listSubmissions, {
      workId: work.workId,
    }),
    select = useMutation(api.forumCommunity.selectSubmission),
    [message, setMessage] = useState("");
  return (
    <div className={styles.list}>
      {rows === undefined ? (
        <p className={styles.empty}>Loading deliverables…</p>
      ) : !rows.length ? (
        <p className={styles.empty}>No submitted deliverable yet.</p>
      ) : (
        rows
          .filter((row) => sponsor || row.authorId === authorId)
          .map((row) => (
            <div className={styles.item} key={row.submissionId}>
              <div className={styles.meta}>
                <strong>@{row.username}</strong>
                {work.selectedSubmissionId === row.submissionId && (
                  <span className={styles.badge}>Selected for reward</span>
                )}
              </div>
              <p className={styles.prose}>{row.summary}</p>
              <a className={styles.link} href={row.url} {...external}>
                Review deliverable
              </a>
              {sponsor && work.status === "open" && (
                <div className={styles.actions}>
                  <Button
                    variant="outline"
                    onClick={() => {
                      void select({
                        workId: work.workId,
                        submissionId: row.submissionId,
                      }).catch((error) => setMessage(safeMessage(error)));
                    }}
                  >
                    Select this deliverable
                  </Button>
                </div>
              )}
              {sponsor &&
                work.status === "selected" &&
                work.selectedSubmissionId === row.submissionId &&
                client && (
                  <RewardButton
                    client={client}
                    workId={work.workId}
                    onPayment={onPayment}
                  />
                )}
            </div>
          ))
      )}
      {!sponsor && work.status === "open" && rows !== undefined && authorId && (
        <SubmissionForm
          key={`${work.workId}:${authorId}`}
          workId={work.workId}
          saved={rows.find((row) => row.authorId === authorId)}
        />
      )}
      {message && (
        <p role="alert" className={styles.status}>
          {message}
        </p>
      )}
    </div>
  );
}
function RewardButton({
  client,
  workId,
  onPayment,
}: {
  client: CommerceWalletClient;
  workId: Id<"forumCommunityWork">;
  onPayment: (payment: Payment) => void;
}) {
  const identity = useCommerceIdentity(client, "solana:signTransaction"),
    prepare = useMutation(api.forumCommunity.preparePayment),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <div className={styles.actions}>
        <CommerceWalletButton requiredFeature="solana:signTransaction" />
        <Button
          disabled={!identity.linked || busy}
          onClick={() => {
            const wallet = identity.connected?.account.address;
            if (!wallet) return;
            setBusy(true);
            void prepare({ wallet, workId })
              .then(onPayment)
              .catch((error) => setMessage(safeMessage(error)))
              .finally(() => setBusy(false));
          }}
        >
          Review reward payment
        </Button>
      </div>
      {message && (
        <p className={styles.status} role="alert">
          {message}
        </p>
      )}
    </>
  );
}
function Support({
  client,
  compact,
  onPayment,
}: {
  client: CommerceWalletClient | null;
  compact: boolean;
  onPayment: (payment: Payment) => void;
}) {
  const profile = useRef<HTMLElement>(null);
  return (
    <div className={styles.support}>
      {compact && (
        <div className={styles.supportWallet}>
          <span className={styles.eyebrow}>Your community wallet</span>
          <CommerceWalletButton requiredFeature="solana:signTransaction" />
        </div>
      )}
      <div className={styles.columns}>
        <section className={styles.panel}>
          <span className={styles.eyebrow}>Direct support</span>
          <h2>Support a contributor</h2>
          <p className={styles.muted}>
            Tips are optional wallet-to-wallet SOL payments. Authors opt in to a
            public receiving address. There is no platform tip fee; your wallet
            displays the network fee.
          </p>
          {client ? (
            <Tips
              client={client}
              onPayment={onPayment}
              onShowProfile={() => {
                profile.current?.scrollIntoView({ block: "nearest" });
                profile.current?.focus({ preventScroll: true });
              }}
            />
          ) : (
            <p role="status" className={styles.localState}>
              Loading wallet…
            </p>
          )}
        </section>
        <section
          ref={profile}
          className={styles.panel}
          tabIndex={-1}
          aria-label="Your contributor profile"
        >
          {client ? (
            <SupporterSettings client={client} />
          ) : (
            <p role="status" className={styles.localState}>
              Loading settings…
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
function Tips({
  client,
  onPayment,
  onShowProfile,
}: {
  client: CommerceWalletClient;
  onPayment: (payment: Payment) => void;
  onShowProfile: () => void;
}) {
  const recipients = useQuery(api.forumCommunity.listTipRecipients, {}),
    identity = useCommerceIdentity(client, "solana:signTransaction"),
    prepare = useMutation(api.forumCommunity.preparePayment),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      {!busy &&
        (recipients === undefined ? (
          <p role="status" className={styles.localState}>
            Loading contributors who accept tips…
          </p>
        ) : recipients.length === 0 ? (
          <div className={styles.localState}>
            <h3>No contributors accept tips yet</h3>
            <p>
              Authors choose whether to publish a receiving address. You can
              manage your own receiving address in your contributor profile.
            </p>
            <button
              type="button"
              className={styles.link}
              onClick={onShowProfile}
            >
              View contributor profile
            </button>
          </div>
        ) : identity.isLoading ? (
          <p role="status" className={styles.localState}>
            Checking your community wallet…
          </p>
        ) : !identity.isAuthenticated ? (
          <div className={styles.localState}>
            <h3>Sign in to support a contributor</h3>
            <p>
              Use your community wallet to sign in and link the account that
              will approve your tip.
            </p>
          </div>
        ) : !identity.linked ? (
          <p className={styles.localState}>
            Select a wallet linked to your account in your community wallet
            before preparing a tip.
          </p>
        ) : null)}
      <form
        className={`${styles.form} ${styles.details}`}
        hidden={
          !busy &&
          (!recipients?.length || !identity.isAuthenticated || !identity.linked)
        }
        onSubmit={(event) => {
          event.preventDefault();
          const wallet = identity.connected?.account.address;
          if (!wallet) return;
          const data = new FormData(event.currentTarget);
          setBusy(true);
          setMessage("");
          try {
            const amountLamports = solToLamports(
              String(data.get("amount") ?? ""),
            );
            void prepare({
              wallet,
              recipientId: String(data.get("recipient")) as Id<"users">,
              amountLamports,
            })
              .then(onPayment)
              .catch((error) => setMessage(safeMessage(error)))
              .finally(() => setBusy(false));
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : "Check the amount.",
            );
            setBusy(false);
          }
        }}
      >
        <Field label="Contributor">
          <select name="recipient" required className={styles.select}>
            <option value="">Choose a contributor</option>
            {recipients?.map((row) => (
              <option value={row.userId} key={row.userId}>
                @{row.username} ({row.wallet.slice(0, 4)}…{row.wallet.slice(-4)}
                )
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tip amount (SOL)">
          <Input
            name="amount"
            required
            inputMode="decimal"
            placeholder="0.01"
          />
        </Field>
        <Button
          disabled={busy || !identity.linked || !recipients?.length}
          type="submit"
        >
          Review one-time tip
        </Button>
      </form>
      {message && (
        <p role="alert" className={`${styles.status} ${styles.details}`}>
          {message}
        </p>
      )}
    </>
  );
}
function SupporterSettings({ client }: { client: CommerceWalletClient }) {
  const identity = useCommerceIdentity(client, "solana:signTransaction"),
    now = useMinute(),
    mine = useQuery(
      api.forumCommunity.getMine,
      identity.isAuthenticated && now > 0 ? { now } : "skip",
    ),
    setRecipient = useMutation(api.forumCommunity.setTipRecipient),
    refresh = useAction(api.forumCommunityActions.refreshSupporter),
    visibility = useMutation(api.forumCommunity.setSupporterVisibility),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function perform(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setMessage(safeMessage(error));
    } finally {
      setBusy(false);
    }
  }
  const wallet = identity.connected?.account.address;
  return (
    <>
      <span className={styles.eyebrow}>Your preferences</span>
      <h2>Your contributor profile</h2>
      {!busy && identity.isLoading ? (
        <p role="status" className={styles.localState}>
          Checking your community wallet…
        </p>
      ) : !busy &&
        identity.isAuthenticated &&
        identity.linked &&
        mine === undefined ? (
        <p role="status" className={styles.localState}>
          Loading your contributor settings…
        </p>
      ) : !busy && (!identity.isAuthenticated || !identity.linked) ? (
        <div className={styles.localState}>
          <p>
            {identity.isAuthenticated
              ? "Select a wallet linked to your account to manage public tips and your optional holder profile."
              : "Sign in and link a community wallet to manage your receiving address and optional holder profile."}
          </p>
          <p>Receiving tips is opt-in. A holder badge is optional.</p>
        </div>
      ) : null}
      <div
        className={styles.details}
        hidden={
          !busy &&
          (!identity.isAuthenticated || !identity.linked || mine === undefined)
        }
      >
        <h3>Receiving address</h3>
        <p className={styles.muted}>
          Enabling tips publishes your selected address. Disable it any time;
          existing payment requests retain their original recipient.
        </p>
        {mine?.recipient && (
          <code className={styles.address}>{mine.recipient.wallet}</code>
        )}
        <div className={styles.actions}>
          <Button
            disabled={!identity.linked || busy || !wallet}
            variant="outline"
            onClick={() => {
              if (wallet)
                void perform(
                  () =>
                    setRecipient({
                      wallet,
                      accepting: !mine?.recipient?.accepting,
                    }),
                  mine?.recipient?.accepting
                    ? "Tips disabled."
                    : "Public receiving address enabled.",
                );
            }}
          >
            {mine?.recipient?.accepting
              ? "Disable public tips"
              : "Enable public tips"}
          </Button>
        </div>
      </div>
      <div
        className={styles.details}
        hidden={
          !busy &&
          (!identity.isAuthenticated || !identity.linked || mine === undefined)
        }
      >
        <h3>Optional SYMF holder profile</h3>
        <p className={styles.muted}>
          A non-zero finalized SYMF balance can enable a dated holder badge.
          Balance and wallet stay private. This is not an endorsement, swap
          discount or right to moderate; browsing, posting and reputation remain
          free.
        </p>
        {mine?.supporter?.eligible ? (
          <p className={styles.badge}>
            <ShieldCheck size={14} aria-hidden="true" /> Holder proof verified
          </p>
        ) : (
          <p className={styles.muted}>
            {mine?.supporter?.proofSlot
              ? "The last finalized proof did not show an eligible balance, or has expired."
              : "No current verified holder proof."}
          </p>
        )}
        <div className={styles.actions}>
          <Button
            variant="outline"
            disabled={!identity.linked || !wallet || busy}
            onClick={() => {
              if (wallet)
                void perform(
                  () => refresh({ wallet }),
                  "Holder check complete. No payment was requested.",
                );
            }}
          >
            Check holder proof
          </Button>
          {mine?.supporter && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void perform(
                  () => visibility({ optedIn: !mine.supporter!.optedIn }),
                  "Badge visibility updated.",
                );
              }}
            >
              {mine.supporter.optedIn
                ? "Hide holder badge"
                : "Show holder badge"}
            </Button>
          )}
        </div>
        {mine?.supporter?.checkedAt ? (
          <p className={styles.muted}>
            Checked {new Date(mine.supporter.checkedAt).toLocaleString()}. Proof
            is valid for ten minutes; refresh is explicit.
          </p>
        ) : null}
      </div>
      {message && (
        <p role="status" className={`${styles.status} ${styles.details}`}>
          {message}
        </p>
      )}
    </>
  );
}
function Receipts({
  onPayment,
  signInHref,
}: {
  onPayment: (payment: Payment) => void;
  signInHref: string;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth(),
    rows = useQuery(
      api.forumCommunity.listPayments,
      isAuthenticated ? {} : "skip",
    );
  useTerminalAttention(
    "community",
    isAuthenticated
      ? (rows?.filter((row) => row.status === "held" || row.status === "opened")
          .length ?? 0)
      : 0,
  );
  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>Your community payments</h2>
          <p className={styles.muted}>
            Private receipts for contributor tips and rewards. Swaps and
            promotions have separate receipts.
          </p>
        </div>
        <span className={styles.badge}>
          <ShieldCheck size={14} aria-hidden="true" /> Private to you
        </span>
      </div>
      <p className={styles.receiptNotice}>
        A missing or unavailable receipt never authorizes another payment. Check
        the saved attempt; do not pay again.
      </p>
      <div className={`${styles.list} ${styles.receiptList}`}>
        {isLoading ? (
          <p role="status" className={styles.localState}>
            Loading private receipts…
          </p>
        ) : !isAuthenticated ? (
          <div className={styles.localState}>
            <h3>Sign in to view your receipts</h3>
            <p>Your community payment history is private to your account.</p>
            <ForumLink href={signInHref} className={styles.link}>
              Sign in
            </ForumLink>
          </div>
        ) : rows === undefined ? (
          <p role="status" className={styles.localState}>
            Loading private receipts…
          </p>
        ) : !rows.length ? (
          <div className={styles.localState}>
            <h3>No tips or reward payments yet</h3>
            <p>
              Community payments you create appear here. A wallet connection
              does not create a payment.
            </p>
          </div>
        ) : (
          [...rows]
            .sort(
              (a, b) =>
                Number(b.status === "held") - Number(a.status === "held"),
            )
            .map((row) => (
              <div
                className={`${styles.item} ${styles.receipt} ${row.status === "held" ? styles.protectedReceipt : ""}`}
                key={row.intentId}
              >
                <div>
                  <strong>
                    {lamportsToSol(row.amountLamports)} SOL{" "}
                    {row.purpose === "tip" ? "tip" : "reward"}
                  </strong>
                  {row.status === "held" && (
                    <span className={styles.badge}>Protected outcome</span>
                  )}
                  <p className={styles.muted}>
                    {row.status === "verified"
                      ? "Finalized payment verified"
                      : row.status === "held"
                        ? "Outcome protected; verify the same receipt only"
                        : row.status === "ready"
                          ? "Prepared; not opened in wallet"
                          : row.status === "expired"
                            ? "Expired before opening"
                            : "Awaiting finalized receipt"}
                  </p>
                  <code className={styles.address}>{row.recipient}</code>
                </div>
                <Button variant="outline" onClick={() => onPayment(row)}>
                  {row.status === "held"
                    ? "Check protected receipt"
                    : "View receipt"}
                </Button>
              </div>
            ))
        )}
      </div>
    </section>
  );
}
function PaymentDialog({
  payment,
  onClose,
}: {
  payment: Payment | null;
  onClose: () => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleFocus = useRef<HTMLHeadingElement | null>(null);
  const live = useQuery(
      api.forumCommunity.getPayment,
      payment ? { intentId: payment.intentId } : "skip",
    ),
    open = useMutation(api.forumCommunity.markPaymentOpened),
    verify = useAction(api.forumCommunityActions.verifyPayment),
    [signature, setSignature] = useState(""),
    [handoffReady, setHandoffReady] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const row = live ?? payment;
  useTerminalAttention(
    "community",
    isAuthenticated && row && (row.status === "held" || row.status === "opened")
      ? 1
      : 0,
  );
  useEffect(() => {
    setSignature("");
    setMessage("");
    setHandoffReady(false);
  }, [payment?.intentId]);
  return (
    <Dialog
      open={!!payment}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <DialogContent
        data-surface="forum"
        className={styles.paymentDialog}
        onOpenAutoFocus={(event) => {
          // This controlled dialog has several launch buttons rather than a
          // single Radix Trigger. Capture the real launcher before autofocus.
          const active = document.activeElement;
          returnFocus.current =
            active instanceof HTMLElement && active !== document.body
              ? active
              : null;
          // A long receipt can place its first field below the fold. Start
          // at the visible review context, without scrolling past that context.
          if (titleFocus.current) {
            event.preventDefault();
            titleFocus.current.focus({ preventScroll: true });
          }
        }}
        onCloseAutoFocus={(event) => {
          const launcher = returnFocus.current;
          returnFocus.current = null;
          if (
            launcher?.isConnected &&
            launcher.getClientRects().length > 0 &&
            !launcher.matches(":disabled") &&
            !launcher.closest("[inert]") &&
            getComputedStyle(launcher).visibility === "visible"
          ) {
            event.preventDefault();
            launcher.focus({ preventScroll: true });
          }
        }}
      >
        <DialogHeader>
          <DialogTitle ref={titleFocus} tabIndex={-1}>
            {row?.purpose === "reward"
              ? "Review reward payment"
              : "Review one-time tip"}
          </DialogTitle>
          <DialogDescription>
            Solana mainnet. Your wallet approves this exact transfer. SYMBaiEX
            never holds your keys or sends this payment.
          </DialogDescription>
        </DialogHeader>
        {row && (
          <div className={styles.payment}>
            <dl>
              <dt>Amount</dt>
              <dd>
                <strong>{lamportsToSol(row.amountLamports)} SOL</strong> plus
                wallet-displayed network fee
              </dd>
              <dt>From</dt>
              <dd>
                <code>{row.wallet}</code>
              </dd>
              <dt>To</dt>
              <dd>
                <code>{row.recipient}</code>
              </dd>
              <dt>Status</dt>
              <dd>
                {row.status === "verified"
                  ? "Finalized payment verified"
                  : row.status === "ready"
                    ? "Not opened in wallet"
                    : row.status === "held"
                      ? "Protected uncertain outcome"
                      : row.status}
              </dd>
              <dt>Payment window</dt>
              <dd>Until {new Date(row.expiresAt).toLocaleTimeString()}</dd>
            </dl>
            {row.status === "ready" && (
              <>
                <p className={styles.muted}>
                  This uses a Solana Pay mobile wallet or a registered solana:
                  link handler, not the connected browser extension. Confirm
                  your device can open those links before continuing. The
                  request is protected before leaving the forum. Approve once;
                  do not reopen or send a manual transfer without this
                  request&apos;s reference and memo.
                </p>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={handoffReady}
                    onChange={(event) => setHandoffReady(event.target.checked)}
                    className="mt-1"
                  />
                  I have a Solana Pay-compatible wallet or link handler on this
                  device.
                </label>
                <Button
                  disabled={busy || !handoffReady}
                  onClick={() => {
                    setBusy(true);
                    setMessage("");
                    void open({ intentId: row.intentId })
                      .then((result) => {
                        window.location.assign(result.paymentUrl);
                        setMessage(
                          "Payment handoff requested. If your wallet opened, approve once and verify its signature below. Do not launch another payment if it did not open.",
                        );
                      })
                      .catch((error) => setMessage(safeMessage(error)))
                      .finally(() => setBusy(false));
                  }}
                >
                  Open exact payment in wallet
                </Button>
              </>
            )}
            {row.status !== "ready" &&
              row.status !== "expired" &&
              row.status !== "verified" && (
                <>
                  <p className={styles.status}>
                    Do not pay again. Paste the transaction signature from
                    wallet Activity to verify this same attempt. If the wallet
                    did not return a signature, leave this request protected.
                  </p>
                  <Field label="Transaction signature">
                    <Input
                      value={row.signature ?? signature}
                      disabled={!!row.signature || busy}
                      onChange={(event) => setSignature(event.target.value)}
                      spellCheck={false}
                      maxLength={90}
                    />
                  </Field>
                  <Button
                    disabled={busy || !(row.signature ?? signature.trim())}
                    onClick={() => {
                      setBusy(true);
                      setMessage("");
                      void verify({
                        intentId: row.intentId,
                        signature: row.signature ?? signature.trim(),
                      })
                        .then((result) =>
                          setMessage(
                            result.status === "verified"
                              ? "Payment finalized and verified."
                              : "No matching finalized receipt verified yet. This attempt remains protected; do not pay again.",
                          ),
                        )
                        .catch((error) => setMessage(safeMessage(error)))
                        .finally(() => setBusy(false));
                    }}
                  >
                    {busy ? "Checking receipt…" : "Verify saved payment"}
                  </Button>
                </>
              )}
            {row.signature && (
              <a
                className={styles.link}
                href={`https://solscan.io/tx/${encodeURIComponent(row.signature)}`}
                {...external}
              >
                View transaction on Solscan
              </a>
            )}
            {row.status === "verified" && row.finalizedAt && (
              <p className={styles.muted}>
                Verified chain time:{" "}
                {new Date(row.finalizedAt).toLocaleString()}.
              </p>
            )}
            {message && (
              <p className={styles.status} role="status">
                {message}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Thread authors must explicitly opt in; historical public posts can receive tips. */
export function AuthorTip({ threadId }: { threadId: Id<"forumThreads"> }) {
  const { host } = useForumRuntime();
  if (host !== "website") return null;
  return (
    <CommerceWalletProvider>
      <AuthorTipContent threadId={threadId} />
    </CommerceWalletProvider>
  );
}
function AuthorTipContent({ threadId }: { threadId: Id<"forumThreads"> }) {
  const recipient = useQuery(api.forumCommunity.getThreadRecipient, {
      threadId,
    }),
    client = useCommerceWallet(),
    [payment, setPayment] = useState<Payment | null>(null);
  if (!recipient || !client) return null;
  return (
    <div className={styles.panel}>
      <h3>Support @{recipient.username}</h3>
      <ThreadTipForm
        client={client}
        threadId={threadId}
        recipientId={recipient.userId}
        onPayment={setPayment}
      />
      <PaymentDialog payment={payment} onClose={() => setPayment(null)} />
    </div>
  );
}
function ThreadTipForm({
  client,
  threadId,
  recipientId,
  onPayment,
}: {
  client: CommerceWalletClient;
  threadId: Id<"forumThreads">;
  recipientId: Id<"users">;
  onPayment: (payment: Payment) => void;
}) {
  const preparing = useRef(false);
  const identity = useCommerceIdentity(client, "solana:signTransaction"),
    prepare = useMutation(api.forumCommunity.preparePayment),
    [amount, setAmount] = useState("0.01"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <div className={styles.actions}>
        <CommerceWalletButton requiredFeature="solana:signTransaction" />
      </div>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          const wallet = identity.connected?.account.address;
          if (!wallet || !identity.linked || busy || preparing.current) return;
          preparing.current = true;
          setBusy(true);
          setMessage("");
          try {
            const amountLamports = solToLamports(amount);
            void prepare({ wallet, threadId, recipientId, amountLamports })
              .then(onPayment)
              .catch((error) => setMessage(safeMessage(error)))
              .finally(() => {
                preparing.current = false;
                setBusy(false);
              });
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : "Check the amount.",
            );
            preparing.current = false;
            setBusy(false);
          }
        }}
      >
        <Field label="Optional author tip (SOL)">
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <div className={styles.actions}>
          <Button disabled={busy || !identity.linked} type="submit">
            <Heart aria-hidden="true" /> Review tip
          </Button>
        </div>
        {message && (
          <p role="alert" className={styles.status}>
            {message}
          </p>
        )}
      </form>
    </>
  );
}

/** Optional public timestamp only. No holdings or payment privileges are exposed. */
export function CommunityHolderBadge({ userId }: { userId: Id<"users"> }) {
  const { host } = useForumRuntime();
  return host === "website" ? <HolderBadgeContent userId={userId} /> : null;
}
function HolderBadgeContent({ userId }: { userId: Id<"users"> }) {
  const now = useMinute();
  const proof = useQuery(
    api.forumCommunity.getPublicSupporter,
    now > 0 ? { userId, now } : "skip",
  );
  return proof ? (
    <span
      className={styles.badge}
      title={`Finalized SYMF holder proof checked ${new Date(proof.checkedAt).toLocaleString()}`}
    >
      <ShieldCheck aria-hidden="true" size={14} /> SYMF holder
    </span>
  ) : null;
}
