// @vitest-environment node
import type { ChangeEvent, ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FunctionReturnType } from "convex/server";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const harness = vi.hoisted(() => ({
  host: "website",
  query: vi.fn(),
  apply: vi.fn(),
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  stateCursor: 0,
  refCursor: 0,
  buttons: [] as Array<{
    label: string;
    disabled?: boolean;
    click?: () => Promise<void>;
  }>,
  inputs: [] as Array<ComponentProps<"input">>,
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  // A deterministic hook harness: interactions retain state between SSR renders.
  // No browser, credential, network or real Convex operation is available here.
  useState: <T,>(initial: T | (() => T)) => {
    const index = harness.stateCursor++;
    if (!(index in harness.states))
      harness.states[index] =
        typeof initial === "function" ? (initial as () => T)() : initial;
    return [
      harness.states[index] as T,
      (next: T | ((current: T) => T)) => {
        harness.states[index] =
          typeof next === "function"
            ? (next as (current: T) => T)(harness.states[index] as T)
            : next;
      },
    ];
  },
  useRef: <T,>(initial: T) => {
    const index = harness.refCursor++;
    harness.refs[index] ??= { current: initial };
    return harness.refs[index] as { current: T };
  },
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: harness.query }),
  useMutation: () => harness.apply,
}));
vi.mock("@/components/forum/forum-runtime-context", () => ({
  useForumRuntime: () => ({ host: harness.host }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: ComponentProps<"button">) => {
    harness.buttons.push({
      label: String(children),
      disabled,
      click: onClick as (() => Promise<void>) | undefined,
    });
    return <button disabled={disabled}>{children}</button>;
  },
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: ComponentProps<"input">) => {
    harness.inputs.push(props);
    return <input {...props} />;
  },
}));

import { AdminForumTaxonomy } from "./admin-forum-taxonomy";

