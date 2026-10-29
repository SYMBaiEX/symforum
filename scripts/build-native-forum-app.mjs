import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative } from "node:path";
import { compareForumRoutePatterns } from "../lib/forum-native-routing.ts";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
const root = resolve(import.meta.dirname, "..");
// Tailwind's content globs resolve against cwd. App-local Vercel builds must
// generate the same styles as root development and CI commands.
process.chdir(root);
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const requiredBun = manifest.packageManager.replace(/^bun@/, "");
if (Bun.version !== requiredBun)
  throw new Error(`Native forum generation requires Bun ${requiredBun}; received ${Bun.version}. Use the repository's pinned build runtime.`);
const directory = resolve(root, "components/forum/plugin-adapter");
const forumAppRoot = "apps/forum/app";
const pages = [];
async function collect(path) {
  for (const item of await readdir(path, { withFileTypes: true })) {
    const file = resolve(path, item.name);
    if (item.isDirectory()) await collect(file);
    else if (item.name === "page.tsx")
      pages.push(relative(root, file).replaceAll("\\", "/"));
  }
}
await collect(resolve(root, forumAppRoot, "forum"));
const routes = pages
  .map((page, index) => {
    const path =
      "/" +
      page
        .replace(new RegExp(`^${forumAppRoot}/`), "")
        .replace(/\/page.tsx$/, "");
    return {
      path: path.replace(/\/\([^/]+\)/g, ""),
      module: `Page${index}`,
      source: page,
    };
  })
  .sort(compareForumRoutePatterns);
