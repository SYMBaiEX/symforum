import { HOME_FAQS } from "@/lib/seo";
import type { Route } from "next";
import Link from "next/link";

export function HomeFaq() {
  return (
    <section className="forum-panel p-4" aria-labelledby="symbaiex-faq">
      <h2 id="symbaiex-faq" className="text-sm font-semibold tracking-tight">
        SYMBaiEX FAQ
      </h2>
      <div className="mt-3 border-y border-row-border">
        {HOME_FAQS.map((faq) => (
          <details
            key={faq.question}
            className="group border-b border-row-border last:border-b-0"
          >
            <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-5 py-4 text-left font-medium text-foreground marker:content-none [&::-webkit-details-marker]:hidden">
              <h3 className="text-base font-medium">{faq.question}</h3>
              <span
                aria-hidden="true"
                className="shrink-0 font-mono text-lg leading-none text-muted-foreground transition-transform duration-150 group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="max-w-3xl pb-4 text-sm leading-6 text-muted-foreground">
              {faq.answer}
            </p>
          </details>
        ))}
      </div>

      <div className="mt-8 max-w-3xl space-y-4 text-sm leading-7 text-muted-foreground md:text-base">
        <p>
          I build public software, AI systems, and research infrastructure with
          a bias toward inspectable sources, durable identity, and tools that
          remain useful after the demo ends.
        </p>
        <p>
          People can read the site normally. User-directed agents can use clean
          Markdown, published contracts, and owner-approved API or MCP access
          without guessing at private backend details.
        </p>
      </div>
      <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <nav
          aria-label="Agent and trust resources"
          className="flex max-w-3xl flex-wrap gap-x-5 gap-y-2 font-mono text-xs uppercase"
        >
          <Link
            className="focus-ring underline underline-offset-4"
            href="/developers"
          >
            Developer guide
          </Link>
          <Link
            className="focus-ring underline underline-offset-4"
            href="/agent"
          >
            Agent access
          </Link>
          <Link
            className="focus-ring underline underline-offset-4"
            href="/privacy"
          >
            Privacy
          </Link>
          <Link
            className="focus-ring underline underline-offset-4"
            href={"/pricing" as Route}
          >
            API pricing
          </Link>
          <a
            className="focus-ring underline underline-offset-4"
            href="https://github.com/SYMBaiEX/symbaiex-agent-clients"
          >
            Agent clients
          </a>
          <a
            className="focus-ring underline underline-offset-4"
            href="https://github.com/SYMBaiEX/skills"
          >
            Agent Skills
          </a>
        </nav>

        <a
          aria-label="View SYMBaiEX's agent readiness report on Ora"
          className="focus-ring shrink-0 self-start rounded-xl opacity-85 transition-opacity hover:opacity-100 sm:self-auto"
          href="https://ora.ai/score/symbaiex.com"
          rel="noopener noreferrer"
          target="_blank"
        >
          {/* Ora serves this as a live SVG; bypassing image optimization keeps the score current. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt="Ora agent readiness score for symbaiex.com"
            className="h-auto w-[11.75rem] sm:w-[13rem]"
            height={76}
            loading="lazy"
            referrerPolicy="no-referrer"
            src="https://ora.ai/api/badge/symbaiex.com"
            width={236}
          />
        </a>
      </div>
    </section>
  );
}
