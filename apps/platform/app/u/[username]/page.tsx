import { PublicProfilePanel } from "@/components/public-profile-panel";
import { StructuredData } from "@/components/structured-data";
import type { Metadata } from "next";
import { breadcrumbStructuredData } from "@/lib/seo";
import { primarySiteUrl } from "@/lib/site-urls";

type PageProps = {
  params: Promise<{ username: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { username } = await params;
  return {
    title: `Profile / ${username}`,
    description: `Public SYMBaiEX profile for ${username}.`,
    alternates: {
      canonical: primarySiteUrl(`/u/${encodeURIComponent(username)}`),
    },
    openGraph: {
      title: `Profile / ${username}`,
      description: `Public SYMBaiEX profile for ${username}.`,
      type: "profile",
      url: primarySiteUrl(`/u/${encodeURIComponent(username)}`),
      images: [
        {
          url: `${primarySiteUrl("/")}opengraph-image`,
          width: 1200,
          height: 630,
          alt: `SYMBaiEX public profile for ${username}`,
        },
      ],
    },
    twitter: {
      card: "summary",
      title: `Profile / ${username}`,
      description: `Public SYMBaiEX profile for ${username}.`,
      images: [`${primarySiteUrl("/")}opengraph-image`],
    },
  };
}

export default async function PublicProfilePage({ params }: PageProps) {
  const { username } = await params;
  const configured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <>
      <section className="page-frame">
        <StructuredData
          data={[
            {
              "@type": "ProfilePage",
              "@id": `${primarySiteUrl(`/u/${encodeURIComponent(username)}`)}#profile`,
              name: `Profile / ${username}`,
              url: primarySiteUrl(`/u/${encodeURIComponent(username)}`),
              mainEntity: {
                "@type": "Person",
                "@id": `${primarySiteUrl(`/u/${encodeURIComponent(username)}`)}#person`,
                name: username,
                url: primarySiteUrl(`/u/${encodeURIComponent(username)}`),
              },
            },
            breadcrumbStructuredData([
              { name: "Home", url: primarySiteUrl("/") },
              {
                name: `Profile / ${username}`,
                url: primarySiteUrl(`/u/${encodeURIComponent(username)}`),
              },
            ]),
          ]}
        />
        <div className="mb-7">
          <p className="page-kicker">Public handle</p>
          <h1 className="page-title-display mt-3">/u/{username}</h1>
        </div>
        {configured ? (
          <PublicProfilePanel username={username} />
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
    </>
  );
}
