import { renderToReadableStream } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import DeveloperResourcePage, {
  generateMetadata,
  generateStaticParams,
} from "./page";
import {
  DEVELOPER_RESOURCES,
  type DeveloperResource,
} from "@/lib/developer-resources";
import { publicDocumentation } from "@/lib/public-documentation";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
}));

describe("developer integration guides", () => {
  test("renders useful server-readable guidance and truthful structured data for every canonical resource", async () => {
    for (const { resource } of generateStaticParams()) {
      const params = Promise.resolve({ resource });
      const stream = await renderToReadableStream(
        await DeveloperResourcePage({ params }),
      );
      await stream.allReady;
      const html = await new Response(stream).text();
      const entry: DeveloperResource =
        DEVELOPER_RESOURCES[resource as keyof typeof DEVELOPER_RESOURCES];
      expect(html).toContain(entry.title);
      expect(html).toContain("Integration guidance");
      expect(html).toContain("BreadcrumbList");
      expect(html).toContain("TechArticle");
      expect(html).not.toMatch(/AggregateRating|reviewRating/);
      const doc = publicDocumentation().find((d) =>
        d.uri.endsWith(`/developers/${resource}`),
      );
      expect(doc?.text.length).toBeGreaterThan(900);
      for (const detail of entry.details ?? [])
        expect(doc?.text).toContain(detail);
      if (resource === "webmcp") {
        expect(html).toContain("document.modelContext.registerTool");
        expect(doc?.text).toContain("navigator.modelContext");
      }
      if (resource === "cli") {
        expect(html).toContain("@symbaiex/agent-cli 0.1.0");
        expect(doc?.text).toContain(
          "refuses to overwrite an existing token file",
        );
        expect(doc?.text).toContain("Bun 1.4 or newer");
      }
      for (const faq of entry.faqs ?? []) {
        expect(html).toContain("FAQPage");
        expect(html).toContain(faq.question);
        expect(html).toContain(faq.answer);
        expect(doc?.text).toContain(faq.question);
        expect(doc?.text).toContain(faq.answer);
      }
      expect((await generateMetadata({ params })).alternates?.canonical).toBe(
        `/developers/${resource}`,
      );
    }
  });

  test("makes the separate owner-approved service-auth method discoverable without implying anonymous access", () => {
    const doc = publicDocumentation().find((d) =>
      d.uri.endsWith("/developers/authentication"),
    );
    expect(doc?.text).toContain("separately advertised /agent-auth issuer");
    expect(doc?.text).toContain("no credentials are issued before approval");
    expect(doc?.text).toContain("does not accept anonymous");
    expect(DEVELOPER_RESOURCES.authentication.links).toContainEqual([
      "Owner temporary agent approvals",
      "/agent/claim",
    ]);
  });

  test("rejects missing resources including prototype property names", async () => {
    for (const resource of [
      "missing",
      "constructor",
      "toString",
      "__proto__",
    ]) {
      const params = Promise.resolve({ resource });
      expect(await generateMetadata({ params })).toEqual({});
      await expect(DeveloperResourcePage({ params })).rejects.toThrow(
        "not found",
      );
    }
  });
});
