import { renderAiReadablePage } from "@/lib/ai-readable";
import { PRIMARY_SITE_URL } from "@/lib/site-urls";

const INDEX_PATHS = [
  "/",
  "/about",
  "/blog",
  "/news",
  "/portfolio",
  "/newsletter",
  "/contact",
];

export const dynamic = "force-dynamic";

export async function GET() {
  const pages = await Promise.all(
    INDEX_PATHS.map((pathname) => renderAiReadablePage({ pathname })),
  );
  const sections = pages
    .filter((page): page is NonNullable<typeof page> => page !== null)
    .map((page) => `${page.markdown}\n\nSource: ${page.canonical}`);
  const content = [
    "# SYMBaiEX public content",
    "",
    "> A current Markdown bundle of the highest-value public pages. Individual pages remain available through content negotiation or their `.md` alias.",
    "",
    ...sections,
  ].join("\n\n---\n\n");

  return new Response(`${content.trim()}\n`, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      Link: `<${PRIMARY_SITE_URL}/llms.txt>; rel="describedby"`,
    },
  });
}
