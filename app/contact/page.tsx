import { ContactForm } from "@/components/contact-form";
import { StructuredData } from "@/components/structured-data";
import { Button } from "@/components/ui/button";
import { Github, Mail, Twitter } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { breadcrumbStructuredData } from "@/lib/seo";
import { primarySiteUrl } from "@/lib/site-urls";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact Austin Hamilton (SYMBaiEX) for AI systems, software engineering, open-source, and research conversations.",
  alternates: { canonical: "/contact" },
};

const socials = [
  {
    href: "mailto:solsymbaiex@gmail.com?subject=SYMBaiEX%20contact",
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
    <section className="page-frame page-frame-spacious">
      <StructuredData
        data={breadcrumbStructuredData([
          { name: "Home", url: primarySiteUrl("/") },
          { name: "Contact", url: primarySiteUrl("/contact") },
        ])}
      />
      <div className="page-content">
        <h1 className="page-title">Contact</h1>
        <ContactForm />
        <nav
          aria-label="Social links"
          className="mt-8 flex flex-wrap items-center gap-2"
        >
          {socials.map(({ Icon, href, label }) => (
            <Button
              asChild
              className="h-10 w-10 rounded-none"
              key={label}
              size="icon"
              variant="outline"
            >
              <a
                aria-label={label}
                href={href}
                rel={
                  href.startsWith("http") ? "noopener noreferrer" : undefined
                }
                target={href.startsWith("http") ? "_blank" : undefined}
              >
                <Icon aria-hidden="true" />
              </a>
            </Button>
          ))}
        </nav>
      </div>
    </section>
  );
}
