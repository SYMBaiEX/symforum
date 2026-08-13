import { headers } from "next/headers";
import { serializeJsonLd } from "@/lib/seo";

export async function StructuredData({ data }: { data: unknown }) {
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const jsonLd = Array.isArray(data)
    ? { "@context": "https://schema.org", "@graph": data }
    : data && typeof data === "object" && "@context" in data
      ? data
      : {
          "@context": "https://schema.org",
          ...(data as Record<string, unknown>),
        };
  return (
    <script
      id="structured-data"
      type="application/ld+json"
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
    />
  );
}
