import { beforeEach, describe, expect, test, vi } from "vitest";

const { getServerConvexClient } = vi.hoisted(() => ({
  getServerConvexClient: vi.fn(),
}));

vi.mock("@/lib/server-convex", () => ({ getServerConvexClient }));

import { NextRequest } from "next/server";
import { convexRefs } from "@/lib/convex-refs";
import { GET } from "./route";

const client = {
  query: vi.fn(),
  mutation: vi.fn(),
};

const destination = {
  url: "https://example.com/source",
  eventType: "source_click" as const,
  hnItemId: 42,
};

beforeEach(() => {
  client.query.mockReset();
  client.mutation.mockReset();
  getServerConvexClient.mockReset();
  getServerConvexClient.mockReturnValue(client);
});

describe("newsletter redirect route", () => {
  test("resolves and records a valid redirect with one Convex call", async () => {
    client.mutation.mockResolvedValue({ destination, recorded: true });

    const response = await GET(request(), {
      params: Promise.resolve({ slug: "routing-test", target: "source-42" }),
    });

    expect(client.mutation).toHaveBeenCalledOnce();
    expect(client.mutation).toHaveBeenCalledWith(
      convexRefs.newsletter.resolveAndRecordPublicEngagement,
      {
        slug: "routing-test",
        target: "source-42",
        visitorKey: expect.any(String),
      },
    );
    expect(client.query).not.toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(destination.url);
  });

  test("keeps redirects working without replaying engagement after mutation failure", async () => {
    client.mutation.mockRejectedValueOnce(new Error("temporary failure"));
    client.query.mockResolvedValue(destination);

    const response = await GET(request(), {
      params: Promise.resolve({ slug: "routing-test", target: "source-42" }),
    });

    expect(client.query).toHaveBeenCalledOnce();
    expect(client.mutation).toHaveBeenCalledOnce();
    expect(client.mutation).toHaveBeenCalledWith(
      convexRefs.newsletter.resolveAndRecordPublicEngagement,
      {
        slug: "routing-test",
        target: "source-42",
        visitorKey: expect.any(String),
      },
    );
    expect(client.query).toHaveBeenCalledWith(
      convexRefs.newsletter.resolvePublicDestination,
      { slug: "routing-test", target: "source-42" },
    );
    expect(response.headers.get("location")).toBe(destination.url);
  });
});

function request() {
  return new NextRequest(
    "https://www.symbaiex.com/newsletter/routing-test/go/source-42",
  );
}
