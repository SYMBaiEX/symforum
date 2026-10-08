"use client";

import { Button } from "@/components/ui/button";
import { AccountEmailVerification } from "@/components/account-email-verification";
import { ProfilePanelSkeleton } from "@/components/profile-panel-skeleton";
import { ProfileNewsletterPreferences } from "@/components/profile-newsletter-preferences";
import { convexRefs } from "@/lib/convex-refs";
import { formatDate } from "@/lib/format";
import { asRoute } from "@/lib/typed-route";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { useAuthActions } from "@convex-dev/auth/react";

export function CurrentProfilePanel() {
  const viewer = useQuery(convexRefs.users.maybeViewer, { includeBio: true });

  if (viewer === undefined) {
    return <ProfilePanelSkeleton />;
  }

  if (viewer === null) {
    return (
      <div>
        <p className="font-mono text-xs uppercase text-muted-foreground">
          Signed-out session
        </p>
        <h2 className="mt-3 text-2xl font-semibold">
          Sign in to view profile.
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground md:text-base">
          This route is the current-user view. Use a SYM handle, then come back
          here to inspect the account attached to your comments, saves, and
          votes.
        </p>
        <div className="mt-5">
          <Button asChild>
            <Link href="/signin?mode=signIn&redirectTo=/profile" prefetch>
              Sign in
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const publicHref = viewer.usernameNormalized
    ? `/u/${viewer.usernameNormalized}`
    : null;

  return (
    <div className="grid gap-6 md:grid-cols-12">
      <section className="md:col-span-7">
        <p className="font-mono text-xs uppercase text-muted-foreground">
          Current identity
        </p>
        <h2 className="mt-3 break-words text-3xl font-bold md:text-5xl">
          {viewer.username ?? viewer.name ?? "SYM-UNKNOWN"}
        </h2>
        <div className="mt-5 flex flex-wrap gap-2">
          {publicHref ? (
            <Button asChild size="sm">
              <Link href={asRoute(publicHref)} prefetch>
                Open public profile
              </Link>
            </Button>
          ) : null}
          {viewer.role === "owner" || viewer.role === "admin" ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/admin">Open admin</Link>
            </Button>
          ) : null}
          <SignOutButton />
        </div>
        <dl className="mt-6 grid gap-4 text-sm md:grid-cols-2">
          <MetaItem
            label="Joined"
            value={formatDate(viewer.onboardedAt ?? viewer._creationTime)}
          />
          <MetaItem
            label="Role"
            value={
              viewer.role === "owner"
                ? "Owner"
                : viewer.role === "admin"
                  ? "Administrator"
                  : "Reader"
            }
          />
          <MetaItem
            label="Handle source"
            value={viewer.usernameSource === "auto" ? "Random SYM" : "Chosen"}
          />
          <MetaItem
            label="Public path"
            value={publicHref ?? "No public handle"}
            mono
          />
        </dl>
      </section>

      <aside className="md:col-span-5">
        <p className="font-mono text-xs uppercase text-muted-foreground">
          Profile fields
        </p>
        <dl className="mt-4 grid gap-4 text-sm">
          {viewer.contactEmail ? (
            <MetaItem
              label="Contact email"
              value={`${viewer.contactEmail}${viewer.emailVerified ? " · verified" : " · not verified"}`}
            />
          ) : (
            <MetaItem
              label="Contact email"
              value={`Not set${viewer.emailVerified ? " · verified" : " · not verified"}`}
            />
          )}
          <MetaItem
            label="Bio"
            value={viewer.bio?.trim() || "No bio saved for this account yet."}
          />
        </dl>
        <Button asChild size="sm" variant="outline" className="mt-4">
          <Link href="/forum/control-panel">Edit forum profile</Link>
        </Button>
        {!viewer.emailVerified && viewer.isAgent !== true ? (
          <div className="mt-5">
            <AccountEmailVerification contactEmail={viewer.contactEmail} />
          </div>
        ) : null}
        <ProfileNewsletterPreferences />
      </aside>
    </div>
  );
}

function SignOutButton() {
  if (process.env.NEXT_PUBLIC_WORKOS_ENABLED === "true") {
    return <WorkOSSignOut />;
  }
  return <LegacySignOut />;
}

function WorkOSSignOut() {
  const { signOut } = useAuth();
  return (
    <Button type="button" onClick={() => void signOut()} size="sm" variant="outline">
      Sign out
    </Button>
  );
}

function LegacySignOut() {
  const { signOut } = useAuthActions();
  return (
    <Button type="button" onClick={() => void signOut()} size="sm" variant="outline">
      Sign out
    </Button>
  );
}

function MetaItem({
  label,
  mono = false,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div>
      <dt className="font-mono text-[11px] uppercase text-muted-foreground">
        {label}
      </dt>
      <dd className={mono ? "mt-1 font-mono text-xs uppercase" : "mt-1"}>
        {value}
      </dd>
    </div>
  );
}
