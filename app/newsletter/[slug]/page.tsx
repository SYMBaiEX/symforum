import { NewsletterEditorial } from "@/components/newsletter-editorial";
import { StructuredData } from "@/components/structured-data";
import { getPublicNewsletterIssue } from "@/lib/newsletter-data";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { breadcrumbStructuredData, compactSeoTitle } from "@/lib/seo";
import { primarySiteUrl } from "@/lib/site-urls";
import { parseEditorialNewsletterPayload } from "@/convex/newsletterPayload";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export const revalidate = 60;

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const issue = await getPublicNewsletterIssue(slug);
  const canonical = issue
    ? primarySiteUrl(`/newsletter/${encodeURIComponent(issue.slug)}`)
    : primarySiteUrl(`/newsletter/${encodeURIComponent(slug)}`);
  return {
    title: {
      absolute: compactSeoTitle(
        issue?.subject ?? "Newsletter edition",
        "Austin Hamilton",
      ),
    },
    description: issue?.previewText ?? "A SYMBaiEX newsletter edition.",
    alternates: { canonical },
    robots: issue ? undefined : { index: false, follow: false },
    openGraph: issue
      ? {
          type: "article",
          url: canonical,
          title: issue.subject,
          description: issue.previewText,
          publishedTime: new Date(
            issue.sentAt ?? issue.updatedAt,
          ).toISOString(),
          images: [
            {
              url: `${primarySiteUrl("/")}opengraph-image`,
              alt: `SYMBaiEX newsletter issue: ${issue.subject}`,
            },
          ],
        }
      : undefined,
    twitter: issue
      ? {
          card: "summary_large_image",
          title: issue.subject,
          description: issue.previewText ?? "A SYMBaiEX newsletter edition.",
          images: [`${primarySiteUrl("/")}opengraph-image`],
        }
      : undefined,
  };
}

export default async function NewsletterIssuePage({ params }: PageProps) {
  const { slug } = await params;
  const issue = await getPublicNewsletterIssue(slug);
  if (issue === null) {
    notFound();
  }

  return (
    <section className="page-frame page-frame-dense">
      <StructuredData
        data={(() => {
          const payload = parseEditorialNewsletterPayload(issue.body);
          return [
            {
              "@type": "Article",
              "@id": `${primarySiteUrl(`/newsletter/${encodeURIComponent(issue.slug)}`)}#article`,
              headline: payload?.headline ?? issue.subject,
              description: payload?.dek ?? issue.previewText,
              datePublished: new Date(
                issue.sentAt ?? issue.updatedAt,
              ).toISOString(),
              dateModified: new Date(issue.updatedAt).toISOString(),
              author: { "@type": "Person", name: "Belle" },
              url: primarySiteUrl(
                `/newsletter/${encodeURIComponent(issue.slug)}`,
              ),
              isPartOf: {
                "@type": "CreativeWorkSeries",
                "@id": `${primarySiteUrl("/newsletter")}#series`,
                name: "SYMBaiEX newsletter",
              },
            },
            breadcrumbStructuredData([
              { name: "Home", url: primarySiteUrl("/") },
              { name: "Newsletter", url: primarySiteUrl("/newsletter") },
              {
                name: payload?.headline ?? issue.subject,
                url: primarySiteUrl(
                  `/newsletter/${encodeURIComponent(issue.slug)}`,
                ),
              },
            ]),
          ];
        })()}
      />
      <NewsletterEditorial issue={issue} />
    </section>
  );
}
