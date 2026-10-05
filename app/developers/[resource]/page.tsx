import { primarySiteUrl } from "@/lib/site-urls";
import { StructuredData } from "@/components/structured-data";
import { breadcrumbStructuredData } from "@/lib/seo";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  DEVELOPER_RESOURCES as RESOURCES,
  type DeveloperResource,
} from "@/lib/developer-resources";

type ResourceKey = keyof typeof RESOURCES;

export function generateStaticParams() {
  return Object.keys(RESOURCES).map((resource) => ({ resource }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ resource: string }>;
}): Promise<Metadata> {
  const { resource } = await params;
  const entry: DeveloperResource | undefined = Object.hasOwn(
    RESOURCES,
    resource,
  )
    ? RESOURCES[resource as ResourceKey]
    : undefined;
  if (!entry) return {};
  return {
    title: entry.title,
    description: entry.summary,
    alternates: { canonical: `/developers/${resource}` },
  };
}

export default async function DeveloperResourcePage({
  params,
}: {
  params: Promise<{ resource: string }>;
}) {
  const { resource } = await params;
  const entry: DeveloperResource | undefined = Object.hasOwn(
    RESOURCES,
    resource,
  )
    ? RESOURCES[resource as ResourceKey]
    : undefined;
  if (!entry) notFound();

  return (
    <article className="page-frame page-frame-spacious">
      <StructuredData
        data={[
          {
            "@type": "TechArticle",
            headline: entry.title,
            description: entry.summary,
            url: primarySiteUrl(`/developers/${resource}`),
            isPartOf: { "@id": `${primarySiteUrl("/")}#website` },
          },
          ...(entry.faqs?.length
            ? [
                {
                  "@type": "FAQPage",
                  "@id": `${primarySiteUrl(`/developers/${resource}`)}#faq`,
                  url: primarySiteUrl(`/developers/${resource}`),
                  mainEntity: entry.faqs.map((faq) => ({
                    "@type": "Question",
                    name: faq.question,
                    acceptedAnswer: {
                      "@type": "Answer",
                      text: faq.answer,
                    },
                  })),
                },
              ]
            : []),
          breadcrumbStructuredData([
            { name: "Home", url: primarySiteUrl("/") },
            { name: "Developers", url: primarySiteUrl("/developers") },
            {
              name: entry.title,
              url: primarySiteUrl(`/developers/${resource}`),
            },
          ]),
        ]}
      />
      <div className="page-content-readable">
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <li>
              <Link className="underline underline-offset-4" href="/">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link className="underline underline-offset-4" href="/developers">
                Developers
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="text-foreground">
              {entry.title}
            </li>
          </ol>
        </nav>
        <p className="page-kicker">SYMBaiEX developer resource</p>
        <h1 className="page-title mt-3">{entry.title}</h1>
        <p className="page-lede mt-5">{entry.summary}</p>
        <h2 className="mt-10 text-2xl font-semibold">Integration guidance</h2>
        {entry.details?.map((detail) => (
          <p
            className="mt-5 text-sm leading-7 text-muted-foreground"
            key={detail}
          >
            {detail}
          </p>
        ))}
        {entry.faqs?.length ? (
          <section className="mt-10" aria-labelledby="resource-faq">
            <h2 id="resource-faq" className="text-2xl font-semibold">
              Frequently asked questions
            </h2>
            <div className="mt-4 space-y-6">
              {entry.faqs.map((faq) => (
                <div key={faq.question}>
                  <h3 className="font-semibold">{faq.question}</h3>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">
                    {faq.answer}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <section className="mt-10" aria-labelledby="canonical-resources">
          <h2 id="canonical-resources" className="text-2xl font-semibold">
            Canonical resources
          </h2>
          <ul className="mt-4 space-y-3">
            {entry.links.map(([label, href]) => (
              <li key={href}>
                <Link
                  className="underline underline-offset-4"
                  href={href as Route}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <p className="mt-10 text-xs leading-6 text-muted-foreground">
          Machine clients can start at{" "}
          <a className="underline" href={primarySiteUrl("/llms.txt")}>
            the SYMBaiEX machine index
          </a>{" "}
          and should follow only canonical public URLs.
        </p>
      </div>
    </article>
  );
}
