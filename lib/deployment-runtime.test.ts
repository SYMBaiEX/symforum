// @vitest-environment node
import { expect, test } from "vitest";
import { config as root } from "../vercel";
import { config as platform } from "../apps/platform/vercel";
import { config as forum } from "../apps/forum/vercel";
import { config as blog } from "../apps/blog/vercel";
import { config as news } from "../apps/news/vercel";
import { config as newsletter } from "../apps/newsletter/vercel";

test.each(Object.entries({ root, platform, forum, blog, news, newsletter }))(
  "%s bootstraps the pinned runtime before reading the newer frozen lockfile",
  (_name, config) => {
    // Vercel's default Bun cannot read lockfile v3. The npm prefix also
    // isolates bootstrapping from npm's stricter project-override rules.
    const runtime = "npx --yes --prefix /tmp --package=bun@1.4.2 bun";
    expect(config.installCommand).toContain(
      `${runtime} install --frozen-lockfile`,
    );
    expect(config.buildCommand).toBe(`${runtime} run build`);
    expect(config.installCommand).not.toMatch(/convex|env:push/);
    expect(config.buildCommand).not.toMatch(/convex|env:push/);
  },
);
