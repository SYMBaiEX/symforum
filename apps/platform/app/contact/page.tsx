import { installation } from "@/lib/installation";
import { ContactForm } from "@/components/contact-form";
import { StructuredData } from "@/components/structured-data";
import { Button } from "@/components/ui/button";
import { Github, Mail, Twitter } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { breadcrumbStructuredData } from "@/lib/seo";
import { primarySiteUrl } from "@/lib/site-urls";
import { PrimaryPageSurface } from "@/components/primary-page-surface";
import {
  ForumBodyGrid,
  ForumSectionHeader,
} from "@/components/forum/forum-layout-primitives";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact Austin Hamilton (SYMBaIEX) for AI systems, software engineering, open-source, and research conversations.",
  alternates: { canonical: "/contact" },
  openGraph: {
    type: "website",
    url: primarySiteUrl("/contact"),
    title: "Contact",
    description:
      "Contact details and social links for Austin Hamilton (SYMBiEX).",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Contact Austin Hamilton at SYMBiEX.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Contact",
    description:
      "Use email, GitHub, or X/Twitter to reach Austin Hamilton at SYMBiEX.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Contact Austin Hamilton at SYMBiEX.",
      },
    ],
  },
};

const socials = [
  {
    href: "mailto:" + installation.supportEmail + "?subject=" + encodeURIComponent(installation.name + " contact"),
    label: "Email",
    Icon: Mail,
  },
  {
    href: "https://github.com/symbaiex",
    label: "GitHub",
    Icon: Github,
  },
  {
    href: "https://twitter.com/symbiex",
    label: "Twitter",
    Icon: Twitter,
  },
];

export default function ContactPage() {
  return (
    <PrimaryPageSurface>
      <section className="page-frame page-frame-dense">
        <StructuredData
          data={breadcrumbStructuredData([
            { name: "Home", url: primarySiteUrl("/") },
            { name: "Contact", url: primarySiteUrl("/contact") },
          ])}
        />
        <ForumBodyGrid
          mobileSidebarLabel="Contact details"
          sidebar={
            <div className="space-y-3">
              <section
                className="forum-panel p-4"
                aria-labelledby="contact-details"
              >
                <ForumSectionHeader
                  title="Direct contact"
                  id="contact-details"
                />
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Austin Hamilton is based in Birmingham, Alabama.
                </p>
                <a
                  className="forum-action-pill focus-ring mt-3 flex w-full justify-start"
                  href={"mailto:" + installation.supportEmail + "?subject=" + encodeURIComponent(installation.name + " contact")}
                >
                  <Mail aria-hidden="true" className="size-4" />
                  {installation.supportEmail}
                </a>
              </section>
              <nav
                aria-label="Social links"
                className="forum-panel grid gap-2 p-4"
              >
                <ForumSectionHeader title="Elsewhere" />
                {socials.map(({ Icon, href, label }) => (
                  <Button
                    asChild
                    className="w-full justify-start"
                    key={label}
                    size="sm"
                    variant="outline"
                  >
                    <a
                      href={href}
                      rel={
                        href.startsWith("http")
                          ? "noopener noreferrer"
                          : undefined
                      }
                      target={href.startsWith("http") ? "_blank" : undefined}
                    >
                      <Icon aria-hidden="true" />
                      {label}
                    </a>
                  </Button>
                ))}
              </nav>
            </div>
          }
        >
          <section
            className="forum-panel p-4 md:p-5"
            aria-labelledby="contact-form-heading"
          >
            <ForumSectionHeader
              title="Send a message"
              id="contact-form-heading"
            />
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Share a little context so I can route your note to the right
              place.
            </p>
            <ContactForm />
          </section>
        </ForumBodyGrid>
      </section>
    </PrimaryPageSurface>
  );
}
