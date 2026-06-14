import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
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
  ]),
]);
