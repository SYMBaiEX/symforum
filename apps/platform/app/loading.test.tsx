import { describe, expect, test } from "vitest";

import RootLoading from "./loading";
import ForumLoading from "./forum/loading";

describe("route loading fallbacks", () => {
  test("root loading renders nothing", () => {
    expect(RootLoading()).toBeNull();
  });

  test("forum loading renders nothing", () => {
    expect(ForumLoading()).toBeNull();
  });
});
