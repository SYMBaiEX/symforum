
import { PRIMARY_SITE_URL } from "../../../../../lib/site-urls";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SYMBaiEX API sandbox",
  description:
    "A deterministic, read-only, synthetic SYMBaiEX API environment for client and agent integration tests.",
  alternates: { canonical: "/developers/sandbox" },
};

export default function DeveloperSandboxPage() {
  return (
    <article className="page-frame page-frame-spacious">
      <div className="page-content-readable">
        <p className="page-kicker">Synthetic test environment</p>
        <h1 className="page-title mt-3">SYMBaiEX API sandbox</h1>
        <p className="page-lede mt-5">
          Test client parsing, discovery, search requests, and error handling
          against deterministic synthetic fixtures. This environment never reads
          production data, creates accounts, sends webhooks, invokes a model, or
          performs writes.
        </p>
        <section className="mt-10" aria-labelledby="sandbox-operations">
          <h2 id="sandbox-operations" className="text-2xl font-semibold">
            Read-only operations
          </h2>
          <ul className="mt-4 space-y-3 font-mono text-sm">
            <li>
              <a
                className="underline"
                href={PRIMARY_SITE_URL + "/api/sandbox/openapi.json"}
              >
                OpenAPI 3.1 contract
              </a>
            </li>
            <li>
              <a
                className="underline"
                href={PRIMARY_SITE_URL + "/api/sandbox"}
              >
                GET /api/sandbox
              </a>
            </li>
            <li>
              <a
                className="underline"
                href={PRIMARY_SITE_URL + "/api/sandbox/v1/status"}
              >
                GET /api/sandbox/v1/status
              </a>
            </li>
            <li>
              <a
                className="underline"
                href={PRIMARY_SITE_URL + "/api/sandbox/v1/search?q=security&amp;limit=2"}
              >
                GET /api/sandbox/v1/search?q=security&amp;limit=2
              </a>
            </li>
          </ul>
        </section>
        <section
          className="mt-10"
          id="fixtures"
          aria-labelledby="sandbox-fixtures"
        >
          <h2 id="sandbox-fixtures" className="text-2xl font-semibold">
            Fixture boundary
          </h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            Every returned identifier starts with <code>sandbox-</code>. The
            endpoint accepts no bearer token, idempotency key, mutation, job,
            upload, or destination URL. Use the authenticated production API
            only after owner-approved enrollment.
          </p>
        </section>
      </div>
    </article>
  );
}
