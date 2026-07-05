import { PublicProfilePanel } from "@/components/public-profile-panel";
import type { Metadata } from "next";

type PageProps = {
  params: Promise<{ username: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { username } = await params;
  return {
    title: `Forum Member / ${username}`,
    description: `SYMBaiEX forum profile for ${username}.`,
    alternates: {
      canonical: `https://forum.symbaiex.com/members/${encodeURIComponent(
        username,
      )}`,
    },
  };
}

export default async function ForumMemberProfilePage({ params }: PageProps) {
  const { username } = await params;
  const configured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <section className="space-y-5">
      <div className="border-y border-row-border py-4">
        <p className="page-kicker">Forum member</p>
        <h1 className="mt-2 text-2xl font-semibold md:text-3xl">
          /members/{username}
        </h1>
      </div>
      {configured ? (
        <PublicProfilePanel username={username} />
      ) : (
        <div className="border border-row-border p-4">
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Local setup
          </p>
          <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground md:text-base">
            Convex is not connected locally, so forum profile lookup is
            unavailable in this environment.
          </p>
        </div>
      )}
    </section>
  );
}
