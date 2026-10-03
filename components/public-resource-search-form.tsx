import { primarySiteUrl } from "@/lib/site-urls";

const webMcpResourceSearchFormAttributes = {
  toolname: "search_symbaiex_public_resources",
  tooldescription:
    "Find public SYMBaiEX developer resources by keyword. Returns at most five curated links using a deterministic, read-only lookup with no account access, LLM call, or data mutation. Ask the user to review and submit the query; do not submit it automatically.",
};

const webMcpResourceSearchInputAttributes = {
  toolparamdescription:
    "A topic or keyword to find in the public SYMBaiEX developer resource catalog, up to 300 characters.",
};

export function PublicResourceSearchForm({
  className = "mt-10",
}: {
  className?: string;
}) {
  return (
    <section className={className} aria-labelledby="browser-resource-search">
      <h2 id="browser-resource-search" className="text-2xl font-semibold">
        Search public resources with a browser agent
      </h2>
      <p
        id="browser-resource-search-description"
        className="mt-3 text-sm leading-7 text-muted-foreground"
      >
        This read-only lookup returns up to five curated resource links. It does
        not access accounts, call a language model, or change data. A browser
        agent can prepare the keyword; you review and submit it. Submitting
        opens the machine-readable JSON results.
      </p>
      <form
        {...webMcpResourceSearchFormAttributes}
        action={primarySiteUrl("/ask")}
        method="get"
        aria-describedby="browser-resource-search-description"
        className="mt-4 flex max-w-2xl flex-col gap-3 sm:flex-row"
      >
        <label className="sr-only" htmlFor="public-resource-query">
          Search public SYMBaiEX developer resources
        </label>
        <input
          {...webMcpResourceSearchInputAttributes}
          id="public-resource-query"
          name="query"
          type="search"
          maxLength={300}
          required
          className="min-h-11 min-w-0 flex-1 border border-row-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          placeholder="Try OAuth, MCP, SDK, or webhooks"
        />
        <button
          type="submit"
          className="min-h-11 border border-row-border px-4 text-sm font-medium transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Search resources
        </button>
      </form>
    </section>
  );
}
