import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { reportReceipt } from "../tests/e2e/fixtures/research-report-view";
import {
  RESEARCH_REPORT_CSS,
  researchReportCsp,
  researchReportHtml,
  researchReportUnavailableHtml,
} from "./forum-research-report-html";

test("renders original frozen strings and each original time without recomputing metrics", () => {
  const before = JSON.stringify(reportReceipt);
  const html = researchReportHtml(reportReceipt);
  for (const fact of reportReceipt.report.facts)
    expect(html).toContain(fact.value);
  for (const date of [
    reportReceipt.createdAt,
    reportReceipt.expiresAt,
    reportReceipt.finalizedAt!,
    reportReceipt.report.generatedAt,
    reportReceipt.report.metricsAsOf,
  ])
    expect(html).toContain(new Date(date).toISOString());
  expect(html).toContain("does not renew or expire the saved fulfilled report");
  expect(html).toContain(`/api/research/token/${reportReceipt.intentKey}`);
  expect(JSON.stringify(reportReceipt)).toBe(before);
});
test.each([
  "javascript:alert(1)",
  "data:text/html,secret",
  "https://user:pass@source.example/",
  "https://localhost/a",
  "https://127.0.0.1/a",
  "https://source.example:8443/a",
  "//source.example/a",
])("unsafe recorded source remains attributed but inert: %s", (url) => {
  const html = researchReportHtml({
    ...reportReceipt,
    report: {
      ...reportReceipt.report,
      sources: [{ label: "Recorded source", url }],
    },
  });
  expect(html).toContain("Non-clickable recorded reference");
  expect(html).not.toContain(`href="${url}`);
  expect(html).toContain(url);
});
test("escapes frozen markup, keeps safe references, and contains no executable content", () => {
  const html = researchReportHtml(reportReceipt);
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("&lt;not live&gt;");
  expect(html).toContain("?a=1&amp;b=2");
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).not.toMatch(/<script|<img|<iframe|\son\w+=/i);
});
test("CSP authorizes only the exact trusted CSS, never scripts or network assets", async () => {
  const csp = await researchReportCsp();
  expect(csp).toContain(
    `style-src 'sha256-${createHash("sha256").update(RESEARCH_REPORT_CSS).digest("base64")}'`,
  );
  for (const rule of [
    "default-src 'none'",
    "script-src 'none'",
    "connect-src 'none'",
    "frame-ancestors 'none'",
    "style-src-attr 'none'",
  ])
    expect(csp).toContain(rule);
  expect(csp).not.toContain("unsafe-inline");
});
test("missing historical time stays unavailable; mismatched report identity is rejected", () => {
  expect(researchReportHtml({ ...reportReceipt, finalizedAt: null })).toContain(
    "Recorded finalization time</dt><dd>Unavailable",
  );
  expect(() =>
    researchReportHtml({ ...reportReceipt, intentKey: "../secret" }),
  ).toThrow();
  expect(() =>
    researchReportHtml({ ...reportReceipt, mint: "another-mint" }),
  ).toThrow();
  expect(researchReportUnavailableHtml()).not.toContain(reportReceipt.mint);
});
test("restrictive meta precedes style/content; nonce is limited to the trusted stylesheet", () => {
  const nonce = "AAAAAAAAAAAAAAAAAAAAAA==";
  const html = researchReportHtml(reportReceipt, nonce);
  expect(html).toContain(`<style nonce="${nonce}">`);
  expect(html.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(
    html.indexOf("<style"),
  );
  expect(html).toContain('name="referrer" content="no-referrer"');
  const meta = html.match(
    /http-equiv="Content-Security-Policy" content="([^"]+)"/,
  )![1];
  expect(meta).toContain("script-src &#39;none&#39;");
  expect(meta).not.toContain("frame-ancestors");
  for (const invalid of ['" onload="alert(1)', "short", "a".repeat(300), ""])
    expect(researchReportHtml(reportReceipt, invalid)).not.toContain(
      "<style nonce=",
    );
});
