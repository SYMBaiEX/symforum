import { ForumPageHeader } from "@/components/forum/forum-layout-primitives";
import { PublicProfilePanel } from "@/components/public-profile-panel";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import { StructuredData } from "@/components/structured-data";
import { breadcrumbStructuredData, compactSeoTitle } from "@/lib/seo";
import { forumSiteUrl } from "@/lib/site-urls";
import type { Metadata } from "next";

type PageProps = {
  params: Promise<{ username: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { username } = await params;
  return {
    title: {
      absolute: compactSeoTitle(`Forum Member / ${username}`, "SYMBaiEX forum"),
    },
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
    <section className="page-frame page-frame-dense space-y-3">
      <StructuredData
        data={[
          {
            "@type": "ProfilePage",
            "@id": `${forumSiteUrl(`/members/${encodeURIComponent(username)}`)}#profile`,
            name: `Forum Member / ${username}`,
            url: forumSiteUrl(`/members/${encodeURIComponent(username)}`),
            mainEntity: {
              "@type": "Person",
              "@id": `${forumSiteUrl(`/members/${encodeURIComponent(username)}`)}#person`,
              name: username,
              url: forumSiteUrl(`/members/${encodeURIComponent(username)}`),
            },
          },
          breadcrumbStructuredData([
            { name: "Home", url: forumSiteUrl("/") },
            { name: "Members", url: forumSiteUrl("/members") },
            {
              name: username,
              url: forumSiteUrl(`/members/${encodeURIComponent(username)}`),
            },
          ]),
        ]}
      />
      <ForumUtilityNav />
      <ForumPageHeader
        title={username}
        description="Member profile and recent forum activity."
      />
      {configured ? (
        <PublicProfilePanel username={username} forum />
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
