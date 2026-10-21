import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import convex from "@convex-dev/eslint-plugin";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const __dirname = dirname(fileURLToPath(import.meta.url));

const eslintConfig = [
  ...nextCoreWebVitals,
  {
    ignores: [
      ".next/**",
      "**/.next/**",
      ".claude/**",
      "node_modules/**",
      "convex/_generated/**",
      "workers/eliza-shadow-gateway/worker-configuration.d.ts",
      "next-env.d.ts",
    ],
  },
  {
    // These rules are opt-in quality checks in React Compiler 7. The app
    // intentionally synchronizes client state from browser storage, URL
    // params, and Convex query results inside effects.
    rules: {
      // Every deployable app uses the App Router; this Pages Router-only rule
      // otherwise emits a false missing-directory warning at the workspace root.
      "@next/next/no-html-link-for-pages": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["convex/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
  },
  ...convex.configs.recommended,
];

export default eslintConfig;
