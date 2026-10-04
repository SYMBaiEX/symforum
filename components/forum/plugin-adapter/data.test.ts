import { afterAll, describe, expect, test, vi } from "vitest";
const target = new EventTarget();
vi.stubGlobal(
  "window",
  Object.assign(target, {
    parent: { postMessage: () => {} },
    document: {
      documentElement: { dataset: {}, classList: { toggle: () => {} } },
    },
    history: { pushState: () => {}, replaceState: () => {} },
    scrollTo: () => {},
  }),
);
const { operationForReference, mutationReference, pluginClient } =
  await import("./data");
const { forumHost } = await import("./host");
const { makeFunctionReference } = await import("convex/server");
const initial = {
  status: "completed" as const,
  actingAs: { userId: "actor", username: "helper", isAgent: true },
  data: {
    connectionId: "connection",
    policyVersion: 1,
    capabilities: ["read", "personal", "participate", "feedback"],
  },
};
afterAll(() => {
  forumHost.destroy();
  vi.unstubAllGlobals();
});
describe("native forum data adapter", () => {
  test("resolves overview to the content tool rather than the app launcher", () => {
    expect(operationForReference("forum:overview").name).toBe("forum_overview");
  });
  test("supports native staff and public profile aliases without direct session APIs", () => {
    expect(
      operationForReference("admin:listForumCategoryModerators").operation,
    ).toBe("listCategoryModeratorsAdmin");
    expect(operationForReference("users:publicProfile").operation).toBe(
      "getMemberProfile",
    );
    expect(() => operationForReference("admin:deleteSystemLog")).toThrow(
      "unavailable",
    );
  });
  test("keeps desired-state subscriptions and receipt stable after an uncertain response", async () => {
    forumHost.acceptStatus(initial);
    let reads = 0;
    let commits = 0;
    const inputs: unknown[] = [];
    const mock = vi
      .spyOn(forumHost, "tool")
      .mockImplementation(async (name, args) => {
        if (name === "forum_list_my_category_subscriptions") {
          reads++;
          return {
            status: "completed",
            actingAs: initial.actingAs,
            data: { categories: [{ _id: "board-id", slug: "general" }] },
          };
        }
        inputs.push(args);
        if (++commits === 1) throw new Error("Network timeout");
        return {
          status: "completed",
          actingAs: initial.actingAs,
          data: { subscribed: false },
        };
      });
    await expect(
      mutationReference("forum:toggleCategorySubscription", {
        categorySlug: "general",
      }),
    ).rejects.toThrow("timeout");
    await expect(
      mutationReference("forum:toggleCategorySubscription", {
        categorySlug: "general",
      }),
    ).resolves.toEqual({ subscribed: false });
    expect(inputs[0]).toEqual(inputs[1]);
    expect(inputs[0]).toMatchObject({
      categorySlug: "general",
      subscribed: false,
      expectedPolicyVersion: 1,
    });
    expect(reads).toBe(1);
    mock.mockRestore();
  });
  test("does not clear a reviewed draft or generate another proposal on retry", async () => {
    forumHost.acceptStatus(initial);
    const mock = vi
      .spyOn(forumHost, "tool")
      .mockResolvedValue({
        status: "pending_approval",
        actingAs: initial.actingAs,
      });
    const args = {
      categorySlug: "general",
      title: "A held draft",
      body: "Draft body",
    };
    await expect(mutationReference("forum:createThread", args)).rejects.toThrow(
      "draft is preserved",
    );
    await expect(mutationReference("forum:createThread", args)).rejects.toThrow(
      "draft is preserved",
    );
    expect(mock.mock.calls[0]).toEqual(mock.mock.calls[1]);
    mock.mockRestore();
  });
  test("rejects stale draft authority and revoked capabilities before calling the host", async () => {
    forumHost.acceptStatus(initial);
    const authority = forumHost.authority();
    forumHost.acceptStatus({
      ...initial,
      data: { ...initial.data, policyVersion: 2, capabilities: ["read"] },
    });
    const mock = vi.spyOn(forumHost, "tool");
    await expect(
      mutationReference("forum:createThread", {}, authority),
    ).rejects.toThrow("acting profile");
    await expect(mutationReference("forum:createThread", {})).rejects.toThrow(
      "participate",
    );
    expect(mock).not.toHaveBeenCalled();
    mock.mockRestore();
  });
  test("unauthorized mailbox access never calls its tool", async () => {
    forumHost.acceptStatus({
      ...initial,
      data: { ...initial.data, capabilities: ["read"] },
    });
    const mock = vi.spyOn(forumHost, "tool");
    await expect(
      pluginClient.query(
        makeFunctionReference<"query">("forum:listPrivateMessages"),
        {},
      ),
    ).rejects.toThrow("messages");
    expect(mock).not.toHaveBeenCalled();
    mock.mockRestore();
  });
});