const router =
  routes
    .map(
      (item) =>
        `import ${item.module} from ${JSON.stringify("../../../" + item.source.replace(/\.tsx$/, ""))};`,
    )
    .join("\n") +
  "\nexport const routes=[" +
  routes
    .map((item) => `{path:${JSON.stringify(item.path)},render:${item.module}}`)
    .join(",") +
  "];\n";
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, "routes.generated.ts"), router);
const aliases = {
  "@/app/forum/layout": resolve(root, forumAppRoot, "forum/layout.tsx"),
  "@/app/forum/error": resolve(root, forumAppRoot, "forum/error.tsx"),
  "@/app/forum/not-found": resolve(root, forumAppRoot, "forum/not-found.tsx"),
  "convex/react": "data.ts",
  "convex-helpers/react/cache/hooks": "data.ts",
  "next/navigation": "router.tsx",
  "next/link": "router.tsx",
  "next/image": "image.tsx",
  "next/dynamic": "framework.tsx",
  "next/headers": "framework.tsx",
  "next/web-vitals": "framework.tsx",
  "@convex-dev/auth/react": "framework.tsx",
  "@symbaiex/auth/token": "framework.tsx",
  "@convex-dev/presence/react": "presence.ts",
  "@/app/forum/forum-route-status": "server.ts",
  "@/app/forum/announcements/announcement-route-status": "server.ts",
  "@/lib/news-data": "server.ts",
  "@/components/structured-data": "framework.tsx",
  "@/components/web-vitals-reporter": "framework.tsx",
  "@/components/analytics-tracker": "framework.tsx",
  // Browser WebMCP uses first-party authentication; the embedded forum uses
  // its host MCP connection. Never pull AuthKit/Next server modules into it.
  "@workos-inc/authkit-nextjs/components": "framework.tsx",
  "@/components/app-error-surface": "errors.tsx",
};
const result = await Bun.build({
  entrypoints: [resolve(directory, "entry.tsx")],
  target: "browser",
  // This is a classic inline script in a host-owned document. Keep all bundled
  // names private so injected host scripts cannot collide with minified globals.
  format: "iife",
  minify: true,
  splitting: false,
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.NEXT_PUBLIC_CONVEX_URL":
      '"https://strong-bee-384.convex.cloud"',
  },
  plugins: [
    {
      name: "forum-native-transport",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (aliases[args.path])
            return { path: resolve(directory, aliases[args.path]) };
          if (args.path === "server-only")
            return { path: resolve(directory, "empty.ts") };
        });
      },
    },
  ],
});
if (!result.success) throw new Error(result.logs.map(String).join("\n"));
const javascript = result.outputs.find(output => output.path.endsWith(".js"));
if (!javascript) throw new Error("Native forum build did not emit JavaScript.");
const code = await javascript.text();
// Bun emits CSS modules and component stylesheet imports separately. Include
// those outputs as well as the root styles; otherwise a normal forum component
// can silently lose its styles in the plugin even though its React is shared.
const componentStyles = await Promise.all(result.outputs.filter(output => output.path.endsWith(".css")).map(output => output.text()));
// Follow the real root layout's stylesheet imports, including KaTeX for forum math.
const layout = await readFile(resolve(root, forumAppRoot, "layout.tsx"), "utf8");
const styles = [];
for (const match of layout.matchAll(/import ["']([^"']+\.css)["'];/g)) {
  const specifier = match[1];
  const file = specifier.startsWith(".")
    ? resolve(root, forumAppRoot, specifier)
    : resolve(root, "node_modules", specifier);
  let text = await readFile(file, "utf8");
  text = text.replace(
      '@import "../../../styles/forum-shared.css";',
    await readFile(resolve(root, "styles/forum-shared.css"), "utf8"),
  );
  const directory = resolve(file, "..");
  for (const source of [
    ...text.matchAll(/src:url\(([^)]+\.woff2)\) format\("woff2"\)(?:,[^;]+)?/g),
  ]) {
    const font = await readFile(resolve(directory, source[1]));
    text = text.replace(
      source[0],
      `src:url(data:font/woff2;base64,${font.toString("base64")}) format("woff2")`,
    );
  }
  styles.push(text);
}
const source = [...styles, ...componentStyles].join("\n");
const css = String(
  await postcss([
    tailwindcss({ config: resolve(root, "tailwind.config.ts") }),
  ]).process(source, { from: resolve(root, forumAppRoot, "globals.css") }),
);
const output =
  "/* Generated from the real Next.js forum pages and components. Do not edit. */\nexport const FORUM_NATIVE_APP_JS=" +
  JSON.stringify(code.replaceAll("</script", "<\\/script")) +
  ";\nexport const FORUM_NATIVE_APP_CSS=" +
  JSON.stringify(css.replaceAll("</style", "<\\/style")) +
  ";\nexport const FORUM_NATIVE_ROUTES=" +
  JSON.stringify(routes.map(({ path, source }) => ({ path, source }))) +
  " as const;\n";
const target = resolve(root, "lib/forum-native-app.generated.ts");
const fonts = await readFile(
  resolve(root, "lib/forum-shared-css.generated.ts"),
  "utf8",
);
const revision = createHash("sha256")
  .update(output)
  .update(fonts)
  .update(await readFile(resolve(root, "lib/forum-plugin-app.ts"), "utf8"))
  .update(await readFile(resolve(root, "lib/forum-plugin-startup.ts"), "utf8"))
  .digest("hex")
  .slice(0, 12);
const revisionTarget = resolve(root, "lib/forum-native-revision.generated.ts");
const revisionOutput =
  '// Generated by scripts/build-native-forum-app.mjs. Do not edit.\nexport const FORUM_NATIVE_RESOURCE_URI = "ui://symbaiex/forum-' +
  revision +
  '.html";\n';
if (process.argv.includes("--check")) {
  if (
    (await readFile(target, "utf8")) !== output ||
    (await readFile(revisionTarget, "utf8")) !== revisionOutput
  )
    throw new Error("Native forum bundle is stale. Run bun run ui:sync.");
} else {
  await writeFile(target, output);
  await writeFile(revisionTarget, revisionOutput);
}
console.log(
  `Shared native forum: ${routes.length} routes, ${code.length} bytes of JS, ${css.length} bytes of CSS.`,
);
