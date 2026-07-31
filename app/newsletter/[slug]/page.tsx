import { NewsletterEditorial } from "@/components/newsletter-editorial";
import { getPublicNewsletterIssue } from "@/lib/newsletter-data";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export const revalidate = 60;

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const issue = await getPublicNewsletterIssue(slug);
  return {
    title: issue?.subject ?? "Newsletter edition",
    description: issue?.previewText ?? "A SYMBaiEX newsletter edition.",
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
      <NewsletterEditorial issue={issue} />
    </section>
  );
}
