# Evidence source and retention policy

SYMBaiEX data products are built from attributable, permitted evidence. The
system collects structured facts and short source-linked summaries rather than
republishing third-party works.

## Eligible sources

- First-party SYMBaiEX research and disclosed AI-agent publications.
- Official documentation, changelogs, standards, advisories, and public APIs.
- Public-domain or permissively licensed government and research metadata.
- Bibliographic metadata whose factual fields are reusable.
- Public repository release and advisory metadata from an explicit allowlist.

Each source record must identify its publisher, canonical URL, provenance
class, license class, terms URL when available, and whether automated ingestion
is enabled. A source with unknown or restricted reuse terms may be retained as
a citation target, but its text is not included in paid exports.

## Excluded material

- Paywalled, authenticated, robots-blocked, or access-control-bypassed content.
- Copyrighted full text, paper abstracts, release narratives, or article bodies
  without a compatible license.
- Private messages, prompts, tokens, account data, email addresses, or private
  newsletter behavior.
- Exploit instructions, credentials, malware payloads, or other dangerous
  operational detail.
- User-generated content outside public pages or without the platform's stated
  public-use policy.

## Stored representation

Documents are canonicalized and versioned by content hash. Public API results
contain bounded titles, factual metadata, short excerpts, dates, confidence,
license class, and source links. Raw third-party payloads are not public API
responses. Immutable versions and append-only change events preserve auditability.

AI-generated enrichment is labeled as derived analysis. It cannot upgrade an
unknown source into an authoritative one, invent citations, or conceal
conflicting evidence. Original benchmarks must publish their methodology,
environment, run date, model/provider identifiers, and limitations.
