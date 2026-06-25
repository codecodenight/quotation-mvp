import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "backups/**",
    "data/**",
    "data/source-archive/**",
    "outputs/**",
    "sample-data/**",
    "sample data/**",
    "next-env.d.ts",
    "generated/prisma/**",
    "src/**/*.test.ts",
    "src/**/*.test.tsx",
  ]),
]);
