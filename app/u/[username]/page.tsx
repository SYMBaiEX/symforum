import ConvexClientProvider from "@/components/ConvexClientProvider";
import { PublicProfilePanel } from "@/components/public-profile-panel";
import { SiteShell } from "@/components/site-shell";
import type { Metadata } from "next";

type PageProps = {
  params: Promise<{ username: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { username } = await params;
  return {
    title: `Profile / ${username}`,
  };
}

export default async function PublicProfilePage({ params }: PageProps) {
  const { username } = await params;
  const configured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <SiteShell>
      <section className="mx-auto max-w-7xl px-4 py-9 md:px-8 md:py-14">
        <div className="mb-7">
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Public handle
          </p>
          <h1 className="mt-3 break-words text-4xl font-bold leading-none sm:text-5xl md:text-7xl">
            /u/{username}
          </h1>
        </div>
        {configured ? (
          <ConvexClientProvider>
            <PublicProfilePanel username={username} />
          </ConvexClientProvider>
        ) : (
          <div>
            <p className="font-mono text-xs uppercase text-muted-foreground">
              Local setup
            </p>
            <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground md:text-base">
              Convex is not connected locally, so public profile lookup is
              unavailable in this environment.
            </p>
          </div>
        )}
      </section>
    </SiteShell>
  );
}
