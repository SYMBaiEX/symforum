import type { ResearchReport } from "./forum-research";
import { communityHttpsUrl } from "./forum-community";
import { createHash } from "node:crypto";

export type FrozenReportReceipt = {
  intentKey: string;
  mint: string;
  createdAt: number;
  expiresAt: number;
  signature: string;
  finalizedAt: number | null;
  report: ResearchReport;
};
// Static, trusted stylesheet only. The response authorizes precisely these bytes.
export const RESEARCH_REPORT_CSS = `:root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.6;color:#202020;background:#f7f7f5}*{box-sizing:border-box}body{margin:0}main{max-width:54rem;margin:auto;padding:clamp(1rem,4vw,2.5rem);overflow-wrap:anywhere}h1{font-size:clamp(1.5rem,5vw,2.25rem);line-height:1.25}h2{font-size:1.2rem;margin-top:2rem}p,li,dt,dd{max-width:100%;overflow-wrap:anywhere}dl{margin:0}dl>div{padding:.8rem 0;border-bottom:1px solid #aaa}dt{font-weight:650}dd{margin:.3rem 0 0}code,time{font-family:ui-monospace,monospace;font-size:.9em}a{display:inline-flex;align-items:center;min-height:44px;max-width:100%;color:#064b9c;overflow-wrap:anywhere}a:focus-visible{outline:3px solid currentColor;outline-offset:3px}ul{padding-left:1.3rem}.notice{padding:1rem;border:1px solid #aaa;border-radius:.5rem}.facts dd{font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums;white-space:pre-wrap}.sources a{display:block;padding:.5rem 0}.sources p{margin:.3rem 0}.reference{white-space:pre-wrap}@media(prefers-color-scheme:dark){:root{color:#eee;background:#151515}a{color:#8ec4ff}}`;

const styleHash = createHash("sha256")
  .update(RESEARCH_REPORT_CSS)
  .digest("base64");
const metaPolicy = `default-src 'none'; script-src 'none'; style-src 'sha256-${styleHash}'; style-src-attr 'none'; img-src 'none'; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
export function researchReportCsp() {
  return `${metaPolicy}; frame-ancestors 'none'`;
}

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
const time = (value: number | null) => {
  if (
    value === null ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 8_640_000_000_000_000
  )
    return "Unavailable";
  const iso = new Date(value).toISOString();
  return `<time datetime="${iso}">${iso} (UTC)</time>`;
};
function document(title: string, body: string, forwardedNonce?: string | null) {
  // Proxy overwrites this header. Never reflect an invalid attribute, nor use
  // this presentation nonce as authentication. The meta policy independently
  // limits styling to the exact static hash even when middleware headers win.
  const nonce =
    forwardedNonce && /^[A-Za-z0-9+/]{22}==$/.test(forwardedNonce)
      ? ` nonce="${forwardedNonce}"`
      : "";
  // frame-ancestors is header-only: retain the route/proxy header, not a fake meta guarantee.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escape(metaPolicy)}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escape(title)}</title><style${nonce}>${RESEARCH_REPORT_CSS}</style></head><body><main>${body}</main></body></html>`;
}

export function researchReportUnavailableHtml(forwardedNonce?: string | null) {
  return document(
    "Research report unavailable",
    `<h1>Research report unavailable</h1><p>No saved fulfilled report is available for this request.</p><p>If a payment outcome is uncertain, check the existing receipt; do not repeat payment. This page requests no payment or verification action.</p>`,
    forwardedNonce,
  );
}

/** Presentation of existing strings only: no builder, live metrics or new dates. */
export function researchReportHtml(
  receipt: FrozenReportReceipt,
  forwardedNonce?: string | null,
) {
  if (
    !/^[a-f0-9]{64}$/.test(receipt.intentKey) ||
    receipt.report.mint !== receipt.mint
  )
    throw new Error("Invalid saved report identity.");
  const report = receipt.report;
  const sources = report.sources
    .map((source) => {
      let href: string | null = null;
      try {
        href = communityHttpsUrl(source.url);
      } catch {
        /* Preserve unsafe historical references as inert text only. */
      }
      return `<li><p>${escape(source.label)}</p>${
        href
          ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(source.url)}</a>`
          : `<p>Non-clickable recorded reference:</p><p class="reference">${escape(source.url)}</p>`
      }</li>`;
    })
    .join("");
  return document(
    report.title,
    `<header><p>Saved research report · private to its signed-in owner</p><h1>${escape(report.title)}</h1><p class="notice">This is the existing frozen export, not live token data or a new report. Original recorded values and observation times are preserved. Reading this page does not request another payment.</p></header>
<section aria-labelledby="identity"><h2 id="identity">Report identity and times</h2><dl>
<div><dt>Product</dt><dd>${escape(report.product)}</dd></div>
<div><dt>Exact token mint</dt><dd><code>${escape(receipt.mint)}</code></dd></div>
<div><dt>Report frozen at</dt><dd>${time(report.generatedAt)}</dd></div>
<div><dt>Source observations at</dt><dd>${time(report.metricsAsOf)}</dd></div>
</dl></section>
<section aria-labelledby="facts"><h2 id="facts">Recorded facts</h2><dl class="facts">${report.facts.map((fact) => `<div><dt>${escape(fact.label)}</dt><dd>${escape(fact.value)}</dd></div>`).join("")}</dl></section>
<section aria-labelledby="analysis"><h2 id="analysis">Recorded analysis</h2><ul>${report.analysis.map((line) => `<li>${escape(line)}</li>`).join("")}</ul></section>
<section aria-labelledby="sources"><h2 id="sources">Recorded sources</h2><p>External source links open another site. They are references, not endorsements or current verification.</p><ul class="sources">${sources}</ul></section>
<section aria-labelledby="method"><h2 id="method">Original methodology and caveats</h2><p>${escape(report.methodology)}</p></section>
<section aria-labelledby="receipt"><h2 id="receipt">Saved receipt</h2><dl>
<div><dt>Receipt ID</dt><dd><code>${escape(receipt.intentKey)}</code></dd></div>
<div><dt>Receipt created at</dt><dd>${time(receipt.createdAt)}</dd></div>
<div><dt>Recorded finalization time</dt><dd>${time(receipt.finalizedAt)}</dd></div>
<div><dt>Original quote deadline</dt><dd>${time(receipt.expiresAt)}<p>This historical quote deadline does not renew or expire the saved fulfilled report.</p></dd></div>
<div><dt>Recorded transaction signature</dt><dd><code>${escape(receipt.signature)}</code></dd></div>
</dl><a href="/api/research/token/${receipt.intentKey}">Open original JSON report and receipt</a></section>`,
    forwardedNonce,
  );
}