type Preview = FunctionReturnType<typeof api.forum.previewForumTaxonomy>;
function fixture(): Preview {
  return {
    version: "five-pillars-v1",
    fingerprint: "exact-reviewed-fingerprint",
    archiveCategoryId: null,
    canApply: true,
    blockers: [],
    changes: [
      {
        categoryId: "category-projects" as Id<"forumCategories">,
        slug: "projects",
        archiveRoot: true,
        before: {
          name: "Projects",
          parentCategoryId: null,
          position: 20,
          readOnlyArchive: null,
        },
        after: {
          name: "Projects",
          parentCategoryId: null,
          position: 20,
          readOnlyArchive: true,
        },
      },
    ],
  };
}
function render() {
  harness.stateCursor = 0;
  harness.refCursor = 0;
  harness.buttons = [];
  harness.inputs = [];
  return renderToStaticMarkup(<AdminForumTaxonomy />);
}
function button(label: string) {
  const result = harness.buttons.find((item) => item.label === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
async function preview(data = fixture()) {
  harness.query.mockResolvedValueOnce(data);
  render();
  await button("Preview board changes").click?.();
  return render();
}
function confirm() {
  harness.inputs[0]?.onChange?.({
    currentTarget: { checked: true },
  } as ChangeEvent<HTMLInputElement>);
  return render();
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.host = "website";
  harness.states = [];
  harness.refs = [];
});

test("mounting and rerendering neither previews, subscribes nor applies", () => {
  const html = render();
  render();
  expect(html).toContain("Board organization");
  expect(html).not.toContain("Apply reviewed board changes");
  expect(harness.query).not.toHaveBeenCalled();
  expect(harness.apply).not.toHaveBeenCalled();
});

test("embedded administration offers a first-party link and no operation", () => {
  harness.host = "plugin";
  const html = render();
  expect(html).toContain("Open board organization");
  expect(html).toContain("/admin/forum#board-organization");
  expect(harness.buttons).toHaveLength(0);
  expect(harness.query).not.toHaveBeenCalled();
  expect(harness.apply).not.toHaveBeenCalled();
});

test("preview is explicit and displays escaped changes before confirmation", async () => {
  const data = fixture();
  data.changes[0].before.name = "<script>private marker</script>";
  const html = await preview(data);
  expect(getFunctionName(harness.query.mock.calls[0][0])).toBe(
    "forum:previewForumTaxonomy",
  );
  expect(harness.query.mock.calls[0][1]).toEqual({ now: expect.any(Number) });
  expect(html).toContain("&lt;script&gt;private marker&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("Parent:");
  expect(html).toContain("Archive");
  expect(button("Apply reviewed board changes").disabled).toBe(true);
  await button("Apply reviewed board changes").click?.();
  expect(harness.apply).not.toHaveBeenCalled();
  render();
  expect(harness.query).toHaveBeenCalledTimes(1);
});

test("blockers cannot be confirmed or applied and do not clear holds", async () => {
  const data = fixture();
  data.canApply = false;
  data.blockers = ["An unresolved paid placement blocks archiving projects."];
  const html = await preview(data);
  expect(html).toContain("Changes are blocked");
  expect(html).toContain(data.blockers[0]);
  expect(harness.inputs).toHaveLength(0);
  expect(button("Apply reviewed board changes").disabled).toBe(true);
  await button("Apply reviewed board changes").click?.();
  expect(harness.apply).not.toHaveBeenCalled();
});

test("a reviewed fingerprint is submitted once, with no automatic retry", async () => {
  await preview();
  confirm();
  let finish!: (value: unknown) => void;
  harness.apply.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const click = button("Apply reviewed board changes").click!;
  const pending = click();
  await click();
  expect(harness.apply).toHaveBeenCalledExactlyOnceWith({
    expectedFingerprint: "exact-reviewed-fingerprint",
    confirmation: "preserve-urls-and-holds",
  });
  render();
  expect(button("Applying reviewed changes…").disabled).toBe(true);
  finish({ applied: true, auditId: "audit-receipt", archiveCategoryId: "archive", inverseManifest: [] });
  await pending;
  // Even an old event closure cannot submit this consumed preview a second time.
  await click();
  const html = render();
  expect(html).toContain("Audit receipt: audit-receipt");
  expect(html).not.toContain("Apply reviewed board changes");
  expect(harness.apply).toHaveBeenCalledTimes(1);
});

test("an unconfirmed or stale apply invalidates review and reveals no raw error", async () => {
  await preview();
  confirm();
  harness.apply.mockRejectedValueOnce(new Error("TAXONOMY_CHANGED raw private details"));
  const click = button("Apply reviewed board changes").click!;
  await click();
  await click();
  const html = render();
  expect(html).toContain("No retry was sent");
  expect(html).toContain("fresh preview");
  expect(html).not.toContain("raw private details");
  expect(html).not.toContain("Apply reviewed board changes");
  expect(harness.apply).toHaveBeenCalledTimes(1);
  expect(harness.query).toHaveBeenCalledTimes(1);
});

test("new previews reset confirmation and an empty manifest cannot apply", async () => {
  await preview();
  confirm();
  expect(button("Apply reviewed board changes").disabled).toBe(false);
  await preview();
  expect(button("Apply reviewed board changes").disabled).toBe(true);
  const data = fixture();
  data.changes = [];
  const html = await preview(data);
  expect(html).toContain("already match");
  expect(harness.inputs).toHaveLength(0);
  expect(button("Apply reviewed board changes").disabled).toBe(true);
});

test("preview failure is safe and cannot retain an earlier confirmation", async () => {
  await preview();
  confirm();
  harness.query.mockRejectedValueOnce(new Error("private provider details"));
  await button("Preview board changes").click?.();
  const html = render();
  expect(html).toContain("No changes were requested");
  expect(html).not.toContain("private provider details");
  expect(html).not.toContain("Apply reviewed board changes");
  expect(harness.apply).not.toHaveBeenCalled();
});
